---
name: feed
description: >
  Turns recurring corrections (conversation, intake entries, recent commits) into CLAUDE.md rules. Run after a working session or a review round.
user-invocable: true
disable-model-invocation: true
---

Judge every recurring correction against one question: **which CLAUDE.md line would have prevented it?** A correction asked for once is an incident. Asked for twice, or accepted in review and verified, it is a pattern, and a pattern with no line yet is the gap this skill closes. The goal is a small set of rules a fresh session would have broken without them.

Throughout, "propose" means recording a candidate in the report. No file changes before approval, no exceptions.

## Scope

Writes land only in CLAUDE.md files and path-scoped rule files (`.claude/rules/*.md`) inside the current project tree, plus the status line and `History` of intake candidates this run encoded, local or exported. Never write to `~/.claude/` (global skills, settings, user memory), to `~/.claude/projects/*/memory/` (auto-memory is read-only input), or to any path outside the project root.

## Never propose

Check each candidate against this list before anything else:

- A rule an existing CLAUDE.md line already states, or near-states. Drop it.
- A style preference a linter or formatter in the repo already enforces. Drop it.
- A one-off correction that looks situational. Drop it.
- Anything a fresh session derives with a few tool calls (setup commands, stack inventories, directory layouts), or a convention the codebase demonstrates nearly everywhere. These two are claims about what a fresh session does, and the loaded model making them has already read everything it claims that session would derive. Before skipping for either, run a derivability probe as [../../references/probe.md](../../references/probe.md) (relative to this skill's directory) prescribes: the task that surfaced the pattern, without the rule. The probe decides the skip. A wrongly written rule gets pruned by a later audit, a wrongly skipped one is gone for good, so the probe guards the skip side.

## The pass, in order

### 1. Gather signals

Read the sources in priority order. Explicit intent outranks inference:

1. **Current conversation corrections**: direct "no, do it like X", "stop doing Y", "always do Z".
2. **Intake entries**: a reviewer's correction the author accepted, with symbols verified and a compliance ratio measured. See "Intake entries" below.
3. **Recent commit diffs**: the same kind of change recurring (parameter ordering, error-handling shape, test layout, commit-message style).
4. **Auto-memory feedback files**: `feedback*.md`, and any file with `type: feedback` in its frontmatter, under `~/.claude/projects/*/memory/`, in both the user-home-encoded and the project-cwd-encoded directories when present. Prior corrections at lower confidence: they may be stale. Skip silently when none exist.
5. **Existing CLAUDE.md files**: for deduplication and for picking a rule's home, never as a source of rules.

### 2. Cluster

Group what recurs into candidate rules: the same correction asked for twice, the same edit across commits, the same nit, the same naming or style choice, the same architectural decision applied repeatedly. One candidate per class of mistake, not per incident.

### 3. Route

For each candidate, decide whether a tool could enforce it instead (lint, static analysis, architecture test, CI, hook). If so, the proposal is a deferral to `/bonsai:bake`, not prose. `Class: bake` intake candidates always route there.

### 4. Place

Default to the smallest scope that still captures the rule, and promote to root only when the rule genuinely cuts across the project:

- React component pattern → `src/components/CLAUDE.md`
- Eloquent model convention → `app/Models/CLAUDE.md`
- Test layout rule → `tests/CLAUDE.md`
- Commit message style → root `CLAUDE.md`
- Cross-cutting safety rule ("never log PII") → root `CLAUDE.md`
- Convention binding one file pattern across directories (`**/*.blade.php`) → `.claude/rules/<topic>.md`, but only when intake recorded that target. Otherwise write to the nearest CLAUDE.md and let `/bonsai:split` move it: placement by file pattern is split's call, with its load-path check.

### 5. Write the rule text

Write each proposal in final form, following [../../references/rule-writing.md](../../references/rule-writing.md) (relative to this skill's directory). For an intake candidate, copy its `Rule` text and re-verify every symbol it names against the current tree: `verified_on` may be stale.

## Intake entries

`/bonsai:intake` records verified evidence from PR reviews under `~/.claude/bonsai/intake/<key>/` and, when exported, under the project's `.claude/bonsai/candidates/`. Read [../../references/intake-entry.md](../../references/intake-entry.md) (relative to this skill's directory) for the key, the format, and how recurrence is counted. Then:

- Read every candidate with `Status: open` or `Status: watch` under this project's key. Report "no intake entries under `<path>`" when the directory is missing, never skip silently.
- Propose a candidate when its slug appears in two or more source PRs, or when the user names it. One PR is an incident, two are a pattern. A `watch` candidate goes through the derivability probe (see "Never propose") before it is proposed or skipped.
- After writing an approved rule, set `encoded: <rule path> (<PR URL or commit>)` on every entry carrying that slug and append a dated `History` line to each.

## Approval and apply

Propose each rule through AskUserQuestion with the exact rule text, the suggested target path (the user may pick another), and, where step 3 applies, the defer-to-bake option. When the list is longer than AskUserQuestion comfortably carries, first ask whether the user wants the proposals as an interactive artifact instead. For the artifact, read [../../references/decision-artifact.md](../../references/decision-artifact.md) (relative to this skill's directory) before building the page. Feed rows are one per candidate with its exact rule text and target path, the note field taking rewordings.

Only write after approval. Create the target file if it does not exist, and append under a heading that matches its existing structure. Then update the intake entries the run encoded.
