import { describe, expect, spyOn, test } from "bun:test";
import { rm } from "node:fs/promises";

import { tempRepo } from "./temp-repo";
import { findJsonProblem, main, validateJson } from "./validate-json";

const strict = { comments: false };
const lenient = { comments: true };

describe("findJsonProblem", () => {
  test("accepts valid JSON", () => {
    expect(findJsonProblem('{\n  "a": [1, "two", null]\n}\n', strict)).toBe(
      null,
    );
  });

  test.each<[string, string, number, number, string]>([
    ["a missing comma", '{\n  "a": 1\n  "b": 2\n}', 3, 3, "Comma expected"],
    ["a trailing comma", '{\n  "a": 1,\n}', 3, 1, "Property name expected"],
    ["a comment", '{\n  // note\n  "a": 1\n}', 2, 3, "Invalid comment token"],
    ["an empty file", "\n", 2, 1, "Value expected"],
    ["a second value", '{"a": 1}\n{"b": 2}', 2, 1, "End of file expected"],
    ["an unclosed string", '{"a": "one', 1, 7, "Unexpected end of string"],
  ])("names the line and column of %s", (_, text, line, column, message) => {
    expect(findJsonProblem(text, strict)).toEqual({ line, column, message });
  });

  test("accepts comments and trailing commas in JSONC", () => {
    expect(findJsonProblem('{\n  // note\n  "a": 1,\n}\n', lenient)).toBeNull();
  });

  test("still rejects a broken JSONC file", () => {
    expect(findJsonProblem('{ "a": 1 "b": 2 }', lenient)).toEqual({
      line: 1,
      column: 10,
      message: "Comma expected",
    });
  });
});

describe("validateJson", () => {
  test("checks every JSON and JSONC file git would commit, in any directory", async () => {
    const root = await tempRepo({
      ".gitignore": "node_modules\nignored.json\n",
      "package.json": "{}\n",
      "config/settings.jsonc": '{\n  // note\n  "a": 1,\n}\n',
      "plugins/demo/plugin.json": '{\n  "name": "demo"\n  "b": 1\n}\n',
      "node_modules/dep/package.json": "{",
      "ignored.json": "{",
    });

    try {
      expect(await validateJson(root)).toEqual({
        checked: 3,
        problems: [
          {
            path: "plugins/demo/plugin.json",
            line: 3,
            column: 3,
            message: "Comma expected",
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
      expect(log).toHaveBeenCalledWith(
        expect.stringMatching(/^checked \d+ JSON files$/),
      );
    } finally {
      log.mockRestore();
    }
  });

  test("fails and names the file, line and column as a GitHub annotation", async () => {
    const root = await tempRepo({ "data.json": '{\n  "a": 1\n  "b": 2\n}\n' });
    const error = spyOn(console, "error").mockImplementation(() => undefined);

    try {
      expect(await main(root)).toBe(1);
      expect(error).toHaveBeenCalledWith(
        "::error file=data.json,line=3,col=3::data.json line 3, column 3: Comma expected",
      );
    } finally {
      error.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });
});
