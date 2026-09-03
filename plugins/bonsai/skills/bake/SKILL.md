---
name: bake
description: >
  Converts CLAUDE.md rules into automated checks and removes the prose once the check runs before code lands. Run once enough rules have accumulated to be worth automating.
user-invocable: true
disable-model-invocation: true
---

Judge every CLAUDE.md rule against one question: **which tool could enforce this before code lands?** A rule a committed check enforces is context spent on nothing, because the violation never reaches review. The goal is a file where every remaining line needs judgment no tool can express.

Throughout, "automate" means recording a proposal in the report. No config edits and no CLAUDE.md edits before approval, no exceptions.

## Scope

Every CLAUDE.md file in the project and every enforcement surface it already has: linters and formatters, static analysis, architecture tests, package scripts, git hooks, CI workflows, and the project's committed `.claude/settings.json`. When the project has more than one CLAUDE.md file, fan out instead of loading them all: build the tool inventory once and hand it with one file to each clean-context agent, the root file included, then merge the verdicts in the main session. A single window holding every file blurs rules across scopes and crowds the tool configurations out of attention.

## Never

- Remove a rule's prose before its check passes on the current tree, covers the affected paths with its file globs, runs before code lands (hook or CI), and lives in a committed file. A check that exists only in a user's local settings enforces nothing for teammates or CI.
- Add a new entrypoint. New checks run through the existing test and lint commands.
- Write a custom script while an existing tool can express the check.

## The pass, in order

### 1. Inventory the tooling

List the enforcement surfaces present, with the paths each one covers. Everything later is expressed through them, in this order of preference:

1. Linter and formatter rules (ESLint, Biome, Prettier, Pint, Ruff, gofmt)
2. Static analysis, including custom rules (TypeScript strict, PHPStan levels and custom rules, mypy, Rector)
3. Architecture tests (Pest arch, ArchUnit, dependency-cruiser)
4. Structural search and lint (ast-grep) for syntax-shaped rules a stock linter cannot express (a banned call pattern, a required argument shape)
5. Git hooks (Lefthook, Husky, pre-commit) and CI pipeline steps
6. Agent-harness hooks (Claude Code PreToolUse deny rules in the project's committed `.claude/settings.json`) for rules about how a command is invoked (a required flag, a banned subcommand), which no linter or code check can see
7. A custom script, only when nothing above can express the check

### 2. Classify each rule

For every rule, record either the tool and the shape of the check that enforces it, or why it stays prose: it needs human judgment, or it is context-dependent, or its feedback loop is too late (see "Keep prose when the feedback loop is late").

### 3. Read the intake candidates

`/bonsai:intake` records check-shaped candidates (`Class: bake`) under `~/.claude/bonsai/intake/<key>/` and, when exported, under the project's `.claude/bonsai/candidates/`. Read [../../references/intake-entry.md](../../references/intake-entry.md) (relative to this skill's directory) for the key and the format. Read every `bake` candidate with `Status: open` or `watch` under this project's key, and report "no intake entries under `<path>`" when the directory is missing. Treat a candidate as a rule to automate when its slug appears in two or more source PRs, or when the user names it: a check costs CI time, false positives, and tolerance for the tool, so it earns its place the way prose does. The `Check` line names the tool and shape intake verified.

### 4. Approval and apply

Present the full report before touching anything: which rules will be automated and by which tool, which stay prose and why. Ask first (one AskUserQuestion) whether the user wants that report as an interactive artifact or as plain text. For the artifact, read [../../references/decision-artifact.md](../../references/decision-artifact.md) (relative to this skill's directory) before building the page. Bake rows are one per rule with its source file and the proposed enforcement tool.

After approval, implement each check, verify it passes, and only then remove its rule from CLAUDE.md, under the conditions in "Never". Then update the intake entries: after a check lands, set `baked: <check> (<PR URL or commit>)` on every entry carrying the slug. When you decline because no tool can express it, or the check is not worth its cost, set `Class: prose` and keep `open`, with the reason in `History`, so `/bonsai:feed` can still propose the prose. Set `rejected: <reason>` only when the rule itself is wrong or already enforced. Append a dated `History` line either way.

## Keep prose when the feedback loop is late

A format-time auto-fix corrects violations silently, so its prose can always go. A check that fails only at suite time (architecture test, CI step) corrects the agent after the code is written. When the surrounding code mostly violates the rule, neighbors teach the wrong pattern and the agent writes the violation first, every time. Keep a one-line prose rule next to that check, noting what enforces it.
