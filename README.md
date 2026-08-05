# publicala/claude-plugins

Marketplace of public Claude Code plugins by Publica.la. Add it once, then install any listed plugin by name.

```
/plugin marketplace add publicala/claude-plugins
/plugin install <plugin-name>@publicala
```

## Plugins

### The CLAUDE.md quartet

A toolbox for keeping CLAUDE.md files sharp. Each skill covers one phase of the lifecycle:

| Plugin | Role |
| --- | --- |
| [`feed-claude-md-files`](https://github.com/publicala/feed-claude-md-files-skill) | Adds rules from observed patterns (commits, in-session corrections) |
| [`bake-claude-md-files`](https://github.com/publicala/bake-claude-md-files-skill) | Converts crystallized rules into automated checks and removes the prose |
| [`audit-claude-md-files`](https://github.com/publicala/audit-claude-md-files-skill) | Prunes and verifies what remains, every cut backed by evidence |
| [`split-claude-md-files`](https://github.com/publicala/split-claude-md-files-skill) | Moves what remains to the load scope of the sessions it governs |

## Contributing

Everything listed here is distributed publicly. Additions and changes need approval from `@publicala/public-repo-owners` (enforced by a repository ruleset). Plugins live in their own public repos under the publicala org; this repo only indexes them.

## License

MIT
