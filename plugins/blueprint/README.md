# blueprint

Blueprint is publica.la's house style for engineering visuals: hairlines, square corners, mono labels, a dot grid and one accent color. This plugin holds the style once (the stylesheet, the fonts, the logo, the icons and the renderer) for every skill that draws in it.

| Skill | Role |
| --- | --- |
| `/blueprint:diagram` | Renders standalone figures, spec sheets, social cards and 16:9 slides to PNG and PDF from small HTML sources |
| `/blueprint:walkthrough` | Makes a short, silent video (about 30 s, 1920x1080) that explains a change, scene by scene, with a contact sheet and a player page |

Claude also reaches for each one on its own when you ask for a figure or a video.

## Install

```
/plugin marketplace add publicala/claude-plugins
/plugin install blueprint@publicala
```

The renderer needs [Bun](https://bun.sh) and Chrome or Chromium, and a walkthrough's mp4 needs ffmpeg. Claude Code installs the two packages (`puppeteer-core` and `sharp`) with the plugin.

## Layout

- `skills/<name>/SKILL.md`: one skill per output, with its examples
- `references/`: shared by the skills: the look and the vocabulary, truth and audiences, writing
- `style/blueprint.css`: the stylesheet, with the light and the dark tokens
- `renderer/`: builds a self-contained page from a source, measures it in Chrome, judges the measurement and writes the PNG or PDF. `walkthrough.ts` adds the timeline (`timeline.ts`), checks each scene, and writes the contact sheet, the mp4 and the player (`player.html`)
- `assets/`: the publica.la wordmark, Inter and JetBrains Mono (SIL Open Font License), and the Lucide icons (ISC License), so a render needs no network
- `evals/<skill>/PLAN.md`: eval plans per skill

`assets/icons.json` comes from `lucide-static` through `bun run update:icons` at the repository root. A test fails when the two drift apart.

## Tests

From the repository root:

```
bun install
bun test plugins/blueprint
```

The tests that render need Chrome, and skip without it.

## License

MIT, except the fonts and the icons, which keep their own licenses in `assets/`.
