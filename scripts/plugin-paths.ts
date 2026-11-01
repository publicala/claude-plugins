// Install copies each plugin to a cache on its own, so a path that climbs
// above the plugin's root reads nothing on a user's machine.
import { lstatSync } from "node:fs";
import { join, posix } from "node:path";

import { type Node, parseTree } from "jsonc-parser";

import { type Finding, lineAt, type Annotation } from "./workflow-command";
import { unquoteSkillVariables } from "./skill-variables";
import { readTypeScript } from "./typescript-source";

const SCANNED = /\.(?:ts|md|json|html|css)$/;

// A path behind a variable Claude Code expands, anywhere in a file.
const VARIABLE_PATH = /\$\{(CLAUDE_SKILL_DIR|CLAUDE_PLUGIN_ROOT)\}[\w.@~+/-]*/g;

// A Markdown link or image destination, inline or in a definition.
const LINK_DESTINATION = /(?:\]\(\s*<?|^ {0,3}\[[^\]]+\]:\s*<?)([^\s)>]+)/gm;

// The plugin.json keys that hold component paths, per
// https://code.claude.com/docs/en/plugins-reference#fields. Each takes a
// path or an array of paths, and `commands` also a map whose entries name
// a file in `source`. Inline hooks and servers reach files through
// ${CLAUDE_PLUGIN_ROOT}, which every file is checked for.
const MANIFEST_PATH_KEYS = [
  "skills",
  "commands",
  "agents",
  "hooks",
  "mcpServers",
  "lspServers",
  "outputStyles",
  "workflows",
  "types",
  "icon",
];
const EXPERIMENTAL_PATH_KEYS = ["themes", "monitors", "evals"];

