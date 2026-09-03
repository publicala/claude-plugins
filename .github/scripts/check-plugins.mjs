// Fails when a relative Markdown link under plugins/ points at a missing file,
// or when a SKILL.md frontmatter lacks a required key. Run from the repo root.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve, basename } from "node:path";

const root = process.cwd();
const requiredFrontmatterKeys = [
  "name",
  "description",
  "user-invocable",
  "disable-model-invocation",
];
const errors = [];

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

// Inline destinations, angle-bracket destinations, and reference definitions.
function linkTargets(text) {
  const inline = [...text.matchAll(/\]\((<[^>]*>|[^)\s]+)(?:\s+"[^"]*")?\)/g)];
  const definitions = [
    ...text.matchAll(/^ {0,3}\[[^\]]+\]:\s*(<[^>]*>|\S+)/gm),
  ];
  return [...inline, ...definitions].map((match) =>
    match[1].startsWith("<") ? match[1].slice(1, -1) : match[1],
  );
}

function checkLinks(file) {
  const text = readFileSync(file, "utf8");
  for (const target of linkTargets(text)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) continue;
    const path = resolve(dirname(file), target.split("#")[0]);
    if (!existsSync(path)) {
      errors.push(`${relative(root, file)}: link target not found: ${target}`);
    }
  }
}

function checkFrontmatter(file) {
  const text = readFileSync(file, "utf8");
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) {
    errors.push(`${relative(root, file)}: missing frontmatter`);
    return;
  }
  const keys = new Set(
    match[1]
      .split("\n")
      .filter((line) => /^[a-z-]+:/.test(line))
      .map((line) => line.split(":")[0]),
  );
  for (const key of requiredFrontmatterKeys) {
    if (!keys.has(key))
      errors.push(`${relative(root, file)}: frontmatter lacks ${key}`);
  }
  const name = match[1].match(/^name:\s*(\S+)/m)?.[1];
  const directory = basename(dirname(file));
  if (name && name !== directory) {
    errors.push(
      `${relative(root, file)}: name "${name}" differs from directory "${directory}"`,
    );
  }
}

const markdownFiles = walk(join(root, "plugins")).filter((file) =>
  file.endsWith(".md"),
);
markdownFiles.forEach(checkLinks);
markdownFiles
  .filter((file) => /\/skills\/[^/]+\/SKILL\.md$/.test(file))
  .forEach(checkFrontmatter);

if (errors.length > 0) {
  errors.forEach((error) => console.error(`::error::${error}`));
  process.exit(1);
}
console.log(`checked ${markdownFiles.length} Markdown files under plugins/`);
