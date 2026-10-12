#!/usr/bin/env bun

// Command line for the figure renderer.
import { relative, resolve } from "node:path";
import { parseArgs } from "node:util";

import { launchBrowser, renderFigure } from "./renderer";

const USAGE =
  "Usage: bun render.ts <figure.diagram.html> [more.diagram.html] [--pdf]";

function parseCommandLine(args: string[]) {
  try {
    return parseArgs({
      args,
      allowPositionals: true,
      options: { pdf: { type: "boolean", default: false } },
    });
  } catch (error) {
    console.error(`${(error as Error).message}\n${USAGE}`);

    return null;
  }
}

export async function main(args: string[]): Promise<number> {
  const commandLine = parseCommandLine(args);

  if (commandLine === null) {
    return 1;
  }

  const { values, positionals } = commandLine;

  if (positionals.length === 0) {
    console.error(USAGE);

    return 1;
  }

  const browser = await launchBrowser();
  let exitCode = 0;

  try {
    for (const sourcePath of positionals.map((source) => resolve(source))) {
      try {
        const written = await renderFigure(browser, sourcePath, {
          pdf: values.pdf,
        });

        for (const file of written) {
          console.log(
            `${relative(process.cwd(), file.path)} (${file.dimensions})`,
          );
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
