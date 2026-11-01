// The files every figure inlines: the stylesheet, the fonts, the logo and
// the icons. All of them ship with the plugin, so a render needs no network
// and every machine draws the same glyphs.
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

const FONTS = [
  { family: "Inter", file: "inter", weights: [400, 500, 600, 700] },
  {
    family: "JetBrains Mono",
    file: "jetbrains-mono",
    weights: [400, 500, 600],
  },
];

export async function readStylesheet(): Promise<string> {
  const [tokens, components] = await Promise.all([
    Bun.file(join(ROOT, "style/tokens.css")).text(),
    Bun.file(join(ROOT, "style/blueprint.css")).text(),
  ]);

  return tokens + components;
}

export function readLogoSvg(): Promise<string> {
  return Bun.file(join(ROOT, "assets/wordmark.svg")).text();
}

export async function readFontFaceCss(): Promise<string> {
  const faces = await Promise.all(
    FONTS.flatMap(({ family, file, weights }) =>
      weights.map(async (weight) => {
        const font = await Bun.file(
          join(ROOT, `assets/fonts/${file}-latin-${weight}-normal.woff2`),
        ).bytes();

        return `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:block;src:url(data:font/woff2;base64,${Buffer.from(font).toString("base64")}) format('woff2')}`;
      }),
    ),
  );

  return faces.join("");
}

function isIconMap(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((markup) => typeof markup === "string")
  );
}

/**
 * Lucide icons by name, from the map written
 * by scripts/update-blueprint-icons.ts.
 */
export async function readLucideIcons(
  path = join(ROOT, "assets/icons.json"),
): Promise<Map<string, string>> {
  const icons: unknown = await Bun.file(path).json();

  if (!isIconMap(icons)) {
    throw new Error(
      `The icon map ${path} must map each icon name to its markup. Run bun run update:icons.`,
    );
  }

  return new Map(Object.entries(icons));
}
