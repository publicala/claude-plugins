import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  checkRestrictedNames,
  findRestrictedWords,
  main,
  parseHashList,
} from "./check-restricted-names";
import { tempRepo } from "./temp-repo";

// Made-up words stand in for the restricted names, which never appear here.
const RESTRICTED = ["zorblax", "quintarra"];

function sha256(word: string): string {
  return createHash("sha256").update(word).digest("hex");
}

const HASHES = new Set(RESTRICTED.map(sha256));
const ZORBLAX = sha256("zorblax").slice(0, 8);

describe("parseHashList", () => {
  test("reads one digest per line, skipping blank lines and padding", () => {
    expect(
      parseHashList(`\n  ${sha256("zorblax").toUpperCase()}\n\n`, "list.txt"),
    ).toEqual(new Set([sha256("zorblax")]));
  });

  test("refuses a line that is not a SHA-256 hex digest", () => {
    expect(() =>
      parseHashList(`${sha256("a")}\nzorblax\n`, "list.txt"),
    ).toThrow('Line 2 of list.txt is not a SHA-256 hex digest: "zorblax".');
  });

  test("refuses an empty list, which would pass anything", () => {
    expect(() => parseHashList("\n\n", "list.txt")).toThrow(
      "list.txt holds no hashes, so the check would pass on anything.",
    );
  });
});

describe("findRestrictedWords", () => {
  test("finds a word in any case, with its line and column", () => {
    expect(
      findRestrictedWords("Intro\nWe ship ZorBlax and quintarra.\n", HASHES),
    ).toEqual([
      { line: 2, column: 9, hash: sha256("zorblax") },
      { line: 2, column: 21, hash: sha256("quintarra") },
    ]);
  });

  test.each([
    ["a code span", "Run `zorblax sync` first."],
    ["a URL", "See https://example.com/zorblax/setup."],
    ["a hyphenated name", "The zorblax-integrations repo."],
    ["a dotted host", "Open zorblax.example.com."],
    ["a path", "Edit ~/dev/zorblax/README.md."],
  ])("finds the word inside %s", (_, text) => {
    expect(findRestrictedWords(text, HASHES)).toHaveLength(1);
  });

  // The org step hashes whole words, so a longer word never matches.
  test.each([
    ["a prefix", "zorblaxian"],
    ["a suffix", "prezorblax"],
    ["an underscore", "zorblax_core"],
    ["a digit", "zorblax2"],
    ["an accented letter", "zorblaxé"],
  ])("ignores a word that only contains the name, with %s", (_, text) => {
    expect(findRestrictedWords(text, HASHES)).toEqual([]);
  });
});

describe("checkRestrictedNames", () => {
  test("checks paths and text, and skips lockfiles and binary files", async () => {
    const root = await tempRepo({
      "README.md": "Acme Books\n",
      "docs/zorblax/notes.md": "Acme Books\n",
      "bun.lock": '{ "zorblax": "1.0.0" }\n',
      "plugins/demo/bun.lock": '{ "zorblax": "1.0.0" }\n',
      "assets/logo.bin": "\u0000zorblax\n",
    });

    try {
      expect(await checkRestrictedNames(root, HASHES)).toEqual({
        scanned: 2,
        hits: [
          {
            file: "docs/zorblax/notes.md",
            message: `The path docs/zorblax/notes.md has a restricted project name (sha256 ${ZORBLAX}). Replace it with a made-up one such as Acme Books.`,
          },
        ],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("main", () => {
  let listDirectory: string;
  let listPath: string;

  beforeEach(async () => {
    listDirectory = await mkdtemp(join(tmpdir(), "hashes-"));
    listPath = join(listDirectory, "hashes.txt");
    await Bun.write(listPath, `${[...HASHES].join("\n")}\n`);
  });

  afterEach(async () => {
    await rm(listDirectory, { recursive: true, force: true });
  });

  async function run(
    files: Record<string, string>,
    args: string[],
  ): Promise<{ code: number; errors: string[]; logs: string[] }> {
    const root = await tempRepo(files);
    const error = spyOn(console, "error").mockImplementation(() => undefined);
    const log = spyOn(console, "log").mockImplementation(() => undefined);

    try {
      const code = await main(root, args);

      return {
        code,
        errors: error.mock.calls.map(([line]) => String(line)),
        logs: log.mock.calls.map(([line]) => String(line)),
      };
    } finally {
      error.mockRestore();
      log.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  }

  test("passes on this repository with the built-in list", async () => {
    const log = spyOn(console, "log").mockImplementation(() => undefined);

    try {
      expect(await main()).toBe(0);
      expect(log).toHaveBeenCalledWith(
        expect.stringMatching(
          /^checked \d+ files for restricted project names$/,
        ),
      );
    } finally {
      log.mockRestore();
    }
  });

  test("fails on a planted name with an annotation that never prints the word", async () => {
    const { code, errors, logs } = await run(
      { "docs/guide.md": "Intro\nWe ship Zorblax today.\n" },
      ["--list", listPath],
    );

    expect(code).toBe(1);
    expect(errors).toEqual([
      `::error file=docs/guide.md,line=2,col=9::docs/guide.md line 2, column 9 has a restricted project name (sha256 ${ZORBLAX}). Replace it with a made-up one such as Acme Books.`,
    ]);
    expect([...errors, ...logs].join("\n")).not.toMatch(/zorblax/i);
  });

  test("passes the compliant twin and counts the files it checked", async () => {
    const { code, errors, logs } = await run(
      { "docs/guide.md": "Intro\nWe ship Acme Books today.\n" },
      ["--list", listPath],
    );

    expect({ code, errors, logs }).toEqual({
      code: 0,
      errors: [],
      logs: ["checked 1 files for restricted project names"],
    });
  });

  test("fails when there is no file to check", async () => {
    const { code, errors } = await run({ "bun.lock": "{}\n" }, [
      "--list",
      listPath,
    ]);

    expect(code).toBe(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStartWith("::error::Found no text files to check in ");
    expect(errors[0]).toEndWith(
      ". Run the check from a git checkout of this repository.",
    );
  });

  test("fails on a list it cannot use", async () => {
    await Bun.write(listPath, "zorblax\n");

    const { code, errors } = await run({ "a.md": "Acme Books\n" }, [
      "--list",
      listPath,
    ]);

    expect(code).toBe(1);
    expect(errors).toEqual([
      `::error::Line 1 of ${listPath} is not a SHA-256 hex digest: "zorblax".`,
    ]);
  });

  test("fails on an argument it does not know", async () => {
    const { code, errors } = await run({ "a.md": "Acme Books\n" }, [
      "--lists",
      listPath,
    ]);

    expect(code).toBe(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStartWith("::error::");
    expect(errors[0]).toContain("--lists");
  });
});
