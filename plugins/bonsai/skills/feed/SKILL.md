---
name: feed
description: >
  Surfaces recurring patterns in recent commits and in-session corrections, proposes them as new CLAUDE.md rules in the right file, and writes them only after approval. The inverse of the bake skill (`/bonsai:bake`).
user-invocable: true
disable-model-invocation: true
---

Read recent git history (commits + diffs), the current conversation's user corrections and feedback, the intake entries recorded for this repository (see below), and all existing CLAUDE.md files in the project.

Cluster recurring patterns into candidate rules. A pattern is anything that recurs: the same correction asked for twice, the same kind of edit across multiple commits, the same nit, the same naming or style choice, the same architectural decision applied repeatedly.

For each candidate, decide:

- Whether it duplicates an existing CLAUDE.md rule (drop)
- Whether it would be better expressed as a tooling check (lint, static analysis, CI, hook) — if so, propose deferring to `/bonsai:bake` instead of writing prose
- Which CLAUDE.md file it belongs in: a scoped subdir (preferred when the pattern only applies there) or root (only when the rule genuinely cuts across the project)

Use `AskUserQuestion` to propose each rule with:

- The exact rule text
- The target file path (suggested; let the user pick another)
- Optionally: defer-to-bake instead of writing prose

When the candidate list is long (more than AskUserQuestion comfortably carries), first ask whether the user wants the proposals as an interactive artifact instead: a live doc (`capabilities: {artifact: {}}`) listing each candidate with its exact rule text, repo-relative target path, an approve checkbox, and a free-text input for rewording, plus a copy-decisions control as the fallback path back into the session.

Only write after approval. Create the target file if it does not exist. Append under an appropriate heading; never duplicate or near-duplicate an existing rule.

## Building the decision artifact

Read [../../references/decision-artifact.md](../../references/decision-artifact.md) (relative to this skill's directory) before building the artifact page.

## Signal priority

1. **Current conversation corrections** — strongest. Direct "no, do it like X" / "stop doing Y" / "always do Z" carries explicit intent.
2. **Recent commit diffs** — next. If the same kind of change recurs (consistent param ordering, error-handling shape, test layout, commit-message style), it is a pattern.
3. **Intake entries** — verified evidence from PR reviews, recorded by `/bonsai:intake` under `~/.claude/bonsai/intake/<owner>/<repo>/` for the repository `origin` points at. Read every candidate with `Status: open`. Propose those with `Recurrence` at two or more, or any the user names explicitly (one PR is an incident, two are a pattern). Route `Class: bake` candidates to `/bonsai:bake` instead of writing prose, unless the candidate already carries `rejected` from bake with a reason. Copy the entry's `Rule` text as the proposal and re-verify every symbol it names against the current tree before writing: the entry's `verified_on` commit may be stale. After writing an approved rule, set that candidate's status to `encoded: <rule path> (<PR URL or commit>)` and append a dated line to the entry's `History`. Read [../../references/intake-entry.md](../../references/intake-entry.md) (relative to this skill's directory) for the format. Skip silently if the directory does not exist.
4. **Auto-memory feedback files** — read-only input. Look for `feedback*.md` (and any file with `type: feedback` in its frontmatter) under `~/.claude/projects/*/memory/` — both the user-home-encoded directory and the project-cwd-encoded directory if present. Treat these like prior corrections but with lower confidence (they may be older or stale). Skip silently if none exist.
5. **Existing CLAUDE.md files** — used to deduplicate and to pick the right home for new rules, not as a source of new ones.

## Scope: project files only

This skill writes **only** to CLAUDE.md files inside the current project tree. Never write to:

- `~/.claude/` — global skills, settings, or user memory
- `~/.claude/projects/*/memory/` — auto-memory files (read-only input)
- Any path outside the project root

One exception: the status line and `History` of an intake candidate under `~/.claude/bonsai/intake/` that this run encoded. Nothing else there changes. Reads from `~/.claude/projects/*/memory/` are fine; rule text only ever lands in the project's root `CLAUDE.md` or a scoped subdir `CLAUDE.md`.

## What to skip

- One-off corrections that look situational
- Style preferences already enforced by linters/formatters in the repo
- Anything a fresh session derives with a few tool calls (setup commands, stack inventories, directory layouts): inventory, not instruction
- Conventions the codebase already demonstrates nearly everywhere: a new session copies its neighbors without being told; write the rule only where the dominant pattern is the wrong one

The last two reasons are claims about what a fresh session does, and the loaded model making them has already read everything it claims that session would derive. Before skipping a candidate for either, run a clean-context probe: give one fresh low-effort agent the task that surfaced the pattern, without the rule, and record whether it makes the mistake the rule would prevent. The probe decides the skip. The other reasons are checkable directly and never probe. A wrongly written rule gets pruned by a later audit, a wrongly skipped one is gone for good, so the probe guards the skip side.

## Targeted vs root

Default to the smallest scope that still captures the rule. Promote to root only when the rule genuinely cuts across the project.

Examples:

- React component pattern → `src/components/CLAUDE.md`
- Eloquent model convention → `app/Models/CLAUDE.md`
- Test layout rule → `tests/CLAUDE.md`
- Commit message style → root `CLAUDE.md`
- Cross-cutting safety rule (e.g. "never log PII") → root `CLAUDE.md`

## Rule writing

- Lead with the rule, imperative voice
- One short paragraph, or a tight bullet list
- Add a `Why:` line when the reason is non-obvious — future-you will thank you when judging edge cases
- Match the existing CLAUDE.md voice in the file you're appending to
- Verify every symbol an example references against the real codebase: an example calling a method that does not exist teaches a wrong API and is worse than no example
- Write rules precise but generic: keep load-bearing identifiers exact, never enumerate driftable inventories (class lists, file lists, counts)
- Write the rule for the class of mistake, not the incident that revealed it: the correction that prompted a rule is evidence for it, never phrasing to copy
- Never add self-referential document metadata or biography: version stamps, "last updated" lines, rename history, drift-tracking clauses between files, rules phrased against the past ("previously X, now Z"). State the rule present tense. Git is the history, and the audit cuts these on sight

## The lifecycle

- `/bonsai:intake` records verified evidence from PR reviews
- `/bonsai:feed` adds rules from observed patterns, intake entries included
- `/bonsai:bake` converts crystallized rules into tooling and removes the prose
- `/bonsai:audit` prunes and verifies what remains
- `/bonsai:split` moves what remains to the scope that reads it

Run `intake` after each review round, `feed` after a working session, `bake` once enough rules have accumulated to be worth automating, `audit` when CLAUDE.md files have grown without review, and `split` after an audit leaves a resident file carrying rules that govern one area.
