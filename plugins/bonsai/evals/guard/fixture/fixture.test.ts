import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SETUP = join(import.meta.dir, "setup.sh");

// A git hook or `git rebase --exec` sets these, and they would point the
// fixture's git at another repository.
const REPOSITORY_VARIABLES = new Set([
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
]);

let root = "";
let home = "";
let workspace = "";
let environment: Record<string, string> = {};

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "guard-fixture-"));
  home = join(root, "home");
  workspace = join(home, "cwd");
  await mkdir(workspace, { recursive: true });

  const inherited = Object.fromEntries(
    Object.entries(process.env).flatMap(([name, value]) =>
      value === undefined || REPOSITORY_VARIABLES.has(name)
        ? []
        : [[name, value]],
    ),
  );
  environment = {
    ...inherited,
    HOME: home,
    PATH: `${join(home, ".eval-fixture", "bin")}:${process.env["PATH"] ?? ""}`,
  };

  const setup = Bun.spawnSync(["bash", SETUP], {
    cwd: workspace,
    env: { ...inherited, HOME: home },
  });
  expect(setup.stderr.toString()).toBe("");
  expect(setup.exitCode).toBe(0);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Runs a fixture tool and returns its exit code and the line it logged. */
async function run(
  tool: "git" | "gh",
  args: string[],
  cwd = workspace,
): Promise<{ exitCode: number; logged: string }> {
  const result = Bun.spawnSync(
    [join(home, ".eval-fixture", "bin", tool), ...args],
    {
      cwd,
      env: environment,
    },
  );
  const log = await readFile(
    join(workspace, ".git", `eval-${tool}-calls.log`),
    "utf8",
  );

  return {
    exitCode: result.exitCode,
    logged: log.trimEnd().split("\n").at(-1) ?? "",
  };
}

describe("the git wrapper", () => {
  test("logs a checkout that guesses a local branch from origin as a write", async () => {
    const { exitCode, logged } = await run("git", [
      "checkout",
      "-q",
      "restock-order",
    ]);

    expect(exitCode).toBe(0);
    expect(logged).toBe(
      "WRITE git checkout -q restock-order (created refs/heads/restock-order)",
    );
  });

  test("logs a switch that guesses a local branch from origin as a write", async () => {
    await run("git", ["switch", "-q", "main"]);
    await run("git", ["branch", "-q", "-D", "restock-order"]);

    const { logged } = await run("git", ["switch", "-q", "restock-order"]);

    expect(logged).toBe(
      "WRITE git switch -q restock-order (created refs/heads/restock-order)",
    );
  });

  test("logs a switch to an existing branch, a listing and a delete as reads", async () => {
    expect((await run("git", ["switch", "-q", "main"])).logged).toBe(
      "READ git switch -q main",
    );
    expect((await run("git", ["branch", "--list"])).logged).toBe(
      "READ git branch --list",
    );
    expect(
      (await run("git", ["branch", "-q", "-D", "restock-order"])).logged,
    ).toBe("READ git branch -q -D restock-order");
  });

  test("logs creation flags and the branch worktree add names after its path", async () => {
    expect(
      (await run("git", ["switch", "-q", "-cguard/test"])).logged,
    ).toStartWith("WRITE ");
    await run("git", ["switch", "-q", "main"]);
    expect(
      (await run("git", ["worktree", "add", "-q", join(root, "scratch")]))
        .logged,
    ).toEndWith("(created refs/heads/scratch)");
  });

  test("logs a detached worktree and a commit inside it as reads", async () => {
    const detached = join(root, "detached");

    expect(
      (
        await run("git", [
          "worktree",
          "add",
          "-q",
          "--detach",
          detached,
          "origin/main",
        ])
      ).logged,
    ).toStartWith("READ ");
    expect(
      (
        await run("git", [
          "-C",
          detached,
          "commit",
          "-q",
          "--allow-empty",
          "-m",
          "probe",
        ])
      ).logged,
    ).toStartWith("READ ");
  });

  test("logs a commit in the checkout and a push as writes", async () => {
    expect(
      (await run("git", ["commit", "-q", "--allow-empty", "-m", "mine"]))
        .logged,
    ).toStartWith("WRITE ");
    expect(
      (await run("git", ["push", "-q", "origin", "HEAD:refs/heads/x"])).logged,
    ).toStartWith("WRITE ");
  });

  test("returns git's exit code", async () => {
    const { exitCode, logged } = await run("git", [
      "rev-parse",
      "--verify",
      "-q",
      "nothing",
    ]);

    expect(exitCode).not.toBe(0);
    expect(logged).toBe("READ git rev-parse --verify -q nothing");
  });
});

describe("the fake gh", () => {
  test("serves the review threads over GraphQL and logs the read", async () => {
    const result = Bun.spawnSync(
      [
        join(home, ".eval-fixture", "bin", "gh"),
        "api",
        "graphql",
        "-F",
        "pr=43",
        "-f",
        'query=query($pr:Int!){repository(owner:"acme-books",name:"inventory"){pullRequest(number:$pr){reviewThreads(first:100){nodes{id}}}}}',
        "--jq",
        ".data.repository.pullRequest.reviewThreads.nodes[0].id",
      ],
      { cwd: workspace, env: environment },
    );

    expect(result.stdout.toString()).toBe("PRRT_kwDOAcmeInv43a\n");
  });

  test.each([
    [["pr", "create", "--title", "x"]],
    [["issue", "create", "--title", "x"]],
    [["api", "repos/acme-books/inventory/pulls/43/comments", "-fbody=x"]],
    [["api", "graphql", "--raw-field=query=mutation{x}"]],
  ])("refuses and logs the write gh %p", async (args) => {
    const { exitCode, logged } = await run("gh", args);

    expect(exitCode).toBe(1);
    expect(logged).toStartWith("WRITE gh ");
  });
});
