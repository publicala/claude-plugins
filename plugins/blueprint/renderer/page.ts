// Turns a figure source into a complete, self-contained HTML page. A source
// is the markup of one `.canvas` element. The page carries the stylesheet,
// the fonts, the logo and every icon inline.
import type { Icons } from "./assets";

const SOURCE_SUFFIX = ".diagram.html";

const COMMENT = /<!--[\s\S]*?-->/g;
const ICON_TAG =
  /<i\b[^>]*?\bdata-icon\s*=\s*(["'])([^"']*)\1[^>]*?\/?>(?:\s*<\/i\s*>)?/g;
const LOGO_TAG = /<i\b[^>]*?\bdata-logo\b[^>]*?\/?>(?:\s*<\/i\s*>)?/g;
const LEFTOVER_PLACEHOLDER = /<[^>]*\bdata-(?:icon|logo)\b[^>]*>/;
const CANVAS_ELEMENT =
  /<[a-z][a-z0-9-]*\b[^>]*?\bclass\s*=\s*(["'])(?:[^"']*\s)?canvas(?:\s[^"']*)?\1/gi;

export function expandIcons(markup: string, icons: Icons): string {
  return markup.replace(ICON_TAG, (_tag, _quote, name: string) => {
    const icon = icons.load(name);

    if (icon === null) {
      const suggestions = icons.similar(name);
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

export function expandLogo(markup: string, logoSvg: string): string {
  return markup.replace(
    LOGO_TAG,
    `<span class="logo" role="img" aria-label="publica.la">${logoSvg.trim()}</span>`,
  );
}

export interface PageParts {
  source: string;
  css: string;
  fontCss: string;
  logoSvg: string;
  icons: Icons;
}

export function buildPage({
  source,
  css,
  fontCss,
  logoSvg,
  icons,
}: PageParts): string {
  const markup = source.replace(COMMENT, "");
  const canvases = markup.match(CANVAS_ELEMENT) ?? [];

  if (canvases.length !== 1) {
    throw new Error(
      `The figure source must contain exactly one element with the canvas class, found ${canvases.length}.`,
    );
  }

  const body = expandLogo(expandIcons(markup, icons), logoSvg);
  const leftover = LEFTOVER_PLACEHOLDER.exec(body);

  if (leftover) {
    throw new Error(
      `Unable to expand ${leftover[0]}. Write icons as <i data-icon="name"></i> and the logo as <i data-logo></i>.`,
    );
  }

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Figure</title>
<style>${fontCss}${css}</style></head>
<body>${body}</body></html>
`;
}

export function outputPathFor(sourcePath: string, extension: string): string {
  if (!sourcePath.endsWith(SOURCE_SUFFIX)) {
    throw new Error(
      `Figure sources end in ${SOURCE_SUFFIX}, got: ${sourcePath}`,
    );
  }

  return sourcePath.slice(0, -SOURCE_SUFFIX.length) + extension;
}
