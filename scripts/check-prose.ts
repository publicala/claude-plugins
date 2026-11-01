#!/usr/bin/env bun

// Fails when the prose in a Markdown file breaks a writing rule that a
// pattern can catch. Code, code spans, HTML and link destinations are
// not prose, so they never count.
import { join } from "node:path";

import {
  errorAnnotation,
  type Finding,
  type Annotation,
} from "./workflow-command";
import { repoFiles } from "./repo-files";

const ROOT = join(import.meta.dir, "..");

const CODE_OPEN = /^<(?:code|kbd|samp|pre)\b[^>]*>$/i;
const CODE_CLOSE = /^<\/(?:code|kbd|samp|pre)\s*>$/i;

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
 * Collects the text a reader sees as prose, in document order. Code and
 * quotes keep their own conventions, so their text is left out.
 */
export function proseFragments(markdown: string): string[] {
  const texts: string[] = [];

  const rendered = Bun.markdown.render(markdown, {
    text: (children) => `\uE000${texts.push(children) - 1}\uE001`,
    code: () => "",
    codespan: () => "",
    html: () => "",
    blockquote: () => "",
  });

  const prose: string[] = [];
  let codeDepth = 0;

  for (const [, index] of rendered.matchAll(/\uE000(\d+)\uE001/g)) {
    const text = texts[Number(index)] ?? "";

    // Inline HTML tags arrive as text nodes, so code tags are tracked here.
    if (CODE_OPEN.test(text)) {
      codeDepth++;
    } else if (CODE_CLOSE.test(text)) {
      codeDepth = Math.max(0, codeDepth - 1);
    } else if (codeDepth === 0) {
      prose.push(text);
    }
  }

  return prose;
}

export function findProseProblems(markdown: string): Finding[] {
  const problems: Finding[] = [];
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
        problems.push({ line, message: message(match) });
      }
    }
  }

  return problems;
}

export async function checkProse(root: string): Promise<{
  checked: number;
  problems: Annotation[];
}> {
  const paths = repoFiles(root, "*.md");

  const problems = await Promise.all(
    paths.map(async (file) =>
      findProseProblems(await Bun.file(join(root, file)).text()).map(
        (finding) => ({ file, ...finding }),
      ),
    ),
  );

  return { checked: paths.length, problems: problems.flat() };
}

export async function main(root = ROOT): Promise<number> {
  const { checked, problems } = await checkProse(root);

  for (const problem of problems) {
    console.error(errorAnnotation(problem));
  }

  if (problems.length > 0) {
    return 1;
  }

  console.log(`checked the prose in ${checked} Markdown files`);

  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
