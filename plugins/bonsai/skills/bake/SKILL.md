---
name: bake
description: >
  Converts CLAUDE.md rules into automated checks, removes the automated rules from CLAUDE.md, and verifies everything passes. Frees up agent context by replacing prose with tooling.
user-invocable: true
disable-model-invocation: true
---

Read all CLAUDE.md files in the project, along with the existing tool configurations (eslint, phpstan, pint, package.json scripts, lefthook, git hooks, GitLab CI or GitHub Actions and everything else relevant).

When the project has more than one CLAUDE.md file, fan out instead of loading them all: build the tool inventory once and hand it with one file to each clean-context agent, the root file included, then merge the verdicts in the main session. A single window holding every file blurs rules across scopes and crowds the tool configurations out of attention.

Identify rules in the CLAUDE.md files that can be turned into automated checks. Every rule we can remove is context freed up for the agent.

Before modifying any CLAUDE.md file, present a summary of:

- Which rules will be automated (and by which tool)
- Which rules will be kept (and why - e.g. requires human judgment, context-dependent)

Ask first (one AskUserQuestion) whether the user wants that summary as an interactive artifact or as plain text. For the artifact, read [../../references/decision-artifact.md](../../references/decision-artifact.md) (relative to this skill's directory) before building the page. Bake rows are one per rule with its source file and the proposed enforcement tool.

Only proceed after the user approves. Then implement the automated checks, verify everything passes, and only remove a rule from CLAUDE.md after its corresponding check passes. Passing on the current tree is not enough: confirm the check's file globs cover the affected paths and that it runs before code lands (hook or CI).

## Intake candidates

`/bonsai:intake` records check-shaped candidates (`Class: bake`) under `~/.claude/bonsai/intake/<key>/` and, when exported, under the project's `.claude/bonsai/candidates/`. Read [../../references/intake-entry.md](../../references/intake-entry.md) (relative to this skill's directory) for the key and the format. Read every `bake` candidate with `Status: open` or `watch` under this project's key, and report "no intake entries under `<path>`" when the directory is missing. Treat a candidate as a rule to automate when its slug appears in two or more source PRs, or when the user names it: a check costs CI time, false positives, and tolerance for the tool, so it earns its place the way prose does. The `Check` line names the tool and shape intake verified.

After a check lands, set `baked: <check> (<PR URL or commit>)` on every entry carrying the slug. When you decline because no tool can express it, or the check is not worth its cost, set `Class: prose` and keep `open`, with the reason in `History`, so `/bonsai:feed` can still propose the prose. Set `rejected: <reason>` only when the rule itself is wrong or already enforced. Append a dated `History` line either way.

## Implementation priority

1. **Discover existing tooling first** - inventory linters, test frameworks, static analyzers, CI pipelines, and git hooks before implementing anything
2. **Use native capabilities** - express checks through tools already in the project:
   - Linter/formatter rules (ESLint, Biome, Prettier, Pint, Ruff, gofmt)
   - Static analysis, including authoring custom rules (TypeScript strict, PHPStan strictness levels and custom PHPStan rules, mypy, Rector)
   - Architecture tests (Pest arch, ArchUnit, dependency-cruiser)
   - Structural search and lint (ast-grep) for syntax-shaped rules a stock linter cannot express (a banned call pattern, a required argument shape)
   - Git hooks (Lefthook, Husky, pre-commit)
   - CI pipeline steps
   - Agent-harness hooks (Claude Code PreToolUse deny rules) for rules about how a command is invoked (a required flag, a banned subcommand), which no linter or code check can see
3. **Custom scripts only as last resort** - only when no existing tool can express the check
4. **Wire into existing runners** - new checks must run via existing test/lint commands, not new entrypoints

## Keep prose when the feedback loop is late

A format-time auto-fix corrects violations silently, so its prose can always go. A check that fails only at suite time (architecture test, CI step) corrects the agent after the code is written. When the surrounding code mostly violates the rule, neighbors teach the wrong pattern and the agent writes the violation first, every time. Keep a one-line prose rule next to that check, noting what enforces it.
