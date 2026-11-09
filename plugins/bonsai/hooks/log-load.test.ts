import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  findRepository,
  keyFromRemoteUrl,
  loadEntry,
  logPath,
  main,
  parseLoadInput,
  pathFromRoot,
  recordLoad,
  repositoryKey,
} from "./log-load";

const HOOK = join(import.meta.dir, "log-load.sh");
const TIME = new Date("2026-11-09T12:00:00.000Z");

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

async function temporaryDirectory(): Promise<string> {
  const path = realpathSync(await mkdtemp(join(tmpdir(), "bonsai-loads-")));
  temporary.push(path);

  return path;
}

function run(directory: string, ...command: string[]): string {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;

  return Bun.spawnSync(command, { cwd: directory, env })
    .stdout.toString()
    .trim();
}

/** A repository with a root and a nested CLAUDE.md, and these remotes. */
async function repository(remotes: Record<string, string>): Promise<string> {
  const root = await temporaryDirectory();

  await Bun.write(join(root, "CLAUDE.md"), "# Root\n");
  await Bun.write(join(root, "api", "CLAUDE.md"), "# Api\n");
  await Bun.write(join(root, "api", "routes.ts"), "export {};\n");
  run(root, "git", "init", "--quiet");

  for (const [name, url] of Object.entries(remotes)) {
    run(root, "git", "remote", "add", name, url);
  }

  return root;
}

function readLog(path: string): unknown[] {
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .map((line): unknown => JSON.parse(line));
}

describe("parseLoadInput", () => {
  test("keeps the known fields and drops values of the wrong type", () => {
    expect(
      parseLoadInput(
        JSON.stringify({
          session_id: "s1",
          hook_event_name: "InstructionsLoaded",
          file_path: "/work/catalog/CLAUDE.md",
          load_reason: 7,
          globs: ["api/**", 3],
        }),
      ),
    ).toEqual({
      session_id: "s1",
      file_path: "/work/catalog/CLAUDE.md",
      globs: ["api/**"],
    });
  });

  test("refuses input that is not an object", () => {
    expect(() => parseLoadInput("[]")).toThrow(TypeError);
    expect(() => parseLoadInput("null")).toThrow(TypeError);
  });
});

describe("keyFromRemoteUrl", () => {
  test.each([
    ["git@github.com:acme-books/catalog.git", "acme-books/catalog"],
    ["https://github.com/acme-books/catalog.git", "acme-books/catalog"],
    ["https://github.com/acme-books/catalog", "acme-books/catalog"],
    ["https://github.com/acme-books/catalog/", "acme-books/catalog"],
    ["ssh://git@github.com/acme-books/catalog.git", "acme-books/catalog"],
  ])("reads %s as %s", (url, key) => {
    expect(keyFromRemoteUrl(url)).toBe(key);
  });

  test("reads no key from a URL without an owner", () => {
    expect(keyFromRemoteUrl("catalog")).toBeUndefined();
  });
});

describe("repositoryKey", () => {
  test("prefers upstream to origin, as gh repo view does", () => {
    expect(
      repositoryKey(
        {
          origin: "git@github.com:someone/catalog.git",
          upstream: "git@github.com:acme-books/catalog.git",
        },
        "/work/catalog",
      ),
    ).toBe("acme-books/catalog");
  });

  test("takes origin without upstream", () => {
    expect(
      repositoryKey(
        { origin: "https://github.com/acme-books/catalog" },
        "/work/catalog",
      ),
    ).toBe("acme-books/catalog");
  });

  test("falls back to the directory name", () => {
    expect(repositoryKey({}, "/work/catalog")).toBe("catalog");
    expect(repositoryKey({ origin: "catalog" }, "/work/catalog")).toBe(
      "catalog",
    );
  });
});

