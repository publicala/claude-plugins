import { describe, expect, spyOn, test } from "bun:test";
import { rm } from "node:fs/promises";

import {
  checkProse,
  findLabeledBullets,
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

describe("findLabeledBullets", () => {
  test("accepts a labeled bullet with a colon, and bullets with no label", () => {
    const text = [
      "- **Lint**: runs ESLint.",
      "- Lint: runs ESLint.",
      "1. **Build**: compiles.",
      "- Runs the tests, then stops.",
      "- `bun test` - runs the tests.",
      "- A sentence with more than four words - then a dash.",
      "- Use `x - y` for the offset.",
      "- **Lint** `a - b` runs.",
    ].join("\n");

    expect(findLabeledBullets(text)).toEqual([]);
  });

  test.each<[string, string, string]>([
    ["- **Lint** - runs ESLint.", "**Lint** -", "Lint"],
    ["- **Lint** \u2013 runs ESLint.", "**Lint** \u2013", "Lint"],
    ["* **Lint** \u2014 runs ESLint.", "**Lint** \u2014", "Lint"],
    ["- **Lint**. Runs ESLint.", "**Lint**.", "Lint"],
    [
      "- **Lint runs first.** Then the rest.",
      "**Lint runs first.**",
      "Lint runs first",
    ],
    ["  2. **Type check** - runs tsc.", "**Type check** -", "Type check"],
    ["- Lint - runs ESLint.", "Lint -", "Lint"],
    ["+ Type check - runs tsc.", "Type check -", "Type check"],
  ])("flags %p and names the colon form", (text, written, label) => {
    expect(findLabeledBullets(`Intro.\n\n${text}`)).toEqual([
      {
        line: 3,
        message: `labels a bullet with "${written}". Write "**${label}**: text", with a colon.`,
      },
    ]);
  });

  test("skips frontmatter, code, HTML and quotes, as the prose rules do", () => {
    const text = [
      "---",
      "- **Lint** - in frontmatter",
      "---",
      "```md",
      "- **Lint** - in a fence",
      "```",
      "   ~~~",
      "- **Lint** - in an indented tilde fence",
      "   ~~~",
      "",
      "    - **Lint** - in an indented code block",
      "",
      "<!--",
      "- **Lint** - in a comment",
      "-->",
      "",
      "<pre>",
      "- **Lint** - in a pre block",
      "</pre>",
      "",
      "> - **Lint** - in a quote",
      "",
      "- **Lint** - in prose",
      "  - **Nested** - in prose too",
    ].join("\n");

    expect(findLabeledBullets(text).map(({ line }) => line)).toEqual([23, 24]);
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

  test("reports a labeled bullet once, with the colon form, and keeps other problems in line order", () => {
    expect(
      findProseProblems("One; two.\n\n- **Lint** \u2014 runs ESLint; fast.\n"),
    ).toEqual([
      { line: 1, message: "has a semicolon. Split it into two sentences." },
      {
        line: 3,
        message:
          'labels a bullet with "**Lint** \u2014". Write "**Lint**: text", with a colon.',
      },
      { line: 3, message: "has a semicolon. Split it into two sentences." },
    ]);
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

  test("fails on a labeled bullet with its file and line", async () => {
    const root = await tempRepo({
      "README.md": "# Checks\n\n- **Lint** - runs ESLint.\n",
    });
    const error = spyOn(console, "error").mockImplementation(() => undefined);

    try {
      expect(await main(root)).toBe(1);
      expect(error.mock.calls).toEqual([
        [
          '::error file=README.md,line=3::labels a bullet with "**Lint** -". Write "**Lint**: text", with a colon.',
        ],
      ]);
    } finally {
      error.mockRestore();
      await rm(root, { recursive: true, force: true });
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
