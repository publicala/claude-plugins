#!/usr/bin/env bun

// Fails when the prose in a Markdown file breaks a writing rule from
// CLAUDE.md that a pattern can catch. Code, code spans, HTML and link
// destinations are not prose, so they never count.
import { relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

const MARKDOWN = ["*.md", "plugins/**/*.md", ".github/**/*.md"];

interface Rule {
  pattern: RegExp;
  message: (match: string) => string;
}

const RULES: Rule[] = [
  {
    pattern: /—/g,
    message: () => "has an em dash. Use parentheses or split the sentence.",
  },
  {
    pattern: / [-–] /g,
    message: (match) =>
      `uses "${match.trim()}" as a separator. Use parentheses or split the sentence.`,
  },
  {
    pattern: /;/g,
    message: () => "has a semicolon. Split it into two sentences.",
  },
  {
    pattern: /[‘’“”]/g,
    message: (match) =>
      `has the curly quote ${match}. Use straight quotes (' and ").`,
  },
  {
    pattern: /[¿¡]/g,
    message: (match) => `opens with ${match}. Drop the opening mark.`,
  },
  {
    pattern:
      /\b(?:it's worth noting|in this article|comprehensive guide|step-by-step|important to understand|leverag(?:e|es|ed|ing)|utiliz(?:e|es|ed|ing|ation))\b/gi,
    message: (match) => `says "${match}". Say it plainly or cut it.`,
  },
  {
    pattern: /\binvariants?\b/gi,
    message: (match) => `says "${match}". Say "rule" or "guarantee".`,
  },
];

/**
 * Collects the text a reader sees as prose, in document order. Each text
 * node renders as a numbered marker, and code, code spans and raw HTML
 * drop the markers of the text inside them.
 */
export function proseFragments(markdown: string): string[] {
  const texts: string[] = [];

  const rendered = Bun.markdown.render(markdown, {
    text: (children) => `\uE000${texts.push(children) - 1}\uE001`,
    code: () => "",
    codespan: () => "",
    html: () => "",
  });

  return [...rendered.matchAll(/\uE000(\d+)\uE001/g)].map(
    ([, index]) => texts[Number(index)] ?? "",
  );
}

export function findProseProblems(markdown: string): string[] {
  const problems: string[] = [];
  let cursor = 0;

  for (const fragment of proseFragments(markdown)) {
    const position = markdown.indexOf(fragment, cursor);

    if (position !== -1) {
      cursor = position + fragment.length;
    }

    const line = markdown
      .slice(0, position === -1 ? cursor : position)
      .split("\n").length;

    for (const { pattern, message } of RULES) {
      for (const [match] of fragment.matchAll(pattern)) {
        problems.push(`line ${line} ${message(match)}`);
      }
    }
  }

  return problems;
}

export async function checkProse(root: string): Promise<{
  checked: number;
  errors: string[];
}> {
  const paths = new Set<string>();

  for (const pattern of MARKDOWN) {
    for await (const path of new Bun.Glob(pattern).scan({
      cwd: root,
      dot: true,
    })) {
      if (!path.includes("node_modules/")) {
        paths.add(path);
      }
    }
  }

  const sorted = [...paths].toSorted();

  const errors = await Promise.all(
    sorted.map(async (path) =>
      findProseProblems(await Bun.file(`${root}/${path}`).text()).map(
        (problem) => `${relative(root, `${root}/${path}`)}: ${problem}`,
      ),
    ),
  );

  return { checked: sorted.length, errors: errors.flat() };
}

export async function main(root = ROOT): Promise<number> {
  const { checked, errors } = await checkProse(root);

  for (const error of errors) {
    console.error(`::error::${error}`);
  }

  if (errors.length > 0) {
    return 1;
  }

  console.log(`checked the prose in ${checked} Markdown files`);

  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
