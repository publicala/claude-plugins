import { describe, expect, test } from "bun:test";
import { rm, symlink } from "node:fs/promises";
import { join } from "node:path";

import { findEscapingPaths, validatePluginPaths } from "./plugin-paths";
import { tempRepo } from "./temp-repo";

const SKILL = "plugins/demo/skills/audit/SKILL.md";
const BUILD = "plugins/demo/renderer/build.ts";
const FIX =
  "Install copies the plugin alone, so the path breaks for users. Move the file into the plugin, or commit a symlink inside the plugin that points at it.";

// The line and the path each finding names, for a compact assertion.
function escapes(path: string, lines: string[]): string[] {
  return findEscapingPaths(path, lines.join("\n")).map(
    ({ line, message }) => `${line} ${message.split(", which")[0]}`,
  );
}

describe("findEscapingPaths", () => {
  test("names the path, where it resolves and the fix", () => {
    expect(
      findEscapingPaths(
        SKILL,
        "Read [the root README](../../../../README.md).",
      ),
    ).toEqual([
      {
        line: 1,
        message: `reads ../../../../README.md, which resolves to README.md, outside plugins/demo/. ${FIX}`,
      },
    ]);
  });

  test("reads Markdown links and the variables Claude Code expands, never a command's argument", () => {
    expect(
      escapes(SKILL, [
        "Read [the reference](../../references/rules.md) and [the root](../../../../README.md#top).",
        "",
        "[ref]: ../../../other/SKILL.md",
        "Run `bun ${CLAUDE_PLUGIN_ROOT}/../other/build.ts`, or `bun '${CLAUDE_PLUGIN_ROOT}'/../other/a.ts`.",
        "Install with `bun install --cwd ${CLAUDE_PLUGIN_ROOT}/..`.",
        "Copy `${CLAUDE_SKILL_DIR}/../audit/examples/a.md` and `${CLAUDE_SKILL_DIR}/../../../x`.",
        "Render it: `bun renderer/render.ts ../../figure.diagram.html`.",
        "Write `[example](../../../../README.md)` in a span.",
        "```md",
        "[example](../../../../README.md)",
        "```",
        "See https://example.com/a/../b and [the site](https://example.com/../b).",
      ]),
    ).toEqual([
      "1 reads ../../../../README.md#top",
      "3 reads ../../../other/SKILL.md",
      "4 reads ${CLAUDE_PLUGIN_ROOT}/../other/build.ts",
      "4 reads ${CLAUDE_PLUGIN_ROOT}/../other/a.ts",
      "5 reads ${CLAUDE_PLUGIN_ROOT}/..",
      "6 reads ${CLAUDE_SKILL_DIR}/../../../x",
    ]);
  });

  test("reads module specifiers and paths built on the file's directory in code, never a string of data", () => {
    expect(
      escapes(BUILD, [
        'import { tempRepo } from "../../../scripts/temp-repo";',
        'import { page } from "../page";',
        "const template = `${import.meta.dir}/../../shared/template.html`;",
        "const own = `${import.meta.dirname}/../page.html`;",
        "const other = `${__dirname}/../../other/a.ts`;",
        "const unknown = `${base}/../../../x`;",
        "// It's in the comment's ../../../ path, which is no string.",
        'const tokens = join(import.meta.dir, "..", "..", "blueprint", "style");',
        "const wrapped = resolve(",
        "  import.meta.dir,",
        '  "../style",',
        ");",
        'const up = join(import.meta.dir, "..");',
        'const input = join(cwd, "../../x");',
        'const data = "../../../fixture.json";',
        'const lazy = await import("../../../lazy");',
        'const asset = new URL("../../../asset.png", import.meta.url);',
        'const api = new URL("../../api", "https://example.com/a/b/");',
        '// import { old } from "../../../old";',
        '/* import { older } from "../../../older"; */',
        'const spread = [...args, "1..2", "wait..."];',
      ]),
    ).toEqual([
      "1 reads ../../../scripts/temp-repo",
      "3 reads ${import.meta.dir}/../../shared/template.html",
      "5 reads ${__dirname}/../../other/a.ts",
      '8 reads join(import.meta.dir, "..", "..", "blueprint", "style")',
      "16 reads ../../../lazy",
      "17 reads ../../../asset.png",
    ]);
  });

  test("reads the component paths of plugin.json, never its text", () => {
    const manifest = "plugins/demo/.claude-plugin/plugin.json";
    const text = JSON.stringify(
      {
        name: "demo",
        description: "Reads ../notes and ../../shared before it starts.",
        keywords: ["../tag"],
        skills: ["./skills/", "../other/skills"],
        commands: {
          status: { source: "../../shared/status.md", description: "../x" },
        },
        agents: "../agents/reviewer.md",
        experimental: { themes: ["../themes"], evals: "../evals" },
        metadata: { extra: "./../outside.json" },
      },
      null,
      2,
    );

    expect(
      findEscapingPaths(manifest, text).map(
        ({ line, message }) => `${line} ${message.split(", which")[0]}`,
      ),
    ).toEqual([
      "9 reads ../other/skills",
      "13 reads ../../shared/status.md",
      "17 reads ../agents/reviewer.md",
      "20 reads ../themes",
      "22 reads ../evals",
      "25 reads ./../outside.json",
    ]);
  });

  test("reads the paths in plugin.json from the plugin's root", () => {
    const manifest = "plugins/demo/.claude-plugin/plugin.json";

    expect(
      escapes(manifest, [
        '{ "skills": ["./skills/../skills",',
        '  "./../other/skills"] }',
      ]),
    ).toEqual(["2 reads ./../other/skills"]);
  });

  test("skips files outside a plugin directory and a skill variable outside a skill", () => {
    expect(findEscapingPaths("scripts/a.ts", 'import "../../x";')).toEqual([]);
    expect(
      findEscapingPaths("plugins/README.md", "[Home](../README.md)"),
    ).toEqual([]);
    expect(
      findEscapingPaths(
        "plugins/demo/README.md",
        "`${CLAUDE_SKILL_DIR}/../../../x`",
      ),
    ).toEqual([]);
  });
});

describe("validatePluginPaths", () => {
  test("reads code, docs, manifests and pages in plugins, and skips symlinks, whose target install copies", async () => {
    const root = await tempRepo({
      "shared/tokens.css": ":root {}\n",
      "shared/notes.md": "See [the README](../README.md).\n",
      "plugins/demo/page.html": '<link href="../../shared/tokens.css">\n',
      "plugins/demo/data.json": '{ "path": "../../outside.json" }\n',
      "plugins/demo/.claude-plugin/plugin.json": '{ "skills": "../outside" }\n',
      "plugins/demo/style.css": "@import '../../shared/tokens.css';\n",
    });

    try {
      await symlink(
        "../../shared/notes.md",
        join(root, "plugins/demo/notes.md"),
      );

      expect(
        await validatePluginPaths(root, [
          "plugins/demo/.claude-plugin/plugin.json",
          "plugins/demo/data.json",
          "plugins/demo/notes.md",
          "plugins/demo/page.html",
          "plugins/demo/style.css",
          "shared/notes.md",
        ]),
      ).toEqual([
        {
          file: "plugins/demo/.claude-plugin/plugin.json",
          line: 1,
          message: `reads ../outside, which resolves to plugins/outside, outside plugins/demo/. ${FIX}`,
        },
        {
          file: "plugins/demo/page.html",
          line: 1,
          message: `reads ../../shared/tokens.css, which resolves to shared/tokens.css, outside plugins/demo/. ${FIX}`,
        },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
