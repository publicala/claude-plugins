import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { chmod, cp, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";

import { Window } from "happy-dom";
import { join } from "node:path";

import {
  DATA_PLACEHOLDER,
  DataError,
  build,
  editorLink,
  estimateTokens,
  main,
  type Page,
  render,
  summary,
} from "./build";

const HERE = import.meta.dir;
const EXAMPLE = join(HERE, "example");
const BUILD_SCRIPT = join(HERE, "build.ts");

interface FixtureEdit {
  file: string;
  lines?: unknown;
  at?: unknown;
  write?: unknown;
}

interface FixtureChange {
  id: string;
  lane: string;
  group?: string;
  verb: string;
  title: string;
  why: string;
  skip?: string;
  check?: unknown;
  edits: FixtureEdit[];
  evidence?: Record<string, unknown>[];
}

interface Fixture {
  run: Record<string, unknown>;
  files: Record<string, unknown>[];
  groups: Record<string, unknown>[];
  changes: FixtureChange[];
  questions: Record<string, unknown>[];
  kept: Record<string, unknown>[];
}

async function exampleData(): Promise<Fixture> {
  return (await Bun.file(join(EXAMPLE, "data.json")).json()) as Fixture;
}

function changeIn<T extends { id: string }>(changes: T[], changeId: string): T {
  const found = changes.find((change) => change.id === changeId);

  if (found === undefined) {
    throw new Error(`The example has no change '${changeId}'.`);
  }

  return found;
}

function firstEdit(change: FixtureChange): FixtureEdit {
  const [edit] = change.edits;

  if (edit === undefined) {
    throw new Error(`Change '${change.id}' has no edits.`);
  }

  return edit;
}

async function buildExample(data: Fixture) {
  return build(data, EXAMPLE);
}

async function expectDataError(data: unknown, message: string): Promise<void> {
  const failure = build(data, EXAMPLE);

  expect(failure).rejects.toBeInstanceOf(DataError);
  expect(failure).rejects.toThrow(message);
  await failure.catch(() => undefined);
}

async function runCli(...args: string[]) {
  const stdout = spyOn(console, "log").mockImplementation(() => undefined);
  const stderr = spyOn(console, "error").mockImplementation(() => undefined);
  const exitCode = await main(args);
  const printed = (spy: typeof stdout) =>
    spy.mock.calls.map((call) => call.join(" ")).join("\n");

  return { stdout: printed(stdout), stderr: printed(stderr), exitCode };
}

async function withExampleCopy(
  callback: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "bonsai-"));

  try {
    await cp(EXAMPLE, directory, { recursive: true });
    await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe("build", () => {
  test("builds the example", async () => {
    const page = await buildExample(await exampleData());

    expect(page.changes).toHaveLength(9);
    expect(page.files.map((file) => file.path)).toEqual([
      "CLAUDE.md",
      "tests/CLAUDE.md",
    ]);
    expect(page.run.round).toBe(1);
    expect(page.run.rounds).toBe(2);
  });

  test("quotes the removed lines from disk", async () => {
    const page = await buildExample(await exampleData());
    const source = (await Bun.file(join(EXAMPLE, "repo", "CLAUDE.md")).text())
      .split("\n")
      .slice(4, 8);

    expect(changeIn(page.changes, "stack").edits[0]?.before).toEqual(
      source.map((text, index) => ({ n: 5 + index, text })),
    );
  });

  test("inserts at the end of a new file", async () => {
    const testing = changeIn(
      (await buildExample(await exampleData())).changes,
      "testing",
    );

    expect(testing.edits[1]?.at).toBe(1);
    expect(testing.edits[1]?.before).toEqual([]);
    expect(testing.edits[1]?.href).toBeNull();
  });

  test("inserts before a line number", async () => {
    const data = await exampleData();
    data.run.editor = "zed";
    changeIn(data.changes, "imports").edits = [
      { file: "CLAUDE.md", at: 35, write: ["- Added."] },
    ];

    const imports = changeIn((await buildExample(data)).changes, "imports");

    expect(imports.edits[0]?.at).toBe(35);
    expect(imports.edits[0]?.href).toMatch(/CLAUDE\.md:34$/);
  });

  test("defaults the optional run fields", async () => {
    const data = await exampleData();
    delete data.run.round;
    delete data.run.rounds;
    delete data.run.waiting;
    delete data.run.editor;

    const page = await buildExample(data);

    expect(page.run).toMatchObject({ round: 1, rounds: 1, waiting: 0 });
    expect(page.files[0]?.href).toBeNull();
  });

  test("accepts a record-mode status", async () => {
    const data = await exampleData();
    data.run.status = {
      state: "applied",
      date: "2026-10-02",
      summary: "8 changes applied.",
      link: "https://github.com/acme/books/pull/42",
      decisions: {
        d: { livewire: "apply", framing: "skip", imports: null },
        q: { "search-doc": "delete" },
        note: { framing: "Keep the intro.", "q:search-doc": "Coming soon." },
        custom: {},
        gnote: { covered: "" },
        next: { "bake-money": true },
        ship: "pr",
      },
    };

    expect((await buildExample(data)).run.status).toEqual(data.run.status);
  });

  test("never reports fewer rounds than the current one", async () => {
    const data = await exampleData();
    data.run.round = 3;

    expect((await buildExample(data)).run.rounds).toBe(3);
  });

  test("previews only the changed regions of a long file", async () => {
    await withExampleCopy(async (directory) => {
      await Bun.write(
        join(directory, "repo", "CLAUDE.md"),
        Array.from(
          { length: 401 },
          (_, index) => `line ${String(index + 1)}`,
        ).join("\n"),
      );
      const data = await exampleData();

      const page = await build(data, directory);

      expect(page.files[0]?.hunks).toBe(true);
      expect(page.files[0]?.lines).toHaveLength(401);
    });
  });

  test("links changes, evidence and kept lines to the editor", async () => {
    const data = await exampleData();
    data.run.editor = "vscode";
    const page = await buildExample(data);
    const livewire = changeIn(page.changes, "livewire");
    const stack = changeIn(page.changes, "stack");

    expect(livewire.edits[0]?.href).toMatch(
      /^vscode:\/\/file\/.+\/repo\/CLAUDE\.md:26$/,
    );
    expect(livewire.evidence[0]?.href).toMatch(
      /^vscode:\/\/file\/.+\/vendor\/livewire\/livewire\/config\/livewire\.php:72$/,
    );
    expect(stack.evidence[0]?.href).toMatch(/\/composer\.json:1$/);
    expect(page.kept[0]?.href).toMatch(/\/repo\/CLAUDE\.md:1$/);
  });

  test("keeps evidence urls and text-only evidence", async () => {
    const data = await exampleData();
    changeIn(data.changes, "framing").evidence = [
      { text: "A thread.", url: "https://example.com/thread" },
      { text: "No link." },
    ];

    const framing = changeIn((await buildExample(data)).changes, "framing");

    expect(framing.evidence).toEqual([
      { text: "A thread.", href: "https://example.com/thread" },
      { text: "No link.", href: null },
    ]);
  });

  test("resolves a relative root against the data file's directory", async () => {
    const page = await buildExample(await exampleData());

    expect(page.run.root).toBe(
      await Bun.$`realpath ${join(EXAMPLE, "repo")}`
        .text()
        .then((path) => path.trim()),
    );
  });
  test("resolves .. after a symlink, as the filesystem does", async () => {
    await withExampleCopy(async (directory) => {
      const outside = join(directory, "outside");
      await mkdir(join(outside, "nested"), { recursive: true });
      await Bun.write(join(outside, "notes.md"), "outside\n");
      await symlink(join(outside, "nested"), join(directory, "repo", "link"));
      const data = await exampleData();
      data.files.push({ path: "link/../notes.md" });
      data.kept.push({
        file: "link/../notes.md",
        lines: [1, 1],
        title: "Notes",
      });

      const page = await build(data, directory);

      expect(page.files[2]?.lines).toEqual(["outside"]);
    });
  });

  test("resolves a root through .. after a symlink", async () => {
    await withExampleCopy(async (directory) => {
      const outside = join(directory, "outside");
      await mkdir(join(outside, "nested"), { recursive: true });
      await cp(join(directory, "repo"), outside, { recursive: true });
      await Bun.write(join(outside, "CLAUDE.md"), "outside\n".repeat(34));
      await symlink(join(outside, "nested"), join(directory, "repo", "link"));
      const data = await exampleData();
      data.run.root = "repo/link/..";

      const page = await build(data, directory);

      expect(page.run.root).toEndWith("/outside");
      expect(page.files[0]?.lines[0]).toBe("outside");
    });
  });

  test("quotes a byte order mark as the file holds it", async () => {
    await withExampleCopy(async (directory) => {
      const claude = join(directory, "repo", "CLAUDE.md");
      await Bun.write(claude, "\uFEFF" + (await Bun.file(claude).text()));

      const page = await build(await exampleData(), directory);

      expect(page.files[0]?.lines[0]).toStartWith("\uFEFF");
    });
  });

  test("refuses a file that is not UTF-8", async () => {
    await withExampleCopy(async (directory) => {
      await Bun.write(
        join(directory, "repo", "CLAUDE.md"),
        new Uint8Array([0x66, 0xff, 0x0a]),
      );

      expect(build(await exampleData(), directory)).rejects.toThrow(
        "Unable to read CLAUDE.md at",
      );
    });
  });

  test("keeps absolute evidence paths", async () => {
    const data = await exampleData();
    data.run.editor = "zed";
    changeIn(data.changes, "framing").evidence = [
      { text: "Shared config.", file: "/etc/shared.md", line: 2 },
    ];

    const framing = changeIn((await buildExample(data)).changes, "framing");

    expect(framing.evidence[0]?.href).toBe("zed://file/etc/shared.md:2");
  });
});

describe("build refuses data that would mislead", () => {
  const cases: [string, (data: Fixture) => void, string][] = [
    [
      "lines out of range",
      (data) => {
        firstEdit(changeIn(data.changes, "stack")).lines = [30, 99];
      },
      "Change 'stack' edits CLAUDE.md lines 30-99, but the file has 34 lines.",
    ],
    [
      "lines that are not a range",
      (data) => {
        firstEdit(changeIn(data.changes, "stack")).lines = [5];
      },
      "Change 'stack' needs \"lines\" in CLAUDE.md as [first, last].",
    ],
    [
      "overlapping changes",
      (data) => {
        firstEdit(changeIn(data.changes, "dev")).lines = [7, 11];
      },
      "Changes 'stack' and 'dev' both edit CLAUDE.md line 7.",
    ],
    [
      "overlapping edits in one change",
      (data) => {
        changeIn(data.changes, "stack").edits.push({
          file: "CLAUDE.md",
          lines: [6, 7],
          write: [],
        });
      },
      "Change 'stack' edits CLAUDE.md line 6 twice. Merge those edits into one.",
    ],
    [
      "an insert inside a replaced range",
      (data) => {
        changeIn(data.changes, "stack").edits.push({
          file: "CLAUDE.md",
          at: 6,
          write: ["- x"],
        });
      },
      "Change 'stack' inserts into CLAUDE.md at line 6, which change 'stack' replaces.",
    ],
    [
      "decisions with an unknown key",
      (data) => {
        data.run.status = { state: "applied", decisions: { pv: "clean" } };
      },
      'run.status.decisions has the unknown key "pv".',
    ],
    [
      "a change decision that is not apply, skip or later",
      (data) => {
        data.run.status = {
          state: "applied",
          decisions: { d: { livewire: "constructor" } },
        };
      },
      "run.status.decisions.d must map change ids to apply, skip, later or null.",
    ],
    [
      "change decisions that are not a map",
      (data) => {
        data.run.status = { state: "applied", decisions: { d: null } };
      },
      "run.status.decisions.d must map change ids to apply, skip, later or null.",
    ],
    [
      "a question answer that is not one of its options",
      (data) => {
        data.run.status = {
          state: "applied",
          decisions: { q: { "search-doc": "maybe" } },
        };
      },
      "run.status.decisions.q must map question ids to one of their option ids.",
    ],
    [
      "a custom draft that is not text",
      (data) => {
        data.run.status = {
          state: "applied",
          decisions: { custom: { livewire: 42 } },
        };
      },
      "run.status.decisions.custom must map change ids to text.",
    ],
    [
      "a next decision that is not true or false",
      (data) => {
        data.run.status = {
          state: "applied",
          decisions: { next: { "bake-money": "yes" } },
        };
      },
      "run.status.decisions.next must map next item ids to true or false.",
    ],
    [
      "a ship decision that is not an option",
      (data) => {
        data.run.status = { state: "applied", decisions: { ship: "merge" } };
      },
      'run.status.decisions.ship must be one of the ship option ids, got "merge".',
    ],
    [
      "a change id that shadows a built-in",
      (data) => {
        changeIn(data.changes, "livewire").id = "constructor";
      },
      'Every change needs a unique id, got "constructor". An id uses letters, digits',
    ],
    [
      "a change id with a quote",
      (data) => {
        changeIn(data.changes, "livewire").id = 'fix"quote';
      },
      'Every change needs a unique id, got "fix\\"quote".',
    ],
    [
      "a group id with a space",
      (data) => {
        data.groups.push({ id: "two words", lane: "ready", title: "T" });
      },
      'Every group needs a unique id, got "two words".',
    ],
    [
      "a question answer for an unknown question",
      (data) => {
        data.run.status = {
          state: "applied",
          decisions: { q: { missing: null } },
        };
      },
      "run.status.decisions.q must map question ids to one of their option ids.",
    ],
    [
      "a note for an unknown change",
      (data) => {
        data.run.status = {
          state: "applied",
          decisions: { note: { missing: "x" } },
        };
      },
      'run.status.decisions.note must map change ids and "q:" question ids to text.',
    ],
    [
      "a draft for an unknown change",
      (data) => {
        data.run.status = {
          state: "applied",
          decisions: { custom: { missing: "x" } },
        };
      },
      "run.status.decisions.custom must map change ids to text.",
    ],
    [
      "a group note for an unknown group",
      (data) => {
        data.run.status = {
          state: "applied",
          decisions: { gnote: { missing: "x" } },
        };
      },
      "run.status.decisions.gnote must map group ids to text.",
    ],
    [
      "a missing file",
      (data) => {
        data.files.push({ path: "docs/missing.md" });
      },
      "Unable to read docs/missing.md",
    ],
    [
      "a new file that exists",
      (data) => {
        data.files[0] = { ...data.files[0], new: true };
      },
      "The file CLAUDE.md is marked new, but it exists",
    ],
    [
      "an absolute file path",
      (data) => {
        data.files.push({ path: "/etc/hosts" });
      },
      'Every file needs a repo-relative path, got "/etc/hosts".',
    ],
    [
      "a file listed twice",
      (data) => {
        data.files.push({ path: "CLAUDE.md" });
      },
      "The file CLAUDE.md is listed twice.",
    ],
    [
      "no files",
      (data) => {
        data.files = [];
      },
      "The data lists no files.",
    ],
    [
      "files that are not objects",
      (data) => {
        (data as unknown as Record<string, unknown>).files = "CLAUDE.md";
      },
      '"files" must be a list of objects.',
    ],
    [
      "an edit of an unlisted file",
      (data) => {
        firstEdit(changeIn(data.changes, "stack")).file = "README.md";
      },
      'Change \'stack\' edits "README.md", which is missing from "files".',
    ],
    [
      "write that is not a list of lines",
      (data) => {
        firstEdit(changeIn(data.changes, "stack")).write = "text";
      },
      "Change 'stack' needs \"write\" as a list of lines.",
    ],
    [
      "write that is null",
      (data) => {
        firstEdit(changeIn(data.changes, "stack")).write = null;
      },
      "Change 'stack' needs \"write\" as a list of lines.",
    ],
    [
      "an insert outside the file",
      (data) => {
        changeIn(data.changes, "imports").edits = [
          { file: "CLAUDE.md", at: 36, write: ["- x"] },
        ];
      },
      "Change 'imports' inserts into CLAUDE.md at 36. Use a line number from 1 to 35, or \"end\".",
    ],
    [
      "an insert that writes nothing",
      (data) => {
        changeIn(data.changes, "imports").edits = [
          { file: "CLAUDE.md", at: "end", write: [] },
        ];
      },
      "Change 'imports' inserts into CLAUDE.md but writes no lines.",
    ],
    [
      "a call without skip",
      (data) => {
        delete changeIn(data.changes, "livewire").skip;
      },
      "Change 'livewire' is a call, so it needs \"skip\"",
    ],
    [
      "a drift outside lane call",
      (data) => {
        changeIn(data.changes, "payouts").check = {
          verdict: "drift",
          summary: "Drops the CSV.",
        };
      },
      "Change 'payouts' drifted in the second check, so it belongs in lane call.",
    ],
    [
      "a check without a verdict",
      (data) => {
        changeIn(data.changes, "payouts").check = { summary: "Same." };
      },
      "Change 'payouts' has a check without a verdict (same or drift) and a summary.",
    ],
    [
      "more than five calls",
      (data) => {
        data.changes.push({
          ...changeIn(data.changes, "framing"),
          id: "extra",
          edits: [{ file: "CLAUDE.md", lines: [34, 34], write: [] }],
        });
      },
      "This round holds 6 calls (questions included), but a round holds at most 5.",
    ],
    [
      "more than three ready groups",
      (data) => {
        for (const [index, line] of [12, 27].entries()) {
          data.groups.push({
            id: `g${String(index)}`,
            lane: "ready",
            title: "Group",
          });
          data.changes.push({
            id: `c${String(index)}`,
            lane: "ready",
            group: `g${String(index)}`,
            verb: "delete",
            title: "T",
            why: "W",
            edits: [{ file: "CLAUDE.md", lines: [line, line], write: [] }],
          });
        }
      },
      "This round holds 4 ready groups, but a round holds at most 3.",
    ],
    [
      "a group of another lane",
      (data) => {
        changeIn(data.changes, "pest").group = "covered";
      },
      "Change 'pest' is in lane auto, but its group 'covered' is ready.",
    ],
    [
      "a change without a group",
      (data) => {
        delete changeIn(data.changes, "pest").group;
      },
      'Change \'pest\' is in lane auto, so it needs a "group" from "groups".',
    ],
    [
      "an empty group",
      (data) => {
        data.groups.push({ id: "empty", lane: "ready", title: "Nothing" });
      },
      "Group 'empty' has no changes. Remove it.",
    ],
    [
      "a group listed twice",
      (data) => {
        data.groups.push({ id: "covered", lane: "ready", title: "Again" });
      },
      'Every group needs a unique id, got "covered".',
    ],
    [
      "a group in lane call",
      (data) => {
        data.groups.push({ id: "calls", lane: "call", title: "Calls" });
      },
      'Group \'calls\' needs lane "ready" or "auto".',
    ],
    [
      "a group without a title",
      (data) => {
        data.groups.push({ id: "untitled", lane: "ready" });
      },
      "Group 'untitled' needs a title.",
    ],
    [
      "a change id used twice",
      (data) => {
        changeIn(data.changes, "dev").id = "stack";
      },
      'Every change needs a unique id, got "stack".',
    ],
    [
      "an unknown lane",
      (data) => {
        changeIn(data.changes, "stack").lane = "maybe";
      },
      "Change 'stack' needs lane call, ready or auto.",
    ],
    [
      "an unknown verb",
      (data) => {
        changeIn(data.changes, "stack").verb = "tweak";
      },
      "Change 'stack' has verb \"tweak\". Use one of fix, delete, shorten, rewrite, move, add or automate.",
    ],
    [
      "a change without a why",
      (data) => {
        changeIn(data.changes, "stack").why = "";
      },
      "Change 'stack' needs a title and a why.",
    ],
    [
      "a change without edits",
      (data) => {
        changeIn(data.changes, "stack").edits = [];
      },
      "Change 'stack' has no edits.",
    ],
    [
      "no changes",
      (data) => {
        data.changes = [];
        data.groups = [];
      },
      "The data holds no changes.",
    ],
    [
      "evidence without text",
      (data) => {
        changeIn(data.changes, "stack").evidence = [{ file: "composer.json" }];
      },
      'Every evidence item needs "text".',
    ],
    [
      "evidence with a bad line",
      (data) => {
        changeIn(data.changes, "stack").evidence = [
          { text: "T", file: "composer.json", line: "top" },
        ];
      },
      'Change \'stack\' has evidence that needs "file" as a path and "line" as a line number.',
    ],
    [
      "a question without text",
      (data) => {
        data.questions.push({ id: "q2", options: [] });
      },
      "Every question needs an id and text.",
    ],
    [
      "a question with one option",
      (data) => {
        data.questions.push({ id: "q2", text: "Q?", options: [{ id: "a" }] });
      },
      "Question 'q2' needs at least two options.",
    ],
    [
      "a question option that is not an object",
      (data) => {
        data.questions.push({ id: "q2", text: "Q?", options: [null, null] });
      },
      'Question \'q2\' needs every option as { "id", "label" } with a unique id.',
    ],
    [
      "a question option id used twice",
      (data) => {
        data.questions.push({
          id: "q2",
          text: "Q?",
          options: [
            { id: "a", label: "A" },
            { id: "a", label: "B" },
          ],
        });
      },
      'Question \'q2\' needs every option as { "id", "label" } with a unique id.',
    ],
    [
      "a question id used twice",
      (data) => {
        data.questions.push({ ...data.questions[0] });
      },
      "The question id 'search-doc' is used twice.",
    ],
    [
      "ship that is not an object",
      (data) => {
        (data as unknown as Record<string, unknown>).ship = "pr";
      },
      '"ship" must be an object.',
    ],
    [
      "ship with one option",
      (data) => {
        (data as unknown as Record<string, unknown>).ship = {
          default: "pr",
          options: [{ id: "pr", label: "PR" }],
        };
      },
      '"ship" needs at least two options.',
    ],
    [
      "ship without a matching default",
      (data) => {
        (data as unknown as Record<string, unknown>).ship = {
          default: "merge",
          options: [
            { id: "pr", label: "PR" },
            { id: "local", label: "Local" },
          ],
        };
      },
      '"ship.default" must be the id of one of its options, got "merge".',
    ],
    [
      "next that is not a list",
      (data) => {
        (data as unknown as Record<string, unknown>).next = {};
      },
      '"next" must be a list of objects.',
    ],
    [
      "a next item without a title",
      (data) => {
        (data as unknown as Record<string, unknown>).next = [{ id: "bake" }];
      },
      "Every next item needs an id and a title.",
    ],
    [
      "a next item id used twice",
      (data) => {
        (data as unknown as Record<string, unknown>).next = [
          { id: "bake", title: "Bake" },
          { id: "bake", title: "Bake again" },
        ];
      },
      "The next item id 'bake' is used twice.",
    ],
    [
      "evidence that links to a script",
      (data) => {
        changeIn(data.changes, "framing").evidence = [
          { text: "T", url: "javascript:alert(1)" },
        ];
      },
      'Change \'framing\' has evidence with "url" "javascript:alert(1)". Use an http or https URL.',
    ],
    [
      "a status without a state",
      (data) => {
        data.run.status = { summary: "Done." };
      },
      'run.status needs a "state", for example "applied".',
    ],
    [
      "status decisions that are not an object",
      (data) => {
        data.run.status = { state: "applied", decisions: [] };
      },
      "run.status.decisions must be an object.",
    ],
    [
      "a status link that is not a web URL",
      (data) => {
        data.run.status = { state: "applied", link: "javascript:alert(1)" };
      },
      'run.status.link must be an http or https URL, got "javascript:alert(1)".',
    ],
    [
      "a kept item of an unlisted file",
      (data) => {
        data.kept.push({ file: "README.md", lines: [1, 1], title: "Intro" });
      },
      'Kept item "Intro" names "README.md", which is missing from "files".',
    ],
    [
      "a kept item without lines",
      (data) => {
        data.kept.push({ file: "CLAUDE.md", title: "Intro" });
      },
      'Kept item "Intro" needs "lines" as [first, last].',
    ],
    [
      "an unknown skill",
      (data) => {
        data.run.skill = "prune";
      },
      'run.skill must be one of audit, bake, feed or split, got "prune".',
    ],
    [
      "a run without an outcome",
      (data) => {
        delete data.run.outcome;
      },
      "run.outcome is required.",
    ],
    [
      "an unknown editor",
      (data) => {
        data.run.editor = "vim";
      },
      'run.editor must be one of zed, vscode, cursor or phpstorm, or null, got "vim".',
    ],
    [
      "a round that is not a count",
      (data) => {
        data.run.round = 0;
      },
      "run.round and run.rounds must be whole numbers from 1, got 0 and 2.",
    ],
    [
      "a run without a root",
      (data) => {
        delete data.run.root;
      },
      "run.root is required: the repository the changes edit.",
    ],
    [
      "a root that is not a directory",
      (data) => {
        data.run.root = "data.json";
      },
      'run.root must be the repository directory, got "data.json"',
    ],
  ];

  test.each(cases)("%s", async (_, mutate, message) => {
    const data = await exampleData();
    mutate(data);

    await expectDataError(data, message);
  });

  test("data that is not an object", async () => {
    await expectDataError([], "The data file must hold a JSON object.");
  });

  test("a run that is not an object", async () => {
    await expectDataError({ run: "audit" }, '"run" must be an object.');
  });
});

describe("estimateTokens", () => {
  test("counts four characters per token, with a floor of one", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("a")).toBe(1);
    expect(estimateTokens("a".repeat(10))).toBe(3);
  });

  test("counts characters, not UTF-16 units", () => {
    expect(estimateTokens("😀😀😀😀")).toBe(1);
  });
});