describe("pathFromRoot", () => {
  test("makes a path inside the root relative", () => {
    expect(pathFromRoot("/work/catalog/api/CLAUDE.md", "/work/catalog")).toBe(
      "api/CLAUDE.md",
    );
  });

  test("keeps a path outside the root absolute", () => {
    expect(pathFromRoot("/home/me/.claude/CLAUDE.md", "/work/catalog")).toBe(
      "/home/me/.claude/CLAUDE.md",
    );
    expect(pathFromRoot("/work/CLAUDE.md", "/work/catalog")).toBe(
      "/work/CLAUDE.md",
    );
    expect(pathFromRoot("/work/catalog-docs/x.md", "/work/catalog")).toBe(
      "/work/catalog-docs/x.md",
    );
  });

  test("keeps every path absolute outside a repository", () => {
    expect(pathFromRoot("/work/CLAUDE.md", undefined)).toBe("/work/CLAUDE.md");
  });
});

describe("loadEntry", () => {
  const catalog = { root: "/work/catalog", key: "acme-books/catalog" };

  test("records a lazy load with its trigger and globs", () => {
    expect(
      loadEntry(
        {
          session_id: "s1",
          agent_id: "a1",
          cwd: "/work/catalog",
          file_path: "/work/catalog/.claude/rules/api.md",
          memory_type: "Project",
          load_reason: "path_glob_match",
          globs: ["api/**"],
          trigger_file_path: "/work/catalog/api/routes.ts",
        },
        catalog,
        "abc123",
        TIME,
      ),
    ).toEqual({
      time: "2026-11-09T12:00:00.000Z",
      session_id: "s1",
      agent_id: "a1",
      cwd: "/work/catalog",
      root: "/work/catalog",
      file: ".claude/rules/api.md",
      memory_type: "Project",
      load_reason: "path_glob_match",
      globs: ["api/**"],
      trigger_file: "api/routes.ts",
      blob: "abc123",
    });
  });

  test("records an include with its parent", () => {
    expect(
      loadEntry(
        {
          file_path: "/work/catalog/AGENTS.md",
          load_reason: "include",
          parent_file_path: "/work/catalog/CLAUDE.md",
        },
        catalog,
        null,
        TIME,
      ),
    ).toMatchObject({ file: "AGENTS.md", parent_file: "CLAUDE.md" });
  });

  test("writes null for what the input lacks", () => {
    expect(loadEntry({}, { root: undefined, key: "x" }, null, TIME)).toEqual({
      time: "2026-11-09T12:00:00.000Z",
      session_id: null,
      cwd: null,
      root: null,
      file: null,
      memory_type: null,
      load_reason: null,
      blob: null,
    });
  });
});

describe("loadEntry on disk", () => {
  test("reads a file inside the root through a symlinked directory", async () => {
    const root = await temporaryDirectory();
    const link = join(await temporaryDirectory(), "link");
    await Bun.write(join(root, "api", "CLAUDE.md"), "# Api\n");
    await symlink(root, link);

    expect(
      loadEntry(
        { file_path: join(link, "api", "CLAUDE.md") },
        { root, key: "catalog" },
        null,
        TIME,
      ).file,
    ).toBe("api/CLAUDE.md");
  });

  test("keeps a symlinked file outside the root at its own path", async () => {
    const root = await temporaryDirectory();
    const home = await temporaryDirectory();
    await Bun.write(join(home, "dotfiles", "CLAUDE.md"), "# User\n");
    await mkdir(join(home, ".claude"));
    await symlink(
      join(home, "dotfiles", "CLAUDE.md"),
      join(home, ".claude", "CLAUDE.md"),
    );

    expect(
      loadEntry(
        { file_path: join(home, ".claude", "CLAUDE.md") },
        { root, key: "catalog" },
        null,
        TIME,
      ).file,
    ).toBe(join(home, ".claude", "CLAUDE.md"));
  });
});

describe("findRepository", () => {
  test("finds the root and key from a subdirectory", async () => {
    const root = await repository({
      origin: "git@github.com:acme-books/catalog.git",
    });

    expect(findRepository(join(root, "api"))).toEqual({
      root,
      key: "acme-books/catalog",
    });
  });

  test("takes the directory name outside a repository", async () => {
    const directory = await temporaryDirectory();

    expect(findRepository(directory)).toEqual({
      root: undefined,
      key: directory.split("/").at(-1) ?? "",
    });
  });
});

