#!/usr/bin/env bun

// Runs the harness canaries on this machine's Claude Code login (and Codex
// login, when `codex` is on PATH), and prints one row per canary. See
// ../README.md for how to run it and what it costs.
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { parseArgs } from "node:util";

import {
  CANARIES,
  judgeClaude,
  judgeCodex,
  mainPrompt,
  type Canary,
  type ClaudePlan,
  type CodexPlan,
  type Outcome,
} from "./canaries";
import {
  codexCommands,
  codexInstructions,
  codexThreadId,
  codexTokens,
} from "./codex-events";
import { exitCode, resultTable, summaryLine, type Row } from "./report";
import { parseTranscript } from "./transcript";

const { values: options } = parseArgs({
  options: {
    only: { type: "string" },
    jobs: { type: "string", default: "4" },
    model: { type: "string", default: "haiku" },
    keep: { type: "boolean", default: false },
  },
});

const SESSION_TIMEOUT_MS = 300_000;

// A git hook or `git rebase --exec` sets these, and they would point the
// fixture's git at another repository.
const REPOSITORY_VARIABLES = new Set([
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
]);

const environment = Object.fromEntries(
  Object.entries(process.env).flatMap(([name, value]) =>
    value === undefined || REPOSITORY_VARIABLES.has(name)
      ? []
      : [[name, value]],
  ),
);

const claudeHome =
  process.env["CLAUDE_CONFIG_DIR"] ?? join(homedir(), ".claude");
const codexHome = process.env["CODEX_HOME"] ?? join(homedir(), ".codex");

let totalCostUsd = 0;
let totalCodexTokens = 0;

interface Attempt {
  outcome: Outcome | { result: "ERROR" | "SKIP"; detail: string };
  costUsd: number;
  codexTokens: number;
}

