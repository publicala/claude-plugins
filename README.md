# publicala/claude-plugins

The Claude Code plugins we use every day at [Publica.la](https://publica.la), shared in public. Add the marketplace once, then install any plugin by name:

```
/plugin marketplace add publicala/claude-plugins
/plugin install bonsai@publicala
/plugin install blueprint@publicala
```

## Plugins

### bonsai

Every CLAUDE.md starts small and grows a line per mistake, until most of it is noise every session pays for. bonsai keeps it small on purpose: it grows rules from real review findings, turns the ones a tool can enforce into checks, and prunes the rest with evidence.

| Skill | Role |
| --- | --- |
| `/bonsai:intake` | Records verified evidence from PR review threads outside the repo, shared only with `--export` |
| `/bonsai:feed` | Adds rules from observed patterns (commits, in-session corrections, intake entries) |
| `/bonsai:bake` | Converts crystallized rules into automated checks and removes the prose |
| `/bonsai:guard` | Turns one review round's findings into checks, each its own PR from the default branch |
| `/bonsai:audit` | Prunes and verifies what remains, every cut backed by evidence |
| `/bonsai:split` | Moves what remains to the load scope of the sessions it governs |

See [plugins/bonsai](plugins/bonsai) for when to run each one.

### blueprint

Blueprint is publica.la's house style for engineering visuals. The plugin holds the style once, with the renderer, for every skill that draws in it.

| Skill | Role |
| --- | --- |
| `/blueprint:diagram` | Renders standalone figures, spec sheets, social cards and 16:9 slides to PNG and PDF from small HTML sources |
| `/blueprint:walkthrough` | Makes a short, silent video (about 30 s, 1920x1080) that explains a change, scene by scene, with a contact sheet and a player page |

See [plugins/blueprint](plugins/blueprint) for details.

## Contributing

Everything listed here is distributed publicly. Additions and changes need approval from `@publicala/public-repo-owners` (enforced by a repository ruleset). Plugins live in this repo under `plugins/`, and shared content inside a plugin lives once, in its `references/` directory, for every skill to link.

## Development

Scripts are TypeScript run with [Bun](https://bun.sh), at the version `packageManager` in `package.json` pins. Install the toolchain once, then run every gate CI runs:

```
bun install
bun run check
```

`bun install` also installs the packages of plugins that carry their own (`postinstall` in `package.json`), and the git hooks (`lefthook.yml`): a commit formats its staged files with Prettier. `bun run check` runs Prettier, ESLint with type-aware rules, `tsc` (twice: the Bun scripts, then the page scripts against the DOM in `tsconfig.browser.json`), the JSON validation (every `*.json` and `*.jsonc` parses), the plugin validation (relative links and SKILL.md frontmatter), the prose check (the mechanical writing rules in [CLAUDE.md](CLAUDE.md)), and the tests with a coverage floor (`bunfig.toml`).

## License

MIT
