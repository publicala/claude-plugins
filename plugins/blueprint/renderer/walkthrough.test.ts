import {
  afterAll,
  beforeAll,
  describe,
  expect,
  setDefaultTimeout,
  spyOn,
  test,
} from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser } from "puppeteer-core";
import sharp from "sharp";

import { launchBrowser } from "./renderer";
import { hasChrome, hasFfmpeg } from "./test-tools";
import type { SceneTiming } from "./timeline";
import {
  buildPlayerPage,
  buildWalkthroughPage,
  findCanvasProblems,
  frameTime,
  judgeTiming,
  main,
  openWalkthrough,
  parseArguments,
  writeVideo,
} from "./walkthrough";

// Chrome starts and renders slower on CI's macOS runners than Bun's 5 s default.
setDefaultTimeout(30_000);

const chromeFound = await hasChrome();
const ffmpegFound = hasFfmpeg();

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
  fullAt: 4.59,
  words: 10,
  invalidDuration: null,
  ...overrides,
});

const walkthrough = (scenes: string) =>
  `<div class="canvas" data-size="video"><main class="stage">${scenes}</main><footer class="colophon"><span data-fig></span><i class="progress"></i></footer></div>`;

// Chrome on macOS can render a few channel values one level apart in two
// captures of the same frame, so two frames match when no channel differs by
// more than this.
const SAME_FRAME = 2;

// The stand-in encoder keeps the PNGs it receives back to back, and each ends
// with its IEND chunk.
function pngFrames(stream: Uint8Array): Uint8Array[] {
  const end = [0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];
  const frames: Uint8Array[] = [];
  let start = 0;

  for (let at = 0; at + end.length <= stream.length; at++) {
    if (end.every((byte, offset) => stream[at + offset] === byte)) {
      frames.push(stream.subarray(start, at + end.length));
      start = at + end.length;
    }
  }

  return frames;
}

async function largestChannelDifference(
  a: Uint8Array,
  b: Uint8Array,
): Promise<number> {
  const [first, second] = await Promise.all(
    [a, b].map((png) => sharp(png).raw().toBuffer()),
  );
  let largest = first?.length === second?.length ? 0 : Infinity;

  for (const [index, value] of (first ?? []).entries()) {
    largest = Math.max(largest, Math.abs(value - (second?.[index] ?? 0)));
  }

  return largest;
}

const measurement = (right: number, bottom: number) => ({
  failedFonts: [],
  overflow: { x: 0, y: 0 },
  texts: [],
  elements: [
    {
      parent: -1,
      classes: ["canvas"],
      tag: "div",
      text: "",
      box: { left: 0, top: 0, right, bottom },
      scrollWidth: right,
      clientWidth: right,
      scrollHeight: bottom,
      clientHeight: bottom,
      fontSize: 16,
      lineHeight: 20,
    },
  ],
});

describe("findCanvasProblems", () => {
  test("passes a video canvas", () => {
    expect(findCanvasProblems(measurement(1280, 720))).toEqual([]);
  });

  test("refuses any other size, which the frames would crop", () => {
    expect(findCanvasProblems(measurement(1080, 1080))).toEqual([
      'The canvas is 1080x1080, and a walkthrough plays at 1280x720. Give the canvas data-size="video".',
    ]);
  });
});

