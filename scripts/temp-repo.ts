import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cwdGitEnvironment } from "./repo-files";

/**
 * A temporary git repository holding these files, untracked as a new file
 * is. The caller removes it.
 */
export async function tempRepo(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "repo-"));

  for (const [path, text] of Object.entries(files)) {
    await Bun.write(join(root, path), text);
  }

  Bun.spawnSync(["git", "init", "--quiet"], {
    cwd: root,
    env: cwdGitEnvironment(),
  });

  return root;
}
