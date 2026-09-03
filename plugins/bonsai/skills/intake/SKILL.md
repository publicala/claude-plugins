---
name: intake
description: >
  Records one pull request's review threads as local evidence for feed and bake. Run after a review round with the PR number or URL, `--export` to share candidates through the repo. Never commits, never touches the threads.
user-invocable: true
disable-model-invocation: true
---

Judge every review thread against one question: **which CLAUDE.md line or automated check would have prevented this?** A finding with no such answer is not evidence for bonsai, however valid it was as a review comment. The goal is a small set of verified candidates that feed and bake can act on once the same mistake recurs.

Throughout, "record" means writing an entry file. Proposing rules is feed's job. Wiring checks is bake's job.

## Storage

Entries live under `~/.claude/bonsai/intake/<repository key>/pr<number>.md`, outside every repository. Review threads quote customer names, internal service names, and unreleased design, so the ledger never leaves the machine. With `--export`, the candidate sections alone (rule text, target, symbols, ratio, evidence links) are also written to `.claude/bonsai/candidates/pr<number>.md` inside the target repository, uncommitted, so the team's recurrence count is shared. Before exporting, check that no candidate's `Mistake` or `Rule` names a customer, a person, or a system that the target repository does not itself name.

The repository key, the file layout, and what a rerun may change are defined once in [../../references/intake-entry.md](../../references/intake-entry.md) (relative to this skill's directory). Read it before writing anything.

`<repository key>` is the repository the candidate targets, which is not always the repository under review: a review on a client library can surface a rule for its host application. Write each candidate under its target, so feed run there finds it.

## The intake, in order

### 1. Gather

Resolve the PR from the argument (a number resolves against the repository key of the current directory). Read the PR body, the final base-to-head diff (`gh pr diff`), and the merge state (`gh pr view --json state,mergedAt`). Inline review threads and their resolved state are GraphQL-only: query `reviewThreads` with `isResolved`, `isOutdated`, `path`, and each thread's comments, paging with `after` until `hasNextPage` is false. `gh pr view --comments` returns issue comments and review bodies only, so an intake built on it classifies an empty thread list. Add the review bodies and issue comments from `gh pr view --json reviews,comments` for context.

Read each whole thread before judging any comment in it. The last reviewer message decides the thread's state, and a request the reviewer later withdrew leaves no task.

### 2. Sweep frozen candidates

Before classifying anything, read every existing entry under the target repository key. For each candidate whose status is `frozen-until: <PR>`, check that PR's merge state with `gh`. When it has merged, re-verify the candidate's symbols against the default branch (step 4) and set it `open`, with a dated `History` line. This sweep runs on every intake, whatever PR it targets, so a frozen candidate does not depend on anyone remembering to rerun intake on the PR that froze it.

### 3. Ledger

Classify every thread, one row each, with its outcome:

- **regression**: the PR introduced or worsened the defect
- **pre-existing**: the PR exposed a defect it did not cause
- **scope**: the reviewer disputed what the PR should do, not how
- **preference**: valid code either way, the reviewer prefers one shape
- **incorrect**: the finding rests on a false premise (a cited rule that does not exist, a misread diff, a wrong claim about the framework)
- **withdrawn**: the reviewer retracted the request

The outcome column holds either the slug of the candidate the thread feeds or the reason it feeds none. On a rerun, the ledger is what tells intake which threads it already processed, so a thread appears once and only here.

### 4. Filter

Keep the threads where the fix would be a CLAUDE.md line or an automated check in some repository. Drop the rest with the reason in the ledger:

- Findings about how the review itself was done (a reviewer cited a rule that does not exist, mislabeled a pre-existing defect as a regression, or kept requesting a withdrawn change) describe the review tooling, not the codebase. They are visible in the thread when they happen.
- Findings about scope belong to the issue tracker.

A preference the codebase seems to teach already is not dropped: the loaded session's guess about what a fresh session derives is not evidence, and a wrongly skipped rule is gone for good. It becomes a `watch` candidate, and feed's probe decides.

### 5. Verify against the default branch

Verification runs against the target repository's default branch at a recorded commit, never against the PR branch. The PR may not merge, and a rule that cites code only the PR adds teaches a symbol that does not exist.

For each surviving finding, record:

- **Symbols**: every class, method, file, and config key the rule or check would name, each checked on the default branch. A symbol that exists only in the PR freezes the candidate.
- **Current code**: does the default branch comply with the rule, contradict it, or have no instance yet? Grep the governed paths and record numerator and denominator.
- **Existing coverage**: the CLAUDE.md lines, scoped rules, and enforcement surfaces (linter, static analysis, architecture tests, hooks, CI) that already govern the behavior. A rule already stated is a duplicate; a rule already enforced is noise.

### 6. Classify

Every candidate gets one class and one status.

Class:

- **bake**: a tool the repository already runs can express the check (linter rule, static analysis, architecture test, hook, CI step, agent-harness deny rule). Record the tool and the shape of the check. Bake gets the first attempt at it; intake never turns a bake candidate into prose.
- **prose**: the rule needs judgment no tool can express, or the feedback loop is too late for a check alone (see the bake skill on late feedback).

Status, in precedence order (the first that applies wins):

1. **frozen-until: \<PR URL\>**: a symbol exists only in an unmerged PR.
2. **watch**: the reviewer's request was declined or is still disputed, or the finding is a preference the codebase seems to teach. Feed reads `watch` and runs its probe.
3. **open**: everything else. A rule the default branch contradicts is `open` when the author fixed the instance and the PR merged: the code teaches the wrong pattern, so the line is the only corrective, and the recorded ratio shows feed how wrong. A contradicted rule whose fix was declined is `watch`, because the disagreement is a design decision the proposal must surface, not a convention.

Feed, bake, and audit later write `encoded`, `baked`, or `rejected`. Intake never writes those and never overwrites them.

### 7. Slug

The slug names the mistake a session makes, not the mechanism the reviewer saw: `bridge-import-outside-facade`, not `store-imports-comlink-directly`. Two findings share a slug when a fresh session would make both by ignoring the same rule, even when file, symptom, and reviewer differ. Read the slugs already present under the target key and reuse one before minting another. Recurrence is never stored: feed and bake count entries carrying the slug when they read.

### 8. Write the rule text now

Write each candidate's rule text or check shape in final form, following [../../references/rule-writing.md](../../references/rule-writing.md) (relative to this skill's directory). Feed copies this text into its proposal, so it must already be a CLAUDE.md line, not a paragraph. Never record the reviewer's wording as the rule: the correction is evidence, not phrasing.

### 9. Report

Close with a compact table: candidate slug, class, status, target file, and the count of entries under the key that share the slug. Then one line per dropped thread with its reason. Say which candidates feed or bake will pick up on their next run, which are frozen and on what, and which the sweep reopened.

## Never

- Write inside a repository except the `--export` candidate file, and never commit.
- Comment on, resolve, or react to a review thread.
- Record a candidate whose symbols were verified only on the PR branch. Freeze it.
- Turn a review finding about the reviewer or the tooling into an entry.
- Export a candidate whose text names a customer, a person, or a system the target repository does not name.
