import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bundlePageScript } from "./page-script";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "page-script-"));
  // A module the entries import, so the bundle holds two.
  await Bun.write(
    join(dir, "greet.ts"),
    "export const greet = (name: string) => `Hi ${name}`;\n",
  );
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function fixture(name: string, source: string): Promise<string> {
  const entry = join(dir, name);
  await Bun.write(entry, source);

  return entry;
}

describe("bundlePageScript", () => {
  test("bundles an entry and its imports into one script with no imports or types", async () => {
    const script = await bundlePageScript(
      await fixture(
        "entry.ts",
        'import { greet } from "./greet";\ndocument.title = greet("Acme Books");\n',
      ),
    );

    expect(script).toContain('greet("Acme Books")');
    expect(script).not.toMatch(/^\s*(import|export)\b/m);
    expect(script).not.toContain(": string");
  });

  test("names each module in its comment without a path from the machine", async () => {
    const script = await bundlePageScript(
      await fixture(
        "named.ts",
        'import { greet } from "./greet";\nconsole.log(greet("Acme Books"));\n',
      ),
    );

    expect(script).toMatch(/^\/\/ greet\.ts$/m);
    expect(script).not.toContain(dir);
    expect(script).not.toMatch(/^\/\/ .*\//m);
  });

  test("refuses code that would end the script block", async () => {
    const entry = await fixture("close.ts", 'console.log("</SCRIPT >");\n');

    expect(bundlePageScript(entry)).rejects.toThrow(
      'bundles to code with "</script" or "<!--"',
    );
  });

  test("refuses code that would open a comment in the script block", async () => {
    const entry = await fixture("comment.ts", 'console.log("<!--");\n');

    expect(bundlePageScript(entry)).rejects.toThrow(
      'Split the string, as in "<" + "/script".',
    );
  });

  test("names a script that does not build, with the bundler's error", async () => {
    const entry = await fixture("broken.ts", "const = ;\n");

    expect(bundlePageScript(entry)).rejects.toThrow(
      /Unable to bundle .*broken\.ts:\n.+/,
    );
  });
});
