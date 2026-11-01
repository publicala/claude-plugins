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
  separator?: boolean;
}

const RULES: Rule[] = [
  {
    pattern: /—/g,
    message: () => "has an em dash. Use parentheses or split the sentence.",
    separator: true,
  },
  {
    pattern: / [-–] /g,
    message: (match) =>
      `uses "${match.trim()}" as a separator. Use parentheses or split the sentence.`,
    separator: true,
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

// A list item that opens with a short label followed by " - ", " – ",
// " — " or ". ", in bold or plain, where the house style takes a colon.
const LABELED_BULLETS = [
  /^\s*(?:[-*+]|\d+[.)])\s+(\*\*([^*]+)\*\*\s*(?:[-–—]|\.))\s+\S/d,
  /^\s*(?:[-*+]|\d+[.)])\s+(\*\*([^*]+?)\.\*\*)\s+\S/d,
  /^\s*(?:[-*+]|\d+[.)])\s+(([^\s*`#[]\S*(?: \S+){0,3}?) [-–—])\s\S/d,
];

/**
 * Finds the labeled bullets that use a dash or a period where the house
 * style takes a colon. Each candidate gets a numbered tag right after its
 * separator, and only the tags that reach the prose survive the parser's
 * code, HTML and quote exclusions, a code span around the separator too.
 */
export function findLabeledBullets(markdown: string): Finding[] {
  const lines = markdown.split("\n");
  const frontmatterEnd = lines[0] === "---" ? lines.indexOf("---", 1) : -1;

  const candidates = lines.flatMap((text, index) => {
    const match = LABELED_BULLETS.map((pattern) => pattern.exec(text)).find(
      (found) => found !== null,
    );
    const [, written, label] = match ?? [];
    const separatorEnd = match?.indices?.[1]?.[1];

    return index > frontmatterEnd &&
      written !== undefined &&
      label !== undefined &&
      separatorEnd !== undefined
      ? [{ index, written, label, separatorEnd }]
      : [];
  });

  const tag = (index: number): string => `\uE010${index}\uE011`;
  const tagged = lines.map((text, index) => {
    const candidate = candidates.find((found) => found.index === index);

    return candidate === undefined
      ? text
      : `${text.slice(0, candidate.separatorEnd)}${tag(index)}${text.slice(candidate.separatorEnd)}`;
  });
  const prose = proseFragments(tagged.join("\n")).join("");

  return candidates
    .filter(({ index }) => prose.includes(tag(index)))
    .map(({ index, written, label }) => ({
      line: index + 1,
      message: `labels a bullet with "${written}". Write "**${label}**: text", with a colon.`,
    }));
}

export function findProseProblems(markdown: string): Finding[] {
  const labeled = findLabeledBullets(markdown);
  const labeledLines = new Set(labeled.map(({ line }) => line));
  const problems: Finding[] = [...labeled];
  let cursor = 0;

  for (const fragment of proseFragments(markdown)) {
    const position = markdown.indexOf(fragment, cursor);

    if (position !== -1) {
      cursor = position + fragment.length;
    }

    const line = markdown
      .slice(0, position === -1 ? cursor : position)
      .split("\n").length;

    for (const { pattern, message, separator } of RULES) {
      // A labeled bullet's own message already names its separator.
      if (separator && labeledLines.has(line)) {
        continue;
      }

      for (const [match] of fragment.matchAll(pattern)) {
        problems.push({ line, message: message(match) });
      }
    }
  }

  return problems.toSorted((a, b) => (a.line ?? 0) - (b.line ?? 0));
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
