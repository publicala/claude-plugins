import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readlinkSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOOK = join(import.meta.dir, "install.sh");
const TOKEN = "store-token";

type Release = {
  version: string;
  platform: string;
  archive: Uint8Array;
  corrupt?: boolean;
};

type HookOutput = {
  hookSpecificOutput: {
    hookEventName: "SessionStart";
    additionalContext: string;
    reloadSkills: boolean;
  };
};

function isHookOutput(value: unknown): value is HookOutput {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const specific: unknown = Reflect.get(value, "hookSpecificOutput");

  return (
    typeof specific === "object" &&
    specific !== null &&
    Reflect.get(specific, "hookEventName") === "SessionStart" &&
    typeof Reflect.get(specific, "additionalContext") === "string" &&
    typeof Reflect.get(specific, "reloadSkills") === "boolean"
  );
}

function readHookOutput(output: string): {
  context: string;
  reloadsSkills: boolean;
} {
  if (output === "") {
    return { context: "", reloadsSkills: false };
  }

  const parsed: unknown = JSON.parse(output);

  if (!isHookOutput(parsed)) {
    throw new Error(`The hook printed unexpected output: ${output}`);
  }

  return {
    context: parsed.hookSpecificOutput.additionalContext,
    reloadsSkills: parsed.hookSpecificOutput.reloadSkills,
  };
}

const releases = new Map<string, Release>();
const requests: { path: string; authorization: string | null }[] = [];
const temporary: string[] = [];
let server: ReturnType<typeof Bun.serve>;

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function platform(): string {
  const system = process.platform === "darwin" ? "macos" : "linux";
  const machine = process.arch === "arm64" ? "arm64" : "x86_64";

  return `${system}-${machine}`;
}

function archiveName(packageName: string, release: Release): string {
  return `${packageName}-v${release.version}-${release.platform}.tar.gz`;
}

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      const authorization = request.headers.get("Authorization");
      requests.push({ path, authorization });

      if (authorization !== `Bearer ${TOKEN}`) {
        return Response.json(
          { error: "Missing or invalid token." },
          { status: 401 },
        );
      }

      const [, , packageName = "", version, file] = path.split("/");
      const release = releases.get(packageName);

      if (release === undefined) {
        return Response.json(
          { error: "Unable to find the package." },
          { status: 404 },
        );
      }

      const name = archiveName(packageName, release);

      if (version === "latest") {
        return Response.json({
          package: packageName,
          version: release.version,
          files: [
            {
              name,
              platform: release.platform,
              sha256: release.corrupt
                ? "0".repeat(64)
                : sha256(release.archive),
              size: release.archive.byteLength,
            },
          ],
        });
      }

      return file === name
        ? new Response(release.archive)
        : Response.json({ error: "Unable to find the file." }, { status: 404 });
    },
  });
});

afterAll(() => server.stop(true));

afterEach(async () => {
  releases.clear();
  requests.length = 0;
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "cloud-artifacts-"));
  temporary.push(path);

  return path;
}

async function buildArchive(
  topDirectory: string,
  files: Record<string, { content: string; executable?: boolean }>,
): Promise<Uint8Array> {
  const source = await temporaryDirectory();

  await Promise.all(
    Object.entries(files).map(async ([path, file]) => {
      const target = join(source, topDirectory, path);
      await mkdir(join(target, ".."), { recursive: true });
      await writeFile(target, file.content, {
        mode: file.executable ? 0o755 : 0o644,
      });
    }),
  );

  const archive = join(source, "archive.tar.gz");
  const tar = Bun.spawnSync([
    "tar",
    "-czf",
    archive,
    "-C",
    source,
    topDirectory,
  ]);
  expect(tar.exitCode).toBe(0);

  return readFileSync(archive);
}

async function publishSkill(
  packageName: string,
  version: string,
): Promise<Release> {
  const release: Release = {
    version,
    platform: platform(),
    archive: await buildArchive(packageName, {
      "SKILL.md": { content: `---\nname: ${packageName}\n---\n` },
      [`bin/${packageName}`]: {
        content: "#!/bin/sh\necho ok\n",
        executable: true,
      },
    }),
  };
  releases.set(packageName, release);

  return release;
}

async function runHookIn(
  home: string,
  environment: Record<string, string> = {},
) {
  const hook = Bun.spawn(["sh", HOOK], {
    stdout: "pipe",
    env: {
      PATH: process.env["PATH"] ?? "",
      HOME: home,
      CLOUD_ARTIFACTS_URL: `http://127.0.0.1:${server.port}/`,
      CLOUD_ARTIFACTS_TOKEN: TOKEN,
      ...environment,
    },
  });
  const output = await new Response(hook.stdout).text();
  const report = readHookOutput(output);

  return {
    home,
    exitCode: await hook.exited,
    output,
    ...report,
    installed: (packageName: string, version: string) =>
      join(home, ".local/share/cloud-artifacts", packageName, version),
  };
}

