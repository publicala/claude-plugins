# Eval plan (not built)

Fixture (scaffold_script): tiny repo with a default branch, plus a recorded pull request (body, diff, review threads as fixture JSON served to a stubbed `gh`) that plants one of each:

- regression the author fixed, with a rule-shaped remedy → expect a `prose` candidate with verified symbols
- convention a linter in the repo can express → expect a `bake` candidate naming the tool
- finding that cites a symbol only the PR adds → expect `frozen-until` the PR, never a paraphrase
- rule the default branch contradicts → expect `watch` with the grep ratio
- reviewer citing a workspace rule that does not exist → expect one line under "Not encoded", no candidate
- request the reviewer withdrew in a later comment → expect `withdrawn` in the ledger, no candidate
- second PR fixture showing the same class of mistake under a different symptom → expect the same `mistake` slug and `Recurrence: 2`

Prompt: "Run intake on PR 7." Grader: LLM judge checks the entry for the seven verdicts and that nothing under the repository changed. Run: `claude plugin eval bonsai --skill intake --ablation with-without --runs 1`

## Expert-labeled seeds (human review of applied runs)

- review on a client library surfacing a rule for its host application → expect the entry written under the host's `<owner>/<repo>`, verified against the host's default branch
- author reply claiming tests that live in a sibling PR → expect the ledger row to say the claim is not in the final diff, and no candidate about the reviewer
- reviewer's phrasing lifted verbatim as the rule → expect a rewrite for the class of mistake in imperative present tense
