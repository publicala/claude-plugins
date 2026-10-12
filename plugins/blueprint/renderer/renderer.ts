// Renders figure sources with one headless Chrome per run. Each figure loads
// into its own tab, passes the checks, and is captured from the canvas
// element itself, so the PNG holds the whole canvas at any window size.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import puppeteer, { type Browser } from "puppeteer-core";
import sharp from "sharp";

import { fontFaceCss, logoSvg, lucideIcons, stylesheet } from "./assets";
import { findFigureProblems } from "./checks";
import { measureFigure, roundCanvasHeight } from "./measure";
import { buildPage, outputPathFor } from "./page";

const SCALE = 2;

const CHROMIUM_PATHS = [
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

// Playwright's Chromium builds inside a browsers directory, as in cloud sessions.
const PLAYWRIGHT_CHROMIUM = [
  "chromium-*/chrome-linux*/chrome",
  "chromium-*/chrome-mac*/Chromium.app/Contents/MacOS/Chromium",
];

/**
 * The Chrome binary to render with. CHROME_PATH, when set, is the only
 * candidate. Otherwise PLAYWRIGHT_BROWSERS_PATH comes first, then the
 * usual install locations, then Playwright's default caches.
 */
export function findChrome(
  env: Record<string, string | undefined> = process.env,
): string | null {
  if (env.CHROME_PATH) {
    return existsSync(env.CHROME_PATH) ? env.CHROME_PATH : null;
  }

  const candidates = [
    ...playwrightChromium(env.PLAYWRIGHT_BROWSERS_PATH),
    ...googleChrome(),
    ...CHROMIUM_PATHS,
    ...playwrightChromium(join(homedir(), ".cache/ms-playwright")),
    ...playwrightChromium(join(homedir(), "Library/Caches/ms-playwright")),
  ];

  return candidates.find((path) => existsSync(path)) ?? null;
}

// Puppeteer knows where Google Chrome installs on each system, and throws when it is not there.
function googleChrome(): string[] {
  try {
    return [puppeteer.executablePath("chrome")];
  } catch {
    return [];
  }
}

function playwrightChromium(dir: string | undefined): string[] {
  if (dir === undefined || !existsSync(dir)) {
    return [];
  }

  const build = (path: string) => Number(/chromium-(\d+)/.exec(path)?.[1]);

  return PLAYWRIGHT_CHROMIUM.flatMap((pattern) => [
    ...new Bun.Glob(pattern).scanSync({ cwd: dir }),
  ])
    .toSorted((a, b) => build(b) - build(a))
    .map((match) => join(dir, match));
}

export async function launchBrowser(): Promise<Browser> {
  const chromePath = process.env.CHROME_PATH;

  if (chromePath && !existsSync(chromePath)) {
    throw new Error(
      `CHROME_PATH points at ${chromePath}, which does not exist. Set it to the Chrome or Chromium binary, or unset it.`,
    );
  }

  const executablePath = findChrome();

  if (!executablePath) {
    throw new Error(
      "Unable to find Chrome. Install Google Chrome or Chromium, or set CHROME_PATH to its binary.",
    );
  }

  // Chrome refuses to start as root with its sandbox on, as in containers and cloud sessions.
  const runsAsRoot = process.getuid?.() === 0;

  return puppeteer.launch({
    executablePath,
    headless: true,
    args: runsAsRoot ? ["--no-sandbox"] : [],
  });
}

export async function buildFigurePage(source: string): Promise<string> {
  const [css, fontCss, logo, icons] = await Promise.all([
    stylesheet(),
    fontFaceCss(),
    logoSvg(),
    lucideIcons(),
  ]);

  return buildPage({ source, css, fontCss, logoSvg: logo, icons });
}

export interface WrittenFile {
  path: string;
  size: string;
}

/**
 * Renders one source to a PNG next to it, and to a PDF when asked.
 *
 * Throws with every problem the checks find before it writes any
 * file, so a broken figure never replaces a good one.
 */
export async function renderFigure(
  browser: Browser,
  sourcePath: string,
  { pdf = false }: { pdf?: boolean } = {},
): Promise<WrittenFile[]> {
  const html = await buildFigurePage(await Bun.file(sourcePath).text());
  const page = await browser.newPage();

  try {
    await page.setViewport({
      width: 2400,
      height: 1200,
      deviceScaleFactor: SCALE,
    });
    await page.emulateMediaFeatures([
      { name: "prefers-color-scheme", value: "light" },
    ]);
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate("document.fonts.ready");

    const problems = findFigureProblems(await page.evaluate(measureFigure));

    if (problems.length > 0) {
      throw new Error(problems.map((problem) => `  - ${problem}`).join("\n"));
    }

    await page.evaluate(roundCanvasHeight);

    const canvas = await page.$(".canvas");
    const box = await canvas?.boundingBox();

    if (!canvas || !box) {
      throw new Error(
        "Unable to capture the canvas: it has no box on the page.",
      );
    }

    const pngPath = outputPathFor(sourcePath, ".png");

    await Bun.write(
      pngPath,
      await optimizePng(await canvas.screenshot({ type: "png" })),
    );

    const written = [
      { path: pngPath, size: `${box.width * SCALE}x${box.height * SCALE}` },
    ];

    if (pdf) {
      const pdfPath = outputPathFor(sourcePath, ".pdf");

      await page.pdf({
        path: pdfPath,
        width: `${box.width}px`,
        height: `${box.height}px`,
        printBackground: true,
        pageRanges: "1",
      });
      written.push({
        path: pdfPath,
        size: `${box.width}x${box.height}px page`,
      });
    }

    return written;
  } finally {
    await page.close();
  }
}

// Figures use a few dozen colors, so a 256-color palette keeps them sharp at about half the size.
function optimizePng(buffer: Uint8Array): Promise<Buffer> {
  return sharp(buffer)
    .png({ palette: true, quality: 95, effort: 10, compressionLevel: 9 })
    .toBuffer();
}
