---
name: split
description: Moves CLAUDE.md rules to the load scope of the sessions they govern (nested files, path-scoped rules, or root). Run after an audit, or when a resident file carries rules that bind one area.
user-invocable: true
disable-model-invocation: true
---

# Split

Judge every rule of every in-scope CLAUDE.md against one question: **which sessions does this rule govern?** A resident rule that governs one subtree taxes every other session for nothing, and a scoped rule that governs the whole project is missing from most sessions that need it. The goal is placement: every rule loads in the sessions it governs, and in no others.

Throughout, "demote" and "promote" mean recording a verdict in the report. No file changes before approval, no exceptions.

This skill decides where rules live. Whether they live is `/bonsai:audit`'s call: leave a rule that looks cuttable where it is and refer it to the audit. Run split after an audit, so placement work is spent only on lines that earned their keep.

## Scope

Default scope is the current project tree. Writes only ever land in the project's CLAUDE.md files and `.claude/rules/` files. User-level and ancestor-directory files are out of scope in both directions: they load in every project, so no in-project placement can host their content.

## Audit first

Placing lines an audit would cut wastes the pass, and its probes are the costly part. So after the inventory, and before any grep or probe, check whether the audit is obviously due. It is when both hold:

- **No finished audit since the files changed**: `~/.claude/bonsai/runs/<key>/` holds no `audit-*.json`, the newest one still holds changes at `proposed`, `waiting` or `later` ([../../references/rounds.md](../../references/rounds.md)), or a resident file changed after it: a commit since its date (`git log --since=<its date> -- <file>`) or an uncommitted change (`git status --porcelain -- <file>`). `<key>` is the repository key from [../../references/intake-entry.md](../../references/intake-entry.md). Both reference paths are relative to this skill's directory.
- **A bloat sign**: a resident file carries more than 5,000 est. tokens. Above 2,000 est. tokens, one of its sections carrying more than a third of the file's also counts, and so do sections that mostly explain how a feature works where a rule would state what to do. A smaller file has too few sections for a share to mean anything.

When both hold, stop and ask one AskUserQuestion that names the numbers: "CLAUDE.md is est. 14.2k tokens, unaudited since 40 commits, and one section holds 54% of it." Add the probe history when it predicts the result: the session reads through the shell, and an earlier split run in that harness mode (`~/.claude/bonsai/runs/*/*/split-*.json`, its `context.harness_mode`) kept every candidate it probed. Say so in one line: demotions here are unlikely to pass, so the probes would mostly confirm the file stays as it is. Offer two options:

- **Run /bonsai:audit first** (recommended): the run ends with the command to type, since the audit starts only on the user's command. Its detail line says the split then places only what survives.
- **Split anyway**: the pass continues, and the closing report opens with the recommendation again.

A `--headless` run asks nothing: it continues and opens the PR body with the recommendation. Record the check in the run file as `audit_first`, with both signals and the answer, and the harness mode the session reads in as `context.harness_mode`, so a later run can read the probe history.

## Load model

Placement chooses among the load classes in [../../references/load-model.md](../../references/load-model.md) (relative to this skill's directory): always resident, nested CLAUDE.md, or path-scoped rule. Read it before the pass. Every demotion verdict hangs on the triggers it describes: a scoped file loads on a file-tool touch or a plain shell read, and on nothing else.

## Never demote

Check each rule against this list before measuring its scope. A match stays resident whatever the measurements say.

- Safety prohibitions, as `references/load-model.md` defines them narrowly. This holds even when every file the rule names lives in one directory: the grep says demote, this list says stay. A convention phrased with "never" goes through the normal pass.
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

- Reading, editing or creating an in-scope file through the file tools: demote. The scoped file arrives right after the first Read, Write or Edit in its scope (`references/load-model.md`), so a session that writes the first file without the rule sees it before its next step and corrects that file.
- Acting on in-scope paths only through shell or git (a generator, `sed -i`, `git mv`, running a command): nothing loads. For these rules no verdict exists until a load-path probe runs, as [../../references/probe.md](../../references/probe.md) (relative to this skill's directory) prescribes: one fresh low-effort agent gets the task that would commit the mistake, in the real repo, without mention of the rule. The scoped file loads before the mistake: demote. It acts first, or reads only in shapes that load nothing: the rule stays resident. Run the probe in the harness mode the team works in: a mode that reads through the shell loads a scoped file only on plain reads, and a demotion probed in another mode is untested for it. The author guessing whether sessions read first is the same simulation the probe replaces.

### 4. The other direction

For each rule already in a scoped file, run step 2's grep from that file's viewpoint. Governed paths outside the file's subtree or globs mean the rule outgrew its home: promote it to the smallest target that covers every governed path (a wider glob, an ancestor directory's CLAUDE.md, or root). Promotions pass through "Never demote" in reverse trivially: widening a rule's audience is always load-safe.

Flag orphans while there: a nested CLAUDE.md whose directory no longer holds first-party files, or a path-scoped rule whose globs match nothing. Deletion verdicts belong to `/bonsai:audit`, so record orphans as flags.

### 5. Approval and apply

Read [../../references/decision-memory.md](../../references/decision-memory.md) (relative to this skill's directory) before routing, then pick the delivery as [../../references/decision-artifact.md](../../references/decision-artifact.md) prescribes under "Delivery". For the page, build it with the renderer that reference names. Each demotion or promotion is one `move` change: an edit that removes the rule from its source and an edit that inserts it in the destination, with the governed paths and the load-path result as evidence. Route it:

- A demotion the edit rule or a load-path probe settled, and every promotion: **ready**, one group per destination file.
- A move that drops a scope qualifier the destination expresses gets a meaning check (`references/probe.md`) on that edit. A drift makes it a **call**.
- A rule that stays resident: `kept`, with the reason. Flags and skill candidates: questions or `kept` items.

Present each round in full before editing anything, in rounds as [../../references/rounds.md](../../references/rounds.md) (relative to this skill's directory) prescribes. Per rule: the verdict (demote, promote, keep, flag), the destination, and the evidence (governed paths, load-path result). Only edit after approval, and apply as `references/rounds.md` prescribes: one commit per destination file. Close with est. resident tokens per session before and after, listing separately what every session pays and what only in-scope sessions pay.

After applying, verify that each scoped file the edits created or re-globbed actually loads: one marker probe per created or changed glob, run as `references/probe.md` prescribes. A valid glob loads the rule and hides a malformed neighbor, so one file never vouches for the globs that did not select it. The phrase comes back: the glob fires. NONE twice: the placement is broken, and the move reverts until the globs are fixed.

## Moves are verbatim

A moved rule keeps its exact text. The only permitted edit is deleting a scope qualifier the destination now expresses: "In tests/, never use RefreshDatabase" becomes "Never use RefreshDatabase" inside `tests/CLAUDE.md`. Phrasing improvements belong to `/bonsai:audit`.

A demotion leaves nothing behind. The scoped file loads automatically, so a pointer at root would rebuild the cost the move removed. Create the destination file if it is missing, and append under a heading that matches its existing structure.

## Skill candidates

Content shaped as a procedure (a numbered workflow, a deploy guide, a checklist walked start to finish) belongs in a skill body. Flag it with a proposed skill name and stop there. Writing skills is a different job with its own standards.
