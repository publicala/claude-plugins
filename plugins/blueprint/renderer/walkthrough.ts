#!/usr/bin/env bun

// Renders a Blueprint walkthrough: a short, silent video built from scenes.
// Every run checks each scene like a figure and checks the timing, then
// writes a contact sheet with one frame per scene. --video adds the mp4,
// --player a self-contained page that plays it, and --at a still.
import { availableParallelism } from "node:os";
import { relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { Browser, Page } from "puppeteer-core";
import sharp from "sharp";

import { findFigureProblems, type Measurement } from "./checks";
import { measureFigure } from "./measure";
import { outputPathFor } from "./page";
import { bundlePageScript } from "./page-script";
import { buildFigurePage, launchBrowser, openPage } from "./renderer";
import {
  installTimeline,
  isolateScene,
  readTiming,
  renderFrame,
  showAllScenes,
  type Timing,
} from "./timeline";

const SOURCE_SUFFIX = ".walkthrough.html";
const WIDTH = 1280;
const HEIGHT = 720;
const SCALE = 1.5;
const FPS = 30;
// A screenshot keeps a core busy, so more browsers split the frames between
// them. ffmpeg needs a core too, and on four cores three browsers did about as
// well as four.
const CAPTURE_BROWSERS = Math.min(4, Math.max(1, availableParallelism() - 1));

const MAX_WORDS_PER_SECOND = 5;
const MAX_DURATION_SECONDS = 45;

const TIMELINE = `<script>(${installTimeline.toString()})();</script>`;
const PLAYER_STYLE = /<style>[\s\S]*?<\/style>\s*/;
const PLAYER_SCRIPT_PLACEHOLDER = "/*__PLAYER_SCRIPT__*/";

const USAGE =
  "Usage: bun walkthrough.ts <name.walkthrough.html> [--video] [--player] [--at <seconds>]";

export async function buildWalkthroughPage(source: string): Promise<string> {
  return buildFigurePage(source, {
    wrapBody: (figure) => `${figure}${TIMELINE}`,
  });
}

let playerScript: Promise<string> | undefined;

// player.html starts with the player's style, which goes in the head. The
// rest wraps the figure, which fills the slot in .screen, and runs the
// script bundled from player.ts.
export async function buildPlayerPage(source: string): Promise<string> {
  playerScript ??= bundlePageScript(`${import.meta.dir}/player.ts`);
  const [player, script] = await Promise.all([
    Bun.file(`${import.meta.dir}/player.html`).text(),
    playerScript,
  ]);
  const style = PLAYER_STYLE.exec(player)?.[0] ?? "";

  return buildFigurePage(source, {
    title: "Walkthrough",
    head: style,
    bodyClass: "player",
    wrapBody: (figure) =>
      player
        .replace(style, "")
        .replace(PLAYER_SCRIPT_PLACEHOLDER, () => script)
        .replace("<!-- figure -->", () => `${figure}${TIMELINE}`),
  });
}

export function judgeTiming({
  duration,
  scenes,
}: Pick<Timing, "duration" | "scenes">): {
  problems: string[];
  warnings: string[];
} {
  if (scenes.length === 0) {
    return {
      problems: [
        'The walkthrough has no scenes. Put each one in <section class="scene" data-duration="5" data-title="..."> inside <main class="stage">.',
      ],
      warnings: [],
    };
  }

  const problems: string[] = [];
  const warnings: string[] = [];

  scenes.forEach(
    (
      { title, start, end, settled, fadesOutAt, words, invalidDuration },
      index,
    ) => {
      const name = `Scene ${index + 1} ("${title}")`;

      if (invalidDuration !== null) {
        problems.push(
          `${name} has data-duration="${invalidDuration}". Write a number of seconds above zero, such as 6.`,
        );
      }

      const length = end - start;
      const pace = words / length;

      if (start + settled > fadesOutAt) {
        problems.push(
          `${name} is still moving at ${settled.toFixed(2)} s, after it starts fading out at ${(fadesOutAt - start).toFixed(2)} s. Bring the reveals forward or lengthen the scene.`,
        );
      }

      if (pace > MAX_WORDS_PER_SECOND) {
        warnings.push(
          `${name} has ${words} words for ${length} s (${pace.toFixed(1)} a second). Viewers read about 4 a second: cut words or give it more time.`,
        );
      }
    },
  );

  if (duration > MAX_DURATION_SECONDS) {
    warnings.push(
      `The walkthrough runs ${duration} s. Aim for 25 to 40 s, or make two.`,
    );
  }

  return { problems, warnings };
}

interface OpenWalkthrough {
  page: Page;
  timing: Timing;
  html: string;
}

const VIEWPORT = { width: WIDTH, height: HEIGHT, scale: SCALE };

export async function openWalkthrough(
  browser: Browser,
  sourcePath: string,
): Promise<OpenWalkthrough> {
  const html = await buildWalkthroughPage(await Bun.file(sourcePath).text());
  const page = await openPage(browser, html, VIEWPORT);

  return { page, timing: await page.evaluate(readTiming), html };
}

// Slack, GitHub and file browsers take the first frame as the thumbnail, and
// at 0 s the stage is still empty. So the first frame shows the poster, as the
// player does while paused. It lasts 1/30 s, and a viewer who pressed play was
// already looking at it.
export function frameTime(poster: number, frame: number): number {
  return frame === 0 ? poster : frame / FPS;
}

// Every frame is captured at 1280x720, so a canvas of any other size would
// lose its edges in the video and the player.
export function findCanvasProblems({ elements }: Measurement): string[] {
  const canvas = elements.find(({ classes }) => classes.includes("canvas"));

  if (canvas === undefined) {
    return [];
  }

  const width = Math.round(canvas.box.right - canvas.box.left);
  const height = Math.round(canvas.box.bottom - canvas.box.top);

  if (width === WIDTH && height === HEIGHT) {
    return [];
  }

  return [
    `The canvas is ${width}x${height}, and a walkthrough plays at ${WIDTH}x${HEIGHT}. Give the canvas data-size="video".`,
  ];
}

async function findSceneProblems({
  page,
  timing,
}: OpenWalkthrough): Promise<string[]> {
  const problems: string[] = [];

  for (const [index, scene] of timing.scenes.entries()) {
    await page.evaluate(isolateScene, index);
    await page.evaluate(renderFrame, scene.fullAt);

    for (const problem of findFigureProblems(
      await page.evaluate(measureFigure),
    )) {
      problems.push(`Scene ${index + 1}: ${problem}`);
    }
  }

  await page.evaluate(showAllScenes);

  return problems;
}

// optimizeForSpeed compresses the PNG less, which makes the capture about a
// quarter faster and the file about twice as big, with the same pixels.
async function frameAt(page: Page, t: number): Promise<Uint8Array> {
  await page.evaluate(renderFrame, t);

  return page.screenshot({
    type: "png",
    clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
    optimizeForSpeed: true,
  });
}

async function writeContactSheet(
  { page, timing }: OpenWalkthrough,
  path: string,
): Promise<void> {
  const columns = 2;
  const gap = 24;
  const tile = { width: WIDTH * 0.75, height: HEIGHT * 0.75 };
  const rows = Math.ceil(timing.scenes.length / columns);
  const tiles = [];

  for (const [index, scene] of timing.scenes.entries()) {
    const frame = await frameAt(page, scene.fullAt);

    tiles.push({
      input: await sharp(frame).resize(tile.width, tile.height).toBuffer(),
      left: gap + (index % columns) * (tile.width + gap),
      top: gap + Math.floor(index / columns) * (tile.height + gap),
    });
  }

  await sharp({
    create: {
      width: gap + columns * (tile.width + gap),
      height: gap + rows * (tile.height + gap),
      channels: 3,
      background: "#e4e4e7",
    },
  })
    .composite(tiles)
    .png()
    .toFile(path);
}

// The walkthrough's own page captures too, and each extra browser opens the
// same page. Extra tabs in one browser would stall, since Chrome doesn't paint
// a tab in the background.
export async function writeVideo(
  { page, timing, html }: OpenWalkthrough,
  path: string,
  browsers = CAPTURE_BROWSERS,
): Promise<number> {
  const ffmpeg = Bun.which("ffmpeg");

  if (ffmpeg === null) {
    throw new Error(
      "Unable to find ffmpeg. Install it (brew install ffmpeg, or apt install ffmpeg), or leave out --video: the contact sheet and --player need no ffmpeg.",
    );
  }

  // allSettled waits for every launch, so one that fails can't leave the
  // others running.
  const launches = await Promise.allSettled(
    Array.from({ length: browsers - 1 }, () => launchBrowser()),
  );
  const extraBrowsers = launches
    .filter((launch) => launch.status === "fulfilled")
    .map(({ value }) => value);

  try {
    for (const launch of launches) {
      if (launch.status === "rejected") {
        throw launch.reason;
      }
    }

    const pages = [
      page,
      ...(await Promise.all(
        extraBrowsers.map((browser) => openPage(browser, html, VIEWPORT)),
      )),
    ];
    // At the same quality as slow, medium encodes 40% faster, and slow would
    // keep the browsers waiting.
    const encoder = Bun.spawn(
      [
        [ffmpeg, "-y", "-loglevel", "error"],
        ["-f", "image2pipe", "-framerate", String(FPS), "-i", "-"],
        ["-c:v", "libx264", "-preset", "medium", "-crf", "16"],
        ["-pix_fmt", "yuv420p", "-movflags", "+faststart", path],
      ].flat(),
      { stdin: "pipe", stdout: "inherit", stderr: "inherit" },
    );
    const frames = Math.round(timing.duration * FPS);
    const captured = Array.from({ length: frames }, () =>
      Promise.withResolvers<Uint8Array>(),
    );
    // Each page takes every nth frame, so the pages move through the video
    // together and the encoder seldom waits for the next frame.
    const capturing = Promise.all(
      pages.map(async (capturer, first) => {
        for (let frame = first; frame < frames; frame += pages.length) {
          captured[frame]?.resolve(
            await frameAt(capturer, frameTime(timing.poster, frame)),
          );
        }
      }),
    );

    for (const { promise } of captured) {
      // A failed capture leaves its frame unresolved, so the race ends the
      // wait with the capture's error.
      await encoder.stdin.write(
        await Promise.race([promise, capturing.then(() => promise)]),
      );
      await encoder.stdin.flush();
    }

    await encoder.stdin.end();

    if ((await encoder.exited) !== 0) {
      throw new Error(`ffmpeg could not encode ${path}. Its errors are above.`);
    }

    return frames;
  } finally {
    await Promise.all(extraBrowsers.map((browser) => browser.close()));
  }
}

interface Options {
  source: string;
  video: boolean;
  player: boolean;
  stills: number[];
}

function parseCommandLine(args: string[]) {
  try {
    return parseArgs({
      args,
      allowPositionals: true,
      options: {
        video: { type: "boolean", default: false },
        player: { type: "boolean", default: false },
        at: { type: "string", multiple: true, default: [] },
      },
    });
  } catch (error) {
    return `${(error as Error).message}\n${USAGE}`;
  }
}

export function parseArguments(args: string[]): Options | string {
  const commandLine = parseCommandLine(args);

  if (typeof commandLine === "string") {
    return commandLine;
  }

  const { values, positionals } = commandLine;
  const stills = values.at.map(Number);

  if (stills.some((seconds) => !Number.isFinite(seconds) || seconds < 0)) {
    return `--at takes a time in seconds, such as --at 12.5.\n${USAGE}`;
  }

  if (positionals.length > 1) {
    return `Render one walkthrough at a time.\n${USAGE}`;
  }

  const [source] = positionals;

  if (source === undefined) {
    return USAGE;
  }

  return {
    source: resolve(source),
    video: values.video,
    player: values.player,
    stills,
  };
}

export async function main(args: string[]): Promise<number> {
  const options = parseArguments(args);

  if (typeof options === "string") {
    console.error(options);

    return 1;
  }

  const displayPath = (path: string) => relative(process.cwd(), path);
  const browser = await launchBrowser();

  try {
    const walkthrough = await openWalkthrough(browser, options.source);
    const { problems, warnings } = judgeTiming(walkthrough.timing);

    problems.push(
      ...findCanvasProblems(await walkthrough.page.evaluate(measureFigure)),
      ...(await findSceneProblems(walkthrough)),
    );

    for (const warning of warnings) {
      console.warn(`Warning: ${warning}`);
    }

    if (problems.length > 0) {
      console.error(
        `${displayPath(options.source)} did not render:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`,
      );

      return 1;
    }

    const { scenes, duration } = walkthrough.timing;
    const contact = outputPathFor(
      options.source,
      SOURCE_SUFFIX,
      ".contact.png",
    );

    console.log(`${scenes.length} scenes, ${duration} s`);
    await writeContactSheet(walkthrough, contact);
    console.log(displayPath(contact));

    for (const t of options.stills) {
      const still = outputPathFor(options.source, SOURCE_SUFFIX, `.${t}s.png`);

      await Bun.write(still, await frameAt(walkthrough.page, t));
      console.log(displayPath(still));
    }

    if (options.player) {
      const player = outputPathFor(
        options.source,
        SOURCE_SUFFIX,
        ".player.html",
      );

      await Bun.write(
        player,
        await buildPlayerPage(await Bun.file(options.source).text()),
      );
      console.log(displayPath(player));
    }

    if (options.video) {
      const video = outputPathFor(options.source, SOURCE_SUFFIX, ".mp4");
      const frames = await writeVideo(walkthrough, video);

      console.log(
        `${displayPath(video)} (${frames} frames, ${WIDTH * SCALE}x${HEIGHT * SCALE}, ${FPS} fps)`,
      );
    }

    return 0;
  } catch (error) {
    console.error(
      `${displayPath(options.source)} did not render:\n${(error as Error).message}`,
    );

    return 1;
  } finally {
    await browser.close();
  }
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
