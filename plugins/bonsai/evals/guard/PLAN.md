# Eval plan

Three cases run today, on a smaller fixture: see [../README.md](../README.md). The rest of this plan is not built.

Fixture (scaffold_script): tiny Laravel-shaped repo with Pint, Rector, PHPStan with one custom rule and its `RuleTestCase`, a `tests/Arch` suite and a CLAUDE.md, plus a recorded merged pull request (body, diff, review threads as fixture JSON served to a stubbed `gh`, every thread resolved) that plants one of each:

- `now()` where the codebase writes `Date::now()`, flagged once → expect a Rector candidate, no message required, every existing call rewritten in the same PR
- a model importing a queued job → expect an arch-test candidate whose failure message names the fix
- a `*Quietly()` write on a model that registers no events → expect a custom PHPStan rule with a planted violation and a compliant twin in its test
- a free-string `status` passed in three places → expect rung 1 (an enum cast), with a static-analysis rule over string literals rejected as the lower rung
- a naming collision no tool can see from a name → expect one prose candidate, placed in the nearest scoped CLAUDE.md, alone in its own PR
- a one-off off-by-one bug → expect a `none` row with the reason, no candidate
- a request the reviewer withdrew in a later comment → expect a `none` row, no candidate
- a rule a CLAUDE.md line already states, broken by the author → expect a `none` row "stated in `<file>`"
- a check whose fixes would touch 60 sites by hand → expect a prep PR that fixes them and the guardrail PR stacked on it

Prompt: "Run guard on PR 7." Grader: LLM judge checks the ledger verdicts, that each built check failed on its planted violation and passed on the default branch, that no PR adds a CLAUDE.md line for a check, that every PR targets the default branch except the stacked one, that each PR carries the `guardrail` label, and that each covered thread got one reply and kept its resolved state. Run: `claude plugin eval bonsai --skill guard --ablation with-without --runs 1`

## Expert-labeled seeds (human review of applied runs)

- three review lenses flagging the same mistake under different symptoms → expect one candidate and one PR, with all three threads in `Related:`
- a check whose scan reads only `app/` for a rule about tests → expect the check moved to a rung that reads `tests/`
- an arch rule with several targets in one negated expectation, which passes while one target still breaks it → expect the planted violation to catch it and the rule split per target
- a guard test that finds nothing because its glob matches no file → expect a non-empty assertion that fails it
- a repository whose CLAUDE.md says tests run in CI only → expect a probe branch with the failed run linked and the branch deleted
- `--no-reply` from a follow-up pass → expect no replies and a map from thread to guardrail PR in the report
- one pass over three PRs of a finished run, each with two rounds, where the same mistake shows in a correctness round of one PR and a cleanup round of another → expect one candidate citing both threads, and a reply on each resolved thread that leaves it resolved
- the label missing in the repository → expect it created once, then applied
- a second pass over a PR whose thread carries `<!-- bonsai-guard candidate=order-total-summed-by-hand outcome=built ref=<PR> -->` → expect that finding in the none rows as "built in" with the PR linked, and no card for it
- a second pass where the user skipped a candidate in the first → expect it as "declined in" with the decision page, no card, and the first pass's reply on that thread ending with the marker
- a marked guardrail PR that closed without merging → expect it treated as declined, linking that PR
- a candidate the user marked Later in the first pass → expect it back on the page, since no reply or marker records it
- one thread that fed two candidates, one built and one left Later → expect the built one skipped and the Later one back on the page
- a second pass where every candidate was decided before → expect no page, and a report that links each earlier decision
- an earlier reply with no marker that links a PR labeled `guardrail` → expect that candidate treated as built
- a candidate declined in the first pass and built in a later one, both markers on its thread → expect the build as its decision, with that PR linked
- a marker in a reply by an author without push access → expect it ignored, and the finding weighed as usual
- a candidate that needs a new dependency for one finding → expect it presented as a call with the cost, or **not now**
