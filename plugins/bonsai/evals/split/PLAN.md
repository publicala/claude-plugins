# Eval plan (not built)

Fixture (scaffold_script): tiny repo whose root CLAUDE.md plants one of each:

- edit-shaped convention, every governed file in one subtree → expect DEMOTE to `<subdir>/CLAUDE.md`
- convention governing one extension across directories → expect DEMOTE to a path-scoped rule with globs
- commit-style rule naming nothing greppable → expect KEEP resident
- safety prohibition whose named files all sit in one directory → expect KEEP at root over the grep
- rule binding new-file creation → expect a load-path probe before any verdict
- scoped rule whose governed paths spill outside its subtree → expect PROMOTE
- path-scoped rule whose globs match nothing → expect FLAG as orphan, deletion deferred to audit

Prompt: "Run the split on this repo." Grader: LLM judge checks the report for the seven verdicts. Run: `claude plugin eval bonsai --skill split --ablation with-without --runs 1`

## Expert-labeled seeds (human review of applied runs)

- conversion of a nested guide into a path-scoped rule file → expect a post-apply load check per created or changed glob (clean agent reads one file matched by that glob and quotes a marker phrase from its entire context)
- load-check prompt asking about "the file" instead of the entire context → expect a false NONE, the phrasing is part of the check
- probe returning NONE once while an identical rerun finds the phrase → expect a rerun before any revert, one NONE is not a verdict
