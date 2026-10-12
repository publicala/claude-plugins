// Renders figure sources with one headless Chrome per run. Each figure loads
// into its own tab, passes the checks, and is captured from the canvas
// element itself, so the PNG holds the whole canvas at any window size.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import sharp from "sharp";

import {
  readFontFaceCss,
  readLogoSvg,
  readLucideIcons,
  readStylesheet,
} from "./assets";
import { findFigureProblems } from "./checks";
import { measureFigure, roundCanvasHeight } from "./measure";
import { buildPage, outputPathFor } from "./page";

const SOURCE_SUFFIX = ".diagram.html";
const SCALE = 2;

const CHROMIUM_PATHS = [
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

// Playwright's Chromium builds inside a browsers directory, as in cloud
// sessions. Newer builds ship Chrome for Testing on macOS and Windows.
const PLAYWRIGHT_CHROMIUM = [
  "chromium-*/chrome-linux*/chrome",
  "chromium-*/chrome-mac*/Chromium.app/Contents/MacOS/Chromium",
  "chromium-*/chrome-mac*/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  "chromium-*/chrome-win*/chrome.exe",
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
    ...playwrightChromium(
      env.LOCALAPPDATA && join(env.LOCALAPPDATA, "ms-playwright"),
    ),
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
  const [stylesheet, fontFaceCss, logoSvg, icons] = await Promise.all([
    readStylesheet(),
    readFontFaceCss(),
    readLogoSvg(),
    readLucideIcons(),
  ]);

  return buildPage({ source, stylesheet, fontFaceCss, logoSvg, icons });
}

/**
 * Opens a page set up the way the checks expect it: the light
 * colors, the content loaded and every font ready.
 */
export async function openPage(
  browser: Browser,
  html: string,
  { width, height, scale }: { width: number; height: number; scale: number },
): Promise<Page> {
  const page = await browser.newPage();

  try {
    await page.setViewport({ width, height, deviceScaleFactor: scale });
    await page.emulateMediaFeatures([
      { name: "prefers-color-scheme", value: "light" },
    ]);
    await page.setContent(html);
    await page.evaluate("document.fonts.ready");

    return page;
  } catch (error) {
    await page.close();

    throw error;
  }
}

interface WrittenFile {
  path: string;
  dimensions: string;
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
  const page = await openPage(browser, html, {
    width: 2400,
    height: 1200,
    scale: SCALE,
  });

  try {
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

    const pngPath = outputPathFor(sourcePath, SOURCE_SUFFIX, ".png");

    // Figures use a few dozen colors, so a 256-color palette keeps them sharp at about half the size.
    const png = await sharp(await canvas.screenshot({ type: "png" }))
      .png({ palette: true, quality: 95, effort: 10, compressionLevel: 9 })
      .toFile(pngPath);

    const written = [
      { path: pngPath, dimensions: `${png.width}x${png.height}` },
    ];

    if (pdf) {
      const pdfPath = outputPathFor(sourcePath, SOURCE_SUFFIX, ".pdf");

      await page.pdf({
        path: pdfPath,
        width: `${box.width}px`,
        height: `${box.height}px`,
        printBackground: true,
        pageRanges: "1",
      });
      written.push({
        path: pdfPath,
        dimensions: `${box.width}x${box.height}px page`,
      });
    }

    return written;
  } finally {
    await page.close();
  }
}
