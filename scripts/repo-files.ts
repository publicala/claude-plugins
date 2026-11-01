import { existsSync } from "node:fs";
import { join } from "node:path";

// A git hook or `git rebase --exec` sets these, and they point git at that
// repository whatever the working directory.
const REPOSITORY_VARIABLES = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
];

/** The environment for a git command that works on its cwd's repository. */
export function cwdGitEnvironment(): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !REPOSITORY_VARIABLES.includes(name),
    ),
  );
}

/**
 * Every file a commit could carry that matches the pathspecs: tracked, or
 * untracked and not ignored, in any directory, as repo-relative paths.
 */
export function repoFiles(root: string, ...pathspecs: string[]): string[] {
  const listed = Bun.spawnSync(
    [
      "git",
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      ...pathspecs,
    ],
    { cwd: root, env: cwdGitEnvironment() },
  );

  if (!listed.success) {
    throw new Error(
      `Unable to list the files with git in ${root}: ${listed.stderr.toString().trim()}`,
    );
  }

  return [...new Set(listed.stdout.toString().split("\0"))]
    .filter((path) => path !== "" && existsSync(join(root, path)))
    .toSorted();
}
