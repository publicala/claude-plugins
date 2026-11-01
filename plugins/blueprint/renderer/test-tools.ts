// The tools the renderer tests drive. A missing tool skips its tests on a
// developer's machine. Under CI it fails the run instead, because a suite
// that skips there passes without testing anything.
import { findChrome } from "./renderer";

export function requireInCi(found: boolean, missing: string): boolean {
  if (!found && process.env.CI) {
    throw new Error(`${missing} CI is set, so the tests fail instead of skip.`);
  }

  return found;
}

export async function hasChrome(): Promise<boolean> {
  return requireInCi(
    (await findChrome()) !== null,
    "Chrome is missing, so the tests that render cannot run. GitHub's runner images ship Google Chrome. Elsewhere, install Chrome or Chromium, or set CHROME_PATH to its binary.",
  );
}

export function hasFfmpeg(): boolean {
  return requireInCi(
    Bun.which("ffmpeg") !== null,
    "ffmpeg is missing, so the H.264 test cannot run. The test job in .github/workflows/ci.yml installs a static build pinned by sha256.",
  );
}