// What reads no file in Markdown: code blocks and code spans. Blanking
// it keeps every line where it was.
const MARKDOWN_CODE =
  /^ {0,3}(`{3,}|~{3,})[\s\S]*?(?:^ {0,3}\1|(?![\s\S]))|`[^`\n]+`/gm;

// A URL built on the module's own, which names a file next to it.
const MODULE_URL = /\bnew URL\(\s*(["'])[^"'\n]*\1\s*,\s*import\.meta\.url\b/g;

// A template literal that starts at the source file's directory.
const DIRECTORY_TEMPLATE =
  /\$\{(?:import\.meta\.dirname|import\.meta\.dir|__dirname)\}[\w.@~+/-]*/g;

// A join or resolve call on the source file's directory with only string
// arguments, which names one path however its segments are split.
const DIRECTORY_CALL =
  /\b(?:join|resolve)\(\s*(?:import\.meta\.dirname|import\.meta\.dir|__dirname)((?:\s*,\s*(["'])[^"'\n]*\2)+)\s*,?\s*\)/g;

// A stylesheet's @import, quoted or as url(), and any other url().
const CSS_REFERENCE =
  /@import\s+(["'])([^"'\n]+)\1|url\(\s*(["']?)([^"')\s]+)\3\s*\)/g;
const CSS_COMMENT = /\/\*[\s\S]*?\*\//g;

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
 * in code, `src` and `href` in HTML, `@import` and `url()` in CSS, and
 * the paths of plugin.json. Other
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
      const written = match[group] ?? "";

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

  if (path.endsWith(".css")) {
    return [
      ...source
        .replaceAll(CSS_COMMENT, (comment) => comment.replaceAll(/[^\n]/g, " "))
        .matchAll(CSS_REFERENCE),
    ].flatMap(({ 2: quoted, 4: url, index }) => {
      const written = quoted ?? url ?? "";

      return /^[a-z][a-z0-9+.-]*:/i.test(written)
        ? []
        : [
            {
              index,
              written,
              base: directory,
              relativePath: written.split(/[?#]/)[0] ?? "",
            },
          ];
    });
  }

  if (path.endsWith("/.claude-plugin/plugin.json")) {
    return manifestPaths(source).map(({ index, written }) => ({
      index,
      written,
      base: directory,
      relativePath: written,
    }));
  }

  if (!path.endsWith(".ts")) {
    return [];
  }

  return codeReferences(source, directory);
}

/**
 * The paths a TypeScript module reads from its own directory: its import,
 * re-export, dynamic import and require specifiers as Bun's transpiler
 * reads them, URLs built on `import.meta.url`, and templates and
 * `join`/`resolve` calls on its directory. Comments and the contents of
 * other strings are blanked before the patterns run, so an example of
 * code inside a string or a comment reads nothing.
 */
// The module specifiers Bun's transpiler reads. A file it cannot parse
// fails tsc, so it names no import here.
function scanImports(source: string): { path: string }[] {
  try {
    return new Bun.Transpiler({ loader: "ts" }).scanImports(source);
  } catch {
    return [];
  }
}

function codeReferences(source: string, directory: string): Reference[] {
  const { masked, strings } = readTypeScript(source);
  const stringAt = (start: number): string =>
    strings.find((literal) => literal.start === start)?.value ?? "";
  const claimed = new Set<number>();
  const reference = (index: number, written: string): Reference => ({
    index,
    written,
    base: directory,
    relativePath: written,
  });

  // The transpiler refuses a shebang, which a script's first line may hold.
  const scanned = source.replace(/^#!.*/, (line) => " ".repeat(line.length));
  const specifiers = scanImports(scanned).flatMap(({ path }) => {
    const literal = strings.find(
      ({ start, value }) => value === path && !claimed.has(start),
    );

    // A specifier written with escapes has no literal of the same text,
    // so it is reported on the first line.
    if (literal === undefined) {
      return [reference(0, path)];
    }

    claimed.add(literal.start);

    return [reference(literal.start, path)];
  });

  const urls = [...masked.matchAll(MODULE_URL)].map(({ 0: call, index }) => {
    const start = index + call.search(/["']/);

    return reference(start, stringAt(start));
  });

  const templates = [...masked.matchAll(DIRECTORY_TEMPLATE)].map(
    ({ 0: written, index }) =>
      Object.assign(reference(index, written), {
        relativePath: written.replace(/^\$\{[\w.]+\}\/?/, ""),
      }),
  );

  const calls = [...masked.matchAll(DIRECTORY_CALL)].map(
    ({ 0: written, index }) => {
      const segments = strings
        .filter(
          ({ start, end }) => start >= index && end <= index + written.length,
        )
        .map(({ value }) => value);

      return Object.assign(
        reference(index, source.slice(index, index + written.length)),
        {
          written: source
            .slice(index, index + written.length)
            .replaceAll(/\s+/g, " ")
            .replace("( ", "("),
          relativePath: posix.join(".", ...segments),
        },
      );
    },
  );

  return [...specifiers, ...urls, ...templates, ...calls];
}

/**
 * The strings of a plugin.json that name a path: the values of the
 * component keys, a command's `source`, and any string that starts with
 * `./`. A description or a keyword is text, so its `../` counts for nothing.
 */
function manifestPaths(source: string): { index: number; written: string }[] {
  const strings: { index: number; written: string }[] = [];

  const visit = (node: Node, keys: (string | number)[]): void => {
    if (node.type === "string" && typeof node.value === "string") {
      const isExperimental = keys[0] === "experimental";
      const [key, ...inner] = isExperimental ? keys.slice(1) : keys;
      const isComponentPath =
        typeof key === "string" &&
        (isExperimental ? EXPERIMENTAL_PATH_KEYS : MANIFEST_PATH_KEYS).includes(
          key,
        ) &&
        (inner.length === 0 ||
          (inner.length === 1 && typeof inner[0] === "number") ||
          (key === "commands" && inner.at(-1) === "source"));

      if (isComponentPath || node.value.startsWith("./")) {
        strings.push({ index: node.offset, written: node.value });
      }

      return;
    }

    for (const child of node.children ?? []) {
      if (child.type === "property") {
        const [name, value] = child.children ?? [];

        if (typeof name?.value === "string" && value !== undefined) {
          visit(value, [...keys, name.value]);
        }
      } else {
        visit(child, [...keys, node.children?.indexOf(child) ?? 0]);
      }
    }
  };

  const tree = parseTree(source);

  if (tree !== undefined) {
    visit(tree, []);
  }

  return strings;
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
        (finding) => Object.assign(finding, { file }),
      ),
    ),
  );

  return problems.flat();
}
