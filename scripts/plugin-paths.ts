// Install copies each plugin to a cache on its own, so a path that climbs
// above the plugin's root reads nothing on a user's machine.
import { lstatSync } from "node:fs";
import { join, posix } from "node:path";

import { type Finding, lineAt, type Annotation } from "./workflow-command";
import { unquoteSkillVariables } from "./skill-variables";

const SCANNED = /\.(?:ts|md|json|html)$/;

// A path behind a variable Claude Code expands, anywhere in a file.
const VARIABLE_PATH = /\$\{(CLAUDE_SKILL_DIR|CLAUDE_PLUGIN_ROOT)\}[\w.@~+/-]*/g;

// A Markdown link or image destination, inline or in a definition.
const LINK_DESTINATION = /(?:\]\(\s*<?|^ {0,3}\[[^\]]+\]:\s*<?)([^\s)>]+)/gm;

// A string literal on one line.
const STRING_LITERAL = /(["'])((?:\\.|(?!\1)[^\\\n])*)\1/g;

// A module specifier: `from "x"`, `import "x"`, `import("x")`, `require("x")`,
// or a URL built on the module's own.
const SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(["'])([^"'\n]+)\1|\bnew URL\(\s*(["'])([^"'\n]+)\3\s*,\s*import\.meta\.url\b/g;

// What reads no file: Markdown code and TypeScript comments. Blanking it
// keeps every line where it was.
const MARKDOWN_CODE =
  /^ {0,3}(`{3,}|~{3,})[\s\S]*?(?:^ {0,3}\1|(?![\s\S]))|`[^`\n]+`/gm;
const TYPESCRIPT_COMMENT = /\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm;

// A template literal that starts at the source file's directory.
const DIRECTORY_TEMPLATE =
  /\$\{(?:import\.meta\.dirname|import\.meta\.dir|__dirname)\}[\w.@~+/-]*/g;

// A join or resolve call on the source file's directory with only string
// arguments, which names one path however its segments are split.
const DIRECTORY_CALL =
  /\b(?:join|resolve)\(\s*(?:import\.meta\.dirname|import\.meta\.dir|__dirname)((?:\s*,\s*(["'])[^"'\n]*\2)+)\s*,?\s*\)/g;

// An HTML attribute that loads a file relative to the page.
const HTML_REFERENCE = /\b(?:src|href)\s*=\s*(["'])([^"'\n]+)\1/g;

interface Reference {
  index: number;
  written: string;
  // The directory the path resolves from, relative to the repository root.
  base: string | undefined;
  relativePath: string;
}

/**
 * Finds the paths in a plugin file that resolve above the plugin's root:
 * `${CLAUDE_PLUGIN_ROOT}` and `${CLAUDE_SKILL_DIR}` paths anywhere, links
 * in Markdown, module specifiers and paths built on the file's directory
 * in code, `src` and `href` in HTML, and the paths of plugin.json. Other
 * relative paths (a command's argument, a string of data) resolve from a
 * directory the file does not name, so they are left alone. The file's
 * path is relative to the repository root.
 */
export function findEscapingPaths(path: string, text: string): Finding[] {
  const pluginRoot = /^plugins\/[^/]+(?=\/)/.exec(path)?.[0];

  if (pluginRoot === undefined) {
    return [];
  }

  const skillDirectory = /^plugins\/[^/]+\/skills\/[^/]+/.exec(path)?.[0];
  // Claude Code reads the paths in plugin.json from the plugin's root.
  const directory = path.endsWith("/.claude-plugin/plugin.json")
    ? pluginRoot
    : posix.dirname(path);
  const source = unquoteSkillVariables(text);

  const references: Reference[] = [
    ...[...source.matchAll(VARIABLE_PATH)].map(
      ({ 0: written, 1: variable, index }) => ({
        index,
        written,
        base: variable === "CLAUDE_PLUGIN_ROOT" ? pluginRoot : skillDirectory,
        relativePath: written.replace(/^\$\{\w+\}\/?/, ""),
      }),
    ),
    ...fileReferences(path, source, directory),
  ];

  return references
    .filter(({ relativePath }) => relativePath.split("/").includes(".."))
    .toSorted((a, b) => a.index - b.index)
    .flatMap(({ index, written, base, relativePath }) => {
      // An absolute path or a URL's path names no file in the plugin.
      if (
        base === undefined ||
        relativePath.startsWith("/") ||
        relativePath.startsWith("~")
      ) {
        return [];
      }

      const resolved = posix.join(base, relativePath);

      if (!posix.relative(pluginRoot, resolved).startsWith("..")) {
        return [];
      }

      return [
        {
          line: lineAt(source, index),
          message: `reads ${written}, which resolves to ${resolved}, outside ${pluginRoot}/. Install copies the plugin alone, so the path breaks for users. Move the file into the plugin, or commit a symlink inside the plugin that points at it.`,
        },
      ];
    });
}

function fileReferences(
  path: string,
  source: string,
  directory: string,
): Reference[] {
  const relativeTo = (
    pattern: RegExp,
    group: number,
    ignored?: RegExp,
  ): Reference[] =>
    [
      ...(ignored === undefined
        ? source
        : source.replaceAll(ignored, (code) => code.replaceAll(/[^\n]/g, " "))
      ).matchAll(pattern),
    ].map((match) => {
      const written = match[group] ?? match[group + 2] ?? "";

      return {
        index: match.index,
        written,
        base: directory,
        relativePath: written.split("#")[0] ?? "",
      };
    });

  if (path.endsWith(".md")) {
    return relativeTo(LINK_DESTINATION, 1, MARKDOWN_CODE).filter(
      ({ written }) =>
        !written.startsWith("${") && !/^[a-z][a-z0-9+.-]*:/i.test(written),
    );
  }

  if (path.endsWith(".html")) {
    return relativeTo(HTML_REFERENCE, 2);
  }

  if (path.endsWith("/.claude-plugin/plugin.json")) {
    return relativeTo(STRING_LITERAL, 2);
  }

  if (!path.endsWith(".ts")) {
    return [];
  }

  return [
    ...relativeTo(SPECIFIER, 2, TYPESCRIPT_COMMENT),
    ...relativeTo(DIRECTORY_TEMPLATE, 0).map((reference) => ({
      ...reference,
      relativePath: reference.written.replace(/^\$\{[\w.]+\}\/?/, ""),
    })),
    ...[...source.matchAll(DIRECTORY_CALL)].map(
      ({ 0: written, 1: argumentList = "", index }) => ({
        index,
        written: written.replaceAll(/\s+/g, " ").replace("( ", "("),
        base: directory,
        relativePath: posix.join(
          ".",
          ...[...argumentList.matchAll(/(["'])([^"'\n]*)\1/g)].map(
            ([, , segment = ""]) => segment,
          ),
        ),
      }),
    ),
  ];
}

/**
 * Checks the code, docs and data of every plugin. A committed symlink is
 * the way to share a file, so symlinks are skipped.
 */
export async function validatePluginPaths(
  root: string,
  files: string[],
): Promise<Annotation[]> {
  const scanned = files.filter(
    (path) =>
      path.startsWith("plugins/") &&
      SCANNED.test(path) &&
      !lstatSync(join(root, path)).isSymbolicLink(),
  );

  const problems = await Promise.all(
    scanned.map(async (file) =>
      findEscapingPaths(file, await Bun.file(join(root, file)).text()).map(
        (finding) => ({ file, ...finding }),
      ),
    ),
  );

  return problems.flat();
}
