#!/usr/bin/env bun

// Writes the inner markup of every Lucide icon to the blueprint plugin, so a
// render reads one small file instead of installing a 50 MB package.
import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";

const ROOT = join(import.meta.dir, "..");

export const ICONS_JSON = join(ROOT, "plugins/blueprint/assets/icons.json");

function lucideIconsDir(): string {
  return join(
    dirname(Bun.resolveSync("lucide-static/package.json", ROOT)),
    "icons",
  );
}

export function innerSvg(svg: string, file: string): string {
  const inner = /<svg\b[^>]*>([\s\S]*)<\/svg>/.exec(svg)?.[1];

  if (inner === undefined) {
    throw new Error(
      `Unable to read the icon ${file}: it has no <svg> element.`,
    );
  }

  return inner.replace(/\s*\n\s*/g, "");
}

export async function iconsJson(iconsDir = lucideIconsDir()): Promise<string> {
  const files = (await readdir(iconsDir))
    .filter((file) => file.endsWith(".svg"))
    .toSorted();

  const icons = Object.fromEntries(
    await Promise.all(
      files.map(async (file) => [
        file.slice(0, -".svg".length),
        innerSvg(await Bun.file(join(iconsDir, file)).text(), file),
      ]),
    ),
  );

  return `${JSON.stringify(icons, null, 2)}\n`;
}

export async function main(path = ICONS_JSON): Promise<void> {
  await Bun.write(path, await iconsJson());
  console.log(`Wrote ${path}`);
}

if (import.meta.main) {
  await main();
}
