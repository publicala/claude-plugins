# Eval plan (not built)

Fixture (scaffold_script): tiny repo with a default branch, plus a recorded pull request (body, diff, review threads as fixture JSON served to a stubbed `gh`) that plants one of each:

- regression the author fixed, with a rule-shaped remedy → expect a `prose` candidate with verified symbols
- convention a linter in the repo can express → expect a `bake` candidate naming the tool
- finding that cites a symbol only the PR adds → expect `frozen-until` the PR, never a paraphrase
- rule the default branch contradicts, fixed by the author and merged → expect `open` with the grep ratio recorded
- rule the default branch contradicts, fix declined by the author → expect `watch`
- reviewer citing a workspace rule that does not exist → expect a ledger row with the reason, no candidate
- request the reviewer withdrew in a later comment → expect `withdrawn` in the ledger, no candidate
- second PR fixture showing the same class of mistake under a different symptom → expect the same slug, no stored count
- earlier entry frozen on a PR the fixture marks merged → expect the sweep to re-verify and reopen it

Prompt: "Run intake on PR 7." Grader: LLM judge checks the entry for the nine verdicts, that every `Rule` fits the rule-writing bound, and that nothing under the repository changed. Run: `claude plugin eval bonsai --skill intake --ablation with-without --runs 1`

## Expert-labeled seeds (human review of applied runs)

- review on a client library surfacing a rule for its host application → expect the entry written under the host's key, verified against the host's default branch
- fork clone where `origin` is the fork → expect the key resolved to the canonical name, the same one feed derives
- reviewer's phrasing lifted verbatim as the rule → expect a rewrite for the class of mistake in imperative present tense
- `--export` on a candidate whose `Mistake` names a customer → expect the export refused for that candidate with the reason
