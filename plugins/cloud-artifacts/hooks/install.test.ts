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
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

  return {
    home,
    exitCode: await hook.exited,
    output,
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
    expect(run.output).toBe(
      `cloud-artifacts: tool 1.2.3 installed at ${installed}\n`,
    );
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
    expect(run.output).toContain("tool: unable to read the latest release");
    expect(run.exitCode).toBe(0);
  });

  test("skips the download when the version is already installed", async () => {
    await publishSkill("tool", "1.0.0");
    const first = await runHook({ CLOUD_ARTIFACTS_PACKAGES: "tool" });
    requests.length = 0;

    const second = await runHookIn(first.home, {
      CLOUD_ARTIFACTS_PACKAGES: "tool",
    });

    expect(second.output).toBe(
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

    expect(run.output).toContain("does not match the manifest's sha256");
    expect(existsSync(run.installed("tool", "1.0.0"))).toBe(false);
  });

  test("refuses an archive without the package's top-level directory", async () => {
    releases.set("tool", {
      version: "1.0.0",
      platform: platform(),
      archive: await buildArchive("other", { "SKILL.md": { content: "x" } }),
    });

    const run = await runHook({ CLOUD_ARTIFACTS_PACKAGES: "tool" });

    expect(run.output).toContain("has no top-level tool directory");
    expect(existsSync(run.installed("tool", "1.0.0"))).toBe(false);
  });

  test("reports a release without a build for this platform", async () => {
    const release = await publishSkill("tool", "1.0.0");
    release.platform = "plan9-mips";

    const run = await runHook({ CLOUD_ARTIFACTS_PACKAGES: "tool" });

    expect(run.output).toBe(
      `cloud-artifacts: tool 1.0.0: no build for ${platform()}\n`,
    );
  });

  test("rejects package names that could escape the install directory", async () => {
    const run = await runHook({ CLOUD_ARTIFACTS_PACKAGES: "../etc -x Tool" });

    expect(run.output.match(/skipped/g)).toHaveLength(3);
    expect(requests).toHaveLength(0);
  });

  test("leaves a skill directory someone else put there untouched", async () => {
    await publishSkill("tool", "1.0.0");
    const home = await temporaryDirectory();
    await mkdir(join(home, ".claude/skills/tool"), { recursive: true });

    const run = await runHookIn(home, { CLOUD_ARTIFACTS_PACKAGES: "tool" });

    expect(run.output).toContain("is not a link, so the skill was not linked");
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
    expect(run.output).toContain(
      "tool: unable to read the latest release from the store",
    );
  });
});
