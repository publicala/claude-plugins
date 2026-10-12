import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ICONS_JSON, iconsJson, innerSvg } from "./update-blueprint-icons";

describe("innerSvg", () => {
  test("keeps the markup inside the svg element on one line", () => {
    expect(
      innerSvg(
        '<svg viewBox="0 0 24 24">\n  <path d="M1 1" />\n  <circle r="2" />\n</svg>\n',
      ),
    ).toBe('<path d="M1 1" /><circle r="2" />');
  });

  test("refuses a file without an svg element", () => {
    expect(() => innerSvg('<path d="M0 0"/>')).toThrow(/no <svg> element/);
  });
});

describe("iconsJson", () => {
  test("maps each icon name to its markup, sorted, and skips other files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "icons-"));

    try {
      await Bun.write(join(dir, "zap.svg"), '<svg><path d="Z"/></svg>');
      await Bun.write(join(dir, "anchor.svg"), '<svg><path d="A"/></svg>');
      await Bun.write(join(dir, "README.md"), "Not an icon.");

      expect(JSON.parse(await iconsJson(dir))).toEqual({
        anchor: '<path d="A"/>',
        zap: '<path d="Z"/>',
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("the plugin's icons match the installed lucide-static (bun run update:icons)", async () => {
    expect(await Bun.file(ICONS_JSON).text()).toBe(await iconsJson());
  });
});
