---
name: audit
description: >
  Prunes loaded CLAUDE.md files down to the lines a fresh session cannot derive on its own, every cut backed by evidence. Use when CLAUDE.md files have grown without review, or after a stretch of feed runs (`/bonsai:feed`) (feed adds rules, bake converts them into tooling, audit prunes what remains).
user-invocable: true
disable-model-invocation: true
---

Judge every line of every in-scope CLAUDE.md against one question: **what mistake does a session make without it?** If the answer is "none", the line is inventory, not instruction. The goal is not a shorter file. The goal is a file where every line changes behavior.

Throughout the audit, "cut" means recording a cut verdict in the report. No file changes before approval, no exceptions.

## Scope and load model

Default scope is the current project: its root CLAUDE.md, nested CLAUDE.md files, and the rule files they point to. User-level and ancestor-directory files load in every project, so include them only when the user asks, and evaluate them against a session in an arbitrary project (codebase greps and CI checks do not apply to them). Exclude vendored code, build output, and worktree copies everywhere: from the inventory and from every grep.

Not everything called "referenced" is deferred. Classify each file by its load class before judging it: read [../../references/load-model.md](../../references/load-model.md) (relative to this skill's directory). Judge a scope-triggered line against a fresh session working in its scope, not against every session, and never count a move behind an `@path` import as a saving.

## Never cut

Check every line against this list before anything else. A match is a KEEP and skips the rest of the audit, with one exception: a rule the formatter rewrites silently may still fall in step 3, because the tool guarantees it.

- Safety prohibitions, as `references/load-model.md` defines them ("never force-push", "never run the seeder against a shared database")
- Gotchas that contradict appearances (the call that silently no-ops, the flag that looks optional but is not). Greps come back clean precisely because the line works, so step 4 would misread these as derivable.
- Conventions that differ from the framework or tool default, including conventions phrased with "never"
- Precedence and routing clauses
- Read-triggers for referenced docs

## The audit, in order

A file under about 40 lines gets a single pass: read it whole, apply steps 2 through 6 line by line, and present one report with no phases. Probes and the panel still decide what the steps route to them; a small file only means few candidates reach them. Above that, the steps below run as written, and every probe counts against the budget in `references/probe.md`.

### 1. Inventory

List each in-scope file with its load class and est. token cost (label every figure "est."). Include equivalent rule files other agents consume (`.cursor/rules`, `AGENTS.md` and the like) in the inventory and the dedup pass, even though edits target CLAUDE.md files. Migrating a foreign-format rule file into the project's native format is never part of an audit apply: record it as a proposal and act only on explicit user approval.

### 2. Derivability pass

Cut what a fresh session reconstructs with a few tool calls:

- Setup commands (`composer install`, `npm install`) and standard CLI usage
- Stack and version inventories (lockfiles are the source of truth)
- Directory layouts and file listings
- Model and class rosters (a `## Models` section restating what `ls` of the directory shows). A class earns a mention only where the line carries a constraint the code cannot show at a glance, and that line lives with the behavior it governs, not in a roster section
- Generic best practices ("write tests", "validate inputs", "use clear names")
- Self-referential document metadata and biography: version stamps ("**Version**: 2026-08-07"), "last updated" lines, rename history, drift-tracking clauses between files ("if the spine moves forward and this file doesn't..."), and rules phrased against the past ("previously X, now Z"). Git is the history. When the history carries a load-bearing constraint, reframe it present tense: that is a rewrite, not a cut. A date survives only when it is itself the instruction a session must apply, not a stamp about the document.

Test: delete the line and name the mistake a session in the file's scope now makes. No mistake, no line. A line that fails the test but matters in one identifiable situation moves instead of dying (see "Extract, don't delete").

The six classes above cut on sight. A cut for any other derivability claim needs a derivability probe first, run as [../../references/probe.md](../../references/probe.md) (relative to this skill's directory) prescribes: one fresh low-effort agent gets a task the line governs, in the file's scope, without the line, and whether it derives the fact or makes the mistake is the verdict. The loaded auditor has read the line and cannot un-read it, so its own guess is not evidence. A line in an always-resident file never probes clean: record that and send the candidate to the capability-floor panel instead.

Evidence must hold in the file's own scope, not just the auditing environment. A pointer that fails only where the audit runs (a tool the auditor's settings deny, a skill the auditor lacks, a URL the auditor cannot open) may work for every other consumer of the file: that is an open question for the user, never a cut backed by evidence.

### 3. Enforcement verification

Never trust a claim (yours or the file's) that "the linter handles this". Inspect every enforcement surface: formatter and linter configs, static analysis, architecture or convention tests, git hooks, CI workflows, and the project's committed `.claude/settings.json`. A surface counts only when it is committed: a hook or deny rule that lives in someone's local settings enforces nothing for teammates or CI, so a rule backed only by it is unenforced. Record which surfaces you checked per rule. Then classify each rule by its feedback loop:

- **Auto-fixed at format time**: confirm the tool's file globs cover the affected paths and that it runs before code lands (hook or CI), then cut the prose. Violations get rewritten silently, so the line prevents nothing.
- **Fails at suite time only** (architecture test, CI check): the prose can still pay for itself by preventing a write, fail, rewrite roundtrip. Leave the verdict open. Step 4 closes it: keep when neighbors teach the wrong pattern, cut when they teach the right one.
- **Unenforced**: step 4 decides, and the rule is a candidate for `/bonsai:bake`.

Expect surprises in both directions: rules believed enforced that are not, and rules believed prose-only that a formatter already fixes.

### 4. Code-gradient measurement

The codebase teaches conventions whether or not the doc repeats them. Grep before judging, scoped to the subtree the audited file governs and to first-party code only, and report numerator, denominator, and the exclusions used:

- **Compliance at 90% or above**: the code teaches the convention, a session copies its neighbors correctly. Cut.
- **Compliance at 70% or below**: neighbors teach the wrong pattern, so the line is the only corrective. Keep. (Example: 38 files import dates the required way, 125 the banned way. 23% compliant, KEEP.)
- **In between**: borderline. Step 5 decides.

A rule that names nothing greppable (commit style, PR flow, shell habits) is path-free: skip this step and send it straight to step 5.

### 5. Capability-floor panel

Docs serve the weakest model that reads them, not the strong one auditing them. A borderline block is a heading section or standalone bullet that steps 3 and 4 left undecided. Panel only those, never the whole file.

Spawn three independent low-effort agents per block. Each gets the repo path, the verbatim block, and one concrete task the block would govern, and answers: "Would this block change what you produce for this task? KEEP or CUT, one reason." Majority wins, ties are KEEP, the verdict is final.

Tell each panelist to answer the verdict only and never perform the task: a floor model handed a block will otherwise start executing it.

Separately, verify every first-party symbol an example references against the real codebase. An example that calls a method that does not exist teaches a wrong API and is worse than absence. Record it as a cut whatever the panel says, and flag it, because that drift means nobody has checked the examples in a while.

### 6. Pointer and description audit

Resolve every pointer's target first and flag the broken ones. Then judge the phrasing: a pointer carries exactly two things, the trigger (when to read) and the path. Never a content summary. Summarizing the target loads its vocabulary into every session, which defeats the deferral. Record these as rewrites.

Discriminator: does this phrase help decide WHEN to read the file (routing key, keep) or does it describe what you WILL LEARN there (content summary, cut)?

```markdown
<!-- Cut: content summary, the target's contents leak into every session -->
See docs/payments.md for the retry flow, webhook signatures, refund windows, and the idempotency-key format.

<!-- Keep: trigger + path -->
Read docs/payments.md before touching payment or refund code.
```

Exception: a fact stays in the pointer when the session needs it to pick WHICH target applies. A discriminator is routing, not summary.

The same rule governs skill frontmatter descriptions: triggers and routing keywords stay, mechanics and step lists move to the body. Safety and precedence clauses stay in the description ("never mutates remote state", "OVERRIDES the global skill") because they change the invocation decision itself.

### 7. Deduplication

State each fact once, at the smallest scope that covers its readers. When a rule repeats across files, keep the copy closest to where it applies, keep the load-bearing identifier resident (the helper name, the command), and defer the rationale to one referenced doc.

## Precise but generic

Phrasing gets judged only after a line earns its keep, against the standard in [../../references/rule-writing.md](../../references/rule-writing.md) (relative to this skill's directory). Every specific detail in a kept line (a class inventory, an enumerated list, a count) is either load-bearing, meaning generalizing it would change what a session does, or a liability that drifts as the code moves. When a kept line carries non-load-bearing specifics, record a **rewrite**: drop those specifics, keep the load-bearing identifiers verbatim, and change nothing else. A rewrite never widens scope, weakens the boundary, or adds advice, and every identifier it keeps gets verified against the codebase like any example symbol.

Two senses of "generic" live in this skill. Step 2 cuts generic best practices because they pin no boundary. Generic here means phrased at the pattern level while still pinning one. When dropping the driftable specifics would leave nothing a session cannot derive, the line was inventory all along: cut, not rewrite. Precision earns the keep, genericity makes it last.

```markdown
<!-- Rewrite: the inventory drifts as validators are added, the boundary does not -->
Our validators are EmailValidator, PhoneValidator, and VatValidator. Never write a new validator for a rule one of these already covers.

<!-- After: same boundary, load-bearing path kept, inventory dropped -->
Never write a new validator for a rule one in app/Validators already covers.
```

## Extract, don't delete

Content needed only in a specific situation moves verbatim to a referenced file, leaving a one-line read-trigger behind ("read X before doing Y"). A move must beat the pointer it leaves behind: content no longer than its read-trigger stays resident. Reuse the project's existing referenced-doc location (detect it from current pointers) instead of inventing a new one. Deletion is only for content that fails step 2 outright.

Environment-conditional content is its own extract class: sentences that bind only in some execution environments (a cloud sandbox, CI, containerized local dev). No load mechanism triggers on environment, so path scoping cannot help. The pattern is one resident discriminator line per environment naming the trigger and the doc ("cloud session? read X before running anything"), with everything conditional moved to that doc verbatim. Classifying each sentence by the environments it governs is judgement the loaded auditor shortcuts: run a classification probe (`references/probe.md`) with the single question "which execution environments does each sentence govern", and treat every section with mixed answers as an extract candidate.

## Report delivery

Before the inventory, ask one AskUserQuestion: does the user want the report as an interactive artifact or as plain text? For the artifact, read [../../references/decision-artifact.md](../../references/decision-artifact.md) (relative to this skill's directory) before building the page. Audit rows are one per verdict, grouped per file, checked by default for recommended verdicts.

## Phase the decisions, not the audit

A many-file audit produces more decisions than one sitting absorbs: objective corrections sit next to taste-level rewrites, and the review stalls where the opinions start. Keep the audit itself a single pass (verification is the expensive part, and findings interact: a false-claim fix changes the same lines a later trim rewrites). When the report carries more than about 20 decision rows, present and apply it in phases ordered by how objective the call is:

1. **Correctness** — false and stale claims. Factual, near-zero controversy, fast to approve.
2. **Dead weight** — deletions: orphan files, duplicate pointers, unreferenced scaffolding.
3. **Compression** — rewrites and cuts for token count. The user's opinions concentrate here, so the phase gets their undivided attention and the full note-field treatment.
4. **Structure** — moves, extractions, and new-file proposals: anything that changes where content lives.

Each phase is its own decision surface and its own apply, in either delivery mode: an artifact report republishes in place (same URL, a phase roadmap showing position), a plain-text report presents one phase per message with its own approval round. Land the approved phase as its own branch and PR, and only then present the next one, with its diffs regenerated against the tree the previous phase produced. A phase-1 apply edits only the affected lines in place, leaving structure and wording untouched, so no diff ever mixes a factual fix with a taste rewrite. An open question rides with the phase whose decision it gates (a question blocking a deletion belongs to the deletions phase). Below the threshold, one page holds everything as usual.

## Approval and apply

Present the full report before editing anything; a phased report satisfies this per phase, presenting each phase's findings in full before that phase's edits, with later phases following as earlier ones land. Per finding: the verdict (cut, keep, rewrite, move, defer), the exact text affected, and the evidence (surfaces checked, grep ratio, panel vote). Approval arrives item by item: from the artifact's saved state (or its pasted export) when the report is an artifact, from AskUserQuestion otherwise. Only edit after approval, and approval to edit is not approval to publish: confirm separately before creating commits, branches, or PRs.

- **Checked-in files**: granular commits, one concern per commit, on a branch cut from the default branch with a clean tree (stop and ask if the tree is dirty), with a PR, so reviewers judge each cut in isolation.
- **Local files** (user-level memory, `CLAUDE.local.md`): edit directly, back up first.

After applying, re-resolve every pointer you touched. Close the report with before and after est. token totals per file, listing deferred (moved) tokens separately from deleted ones.
