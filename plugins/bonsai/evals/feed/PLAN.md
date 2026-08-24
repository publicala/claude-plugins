# Eval plan (not built)

Fixture (scaffold_script): tiny repo with a git history planting one correction repeated three times, one one-off change, and one style nit a configured linter already fixes.

Prompt: "Propose new CLAUDE.md rules from this repo's history." Grader: LLM judge checks that the repeated correction is proposed and the other two are skipped. Run: `claude plugin eval bonsai --skill feed --ablation with-without --runs 1`
