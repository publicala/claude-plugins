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

const ICON_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function stylesheet(): Promise<string> {
  return Bun.file(join(ROOT, "style/blueprint.css")).text();
}

export function logoSvg(): Promise<string> {
  return Bun.file(join(ROOT, "assets/wordmark.svg")).text();
}

export async function fontFaceCss(): Promise<string> {
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

export interface Icons {
  load: (name: string) => string | null;
  similar: (name: string) => string[];
}

/**
 * Lucide icons by name, from the map scripts/update-blueprint-icons.ts
 * writes. An unknown name gets suggestions that share a word with it.
 */
export async function lucideIcons(): Promise<Icons> {
  const icons = (await Bun.file(
    join(ROOT, "assets/icons.json"),
  ).json()) as Record<string, string>;
  const names = Object.keys(icons);

  return {
    load: (name) =>
      ICON_NAME.test(name) && Object.hasOwn(icons, name)
        ? (icons[name] ?? null)
        : null,
    similar: (name) => {
      const words = name.split("-").filter((word) => word.length > 2);

      return names
        .filter((candidate) => words.some((word) => candidate.includes(word)))
        .slice(0, 8);
    },
  };
}
