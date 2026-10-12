import {
  afterAll,
  beforeAll,
  describe,
  expect,
  setDefaultTimeout,
  spyOn,
  test,
} from "bun:test";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer, { type Browser } from "puppeteer-core";
import sharp from "sharp";

import { main } from "./render";
import { findChrome, launchBrowser, openPage, renderFigure } from "./renderer";

// Chrome starts and renders slower on CI's macOS runners than Bun's 5 s default.
setDefaultTimeout(30_000);

const EXAMPLES = join(import.meta.dir, "../skills/diagram/examples");
const EXAMPLE_SOURCES = (await readdir(EXAMPLES)).filter((file) =>
  file.endsWith(".diagram.html"),
);

const figure = (body: string, size = "") =>
  `<div class="canvas"${size}><div class="stack">${body}</div><footer class="colophon"><span class="verbatim">publica.la</span><span>Fig. 1</span></footer></div>`;

const node = (title: string, modifier = "") =>
  `<div class="node${modifier}"><div class="h">${title}</div><div class="d">Detail</div></div>`;

describe("findChrome", () => {
  test("takes CHROME_PATH when it exists, and nothing else when it does not", () => {
    expect(findChrome({ CHROME_PATH: process.execPath })).toBe(
      process.execPath,
    );
    expect(findChrome({ CHROME_PATH: "/nowhere/chrome" })).toBeNull();
  });

  test("finds the newest Chromium that Playwright installed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "playwright-"));

    try {
      for (const build of ["chromium-999", "chromium-1194", "chromium-1100"]) {
        await mkdir(join(dir, build, "chrome-linux"), { recursive: true });
        await Bun.write(join(dir, build, "chrome-linux/chrome"), "");
      }

      expect(findChrome({ PLAYWRIGHT_BROWSERS_PATH: dir })).toBe(
        join(dir, "chromium-1194/chrome-linux/chrome"),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test.each([
    "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    "chrome-win64/chrome.exe",
  ])("finds Playwright's Chrome for Testing at %p", async (binary) => {
    const dir = await mkdtemp(join(tmpdir(), "playwright-"));
    const path = join(dir, "chromium-1200", binary);

    try {
      await mkdir(join(path, ".."), { recursive: true });
      await Bun.write(path, "");

      expect(findChrome({ PLAYWRIGHT_BROWSERS_PATH: dir })).toBe(path);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("goes on to the other places when puppeteer finds no Google Chrome", async () => {
    const lookup = spyOn(puppeteer, "executablePath").mockImplementation(() => {
      throw new Error("Could not find Chrome");
    });
    const dir = await mkdtemp(join(tmpdir(), "playwright-"));
    const path = join(dir, "chromium-1200/chrome-linux/chrome");

    try {
      await mkdir(join(path, ".."), { recursive: true });
      await Bun.write(path, "");

      expect(findChrome({ PLAYWRIGHT_BROWSERS_PATH: dir })).toBe(path);
      expect(lookup).toHaveBeenCalledWith("chrome");
    } finally {
      lookup.mockRestore();
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("looks in Playwright's Windows cache after every other place", async () => {
    const appData = await mkdtemp(join(tmpdir(), "local-app-data-"));
    const path = join(
      appData,
      "ms-playwright/chromium-1200/chrome-win64/chrome.exe",
    );

    try {
      await mkdir(join(path, ".."), { recursive: true });
      await Bun.write(path, "");

      // A machine with Chrome installed finds that one first.
      expect(findChrome({ LOCALAPPDATA: appData })).toBe(
        findChrome({}) ?? path,
      );
    } finally {
      await rm(appData, { recursive: true, force: true });
    }
  });
});

describe("launchBrowser", () => {
  test("names a CHROME_PATH that points nowhere", () => {
    const chromePath = process.env.CHROME_PATH;

    process.env.CHROME_PATH = "/nowhere/chrome";

    try {
      expect(launchBrowser()).rejects.toThrow(
        "CHROME_PATH points at /nowhere/chrome, which does not exist.",
      );
    } finally {
      if (chromePath === undefined) {
        delete process.env.CHROME_PATH;
      } else {
        process.env.CHROME_PATH = chromePath;
      }
    }
  });
});

describe.skipIf(!findChrome())("openPage", () => {
  test("closes the page when its setup fails", async () => {
    const browser = await launchBrowser();

    try {
      const pages = (await browser.pages()).length;

      expect(
        openPage(browser, "<p></p>", { width: -1, height: 1, scale: 1 }),
      ).rejects.toThrow("Width and height values must be positive");
      expect(await browser.pages()).toHaveLength(pages);
    } finally {
      await browser.close();
    }
  });
});

describe.skipIf(!findChrome())("renderFigure", () => {
  let browser: Browser;
  let workDir: string;

  beforeAll(async () => {
    browser = await launchBrowser();
    workDir = await mkdtemp(join(tmpdir(), "blueprint-test-"));
  });

  afterAll(async () => {
    await browser.close();
    await rm(workDir, { recursive: true, force: true });
  });

  const render = async (name: string, source: string, pdf = false) => {
    const path = join(workDir, `${name}.diagram.html`);

    await Bun.write(path, source);

    return renderFigure(browser, path, { pdf });
  };

  test("writes a 2x PNG of the whole canvas and a one-page PDF", async () => {
    const written = await render(
      "valid",
      figure(
        `<div class="row">${node("API", " accent")}${node("Workers")}</div>`,
      ),
      true,
    );

    const png = await sharp(join(workDir, "valid.png")).metadata();
    const pdf = await Bun.file(join(workDir, "valid.pdf")).text();

    expect(written[0]?.dimensions).toMatch(/^3200x\d+$/);
    expect(png.width).toBe(3200);
    expect(pdf.match(/\/Type\s*\/Page\b/g)).toHaveLength(1);
  });

  test("reports every broken rule and writes nothing", async () => {
    const source = figure(
      `<div class="row">${node("One", " accent")}${node("Two", " accent")}</div>` +
        '<div class="wire"></div>' +
        `<div class="row">${node("A node title long enough to wrap onto a second line in a narrow column")}${node("B")}${node("C")}${node("D")}${node("E")}${node("F")}</div>` +
        `<div class="sub">publica.la — engineering; today</div>`,
      ' data-size="og"',
    ).replace(
      'class="stack"',
      'class="stack" style="text-transform: uppercase"',
    );

    const rendering = render("broken", source);

    expect(rendering).rejects.toThrow("2 nodes are accented");
    expect(rendering).rejects.toThrow(
      'The wire after "OneDetailTwoDetail" has no label',
    );
    expect(rendering).rejects.toThrow("wraps to a second line");
    expect(rendering).rejects.toThrow('"publica.la" renders in uppercase');
    expect(rendering).rejects.toThrow("has an em dash");
    expect(rendering).rejects.toThrow("has a semicolon");
    expect(await Bun.file(join(workDir, "broken.png")).exists()).toBe(false);
  });

  test("catches text spilling below its box, and the brand typed in capitals", () => {
    const source = figure(
      '<div class="row"><div class="node" style="height: 24px"><div class="h">Short box</div><div class="d">A description that needs a line of its own</div></div>' +
        '<div class="node"><div class="h">By PUBLICA.LA</div></div></div>',
    );
    const rendering = render("spill", source);

    expect(rendering).rejects.toThrow(/"Short box[^"]*" overflows its box\./);
    expect(rendering).rejects.toThrow(
      '"publica.la" renders in uppercase in "By PUBLICA.LA".',
    );
  });

  test("refuses content taller than a fixed-size card", () => {
    const tall = '<div class="callout" style="height: 900px">Tall</div>';
    expect(render("tall", figure(tall, ' data-size="og"'))).rejects.toThrow(
      /runs past the canvas by 0px across and \d+px down/,
    );
  });

  test("measures split columns and overlaps in the page", () => {
    const layer = (height: number) =>
      `<section class="layer"><div class="gutter"><span class="t">L</span></div><div class="body"><div style="height: ${height}px"></div></div></section>`;
    const source = figure(
      `<div class="split"><div class="stack">${layer(200)}</div><div class="side">${layer(300)}</div></div>` +
        `<div class="callout" style="margin-top: -60px">Over</div>`,
    );

    const rendering = render("split", source);

    expect(rendering).rejects.toThrow("The columns of a split end 100px apart");
    expect(rendering).rejects.toThrow('overlaps "Over"');
  });

  test.each(EXAMPLE_SOURCES)(
    "the example %s passes every check",
    async (file) => {
      const source = await Bun.file(join(EXAMPLES, file)).text();

      expect(
        await render(file.replace(".diagram.html", ""), source),
      ).toHaveLength(1);
    },
  );
});

describe.skipIf(!findChrome())("command line", () => {
  test("renders each source and names what it wrote", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "blueprint-cli-"));
    const log = spyOn(console, "log").mockImplementation(() => undefined);
    const error = spyOn(console, "error").mockImplementation(() => undefined);

    try {
      await Bun.write(join(workDir, "good.diagram.html"), figure(node("API")));
      await Bun.write(
        join(workDir, "bad.diagram.html"),
        figure(`${node("One", " accent")}${node("Two", " accent")}`),
      );

      expect(
        await main([
          join(workDir, "good.diagram.html"),
          join(workDir, "bad.diagram.html"),
          "--pdf",
        ]),
      ).toBe(1);
      expect(log.mock.calls.flat().join("\n")).toMatch(
        /good\.png \(3200x\d+\)/,
      );
      expect(log.mock.calls.flat().join("\n")).toMatch(/good\.pdf/);
      expect(error.mock.calls.flat().join("\n")).toMatch(
        /bad\.diagram\.html did not render:\n {2}- 2 nodes are accented/,
      );
    } finally {
      log.mockRestore();
      error.mockRestore();
      await rm(workDir, { recursive: true, force: true });
    }
  });
});

describe("command line arguments", () => {
  test.each([
    [["--png"], "Unknown option '--png'."],
    [
      [],
      "Usage: bun render.ts <figure.diagram.html> [more.diagram.html] [--pdf]",
    ],
  ])("refuses %p", async (args, message) => {
    const error = spyOn(console, "error").mockImplementation(() => undefined);

    try {
      expect(await main(args)).toBe(1);
      expect(error.mock.calls[0]?.[0]).toStartWith(message);
    } finally {
      error.mockRestore();
    }
  });
});
