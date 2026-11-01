---
name: bake
description: Converts CLAUDE.md rules and recurring review findings into automated checks, and removes the prose once a check holds the rule. Run once enough rules have accumulated to be worth automating.
user-invocable: true
disable-model-invocation: true
---

# Bake

Judge every CLAUDE.md rule against one question: **which tool could enforce this before code lands?** A rule a committed check enforces is context spent on nothing, because the violation never reaches review. The check's failure message is where a session meets the rule, so the message carries what the prose carried: what is wrong and what to write instead. The goal is a file where every remaining line needs judgment no tool can express, or warns of a mistake a check would catch only after the session built on it.

Read [../../references/enforcement.md](../../references/enforcement.md) (relative to this skill's directory) before the pass. It defines when a check holds a rule, and when one line stays next to a check.

Throughout, "automate" means recording a proposal in the report. No config edits and no CLAUDE.md edits before approval, no exceptions.

## Scope

Every CLAUDE.md file in the project and every enforcement surface it already has: linters and formatters, static analysis, architecture tests, package scripts, git hooks, CI workflows, and the project's committed `.claude/settings.json`. When the project has more than one CLAUDE.md file, fan out instead of loading them all: build the tool inventory once and hand it with one file to each clean-context agent, the root file included, then merge the verdicts in the main session. A single window holding every file blurs rules across scopes and crowds the tool configurations out of attention.

## Never

- Remove a rule's prose before its check holds the rule as `references/enforcement.md` defines it, on the current tree.
- Add a CLAUDE.md line for a check you add, or a pointer to it. A session that breaks the rule reads the message, and a line would cost every other session tokens to say the same.
- Make a check pass with a baseline or a blanket ignore the user did not approve.
- Add a new entrypoint. New checks run through the existing test and lint commands.
- Write a custom script while an existing tool can express the check.

## The pass, in order

### 1. Inventory the tooling

List the enforcement surfaces present, with the paths each one covers. For a tool that takes custom rules, note how the project tests them (a PHPStan `RuleTestCase`, ESLint's `RuleTester`, `ast-grep test`). Everything later is expressed through these surfaces, in this order of preference:

1. Linter and formatter rules (ESLint, Biome, Prettier, Pint, Ruff, gofmt)
2. Static analysis, including custom rules (TypeScript strict, PHPStan levels and custom rules, mypy, Rector)
3. Architecture tests (Pest arch, ArchUnit, dependency-cruiser)
4. Structural search and lint (ast-grep) for syntax-shaped rules a stock linter cannot express (a banned call pattern, a required argument shape)
5. Git hooks (Lefthook, Husky, pre-commit) and CI pipeline steps
6. Agent-harness hooks (Claude Code PreToolUse deny rules in the project's committed `.claude/settings.json`) for rules about how a command is invoked (a required flag, a banned subcommand), which no linter or code check can see
7. A custom script, only when nothing above can express the check

### 2. Classify each rule

Sort every rule into one of four. A rule whose violation takes a redesign to fix is **Prose** before anything else, whatever check holds it: a change may still close its check's gap, and it keeps the line.

- **Held**: a committed check already holds it, and fixing a violation is a local edit. Its prose goes with no new check, as a ready `delete` grouped by cause (class `bake:delete:tool-enforced`). So does every line or clause that only names the check holding a rule.
- **Held with a gap**: a check exists but misses a condition (a path it does not read, a message that names no fix, a baseline). The change closes the gap, and then the prose goes. Record which condition and the edit that closes it.
- **Automate**: no check holds it yet. Record the tool and the shape of the check, and the message it prints.
- **Prose**: record why. It needs human judgment, it depends on context no tool sees, or fixing a violation would be a redesign, whether a check holds it or not.

### 3. Read the intake candidates

`/bonsai:intake` records check-shaped candidates (`Class: bake`) under `~/.claude/bonsai/intake/<key>/` and, when exported, under the project's `.claude/bonsai/candidates/`. Read [../../references/intake-entry.md](../../references/intake-entry.md) (relative to this skill's directory) for the key and the format. Read every `bake` candidate with `Status: open` or `watch` under this project's key, and report "no intake entries under `<path>`" when the directory is missing. Treat a candidate as a rule to automate when its slug appears in two or more source PRs, or when the user names it: a check costs CI time, false positives, and tolerance for the tool, so it earns its place the way prose does. The `Check` line names the tool and shape intake verified. When a CLAUDE.md line already states the candidate's rule (its `Existing coverage` may name it), the candidate and the line are one change, which removes the line. Otherwise the change adds the check alone.

### 4. Prove each check

Before the report, run the planted-violation check in [../../references/probe.md](../../references/probe.md) (relative to this skill's directory) for every proposed check. It must fail on the planted violation, and its message must name the fix: read it as a session that never saw the rule would. A formatter needs no message: it must rewrite the planted violation.

Then run it over the untouched tree and sort every hit:

- **A real violation**: the change carries its fix as an edit, so the user sees every line the check makes the apply touch before deciding.
- **A false positive**: the check is too wide. Narrow it to what the rule governs and run it again. When a whole area follows other rules (migrations that must not fire model events), exempt it by path, with the reason in the check's config or code.

Revise a check that misses the planted violation or flags compliant code once, and drop it to prose with the reason when it still does.

A custom rule ships with its own test, through the harness step 1 noted: the planted violation and a compliant twin. A tool upgrade, a renamed path or a config change can silence a check, and once the prose is gone nothing else would notice. A stock rule turned on in a config needs no test of its own.

### 5. Approval and apply

Present the decisions in rounds as [../../references/rounds.md](../../references/rounds.md) (relative to this skill's directory) prescribes, at most 5 checks per round, ranked by how often the rule was broken. Every check is a call: it costs CI time and false positives, so the user decides each one. Present the round before touching anything: which rules will be automated and by which tool, which stay prose and why. Read [../../references/decision-memory.md](../../references/decision-memory.md) (relative to this skill's directory) before routing, then pick the delivery as [../../references/decision-artifact.md](../../references/decision-artifact.md) prescribes under "Delivery". For the page, build it with the renderer that reference names.

- Each rule to automate, or gap to close, is one `automate` change, with the tool named in the title. Its edits hold the check, its test, the fix of every violation it found, and the removal of the rule's prose when it has any.
- When the fixes run past about 20 sites, the change holds a baseline in their place and keeps the prose: the check guards new code at once and holds the rule with a gap until a later run clears the baseline. Its card names the count, and the command that fixes them when a tool can (an autofix, a Rector rule). A note on the change asking to fix them all turns it back into a change with every fix.
- Held rules are ready `delete` changes. Rules that stay prose go to `kept` with the reason.
- When two checks fix the same line, propose one now and the other in a run after the first lands on the default branch, which proves it again on that tree.

After approval, implement each check with its test, apply its fixes or its baseline, run the project's lint and test commands, and only then remove its prose, under the conditions in "Never". One commit per rule holds its check, its test, its fixes or baseline, and the prose removal, so a reviewer reads one rule's fixes at a time and one revert takes the rule out whole.

Then update the intake entries: after a check lands, set `baked: <check> (<PR URL or commit>)` on every entry carrying the slug. When you decline because no tool can express it, or the check is not worth its cost, set `Class: prose` and keep `open`, with the reason in `History`, so `/bonsai:feed` can still propose the prose. Set `rejected: <reason>` only when the rule itself is wrong or already enforced. Append a dated `History` line either way.
