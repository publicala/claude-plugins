# bonsai

Keeps CLAUDE.md files like a bonsai: small on purpose, shaped by continuous feeding and pruning. Four skills cover the lifecycle:

| Skill | Role |
| --- | --- |
| `/bonsai:feed` | Adds rules from observed patterns (commits, in-session corrections) |
| `/bonsai:bake` | Converts crystallized rules into automated checks and removes the prose |
| `/bonsai:audit` | Prunes and verifies what remains, every cut backed by evidence |
| `/bonsai:split` | Moves what remains to the load scope of the sessions it governs |

Run `feed` after a working session, `bake` once enough rules have accumulated to be worth automating, `audit` when CLAUDE.md files have grown without review, and `split` after an audit leaves a resident file carrying rules that govern one area.

## Install

```
/plugin marketplace add publicala/claude-plugins
/plugin install bonsai@publicala
```

## Layout

- `skills/<verb>/SKILL.md` — one skill per lifecycle verb
- `references/` — guidance shared by the skills, loaded on demand (the decision-artifact spec)
- `evals/<verb>/PLAN.md` — eval plans per skill

## License

MIT
