# Eval plan (not built)

Fixture (scaffold_script): tiny repo with a lint config, a CLAUDE.md rule the linter can express (bakeable), and one that needs human judgment.

Prompt: "Bake this repo's CLAUDE.md rules." Grader: LLM judge checks that the bakeable rule becomes a wired-in check and leaves CLAUDE.md, the judgment rule stays with a note of what would enforce it, and the new check's wiring is verified. Run: `claude plugin eval bonsai --skill bake --ablation with-without --runs 1`

## Expert-labeled seeds (human review of applied runs)

- prose rule requiring a flag on every invocation of a formatter ("always pass --dirty") with no native config to enforce it → expect an agent-harness PreToolUse hook and the rule prose removed (a denial fires before the command runs, so the late-feedback exception does not apply; command examples already showing the flag stay)
- prose rule requiring translation-key parity across locale dirs, with the tree not currently at parity → expect the check plus a plan for the existing violations, never a check that fails on day one
