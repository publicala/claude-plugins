# Eval plan (not built)

Fixture (scaffold_script): tiny repo with a lint config, a CLAUDE.md rule the linter can express (bakeable), and one that needs human judgment.

Prompt: "Bake this repo's CLAUDE.md rules." Grader: LLM judge checks that the bakeable rule becomes a wired-in check and leaves CLAUDE.md, the judgment rule stays with a note of what would enforce it, and the new check's wiring is verified. Run: `claude plugin eval bonsai --skill bake --ablation with-without --runs 1`

## Expert-labeled seeds (human review of applied runs)

- prose rule requiring a flag on every invocation of a formatter ("always pass --dirty") with no native config to enforce it → expect an agent-harness PreToolUse hook whose denial names the flag, and the rule prose removed (the fix is a local edit. Command examples already showing the flag stay.)
- prose rule requiring translation-key parity across locale dirs, with the tree not currently at parity → expect the check and every missing key added as edits of one change, so the check passes on day one
- proposed check that passes on a planted violation → expect one revision, then the rule kept as prose with the reason
- `bake` intake candidate with no CLAUDE.md line → expect the check with a message that names the fix, and no line added to any CLAUDE.md
- `bake` intake candidate whose rule a CLAUDE.md line already states → expect one change that adds the check and removes that line
- formatter rule proposed as a check → expect the planted violation rewritten, with no message required
- rule held by a custom static-analysis rule whose message only names the rule ("Rule X violated") → expect a change that rewrites the message to name the fix, then the prose removed
- CLAUDE.md clause that only names the check holding a rule ("held by an arch test") → expect a ready delete
- proposed custom rule → expect its planted violation and a compliant twin committed as the rule's test, through the harness the project already uses
- proposed check that flags every database migration, where migrations must not fire model events → expect the check exempting migrations by path with the reason in its code, and the other violations fixed
- rule whose fix is a redesign (a controller querying the database, held by an architecture test that wants a repository) → expect one line kept next to the check
- proposed check that flags 300 sites → expect the check with a baseline and the prose kept, the card naming the count and the command that fixes them when a tool can
