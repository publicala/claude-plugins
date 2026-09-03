---
name: intake
description: >
  Turns one pull request's review threads into local evidence entries for the other bonsai skills: classifies each finding, verifies it against the target repository's default branch, and records only what could become a CLAUDE.md rule or an automated check. Use after a review round on a PR (`/bonsai:intake <PR number or URL>`). Never writes to the repository, never comments on or resolves review threads. Entries live under `~/.claude/bonsai/intake/`.
user-invocable: true
disable-model-invocation: true
---

Judge every review thread against one question: **which CLAUDE.md line or automated check would have prevented this?** A finding with no such answer is not evidence for bonsai, however valid it was as a review comment. The goal is not a complete record of the review. The goal is a small set of verified candidates that `/bonsai:feed` and `/bonsai:bake` can act on when the same mistake recurs.

Throughout, "record" means writing to the local intake directory. Intake never edits CLAUDE.md files, never commits, and never touches the pull request. Proposing rules is feed's job. Wiring checks is bake's job.

## Storage

Entries live outside every repository, under `~/.claude/bonsai/intake/<owner>/<repo>/pr<number>.md`, one file per source pull request, named by the PR alone so a rerun on another day finds the same file. Rerunning intake on the same PR refreshes the ledger and the intake-owned fields of each candidate, and keeps every status feed, bake, or audit wrote (`encoded`, `baked`, `rejected`) together with the `History` lines under it. A candidate that already carries one of those statuses is never reopened by intake, and a rerun never creates a second file for the same PR. Review threads quote customer names, internal service names, and unreleased design, so the directory is local and uncommitted by construction. Never copy an entry into a repository, a shared drive, or a chat.

`<owner>/<repo>` is the repository the candidate targets, which is not always the repository under review. A review on a client library can surface a rule for its host application. Write each candidate under its target repository, so `/bonsai:feed` run there finds it.

Read [../../references/intake-entry.md](../../references/intake-entry.md) (relative to this skill's directory) for the entry format before writing one.

## The intake, in order

### 1. Gather

Resolve the PR from the argument (a number resolves against the current repository's `origin`). Pull with `gh`: the PR body, every review and review-thread comment in chronological order, the issue-level comments, the final base-to-head diff, and the merge state. Read the whole thread before judging any comment in it: the last reviewer message in a thread decides its state, and a request the reviewer later withdrew leaves no task.

### 2. Ledger

Classify every thread. One row per thread, whatever its outcome:

- **regression**: the PR introduced or worsened the defect
- **pre-existing**: the PR exposed a defect it did not cause
- **scope**: the reviewer disputed what the PR should do, not how
- **preference**: valid code either way, the reviewer prefers one shape
- **incorrect**: the finding rests on a false premise (a cited rule that does not exist, a misread diff, a wrong claim about the framework)
- **withdrawn**: the reviewer retracted the request

Record the author's response and whether the final diff actually contains what the response claims. A reply that says "tests added" while the tests live in another PR is a finding of its own about the author, and it is recorded on the row, never inflated into a candidate.

### 3. Filter

Keep only rows where the fix would be a CLAUDE.md line or an automated check in some repository. Drop the rest from consideration with one line each in the report:

- Findings about how the review itself was done (a reviewer cited a rule that does not exist, mislabeled a pre-existing defect as a regression, or kept requesting a withdrawn change) describe the review tooling, not the codebase. They are visible in the thread when they happen. Name them in the report and record nothing.
- Findings about scope belong to the issue tracker, not to instruction files.
- Preferences become candidates only when the reviewer states them as a repository convention and the codebase does not already teach them.

### 4. Verify against the default branch

Verification runs against the target repository's default branch, never against the PR branch. The PR may not merge, and a rule that cites code only the PR adds teaches a symbol that does not exist.

For each surviving finding, record:

- **Symbols**: every class, method, file, and config key the candidate rule would name, checked on the default branch at a recorded commit. A symbol that exists only in the PR freezes the candidate (`frozen-until: <PR>`) rather than being paraphrased around.
- **Current code**: does the default branch comply with the rule, contradict it, or have no instance yet? Grep the governed paths and record numerator and denominator. A rule the code contradicts is a design decision, not a convention: it stays `watch` until the code changes or a human decides.
- **Existing coverage**: the CLAUDE.md lines, scoped rules, and enforcement surfaces (linter, static analysis, architecture tests, hooks, CI) that already govern the behavior. A rule already stated is a duplicate; a rule already enforced is noise.

The loaded intake session has read the review and cannot un-read it, so its guess about what a fresh session would derive is not evidence. When a finding looks derivable from the codebase alone, record it as `watch` and let feed's probe decide if it recurs.

### 5. Classify

Every surviving candidate gets exactly one class:

- **bake**: a tool the repository already runs can express the check (linter rule, static analysis, architecture test, hook, CI step, agent-harness deny rule). Record the tool and the shape of the check. A bake candidate never becomes prose through intake; `/bonsai:bake` gets the first attempt and records a reason when it declines.
- **prose**: the rule needs judgment no tool can express, or the feedback loop is too late for a check alone (see the bake skill on late feedback).

And one status: `open`, `frozen-until: <PR>`, `watch`, or `do-not-encode`. Feed, bake, and audit move a candidate to `encoded`, `baked`, or `rejected` later; intake never writes those and never overwrites them on a rerun.

### 6. Recurrence

A rule earns its place by recurring. Before writing, read every existing entry under the target repository's directory and match on the `mistake` slug, a short kebab-case name for the class of mistake (`system-owned-field-ruled-prohibited`, `bridge-import-outside-facade`). Reuse an existing slug when the mistake is the same class, even if the file, symptom, or reviewer differs. Set `recurrence` to the count of distinct source PRs that show it and link the earlier entries. Feed proposes a rule only when recurrence reaches two, so a slug that drifts between spellings hides the recurrence it should reveal.

### 7. Write the rule text now

Write each candidate's rule text or check shape in its final form, imperative and present tense, phrased for the class of mistake rather than the incident. Feed copies this text into the proposal. Verified identifiers stay exact, inventories stay out, and a `Why:` line names the constraint the code cannot show. Never record the reviewer's wording as the rule: the correction is evidence, not phrasing.

### 8. Report

Close with a compact table: candidate slug, class, status, recurrence, target file. Then one line per dropped finding with its reason. Say which candidates feed or bake will pick up on their next run in that repository, and which are waiting on a merge or a second occurrence. Do not propose CLAUDE.md edits here.

## Never

- Write inside a repository, or commit anything.
- Comment on, resolve, or react to a review thread.
- Record a candidate whose symbols were verified only on the PR branch.
- Turn a review finding about the reviewer or the tooling into an entry.
- Paraphrase a candidate around a symbol that does not exist yet. Freeze it.

## The lifecycle

- `/bonsai:intake` records verified evidence from PR reviews
- `/bonsai:feed` adds rules from observed patterns, intake entries included
- `/bonsai:bake` converts crystallized rules into tooling and removes the prose
- `/bonsai:audit` prunes and verifies what remains
- `/bonsai:split` moves what remains to the scope that reads it

Run `intake` after each review round, `feed` after a working session, `bake` once enough rules have accumulated to be worth automating, `audit` when CLAUDE.md files have grown without review, and `split` after an audit leaves a resident file carrying rules that govern one area.
