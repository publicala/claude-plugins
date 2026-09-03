# Intake entries

Shared contract for `/bonsai:intake` (writer), `/bonsai:feed` and `/bonsai:bake` (readers and status writers).

## Repository key

The key is the canonical GitHub name of the target repository, `owner/repo`, as `gh repo view <target> --json nameWithOwner` resolves it. Run inside a clone, `gh repo view --json nameWithOwner` prefers the `upstream` remote over `origin`, so a fork clone still resolves to the canonical name. Every skill derives the key this way and no other. A reader that finds no directory under the key reports "no intake entries under `<path>`" rather than skipping silently, so a key mismatch is visible.

## Files

- Local entry: `~/.claude/bonsai/intake/<key>/pr<number>.md`, one per source pull request, named by the PR alone so a rerun finds the same file. Holds the ledger and the candidates.
- Exported candidates (opt-in, `--export`): `<target repo>/.claude/bonsai/candidates/pr<number>.md`. Holds the candidate sections only, verbatim, no ledger. Intake writes it uncommitted; whoever commits it decides it is fit to share.

A reader treats a local entry and an exported file with the same `source_pr` as one entry, preferring the local copy's statuses.

## Rerun

A rerun of intake on the same PR rewrites the ledger and the intake-owned fields of each candidate (`Symbols`, `Current code`, `Existing coverage`, `Rule` or `Check`, `Target`, `Evidence`, `verified_on`). It never changes a status that feed, bake, or audit wrote (`encoded`, `baked`, `rejected`), never removes a `History` line, and never creates a second file for the same PR. A candidate the rerun no longer produces keeps its section and gets a `History` line saying so.

## Format

```markdown
---
target_repo: owner/repo
source_pr: https://github.com/owner/reviewed-repo/pull/123
source_repo: owner/reviewed-repo
recorded_at: 2026-01-31
verified_on: 3f2a9c1
---

# <PR title>

## Ledger

| Thread | Classification | Outcome |
| --- | --- | --- |
| [r1](https://github.com/owner/reviewed-repo/pull/123#discussion_r1) | regression | system-owned-field-ruled-prohibited |
| [r2](https://github.com/owner/reviewed-repo/pull/123#discussion_r2) | pre-existing | tracked in the issue tracker |
| [r3](https://github.com/owner/reviewed-repo/pull/123#discussion_r3) | withdrawn | no task |
| [r4](https://github.com/owner/reviewed-repo/pull/123#discussion_r4) | regression | bridge-import-outside-facade |
| [r5](https://github.com/owner/reviewed-repo/pull/123#discussion_r5) | incorrect | reviewer cited a rule that does not exist; review tooling |

## Candidates

### system-owned-field-ruled-prohibited

- Class: prose
- Status: open
- Mistake: a system-filled request field ruled `prohibited` accepts explicit `null`, and `validated()` drops the key, so the endpoint answers 200 for a change it never applied
- Symbols: `app/Http/Requests/Api/StoreThingRequest.php` (exists), rule `missing` (framework)
- Current code: 4 of 5 system-owned fields already use `missing` (complies)
- Existing coverage: none in `.claude/rules/api.md`; no linter can see rule semantics
- Rule:
  Rule a system-owned field `missing`, never `prohibited`: `prohibited` passes explicit `null` and `validated()` drops the key. Test a filled value and an explicit `null`.
- Target: `.claude/rules/api.md`
- Evidence: [r1](https://github.com/owner/reviewed-repo/pull/123#discussion_r1)

### bridge-import-outside-facade

- Class: bake
- Status: open
- Mistake: a store imports the bridge package directly and has to handle transport-level errors the communication facade already translates
- Symbols: `src/communication/` (exists), `@vendor/bridge` (dependency on default branch)
- Current code: 0 of 14 non-facade modules import the bridge (complies)
- Existing coverage: prose line in `CLAUDE.md` under Integration; no lint rule
- Check:
  ESLint `no-restricted-imports` for `@vendor/bridge` outside `src/communication/**`, tests exempt, in the existing `lint` CI job.
- Target: `eslint.config.js`
- Evidence: [r4](https://github.com/owner/reviewed-repo/pull/123#discussion_r4)

## History

- 2026-01-31 intake: recorded 2 candidates
```

## Fields

- `target_repo`, `source_repo`, `source_pr`: `source_repo` differs from `target_repo` when a review on one repository surfaces a rule for another.
- `verified_on`: the default-branch commit of the target repository the symbol checks ran against.
- Ledger `Outcome`: the slug of the candidate the thread feeds, or the reason it feeds none. One row per thread. This is the only place a dropped thread appears.
- `Class`: `prose` or `bake`. Intake fixes it; bake may change `bake` to `prose` when it declines.
- `Status`: `open`, `frozen-until: <PR URL>`, or `watch` (written by intake), then `encoded: <rule path> (<PR URL or commit>)`, `baked: <check> (<PR URL or commit>)`, or `rejected: <reason>` (written by feed or bake). `rejected` is terminal and means the rule itself is wrong or already enforced. Declining a check for any other reason is not a rejection: bake sets `Class: prose`, keeps `open`, and writes the reason in `History`.
- `Mistake`: the concrete failure a session produces without the rule, one sentence.
- `Symbols`: every identifier the rule or check names, each marked `exists` on the default branch or the PR it waits for.
- `Current code`: numerator, denominator, and verdict (`complies`, `contradicts`, `no instances`).
- `Existing coverage`: instruction lines and enforcement surfaces already governing the behavior, or `none`.
- `Rule` (prose) or `Check` (bake): final text on the indented line below the label, ready to copy, written to [rule-writing.md](rule-writing.md).
- `Target`: repo-relative path the rule or check lands in.
- `Evidence`: direct thread links.
- `History`: one dated line per write, by intake, feed, bake, or audit.

## Recurrence

Recurrence is computed, never stored: the number of distinct `source_pr` values whose candidates carry the same slug under one key, local and exported entries combined. Feed and bake read `open` and `watch` candidates and act at two or more, or on any candidate the user names. When a slug is encoded or baked, the writer marks that status on every entry carrying the slug, so no copy stays `open` behind the rule.
