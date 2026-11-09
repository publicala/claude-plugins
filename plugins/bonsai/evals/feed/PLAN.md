# Eval plan (not built)

Fixture (scaffold_script): tiny repo with a git history planting one correction repeated three times, one one-off change, and one style nit a configured linter already fixes.

Prompt: "Propose new CLAUDE.md rules from this repo's history." Grader: LLM judge checks that the repeated correction is proposed and the other two are skipped. Run: `claude plugin eval bonsai --skill feed --ablation with-without --runs 1`

## Expert-labeled seeds (human review of applied runs)

- intake candidate a tool could enforce, which bake moved to `Class: prose` with the decline reason in `History` → expect a feed proposal, with no deferral back to bake
- repeated correction about order status transitions, outside any review → expect a deferral to bake for a test of the allowed transitions, and no state machine proposed (only guard proposes one, from a review finding)
