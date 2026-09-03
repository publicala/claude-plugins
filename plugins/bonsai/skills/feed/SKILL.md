---
name: feed
description: >
  Surfaces recurring patterns in recent commits and in-session corrections, proposes them as new CLAUDE.md rules in the right file, and writes them only after approval. The inverse of the bake skill (`/bonsai:bake`).
user-invocable: true
disable-model-invocation: true
---

Read recent git history (commits + diffs), the current conversation's user corrections and feedback, the intake entries recorded for this repository (see "Intake entries" below), and all existing CLAUDE.md files in the project.

Cluster recurring patterns into candidate rules. A pattern is anything that recurs: the same correction asked for twice, the same kind of edit across multiple commits, the same nit, the same naming or style choice, the same architectural decision applied repeatedly.

For each candidate, decide:

- Whether it duplicates an existing CLAUDE.md rule (drop)
- Whether it would be better expressed as a tooling check (lint, static analysis, CI, hook) — if so, propose deferring to `/bonsai:bake` instead of writing prose
- Which CLAUDE.md file it belongs in: a scoped subdir (preferred when the pattern only applies there) or root (only when the rule genuinely cuts across the project)

Use `AskUserQuestion` to propose each rule with:

- The exact rule text
- The target file path (suggested; let the user pick another)
- Optionally: defer-to-bake instead of writing prose

When the candidate list is long (more than AskUserQuestion comfortably carries), first ask whether the user wants the proposals as an interactive artifact instead. For the artifact, read [../../references/decision-artifact.md](../../references/decision-artifact.md) (relative to this skill's directory) before building the page. Feed rows are one per candidate with its exact rule text and target path, the note field taking rewordings.

Only write after approval. Create the target file if it does not exist. Append under an appropriate heading; never duplicate or near-duplicate an existing rule.

## Signal priority

1. **Current conversation corrections** — strongest. Direct "no, do it like X" / "stop doing Y" / "always do Z" carries explicit intent.
2. **Intake entries** — a reviewer's correction the author accepted, with symbols verified and a compliance ratio measured (see "Intake entries" below). Explicit intent plus evidence, so it outranks inference from diffs.
3. **Recent commit diffs** — next. If the same kind of change recurs (consistent param ordering, error-handling shape, test layout, commit-message style), it is a pattern.
4. **Auto-memory feedback files** — read-only input. Look for `feedback*.md` (and any file with `type: feedback` in its frontmatter) under `~/.claude/projects/*/memory/` — both the user-home-encoded directory and the project-cwd-encoded directory if present. Treat these like prior corrections but with lower confidence (they may be older or stale). Skip silently if none exist.
5. **Existing CLAUDE.md files** — used to deduplicate and to pick the right home for new rules, not as a source of new ones.

## Intake entries

`/bonsai:intake` records verified evidence from PR reviews under `~/.claude/bonsai/intake/<key>/` and, when exported, under the project's `.claude/bonsai/candidates/`. Read [../../references/intake-entry.md](../../references/intake-entry.md) (relative to this skill's directory) for the key, the format, and how recurrence is counted. Then:

- Read every candidate with `Status: open` or `Status: watch` under this project's key. Report "no intake entries under `<path>`" when the directory is missing, never skip silently.
- Propose a candidate when its slug appears in two or more source PRs, or when the user names it. One PR is an incident, two are a pattern. A `watch` candidate goes through the derivability probe (see "What to skip") before it is proposed or skipped.
- Route `Class: bake` candidates to `/bonsai:bake` instead of writing prose.
- Copy the candidate's `Rule` text as the proposal and re-verify every symbol it names against the current tree: `verified_on` may be stale.
- After writing an approved rule, set `encoded: <rule path> (<PR URL or commit>)` on every entry carrying that slug and append a dated `History` line to each.

## Scope: project files only

This skill writes **only** to CLAUDE.md files and path-scoped rule files (`.claude/rules/*.md`) inside the current project tree. Never write to:

- `~/.claude/` — global skills, settings, or user memory
- `~/.claude/projects/*/memory/` — auto-memory files (read-only input)
- Any path outside the project root

One exception: the status line and `History` of intake candidates this run encoded, local or exported. Nothing else there changes. Reads from `~/.claude/projects/*/memory/` are fine; rule text only ever lands in the project's root `CLAUDE.md`, a scoped subdir `CLAUDE.md`, or a path-scoped rule file under `.claude/rules/` when the rule binds a file pattern across directories.

## What to skip

- One-off corrections that look situational
- Style preferences already enforced by linters/formatters in the repo
- Anything a fresh session derives with a few tool calls (setup commands, stack inventories, directory layouts): inventory, not instruction
- Conventions the codebase already demonstrates nearly everywhere: a new session copies its neighbors without being told; write the rule only where the dominant pattern is the wrong one

The last two reasons are claims about what a fresh session does, and the loaded model making them has already read everything it claims that session would derive. Before skipping a candidate for either, run a derivability probe as [../../references/probe.md](../../references/probe.md) (relative to this skill's directory) prescribes: the task that surfaced the pattern, without the rule. The probe decides the skip. The other reasons are checkable directly and never probe. A wrongly written rule gets pruned by a later audit, a wrongly skipped one is gone for good, so the probe guards the skip side.

## Targeted vs root

Default to the smallest scope that still captures the rule. Promote to root only when the rule genuinely cuts across the project.

Examples:

- React component pattern → `src/components/CLAUDE.md`
- Eloquent model convention → `app/Models/CLAUDE.md`
- Test layout rule → `tests/CLAUDE.md`
- Commit message style → root `CLAUDE.md`
- Cross-cutting safety rule (e.g. "never log PII") → root `CLAUDE.md`
- Convention binding one file pattern across directories (`**/*.blade.php`) → `.claude/rules/<topic>.md`, but only when intake recorded that target. Otherwise write to the nearest CLAUDE.md and let `/bonsai:split` move it: placement by file pattern is split's call, with its load-path check.

## Rule writing

Follow [../../references/rule-writing.md](../../references/rule-writing.md) (relative to this skill's directory).
