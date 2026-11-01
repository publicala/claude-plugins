import { describe, expect, spyOn, test } from "bun:test";
import { rm } from "node:fs/promises";

import {
  checkProse,
  findProseProblems,
  main,
  proseFragments,
} from "./check-prose";
import { tempRepo } from "./temp-repo";

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

  test("skips quotes, which keep their own punctuation", () => {
    expect(
      proseFragments("Before.\n\n> They said \u201cyes; now\u201d.\n\nAfter."),
    ).toEqual(["Before.", "After."]);
  });

  test("skips the text inside inline code, kbd, samp and pre tags", () => {
    expect(
      proseFragments(
        "Run <code>a; b</code>, press <kbd>Ctrl</kbd>; then <b>bold</b>.",
      ),
    ).toEqual(["Run ", ", press ", "; then ", "<b>", "bold", "</b>", "."]);
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
    ["It's worth noting that it works.", 'says "It\'s worth noting"'],
    ["We leverage the cache.", 'says "leverage"'],
    ["Utilization is high.", 'says "Utilization"'],
    ["A step-by-step guide.", 'says "step-by-step"'],
    ["The invariant holds.", 'says "invariant". Say "rule" or "guarantee"'],
  ])("flags %p", (text, problem) => {
    const problems = findProseProblems(text);

    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain(problem);
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
      { line: 9, message: "has a semicolon. Split it into two sentences." },
    ]);
  });

  test("reports a character written as an entity on the line where the text before it ends", () => {
    expect(findProseProblems("First line.\n\nSee &#8212; here.")).toEqual([
      {
        line: 3,
        message: "has an em dash. Use parentheses or split the sentence.",
      },
    ]);
  });
});

describe("checkProse", () => {
  test("checks every Markdown file git would commit, in any directory", async () => {
    const root = await tempRepo({
      ".gitignore": "node_modules\nignored.md\n",
      "README.md": "Fine.\n",
      "plugins/demo/SKILL.md": "One; two.\n",
      ".claude/bonsai/candidates/pr1.md": "Three; four.\n",
      "docs/guide.md": "Five \u2014 six.\n",
      "node_modules/dep/README.md": "One; two.\n",
      "ignored.md": "One; two.\n",
    });

    try {
      expect(await checkProse(root)).toEqual({
        checked: 4,
        problems: [
          {
            file: ".claude/bonsai/candidates/pr1.md",
            line: 1,
            message: "has a semicolon. Split it into two sentences.",
          },
          {
            file: "docs/guide.md",
            line: 1,
            message: "has an em dash. Use parentheses or split the sentence.",
          },
          {
            file: "plugins/demo/SKILL.md",
            line: 1,
            message: "has a semicolon. Split it into two sentences.",
          },
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
    const root = await tempRepo({ "README.md": "One \u2014 two.\n" });
    const error = spyOn(console, "error").mockImplementation(() => undefined);

    try {
      expect(await main(root)).toBe(1);
      expect(error).toHaveBeenCalledWith(
        "::error file=README.md,line=1::has an em dash. Use parentheses or split the sentence.",
      );
    } finally {
      error.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });
});
