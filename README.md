# publicala/claude-plugins

Marketplace of public Claude Code plugins by Publica.la. Add it once, then install any listed plugin by name.

```
/plugin marketplace add publicala/claude-plugins
/plugin install <plugin-name>@publicala
```

## Plugins

### bonsai

Keeps CLAUDE.md files like a bonsai: small on purpose, shaped by continuous feeding and pruning. Four skills cover the lifecycle:

| Skill | Role |
| --- | --- |
| `/bonsai:feed` | Adds rules from observed patterns (commits, in-session corrections) |
| `/bonsai:bake` | Converts crystallized rules into automated checks and removes the prose |
| `/bonsai:audit` | Prunes and verifies what remains, every cut backed by evidence |
| `/bonsai:split` | Moves what remains to the load scope of the sessions it governs |

See [plugins/bonsai](plugins/bonsai) for details.

## Contributing

Everything listed here is distributed publicly. Additions and changes need approval from `@publicala/public-repo-owners` (enforced by a repository ruleset). Plugins live in this repo under `plugins/`, and shared content inside a plugin lives once in its `references/` directory rather than duplicated per skill.

## License

MIT
