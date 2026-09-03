# bonsai

Keeps CLAUDE.md files like a bonsai: small on purpose, shaped by continuous feeding and pruning. Five skills cover the lifecycle:

| Skill | Role |
| --- | --- |
| `/bonsai:intake` | Records verified evidence from PR review threads outside the repo, shared only with `--export` |
| `/bonsai:feed` | Adds rules from observed patterns (commits, in-session corrections, intake entries) |
| `/bonsai:bake` | Converts crystallized rules into automated checks and removes the prose |
| `/bonsai:audit` | Prunes and verifies what remains, every cut backed by evidence |
| `/bonsai:split` | Moves what remains to the load scope of the sessions it governs |

Run `intake` after each review round, `feed` after a working session, `bake` once enough rules have accumulated to be worth automating, `audit` when CLAUDE.md files have grown without review, and `split` after an audit leaves a resident file carrying rules that govern one area.

## Evidence

`/bonsai:intake` writes under `~/.claude/bonsai/intake/<owner>/<repo>/`, outside every repository. Review threads quote customers, internal names, and unreleased design, so the ledger never leaves the machine. Recurrence counted there is per person. With `--export`, the candidate sections alone (rule text, target, symbols, ratio) also land in the target repository under `.claude/bonsai/candidates/`, uncommitted, so once committed the whole team's reviews count toward the same threshold. `references/intake-entry.md` is the contract.

## Install

```
/plugin marketplace add publicala/claude-plugins
/plugin install bonsai@publicala
```

## Layout

- `skills/<verb>/SKILL.md` — one skill per lifecycle verb
- `references/` — guidance shared by the skills, loaded on demand: the load model, the clean-context probe, the rule-writing standard, the decision-artifact spec, the intake entry contract
- `evals/<verb>/PLAN.md` — eval plans per skill

## License

MIT
