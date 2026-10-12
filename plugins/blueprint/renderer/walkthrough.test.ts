import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser } from "puppeteer-core";
import sharp from "sharp";

import { findChrome, launchBrowser } from "./renderer";
import type { SceneTiming } from "./timeline";
import {
  buildWalkthroughPage,
  findTimingProblems,
  main,
  openWalkthrough,
  parseArguments,
  writeVideo,
} from "./walkthrough";

const EXAMPLE = join(
  import.meta.dir,
  "../skills/walkthrough/examples/search-accents.walkthrough.html",
);

const scene = (overrides: Partial<SceneTiming> = {}): SceneTiming => ({
  title: "Scene",
  start: 0,
  end: 5,
  settled: 2,
  fadesOutAt: 4.6,
  words: 10,
  invalidDuration: null,
  ...overrides,
});

const walkthrough = (scenes: string) =>
  `<div class="canvas" data-size="video"><main class="stage">${scenes}</main><footer class="colophon"><span data-fig></span><i class="progress"></i></footer></div>`;

describe("findTimingProblems", () => {
  test("passes scenes that settle before they fade and read at a calm pace", () => {
    expect(
      findTimingProblems({
        duration: 10,
        scenes: [
          scene(),
          scene({ start: 5, end: 10, settled: 5, fadesOutAt: 10 }),
        ],
      }),
    ).toEqual({ problems: [], warnings: [] });
  });

  test("refuses a walkthrough without scenes", () => {
    expect(
      findTimingProblems({ duration: 0, scenes: [] }).problems[0],
    ).toStartWith("The walkthrough has no scenes.");
  });

  test("refuses a duration that is not a number of seconds above zero", () => {
    expect(
      findTimingProblems({
        duration: 5,
        scenes: [scene({ title: "Forever", invalidDuration: "Infinity" })],
      }).problems,
    ).toEqual([
      'Scene 1 ("Forever") has data-duration="Infinity". Write a number of seconds above zero, such as 6.',
    ]);
  });

  test("refuses a scene still moving once it fades, and warns about pace and length", () => {
    expect(
      findTimingProblems({
        duration: 50,
        scenes: [
          scene({ title: "Busy", settled: 4.8, words: 30 }),
          scene({
            title: "Last",
            start: 5,
            end: 50,
            settled: 46,
            fadesOutAt: 50,
          }),
        ],
      }),
    ).toEqual({
      problems: [
        'Scene 1 ("Busy") is still moving at 4.80 s, after it starts fading out at 4.60 s. Bring the reveals forward or lengthen the scene.',
        'Scene 2 ("Last") is still moving at 46.00 s, after it starts fading out at 45.00 s. Bring the reveals forward or lengthen the scene.',
      ],
      warnings: [
        'Scene 1 ("Busy") has 30 words for 5 s (6.0 a second). Viewers read about 4 a second: cut words or give it more time.',
        "The walkthrough runs 50 s. Aim for 25 to 40 s, or make two.",
      ],
    });
  });
});

describe("parseArguments", () => {
  test("reads the source, the outputs and the stills", () => {
    expect(
      parseArguments([
        "a.walkthrough.html",
        "--video",
        "--at",
        "1.5",
        "--player",
        "--at",
        "3",
      ]),
    ).toEqual({
      source: join(process.cwd(), "a.walkthrough.html"),
      video: true,
      player: true,
      stills: [1.5, 3],
    });
  });

  test.each([
    [[], /^Usage/],
    [["a.walkthrough.html", "--at", "soon"], /^--at takes a time in seconds/],
    [["a.walkthrough.html", "--gif"], /^Unknown option '--gif'\./],
    [["a.walkthrough.html", "--at"], /^Option '--at <value>' argument missing/],
    [
      ["a.walkthrough.html", "b.walkthrough.html"],
      /^Render one walkthrough at a time\./,
    ],
  ])("refuses %p", (args, message) => {
    expect(parseArguments(args)).toMatch(message);
  });

  test("main prints the refusal and fails", async () => {
    const error = spyOn(console, "error").mockImplementation(() => undefined);

    try {
      expect(await main(["--gif"])).toBe(1);
      expect(String(error.mock.calls[0]?.[0])).toStartWith(
        "Unknown option '--gif'.",
      );
    } finally {
      error.mockRestore();
    }
  });
});

describe("buildWalkthroughPage", () => {
  test("adds the timeline, and the player's controls when asked", async () => {
    const source = walkthrough('<section class="scene">One</section>');
    const page = await buildWalkthroughPage(source);
    const player = await buildWalkthroughPage(source, { player: true });

    expect(page).toContain("window.walkthrough");
    expect(page).not.toContain('class="controls"');
    expect(player).toContain('<body class="player"><div class="screen">');
    expect(player).toContain('class="controls"');
    expect(player).toContain("<title>Walkthrough</title>");
  });
});

