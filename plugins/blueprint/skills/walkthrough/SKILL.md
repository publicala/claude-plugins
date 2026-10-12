---
name: walkthrough
description: >
  Makes a short, silent walkthrough video in Blueprint (about 30 s, a 1920x1080 mp4) that explains a fix, a feature, an incident or a design: a few scenes, each one a figure that builds up on screen. Use when someone wants to show or explain a change in a video, for Slack, a demo or a PR.
argument-hint: "[what to explain, and to whom]"
user-invocable: true
disable-model-invocation: false
---

# Walkthrough

A walkthrough tells one story in about 30 seconds, without sound, so it lands while it autoplays muted in Slack. Each scene is a Blueprint figure that builds up in front of the viewer. You write one HTML source, and the renderer checks every scene, then writes a contact sheet, the mp4 and, when you want a link, a player page.

Before the first scene, read [blueprint.md](../../references/blueprint.md) for the look and the vocabulary, [truth.md](../../references/truth.md) for what a scene may claim and name, and [writing.md](../../references/writing.md) for the language and the voice (paths relative to this skill's directory).

## The story

Five to seven scenes, 25 to 40 seconds. Start from this arc and drop what the story doesn't need:

1. **The problem**, as the user saw it: one sentence, and a spec sheet of the key facts.
2. **What happened**: the mechanism, as a stack of layers with labeled wires.
3. **The impact**: two or three numbers.
4. **The cause**, when the mechanism doesn't already show it.
5. **The fix**, with the accent on the piece that matters.
6. **The proof**: how it was checked, and what's still open.

Gather the facts before the first scene: every number with the query, command or file it came from, in a comment at the top of the source. Check each one again before the final render. A number in a video travels further than a number in a PR.

The audience picks the language. When it's unclear who will watch, ask.

## The source

One file, `<name>.walkthrough.html`, next to what it explains or in the scratchpad. Start from `${CLAUDE_SKILL_DIR}/examples/search-accents.walkthrough.html`, and look at `search-accents.contact.png` next to it first.

```html
<div class="canvas" data-size="video" lang="es">
  <header class="masthead" data-in="0.1">...</header>
  <main class="stage">
    <section class="scene" data-duration="6" data-title="Qué pasaba">
      <!-- One figure, from the vocabulary in blueprint.md -->
    </section>
  </main>
  <footer class="colophon">
    <span>...</span><span data-fig></span><i class="progress"></i>
  </footer>
</div>
```

A scene stacks what it holds in one column, centered on the stage. `scene split` lays it out like `split` instead, with a side column on the right.

Times are in seconds, counted from the start of the element's scene:

| Attribute | Effect |
| --- | --- |
| `data-duration` on a scene | How long the scene stays (5 when unset). Scenes play in order and cross-fade |
| `data-title` on a scene | Its name in the colophon's `data-fig`: "Fig. 2 · Qué pasaba" |
| `data-in` | The element fades in and rises into place. Outside the scenes, it counts from the start of the video |
| `data-draw` on a `wire` or `hwire` | The wire draws itself, and the arrowhead lands last |
| `data-count` | The number in the element's text counts up from zero as the element appears (or at `data-at`), with its own separators: `<div class="v" data-count>5.150</div>` |
| A `meter` in a scene | Fills to its `--value` as it appears |
| `progress` in the colophon | Fills as the video plays |

Write every text final. Counts end on it, and the checks measure it.

## Render

```bash
bun ${CLAUDE_PLUGIN_ROOT}/renderer/walkthrough.ts name.walkthrough.html
bun ${CLAUDE_PLUGIN_ROOT}/renderer/walkthrough.ts name.walkthrough.html --at 7.5
bun ${CLAUDE_PLUGIN_ROOT}/renderer/walkthrough.ts name.walkthrough.html --video --player
```

The first run checks the scenes and writes `name.contact.png`, one frame per scene, in about two seconds. Read it as an image after every change. `--at` writes a still at that second, to check a moment mid-animation. Render `--video` once the sheet is right: `name.mp4` takes about three seconds per second of video and needs ffmpeg. `--player` writes `name.player.html`, which needs nothing else.

Checked by the renderer:

- Each scene passes every figure check in [the diagram skill](../diagram/SKILL.md), alone, once it settles.
- Nothing runs out of the stage, and every scene settles before it starts fading out.
- It warns when a scene asks for more than 5 words a second (people read about 4), or when the video runs past 45 seconds. Both are rules of thumb. Fix them unless the extra words are labels a viewer only glances at.

Checked by you:

- The story makes sense with the sound off, and each scene says one thing.
- The accent node or the biggest number sits on what the scene is about.
- Every number matches its source.

## Deliver

- Send the mp4, with the contact sheet when it helps the reader skim.
- Write the message that carries it, ready to paste, in the audience's language ([writing.md](../../references/writing.md)).
- For a link, publish `name.player.html` as an Artifact when the session can. It plays and scrubs in the browser, and follows the reader's color mode.
- Keep the source. The next walkthrough starts from it.
