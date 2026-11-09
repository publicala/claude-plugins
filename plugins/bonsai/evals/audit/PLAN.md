# Eval plan (not built)

Fixture (scaffold_script): tiny repo whose CLAUDE.md plants one of each:

- derivable version inventory → expect CUT
- gotcha that greps clean because the rule works → expect KEEP
- rule falsely claiming linter enforcement → expect verified, then judged
- example calling a method that does not exist → expect flagged as CUT
- pointer that summarizes its target file → expect rewritten to trigger + path
- rule with a real boundary plus a drifting inventory → expect rewrite that keeps the boundary

Prompt: "Run the audit on this repo." Grader: LLM judge checks the report for the six verdicts. Run: `claude plugin eval bonsai --skill audit --ablation with-without --runs 1`

## Expert-labeled seeds (human review of applied runs)

Fixture: root CLAUDE.md of a production Laravel monolith.

- template preamble ("This file provides guidance to ...") and a git remote line one `git remote -v` derives → expect CUT
- six-line git-workflow block where only the branch prefixes, "direct pushes blocked", and "verify current branch" change behavior → expect a compression keeping exactly those
- setup section mixing always-true commands with cloud-sandbox-only provisioning → expect environment-conditional extract behind a resident discriminator line
- rule enumerating every locale dir by name → expect rewrite to the generic form ("every locale dir under lang/")
- pointer with a parenthetical summarizing the target's structure → expect the parenthetical cut, trigger and path kept
- integration inventory missing a gateway the codebase ships → expect flagged as drift
- rewrite that narrows a rule's scope ("pages" for a rule that covered every component) → expect the meaning check to flag it, one revision, and a call if it still drifts
- report with 9 calls → expect a round of 5, `run.waiting` set, and a run file holding all 9
- second run while changes wait and earlier rounds shifted the lines → expect the waiting changes located by their text and presented without a new verification pass
- decision log holding a skip with the same class and removed text → expect the change not proposed
- class with 20 logged applies and no skip → expect its changes in lane auto, shown collapsed with an undo each
- round with 2 calls and one ready group → expect AskUserQuestion with the diffs in the option previews, and no page
- `--headless` → expect a draft PR with one commit per ready group and per call, and one review thread per call whose suggestion restores the current text
- convention that differs from the framework default, held by a custom static-analysis rule whose message names the fix → expect CUT through step 3, with its "held by" clause
- rule on where a class lives (enums in a directory named `Enums`), held by an architecture test that covers every path and names the fix → expect CUT through step 3, with no line kept next to the check
- line naming a directory through a Markdown link to its nested CLAUDE.md, plus "run `php artisan list acme` to see them all" → expect one ready rewrite to the directory in backticks, with the discovery command cut
- `Patterns in [.claude/rules/livewire.md](.claude/rules/livewire.md).` in a file read only by sessions that edit components the rule's globs match → expect the pointer cut as ready
- pointer to a nested CLAUDE.md for work that creates the first file in its directory → expect the pointer cut as ready, since the Write loads the nested file
- pointer to a nested CLAUDE.md for running a command in that directory (a migration, a generator) → expect the pointer kept as a path in backticks
- `See [../README.md](../README.md)` in `docs/CLAUDE.md` → expect a rewrite to `README.md` in backticks, resolved from the repository root
- `@docs/style.md` import line → expect it kept bare, never put in backticks
- "Run `php artisan list acme` before adding a command, so you never add a duplicate" → expect it judged as a workflow rule, never cut as a discovery command
- path link in a repository whose CLAUDE.md lint allows links → expect a rewrite plus a bake candidate, never a reported lint violation
- `Read [docs/frontend.md](docs/frontend.md) before writing a view.`, where views live outside `docs/` → expect the trigger kept, rewritten to `docs/frontend.md` in backticks
- rule held by a check whose baseline still lists violations of it → expect it judged as unenforced (step 4 measures it), and the baseline named as a bake candidate
- line listing an order's allowed transitions ("pending to paid, never back"), unenforced → expect a call asked as a question that hands it to guard, `/bonsai:guard` in `next`, and no state machine or refactor proposed
- environment-only section (cloud sandbox setup) → expect the extract behind a discriminator line, and no hook proposed
- deploy procedure whose files all live under `deploy/` → expect a move with destination `skill`, as a call, to `deploy/.claude/skills/<name>/SKILL.md`
- release procedure that edits `app/`, `config/` and `docs/` → expect a move with destination `skill`, as a call, to a root `.claude/skills/<name>/` skill with `paths:` globs
- procedure bound for a skill in a repository whose `.claude/skills/` is gitignored → expect a call that says the skill reaches no clone or cloud session
- repository whose stored `agents` setting is `["codex"]`, with a rule moved into `tests/CLAUDE.md` → expect the move to leave a one-line path pointer in the root
- no stored `agents` setting → expect one question in the first step, its answer stored, and no second question in a later run
- nested CLAUDE.md alone in a directory with no other file, reached through a pointer from another scoped file → expect it flagged as a call asked as a question, a merge or a new scope offered, and `/bonsai:split` in `next`
- two path-scoped rules that point at each other → expect the same flag
- "Why" sentence a reviewer needs and a session does not ("we chose cents after the 2024 rounding audit") → expect a move with destination `html-comment`, as a call
- load log at `~/.claude/bonsai/loads/<key>.jsonl` → expect the load map counted from it and labeled measured, never estimated
- path-scoped rule whose globs match half the repository's files → expect it counted as resident in the load map
