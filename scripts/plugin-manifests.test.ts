import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import {
  lineOfKey,
  pluginNames,
  readJsonObject,
  validatePluginManifest,
} from "./plugin-manifests";

const ROOT = join(import.meta.dir, "..");

describe("pluginNames", () => {
  test("names each directory under plugins/ once, never a file there", () => {
    expect(
      pluginNames([
        "README.md",
        "plugins/README.md",
        "plugins/zeta/a.md",
        "plugins/alpha/.claude-plugin/plugin.json",
        "plugins/alpha/skills/x/SKILL.md",
      ]),
    ).toEqual(["alpha", "zeta"]);
  });
});

describe("lineOfKey", () => {
  const text = '{\n  "name": "demo",\n  "plugins": [{ "name": "other" }]\n}';

  test("finds a key, or the key with a value", () => {
    expect(lineOfKey(text, "name")).toBe(2);
    expect(lineOfKey(text, "name", "other")).toBe(3);
    expect(lineOfKey(text, "version")).toBeUndefined();
  });
});

describe("readJsonObject", () => {
  test("reads an object, and skips a missing file", () => {
    expect(readJsonObject(ROOT, "package.json")).toMatchObject({
      json: { name: "claude-plugins" },
    });
    expect(readJsonObject(ROOT, "missing.json")).toBeUndefined();
  });
});

describe("validatePluginManifest", () => {
  const manifest = { name: "demo", description: "Does a thing." };

  test("accepts a name that matches the directory and a description", () => {
    expect(
      validatePluginManifest("demo", JSON.stringify(manifest), manifest),
    ).toEqual([]);
  });

  test("names the directory when the name differs or is missing", () => {
    const text = '{\n  "name": "other",\n  "description": "Does a thing."\n}';

    expect(
      validatePluginManifest(
        "demo",
        text,
        JSON.parse(text) as Record<string, unknown>,
      ),
    ).toEqual([
      {
        line: 2,
        message:
          '"name" is "other", and the plugin\'s directory is "demo". Write "name": "demo".',
      },
    ]);
    expect(
      validatePluginManifest("demo", "{}", { description: "Does a thing." }),
    ).toEqual([
      {
        line: 1,
        message:
          '"name" is missing, and the plugin\'s directory is "demo". Write "name": "demo".',
      },
    ]);
  });

  test("requires a description", () => {
    expect(
      validatePluginManifest("demo", "{}", { name: "demo", description: " " }),
    ).toEqual([
      {
        line: 1,
        message:
          '"description" is " ". Write "description": "<what the plugin does>".',
      },
    ]);
  });

  test("refuses a version, quoting the rule", () => {
    const text =
      '{\n  "name": "demo",\n  "version": "1.0.0",\n  "description": "Does a thing."\n}';

    expect(
      validatePluginManifest(
        "demo",
        text,
        JSON.parse(text) as Record<string, unknown>,
      ),
    ).toEqual([
      {
        line: 3,
        message:
          'carries "version", and CLAUDE.md says: "plugin.json carries no version, so every merge reaches users." Remove the "version" key.',
      },
    ]);
  });
});