describe.skipIf(!findChrome())("in Chrome", () => {
  let browser: Browser;
  let workDir: string;

  beforeAll(async () => {
    browser = await launchBrowser();
    workDir = await mkdtemp(join(tmpdir(), "walkthrough-test-"));
  });

  afterAll(async () => {
    await browser.close();
    await rm(workDir, { recursive: true, force: true });
  });

  const write = async (name: string, source: string) => {
    const path = join(workDir, `${name}.walkthrough.html`);

    await Bun.write(path, source);

    return path;
  };

  test("the example passes and writes a contact sheet, a still and a player", async () => {
    const source = join(workDir, "example.walkthrough.html");
    const log = spyOn(console, "log").mockImplementation(() => undefined);

    await Bun.write(source, Bun.file(EXAMPLE));

    try {
      expect(await main([source, "--at", "7.3", "--player"])).toBe(0);
      expect(log.mock.calls.flat()).toContain("5 scenes, 31 s");
    } finally {
      log.mockRestore();
    }

    const sheet = await sharp(join(workDir, "example.contact.png")).metadata();
    const still = await sharp(join(workDir, "example.7.3s.png")).metadata();

    expect([sheet.width, sheet.height]).toEqual([1992, 1716]);
    expect([still.width, still.height]).toEqual([1920, 1080]);
    expect(
      await Bun.file(join(workDir, "example.player.html")).text(),
    ).toContain('class="controls"');
  });

  test("the player plays and scrubs", async () => {
    const page = await browser.newPage();
    const read = async (selector: string, expression: string) =>
      (await page.evaluate(
        `document.querySelector(${JSON.stringify(selector)}).${expression}`,
      )) as string;

    try {
      await page.setContent(
        await buildWalkthroughPage(await Bun.file(EXAMPLE).text(), {
          player: true,
        }),
      );
      expect(await read(".controls output", "textContent")).toBe("0:05 / 0:31");

      await page.click(".controls button");
      await Bun.sleep(300);
      expect(await read(".controls button", "getAttribute('aria-label')")).toBe(
        "Pause",
      );
      expect(await read(".controls output", "textContent")).toBe("0:00 / 0:31");

      await page.evaluate(
        "(() => { const input = document.querySelector('.controls input'); input.value = '30.5'; input.dispatchEvent(new Event('input')); })()",
      );
      expect(await read("[data-fig]", "textContent")).toBe("Fig. 5 · Checked");
    } finally {
      await page.close();
    }
  });

  test("reports a scene that runs out of the stage, and timing that cannot work", async () => {
    const tall = await write(
      "tall",
      walkthrough(
        '<section class="scene" data-duration="2" data-title="Tall"><div class="callout" data-in="1.8" style="min-height: 900px">Tall</div></section>',
      ),
    );
    const error = spyOn(console, "error").mockImplementation(() => undefined);

    try {
      expect(await main([tall])).toBe(1);
      expect(String(error.mock.calls[0]?.[0])).toContain(
        'Scene 1 ("Tall") is still moving at 2.35 s',
      );
      expect(String(error.mock.calls[0]?.[0])).toContain(
        'Scene 1: "Tall" runs out of the stage.',
      );
    } finally {
      error.mockRestore();
    }
  });

  test("checks each scene without the others", async () => {
    const accents = await write(
      "accents",
      walkthrough(
        '<section class="scene" data-title="One"><div class="node accent"><div class="h">One</div></div></section><section class="scene" data-title="Two"><div class="node accent"><div class="h">Two</div></div></section>',
      ),
    );
    const log = spyOn(console, "log").mockImplementation(() => undefined);

    try {
      expect(await main([accents])).toBe(0);
    } finally {
      log.mockRestore();
    }
  });

  test("names a broken source", async () => {
    const broken = await write("broken", "<div>No canvas</div>");
    const error = spyOn(console, "error").mockImplementation(() => undefined);

    try {
      expect(await main([broken])).toBe(1);
      expect(String(error.mock.calls[0]?.[0])).toContain(
        "exactly one element with the canvas class",
      );
    } finally {
      error.mockRestore();
    }
  });

  test.skipIf(!Bun.which("ffmpeg"))("encodes an H.264 video", async () => {
    const short = await write(
      "short",
      walkthrough(
        '<section class="scene" data-duration="0.5" data-title="Short"><div class="callout">Short</div></section>',
      ),
    );
    const log = spyOn(console, "log").mockImplementation(() => undefined);

    try {
      expect(await main([short, "--video"])).toBe(0);
      expect(log.mock.calls.flat().join("\n")).toContain(
        "short.mp4 (15 frames, 1920x1080, 30 fps)",
      );
    } finally {
      log.mockRestore();
    }
  });

  test("names ffmpeg when it is missing", async () => {
    const which = spyOn(Bun, "which").mockReturnValue(null);
    const opened = await openWalkthrough(browser, EXAMPLE);

    try {
      expect(writeVideo(opened, join(workDir, "none.mp4"))).rejects.toThrow(
        "Unable to find ffmpeg",
      );
    } finally {
      which.mockRestore();
      await opened.page.close();
    }
  });
});
