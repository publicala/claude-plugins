import { describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  brokenLinks,
  checkPlugins,
  frontmatterProblems,
  linkTargets,
  main,
} from "./check-plugins";

const SKILL = "/repo/plugins/demo/skills/audit/SKILL.md";

describe("linkTargets", () => {
  test("reads inline, angle-bracket and reference destinations", () => {
    const text = [
      '[a](one.md "Title") [b](<two words.md>)',
      "[c]: three.md",
      "    [d]: indented-code.md",
    ].join("\n");

    expect(linkTargets(text)).toEqual(["one.md", "two words.md", "three.md"]);
  });
});

describe("brokenLinks", () => {
  test("skips urls and anchors, and checks files without their anchor", () => {
    const text =
      "[a](https://example.com) [b](#top) [c](check-plugins.ts#L1) [d](missing.md)";

    expect(brokenLinks(join(import.meta.dir, "README.md"), text)).toEqual([
      "link target not found: missing.md",
    ]);
  });
});

describe("frontmatterProblems", () => {
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
    expect(frontmatterProblems(SKILL, complete)).toEqual([]);
  });

  test("names missing keys", () => {
    expect(
      frontmatterProblems(
        SKILL,
        complete.replace("user-invocable: true\n", ""),
      ),
    ).toEqual(["frontmatter lacks user-invocable"]);
  });

  test("requires the name to match the directory", () => {
    expect(
      frontmatterProblems(
        SKILL,
        complete.replace("name: audit", "name: prune"),
      ),
    ).toEqual(['name "prune" differs from directory "audit"']);
  });

  test("requires frontmatter", () => {
    expect(frontmatterProblems(SKILL, "# Audit\n")).toEqual([
      "missing frontmatter",
    ]);
  });
});

describe("checkPlugins", () => {
  test("passes on this repository", async () => {
    const result = await checkPlugins(join(import.meta.dir, ".."));

    expect(result.errors).toEqual([]);
    expect(result.checked).toBeGreaterThan(0);
  });

  test("reports problems with the repo-relative path", async () => {
    const root = await mkdtemp(join(tmpdir(), "check-plugins-"));

    try {
      const skill = join(root, "plugins", "demo", "skills", "audit");
      await mkdir(skill, { recursive: true });
      await Bun.write(join(skill, "SKILL.md"), "[a](gone.md)\n");

      expect((await checkPlugins(root)).errors).toEqual([
        "plugins/demo/skills/audit/SKILL.md: link target not found: gone.md",
        "plugins/demo/skills/audit/SKILL.md: missing frontmatter",
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("main", () => {
  test("prints the count and exits 0 on a clean repository", async () => {
    const log = spyOn(console, "log").mockImplementation(() => undefined);

    try {
      expect(await main(join(import.meta.dir, ".."))).toBe(0);
      expect(log.mock.calls[0]?.[0]).toMatch(/^checked \d+ Markdown files/);
    } finally {
      log.mockRestore();
    }
  });

  test("prints each problem as a GitHub annotation and exits 1", async () => {
    const root = await mkdtemp(join(tmpdir(), "check-plugins-"));
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
