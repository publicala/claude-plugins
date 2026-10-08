#!/usr/bin/env bun

// Fails when a relative Markdown link under plugins/ points at a missing file,
// or when a SKILL.md frontmatter lacks a required key.
import { existsSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

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

export function validateLinks(file: string, text: string): string[] {
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

export function validateFrontmatter(file: string, text: string): string[] {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1];

  if (frontmatter === undefined) {
    return ["missing frontmatter"];
  }

  let fields: unknown;

  try {
    fields = Bun.YAML.parse(frontmatter);
  } catch (error) {
    return [`frontmatter is not valid YAML: ${(error as Error).message}`];
  }

  if (typeof fields !== "object" || fields === null || Array.isArray(fields)) {
    return ["frontmatter is not a YAML mapping"];
  }

  const errors = REQUIRED_FRONTMATTER_KEYS.filter(
    (key) => !(key in fields),
  ).map((key) => `frontmatter lacks ${key}`);

  const name = (fields as Record<string, unknown>).name;
  const directory = basename(dirname(file));

  if (name !== undefined && name !== directory) {
    errors.push(
      `name ${JSON.stringify(name)} differs from directory "${directory}"`,
    );
  }

  return errors;
}

export async function validatePlugins(root: string): Promise<{
  checked: number;
  errors: string[];
}> {
  const paths = (
    await Array.fromAsync(
      new Bun.Glob("plugins/**/*.md").scan({ cwd: root, dot: true }),
    )
  ).toSorted();

  const errors = await Promise.all(
    paths.map(async (path) => {
      const file = join(root, path);
      const text = await Bun.file(file).text();
      const fileErrors = [
        ...validateLinks(file, text),
        ...(/\/skills\/[^/]+\/SKILL\.md$/.test(file)
          ? validateFrontmatter(file, text)
          : []),
      ];

      return fileErrors.map((error) => `${relative(root, file)}: ${error}`);
    }),
  );

  return { checked: paths.length, errors: errors.flat() };
}

export async function main(root = ROOT): Promise<number> {
  const { checked, errors } = await validatePlugins(root);

  for (const error of errors) {
    console.error(`::error::${error}`);
  }

  if (errors.length > 0) {
    return 1;
  }

  console.log(`checked ${checked} Markdown files under plugins/`);

  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