function git(root: string, ...args: string[]): void {
  const run = Bun.spawnSync(
    [
      "git",
      "-c",
      "user.name=Acme Books",
      "-c",
      "user.email=dev@acme-books.test",
      ...args,
    ],
    { cwd: root, env: environment },
  );

  if (run.exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed in ${root}: ${run.stderr.toString()}`,
    );
  }
}

/** A committed git repository holding these files. Ignored files stay untracked. */
async function buildFixture(files: Record<string, string>): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "bonsai-canary-")));

  await Promise.all(
    Object.entries(files).map(([path, text]) =>
      Bun.write(join(root, path), text),
    ),
  );
  git(root, "init", "--quiet", "--initial-branch=main");
  git(root, "add", "--all");
  git(root, "commit", "--quiet", "--message", "Acme Books fixture");

  return root;
}

async function firstMatch(
  base: string,
  pattern: string,
): Promise<string | null> {
  for await (const path of new Bun.Glob(pattern).scan({
    cwd: base,
    onlyFiles: true,
  })) {
    return join(base, path);
  }

  return null;
}

/** The highest `total_cost_usd` among the session's result events. */
function streamCost(stream: string): number {
  return stream
    .split("\n")
    .filter((line) => line.includes('"type":"result"'))
    .map((line): unknown => JSON.parse(line))
    .map((event) =>
      typeof event === "object" && event !== null && "total_cost_usd" in event
        ? Number(event.total_cost_usd)
        : 0,
    )
    .reduce((highest, cost) => Math.max(highest, cost), 0);
}

/**
 * Deletes the session's transcripts. Claude Code names the project folder
 * after the fixture's unique temporary path, so the folder (auto memory
 * included) belongs to this session alone.
 */
async function removeTranscripts(
  transcript: string,
  sessionId: string,
  root: string,
): Promise<void> {
  const projectDirectory = dirname(transcript);

  if (basename(projectDirectory).endsWith(`-${basename(root)}`)) {
    await rm(projectDirectory, { recursive: true, force: true });

    return;
  }

  await rm(transcript, { force: true });
  await rm(join(projectDirectory, sessionId), { recursive: true, force: true });
}

async function runClaude(plan: ClaudePlan): Promise<Attempt> {
  const root = await buildFixture(plan.files);
  const sessionId = crypto.randomUUID();
  const tools = plan.tools.join(",");
  const session = Bun.spawn(
    [
      "claude",
      "-p",
      mainPrompt(plan, root),
      "--model",
      options.model,
      "--output-format",
      "stream-json",
      "--verbose",
      "--session-id",
      sessionId,
      "--setting-sources",
      "project",
      "--strict-mcp-config",
      "--tools",
      tools,
      "--allowed-tools",
      tools,
      "--permission-mode",
      "dontAsk",
    ],
    {
      cwd: root,
      env: environment,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: SESSION_TIMEOUT_MS,
    },
  );
  const stream = await new Response(session.stdout).text();
  const stderr = await new Response(session.stderr).text();
  await session.exited;
  const costUsd = streamCost(stream);
  const transcriptPath = await firstMatch(
    join(claudeHome, "projects"),
    `*/${sessionId}.jsonl`,
  );

  try {
    if (session.exitCode !== 0 || transcriptPath === null) {
      return {
        outcome: {
          result: "ERROR",
          detail: `claude exited ${session.exitCode ?? "on a signal"}${transcriptPath === null ? " and left no transcript" : ""}: ${stderr.trim().slice(0, 300)}`,
        },
        costUsd,
        codexTokens: 0,
      };
    }

    const main = parseTranscript(await Bun.file(transcriptPath).text());
    const subagentDirectory = join(
      dirname(transcriptPath),
      sessionId,
      "subagents",
    );
    const subagentPath = await firstMatch(
      subagentDirectory,
      "agent-*.jsonl",
    ).catch(() => null);
    const subagent =
      subagentPath === null
        ? null
        : parseTranscript(await Bun.file(subagentPath).text());

    return {
      outcome: judgeClaude(plan, main, subagent),
      costUsd,
      codexTokens: 0,
    };
  } finally {
    if (options.keep) {
      console.error(`kept ${root} and ${transcriptPath ?? "no transcript"}`);
    } else {
      await rm(root, { recursive: true, force: true });

      if (transcriptPath !== null) {
        await removeTranscripts(transcriptPath, sessionId, root);
      }
    }
  }
}

async function runCodexOnce(
  root: string,
  cwd: string,
  prompt: string,
): Promise<{
  rollout: string;
  rolloutPath: string | null;
  events: string;
  exitCode: number;
  stderr: string;
}> {
  const session = Bun.spawn(
    [
      "codex",
      "exec",
      "--json",
      "--sandbox",
      "workspace-write",
      "--config",
      'model_reasoning_effort="low"',
      "--cd",
      join(root, cwd),
      prompt,
    ],
    {
      cwd: root,
      env: environment,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: SESSION_TIMEOUT_MS,
    },
  );
  const [events, stderr] = await Promise.all([
    new Response(session.stdout).text(),
    new Response(session.stderr).text(),
  ]);
  const status = await session.exited;
  const threadId = codexThreadId(events);
  const rolloutPath =
    threadId === null
      ? null
      : await firstMatch(
          join(codexHome, "sessions"),
          `**/rollout-*-${threadId}.jsonl`,
        );
  const rollout =
    rolloutPath === null ? "" : await Bun.file(rolloutPath).text();

  return { rollout, rolloutPath, events, exitCode: status, stderr };
}

async function runCodex(plan: CodexPlan): Promise<Attempt> {
  const root = await buildFixture(plan.files);
  const { fromRoot, fromNested } = plan.runs;
  const rollouts: string[] = [];

  try {
    const rootRun = await runCodexOnce(root, fromRoot.cwd, fromRoot.prompt);
    const nestedRun = await runCodexOnce(
      root,
      fromNested.cwd,
      fromNested.prompt,
    );
    rollouts.push(
      ...[rootRun.rolloutPath, nestedRun.rolloutPath].filter(
        (path): path is string => path !== null,
      ),
    );
    const tokens = codexTokens(rootRun.events) + codexTokens(nestedRun.events);

    const failed = [rootRun, nestedRun].find((run) => run.exitCode !== 0);

    if (failed !== undefined) {
      return {
        outcome: {
          result: "ERROR",
          detail: `A codex run exited with code ${failed.exitCode}: ${failed.stderr.trim().split("\n").slice(-3).join(" ")}`,
        },
        costUsd: 0,
        codexTokens: tokens,
      };
    }

    if (rootRun.rolloutPath === null || nestedRun.rolloutPath === null) {
      return {
        outcome: {
          result: "ERROR",
          detail: "A codex run left no rollout file.",
        },
        costUsd: 0,
        codexTokens: tokens,
      };
    }

    const outcome = judgeCodex(plan, {
      fromRoot: {
        instructions: codexInstructions(rootRun.rollout),
        commands: codexCommands(rootRun.events),
        created: await Bun.file(join(root, "pkg/new.txt")).exists(),
      },
      fromNested: { instructions: codexInstructions(nestedRun.rollout) },
    });

    return { outcome, costUsd: 0, codexTokens: tokens };
  } finally {
    if (options.keep) {
      console.error(`kept ${[root, ...rollouts].join(", ")}`);
    } else {
      await Promise.all(
        [root, ...rollouts].map((path) =>
          rm(path, { recursive: true, force: true }),
        ),
      );
    }
  }
}

async function attempt(canary: Canary): Promise<Attempt> {
  const context = {
    root: "",
    nonce: crypto.randomUUID().slice(0, 8).toUpperCase(),
  };

  if (canary.agent === "codex") {
    if (Bun.which("codex") === null) {
      return {
        outcome: { result: "SKIP", detail: "codex is not on PATH." },
        costUsd: 0,
        codexTokens: 0,
      };
    }

    return runCodex(canary.plan(context));
  }

  return runClaude(canary.plan(context));
}

/** Runs a canary, and once more when the session strayed from its steps. */
async function runCanary(canary: Canary): Promise<Row> {
  const started = performance.now();
  let attempts = 0;
  let last: Attempt | null = null;

  while (attempts < 2 && (last === null || last.outcome.result === "INVALID")) {
    attempts++;
    // The retry depends on the first attempt's result.
    // oxlint-disable-next-line no-await-in-loop
    last = await attempt(canary).catch((error: unknown) => ({
      outcome: { result: "ERROR" as const, detail: String(error) },
      costUsd: 0,
      codexTokens: 0,
    }));
    totalCostUsd += last.costUsd;
    totalCodexTokens += last.codexTokens;
  }

  const outcome = last?.outcome ?? {
    result: "ERROR",
    detail: "The canary never ran.",
  };
  console.error(`${canary.id}: ${outcome.result}`);

  return {
    id: canary.id,
    result: outcome.result,
    detail: outcome.detail,
    update: canary.update,
    attempts,
    seconds: (performance.now() - started) / 1000,
  };
}

async function runAll(canaries: Canary[], jobs: number): Promise<Row[]> {
  const rows = new Map<string, Row>();
  const queue = [...canaries];

  await Promise.all(
    Array.from({ length: Math.min(jobs, queue.length) }, async () => {
      for (
        let canary = queue.shift();
        canary !== undefined;
        canary = queue.shift()
      ) {
        // Each worker runs its canaries one at a time, so `--jobs` caps the sessions.
        // oxlint-disable-next-line no-await-in-loop
        rows.set(canary.id, await runCanary(canary));
      }
    }),
  );

  return canaries.flatMap((canary) => rows.get(canary.id) ?? []);
}

const selected = options.only?.split(",").map((id) => id.trim());
const unknown =
  selected?.filter((id) => !CANARIES.some((canary) => canary.id === id)) ?? [];

if (unknown.length > 0) {
  console.error(
    `Unknown canary: ${unknown.join(", ")}. The canaries are ${CANARIES.map((canary) => canary.id).join(", ")}.`,
  );
  process.exit(2);
}

const jobs = Number(options.jobs);

if (!Number.isInteger(jobs) || jobs < 1) {
  console.error(
    `The --jobs option must be a positive whole number, and it is "${options.jobs}".`,
  );
  process.exit(2);
}

const started = performance.now();
const claudeVersion = Bun.spawnSync(["claude", "--version"])
  .stdout.toString()
  .trim();
const rows = await runAll(
  CANARIES.filter((canary) => selected?.includes(canary.id) ?? true),
  jobs,
);

console.log(`Harness canaries, ${claudeVersion}, model ${options.model}\n`);
console.log(resultTable(rows));
console.log(
  `\n${summaryLine(rows, totalCostUsd, totalCodexTokens, (performance.now() - started) / 1000)}`,
);
process.exit(exitCode(rows));
