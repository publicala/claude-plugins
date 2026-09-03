---
name: split
description: >
  Moves CLAUDE.md rules to the load scope of the sessions they govern: demotes always-resident rules that bind one subtree or one file pattern into nested CLAUDE.md files or path-scoped rules, promotes scoped rules that outgrew their file, and flags orphaned scoped files. Use when a resident CLAUDE.md grows past about 200 lines, when the root file accumulates rules that only apply to one area, or after an audit run (`/bonsai:audit`).
user-invocable: true
disable-model-invocation: true
---

Judge every rule of every in-scope CLAUDE.md against one question: **which sessions does this rule govern?** A resident rule that governs one subtree taxes every other session for nothing, and a scoped rule that governs the whole project is missing from most sessions that need it. The goal is placement: every rule loads in the sessions it governs, and in no others.

Throughout, "demote" and "promote" mean recording a verdict in the report. No file changes before approval, no exceptions.

This skill decides where rules live, never whether they live. A rule that looks cuttable gets deferred to `/bonsai:audit`, not moved. Run split after an audit, so placement work is spent only on lines that earned their keep.

## Scope

Default scope is the current project tree. Writes only ever land in the project's CLAUDE.md files and `.claude/rules/` files. User-level and ancestor-directory files are out of scope in both directions: they load in every project, so no in-project placement can host their content.

## Load model

Placement chooses among three load classes:

- **Always resident**: the root CLAUDE.md, ancestor and user-level files, and anything they pull in with `@path` imports. Full price in every session.
- **Nested CLAUDE.md** (`<subdir>/CLAUDE.md`): loads when the session reads a file under that directory, then stays for the session. Scopes by subtree.
- **Path-scoped rules** (`.claude/rules/<topic>.md` with `paths` globs in the frontmatter): load when the session reads a file matching a glob. The only class that scopes by file pattern across directories.

The trigger for both scoped classes is a read, and only a read. A session that creates a new in-scope file without reading a neighbor first, or that touches in-scope paths only through shell commands, never loads the scoped file. Edits are covered because an edit requires a prior read. Every demotion verdict hangs on this fact. Compaction adds a second asymmetry: the root file is re-injected after a compaction automatically, while scoped files return only on the next in-scope read.

## Never demote

Check each rule against this list before measuring its scope. A match stays resident whatever the measurements say.

- Safety prohibitions, narrowly defined: rules guarding actions whose harm lands outside the working tree the moment the action runs (data loss, mutating a shared or production system, publishing, deleting history). Review cannot catch these, and the action is rarely gated behind reading one subtree, so the scoped copy can be absent at the moment it matters. This holds even when every file the rule names lives in one directory: the grep says demote, this list says stay. A convention phrased with "never" is not a safety prohibition: "Never import Carbon\Carbon" bans a pattern a reviewer catches in the diff, and it goes through the normal pass.
- Precedence and routing clauses, and read-triggers for referenced docs. They exist to route sessions that have not read anything yet.

## The pass, in order

### 1. Inventory

List each in-scope file with its load class and est. token cost (label every figure "est."). Include `.claude/rules/*.md` files with their `paths` globs resolved against the tree.

### 2. Scope evidence

For each rule in an always-resident file, grep the first-party paths the rule binds: the files where following or violating it is possible. Use the subjects the rule itself names (a class, a directory, an extension, an API). Report the paths found, and let them decide the shape:

- Every governed path under one directory: subtree-shaped, destination `<subdir>/CLAUDE.md`.
- Governed paths span directories but match one or two globs: glob-shaped, destination a path-scoped rule file.
- The rule names nothing greppable (commit style, PR flow, shell habits): path-free, stays resident.

The grep is the verdict on shape. The author's sense of where a rule "belongs" is not evidence.

### 3. Load-path check

A demotion only works if the scoped file is loaded by the time the rule matters. Name the mistake the rule prevents, then classify the action that commits it:

- Editing an existing in-scope file: demote. The harness refuses an edit without a prior read in the session, and the read loads the scoped file.
- Creating a new in-scope file, or acting on in-scope paths through shell or git: the read trigger can miss. For these rules no verdict exists until a load-path probe runs. Give one fresh low-effort agent the task that would commit the mistake, in the real repo, without mentioning the rule, and record from its tool calls whether it reads an in-scope file before the point where the mistake happens. It reads first: demote. It acts without reading: the rule stays resident. The probe's outcome is the verdict. The author guessing whether sessions read first is the same simulation the probe replaces.

### 4. The other direction

For each rule already in a scoped file, run step 2's grep from that file's viewpoint. Governed paths outside the file's subtree or globs mean the rule outgrew its home: promote it to the smallest target that covers every governed path (a wider glob, an ancestor directory's CLAUDE.md, or root). Promotions pass through "Never demote" in reverse trivially: widening a rule's audience is always load-safe.

Flag orphans while there: a nested CLAUDE.md whose directory no longer holds first-party files, or a path-scoped rule whose globs match nothing. Deletion verdicts belong to `/bonsai:audit`, so record orphans as flags, not cuts.

### 5. Approval and apply

Ask at the start of the pass, one AskUserQuestion: does the user want the report as an interactive artifact or as plain text? The artifact is a live doc (`capabilities: {artifact: {}}`): one row per rule with its repo-relative source and destination paths, an approve checkbox per verdict, a free-text input per open question, per-file diffs of the proposed moves (drafted in scratchpad, doubling as the apply source), and a copy-decisions control as the fallback path back into the session.

Present the full report before editing anything. Per rule: the verdict (demote, promote, keep, flag), the destination, and the evidence (governed paths, load-path result). Only edit after approval, on a branch with a PR for checked-in files. Close with est. resident tokens per session before and after, listing separately what every session pays and what only in-scope sessions pay.

After applying, verify that each scoped file the edits created or re-globbed actually loads: one probe per created or changed glob, each a fresh low-effort agent that reads one file matched by that glob and quotes every context line containing a marker phrase unique to the scoped file. One file cannot vouch for the globs that did not select it: a valid glob loads the rule and hides a malformed neighbor. Tell each agent explicitly to search its entire context window and not just the file it read: asked about "the file", an agent answers about the file alone and returns a false NONE. The phrase comes back: the glob fires. NONE comes back: rerun that probe once before judging, since self-report probes return false NONEs at a measurable rate even with correct phrasing. NONE twice: the placement is broken, and the move reverts until the globs are fixed.

## Building the decision artifact

Read [../../references/decision-artifact.md](../../references/decision-artifact.md) (relative to this skill's directory) before building the artifact page.

## Moves are verbatim

A moved rule keeps its exact text. The only permitted edit is deleting a scope qualifier the destination now expresses: "In tests/, never use RefreshDatabase" becomes "Never use RefreshDatabase" inside `tests/CLAUDE.md`. Phrasing improvements belong to `/bonsai:audit`.

A demotion leaves nothing behind. The scoped file loads automatically, so a pointer at root would rebuild the cost the move removed. Create the destination file if it is missing, and append under a heading that matches its existing structure.

## Skill candidates

Content shaped as a procedure (a numbered workflow, a deploy guide, a checklist walked start to finish) belongs in a skill body, not in any CLAUDE.md. Flag it with a proposed skill name and stop there. Writing skills is a different job with its own standards.
