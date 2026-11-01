#!/usr/bin/env bun

// Fails when a relative Markdown link under plugins/ points at a missing file,
// or when a SKILL.md frontmatter lacks a required key.
import { existsSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

import {
  errorAnnotation,
  type Finding,
  lineAt,
  type Annotation,
} from "./workflow-command";

const ROOT = join(import.meta.dir, "..");

const REQUIRED_FRONTMATTER_KEYS = [
  "name",
  "description",
  "user-invocable",
  "disable-model-invocation",
];

/**
 * Collects link and image destinations as a Markdown parser reads
 * them, so code blocks, code spans and unused definitions never count.
 */
export function linkTargets(text: string): string[] {
  const targets: string[] = [];

  Bun.markdown.render(text, {
    link: (children, { href }) => {
      targets.push(href);
      return children;
    },
    image: (children, { src }) => {
      targets.push(src);
      return children;
    },
  });

  return targets;
}

export function validateLinks(file: string, text: string): Finding[] {
  const searchFrom = new Map<string, number>();

  return linkTargets(text).flatMap((target) => {
    // The same target can appear twice, so each search starts after the last.
    const index = text.indexOf(target, searchFrom.get(target) ?? 0);

    if (index !== -1) {
      searchFrom.set(target, index + target.length);
    }

    if (
      /^[a-z][a-z0-9+.-]*:/i.test(target) ||
      target.startsWith("#") ||
      existsSync(resolve(dirname(file), target.split("#")[0] ?? ""))
    ) {
      return [];
    }

    return [
      {
        line: index === -1 ? undefined : lineAt(text, index),
        message: `link target not found: ${target}`,
      },
    ];
  });
}

export function validateFrontmatter(file: string, text: string): Finding[] {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1];

  if (frontmatter === undefined) {
    return [{ line: 1, message: "missing frontmatter" }];
  }

  let fields: unknown;

  try {
    fields = Bun.YAML.parse(frontmatter);
  } catch (error) {
    return [
      {
        line: 1,
        message: `frontmatter is not valid YAML: ${(error as Error).message}`,
      },
    ];
  }

  if (typeof fields !== "object" || fields === null || Array.isArray(fields)) {
    return [{ line: 1, message: "frontmatter is not a YAML mapping" }];
  }

  const errors: Finding[] = REQUIRED_FRONTMATTER_KEYS.filter(
    (key) => !(key in fields),
  ).map((key) => ({ line: 1, message: `frontmatter lacks ${key}` }));

  const name = (fields as Record<string, unknown>).name;
  const directory = basename(dirname(file));

  if (name !== undefined && name !== directory) {
    errors.push({
      line: 1,
      message: `name ${JSON.stringify(name)} differs from directory "${directory}"`,
    });
  }

  return errors;
}

export async function validatePlugins(root: string): Promise<{
  checked: number;
  problems: Annotation[];
}> {
  const paths = (
    await Array.fromAsync(
      new Bun.Glob("plugins/**/*.md").scan({ cwd: root, dot: true }),
    )
  )
    .filter((path) => !path.includes("node_modules/"))
    .toSorted();

  const problems = await Promise.all(
    paths.map(async (path) => {
      const file = join(root, path);
      const text = await Bun.file(file).text();
      const findings = [
        ...validateLinks(file, text),
        ...(/\/skills\/[^/]+\/SKILL\.md$/.test(file)
          ? validateFrontmatter(file, text)
          : []),
      ];

      return findings.map((finding) => ({
        file: relative(root, file),
        ...finding,
      }));
    }),
  );

  return { checked: paths.length, problems: problems.flat() };
}

export async function main(root = ROOT): Promise<number> {
  const { checked, problems } = await validatePlugins(root);

  for (const problem of problems) {
    console.error(errorAnnotation(problem));
  }

  if (problems.length > 0) {
    return 1;
  }

  console.log(`checked ${checked} Markdown files under plugins/`);

  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