describe("judgeTiming", () => {
  test("passes scenes that settle before they fade and read at a calm pace", () => {
    expect(
      judgeTiming({
        duration: 10,
        scenes: [
          scene(),
          scene({ start: 5, end: 10, settled: 5, fadesOutAt: 10 }),
        ],
      }),
    ).toEqual({ problems: [], warnings: [] });
  });

  test("refuses a walkthrough without scenes", () => {
    expect(judgeTiming({ duration: 0, scenes: [] }).problems[0]).toStartWith(
      "The walkthrough has no scenes.",
    );
  });

  test("refuses a duration that is not a number of seconds above zero", () => {
    expect(
      judgeTiming({
        duration: 5,
        scenes: [scene({ title: "Forever", invalidDuration: "Infinity" })],
      }).problems,
    ).toEqual([
      'Scene 1 ("Forever") has data-duration="Infinity". Write a number of seconds above zero, such as 6.',
    ]);
  });

  test("refuses a scene still moving once it fades, and warns about pace and length", () => {
    expect(
      judgeTiming({
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

describe("frameTime", () => {
  test("opens on the poster, then plays from the start", () => {
    expect([0, 1, 2].map((frame) => frameTime(4.59, frame))).toEqual([
      4.59,
      1 / 30,
      2 / 30,
    ]);
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

describe("building the pages", () => {
  const source = walkthrough('<section class="scene">One</section>');

  test("buildWalkthroughPage adds the timeline to the figure", async () => {
    const page = await buildWalkthroughPage(source);

    expect(page).toContain("window.walkthrough");
    expect(page).not.toContain('class="controls"');
  });

  test("buildPlayerPage puts the figure on the player's screen, above its controls", async () => {
    const player = await buildPlayerPage(source);

    expect(player).toContain("<title>Walkthrough</title>");
    expect(player).toMatch(/<style>\s*body\.player[^]*<\/head>/);
    expect(player).toContain('<body class="player"><div class="screen">');
    expect(player).toContain("window.walkthrough");
    expect(player).toContain(
      '<span class="play"><svg class="icon" viewBox="0 0 24 24"',
    );
    expect(player).not.toContain("<!-- figure -->");
    expect(player).not.toContain("/*__PLAYER_SCRIPT__*/");
    expect(player).toContain('playing ? "Pause" : "Play"');
  });
});

describe.skipIf(!chromeFound)("in Chrome", () => {
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
    const read = (selector: string, expression: string) =>
      page.evaluate(
        `document.querySelector(${JSON.stringify(selector)}).${expression}`,
      );

    try {
      await page.setContent(
        await buildPlayerPage(await Bun.file(EXAMPLE).text()),
      );
      expect(await read(".controls output", "textContent")).toBe("0:05 / 0:31");

      await page.click(".controls button");
      await page.waitForFunction(
        "document.querySelector('.controls output').textContent.startsWith('0:00')",
      );
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

  test.skipIf(!ffmpegFound)("encodes an H.264 video", async () => {
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

  test("pipes every frame to ffmpeg, and names an encoder that fails", async () => {
    const short = await write(
      "piped",
      walkthrough(
        '<section class="scene" data-duration="0.5" data-title="Short"><div class="callout">Short</div></section>',
      ),
    );
    // A stand-in for ffmpeg, so the encoding path runs where ffmpeg is missing.
    const encoder = join(workDir, "ffmpeg");
    const which = spyOn(Bun, "which").mockReturnValue(encoder);
    const log = spyOn(console, "log").mockImplementation(() => undefined);
    const error = spyOn(console, "error").mockImplementation(() => undefined);

    try {
      await Bun.write(
        encoder,
        '#!/bin/sh\ncat > /dev/null\nfor last; do :; done\n: > "$last"\n',
      );
      await chmod(encoder, 0o755);
      expect(await main([short, "--video"])).toBe(0);
      expect(log.mock.calls.flat().join("\n")).toContain(
        "piped.mp4 (15 frames, 1920x1080, 30 fps)",
      );

      await Bun.write(encoder, "#!/bin/sh\ncat > /dev/null\nexit 1\n");
      expect(await main([short, "--video"])).toBe(1);
      expect(String(error.mock.calls.at(-1)?.[0])).toContain(
        "ffmpeg could not encode",
      );
    } finally {
      which.mockRestore();
      log.mockRestore();
      error.mockRestore();
    }
  });

  test("splits the capture between browsers and keeps the frames in order", async () => {
    // The progress bar moves every frame, so frames out of order would change
    // what the encoder receives.
    const short = await write(
      "ordered",
      walkthrough(
        '<section class="scene" data-duration="0.5" data-title="Short"><div class="callout">Short</div></section>',
      ),
    );
    // A stand-in for ffmpeg that keeps what it receives as the output file.
    const encoder = join(workDir, "ffmpeg");
    const which = spyOn(Bun, "which").mockReturnValue(encoder);
    const opened = await openWalkthrough(browser, short);
    const one = join(workDir, "one.mp4");
    const three = join(workDir, "three.mp4");

    try {
      await Bun.write(
        encoder,
        '#!/bin/sh\nfor last; do :; done\ncat > "$last"\n',
      );
      await chmod(encoder, 0o755);
      expect(await writeVideo(opened, one, 1)).toBe(15);
      expect(await writeVideo(opened, three, 3)).toBe(15);
      const single = pngFrames(await Bun.file(one).bytes());
      const split = pngFrames(await Bun.file(three).bytes());

      expect(split).toHaveLength(single.length);

      const [pairs, neighbours] = await Promise.all([
        Promise.all(
          single.map((frame, index) =>
            largestChannelDifference(frame, split[index] ?? new Uint8Array()),
          ),
        ),
        // Each frame differs from the next by more than a matching pair, so a
        // frame out of order fails the check on the pairs.
        Promise.all(
          single
            .slice(0, -1)
            .map((frame, index) =>
              largestChannelDifference(
                frame,
                single[index + 1] ?? new Uint8Array(),
              ),
            ),
        ),
      ]);

      for (const difference of pairs) {
        expect(difference).toBeLessThanOrEqual(SAME_FRAME);
      }

      for (const difference of neighbours) {
        expect(difference).toBeGreaterThan(SAME_FRAME);
      }
    } finally {
      which.mockRestore();
      await opened.page.close();
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
