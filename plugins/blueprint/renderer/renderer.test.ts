import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser } from "puppeteer-core";

import { main } from "./render";
import { findChrome, launchBrowser, renderFigure } from "./renderer";

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

    const png = Buffer.from(await Bun.file(join(workDir, "valid.png")).bytes());
    const pdf = await Bun.file(join(workDir, "valid.pdf")).text();

    expect(written[0]?.size).toMatch(/^3200x\d+$/);
    expect(png.readUInt32BE(16)).toBe(3200);
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

    const error = (await render("broken", source).catch(
      (caught: unknown) => caught,
    )) as Error;

    expect(error.message).toContain("2 nodes are accented");
    expect(error.message).toContain("A wire has no label");
    expect(error.message).toContain("wraps to a second line");
    expect(error.message).toContain('"publica.la" renders in uppercase');
    expect(error.message).toContain("has an em dash");
    expect(error.message).toContain("has a semicolon");
    expect(await Bun.file(join(workDir, "broken.png")).exists()).toBe(false);
  });

  test("refuses content taller than a fixed-size card", async () => {
    const tall = '<div class="callout" style="height: 900px">Tall</div>';
    const error = (await render("tall", figure(tall, ' data-size="og"')).catch(
      (caught: unknown) => caught,
    )) as Error;

    expect(error.message).toMatch(
      /runs past the canvas by 0px across and \d+px down/,
    );
  });

  test("measures split columns and overlaps in the page", async () => {
    const layer = (height: number) =>
      `<section class="layer"><div class="gutter"><span class="t">L</span></div><div class="body"><div style="height: ${height}px"></div></div></section>`;
    const source = figure(
      `<div class="split"><div class="stack">${layer(200)}</div><div class="side">${layer(300)}</div></div>` +
        `<div class="callout" style="margin-top: -60px">Over</div>`,
    );

    const error = (await render("split", source).catch(
      (caught: unknown) => caught,
    )) as Error;

    expect(error.message).toContain("The columns of a split end 100px apart");
    expect(error.message).toContain('overlaps "Over"');
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
    [["--png"], "Unknown option --png. The only option is --pdf."],
    [
      [],
      "Usage: bun render.ts <figure.diagram.html> [more.diagram.html] [--pdf]",
    ],
  ])("refuses %p", async (args, message) => {
    const error = spyOn(console, "error").mockImplementation(() => undefined);

    try {
      expect(await main(args)).toBe(1);
      expect(error.mock.calls[0]?.[0]).toBe(message);
    } finally {
      error.mockRestore();
    }
  });
});
