#!/usr/bin/env bun

// Fails when a relative Markdown link points at a missing file, when a
// SKILL.md names a bundled file that does not exist or breaks a
// frontmatter rule, when a plugin's manifests disagree with the tree, or
// when a plugin file reads a path above the plugin's root.
import { existsSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

import {
  errorAnnotation,
  type Finding,
  lineAt,
  type Annotation,
} from "./workflow-command";
import {
  pluginNames,
  validateMarketplace,
  validatePluginManifests,
  validatePostinstall,
} from "./plugin-manifests";
import { validatePluginPaths } from "./plugin-paths";
import { repoFiles } from "./repo-files";
import { unquoteSkillVariables } from "./skill-variables";

const ROOT = join(import.meta.dir, "..");

// Every key a SKILL.md can set, per https://code.claude.com/docs/en/skills.
const FRONTMATTER_KEYS = [
  "name",
  "description",
  "when_to_use",
  "argument-hint",
  "arguments",
  "disable-model-invocation",
  "user-invocable",
  "allowed-tools",
  "disallowed-tools",
  "model",
  "effort",
  "context",
  "agent",
  "background",
  "hooks",
  "paths",
  "shell",
  "metadata",
  "license",
  "compatibility",
];

// The example line each required key's message offers.
const REQUIRED_FRONTMATTER = {
  name: (directory: string) => `name: ${directory}`,
  description: () => "description: <what the skill does and when to use it>",
  "user-invocable": () => "user-invocable: true",
  "disable-model-invocation": () => "disable-model-invocation: false",
};

const BOOLEAN_KEYS = ["user-invocable", "disable-model-invocation"];

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

function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateFrontmatter(file: string, text: string): Finding[] {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1];

  if (frontmatter === undefined) {
    return [
      {
        line: 1,
        message:
          "has no frontmatter. Open the file with a --- block that sets name, description, user-invocable and disable-model-invocation.",
      },
    ];
  }

  let fields: unknown;

  try {
    fields = Bun.YAML.parse(frontmatter);
  } catch (error) {
    return [
      {
        line: 1,
        message: `frontmatter is not valid YAML (${error instanceof Error ? error.message : String(error)}). Fix the syntax between the --- lines.`,
      },
    ];
  }

  if (!isMapping(fields)) {
    return [
      {
        line: 2,
        message:
          "frontmatter is not a YAML mapping. Write one key: value pair per line.",
      },
    ];
  }

  // The frontmatter starts on line 2, after the opening ---.
  const lines = frontmatter.split(/\r?\n/);
  const lineOf = (key: string): number | undefined => {
    const index = lines.findIndex((line) => line.startsWith(`${key}:`));

    return index === -1 ? undefined : index + 2;
  };

  const directory = basename(dirname(file));
  const findings: Finding[] = Object.entries(REQUIRED_FRONTMATTER)
    .filter(([key]) => !(key in fields))
    .map(([key, example]) => ({
      line: 1,
      message: `frontmatter lacks ${key}. Add the line "${example(directory)}".`,
    }));

  findings.push(
    ...Object.keys(fields)
      .filter((key) => !FRONTMATTER_KEYS.includes(key))
      .map((key) => ({
        line: lineOf(key),
        message: `frontmatter has the unknown key "${key}". Remove it, or use a key Claude Code reads: ${FRONTMATTER_KEYS.join(", ")}.`,
      })),
  );

  if ("name" in fields && fields.name !== directory) {
    findings.push({
      line: lineOf("name"),
      message: `name ${JSON.stringify(fields.name)} differs from the directory "${directory}". Write "name: ${directory}" or rename the directory.`,
    });
  }

  if ("description" in fields) {
    findings.push(...validateDescription(fields.description, lines));
  }

  findings.push(
    ...BOOLEAN_KEYS.filter(
      (key) => key in fields && typeof fields[key] !== "boolean",
    ).map((key) => ({
      line: lineOf(key),
      message: `${key} is ${JSON.stringify(fields[key])}. Write "${key}: true" or "${key}: false".`,
    })),
  );

  if (
    "argument-hint" in fields &&
    typeof fields["argument-hint"] !== "string"
  ) {
    findings.push({
      line: lineOf("argument-hint"),
      message: `argument-hint is ${JSON.stringify(fields["argument-hint"])}. Write it as a quoted string, like argument-hint: "[issue-number]".`,
    });
  }

  return findings;
}

/**
 * Claude Code reads the description to decide when to load the skill. It
 * stays one plain line, so it reads the same in the file and in a diff.
 */
function validateDescription(value: unknown, lines: string[]): Finding[] {
  const index = lines.findIndex((line) => line.startsWith("description:"));
  const line = index + 2;
  const blockScalar = /^description:\s*([>|])/.exec(lines[index] ?? "")?.[1];

  if (blockScalar !== undefined) {
    return [
      {
        line,
        message: `description is a ${blockScalar === ">" ? "folded" : "literal"} block scalar (${blockScalar}). Write it on one line after "description:", in double quotes when it holds ": ".`,
      },
    ];
  }

  if (typeof value !== "string" || value.trim() === "") {
    return [
      {
        line,
        message: `description is ${JSON.stringify(value)}. Write what the skill does and when to use it, on one line after "description:".`,
      },
    ];
  }

  // An indented line that opens with # is a YAML comment.
  if (/^\s+[^\s#]/.test(lines[index + 1] ?? "")) {
    return [
      {
        line,
        message: `description continues on line ${line + 1}. Write it on one line after "description:".`,
      },
    ];
  }

  return [];
}

export async function validatePlugins(root: string): Promise<{
  checked: { markdown: number; plugins: number };
  problems: Annotation[];
}> {
  const files = repoFiles(root);
  const markdown = files.filter((path) => path.endsWith(".md"));
  const plugins = pluginNames(files);

  const markdownProblems = await Promise.all(
    markdown.map(async (path) => {
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

  return {
    checked: { markdown: markdown.length, plugins: plugins.length },
    problems: [
      ...markdownProblems.flat(),
      ...validatePluginManifests(root, plugins),
      ...validateMarketplace(root, plugins),
      ...validatePostinstall(root, files),
      ...(await validatePluginPaths(root, files)),
    ],
  };
}

export async function main(root = ROOT): Promise<number> {
  const { checked, problems } = await validatePlugins(root);

  for (const problem of problems) {
    console.error(errorAnnotation(problem));
  }

  if (problems.length > 0) {
    return 1;
  }

  console.log(
    `checked ${checked.markdown} Markdown files and ${checked.plugins} plugin${checked.plugins === 1 ? "" : "s"}`,
  );

  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
