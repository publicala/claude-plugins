import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { repoFiles, repoPaths } from "./repo-files";
import { tempRepo } from "./temp-repo";

describe("repoFiles", () => {
  test("lists tracked and untracked files git would commit, sorted, never ignored ones", async () => {
    const root = await tempRepo({
      ".gitignore": "ignored.md\n",
      "b.md": "",
      "a/c.md": "",
      "a/d.ts": "",
      "ignored.md": "",
    });

    try {
      expect(repoFiles(root, "*.md")).toEqual(["a/c.md", "b.md"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("lists the cwd's repository while a git hook points git at another", async () => {
    const root = await tempRepo({ "a.md": "" });
    const outer = join(import.meta.dir, "..");
    const gitDirectory = Bun.spawnSync(
      ["git", "rev-parse", "--absolute-git-dir"],
      { cwd: outer },
    )
      .stdout.toString()
      .trim();

    try {
      // Bun spawns with the environment it started with, so the hook variables need a new process.
      const listed = Bun.spawnSync(
        [
          process.execPath,
          "-e",
          `const { repoFiles } = await import(${JSON.stringify(join(import.meta.dir, "repo-files.ts"))}); console.log(JSON.stringify(repoFiles(${JSON.stringify(root)}, "*.md")));`,
        ],
        {
          env: {
            ...process.env,
            GIT_DIR: gitDirectory,
            GIT_WORK_TREE: outer,
          },
        },
      );

      expect(JSON.parse(listed.stdout.toString())).toEqual(["a.md"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("never applies another repository's info/exclude through GIT_COMMON_DIR", async () => {
    const other = await tempRepo({});
    const root = await tempRepo({ "a.md": "", "b.md": "" });
    await Bun.write(join(other, ".git", "info", "exclude"), "a.md\n");

    try {
      // The compliant twin: without the variable, both files are listed.
      expect(repoFiles(root, "*.md")).toEqual(["a.md", "b.md"]);

      const listed = Bun.spawnSync(
        [
          process.execPath,
          "-e",
          `const { repoFiles } = await import(${JSON.stringify(join(import.meta.dir, "repo-files.ts"))}); console.log(JSON.stringify(repoFiles(${JSON.stringify(root)}, "*.md")));`,
        ],
        { env: { ...process.env, GIT_COMMON_DIR: join(other, ".git") } },
      );

      expect(JSON.parse(listed.stdout.toString())).toEqual(["a.md", "b.md"]);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(other, { recursive: true, force: true });
    }
  });

  test("names the folder when git cannot list it", async () => {
    const root = await mkdtemp(join(tmpdir(), "repo-files-"));

    try {
      expect(() => repoFiles(root, "*.md")).toThrow(
        `Unable to list the files with git in ${root}:`,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("repoPaths", () => {
  test("keeps a symlink whose target is missing, which repoFiles drops", async () => {
    const root = await tempRepo({ "a.md": "" });

    try {
      await symlink("missing.md", join(root, "b.md"));

      expect(repoPaths(root, "*.md")).toEqual(["a.md", "b.md"]);
      expect(repoFiles(root, "*.md")).toEqual(["a.md"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
