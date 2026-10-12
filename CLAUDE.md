# claude-plugins

Publica.la's public marketplace of Claude Code plugins. Anyone can install what lands on `main`, and `@publicala/public-repo-owners` approves every change.

## Plugins

- Install copies each plugin to a cache on its own, so nothing in a plugin reads a path above its root. To share a file between plugins, commit a symlink: install copies the target in its place.
- A SKILL.md names bundled files with `${CLAUDE_SKILL_DIR}` (its own directory) or `${CLAUDE_PLUGIN_ROOT}`. Claude Code substitutes both when it loads the skill. Bash's environment has neither.
- `plugin.json` carries no `version`, so every merge reaches users. A `version` would pin them until someone bumps it.
- Install ships only the plugin's directory, so a skill that has Claude write for people (pages, figures, messages) carries its own writing rules.
- Everything here is public: no internal service names, hostnames, customer names or private repository paths. Examples use a made-up company (Acme Books).

## Writing

For every Markdown file here. `bun run check:prose` catches the mechanical rules (em dashes, semicolons, curly quotes, stock phrases) and names the fix. These need judgment:

- Direct, practical, concise. Start from the problem or the constraint, state the tradeoff and the opinion, and let code, facts and numbers carry the detail.
- Cut what reads like vendor docs or an AI tutorial: concepts the reader already knows, a tutorial where the fix is enough, generic best practices, hedging.
- Paragraphs of one to three sentences. Contractions. Bold for emphasis. Headings stop at `##` almost always. A labeled bullet takes a colon: `**Label**: description`.
- No contrastive negation ("not X, but Y", "X, not Y", "X, never Y", "it's not about X, it's about Y"). State Y directly.
- Plain words over jargon. A term like "idempotent" stays only when the reader needs that concept to use the thing correctly.
- State what holds now. What changed, and why, goes in the commit.
- Quotes, third-party output and code keep their own conventions.
