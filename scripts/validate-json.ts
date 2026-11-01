#!/usr/bin/env bun

// Fails when a JSON file does not parse, and names the line and column
// where the parser stopped. A `.json` file is strict JSON. A `.jsonc` file
// may carry comments and trailing commas.
import { existsSync } from "node:fs";
import { join } from "node:path";

import { parse, printParseErrorCode, type ParseError } from "jsonc-parser";

import { errorAnnotation } from "./workflow-command";

const ROOT = join(import.meta.dir, "..");

export interface JsonProblem {
  line: number;
  column: number;
  message: string;
}

/**
 * The first place the text stops being valid JSON, or null when it parses.
 * Later errors follow from the first, so only the first is reported.
 */
export function findJsonProblem(
  text: string,
  { comments }: { comments: boolean },
): JsonProblem | null {
  const errors: ParseError[] = [];

  parse(text, errors, {
    disallowComments: !comments,
    allowTrailingComma: comments,
    allowEmptyContent: false,
  });

  const [first] = errors;

  if (first === undefined) {
    return null;
  }

  const before = text.slice(0, first.offset).split("\n");

  return {
    line: before.length,
    column: (before.at(-1)?.length ?? 0) + 1,
    message: describeError(printParseErrorCode(first.error)),
  };
}

// "CommaExpected" reads as "Comma expected".
function describeError(code: string): string {
  const words = code.replace(/(?<=[a-z])(?=[A-Z])/g, " ").toLowerCase();

  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Every JSON file a commit could carry: tracked, or untracked and not
 * ignored, in any directory.
 */
export function jsonFiles(root: string): string[] {
  const listed = Bun.spawnSync(
    [
      "git",
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      "*.json",
      "*.jsonc",
    ],
    { cwd: root },
  );

  if (!listed.success) {
    throw new Error(
      `Unable to list the JSON files with git in ${root}: ${listed.stderr.toString().trim()}`,
    );
  }

  return [...new Set(listed.stdout.toString().split("\0"))]
    .filter((path) => path !== "" && existsSync(join(root, path)))
    .toSorted();
}

export async function validateJson(root: string): Promise<{
  checked: number;
  problems: (JsonProblem & { path: string })[];
}> {
  const paths = jsonFiles(root);

  const problems = await Promise.all(
    paths.map(async (path) => {
      const problem = findJsonProblem(await Bun.file(join(root, path)).text(), {
        comments: path.endsWith(".jsonc"),
      });

      return problem === null ? [] : [{ path, ...problem }];
    }),
  );

  return { checked: paths.length, problems: problems.flat() };
}

export async function main(root = ROOT): Promise<number> {
  const { checked, problems } = await validateJson(root);

  for (const { path, line, column, message } of problems) {
    console.error(
      errorAnnotation({
        file: path,
        line,
        col: column,
        message: `${path} line ${line}, column ${column}: ${message}`,
      }),
    );
  }

  if (problems.length > 0) {
    return 1;
  }

  console.log(`checked ${checked} JSON files`);

  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
