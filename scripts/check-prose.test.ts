import { describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  checkProse,
  findProseProblems,
  main,
  proseFragments,
} from "./check-prose";

describe("proseFragments", () => {
  test("skips code blocks, code spans, raw HTML and link destinations", () => {
    const text = [
      "Prose with `span; code` and [a link](https://example.com/a;b).",
      "",
      "```ts",
      "const a = 1;",
      "```",
      "",
      "<!-- a comment; -->",
    ].join("\n");

    expect(proseFragments(text).join("")).toBe("Prose with  and a link.");
  });
});

describe("findProseProblems", () => {
  test("accepts prose that follows the rules", () => {
    expect(
      findProseProblems("Split it into two sentences. Don't use `a; b`.\n"),
    ).toEqual([]);
  });

  test.each<[string, string]>([
    ["One thing — another.", "has an em dash"],
    ["One thing - another.", 'uses "-" as a separator'],
    ["One thing – another.", 'uses "–" as a separator'],
    ["One thing; another.", "has a semicolon"],
    ["It’s curly.", "has the curly quote ’"],
    ["¿Qué pasa?", "opens with ¿"],
    ["¡Listo!", "opens with ¡"],
    ["It's worth noting that it works.", 'says "It\'s worth noting"'],
    ["We leverage the cache.", 'says "leverage"'],
    ["Utilization is high.", 'says "Utilization"'],
    ["A step-by-step guide.", 'says "step-by-step"'],
    ["The invariant holds.", 'says "invariant". Say "rule" or "guarantee"'],
  ])("flags %p", (text, problem) => {
    const problems = findProseProblems(text);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(problem);
  });

  test("names the line of each problem, also after code", () => {
    const text = [
      "# Title",
      "",
      "```",
      "a; b",
      "```",
      "",
      "Fine here.",
      "",
      "Then one; two.",
    ].join("\n");

    expect(findProseProblems(text)).toEqual([
      "line 9 has a semicolon. Split it into two sentences.",
    ]);
  });

  test("catches a character written as an entity, on the line before it", () => {
    expect(findProseProblems("First line.\n\nSee &#8212; here.")).toEqual([
      "line 3 has an em dash. Use parentheses or split the sentence.",
    ]);
  });
});

describe("checkProse", () => {
  test("checks root, plugin and .github Markdown, never node_modules", async () => {
    const root = await mkdtemp(join(tmpdir(), "check-prose-"));

    try {
      await mkdir(join(root, "plugins/demo"), { recursive: true });
      await mkdir(join(root, "node_modules/dep"), { recursive: true });
      await Bun.write(join(root, "README.md"), "Fine.\n");
      await Bun.write(join(root, "plugins/demo/SKILL.md"), "One; two.\n");
      await Bun.write(join(root, "node_modules/dep/README.md"), "One; two.\n");

      expect(await checkProse(root)).toEqual({
        checked: 2,
        errors: [
          "plugins/demo/SKILL.md: line 1 has a semicolon. Split it into two sentences.",
        ],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("main", () => {
  test("passes on this repository", async () => {
    const log = spyOn(console, "log").mockImplementation(() => undefined);

    try {
      expect(await main()).toBe(0);
    } finally {
      log.mockRestore();
    }
  });

  test("fails and reports each problem", async () => {
    const root = await mkdtemp(join(tmpdir(), "check-prose-"));
    const error = spyOn(console, "error").mockImplementation(() => undefined);

    try {
      await Bun.write(join(root, "README.md"), "One — two.\n");

      expect(await main(root)).toBe(1);
      expect(error).toHaveBeenCalledWith(
        "::error::README.md: line 1 has an em dash. Use parentheses or split the sentence.",
      );
    } finally {
      error.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });
});
