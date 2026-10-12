#!/usr/bin/env bun

// Renders Blueprint figure sources to PNG, and to PDF with --pdf. The PNG
// lands next to its source at 2x, cropped to the canvas. Set CHROME_PATH
// when Chrome is not in a standard location.
import { relative, resolve } from "node:path";

import { launchBrowser, renderFigure } from "./renderer";

const USAGE =
  "Usage: bun render.ts <figure.diagram.html> [more.diagram.html] [--pdf]";

export async function main(args: string[]): Promise<number> {
  const options = args.filter((arg) => arg.startsWith("--"));
  const sources = args
    .filter((arg) => !arg.startsWith("--"))
    .map((arg) => resolve(arg));
  const unknownOption = options.find((option) => option !== "--pdf");

  if (unknownOption) {
    console.error(`Unknown option ${unknownOption}. The only option is --pdf.`);
    console.error(USAGE);

    return 1;
  }

  if (sources.length === 0) {
    console.error(USAGE);

    return 1;
  }

  const browser = await launchBrowser();
  let exitCode = 0;

  try {
    for (const sourcePath of sources) {
      try {
        const written = await renderFigure(browser, sourcePath, {
          pdf: options.includes("--pdf"),
        });

        for (const file of written) {
          console.log(`${relative(process.cwd(), file.path)} (${file.size})`);
        }
      } catch (error) {
        console.error(
          `${relative(process.cwd(), sourcePath)} did not render:\n${(error as Error).message}`,
        );
        exitCode = 1;
      }
    }
  } finally {
    await browser.close();
  }

  return exitCode;
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
