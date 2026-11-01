// Turns a figure source into a complete, self-contained HTML page. A source
// is the markup of one `.canvas` element. The page carries the stylesheet,
// the fonts, the logo and every icon inline.
import { basename, dirname } from "node:path";

const ICON_TAG =
  /<i\b[^>]*?\bdata-icon\s*=\s*(["'])([^"']*)\1[^>]*?\/?>(?:\s*<\/i\s*>)?/g;
const LOGO_TAG = /<i\b[^>]*?\bdata-logo\b[^>]*?\/?>(?:\s*<\/i\s*>)?/g;
const LEFTOVER_PLACEHOLDER = /<[^>]*\bdata-(?:icon|logo)\b[^>]*>/;
const CANVAS_ELEMENT =
  /<[a-z][a-z0-9-]*\b[^>]*?\bclass\s*=\s*(["'])(?:[^"']*\s)?canvas(?:\s[^"']*)?\1/gi;

export function expandIcons(
  markup: string,
  icons: ReadonlyMap<string, string>,
): string {
  return markup.replace(ICON_TAG, (_tag, _quote, name: string) => {
    const icon = icons.get(name);

    if (icon === undefined) {
      const suggestions = similarIcons(name, icons);
      const hint = suggestions.length
        ? ` Similar names: ${suggestions.join(", ")}.`
        : "";

      throw new Error(
        `Unknown icon "${name}". Use a name from lucide.dev/icons.${hint}`,
      );
    }

    return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>`;
  });
}

function similarIcons(
  name: string,
  icons: ReadonlyMap<string, string>,
): string[] {
  const words = name.split("-").filter((word) => word.length > 2);

  return [...icons.keys()]
    .filter((candidate) => words.some((word) => candidate.includes(word)))
    .slice(0, 8);
}

export function expandLogo(markup: string, logoSvg: string): string {
  return markup.replace(
    LOGO_TAG,
    `<span class="logo" role="img" aria-label="publica.la">${logoSvg.trim()}</span>`,
  );
}

/** What a page adds around the figure, such as a walkthrough's player. */
export interface PageOptions {
  title?: string;
  head?: string;
  bodyClass?: string;
  /** Runs before the icons expand, so the wrapper can use them too. */
  wrapBody?: (figure: string) => string;
}

interface PageParts extends PageOptions {
  source: string;
  stylesheet: string;
  fontFaceCss: string;
  logoSvg: string;
  icons: ReadonlyMap<string, string>;
}

// The HTML parser removes each comment whole. Stripping them with a pattern
// can join two halves into a new one.
function withoutComments(source: string): string {
  return new HTMLRewriter()
    .onDocument({
      comments: (comment) => {
        comment.remove();
      },
    })
    .transform(source);
}

export function buildPage({
  source,
  stylesheet,
  fontFaceCss,
  logoSvg,
  icons,
  title = "Figure",
  head = "",
  bodyClass,
  wrapBody = (figure) => figure,
}: PageParts): string {
  const markup = withoutComments(source);
  const canvases = markup.match(CANVAS_ELEMENT) ?? [];

  if (canvases.length !== 1) {
    throw new Error(
      `The figure source must contain exactly one element with the canvas class, found ${canvases.length}.`,
    );
  }

  const body = expandLogo(expandIcons(wrapBody(markup), icons), logoSvg);
  const leftover = LEFTOVER_PLACEHOLDER.exec(body);

  if (leftover) {
    throw new Error(
      `Unable to expand ${leftover[0]}. Write icons as <i data-icon="name"></i> and the logo as <i data-logo></i>.`,
    );
  }

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>${fontFaceCss}${stylesheet}</style>${head}</head>
<body${bodyClass === undefined ? "" : ` class="${bodyClass}"`}>${body}</body></html>
`;
}

/**
 * Bundles a page script for the browser, to inline in a <script> block.
 * Refuses code that would end the block or open a comment in it.
 */
export async function bundlePageScript(entry: string): Promise<string> {
  // The bundler names each module in a comment, relative to its working
  // directory. Run from the entry's own directory, the comments name the
  // modules alone, the same on every machine.
  const bundler = Bun.spawn(
    [process.execPath, "build", basename(entry), "--target=browser"],
    { cwd: dirname(entry), stdout: "pipe", stderr: "pipe" },
  );
  const [code, errors, exitCode] = await Promise.all([
    new Response(bundler.stdout).text(),
    new Response(bundler.stderr).text(),
    bundler.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(`Unable to bundle ${entry}:\n${errors.trim()}`);
  }

  if (/<\/script|<!--/i.test(code)) {
    throw new Error(
      `${entry} bundles to code with "</script" or "<!--", which breaks the page's script block. Split the string, as in "<" + "/script".`,
    );
  }

  return code;
}

export function outputPathFor(
  sourcePath: string,
  sourceSuffix: string,
  outputSuffix: string,
): string {
  if (!sourcePath.endsWith(sourceSuffix)) {
    throw new Error(`Sources end in ${sourceSuffix}, got: ${sourcePath}`);
  }

  return sourcePath.slice(0, -sourceSuffix.length) + outputSuffix;
}
