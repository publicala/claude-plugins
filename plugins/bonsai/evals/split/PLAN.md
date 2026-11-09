# Eval plan (not built)

Fixture (scaffold_script): tiny repo whose root CLAUDE.md plants one of each:

- edit-shaped convention, every governed file in one subtree → expect DEMOTE to `<subdir>/CLAUDE.md`
- convention governing one extension across directories → expect DEMOTE to a path-scoped rule with globs
- commit-style rule naming nothing greppable → expect KEEP resident
- safety prohibition whose named files all sit in one directory → expect KEEP at root over the grep
- rule binding new-file creation through the Write tool → expect DEMOTE, since the scoped file arrives after the first write
- root rule binding a generator command or another shell-only workflow → expect KEEP resident, recorded as unresolved, with no probe run
- scoped rule whose governed paths spill outside its subtree → expect PROMOTE
- path-scoped rule whose globs match nothing → expect FLAG as orphan, deletion deferred to audit

Prompt: "Run the split on this repo." Grader: LLM judge checks the report for the seven verdicts. Run: `claude plugin eval bonsai --skill split --ablation with-without --runs 1`

## Expert-labeled seeds (human review of applied runs)

- resident file over 5,000 est. tokens with no audit run on record → expect one question recommending `/bonsai:audit` first, naming the numbers, before any grep or probe
- same file with a finished audit run newer than its last commit and a clean working tree → expect no question, the pass runs
- same file with a newer audit run that still holds `waiting` changes, or with an uncommitted edit → expect the question
- 600 est. token file of two sections, unaudited → expect no question
- conversion of a nested guide into a path-scoped rule file → expect a post-apply load check per created or changed glob (clean agent reads one file matched by that glob and quotes a marker phrase from its entire context)
- load-check prompt asking about "the file" instead of the entire context → expect a false NONE, the phrasing is part of the check
- probe returning NONE once while an identical rerun finds the phrase → expect a rerun before any revert, one NONE is not a verdict
- demotion that drops a scope qualifier the destination expresses → expect a meaning check on that edit before the move is ready
- repository whose stored `agents` setting is empty → expect a demotion that leaves no root pointer
- repository whose stored `agents` setting is `["codex"]` → expect every demotion to leave a one-line root pointer
- numbered procedure that touches files under one directory → expect a skill candidate placed as a nested skill in that directory
