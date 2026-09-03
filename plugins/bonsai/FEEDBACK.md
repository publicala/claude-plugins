# bonsai: general feedback on the skills

Scope: the four skills on `main` at 10ec2e3 (`feed`, `bake`, `audit`, `split`), the shared reference, and the `intake` skill proposed in [#6](https://github.com/publicala/claude-plugins/pull/6). Method: the `audit` skill's own lens turned on the skill text (every line judged by the mistake a session makes without it, pointers resolved, duplicates traced, evidence over the reviewer's guess), plus one clean-context dry run of `intake` on #6 with a fresh Sonnet agent. This file is a discussion vehicle for inline comments, not content for the plugin: close the PR after discussion, or split accepted items into their own PRs.

## What works

- Each skill opens on one question (what mistake, which sessions, which line would have prevented this) and every verdict is a recorded proposal until approval. That framing is the plugin's best idea and it holds across skills.
- Evidence rules are concrete: numerator and denominator on greps, surfaces checked per rule, panel votes, load-path probes with a rerun before any revert.
- The asymmetry argument in `feed` ("a wrongly written rule gets pruned by a later audit, a wrongly skipped one is gone for good, so the probe guards the skip side") is sharp and correctly placed.
- "Extract, don't delete", "moves are verbatim", "precise but generic", and the environment-conditional extract class are all non-obvious and all right.
- The eval plans say "not built" instead of pretending.

## 1. The plugin breaks its own duplication rule

The repo README says shared content lives once under `references/`. Audit step 7 says state each fact once, at the smallest scope that covers its readers. The skills do neither, and #6 shows what happens when the same fact lives in three files: the bake fix in 45214ac changed the decline semantics in two places and left a third (`feed` line 37) describing a state that no longer exists. Token cost is not the argument here, since a skill body is deferred content in the audit's own load model; drift is.

### 1.1 The artifact pointer summarizes its target, four times

`feed` 25, `bake` 20, `audit` 130–135 and `split` 67 each restate the decision artifact: "a live doc (`capabilities: {artifact: {}}`) ... an approve checkbox ... a free-text input ... a copy-decisions control as the fallback path back into the session". That is audit step 6's anti-pattern (a pointer that describes what you will learn there) applied to the plugin's own reference. `references/decision-artifact.md` owns those mechanics. Each skill needs one sentence: "Ask once whether the user wants the report as an artifact or plain text; for the artifact, read `references/decision-artifact.md`", plus only what a row holds for that skill (one per rule, one per verdict).

### 1.2 The rule-writing standard lives in two places, three with #6

`feed` "Rule writing" (71–80) and `audit` "Precise but generic" (108–120) are the same doctrine in two phrasings, and `audit` 48 and `feed` 80 carry the same metadata list nearly verbatim ("version stamps, 'last updated' lines, rename history, drift-tracking clauses between files, rules phrased against the past"). #6 adds a third copy in `intake` step 7, already thinner than the others (the "one short paragraph" bound is missing, and the dry run produced 60-word rules). Move it to `references/rule-standard.md`; `feed`, `audit`, and `intake` point at it.

### 1.3 The clean-context probe is defined four times

`audit` 52–56, `feed` 57, `split` 57 and 71, and `intake` 58 each explain that the loaded model cannot un-read what it read, that one fresh low-effort agent gets the task without the line, and that the probe's outcome is the verdict. The validity conditions are scattered: the resident-file caveat is only in `audit` 54, "answer the verdict only, never perform the task" only in `audit` 82, "search your entire context, not just the file" and "rerun once before judging a NONE" only in `split` 71. Every skill that probes needs all of them. One `references/probe.md` with the definition and the validity rules; each skill then states only the question its probe answers.

### 1.4 The load model is defined twice, with different taxonomies

`audit` 17–21 has always-resident, scope-triggered, deferred. `split` 19–27 has always-resident, nested CLAUDE.md, path-scoped rules. Split's version has no "deferred" class; audit's folds nested and path-scoped together. The compaction asymmetry (root re-injects after compaction, scoped files return only on the next in-scope read) is stated only in `split` 27 and matters to audit's judgement of scope-triggered files just as much. One reference, four classes, the compaction note included.

### 1.5 The lifecycle block

Four copies on `main`, six with #6, plus the one-sentence form in `plugin.json` and `marketplace.json`. Covered in the #6 review: the README keeps it, the skill bodies drop it. Adding a skill should touch the skill, the README, and the two manifests, not nine files.

### 1.6 "Safety prohibition" has two definitions

`audit` "Never cut" and `split` "Never demote" both protect safety prohibitions, but split defines the term narrowly (harm lands outside the working tree the moment the action runs) and explicitly excludes "never import Carbon\Carbon", while audit's list would keep that line under "conventions that differ from the default". Both outcomes are right for their pass; the shared term wants one definition, in the same reference as 1.3 or 1.4.

## 2. Methodology gaps

### 2.1 No budget, no small-file mode

Audit prescribes one probe per cut candidate outside the six on-sight classes, a three-agent panel per borderline block, and one clean agent for environment classification. Bake fans out one agent per CLAUDE.md file. Split runs one probe per new-file rule and one per created glob, with reruns. Nothing says how many, when to stop, or what to do on a 30-line file. A 200-line root file with 40 candidates is 40 subagents before the panel starts. Suggest a budget rule (group candidates by the task that would reveal them, so one probe tests every line that task touches; cap the count and report what was not probed) and a small-file mode (below roughly 40 lines: single pass, no panel, no phases).

### 2.2 "No probe can run clean" for resident files gives up early

`audit` 54 sends every resident-file candidate to the panel because the harness injects the audited file into every subagent. An `isolation: "worktree"` subagent reads the worktree's CLAUDE.md, so deleting the candidate line in the worktree gives a clean probe for project files; user-level and ancestor files stay unprobeable. Untested here: split 71's marker-phrase check is the way to confirm it before relying on it.

### 2.3 Shell reads never load scoped files, and some modes read everything through the shell

`split` 27 already notes that a session touching in-scope paths only through shell commands never loads a nested CLAUDE.md or a path-scoped rule. It understates the exposure: harness modes exist in which the session is told to read files with `cat` and `sed` rather than the Read tool, and in those modes every demotion split ever made is invisible for the whole session. The load-path probe in split step 3 should run in the mode the team actually works in, and the skill should say that a demotion is only safe for sessions that read through the harness's file tools.

### 2.4 "Enforced" needs to mean "committed"

`bake` counts a Claude Code PreToolUse deny rule as an enforcement surface, and `audit` step 3 accepts "runs before code lands (hook or CI)". A hook in the user's own settings enforces nothing for teammates or CI. Both skills should add the same test: a check counts as enforced only when it lives in a committed file (`.claude/settings.json`, `lefthook.yml`, the CI workflow), and a rule backed only by local settings stays prose.

### 2.5 Path-free rules in audit step 4

Split 48 says a rule that names nothing greppable (commit style, PR flow, shell habits) is path-free and stays resident. Audit step 4 measures compliance by grep for every line without saying what to do when there is nothing to grep. Say the same thing split does: a path-free rule skips step 4 and goes to the panel or to step 5's symbol check as appropriate.

## 3. Consistency and structure

### 3.1 Two skeletons

`audit`, `split`, and `intake` open with the thesis question, then "no file changes before approval", scope, the pass in order, approval and apply. `feed` and `bake` are imperative procedures ("Read all CLAUDE.md files...") with the approval gate mid-body and no thesis line. The audit/split skeleton is the better one; feed and bake would read as the same product on it.

### 3.2 Descriptions are written for a router that is off

Every skill sets `disable-model-invocation: true`, so the frontmatter description is read by a human in the slash menu, not by the model deciding whether to invoke. `audit` and `split` carry 60-word descriptions with step summaries. A menu entry wants one line: what it does and when to run it.

## 4. Tooling and evals

### 4.1 Bake the pointer check

Audit step 6 resolves every pointer. The plugin's own pointers (`[../../references/...]` in five skills) have no check. A ten-line CI step that resolves every relative Markdown link under `plugins/` and fails on a miss is the bake skill applied to this repo. The same step can assert that every `SKILL.md` frontmatter carries `name`, `description`, `user-invocable`, and `disable-model-invocation`.

### 4.2 Build one eval before adding a fifth skill

The plugin demands with/without evidence from every CLAUDE.md line and has none for its own skills. `evals/audit/PLAN.md` is the cheapest fixture and the highest value: a tiny repo with the six planted lines and an LLM grader. #6 adds a fifth "not built" plan. Building the audit eval first would also settle several claims in this file the way the plugin prefers, by probe rather than by opinion.

## 5. On #6

The review on the PR carries the detail. In short: the idea is sound, the state machine breaks (`watch` and `frozen-until` have no exit, a contradicted rule goes to the status nothing reads, one clause in feed is stale, the audit integration is unexecutable), and #6 adds a third copy of two facts section 1 already asks to consolidate. Landing 1.1 through 1.5 before or with #6 would make the fifth skill cheaper to add and the sixth cheaper still.
