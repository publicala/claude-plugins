# bonsai

Keeps CLAUDE.md files like a bonsai: small on purpose, shaped by continuous feeding and pruning.

Every line in a CLAUDE.md loads in every session, so a line that changes nothing still costs context. And a rule a linter or a test can enforce does its job better as a check, because the check runs before review and its failure message teaches the fix. bonsai keeps only the lines that need judgment, in the scope of the sessions they govern. Six skills cover the lifecycle:

| Skill | Role |
| --- | --- |
| `/bonsai:intake` | Records verified evidence from PR review threads outside the repo, shared only with `--export` |
| `/bonsai:feed` | Adds rules from observed patterns (commits, in-session corrections, intake entries) |
| `/bonsai:bake` | Converts crystallized rules into automated checks and removes the prose |
| `/bonsai:guard` | Turns review findings into checks, each its own PR from the default branch |
| `/bonsai:audit` | Prunes and verifies what remains, every cut backed by evidence |
| `/bonsai:split` | Moves what remains to the load scope of the sessions it governs |

## When to run each one

- **intake**: after each review round. Run it once with `--search` to start from a reviewer's past PRs
- **feed**: after a working session
- **bake**: once enough rules have accumulated to be worth automating
- **guard**: after a review round whose findings a check could have caught before review, or once over every PR of a finished run
- **audit**: when CLAUDE.md files have grown without review
- **split**: after an audit leaves a resident file carrying rules that govern one area

## Evidence

`/bonsai:intake` writes under `~/.claude/bonsai/intake/<owner>/<repo>/`, outside every repository. Review threads quote customers, internal names, and unreleased design, so the ledger never leaves the machine. Recurrence counted there is per person. With `--export`, the candidate sections alone (rule text, target, symbols, ratio) also land in the target repository under `.claude/bonsai/candidates/`, uncommitted, so once committed the whole team's reviews count toward the same threshold. `references/intake-entry.md` is the contract.

## Install

```text
/plugin marketplace add publicala/claude-plugins
/plugin install bonsai@publicala
```

## Layout

- `skills/<verb>/SKILL.md`: one skill per lifecycle verb
- `references/`: guidance shared by the skills, loaded on demand: the load model, the clean-context probe and the second checks, when a check replaces prose, the rule-writing standard, rounds and the run file, decision memory, headless mode, the decision-page spec, the intake entry contract
- `renderer/`: builds the decision page from a data file, with its tests and an example run
- `evals/<verb>/PLAN.md`: eval plans per skill

## License

MIT
