import { describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  checkProse,
  markdownFiles,
  findProseProblems,
  main,
  proseFragments,
} from "./check-prose";

// A temporary git repository with these files, untracked as a new file is.
async function gitRepo(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "check-prose-"));

  for (const [path, text] of Object.entries(files)) {
    await Bun.write(join(root, path), text);
  }

  Bun.spawnSync(["git", "init", "--quiet"], { cwd: root });

  return root;
}

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
  test("checks every Markdown file git would commit, in any directory", async () => {
    const root = await gitRepo({
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
        errors: [
          ".claude/bonsai/candidates/pr1.md: line 1 has a semicolon. Split it into two sentences.",
          "docs/guide.md: line 1 has an em dash. Use parentheses or split the sentence.",
          "plugins/demo/SKILL.md: line 1 has a semicolon. Split it into two sentences.",
        ],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("names the folder when git cannot list it", async () => {
    const root = await mkdtemp(join(tmpdir(), "check-prose-"));

    try {
      expect(() => markdownFiles(root)).toThrow(
        `Unable to list the Markdown files with git in ${root}:`,
      );
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
    const root = await gitRepo({ "README.md": "One \u2014 two.\n" });
    const error = spyOn(console, "error").mockImplementation(() => undefined);

    try {
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