describe("editorLink", () => {
  test("encodes the path for each editor", () => {
    expect(editorLink("zed", "/tmp/a b/C#.md", 3)).toBe(
      "zed://file/tmp/a%20b/C%23.md:3",
    );
    expect(editorLink("cursor", "/tmp/it's (1)!.md")).toBe(
      "cursor://file/tmp/it%27s%20%281%29%21.md:1",
    );
    expect(editorLink("phpstorm", "/tmp/a&b.md", 2)).toBe(
      "phpstorm://open?file=%2Ftmp%2Fa%26b.md&line=2",
    );
    expect(editorLink(null, "/tmp/a.md")).toBeNull();
  });
});

describe("render", () => {
  test("embeds the data and the escaped title", async () => {
    const data = await exampleData();
    data.run.title = "Audit <script> & $&";
    changeIn(data.changes, "livewire").why = "Ends a script tag: </script> $'";

    const html = await render(await buildExample(data));

    expect(
      html.startsWith("<title>Audit &lt;script&gt; &amp; $&amp;</title>"),
    ).toBe(true);
    expect(html).not.toContain(DATA_PLACEHOLDER);
    expect(html).not.toContain("Ends a script tag: </script>");
    expect(html).toContain("Ends a script tag: <\\/script> $'");
  });
});

