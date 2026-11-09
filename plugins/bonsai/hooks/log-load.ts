#!/usr/bin/env bun

// Appends one line per instruction file load to
// ~/.claude/bonsai/loads/<repository key>.jsonl. It records paths and
// blob hashes, never contents. log-load.sh starts it only when
// BONSAI_LOAD_LOG=1, and every failure ends in silence.
import { appendFileSync, mkdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";

/** The InstructionsLoaded hook input fields the log reads. */
export interface LoadInput {
  session_id?: string;
  agent_id?: string;
  cwd?: string;
  file_path?: string;
  memory_type?: string;
  load_reason?: string;
  globs?: string[];
  trigger_file_path?: string;
  parent_file_path?: string;
}

const STRING_FIELDS = [
  "session_id",
  "agent_id",
  "cwd",
  "file_path",
  "memory_type",
  "load_reason",
  "trigger_file_path",
  "parent_file_path",
] as const;

/** The hook input's known fields, dropping any of an unexpected type. */
export function parseLoadInput(text: string): LoadInput {
  const json: unknown = JSON.parse(text);

  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    throw new TypeError("The hook input is not a JSON object.");
  }

  const fields = new Map(Object.entries(json));
  const input: LoadInput = {};

  for (const name of STRING_FIELDS) {
    const value: unknown = fields.get(name);

    if (typeof value === "string") {
      input[name] = value;
    }
  }

  const globs: unknown = fields.get("globs");

  if (Array.isArray(globs)) {
    input.globs = globs.filter((glob) => typeof glob === "string");
  }

  return input;
}

/** The repository a session works in, as git reports it. */
export interface Repository {
  // The worktree's root, or undefined outside a repository.
  root: string | undefined;
  key: string;
}

export interface LoadEntry {
  time: string;
  session_id: string | null;
  agent_id?: string;
  cwd: string | null;
  root: string | null;
  file: string | null;
  memory_type: string | null;
  load_reason: string | null;
  globs?: string[];
  trigger_file?: string;
  parent_file?: string;
  blob: string | null;
}

// A git hook sets these, and they point git at that repository whatever -C says.
const REPOSITORY_VARIABLES = new Set([
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
]);

/**
 * `owner/repo` from a remote URL in any form git accepts. A `.` or `..`
 * component gives no key, so the log path never climbs out of loads/.
 */
export function keyFromRemoteUrl(url: string): string | undefined {
  const [, owner, repository] =
    /([^/:]+)\/([^/:]+?)(?:\.git)?\/*$/.exec(url.trim()) ?? [];

  if (owner === undefined || repository === undefined) {
    return undefined;
  }

  return [owner, repository].some((part) => part === "." || part === "..")
    ? undefined
    : `${owner}/${repository}`;
}

/**
 * The key bonsai files per-repository state under: `owner/repo` of the
 * `upstream` remote, else of `origin`, the order `gh repo view` reads
 * them in. A repository without either takes its directory name.
 */
export function repositoryKey(
  remotes: Record<string, string>,
  directory: string,
): string {
  const remote = remotes.upstream ?? remotes.origin;
  const key = remote === undefined ? undefined : keyFromRemoteUrl(remote);

  return key ?? basename(directory);
}

/** The path relative to the root when it lies inside, else absolute. */
export function pathFromRoot(path: string, root: string | undefined): string {
  if (root === undefined) {
    return path;
  }

  const fromRoot = relative(root, path);

  return fromRoot === "" ||
    fromRoot === ".." ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot)
    ? path
    : fromRoot;
}

function realPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

export function loadEntry(
  input: LoadInput,
  repository: Repository,
  blob: string | null,
  time: Date,
): LoadEntry {
  // The root is a real path, so a file inside it compares by its real
  // path. A file outside keeps the path the session knows it by.
  const fromRoot = (path: string): string => {
    const real = realPath(path);
    const fromRepositoryRoot = pathFromRoot(real, repository.root);

    return fromRepositoryRoot === real ? path : fromRepositoryRoot;
  };

  return {
    time: time.toISOString(),
    session_id: input.session_id ?? null,
    ...(input.agent_id === undefined ? {} : { agent_id: input.agent_id }),
    cwd: input.cwd ?? null,
    root: repository.root ?? null,
    file: input.file_path === undefined ? null : fromRoot(input.file_path),
    memory_type: input.memory_type ?? null,
    load_reason: input.load_reason ?? null,
    ...(input.globs === undefined ? {} : { globs: input.globs }),
    ...(input.trigger_file_path === undefined
      ? {}
      : { trigger_file: fromRoot(input.trigger_file_path) }),
    ...(input.parent_file_path === undefined
      ? {}
      : { parent_file: fromRoot(input.parent_file_path) }),
    blob,
  };
}

function git(directory: string, ...args: string[]): string | undefined {
  const result = Bun.spawnSync(["git", "-C", directory, ...args], {
    env: Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) => !REPOSITORY_VARIABLES.has(name),
      ),
    ),
    stdout: "pipe",
    stderr: "ignore",
  });

  return result.success ? result.stdout.toString().trim() : undefined;
}

export function findRepository(cwd: string): Repository {
  const root = git(cwd, "rev-parse", "--show-toplevel");
  const remotes: Record<string, string> = {};

  for (const line of (
    git(cwd, "config", "--get-regexp", String.raw`^remote\..*\.url$`) ?? ""
  ).split("\n")) {
    const [, name, url] = /^remote\.(.+)\.url\s+(\S+)$/.exec(line) ?? [];

    if (name !== undefined && url !== undefined) {
      remotes[name] = url;
    }
  }

  return {
    root: root === undefined ? undefined : realPath(root),
    key: repositoryKey(remotes, root ?? cwd),
  };
}

/** The log file a repository's loads go to. */
export function logPath(home: string, key: string): string {
  return join(home, ".claude", "bonsai", "loads", `${key}.jsonl`);
}

/** Appends the load to the repository's log, and returns the log's path. */
export function recordLoad(input: LoadInput, home: string, time: Date): string {
  const cwd = input.cwd ?? process.cwd();
  const repository = findRepository(cwd);
  // --no-filters keeps a configured clean filter, which runs any command,
  // from starting. The hash is of the bytes the session read.
  const blob =
    input.file_path === undefined
      ? null
      : (git(cwd, "hash-object", "--no-filters", "--", input.file_path) ??
        null);
  const path = logPath(home, repository.key);

  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(
    path,
    `${JSON.stringify(loadEntry(input, repository, blob, time))}\n`,
  );

  return path;
}

/** Logs one hook input. A failed log never reaches the session. */
export function main(stdin: string, home: string): void {
  try {
    recordLoad(parseLoadInput(stdin), home, new Date());
  } catch {
    // The session goes on without this line.
  }
}

if (import.meta.main) {
  main(await Bun.stdin.text(), process.env.HOME ?? homedir());
}
