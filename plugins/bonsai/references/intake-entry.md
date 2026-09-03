# Intake entry format

One file per source pull request, at `~/.claude/bonsai/intake/<owner>/<repo>/<YYYY-MM-DD>-pr<number>.md`, where `<owner>/<repo>` is the repository the candidates target. Intake writes the file. Feed, bake, and audit update the `status` of individual candidates and append to `history`. Nothing else edits it.

```markdown
---
target_repo: owner/repo
source_pr: https://github.com/owner/reviewed-repo/pull/123
source_repo: owner/reviewed-repo
recorded_at: 2026-01-31
verified_on: 3f2a9c1 # default-branch commit every symbol check ran against
---

# <PR title>

## Ledger

| Thread | Classification | Author response | Claim verified in final diff |
| --- | --- | --- | --- |
| [link](https://github.com/owner/reviewed-repo/pull/123#discussion_r1) | regression | fixed | yes |
| [link](https://github.com/owner/reviewed-repo/pull/123#discussion_r2) | pre-existing | declined, out of scope | n/a |
| [link](https://github.com/owner/reviewed-repo/pull/123#discussion_r3) | withdrawn | none | n/a |

## Candidates

### system-owned-field-ruled-prohibited

- Class: prose
- Status: open
- Recurrence: 1
- Mistake: a system-filled request field ruled `prohibited` accepts explicit `null`, and `validated()` drops the key, so the endpoint answers 200 for a change it never applied
- Symbols: `app/Http/Requests/Api/StoreThingRequest.php` (exists), rule `missing` (framework)
- Current code: 4 of 5 system-owned fields already use `missing` (complies)
- Existing coverage: none in `.claude/rules/api.md`; no linter can see rule semantics
- Rule: |
  Rule a system-owned field `missing`, never `prohibited`. `prohibited` passes explicit `null` and `validated()` drops the key, so the caller gets a 200 for a change the endpoint never applied. Test both a filled value and an explicit `null`.
- Target: `.claude/rules/api.md`
- Evidence: [thread](https://github.com/owner/reviewed-repo/pull/123#discussion_r1)

### bridge-import-outside-facade

- Class: bake
- Status: open
- Recurrence: 2 ([earlier entry](~/.claude/bonsai/intake/owner/repo/2026-01-10-pr98.md))
- Mistake: a store imports the bridge package directly and has to handle transport-level errors the communication facade already translates
- Symbols: `src/communication/` (exists), `@vendor/bridge` (dependency on default branch)
- Current code: 0 of 14 non-facade modules import the bridge (complies)
- Existing coverage: prose line in `CLAUDE.md` under Integration; no lint rule
- Check: ESLint `no-restricted-imports` for `@vendor/bridge` outside `src/communication/**`, tests exempt; runs in the existing `lint` CI job
- Target: `eslint.config.js`
- Evidence: [thread](https://github.com/owner/reviewed-repo/pull/123#discussion_r4)

## Not encoded

- [thread](https://github.com/owner/reviewed-repo/pull/123#discussion_r2): pre-existing, tracked in the issue tracker
- [thread](https://github.com/owner/reviewed-repo/pull/123#discussion_r5): reviewer cited a workspace rule that does not exist; review tooling, not codebase

## History

- 2026-01-31 intake: recorded 2 candidates
```

## Fields

- `target_repo`, `source_repo`, `source_pr`: `source_repo` differs from `target_repo` when a review on one repository surfaces a rule for another.
- `verified_on`: the default-branch commit of the target repository at verification time. Every symbol claim in the file is relative to it.
- `Class`: `prose` or `bake`. Fixed at intake.
- `Status`: `open`, `frozen-until: <PR URL>`, `watch`, `do-not-encode` (written by intake), then `encoded: <rule path> (<PR URL>)`, `baked: <check> (<PR URL>)`, or `rejected: <reason>` (written by feed, bake, or audit). A rejected bake candidate may be re-classed `prose` by bake, with the reason on the same line.
- `Recurrence`: the count of distinct source PRs showing the same `mistake` slug in this target repository, with links to the earlier entries. Feed proposes at two or more.
- `Mistake`: the concrete failure a session produces without the rule, one sentence.
- `Symbols`: every identifier the rule or check names, each marked `exists` on the default branch, or the PR it waits for.
- `Current code`: numerator, denominator, and verdict (`complies`, `contradicts`, `no instances`).
- `Existing coverage`: instruction lines and enforcement surfaces already governing the behavior, or `none`.
- `Rule` (prose) or `Check` (bake): final text, ready to copy. Imperative, present tense, class of mistake rather than incident.
- `Target`: repo-relative path the rule or check lands in.
- `Evidence`: direct thread links.

## Reading entries from other skills

Feed reads `Status: open` candidates for the current repository and proposes those with `Recurrence` at two or more, or any candidate the user names. Bake reads `Class: bake` candidates with `Status: open`, regardless of recurrence, since a check costs nothing to keep. Audit, when it cuts a rule whose line an entry produced, writes `rejected: cut by audit, <reason>` on that candidate so feed does not propose it again. Each writer appends one dated line to `History`.
