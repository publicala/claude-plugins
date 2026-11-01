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

/** The lines of a JSON key, or of the key with this value when given. */
export function linesOfKey(
  text: string,
  key: string,
  value?: unknown,
): number[] {
  const pattern = `"${RegExp.escape(key)}"\\s*:${value === undefined ? "" : `\\s*${RegExp.escape(JSON.stringify(value))}`}`;

  return [...text.matchAll(new RegExp(pattern, "g"))].map(({ index }) =>
    lineAt(text, index),
  );
}

export function lineOfKey(
  text: string,
  key: string,
  value?: unknown,
): number | undefined {
  return linesOfKey(text, key, value)[0];
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

const MARKETPLACE = ".claude-plugin/marketplace.json";

// Where GitHub shows a plugin's directory, for the marketplace homepage.
const TREE_URL = "https://github.com/publicala/claude-plugins/tree/main";

/**
 * The marketplace lists every plugin under plugins/ once, with the name
 * and description of its plugin.json and its directory as the homepage.
 */
export function validateMarketplace(
  root: string,
  plugins: string[],
): Annotation[] {
  const read = readJsonObject(root, MARKETPLACE);

  if (read === undefined) {
    return plugins.length === 0
      ? []
      : [
          {
            file: MARKETPLACE,
            message:
              "is missing, so no plugin under plugins/ can be installed. Add it with an entry per plugin.",
          },
        ];
  }

  if ("problem" in read) {
    return [read.problem];
  }

  const { text, json } = read;
  const problem = (line: number | undefined, message: string): Annotation => ({
    file: MARKETPLACE,
    line,
    message,
  });

  if (!Array.isArray(json.plugins)) {
    return [
      problem(
        lineOfKey(text, "plugins") ?? 1,
        `"plugins" is ${describeValue(json.plugins)}. Write "plugins": [ ] with an entry per directory under plugins/.`,
      ),
    ];
  }

  const listed = new Set<string>();
  const problems = json.plugins.flatMap((entry: unknown): Annotation[] => {
    if (!isObject(entry) || typeof entry.source !== "string") {
      return [
        problem(
          lineOfKey(text, "plugins"),
          `lists the entry ${JSON.stringify(entry)}, which has no "source" path. Write "source": "./plugins/<name>".`,
        ),
      ];
    }

    const source = entry.source.replace(/^\.\//, "").replace(/\/$/, "");
    const name = /^plugins\/([^/]+)$/.exec(source)?.[1];

    if (name === undefined || !plugins.includes(name)) {
      return [
        problem(
          lineOfKey(text, "source", entry.source),
          `"source" is ${JSON.stringify(entry.source)}, which is no plugin directory. Point it at one, like "./plugins/<name>".`,
        ),
      ];
    }

    if (listed.has(name)) {
      return [
        problem(
          linesOfKey(text, "source", entry.source).at(-1),
          `lists ${source} twice. Remove one of its entries.`,
        ),
      ];
    }

    listed.add(name);

    const manifest = readJsonObject(root, manifestPath(name));
    const homepage = `${TREE_URL}/${source}`;
    const entryProblems: Annotation[] = [];

    // A plugin.json that does not parse gets its own problem.
    if (manifest !== undefined && "json" in manifest) {
      for (const key of ["name", "description"]) {
        if (entry[key] !== manifest.json[key]) {
          entryProblems.push(
            problem(
              lineOfKey(text, key, entry[key]) ??
                lineOfKey(text, "source", entry.source),
              `"${key}" of ${source} is ${describeValue(entry[key])}, and ${manifestPath(name)} says ${describeValue(manifest.json[key])}. Copy the plugin.json value here.`,
            ),
          );
        }
      }
    }

    if (entry.homepage !== homepage) {
      entryProblems.push(
        problem(
          lineOfKey(text, "homepage", entry.homepage) ??
            lineOfKey(text, "source", entry.source),
          `"homepage" of ${source} is ${describeValue(entry.homepage)}. Write "homepage": "${homepage}".`,
        ),
      );
    }

    return entryProblems;
  });

  return [
    ...problems,
    ...plugins
      .filter((name) => !listed.has(name))
      .map((name) =>
        problem(
          lineOfKey(text, "plugins"),
          `does not list plugins/${name}, so it cannot be installed. Add an entry with its name, description, "source": "./plugins/${name}" and "homepage": "${TREE_URL}/plugins/${name}".`,
        ),
      ),
  ];
}
