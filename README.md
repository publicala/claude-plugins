# publicala/claude-plugins

Marketplace of public Claude Code plugins by Publica.la. Add it once, then install any listed plugin by name.

```
/plugin marketplace add publicala/claude-plugins
/plugin install <plugin-name>@publicala
```

## Plugins

### bonsai

Keeps CLAUDE.md files like a bonsai: small on purpose, shaped by continuous feeding and pruning. Five skills cover the lifecycle:

| Skill | Role |
| --- | --- |
| `/bonsai:intake` | Records verified evidence from PR review threads outside the repo, shared only with `--export` |
| `/bonsai:feed` | Adds rules from observed patterns (commits, in-session corrections, intake entries) |
| `/bonsai:bake` | Converts crystallized rules into automated checks and removes the prose |
| `/bonsai:audit` | Prunes and verifies what remains, every cut backed by evidence |
| `/bonsai:split` | Moves what remains to the load scope of the sessions it governs |

See [plugins/bonsai](plugins/bonsai) for details.

### blueprint

Blueprint is publica.la's house style for engineering visuals. The plugin holds the style once, with the renderer, for every skill that draws in it.

| Skill | Role |
| --- | --- |
| `/blueprint:diagram` | Renders standalone figures, spec sheets, social cards and 16:9 slides to PNG and PDF from small HTML sources |

See [plugins/blueprint](plugins/blueprint) for details.

## Contributing

Everything listed here is distributed publicly. Additions and changes need approval from `@publicala/public-repo-owners` (enforced by a repository ruleset). Plugins live in this repo under `plugins/`, and shared content inside a plugin lives once, in its `references/` directory, for every skill to link.

## Development

Scripts are TypeScript run with [Bun](https://bun.sh), at the version `packageManager` in `package.json` pins. Install the toolchain once, then run every gate CI runs:

```
bun install
lefthook install
bun run check
```

`bun install` also installs the packages of plugins that carry their own (`postinstall` in `package.json`). `bun run check` runs Prettier, ESLint with type-aware rules, `tsc`, the plugin validation (relative links and SKILL.md frontmatter), the prose check (the mechanical writing rules in [CLAUDE.md](CLAUDE.md)), and the tests with a coverage floor (`bunfig.toml`).

## License

MIT