/**
 * Runs the rendered page in a DOM and collects uncaught errors.
 * The template is this repository's own code, so evaluating it is safe.
 */
async function openPage(page: Page) {
  const window = new Window({
    settings: {
      enableJavaScriptEvaluation: true,
      suppressInsecureJavaScriptEnvironmentWarning: true,
    },
  });
  const errors: unknown[] = [];
  window.addEventListener("error", (event) => {
    errors.push((event as unknown as { error: unknown }).error);
  });

  window.document.write(await render(page));
  await window.happyDOM.waitUntilComplete();

  return { window, document: window.document, errors };
}

describe("page", () => {
  test("renders the example without errors", async () => {
    const { window, document, errors } = await openPage(
      await buildExample(await exampleData()),
    );

    expect(errors).toEqual([]);
    expect(document.title).toBe("Acme Books CLAUDE.md Audit");
    expect(document.querySelectorAll(".card").length).toBeGreaterThan(0);
    await window.happyDOM.close();
  });

  test("renders record mode without errors", async () => {
    const data = await exampleData();
    data.run.status = {
      state: "applied",
      link: "https://github.com/acme/books/pull/42",
      decisions: {
        d: { livewire: "apply", framing: "skip" },
        q: { "search-doc": "delete" },
        custom: { livewire: "- A redrafted line." },
        next: { "bake-money": false },
        ship: "pr",
      },
    };
    const { window, document, errors } = await openPage(
      await buildExample(data),
    );

    expect(errors).toEqual([]);
    expect(document.body.classList.contains("record")).toBe(true);
    expect(document.querySelector(".status-banner")?.textContent).toContain(
      "Applied",
    );
    await window.happyDOM.close();
  });

  test("reports a page that throws", async () => {
    const page = await buildExample(await exampleData());
    const { window, errors } = await openPage({ ...page, next: [null] });

    expect(errors).not.toEqual([]);
    await window.happyDOM.close();
  });
});

