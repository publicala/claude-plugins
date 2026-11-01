import { describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import type { Annotation } from "./workflow-command";
import {
  lineOfPath,
  pluginNames,
  readJsonObject,
  validateMarketplace,
  validatePluginManifest,
  validatePostinstall,
} from "./plugin-manifests";
import { tempRepo } from "./temp-repo";

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

describe("lineOfPath", () => {
  const text = [
    "{",
    '  "author": { "name": "Acme Books" },',
    '  "name": "demo",',
    '  "plugins": [{ "name": "other" },',
    '    { "source": "./plugins/demo" }]',
    "}",
  ].join("\n");

  test("finds the key at its path, never one at another depth", () => {
    expect(lineOfPath(text, ["name"])).toBe(3);
    expect(lineOfPath(text, ["author", "name"])).toBe(2);
    expect(lineOfPath(text, ["plugins", 0, "name"])).toBe(4);
    expect(lineOfPath(text, ["plugins", 1])).toBe(5);
    expect(lineOfPath(text, ["version"])).toBeUndefined();
    expect(lineOfPath("", ["name"])).toBeUndefined();
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

describe("validateMarketplace", () => {
  const HOME = "https://github.com/publicala/claude-plugins/tree/main/plugins";
  const PLUGINS = {
    "plugins/alpha/.claude-plugin/plugin.json": JSON.stringify({
      name: "alpha",
      description: "Alpha.",
    }),
    "plugins/beta/.claude-plugin/plugin.json": "{ broken",
  };

  // A fixture without a name gets one after its other keys, so their lines hold.
  const isNamed = (marketplace: unknown): boolean =>
    typeof marketplace !== "object" ||
    marketplace === null ||
    Array.isArray(marketplace) ||
    "name" in marketplace;

  async function problemsFor(
    marketplace: unknown,
    plugins = ["alpha", "beta"],
  ): Promise<Annotation[]> {
    const root = await tempRepo({
      ...PLUGINS,
      ...(marketplace === undefined
        ? {}
        : {
            ".claude-plugin/marketplace.json": JSON.stringify(
              isNamed(marketplace)
                ? marketplace
                : { ...marketplace, name: "acme-books" },
              null,
              2,
            ),
          }),
    });

    try {
      return validateMarketplace(root, plugins);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  const alpha = {
    name: "alpha",
    description: "Alpha.",
    source: "./plugins/alpha",
    homepage: `${HOME}/alpha`,
  };
  const beta = {
    name: "beta",
    description: "Anything, since its plugin.json does not parse.",
    source: "./plugins/beta/",
    homepage: `${HOME}/beta`,
  };

  test("accepts an entry per plugin that matches its plugin.json", async () => {
    expect(await problemsFor({ plugins: [alpha, beta] })).toEqual([]);
  });

  test("needs a marketplace name, which users type after the @", async () => {
    const message = (value: string): string =>
      `"name" is ${value}. Write "name": "<marketplace name>", the name users type in /plugin install <plugin>@<marketplace name>.`;

    expect(
      await problemsFor({ name: "acme-books", plugins: [alpha, beta] }),
    ).toEqual([]);
    expect(
      await problemsFor({ name: undefined, plugins: [alpha, beta] }),
    ).toEqual([
      {
        file: ".claude-plugin/marketplace.json",
        line: 1,
        message: message("missing"),
      },
    ]);
    expect(await problemsFor({ name: " ", plugins: [alpha, beta] })).toEqual([
      {
        file: ".claude-plugin/marketplace.json",
        line: 2,
        message: message('" "'),
      },
    ]);
  });

  test("needs a marketplace only when there are plugins", async () => {
    expect(await problemsFor(undefined, [])).toEqual([]);
    expect(await problemsFor(undefined)).toEqual([
      {
        file: ".claude-plugin/marketplace.json",
        message:
          "is missing, so no plugin under plugins/ can be installed. Add it with an entry per plugin.",
      },
    ]);
  });

  test("reports a marketplace that does not parse, or has no plugins list", async () => {
    expect(await problemsFor([])).toEqual([
      {
        file: ".claude-plugin/marketplace.json",
        line: 1,
        message: "is not a JSON object. Write its keys inside { }.",
      },
    ]);
    expect(await problemsFor({ plugins: "alpha" })).toEqual([
      {
        file: ".claude-plugin/marketplace.json",
        line: 2,
        message:
          '"plugins" is "alpha". Write "plugins": [ ] with an entry per directory under plugins/.',
      },
    ]);
  });

  test("names an entry without a source, a source that is no plugin, and a plugin listed twice", async () => {
    expect(
      await problemsFor({
        plugins: [
          alpha,
          beta,
          { name: "gamma" },
          { ...alpha, source: "./plugins/gamma" },
          alpha,
        ],
      }),
    ).toEqual([
      {
        file: ".claude-plugin/marketplace.json",
        line: 15,
        message:
          'lists the entry {"name":"gamma"}, which has no "source" path. Write "source": "./plugins/<name>".',
      },
      {
        file: ".claude-plugin/marketplace.json",
        line: 21,
        message:
          '"source" is "./plugins/gamma", which is no plugin directory. Point it at one, like "./plugins/<name>".',
      },
      {
        file: ".claude-plugin/marketplace.json",
        line: 27,
        message: "lists plugins/alpha twice. Remove one of its entries.",
      },
    ]);
  });

  test("names the name, description and homepage that drifted, and the plugin left out", async () => {
    expect(
      await problemsFor({
        plugins: [
          {
            name: "alfa",
            source: "./plugins/alpha",
            homepage: "https://example.com",
          },
        ],
      }),
    ).toEqual([
      {
        file: ".claude-plugin/marketplace.json",
        line: 4,
        message:
          '"name" of plugins/alpha is "alfa", and plugins/alpha/.claude-plugin/plugin.json says "alpha". Copy the plugin.json value here.',
      },
      {
        file: ".claude-plugin/marketplace.json",
        line: 5,
        message:
          '"description" of plugins/alpha is missing, and plugins/alpha/.claude-plugin/plugin.json says "Alpha.". Copy the plugin.json value here.',
      },
      {
        file: ".claude-plugin/marketplace.json",
        line: 6,
        message: `"homepage" of plugins/alpha is "https://example.com". Write "homepage": "${HOME}/alpha".`,
      },
      {
        file: ".claude-plugin/marketplace.json",
        line: 2,
        message: `does not list plugins/beta, so it cannot be installed. Add an entry with its name, description, "source": "./plugins/beta" and "homepage": "${HOME}/beta".`,
      },
    ]);
  });
});

// The parser's own words change with Bun, so a test checks only that some are there.
function withParserTextHidden(problems: Annotation[]): Annotation[] {
  return problems.map((problem) => ({
    ...problem,
    message: problem.message.replace(
      /^is not valid JSON \(.+\)\./,
      "is not valid JSON (<parser text>).",
    ),
  }));
}

describe("validatePostinstall", () => {
  async function problemsFor(
    rootPackage: string | undefined,
    files = ["plugins/alpha/package.json", "plugins/beta/README.md"],
  ): Promise<Annotation[]> {
    const root = await tempRepo(
      rootPackage === undefined ? {} : { "package.json": rootPackage },
    );

    try {
      return validatePostinstall(root, files);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  const withPostinstall = (postinstall: string): string =>
    JSON.stringify({ scripts: { postinstall } }, null, 2);

  test("accepts a postinstall that installs every plugin package", async () => {
    expect(
      await problemsFor(
        withPostinstall(
          'bun install --cwd plugins/alpha --frozen-lockfile; bun install --cwd="./plugins/gamma/"',
        ),
        ["plugins/alpha/package.json", "plugins/gamma/package.json"],
      ),
    ).toEqual([]);
  });

  test("needs nothing when no plugin has a package.json", async () => {
    expect(await problemsFor(undefined, ["plugins/beta/README.md"])).toEqual(
      [],
    );
  });

  test.each([
    "bun install --cwd plugins/alphabet",
    "echo --cwd plugins/alpha",
    "bun run build --cwd plugins/alpha && bun install",
    "bun install --cwd plugins/beta || bun install --cwd plugins/alpha",
  ])("names the plugin %p does not install", async (postinstall) => {
    expect(await problemsFor(withPostinstall(postinstall))).toEqual([
      {
        file: "package.json",
        line: 3,
        message:
          'postinstall does not install plugins/alpha/package.json. Add "bun install --cwd plugins/alpha --frozen-lockfile" to it, joined with &&.',
      },
    ]);
  });

  test("names the plugin when there is no postinstall or no package.json", async () => {
    expect(await problemsFor('{\n  "scripts": {}\n}')).toEqual([
      {
        file: "package.json",
        line: 2,
        message:
          'postinstall does not install plugins/alpha/package.json. Add "bun install --cwd plugins/alpha --frozen-lockfile" to it, joined with &&.',
      },
    ]);
    expect(await problemsFor(undefined)).toEqual([
      {
        file: "package.json",
        line: undefined,
        message:
          'postinstall does not install plugins/alpha/package.json. Add "bun install --cwd plugins/alpha --frozen-lockfile" to it, joined with &&.',
      },
    ]);
  });

  test("reports a root package.json that does not parse", async () => {
    expect(withParserTextHidden(await problemsFor("{"))).toEqual([
      {
        file: "package.json",
        line: 1,
        message: "is not valid JSON (<parser text>). Fix the syntax.",
      },
    ]);
  });
});
