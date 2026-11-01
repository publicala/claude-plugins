// Checks the JSON files that tell Claude Code what a plugin is.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { type Finding, lineAt, type Annotation } from "./workflow-command";

/** The plugin directories under plugins/ that hold at least one file. */
export function pluginNames(paths: string[]): string[] {
  return [
    ...new Set(
      paths.flatMap((path) => /^plugins\/([^/]+)\/./.exec(path)?.[1] ?? []),
    ),
  ].toSorted();
}

export function manifestPath(name: string): string {
  return `plugins/${name}/.claude-plugin/plugin.json`;
}

function describeValue(value: unknown): string {
  return value === undefined ? "missing" : JSON.stringify(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The line of a JSON key, or of the key with this value when given. */
export function lineOfKey(
  text: string,
  key: string,
  value?: unknown,
): number | undefined {
  const pattern = `"${RegExp.escape(key)}"\\s*:${value === undefined ? "" : `\\s*${RegExp.escape(JSON.stringify(value))}`}`;
  const index = new RegExp(pattern).exec(text)?.index;

  return index === undefined ? undefined : lineAt(text, index);
}

/**
 * Parses a JSON file into an object, or explains why it cannot. The path
 * is relative to the root.
 */
export function readJsonObject(
  root: string,
  path: string,
):
  | { text: string; json: Record<string, unknown> }
  | { problem: Annotation }
  | undefined {
  if (!existsSync(join(root, path))) {
    return undefined;
  }

  const text = readFileSync(join(root, path), "utf8");
  let json: unknown;

  try {
    json = JSON.parse(text);
  } catch (error) {
    return {
      problem: {
        file: path,
        line: 1,
        message: `is not valid JSON (${error instanceof Error ? error.message : String(error)}). Fix the syntax.`,
      },
    };
  }

  if (!isObject(json)) {
    return {
      problem: {
        file: path,
        line: 1,
        message: "is not a JSON object. Write its keys inside { }.",
      },
    };
  }

  return { text, json };
}

export function validatePluginManifest(
  name: string,
  text: string,
  manifest: Record<string, unknown>,
): Finding[] {
  const findings: Finding[] = [];

  if (manifest.name !== name) {
    findings.push({
      line: lineOfKey(text, "name") ?? 1,
      message: `"name" is ${describeValue(manifest.name)}, and the plugin's directory is "${name}". Write "name": "${name}".`,
    });
  }

  if (
    typeof manifest.description !== "string" ||
    manifest.description.trim() === ""
  ) {
    findings.push({
      line: lineOfKey(text, "description") ?? 1,
      message: `"description" is ${describeValue(manifest.description)}. Write "description": "<what the plugin does>".`,
    });
  }

  if ("version" in manifest) {
    findings.push({
      line: lineOfKey(text, "version"),
      message:
        'carries "version", and CLAUDE.md says: "plugin.json carries no version, so every merge reaches users." Remove the "version" key.',
    });
  }

  return findings;
}

/** Every plugin under plugins/ has a plugin.json Claude Code can install. */
export function validatePluginManifests(
  root: string,
  plugins: string[],
): Annotation[] {
  return plugins.flatMap((name) => {
    const file = manifestPath(name);
    const read = readJsonObject(root, file);

    if (read === undefined) {
      return [
        {
          file,
          message: `is missing, so Claude Code cannot install plugins/${name}. Add it with "name": "${name}" and a "description".`,
        },
      ];
    }

    if ("problem" in read) {
      return [read.problem];
    }

    return validatePluginManifest(name, read.text, read.json).map(
      (finding) => ({ file, ...finding }),
    );
  });
}
