#!/usr/bin/env bun

// Renders a Blueprint walkthrough: a short, silent video built from scenes.
// Every run checks each scene like a figure and checks the timing, then
// writes a contact sheet with one frame per scene. --video adds the mp4,
// --player a self-contained page that plays it, and --at a still.
import { spawn } from "node:child_process";
import { relative, resolve } from "node:path";
import type { Browser, Page } from "puppeteer-core";
import sharp from "sharp";

import { findFigureProblems } from "./checks";
import { measureFigure } from "./measure";
import { buildFigurePage, launchBrowser } from "./renderer";
import { installTimeline, isolateScene, type SceneTiming } from "./timeline";

const SOURCE_SUFFIX = ".walkthrough.html";
const WIDTH = 1280;
const HEIGHT = 720;
const SCALE = 1.5;
const FPS = 30;

// A heuristic: viewers read about 4 words a second, and labels go faster.
const WORDS_PER_SECOND = 5;
const LONGEST = 45;

const USAGE =
  "Usage: bun walkthrough.ts <name.walkthrough.html> [--video] [--player] [--at <seconds>]";

export interface Timing {
  duration: number;
  fade: number;
  scenes: SceneTiming[];
}

export function outputPathFor(sourcePath: string, suffix: string): string {
  if (!sourcePath.endsWith(SOURCE_SUFFIX)) {
    throw new Error(
      `Walkthrough sources end in ${SOURCE_SUFFIX}, got: ${sourcePath}`,
    );
  }

  return sourcePath.slice(0, -SOURCE_SUFFIX.length) + suffix;
}

export async function buildWalkthroughPage(
  source: string,
  { player = false }: { player?: boolean } = {},
): Promise<string> {
  const page = await buildFigurePage(source);
  const timeline = `<script>(${installTimeline.toString()})();</script>`;

  if (!player) {
    return page.replace("</body>", `${timeline}</body>`);
  }

  const chrome = await Bun.file(`${import.meta.dir}/player.html`).text();
  const [head = "", controls = ""] = chrome.split("<!-- walkthrough -->");

  return page
    .replace("<title>Figure</title>", "<title>Walkthrough</title>")
    .replace("</head>", `${head}</head>`)
    .replace("<body>", '<body class="player"><div class="screen">')
    .replace("</body>", `</div>${timeline}${controls}</body>`);
}

/** Problems that stop the render, and warnings it prints. */
export function findTimingProblems({ duration, fade, scenes }: Timing): {
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

  scenes.forEach(({ title, start, end, settled, words }, index) => {
    const name = `Scene ${index + 1} ("${title}")`;
    const length = end - start;
    const still = index === scenes.length - 1 ? length : length - fade;
    const pace = words / length;

    if (settled > still) {
      problems.push(
        `${name} is still moving at ${settled.toFixed(2)} s, after it starts fading out at ${still.toFixed(2)} s. Bring the reveals forward or lengthen the scene.`,
      );
    }

    if (pace > WORDS_PER_SECOND) {
      warnings.push(
        `${name} has ${words} words for ${length} s (${pace.toFixed(1)} a second). Viewers read about 4 a second: cut words or give it more time.`,
      );
    }
  });

  if (duration > LONGEST) {
    warnings.push(
      `The walkthrough runs ${duration} s. Aim for 25 to 40 s, or make two.`,
    );
  }

  return { problems, warnings };
}

export interface OpenWalkthrough {
  page: Page;
  timing: Timing;
}

export async function openWalkthrough(
  browser: Browser,
  sourcePath: string,
): Promise<OpenWalkthrough> {
  const html = await buildWalkthroughPage(await Bun.file(sourcePath).text());
  const page = await browser.newPage();

  await page.setViewport({
    width: WIDTH,
    height: HEIGHT,
    deviceScaleFactor: SCALE,
  });
  await page.emulateMediaFeatures([
    { name: "prefers-color-scheme", value: "light" },
  ]);
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate("document.fonts.ready");

  const timing = (await page.evaluate(
    "({ duration: walkthrough.duration, fade: walkthrough.fade, scenes: walkthrough.scenes })",
  )) as Timing;

  return { page, timing };
}

/** The moment a scene shows everything, before it starts fading out. */
export function settledAt({ fade, scenes }: Timing, index: number): number {
  const scene = scenes[index];

  if (scene === undefined) {
    throw new Error(`The walkthrough has no scene ${index + 1}.`);
  }

  const last = index === scenes.length - 1;

  return scene.end - (last ? 0 : fade) - 0.01;
}

export async function findSceneProblems({
  page,
  timing,
}: OpenWalkthrough): Promise<string[]> {
  const problems: string[] = [];

  for (const [index] of timing.scenes.entries()) {
    await page.evaluate(isolateScene, index);
    await renderAt(page, settledAt(timing, index));

    for (const problem of findFigureProblems(
      await page.evaluate(measureFigure),
    )) {
      problems.push(`Scene ${index + 1}: ${problem}`);
    }
  }

  await page.evaluate(isolateScene, -1);

  return problems;
}

