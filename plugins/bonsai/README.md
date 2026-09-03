# bonsai

Keeps CLAUDE.md files like a bonsai: small on purpose, shaped by continuous feeding and pruning. Five skills cover the lifecycle:

| Skill | Role |
| --- | --- |
| `/bonsai:intake` | Records verified evidence from PR review threads, locally and never in the repo |
| `/bonsai:feed` | Adds rules from observed patterns (commits, in-session corrections, intake entries) |
| `/bonsai:bake` | Converts crystallized rules into automated checks and removes the prose |
| `/bonsai:audit` | Prunes and verifies what remains, every cut backed by evidence |
| `/bonsai:split` | Moves what remains to the load scope of the sessions it governs |

Run `intake` after each review round, `feed` after a working session, `bake` once enough rules have accumulated to be worth automating, `audit` when CLAUDE.md files have grown without review, and `split` after an audit leaves a resident file carrying rules that govern one area.

## Evidence stays local

`/bonsai:intake` writes under `~/.claude/bonsai/intake/<owner>/<repo>/`, outside every repository. Review threads quote customers, internal names, and unreleased design, so entries are never committed and never shared. Recurrence is therefore per machine: a rule earns a proposal when the same person sees the same class of mistake in two pull requests.

## Install

```
/plugin marketplace add publicala/claude-plugins
/plugin install bonsai@publicala
```

## Layout

- `skills/<verb>/SKILL.md` — one skill per lifecycle verb
- `references/` — guidance shared by the skills, loaded on demand (the decision-artifact spec, the intake entry format)
- `evals/<verb>/PLAN.md` — eval plans per skill

## License

MIT
