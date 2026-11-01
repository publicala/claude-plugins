---
name: diagram
description: Makes standalone figures in Blueprint, publica.la's house style for engineering visuals, rendered to PNG and PDF. Use for system overviews, figures for customer documents and security reviews, spec sheets, social cards and 16:9 slides. Sequence, state and flow diagrams inside a doc whose site renders Mermaid stay in Mermaid.
argument-hint: "[what the figure shows]"
user-invocable: true
disable-model-invocation: false
---

# Diagram

You write a figure as a small HTML source, and the renderer turns it into a PNG. The style lives in one stylesheet, so every figure stays consistent and a style change reaches every figure on its next render.

Before the first figure, read [blueprint.md](../../references/blueprint.md) for the look and the vocabulary, [truth.md](../../references/truth.md) for what a figure may claim and name, and [writing.md](../../references/writing.md) for its text (paths relative to this skill's directory).

## Blueprint or Mermaid

- **Mermaid** stays the default for sequence, state, ER and flow diagrams inside a doc whose site renders Mermaid. They render from text that diffs, and they follow the site's theme. A repository can style its Mermaid in Blueprint colors, and its CLAUDE.md says how.
- **Blueprint** is for standalone figures: system overviews, figures that leave the docs site (customer documents, security reviews, slides), spec sheets and social cards.

## Workflow

1. Put the source next to the doc that uses it, as `img/<name>.diagram.html`. Start from the closest example in `${CLAUDE_SKILL_DIR}/examples/`, and view its PNG first: `layered` (a system in layers), `flow` (steps left to right), `card` (a 1200x630 social card or cover) and `video` (a 16:9 slide built on numbers).
2. Render it. The PNG lands next to the source, at 2x. `--pdf` adds a PDF, for audits and printouts.

   ```bash
   bun ${CLAUDE_PLUGIN_ROOT}/renderer/render.ts path/to/figure.diagram.html --pdf
   ```

   The render fails, and writes nothing, when a check breaks. Its message names the element and the fix.

3. Look at the PNG (read it as an image) and go through "Checked by you". Render again until it passes.
4. Reference the PNG from the doc with alt text that says what the figure shows: `![Platform layers, from clients to data](./img/overview.png)`.
5. Commit the source and the PNG together. The source is what the next person edits.

The renderer runs on [Bun](https://bun.sh) with Chrome or Chromium. It looks at `CHROME_PATH`, Playwright's browsers (`PLAYWRIGHT_BROWSERS_PATH`) and the usual install locations. Claude Code installs its two packages with the plugin. If a render fails on a missing package, run `bun install --cwd ${CLAUDE_PLUGIN_ROOT}` once.

## Checks

Checked by the renderer:

- Nothing runs past the canvas or out of its box, nothing overlaps, and the fonts loaded.
- Node titles fit on one line, and descriptions take two lines at most.
- Both columns of a `split` end at the same height.
- At most 25 nodes, one accent node at most, and a label on every wire.
- `publica.la` never renders in uppercase.
- No em dashes, semicolons or curly quotes outside a `quote` or `code`.

Checked by you:

- Every node, label, tag, spec and number is true today, and each number's source sits in a comment in the source.
- The figure names only what its audience may see.
- The eye lands first on what the figure is about: the accent node, or the biggest number.
- The text is in the audience's language and in sentence case, and labels come from the mono classes.