async function renderAt(page: Page, t: number): Promise<void> {
  await page.evaluate(`walkthrough.render(${t})`);
}

async function frameAt(page: Page, t: number): Promise<Uint8Array> {
  await renderAt(page, t);

  return page.screenshot({
    type: "png",
    clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
  });
}

export async function writeContactSheet(
  { page, timing }: OpenWalkthrough,
  path: string,
): Promise<void> {
  const columns = 2;
  const gap = 24;
  const tile = { width: WIDTH * 0.75, height: HEIGHT * 0.75 };
  const rows = Math.ceil(timing.scenes.length / columns);
  const tiles = [];

  for (const [index] of timing.scenes.entries()) {
    const frame = await frameAt(page, settledAt(timing, index));

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

export async function writeStill(
  { page }: OpenWalkthrough,
  t: number,
  path: string,
): Promise<void> {
  await Bun.write(path, await frameAt(page, t));
}

export async function writeVideo(
  { page, timing }: OpenWalkthrough,
  path: string,
): Promise<number> {
  const ffmpeg = Bun.which("ffmpeg");

  if (ffmpeg === null) {
    throw new Error(
      "Unable to find ffmpeg. Install it (brew install ffmpeg, or apt install ffmpeg), or leave out --video: the contact sheet and --player need no ffmpeg.",
    );
  }

  const encoder = spawn(
    ffmpeg,
    [
      ["-y", "-loglevel", "error"],
      ["-f", "image2pipe", "-framerate", String(FPS), "-i", "-"],
      ["-c:v", "libx264", "-preset", "slow", "-crf", "16"],
      ["-pix_fmt", "yuv420p", "-movflags", "+faststart", path],
    ].flat(),
    { stdio: ["pipe", "inherit", "inherit"] },
  );
  const finished = new Promise<number | null>((resolve) =>
    encoder.on("close", resolve),
  );
  const frames = Math.round(timing.duration * FPS);

  for (let frame = 0; frame < frames; frame++) {
    if (!encoder.stdin.write(await frameAt(page, frame / FPS))) {
      await new Promise((resolve) => encoder.stdin.once("drain", resolve));
    }
  }

  encoder.stdin.end();

  if ((await finished) !== 0) {
    throw new Error(`ffmpeg could not encode ${path}. Its errors are above.`);
  }

  return frames;
}

interface Options {
  source: string;
  video: boolean;
  player: boolean;
  stills: number[];
}

export function parseArguments(args: string[]): Options | string {
  const options: Options = {
    source: "",
    video: false,
    player: false,
    stills: [],
  };

  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? "";

    if (arg === "--video" || arg === "--player") {
      options[arg === "--video" ? "video" : "player"] = true;
    } else if (arg === "--at") {
      const seconds = Number(args[++index]);

      if (!Number.isFinite(seconds) || seconds < 0) {
        return `--at takes a time in seconds, such as --at 12.5.\n${USAGE}`;
      }

      options.stills.push(seconds);
    } else if (arg.startsWith("--")) {
      return `Unknown option ${arg}.\n${USAGE}`;
    } else if (options.source === "") {
      options.source = resolve(arg);
    } else {
      return `Render one walkthrough at a time.\n${USAGE}`;
    }
  }

  return options.source === "" ? USAGE : options;
}

export async function main(args: string[]): Promise<number> {
  const options = parseArguments(args);

  if (typeof options === "string") {
    console.error(options);

    return 1;
  }

  const name = (path: string) => relative(process.cwd(), path);
  const browser = await launchBrowser();

  try {
    const walkthrough = await openWalkthrough(browser, options.source);
    const { problems, warnings } = findTimingProblems(walkthrough.timing);

    problems.push(...(await findSceneProblems(walkthrough)));

    for (const warning of warnings) {
      console.warn(`Warning: ${warning}`);
    }

    if (problems.length > 0) {
      console.error(
        `${name(options.source)} did not render:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`,
      );

      return 1;
    }

    const { scenes, duration } = walkthrough.timing;
    const contact = outputPathFor(options.source, ".contact.png");

    console.log(`${scenes.length} scenes, ${duration} s`);
    await writeContactSheet(walkthrough, contact);
    console.log(name(contact));

    for (const t of options.stills) {
      const still = outputPathFor(options.source, `.${t}s.png`);

      await writeStill(walkthrough, t, still);
      console.log(name(still));
    }

    if (options.player) {
      const player = outputPathFor(options.source, ".player.html");

      await Bun.write(
        player,
        await buildWalkthroughPage(await Bun.file(options.source).text(), {
          player: true,
        }),
      );
      console.log(name(player));
    }

    if (options.video) {
      const video = outputPathFor(options.source, ".mp4");
      const frames = await writeVideo(walkthrough, video);

      console.log(`${name(video)} (${frames} frames, 1920x1080, ${FPS} fps)`);
    }

    return 0;
  } catch (error) {
    console.error(
      `${name(options.source)} did not render:\n${(error as Error).message}`,
    );

    return 1;
  } finally {
    await browser.close();
  }
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
