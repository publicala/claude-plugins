#!/usr/bin/env bun

// Fails when a relative Markdown link points at a missing file, when a
// SKILL.md names a bundled file that does not exist, or when a SKILL.md
// frontmatter lacks a required key.
import { existsSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

import {
  errorAnnotation,
  type Finding,
  lineAt,
  type Annotation,
} from "./workflow-command";
import { repoFiles } from "./repo-files";
import { unquoteSkillVariables } from "./skill-variables";

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

/**
 * Each link destination with the index where the source writes it. The
 * parser reports no positions, so every place a destination is written
 * gets a numbered tag, and the tag that comes back with a destination
 * names the place the parser read it, past any copy in a code example.
 */
export function locatedLinkTargets(
  text: string,
): { target: string; index: number | undefined }[] {
  const targets = linkTargets(text);
  const claimed: { start: number; end: number }[] = [];

  for (const target of [...new Set(targets)].toSorted(
    (a, b) => b.length - a.length,
  )) {
    for (
      let start = text.indexOf(target);
      start !== -1 && target !== "";
      start = text.indexOf(target, start + 1)
    ) {
      const end = start + target.length;

      // Only a destination takes a tag: one in a reference label would
      // change the label, and the reference would stop resolving.
      if (
        /(?:\]\(|\]:)\s*<?$/.test(text.slice(Math.max(0, start - 8), start)) &&
        !claimed.some((range) => start < range.end && range.start < end)
      ) {
        claimed.push({ start, end });
      }
    }
  }

  const ordered = claimed.toSorted((a, b) => a.start - b.start);
  const tagged = ordered.reduceRight(
    (source, { end }, tag) =>
      `${source.slice(0, end)}\uE000${tag}\uE001${source.slice(end)}`,
    text,
  );

  const tags = linkTargets(tagged).map(
    (written) => /\uE000(\d+)\uE001$/.exec(written)?.[1],
  );

  // A tag that changed what the parser reads leaves the lines unknown.
  return targets.map((target, position) => ({
    target,
    index:
      tags.length === targets.length
        ? ordered[Number(tags[position])]?.start
        : undefined,
  }));
}

export function validateLinks(file: string, text: string): Finding[] {
  return locatedLinkTargets(text).flatMap(({ target, index }) => {
    if (
      /^[a-z][a-z0-9+.-]*:/i.test(target) ||
      target.startsWith("#") ||
      existsSync(resolve(dirname(file), target.split("#")[0] ?? ""))
    ) {
      return [];
    }

    return [
      {
        line: index === undefined ? undefined : lineAt(text, index),
        message: `links to ${target}, which does not exist. Fix the path or remove the link.`,
      },
    ];
  });
}

// A path Claude Code expands when it loads a skill. A placeholder such as
// `<name>` or `*` ends the part that can be checked.
const SKILL_PATH =
  /\$\{(CLAUDE_SKILL_DIR|CLAUDE_PLUGIN_ROOT)\}((?:\/[\w.@~+-]*)*)([<*{[$]?)/g;

/**
 * Resolves each `${CLAUDE_SKILL_DIR}` and `${CLAUDE_PLUGIN_ROOT}` path in
 * a SKILL.md, code spans and fenced blocks included, as Claude Code does
 * when it loads the skill. The SKILL.md path is relative to the root.
 */
export function validateSkillPaths(
  root: string,
  path: string,
  text: string,
): Finding[] {
  const skillDirectory = dirname(path);
  const pluginRoot = dirname(dirname(skillDirectory));

  const unquoted = unquoteSkillVariables(text);

  return [...unquoted.matchAll(SKILL_PATH)].flatMap(
    ({ 1: variable, 2: suffix = "", 3: placeholder, index }) => {
      const checked = placeholder
        ? suffix.slice(0, suffix.lastIndexOf("/"))
        : suffix.replace(/\.+$/, "");
      const resolved = join(
        variable === "CLAUDE_SKILL_DIR" ? skillDirectory : pluginRoot,
        checked,
      );

      if (existsSync(join(root, resolved))) {
        return [];
      }

      return [
        {
          line: lineAt(unquoted, index),
          message: `\${${variable}}${checked} resolves to ${resolved}, which does not exist. Fix the path or restore the file.`,
        },
      ];
    },
  );
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
  const paths = repoFiles(root, "*.md");

  const problems = await Promise.all(
    paths.map(async (path) => {
      const file = join(root, path);
      const text = await Bun.file(file).text();
      const findings = [
        ...validateLinks(file, text),
        ...(/\/skills\/[^/]+\/SKILL\.md$/.test(file)
          ? [
              ...validateSkillPaths(root, path, text),
              ...validateFrontmatter(file, text),
            ]
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

  console.log(`checked ${checked} Markdown files`);

  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
