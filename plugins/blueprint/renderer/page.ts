// Turns a figure source into a complete, self-contained HTML page. A source
// is the markup of one `.canvas` element. The page carries the stylesheet,
// the fonts, the logo and every icon inline.

const COMMENT = /<!--[\s\S]*?-->/g;
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

interface PageParts {
  source: string;
  stylesheet: string;
  fontFaceCss: string;
  logoSvg: string;
  icons: ReadonlyMap<string, string>;
}

export function buildPage({
  source,
  stylesheet,
  fontFaceCss,
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
<style>${fontFaceCss}${stylesheet}</style></head>
<body>${body}</body></html>
`;
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
