# Blueprint

Blueprint is how publica.la shows its engineering: internal docs, public API docs, customer documents, slides, walkthrough videos and marketing. One look across all of them tells the reader that the same careful team built everything.

It reads like an engineering drawing: precise, quiet and confident. The facts carry the figure, and the decoration stays out of the way.

## The look

- **Hairlines and square corners**: 1px borders in two grays, no radius, no shadows, no gradients. Corner ticks mark each layer, like crop marks on a drawing.
- **Mono for labels, sans for content**: JetBrains Mono, uppercase and tracked, labels the structure (layer names, tags, wire labels, the spec strip). Inter, in sentence case, carries what things are: titles, descriptions and numbers.
- **A dot grid**: it reads as graph paper and stays faint. White bands hold the masthead and the colophon.
- **One accent**: blue marks numbers, tags and at most one highlighted node. Everything else is ink and grays. Green and amber appear only as status dots.
- **Numbered structure**: layers and steps carry `01`, `02`, `03`. Side panels carry short codes such as `EXT` and `OPS`.
- **Labeled wires**: every connection says what crosses it (`HTTPS`, `Private network`, `Signed URL`). A wire without a label is a wire the reader has to guess about.
- **A masthead and a colophon**: the logo, the title, a mono subtitle with the revision (`Rev. 2026-10`), an optional spec strip of key facts, and the figure's name at the bottom (`Fig. 1 · System overview`).

## Formats

The figure is one `<div class="canvas">`, and `data-size` picks the format.

| `data-size` | Size | For |
| --- | --- | --- |
| unset | 1600 wide, height fits the content | Figures in docs |
| `narrow` | 1200 wide | Narrow columns |
| `og` | 1200x630 | Social cards and covers |
| `square` | 1080x1080 | Square posts |
| `video` | 1280x720 | Slides and walkthrough scenes. Type runs larger so it reads at a glance |

## Vocabulary

The stylesheet is `style/blueprint.css` in this plugin, and these classes are the whole vocabulary.

| Class | Use |
| --- | --- |
| `canvas` | The figure. `lang="es"` on it when the text is in Spanish |
| `masthead`, `brand`, `sep`, `sub` | The top band. `<i data-logo></i>` places the logo |
| `specs` > `spec` > `k` + `v` | Key facts in the masthead. `<span class="status"></span>` adds a green dot (`status warn` for amber) |
| `split` | Main column plus a side column (352px, or 440px on `og`, `square` and `video`) |
| `stack`, `side`, `grow` | Vertical columns. `grow` makes a child of the canvas or of a column take the remaining height |
| `center` | A column that takes the remaining height and centers what it holds |
| `layer` > `gutter` (`n`, `t`, `p`) + `body` | A numbered band. `layer boxed` puts the gutter on top, for side panels |
| `row` | A row of nodes or layers that share the width evenly, however many there are |
| `node` > `h` + `d` | One component, actor or service. `<i data-icon="name"></i>` inside `h` adds an icon |
| `node accent` | The one node the figure is about |
| `node planned` | Something not in production yet (dashed, with a "Planned" badge) |
| `tags` > `tag` | Properties of a whole layer (`WAF`, `Autoscaling`) |
| `wire` > `label` | A vertical connection between stacked layers |
| `flow` > `layer` + `hwire` > `label` | Steps left to right with horizontal connections |
| `sheet` | A key and value table (`th` and `td`, `<small>` for a second line) |
| `stat` > `v` + `d` | One number that carries the point, with what it counts |
| `meter` | A share of a whole, under a stat or in a sheet cell: `<div class="meter" style="--value: 82%"></div>`. `meter muted` for a share that is not the point |
| `quote` | Text shown verbatim: a message, an error, a log line. It keeps its own punctuation |
| `callout` | One note the reader must not miss |
| `kicker` | A mono label in the accent color above a group |
| `caption` | A small mono note between elements |
| `verdict` | A one-line conclusion after a status dot |
| `hero` > `kicker`, `h2`, `p` | The statement on a card |
| `colophon` | The bottom band |
| `verbatim` | Keeps a name in its own case inside an uppercase label: `<span class="verbatim">publica.la</span>` |

Icons are any [Lucide](https://lucide.dev/icons) name. An unknown name fails the render and suggests similar names. `<code>` inside a node description, a sheet cell or a callout sets a name or a value in mono.

When a figure needs something the vocabulary doesn't have, propose the class in [publicala/claude-plugins](https://github.com/publicala/claude-plugins), built from the same tokens. Inline `style` is for a one-off grid tweak at most, and for a meter's `--value`.

## Colors

The tokens live once in `style/blueprint.css`, in a light and a dark set: `--ink`, `--body`, `--muted`, `--hair`, `--hair-strong`, `--paper`, `--surface`, `--dot`, `--accent`, `--accent-soft`, `--accent-hair`, `--ok` and `--warn`. Figures render in the light set. A page that follows the reader's color mode gets the dark set from `prefers-color-scheme`, or from `data-theme` on its root element.