async function runHook(environment: Record<string, string> = {}) {
  return runHookIn(await temporaryDirectory(), environment);
}

describe("install.sh", () => {
  test("does nothing without a store or a package list", async () => {
    const withoutPackages = await runHook();
    const withoutStore = await runHook({
      CLOUD_ARTIFACTS_URL: "",
      CLOUD_ARTIFACTS_PACKAGES: "tool",
    });

    expect(withoutPackages.output).toBe("");
    expect(withoutStore.output).toBe("");
    expect(requests).toHaveLength(0);
  });

  test("installs a package and links its skill and executables", async () => {
    await publishSkill("tool", "1.2.3");

    const run = await runHook({ CLOUD_ARTIFACTS_PACKAGES: "tool" });
    const installed = run.installed("tool", "1.2.3");

    expect(run.exitCode).toBe(0);
    expect(run.context).toBe(
      `cloud-artifacts: tool 1.2.3 installed at ${installed}\n`,
    );
    expect(run.reloadsSkills).toBe(true);
    expect(readlinkSync(join(run.home, ".claude/skills/tool"))).toBe(installed);
    expect(readlinkSync(join(run.home, ".local/bin/tool"))).toBe(
      join(installed, "bin/tool"),
    );
    expect(
      requests.every((request) => request.authorization === `Bearer ${TOKEN}`),
    ).toBe(true);
  });

  test("sends the network-secret placeholder when no token is set", async () => {
    await publishSkill("tool", "1.0.0");

    const run = await runHook({
      CLOUD_ARTIFACTS_PACKAGES: "tool",
      CLOUD_ARTIFACTS_TOKEN: "",
    });

    expect(requests[0]?.authorization).toBe("Bearer network-secret");
    expect(run.context).toContain("tool: unable to read the latest release");
    expect(run.exitCode).toBe(0);
  });

  test("skips the download when the version is already installed", async () => {
    await publishSkill("tool", "1.0.0");
    const first = await runHook({ CLOUD_ARTIFACTS_PACKAGES: "tool" });
    requests.length = 0;

    const second = await runHookIn(first.home, {
      CLOUD_ARTIFACTS_PACKAGES: "tool",
    });

    expect(second.context).toBe(
      `cloud-artifacts: tool 1.0.0 ready at ${first.installed("tool", "1.0.0")}\n`,
    );
    expect(requests.map((request) => request.path)).toEqual([
      "/v1/tool/latest",
    ]);
  });

  test("installs several packages from a comma or space separated list", async () => {
    await publishSkill("alpha", "1.0.0");
    await publishSkill("beta", "2.0.0");

    const run = await runHook({ CLOUD_ARTIFACTS_PACKAGES: "alpha, beta" });

    expect(existsSync(run.installed("alpha", "1.0.0"))).toBe(true);
    expect(existsSync(run.installed("beta", "2.0.0"))).toBe(true);
  });

  test("refuses an archive that does not match the manifest", async () => {
    const release = await publishSkill("tool", "1.0.0");
    release.corrupt = true;

    const run = await runHook({ CLOUD_ARTIFACTS_PACKAGES: "tool" });

    expect(run.context).toContain("does not match the manifest's sha256");
    expect(existsSync(run.installed("tool", "1.0.0"))).toBe(false);
  });

  test("refuses an archive without the package's top-level directory", async () => {
    releases.set("tool", {
      version: "1.0.0",
      platform: platform(),
      archive: await buildArchive("other", { "SKILL.md": { content: "x" } }),
    });

    const run = await runHook({ CLOUD_ARTIFACTS_PACKAGES: "tool" });

    expect(run.context).toContain("has no top-level tool directory");
    expect(existsSync(run.installed("tool", "1.0.0"))).toBe(false);
  });

  test("reports a release without a build for this platform", async () => {
    const release = await publishSkill("tool", "1.0.0");
    release.platform = "plan9-mips";

    const run = await runHook({ CLOUD_ARTIFACTS_PACKAGES: "tool" });

    expect(run.context).toBe(
      `cloud-artifacts: tool 1.0.0: no build for ${platform()}\n`,
    );
    expect(run.reloadsSkills).toBe(false);
  });

  test("rejects package names that could escape the install directory", async () => {
    const run = await runHook({ CLOUD_ARTIFACTS_PACKAGES: "../etc -x Tool" });

    expect(run.context.match(/skipped/g)).toHaveLength(3);
    expect(requests).toHaveLength(0);
  });

  test("leaves a skill directory someone else put there untouched", async () => {
    await publishSkill("tool", "1.0.0");
    const home = await temporaryDirectory();
    await mkdir(join(home, ".claude/skills/tool"), { recursive: true });

    const run = await runHookIn(home, { CLOUD_ARTIFACTS_PACKAGES: "tool" });

    expect(run.context).toContain("is not a link, so the skill was not linked");
    expect(lstatSync(join(home, ".claude/skills/tool")).isDirectory()).toBe(
      true,
    );
  });

  test("reports a store that is unreachable and still exits 0", async () => {
    const run = await runHook({
      CLOUD_ARTIFACTS_PACKAGES: "tool",
      CLOUD_ARTIFACTS_URL: "http://127.0.0.1:9",
    });

    expect(run.exitCode).toBe(0);
    expect(run.context).toContain(
      "tool: unable to read the latest release from the store",
    );
  });
  test("an upgrade removes executables the new version dropped", async () => {
    const home = await temporaryDirectory();
    releases.set("tool", {
      version: "1.0.0",
      platform: platform(),
      archive: await buildArchive("tool", {
        "bin/tool": { content: "#!/bin/sh\n", executable: true },
        "bin/tool-legacy": { content: "#!/bin/sh\n", executable: true },
      }),
    });
    await runHookIn(home, { CLOUD_ARTIFACTS_PACKAGES: "tool" });
    await publishSkill("tool", "2.0.0");

    const upgrade = await runHookIn(home, { CLOUD_ARTIFACTS_PACKAGES: "tool" });

    expect(
      lstatSync(join(home, ".local/bin/tool-legacy"), {
        throwIfNoEntry: false,
      }),
    ).toBeUndefined();
    expect(readlinkSync(join(home, ".local/bin/tool"))).toBe(
      join(upgrade.installed("tool", "2.0.0"), "bin/tool"),
    );
  });

  test("puts the bin directory on the session's PATH", async () => {
    await publishSkill("tool", "1.0.0");
    const home = await temporaryDirectory();
    const environmentFile = join(home, "session.env");

    await runHookIn(home, {
      CLOUD_ARTIFACTS_PACKAGES: "tool",
      CLAUDE_ENV_FILE: environmentFile,
    });

    expect(readFileSync(environmentFile, "utf8")).toBe(
      `export PATH="${join(home, ".local/bin")}:$PATH"\n`,
    );
  });
  test("skips packages once the time budget runs out", async () => {
    await publishSkill("tool", "1.0.0");

    const run = await runHook({
      CLOUD_ARTIFACTS_PACKAGES: "tool",
      CLOUD_ARTIFACTS_BUDGET_SECONDS: "0",
    });

    expect(run.context).toBe(
      "cloud-artifacts: tool: skipped, the install ran out of its time budget\n",
    );
    expect(requests).toHaveLength(0);
  });

  test("reports a package it cannot move into place", async () => {
    await publishSkill("tool", "1.0.0");
    const home = await temporaryDirectory();
    const installRoot = join(home, "readonly");
    await mkdir(join(installRoot, "tool"), { recursive: true });
    await chmod(join(installRoot, "tool"), 0o555);

    const run = await runHookIn(home, {
      CLOUD_ARTIFACTS_PACKAGES: "tool",
      CLOUD_ARTIFACTS_HOME: installRoot,
    });

    expect(run.context).toContain("tool 1.0.0: unable to move the package");
    expect(run.context).not.toContain("installed at");
    expect(
      lstatSync(join(home, ".claude/skills/tool"), { throwIfNoEntry: false }),
    ).toBeUndefined();
  });
  test("an upgrade that drops the skill removes its link", async () => {
    await publishSkill("tool", "1.0.0");
    const home = await temporaryDirectory();
    await runHookIn(home, { CLOUD_ARTIFACTS_PACKAGES: "tool" });
    releases.set("tool", {
      version: "2.0.0",
      platform: platform(),
      archive: await buildArchive("tool", {
        "bin/tool": { content: "#!/bin/sh\n", executable: true },
      }),
    });

    const upgrade = await runHookIn(home, { CLOUD_ARTIFACTS_PACKAGES: "tool" });

    expect(
      lstatSync(join(home, ".claude/skills/tool"), { throwIfNoEntry: false }),
    ).toBeUndefined();
    expect(upgrade.reloadsSkills).toBe(true);
  });
});
