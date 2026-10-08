#!/usr/bin/env bun

// Fails when a relative Markdown link under plugins/ points at a missing file,
// or when a SKILL.md frontmatter lacks a required key. Run from the repo root.
import { existsSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

const REQUIRED_FRONTMATTER_KEYS = [
  "name",
  "description",
  "user-invocable",
  "disable-model-invocation",
];

// Inline destinations, angle-bracket destinations, and reference definitions.
export function linkTargets(text: string): string[] {
  const inline = text.matchAll(/\]\((<[^>]*>|[^)\s]+)(?:\s+"[^"]*")?\)/g);
  const definitions = text.matchAll(/^ {0,3}\[[^\]]+\]:\s*(<[^>]*>|\S+)/gm);

  return [...inline, ...definitions]
    .map((match) => match[1] ?? "")
    .map((target) => (target.startsWith("<") ? target.slice(1, -1) : target));
}

export function brokenLinks(file: string, text: string): string[] {
  return linkTargets(text)
    .filter(
      (target) =>
        !/^[a-z][a-z0-9+.-]*:/i.test(target) && !target.startsWith("#"),
    )
    .filter(
      (target) =>
        !existsSync(resolve(dirname(file), target.split("#")[0] ?? "")),
    )
    .map((target) => `link target not found: ${target}`);
}

export function frontmatterProblems(file: string, text: string): string[] {
  const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1];

  if (frontmatter === undefined) {
    return ["missing frontmatter"];
  }

  const keys = new Set(
    frontmatter
      .split("\n")
      .filter((line) => /^[a-z-]+:/.test(line))
      .map((line) => line.split(":")[0]),
  );
  const problems = REQUIRED_FRONTMATTER_KEYS.filter(
    (key) => !keys.has(key),
  ).map((key) => `frontmatter lacks ${key}`);

  const name = /^name:\s*(\S+)/m.exec(frontmatter)?.[1];
  const directory = basename(dirname(file));

  if (name !== undefined && name !== directory) {
    problems.push(`name "${name}" differs from directory "${directory}"`);
  }

  return problems;
}

export async function checkPlugins(root: string): Promise<{
  checked: number;
  errors: string[];
}> {
  const files = await Array.fromAsync(
    new Bun.Glob("plugins/**/*.md").scan({ cwd: root, dot: true }),
  );
  const errors: string[] = [];

  for (const path of files.sort()) {
    const file = join(root, path);
    const text = await Bun.file(file).text();
    const problems = [
      ...brokenLinks(file, text),
      ...(/\/skills\/[^/]+\/SKILL\.md$/.test(file)
        ? frontmatterProblems(file, text)
        : []),
    ];

    errors.push(
      ...problems.map((problem) => `${relative(root, file)}: ${problem}`),
    );
  }

  return { checked: files.length, errors };
}

export async function main(root: string): Promise<number> {
  const { checked, errors } = await checkPlugins(root);

  for (const error of errors) {
    console.error(`::error::${error}`);
  }

  if (errors.length > 0) {
    return 1;
  }

  console.log(`checked ${String(checked)} Markdown files under plugins/`);

  return 0;
}

if (import.meta.main) {
  process.exit(await main(process.cwd()));
}
