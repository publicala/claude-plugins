import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  readFontFaceCss,
  readLogoSvg,
  readLucideIcons,
  readStylesheet,
} from "./assets";
import {
  buildPage,
  bundlePageScript,
  expandIcons,
  expandLogo,
  outputPathFor,
} from "./page";

const icons = await readLucideIcons();
const database = icons.get("database") ?? "";

const EXAMPLES = join(import.meta.dir, "../skills/diagram/examples");
const EXAMPLE_FILES = await readdir(EXAMPLES);
const EXAMPLE_SOURCES = EXAMPLE_FILES.filter((file) =>
  file.endsWith(".diagram.html"),
);

describe("readLucideIcons", () => {
  test("returns the inner markup of a Lucide icon", () => {
    expect(database).toMatch(/^<ellipse[^\n]*<\/?path/);
  });
});

describe("assets", () => {
  test("embed both families in every weight, with no network", async () => {
    const css = await readFontFaceCss();

    expect(css.match(/@font-face/g)).toHaveLength(7);
    expect(css).toContain(
      "font-family:'JetBrains Mono';font-style:normal;font-weight:600",
    );
    expect(css).not.toContain("https://");
  });

  test("read the stylesheet and the logo", async () => {
    expect(await readStylesheet()).toContain(
      await Bun.file(join(import.meta.dir, "../style/tokens.css")).text(),
    );
    expect(await readLogoSvg()).toMatch(/^<svg\b/);
  });
});

describe("expandIcons", () => {
  test("replaces an icon placeholder with its inline SVG", () => {
    const html = expandIcons(
      '<div><i data-icon="database"></i>DB</div>',
      icons,
    );

    expect(html).toBe(
      `<div><svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${database}</svg>DB</div>`,
    );
  });

  test.each([
    ["wrapped by Prettier", '<i data-icon="database"></i\n>'],
    ["in single quotes", "<i data-icon='database'></i>"],
    ["with another attribute", '<i class="big" data-icon="database"></i>'],
    ["self-closing", '<i data-icon="database" />'],
  ])("expands a placeholder %s", (_, placeholder) => {
    expect(expandIcons(`<div>${placeholder}</div>`, icons)).toBe(
      `<div><svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${database}</svg></div>`,
    );
  });

  test("names the unknown icon and suggests similar ones", () => {
    expect(() => expandIcons('<i data-icon="databse-zap"></i>', icons)).toThrow(
      /Unknown icon "databse-zap".*lucide\.dev.*Similar names: .*zap/,
    );
  });

  test("suggests eight similar names at most", () => {
    expect(() => expandIcons('<i data-icon="arrow-thing"></i>', icons)).toThrow(
      /Similar names: (?:[a-z0-9-]+, ){7}[a-z0-9-]+\.$/,
    );
  });

  test("names the unknown icon alone when nothing is similar", () => {
    expect(() => expandIcons('<i data-icon="qq"></i>', icons)).toThrow(
      'Unknown icon "qq". Use a name from lucide.dev/icons.',
    );
  });
});

describe("expandLogo", () => {
  test("inlines the logo with an accessible label", () => {
    expect(expandLogo("<i data-logo></i>", '<svg id="logo"></svg>\n')).toBe(
      '<span class="logo" role="img" aria-label="publica.la"><svg id="logo"></svg></span>',
    );
  });
});

