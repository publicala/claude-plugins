import { describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  linkTargets,
  main,
  validateFrontmatter,
  validateLinks,
  validatePlugins,
} from "./validate-plugins";

const SKILL = "/repo/plugins/demo/skills/audit/SKILL.md";

describe("linkTargets", () => {
  test("reads inline, angle-bracket, image and reference destinations", () => {
    const text = [
      '[a](one.md "Title") [b](<two words.md>) ![c](four.png) [d][ref]',
      "",
      "[ref]: three.md",
    ].join("\n");

    expect(linkTargets(text)).toEqual([
      "one.md",
      "two words.md",
      "four.png",
      "three.md",
    ]);
  });

  test("skips links in code blocks and code spans", () => {
    const text = [
      "`[a](span.md)`",
      "",
      "```",
      "[b](fenced.md)",
      "```",
      "",
      "    [c](indented.md)",
    ].join("\n");

    expect(linkTargets(text)).toEqual([]);
  });
});

describe("validateLinks", () => {
  test("skips urls and anchors, and checks files without their anchor", () => {
    const text =
      "[a](https://example.com) [b](#top) [c](validate-plugins.ts#L1) [d](missing.md)";

    expect(validateLinks(join(import.meta.dir, "README.md"), text)).toEqual([
      "link target not found: missing.md",
    ]);
  });
});

describe("validateFrontmatter", () => {
  const complete = [
    "---",
    "name: audit",
    "description: Prunes.",
    "user-invocable: true",
    "disable-model-invocation: false",
    "---",
    "",
  ].join("\n");

  test("accepts complete frontmatter", () => {
    expect(validateFrontmatter(SKILL, complete)).toEqual([]);
  });

  test("names missing keys", () => {
    expect(
      validateFrontmatter(
        SKILL,
        complete.replace("user-invocable: true\n", ""),
      ),
    ).toEqual(["frontmatter lacks user-invocable"]);
  });

  test("requires the name to match the directory", () => {
    expect(
      validateFrontmatter(
        SKILL,
        complete.replace("name: audit", "name: prune"),
      ),
    ).toEqual(['name "prune" differs from directory "audit"']);
  });

  test("reads frontmatter with CRLF line endings", () => {
    expect(
      validateFrontmatter(SKILL, complete.replaceAll("\n", "\r\n")),
    ).toEqual([]);
  });

  test("reports frontmatter that is not valid YAML", () => {
    const [error] = validateFrontmatter(
      SKILL,
      complete.replace("description: Prunes.", "description: [Prunes."),
    );

    expect(error).toStartWith("frontmatter is not valid YAML:");
  });

  test("reports frontmatter that is not a mapping", () => {
    expect(validateFrontmatter(SKILL, "---\n- name\n---\n")).toEqual([
      "frontmatter is not a YAML mapping",
    ]);
  });

  test("requires frontmatter", () => {
    expect(validateFrontmatter(SKILL, "# Audit\n")).toEqual([
      "missing frontmatter",
    ]);
  });
});

describe("validatePlugins", () => {
  test("passes on this repository", async () => {
    const result = await validatePlugins(join(import.meta.dir, ".."));

    expect(result.errors).toEqual([]);
    expect(result.checked).toBeGreaterThan(0);
  });

  test("reports problems with the repo-relative path", async () => {
    const root = await mkdtemp(join(tmpdir(), "validate-plugins-"));

    try {
      const skill = join(root, "plugins", "demo", "skills", "audit");
      await mkdir(skill, { recursive: true });
      await Bun.write(join(skill, "SKILL.md"), "[a](gone.md)\n");

      expect((await validatePlugins(root)).errors).toEqual([
        "plugins/demo/skills/audit/SKILL.md: link target not found: gone.md",
        "plugins/demo/skills/audit/SKILL.md: missing frontmatter",
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("names the file whose frontmatter is not valid YAML", async () => {
    const root = await mkdtemp(join(tmpdir(), "validate-plugins-"));

    try {
      const skill = join(root, "plugins", "demo", "skills", "audit");
      await mkdir(skill, { recursive: true });
      await Bun.write(join(skill, "SKILL.md"), "---\nname: [audit\n---\n");

      const { errors } = await validatePlugins(root);

      expect(errors).toHaveLength(1);
      expect(errors[0]).toStartWith(
        "plugins/demo/skills/audit/SKILL.md: frontmatter is not valid YAML:",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("main", () => {
  test("prints the count and exits 0 on this repository", async () => {
    const log = spyOn(console, "log").mockImplementation(() => undefined);

    try {
      expect(await main()).toBe(0);
      expect(log.mock.calls[0]?.[0]).toMatch(/^checked \d+ Markdown files/);
    } finally {
      log.mockRestore();
    }
  });

  test("prints each problem as a GitHub annotation and exits 1", async () => {
    const root = await mkdtemp(join(tmpdir(), "validate-plugins-"));
    const error = spyOn(console, "error").mockImplementation(() => undefined);

    try {
      await Bun.write(join(root, "plugins", "README.md"), "[a](gone.md)\n");

      expect(await main(root)).toBe(1);
      expect(error.mock.calls).toEqual([
        ["::error::plugins/README.md: link target not found: gone.md"],
      ]);
    } finally {
      error.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });
});
