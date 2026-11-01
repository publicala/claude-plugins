import { describe, expect, test } from "bun:test";
import { join, relative } from "node:path";

// `bun run typecheck` runs two programs: tsconfig.json for the Bun scripts,
// and tsconfig.browser.json for the page scripts, against the DOM. A file
// the root excludes and the browser program misses would go unchecked.

const ROOT = join(import.meta.dir, "..");
const TSC = join(ROOT, "node_modules", ".bin", "tsc");

async function run(command: string[]): Promise<string[]> {
  const proc = Bun.spawn(command, { cwd: ROOT, stdout: "pipe" });
  const [output, code] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited,
  ]);
  expect(code).toBe(0);

  return output.split("\n").filter((line) => line !== "");
}

async function programFiles(project: string): Promise<Set<string>> {
  const files = await run([TSC, "-p", project, "--listFilesOnly"]);

  return new Set(
    files
      .map((file) => relative(ROOT, file))
      .filter((file) => !file.startsWith("node_modules/")),
  );
}

const [tracked, root, browser] = await Promise.all([
  run(["git", "ls-files", "*.ts", "*.mts", "*.mjs"]),
  programFiles("tsconfig.json"),
  programFiles("tsconfig.browser.json"),
]);

describe("typecheck", () => {
  test("covers every tracked TypeScript file", () => {
    const unchecked = tracked.filter(
      (file) => !root.has(file) && !browser.has(file),
    );

    expect(unchecked).toEqual([]);
  });

  test("checks the page scripts against the DOM, outside the Bun program", () => {
    for (const page of [
      "plugins/bonsai/renderer/page/main.ts",
      "plugins/blueprint/renderer/page/player.ts",
    ]) {
      expect(browser.has(page)).toBe(true);
      expect(root.has(page)).toBe(false);
    }
  });
});