describe("buildPage", () => {
  const page = (source: string) =>
    buildPage({
      source,
      stylesheet: ".canvas{}",
      fontFaceCss: "@font-face{}",
      logoSvg: '<svg id="logo"></svg>',
      icons,
    });

  test("wraps the source with the fonts, the stylesheet and the logo", () => {
    const html = page('<div class="canvas"><i data-logo></i></div>');

    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain("<style>@font-face{}.canvas{}</style>");
    expect(html).toContain('<svg id="logo"></svg>');
  });

  test("drops every comment, also one that removing another would rebuild", () => {
    const html = page(
      '<!-- sources --><div class="canvas"><!<!-- x -->-- y --></div>',
    );

    expect(html).not.toContain("sources");
    expect(html).toContain('<div class="canvas">-- y --></div>');
  });

  test("adds a title, head markup, a body class and a wrapper whose icons expand", () => {
    const html = buildPage({
      source: '<div class="canvas"></div>',
      stylesheet: "",
      fontFaceCss: "",
      logoSvg: "",
      icons,
      title: "Player",
      head: "<style>.screen{}</style>",
      bodyClass: "player",
      wrapBody: (figure) =>
        `<div class="screen">${figure}</div><i data-icon="database"></i>`,
    });

    expect(html).toContain("<title>Player</title>");
    expect(html).toContain("<style>.screen{}</style></head>");
    expect(html).toContain(
      '<body class="player"><div class="screen"><div class="canvas"></div></div><svg class="icon"',
    );
  });

  test("accepts a canvas with more classes", () => {
    expect(() => page("<div class='figure canvas'></div>")).not.toThrow();
  });

  test.each([
    ["no canvas", "<div></div>", 0],
    [
      "a canvas only in a comment",
      '<!-- <div class="canvas"> --><div></div>',
      0,
    ],
    ["two canvases", '<div class="canvas"></div><div class="canvas"></div>', 2],
  ])("refuses a source with %s", (_, source, found) => {
    expect(() => page(source)).toThrow(
      `exactly one element with the canvas class, found ${found}`,
    );
  });

  test("refuses a placeholder it cannot expand", () => {
    expect(() =>
      page('<div class="canvas"><span data-icon="user"></span></div>'),
    ).toThrow(/Unable to expand <span data-icon="user">/);
  });
});

describe("outputPathFor", () => {
  test("swaps the source suffix for the output extension", () => {
    expect(
      outputPathFor("img/overview.diagram.html", ".diagram.html", ".png"),
    ).toBe("img/overview.png");
  });

  test("refuses a file that is not a figure source", () => {
    expect(() =>
      outputPathFor("img/overview.html", ".diagram.html", ".png"),
    ).toThrow("Sources end in .diagram.html, got: img/overview.html");
  });
});

describe("bundlePageScript", () => {
  async function bundle(source: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "blueprint-bundle-"));

    try {
      await Bun.write(join(dir, "script.ts"), source);
      return await bundlePageScript(join(dir, "script.ts"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  test("bundles the player into one script with no imports", async () => {
    const script = await bundlePageScript(join(import.meta.dir, "player.ts"));

    expect(script).toContain("window.walkthrough");
    expect(script).not.toMatch(/^\s*(import|export)\b/m);
    expect(script).not.toContain(import.meta.dir);
    expect(script).not.toMatch(/^\/\/ .*\//m);
  });

  test("refuses code that would end the script block", () => {
    expect(bundle('console.log("</script >");')).rejects.toThrow(
      'bundles to code with "</script" or "<!--"',
    );
  });

  test("refuses code that would open a comment in the script block", () => {
    expect(bundle('console.log("<!--");')).rejects.toThrow(
      'Split the string, as in "<" + "/script".',
    );
  });

  test("names a script that does not build", () => {
    expect(bundle("const = ;")).rejects.toThrow(
      /Unable to bundle .*script\.ts:\n.+/,
    );
  });
});

describe("skill examples", () => {
  test.each(EXAMPLE_SOURCES)(
    "%s builds with known icons and has a rendered PNG",
    async (file) => {
      const source = await Bun.file(join(EXAMPLES, file)).text();

      expect(() =>
        buildPage({
          source,
          stylesheet: "",
          fontFaceCss: "",
          logoSvg: "<svg></svg>",
          icons,
        }),
      ).not.toThrow();
      expect(EXAMPLE_FILES).toContain(
        outputPathFor(file, ".diagram.html", ".png"),
      );
    },
  );
});