describe("recordLoad", () => {
  test("appends one line per load with the file's blob hash", async () => {
    const root = await repository({
      origin: "https://github.com/acme-books/catalog.git",
    });
    const home = await temporaryDirectory();
    const input = {
      session_id: "s1",
      cwd: root,
      file_path: join(root, "api", "CLAUDE.md"),
      memory_type: "Project",
      load_reason: "nested_traversal",
      trigger_file_path: join(root, "api", "routes.ts"),
    };

    const path = recordLoad(input, home, TIME);
    recordLoad({ ...input, load_reason: "compact" }, home, TIME);

    expect(path).toBe(logPath(home, "acme-books/catalog"));
    expect(path).toBe(
      join(home, ".claude", "bonsai", "loads", "acme-books", "catalog.jsonl"),
    );
    expect(readLog(path)).toEqual([
      expect.objectContaining({
        file: "api/CLAUDE.md",
        trigger_file: "api/routes.ts",
        load_reason: "nested_traversal",
        blob: run(root, "git", "hash-object", "api/CLAUDE.md"),
      }),
      expect.objectContaining({ load_reason: "compact" }),
    ]);
  });

  test("records a missing file with no blob", async () => {
    const root = await repository({});
    const home = await temporaryDirectory();

    const path = recordLoad(
      { cwd: root, file_path: join(root, "gone", "CLAUDE.md") },
      home,
      TIME,
    );

    expect(readLog(path)).toEqual([
      expect.objectContaining({ file: "gone/CLAUDE.md", blob: null }),
    ]);
  });
});

/** Runs the hook as Claude Code does, with BONSAI_LOAD_LOG set or unset. */
async function runHook(
  home: string,
  stdin: string,
  enabled: string | undefined,
): Promise<{ code: number; stdout: string }> {
  const env: Record<string, string | undefined> = {
    ...process.env,
    HOME: home,
  };
  delete env.BONSAI_LOAD_LOG;

  if (enabled !== undefined) {
    env.BONSAI_LOAD_LOG = enabled;
  }

  const hook = Bun.spawn(["sh", HOOK], {
    env,
    stdin: new Blob([stdin]),
    stdout: "pipe",
  });
  const [stdout, code] = await Promise.all([
    new Response(hook.stdout).text(),
    hook.exited,
  ]);

  return { code, stdout };
}

function sessionStart(root: string): string {
  return JSON.stringify({
    session_id: "s1",
    cwd: root,
    file_path: join(root, "CLAUDE.md"),
    load_reason: "session_start",
  });
}

describe("main", () => {
  test("logs a load", async () => {
    const root = await repository({});
    const home = await temporaryDirectory();

    main(sessionStart(root), home);

    expect(readLog(logPath(home, root.split("/").at(-1) ?? ""))).toHaveLength(
      1,
    );
  });

  test("swallows input it cannot read", async () => {
    const home = await temporaryDirectory();

    expect(() => main("not json", home)).not.toThrow();
    expect(existsSync(join(home, ".claude"))).toBe(false);
  });
});

describe("log-load.sh", () => {
  test("writes nothing unless BONSAI_LOAD_LOG is 1", async () => {
    const root = await repository({});
    const home = await temporaryDirectory();

    expect(await runHook(home, sessionStart(root), undefined)).toEqual({
      code: 0,
      stdout: "",
    });
    expect(await runHook(home, sessionStart(root), "0")).toEqual({
      code: 0,
      stdout: "",
    });
    expect(existsSync(join(home, ".claude"))).toBe(false);
  });

  test("logs the load and prints nothing when on", async () => {
    const root = await repository({});
    const home = await temporaryDirectory();

    expect(await runHook(home, sessionStart(root), "1")).toEqual({
      code: 0,
      stdout: "",
    });
    expect(readLog(logPath(home, root.split("/").at(-1) ?? ""))).toEqual([
      expect.objectContaining({
        file: "CLAUDE.md",
        load_reason: "session_start",
      }),
    ]);
  });

  test("exits 0 and writes nothing on input it cannot read", async () => {
    const home = await temporaryDirectory();

    expect(await runHook(home, "not json", "1")).toEqual({
      code: 0,
      stdout: "",
    });
    expect(existsSync(join(home, ".claude"))).toBe(false);
  });
});