describe("summary", () => {
  test("counts lanes, questions and resident tokens", async () => {
    const page = await buildExample(await exampleData());

    expect(summary(page)).toBe(
      "9 changes: 4 calls, 4 ready, 1 auto; 1 question; resident est. 361 tokens before",
    );
  });

  test("pluralizes questions", async () => {
    const data = await exampleData();
    data.questions = [];

    expect(summary(await buildExample(data))).toContain("; 0 questions;");
  });
});

describe("command line", () => {
  afterEach(() => {
    spyOn(console, "log").mockRestore();
    spyOn(console, "error").mockRestore();
  });

  test("runs as an executable", async () => {
    const process = Bun.spawn(
      ["bun", BUILD_SCRIPT, join(EXAMPLE, "data.json"), "--check"],
      { stdout: "pipe", stderr: "pipe" },
    );

    expect(await process.exited).toBe(0);
    expect(await new Response(process.stdout).text()).toStartWith("9 changes:");
  });

  test("--check validates and writes nothing", async () => {
    await withExampleCopy(async (directory) => {
      const result = await runCli(join(directory, "data.json"), "--check");

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toStartWith("9 changes:");
      expect(await Bun.file(join(directory, "data.html")).exists()).toBe(false);
    });
  });

  test("writes the page next to the data file by default", async () => {
    await withExampleCopy(async (directory) => {
      const result = await runCli(join(directory, "data.json"));

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toStartWith(
        `Wrote ${join(directory, "data.html")}`,
      );
      expect(await Bun.file(join(directory, "data.html")).text()).toStartWith(
        "<title>Acme Books CLAUDE.md Audit</title>",
      );
    });
  });

  test("-o writes the page where it says", async () => {
    await withExampleCopy(async (directory) => {
      const output = join(directory, "page.html");
      const result = await runCli(join(directory, "data.json"), "-o", output);

      expect(result.exitCode).toBe(0);
      expect(await Bun.file(output).exists()).toBe(true);
    });
  });

  test("reports invalid data on stderr with exit code 1", async () => {
    await withExampleCopy(async (directory) => {
      const data = await exampleData();
      data.run.skill = "prune";
      await Bun.write(join(directory, "data.json"), JSON.stringify(data));

      const result = await runCli(join(directory, "data.json"));

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toStartWith("bonsai: run.skill must be one of");
    });
  });

  test("reports a missing data file", async () => {
    const result = await runCli(join(EXAMPLE, "missing.json"));

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toStartWith(
      "bonsai: Unable to find the data file at",
    );
  });

  test("reports a data file that is not JSON", async () => {
    await withExampleCopy(async (directory) => {
      await Bun.write(join(directory, "data.json"), "{");

      const result = await runCli(join(directory, "data.json"));

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("is not valid JSON");
    });
  });

  test("lets unexpected failures surface", async () => {
    await withExampleCopy(async (directory) => {
      await chmod(join(directory, "repo", "CLAUDE.md"), 0o000);

      expect(main([join(directory, "data.json")])).rejects.toThrow(
        /permission denied/i,
      );
    });
  });

  test("resolves a relative root next to the real data file", async () => {
    await withExampleCopy(async (directory) => {
      const elsewhere = await mkdtemp(join(tmpdir(), "bonsai-link-"));

      try {
        await symlink(
          join(directory, "data.json"),
          join(elsewhere, "data.json"),
        );

        const result = await runCli(join(elsewhere, "data.json"), "--check");

        expect(result.exitCode).toBe(0);
      } finally {
        await rm(elsewhere, { recursive: true, force: true });
      }
    });
  });

  test("resolves a data file path through .. after a symlink", async () => {
    await withExampleCopy(async (directory) => {
      await mkdir(join(directory, "nested"));
      await symlink(join(directory, "nested"), join(directory, "repo", "link"));

      // String concatenation, since join() would drop the `..` itself.
      const result = await runCli(
        `${join(directory, "repo", "link")}/../data.json`,
        "--check",
      );

      expect(result.exitCode).toBe(0);
    });
  });

  test("prints help", async () => {
    const result = await runCli("--help");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toStartWith("Usage: bun build.ts");
  });

  test("rejects a missing data file argument", async () => {
    const result = await runCli();

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toStartWith("bonsai: Pass exactly one data file.");
  });

  test("rejects an unknown option", async () => {
    const result = await runCli("data.json", "--force");

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Usage: bun build.ts");
  });
});
