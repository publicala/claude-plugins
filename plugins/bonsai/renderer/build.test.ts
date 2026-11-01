import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { chmod, cp, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type HTMLButtonElement,
  type HTMLElement,
  type HTMLInputElement,
  type HTMLTextAreaElement,
  Window,
} from "happy-dom";

import {
  DATA_PLACEHOLDER,
  DataError,
  build,
  editorLink,
  estimateTokens,
  main,
  type Page,
  render,
  SCRIPT_PLACEHOLDER,
  summary,
  TOKENS_PLACEHOLDER,
} from "./build";
import { bundlePageScript } from "./page-script";

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

function exampleData(): Promise<Fixture> {
  return Bun.file(join(EXAMPLE, "data.json")).json();
}

interface GuardCandidate {
  id: string;
  lane?: string;
  title?: string;
  recommendation?: unknown;
  caught: { count?: unknown; quotes: Record<string, unknown>[] };
  mistake: Record<string, unknown>;
  guardrail: Record<string, unknown>;
  cost: unknown;
  skip?: string;
  alternative?: unknown;
  edits?: unknown;
}

interface GuardFixture {
  run: Record<string, unknown>;
  files: Record<string, unknown>[];
  changes: GuardCandidate[];
  notNow: Record<string, unknown>[];
  none: Record<string, unknown>[];
  questions?: Record<string, unknown>[];
}

const TOTAL = "order-total-summed-by-hand";
const STATUS = "status-as-string";
const NOW = "now-helper";
const USERS = "user-created-over-deleted";
const PAYMENTS = "payments-graphql-by-hand";
const MONEY = "money-by-hand";
const RUNG_LIST =
  "1 Unwritable, 2 Auto-fix, 3 Static analysis, 4 Arch or guard test, 5 ast-grep, 6 Git hook, 7 Runtime guard, 8 CLAUDE.md line";

function guardData(): Promise<GuardFixture> {
  return Bun.file(join(EXAMPLE, "guard-data.json")).json();
}

function firstQuote(candidate: GuardCandidate): Record<string, unknown> {
  const [quoted] = candidate.caught.quotes;

  if (quoted === undefined) {
    throw new Error(`Candidate '${candidate.id}' quotes no review.`);
  }

  return quoted;
}

function firstNotNow(data: GuardFixture): Record<string, unknown> {
  const [item] = data.notNow;

  if (item === undefined) {
    throw new Error("The guard example has nothing not now.");
  }

  return item;
}

/**
 * A guard run whose only CLAUDE.md line is gone, so it edits no file.
 */
function withoutProse(data: GuardFixture): GuardFixture {
  data.changes = data.changes.filter((change) => change.id !== USERS);
  data.files = [];

  return data;
}

/** Writes a value the fixture's type rules out, for a case the build must refuse. */
function setField(target: object, key: string, value: unknown): void {
  Reflect.set(target, key, value);
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

function expectDataError(data: unknown, message: string): void {
  const failure = build(data, EXAMPLE);

  expect(failure).rejects.toBeInstanceOf(DataError);
  expect(failure).rejects.toThrow(message);
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
    const page = await build(await exampleData(), EXAMPLE);

    expect(page.changes).toHaveLength(9);
    expect(page.files.map((file) => file.path)).toEqual([
      "CLAUDE.md",
      "tests/CLAUDE.md",
    ]);
    expect(page.run.round).toBe(1);
    expect(page.run.rounds).toBe(2);
  });

  test("quotes the removed lines from disk", async () => {
    const page = await build(await exampleData(), EXAMPLE);
    const source = (await Bun.file(join(EXAMPLE, "repo", "CLAUDE.md")).text())
      .split("\n")
      .slice(4, 8);

    expect(changeIn(page.changes, "stack").edits[0]?.before).toEqual(
      source.map((text, index) => ({ n: 5 + index, text })),
    );
  });

  test("inserts at the end of a new file", async () => {
    const testing = changeIn(
      (await build(await exampleData(), EXAMPLE)).changes,
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

    const imports = changeIn((await build(data, EXAMPLE)).changes, "imports");

    expect(imports.edits[0]?.at).toBe(35);
    expect(imports.edits[0]?.href).toMatch(/CLAUDE\.md:34$/);
  });

  test("defaults the optional run fields", async () => {
    const data = await exampleData();
    delete data.run.round;
    delete data.run.rounds;
    delete data.run.waiting;
    delete data.run.editor;

    const page = await build(data, EXAMPLE);

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

    expect((await build(data, EXAMPLE)).run.status).toEqual(data.run.status);
  });

  test("never reports fewer rounds than the current one", async () => {
    const data = await exampleData();
    data.run.round = 3;

    expect((await build(data, EXAMPLE)).run.rounds).toBe(3);
  });

  test("previews only the changed regions of a long file", async () => {
    await withExampleCopy(async (directory) => {
      await Bun.write(
        join(directory, "repo", "CLAUDE.md"),
        Array.from({ length: 401 }, (_, index) => `line ${index + 1}`).join(
          "\n",
        ),
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
    const page = await build(data, EXAMPLE);
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

    const framing = changeIn((await build(data, EXAMPLE)).changes, "framing");

    expect(framing.evidence).toEqual([
      { text: "A thread.", href: "https://example.com/thread" },
      { text: "No link.", href: null },
    ]);
  });

  test("resolves a relative root against the data file's directory", async () => {
    const page = await build(await exampleData(), EXAMPLE);

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

    const framing = changeIn((await build(data, EXAMPLE)).changes, "framing");

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
      'Every change needs an id, got "constructor". An id uses letters, digits',
    ],
    [
      "a change id with a quote",
      (data) => {
        changeIn(data.changes, "livewire").id = 'fix"quote';
      },
      'Every change needs an id, got "fix\\"quote".',
    ],
    [
      "a group id with a space",
      (data) => {
        data.groups.push({ id: "two words", lane: "ready", title: "T" });
      },
      'Every group needs an id, got "two words".',
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
        setField(data, "files", "CLAUDE.md");
      },
      'The data needs "files" as a list of objects.',
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
            id: `g${index}`,
            lane: "ready",
            title: "Group",
          });
          data.changes.push({
            id: `c${index}`,
            lane: "ready",
            group: `g${index}`,
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
      "The id 'covered' appears twice in \"groups\".",
    ],
    [
      "a group in lane call",
      (data) => {
        data.groups.push({ id: "calls", lane: "call", title: "Calls" });
      },
      "Group 'calls' needs lane ready or auto.",
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
      "The id 'stack' appears twice in \"changes\".",
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
      "edits that are not objects",
      (data) => {
        setField(changeIn(data.changes, "stack"), "edits", ["CLAUDE.md"]);
      },
      "Change 'stack' needs \"edits\" as a list of objects.",
    ],
    [
      "evidence that is not a list",
      (data) => {
        setField(changeIn(data.changes, "stack"), "evidence", "composer.json");
      },
      "Change 'stack' needs \"evidence\" as a list of objects.",
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
      "Change 'stack' needs \"text\" in every evidence item.",
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
      'Question \'q2\' needs every option as { "id", "label" }.',
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
      "The id 'a' appears twice in the options of question 'q2'.",
    ],
    [
      "a question id used twice",
      (data) => {
        data.questions.push({ ...data.questions[0] });
      },
      "The id 'search-doc' appears twice in \"questions\".",
    ],
    [
      "ship that is not an object",
      (data) => {
        setField(data, "ship", "pr");
      },
      '"ship" must be an object.',
    ],
    [
      "ship with one option",
      (data) => {
        setField(data, "ship", {
          default: "pr",
          options: [{ id: "pr", label: "PR" }],
        });
      },
      '"ship" needs at least two options.',
    ],
    [
      "ship without a matching default",
      (data) => {
        setField(data, "ship", {
          default: "merge",
          options: [
            { id: "pr", label: "PR" },
            { id: "local", label: "Local" },
          ],
        });
      },
      '"ship.default" must be the id of one of its options, got "merge".',
    ],
    [
      "a ship option id used twice",
      (data) => {
        setField(data, "ship", {
          default: "pr",
          options: [
            { id: "pr", label: "PR" },
            { id: "pr", label: "Local" },
          ],
        });
      },
      "The id 'pr' appears twice in \"ship.options\".",
    ],
    [
      "next that is not a list",
      (data) => {
        setField(data, "next", {});
      },
      'The data needs "next" as a list of objects.',
    ],
    [
      "a next item without a title",
      (data) => {
        setField(data, "next", [{ id: "bake" }]);
      },
      "Every next item needs an id and a title.",
    ],
    [
      "a next item id used twice",
      (data) => {
        setField(data, "next", [
          { id: "bake", title: "Bake" },
          { id: "bake", title: "Bake again" },
        ]);
      },
      "The id 'bake' appears twice in \"next\".",
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
      'Kept item "Intro" needs "lines" in CLAUDE.md as [first, last].',
    ],
    [
      "a kept item outside the file",
      (data) => {
        data.kept.push({ file: "CLAUDE.md", lines: [30, 99], title: "Intro" });
      },
      'Kept item "Intro" keeps CLAUDE.md lines 30-99, but the file has 34 lines.',
    ],
    [
      "an unknown skill",
      (data) => {
        data.run.skill = "prune";
      },
      'run.skill must be one of audit, bake, feed, guard or split, got "prune".',
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
      "a negative waiting count",
      (data) => {
        data.run.waiting = -1;
      },
      "run.waiting must be a whole number from 0, got -1.",
    ],
    [
      "a waiting count that is text",
      (data) => {
        data.run.waiting = "3";
      },
      'run.waiting must be a whole number from 0, got "3".',
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
    [
      "a not-now list outside a guard run",
      (data) => {
        setField(data, "notNow", []);
      },
      '"notNow" belongs to a guard run. Remove it, or set run.skill to "guard".',
    ],
    [
      "a no-guardrail list outside a guard run",
      (data) => {
        setField(data, "none", []);
      },
      '"none" belongs to a guard run.',
    ],
    [
      "a guardrail on a change outside a guard run",
      (data) => {
        setField(changeIn(data.changes, "livewire"), "guardrail", { rung: 3 });
      },
      "Change 'livewire' has \"guardrail\", which only a guard run shows.",
    ],
    [
      "a PR shape outside a guard run",
      (data) => {
        data.run.prs = "Each one its own PR.";
      },
      "run.prs belongs to a guard run.",
    ],
    [
      "PR links per change outside a guard run",
      (data) => {
        data.run.status = {
          state: "applied",
          prs: { livewire: "https://github.com/acme/books/pull/42" },
        };
      },
      "run.status.prs belongs to a guard run. Put the one link in run.status.link.",
    ],
  ];

  test.each(cases)("%s", async (_, mutate, message) => {
    const data = await exampleData();
    mutate(data);

    expectDataError(data, message);
  });

  test("data that is not an object", () => {
    expectDataError([], "The data file must hold a JSON object.");
  });

  test("a run that is not an object", () => {
    expectDataError({ run: "audit" }, '"run" must be an object.');
  });
});

describe("guard build", () => {
  test("builds the guard example", async () => {
    const page = await build(await guardData(), EXAMPLE);
    const total = changeIn(page.changes, TOTAL);

    expect(page.run.skill).toBe("guard");
    expect(page.changes.map((change) => change.lane)).toEqual(
      Array.from({ length: 5 }, () => "call"),
    );
    expect(total.guardrail).toEqual({
      rung: 3,
      name: "Static analysis",
      tool: "PHPStan custom rule",
      where: [
        "app/PHPStan/OrderTotalRule.php",
        "tests/PHPStan/OrderTotalRuleTest.php",
        "phpstan.neon",
      ],
      message:
        "Order totals come from Order::total(), which applies discounts and VAT.\nReplace this sum over $order->lines with $order->total().",
    });
    expect(total.caught).toMatchObject({ count: 3 });
    expect(page.notNow.map((item) => item.id)).toEqual([
      MONEY,
      "import-queue-unnamed",
    ]);
    expect(page.none).toHaveLength(5);
    expect(page.files.map((file) => file.path)).toEqual([
      "app/Users/CLAUDE.md",
    ]);
  });

  test("fills what a candidate leaves out", async () => {
    const page = await build(await guardData(), EXAMPLE);

    expect(changeIn(page.changes, NOW).caught).toMatchObject({ count: 1 });
    expect(changeIn(page.changes, NOW).guardrail).toMatchObject({
      name: "Auto-fix",
      message: null,
    });
    expect(changeIn(page.changes, USERS).guardrail).toEqual({
      rung: 8,
      name: "CLAUDE.md line",
      tool: null,
      where: [],
      message: null,
    });
    expect(changeIn(page.changes, PAYMENTS).mistake).toMatchObject({
      note: null,
    });
    expect(page.notNow[0]?.threads).toEqual([
      "https://github.com/acme/books/pull/57#discussion_r2011803",
    ]);
  });

  test("quotes the line a CLAUDE.md candidate writes", async () => {
    const users = changeIn(
      (await build(await guardData(), EXAMPLE)).changes,
      USERS,
    );

    expect(users.edits).toHaveLength(1);
    expect(users.edits[0]).toMatchObject({
      file: "app/Users/CLAUDE.md",
      at: 1,
      before: [],
    });
  });

  test("lets an auto-fix print a message", async () => {
    const data = await guardData();
    changeIn(data.changes, NOW).guardrail.message = "Rector rewrote 1 file.";

    expect(
      changeIn((await build(data, EXAMPLE)).changes, NOW).guardrail,
    ).toMatchObject({ message: "Rector rewrote 1 file." });
  });

  test("builds a guard run that edits no file", async () => {
    const page = await build(withoutProse(await guardData()), EXAMPLE);

    expect(page.files).toEqual([]);
    expect(page.changes).toHaveLength(4);
  });

  test("builds a guard run where everything is not now", async () => {
    const data = withoutProse(await guardData());
    data.changes = [];

    expect((await build(data, EXAMPLE)).notNow).toHaveLength(2);
  });

  test("accepts a guard record with a PR per candidate", async () => {
    const data = await guardData();
    data.run.status = {
      state: "built",
      date: "2026-10-22",
      summary: "4 guardrails built, 1 skipped.",
      prs: {
        [TOTAL]: "https://github.com/acme/books/pull/64",
        [MONEY]: "https://github.com/acme/books/pull/65",
      },
      decisions: {
        d: { [TOTAL]: "apply", [PAYMENTS]: "skip", [STATUS]: "later" },
        note: { [PAYMENTS]: "Fold it into the arch suite." },
        pull: { [MONEY]: true, "import-queue-unnamed": false },
      },
    };

    expect((await build(data, EXAMPLE)).run.status).toEqual(data.run.status);
  });
});

describe("guard build refuses data that would mislead", () => {
  const cases: [string, (data: GuardFixture) => void, string][] = [
    [
      "a candidate without a title",
      (data) => {
        delete changeIn(data.changes, TOTAL).title;
      },
      `Candidate '${TOTAL}' needs a title: the rule in plain words.`,
    ],
    [
      "a check without its failure message",
      (data) => {
        delete changeIn(data.changes, TOTAL).guardrail.message;
      },
      `Candidate '${TOTAL}' needs "guardrail.message": the exact text the check prints when it fails.`,
    ],
    [
      "a type that refuses the wrong form without its error",
      (data) => {
        delete changeIn(data.changes, STATUS).guardrail.message;
      },
      `Candidate '${STATUS}' needs "guardrail.message"`,
    ],
    [
      "a CLAUDE.md line with a failure message",
      (data) => {
        changeIn(data.changes, USERS).guardrail.message = "Fails.";
      },
      `Candidate '${USERS}' is a CLAUDE.md line (rung 8), so it prints no "guardrail.message".`,
    ],
    [
      "a rung above the ladder",
      (data) => {
        changeIn(data.changes, TOTAL).guardrail.rung = 9;
      },
      `Candidate '${TOTAL}' has rung 9. Use a whole number from 1 to 8: ${RUNG_LIST}.`,
    ],
    [
      "a rung of zero",
      (data) => {
        changeIn(data.changes, TOTAL).guardrail.rung = 0;
      },
      `Candidate '${TOTAL}' has rung 0.`,
    ],
    [
      "a rung as text",
      (data) => {
        changeIn(data.changes, TOTAL).guardrail.rung = "3";
      },
      `Candidate '${TOTAL}' has rung "3".`,
    ],
    [
      "a guardrail that is not an object",
      (data) => {
        setField(changeIn(data.changes, TOTAL), "guardrail", "PHPStan");
      },
      `Candidate '${TOTAL}' needs "guardrail": { "rung", "tool", "where", "message" }.`,
    ],
    [
      "a check without its tool",
      (data) => {
        delete changeIn(data.changes, TOTAL).guardrail.tool;
      },
      `Candidate '${TOTAL}' needs "guardrail.tool": the tool that runs the check.`,
    ],
    [
      "a check that lives nowhere",
      (data) => {
        changeIn(data.changes, TOTAL).guardrail.where = [];
      },
      `Candidate '${TOTAL}' needs "guardrail.where": the files the check lives in.`,
    ],
    [
      "a check home that is not a list",
      (data) => {
        changeIn(data.changes, TOTAL).guardrail.where = "phpstan.neon";
      },
      `Candidate '${TOTAL}' needs "guardrail.tool" and "guardrail.message" as text, and "guardrail.where" as a list of paths.`,
    ],
    [
      "a quote that links to a script",
      (data) => {
        firstQuote(changeIn(data.changes, TOTAL)).url = "javascript:alert(1)";
      },
      `Candidate '${TOTAL}' has a quote with "url" "javascript:alert(1)". Use the http or https link to the thread.`,
    ],
    [
      "a quote without a link",
      (data) => {
        delete firstQuote(changeIn(data.changes, TOTAL)).url;
      },
      `Candidate '${TOTAL}' has a quote with "url" nothing.`,
    ],
    [
      "a quote longer than an excerpt",
      (data) => {
        firstQuote(changeIn(data.changes, TOTAL)).text = "a".repeat(301);
      },
      `Candidate '${TOTAL}' quotes 301 characters from simplify. Cut the quote to the sentences that name the mistake, 300 characters at most.`,
    ],
    [
      "a quote without a reviewer",
      (data) => {
        delete firstQuote(changeIn(data.changes, TOTAL)).reviewer;
      },
      `Candidate '${TOTAL}' needs "reviewer" and "text" in every quote.`,
    ],
    [
      "more than four quotes",
      (data) => {
        const total = changeIn(data.changes, TOTAL);
        total.caught.quotes.push(firstQuote(total), firstQuote(total));
      },
      `Candidate '${TOTAL}' needs 1 to 4 quotes in "caught.quotes", got 5.`,
    ],
    [
      "no quotes",
      (data) => {
        changeIn(data.changes, TOTAL).caught.quotes = [];
      },
      `Candidate '${TOTAL}' needs 1 to 4 quotes in "caught.quotes", got 0.`,
    ],
    [
      "a count below the quotes shown",
      (data) => {
        changeIn(data.changes, TOTAL).caught.count = 2;
      },
      `Candidate '${TOTAL}' has "caught.count" 2. Count every thread that raised it, at least the 3 quoted.`,
    ],
    [
      "caught that is not an object",
      (data) => {
        setField(changeIn(data.changes, TOTAL), "caught", []);
      },
      `Candidate '${TOTAL}' needs "caught": the review quotes that flagged the mistake.`,
    ],
    [
      "an unknown recommendation",
      (data) => {
        changeIn(data.changes, TOTAL).recommendation = "maybe";
      },
      `Candidate '${TOTAL}' has recommendation "maybe". Use recommended, close call or low value.`,
    ],
    [
      "a candidate without a recommendation",
      (data) => {
        delete changeIn(data.changes, TOTAL).recommendation;
      },
      `Candidate '${TOTAL}' has recommendation nothing.`,
    ],
    [
      "a mistake without the code to write instead",
      (data) => {
        delete changeIn(data.changes, TOTAL).mistake.right;
      },
      `Candidate '${TOTAL}' needs "mistake" with the "wrong" code and the "right" code to write instead.`,
    ],
    [
      "a mistake whose language is not text",
      (data) => {
        changeIn(data.changes, TOTAL).mistake.lang = 3;
      },
      `Candidate '${TOTAL}' needs "mistake.lang" and "mistake.note" as text, or left out.`,
    ],
    [
      "a candidate without a cost",
      (data) => {
        changeIn(data.changes, TOTAL).cost = [];
      },
      `Candidate '${TOTAL}' needs "cost": the rows of its cost line, as { "label", "value" }.`,
    ],
    [
      "a cost row that is not text",
      (data) => {
        changeIn(data.changes, TOTAL).cost = [
          { label: "Violations", value: 4 },
        ];
      },
      `Candidate '${TOTAL}' needs "label" and "value" as text in every cost row.`,
    ],
    [
      "a candidate without skip",
      (data) => {
        delete changeIn(data.changes, TOTAL).skip;
      },
      `Candidate '${TOTAL}' is a call, so it needs "skip": what goes wrong if the user skips it.`,
    ],
    [
      "an alternative that is not text",
      (data) => {
        changeIn(data.changes, TOTAL).alternative = ["arch test"];
      },
      `Candidate '${TOTAL}' needs "alternative" as text, or left out.`,
    ],
    [
      "a check that adds a CLAUDE.md line",
      (data) => {
        changeIn(data.changes, TOTAL).edits = [
          { file: "app/Users/CLAUDE.md", at: "end", write: ["- Use total()."] },
        ];
      },
      `Candidate '${TOTAL}' is a check (rung 3), so it carries no "edits".`,
    ],
    [
      "a CLAUDE.md line without its edit",
      (data) => {
        delete changeIn(data.changes, USERS).edits;
      },
      `Candidate '${USERS}' is a CLAUDE.md line (rung 8), so it needs "edits" with the line it writes.`,
    ],
    [
      "a CLAUDE.md line in an unlisted file",
      (data) => {
        changeIn(data.changes, USERS).edits = [
          { file: "docs/users.md", at: "end", write: ["- x"] },
        ];
      },
      `Candidate '${USERS}' edits "docs/users.md", which is missing from "files".`,
    ],
    [
      "a candidate outside lane call",
      (data) => {
        changeIn(data.changes, TOTAL).lane = "ready";
      },
      `Candidate '${TOTAL}' needs lane call: a guard run builds only what the user approves.`,
    ],
    [
      "more than five candidates",
      (data) => {
        data.changes.push({ ...changeIn(data.changes, NOW), id: "extra" });
      },
      "This round holds 6 calls (questions included), but a round holds at most 5.",
    ],
    [
      "five candidates and a question",
      (data) => {
        data.questions = [
          {
            id: "enum-or-table",
            text: "Should status be an enum or a lookup table?",
            options: [
              { id: "enum", label: "Enum" },
              { id: "table", label: "Table" },
            ],
          },
        ];
      },
      "This round holds 6 calls (questions included), but a round holds at most 5.",
    ],
    [
      "a candidate id that shadows a built-in",
      (data) => {
        changeIn(data.changes, TOTAL).id = "constructor";
      },
      'Every candidate needs an id, got "constructor". An id uses letters, digits',
    ],
    [
      "a candidate id with a space",
      (data) => {
        changeIn(data.changes, TOTAL).id = "order total";
      },
      'Every candidate needs an id, got "order total".',
    ],
    [
      "a candidate id used twice",
      (data) => {
        changeIn(data.changes, NOW).id = TOTAL;
      },
      `The id '${TOTAL}' appears twice in "changes".`,
    ],
    [
      "a not-now id used twice",
      (data) => {
        data.notNow.push({ ...firstNotNow(data) });
      },
      `The id '${MONEY}' appears twice in "notNow".`,
    ],
    [
      "a not-now id that is also a card",
      (data) => {
        firstNotNow(data).id = TOTAL;
      },
      `The id '${TOTAL}' is in "changes" and in "notNow". A candidate is either a card or not now.`,
    ],
    [
      "a not-now id with a quote",
      (data) => {
        firstNotNow(data).id = 'money"quote';
      },
      "Every not-now candidate needs an id, a title and a why: the reason the cost gate stopped it.",
    ],
    [
      "a not-now candidate without a why",
      (data) => {
        delete firstNotNow(data).why;
      },
      "Every not-now candidate needs an id, a title and a why",
    ],
    [
      "a not-now thread that links to a script",
      (data) => {
        firstNotNow(data).threads = ["javascript:alert(1)"];
      },
      `Not-now candidate '${MONEY}' needs "threads" as a list of http or https links.`,
    ],
    [
      "a no-guardrail row without a verdict",
      (data) => {
        delete data.none[0]?.verdict;
      },
      'Every "none" row needs a "finding" and a "verdict": the reason no guardrail fits.',
    ],
    [
      "a no-guardrail row that links to a script",
      (data) => {
        data.none.push({
          finding: "Typo",
          verdict: "Wording",
          url: "javascript:alert(1)",
        });
      },
      'The "none" row "Typo" has "url" "javascript:alert(1)". Use an http or https URL.',
    ],
    [
      "a ship choice in a guard run",
      (data) => {
        setField(data, "ship", {
          default: "pr",
          options: [
            { id: "pr", label: "PR" },
            { id: "local", label: "Local" },
          ],
        });
      },
      'A guard run ships every built candidate as its own PR, so it takes no "ship".',
    ],
    [
      "a PR shape that is not text",
      (data) => {
        data.run.prs = ["one PR each"];
      },
      'run.prs must be one sentence on how the built candidates land, got ["one PR each"].',
    ],
    [
      "a guard run with nothing to build",
      (data) => {
        withoutProse(data).changes = [];
        data.notNow = [];
      },
      "The data holds no candidates and nothing not now.",
    ],
    [
      "a PR link for an unknown candidate",
      (data) => {
        data.run.status = {
          state: "built",
          prs: { missing: "https://github.com/acme/books/pull/64" },
        };
      },
      "run.status.prs must map candidate and not-now ids to http or https links.",
    ],
    [
      "a PR link that is not a web URL",
      (data) => {
        data.run.status = {
          state: "built",
          prs: { [TOTAL]: "javascript:alert(1)" },
        };
      },
      "run.status.prs must map candidate and not-now ids to http or https links.",
    ],
    [
      "a PR link beside a candidate recorded as skipped",
      (data) => {
        data.run.status = {
          state: "built",
          prs: { [TOTAL]: "https://github.com/acme/books/pull/64" },
          decisions: { d: { [TOTAL]: "skip" } },
        };
      },
      `run.status.prs links "${TOTAL}", which the decisions do not build. Record "apply" for it in run.status.decisions.d, or true in run.status.decisions.pull for a not-now id.`,
    ],
    [
      "a PR link beside a candidate with no recorded decision",
      (data) => {
        data.run.status = {
          state: "built",
          prs: { [TOTAL]: "https://github.com/acme/books/pull/64" },
        };
      },
      `run.status.prs links "${TOTAL}", which the decisions do not build. Record "apply" for it in run.status.decisions.d, or true in run.status.decisions.pull for a not-now id.`,
    ],
    [
      "a PR link beside a not-now candidate left out",
      (data) => {
        data.run.status = {
          state: "built",
          prs: { [MONEY]: "https://github.com/acme/books/pull/65" },
          decisions: { pull: { [MONEY]: false } },
        };
      },
      `run.status.prs links "${MONEY}", which the decisions do not build. Record "apply" for it in run.status.decisions.d, or true in run.status.decisions.pull for a not-now id.`,
    ],
    [
      "a pull decision for an unknown not-now id",
      (data) => {
        data.run.status = {
          state: "built",
          decisions: { pull: { missing: true } },
        };
      },
      "run.status.decisions.pull must map not-now ids to true or false.",
    ],
    [
      "a pull decision that is not true or false",
      (data) => {
        data.run.status = {
          state: "built",
          decisions: { pull: { [MONEY]: "yes" } },
        };
      },
      "run.status.decisions.pull must map not-now ids to true or false.",
    ],
  ];

  test.each(cases)("%s", async (_, mutate, message) => {
    const data = await guardData();
    mutate(data);

    expectDataError(data, message);
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
  test("keeps quoted text from opening a comment inside the data script", async () => {
    const data = await exampleData();
    const quoted = "Quotes <!-- <script> from a template.";
    changeIn(data.changes, "livewire").why = quoted;
    const page = await build(data, EXAMPLE);
    const html = `${await render(page)}<p id="after"></p>`;

    let script = "";
    let parsesAfter = false;
    new HTMLRewriter()
      .on("script", {
        text(chunk) {
          script += chunk.text;
        },
      })
      .on("p#after", {
        element() {
          parsesAfter = true;
        },
      })
      .transform(html);
    const payload = /const D = (.+);$/m.exec(script)?.[1] ?? "null";

    expect(parsesAfter).toBe(true);
    expect(changeIn(page.changes, "livewire").why).toBe(quoted);
    expect(JSON.parse(payload)).toEqual(page);
  });

  test("carries Blueprint's tokens, light and dark, from the blueprint plugin", async () => {
    const html = await render(await build(await exampleData(), EXAMPLE));

    expect(html).not.toContain(TOKENS_PLACEHOLDER);
    expect(html).toContain(
      await Bun.file(join(HERE, "blueprint-tokens.css")).text(),
    );
  });

  test("embeds the data and the escaped title", async () => {
    const data = await exampleData();
    data.run.title = "Audit <script> & $&";
    changeIn(data.changes, "livewire").why = "Ends a script tag: </script> $'";

    const html = await render(await build(data, EXAMPLE));

    expect(
      html.startsWith("<title>Audit &lt;script&gt; &amp; $&amp;</title>"),
    ).toBe(true);
    expect(html).not.toContain(DATA_PLACEHOLDER);
    expect(html).not.toContain("Ends a script tag: </script>");
    expect(html).toContain("Ends a script tag: \\u003c/script> $'");
  });

  test("inlines the page script once, and keeps placeholders in the data as text", async () => {
    const data = await exampleData();
    const placeholders = `${SCRIPT_PLACEHOLDER} ${TOKENS_PLACEHOLDER}`;
    data.run.title = placeholders;
    changeIn(data.changes, "livewire").why = placeholders;

    const page = await build(data, EXAMPLE);
    const html = await render(page);

    expect(html.split("function renderSummary()")).toHaveLength(2);
    expect(html.startsWith(`<title>${placeholders}</title>`)).toBe(true);
    expect(html).toContain(`"why":"${placeholders}"`);

    const { window, errors } = await openPage(page);
    expect(errors).toEqual([]);
    expect(window.document.querySelectorAll(".card").length).toBeGreaterThan(0);
    await window.happyDOM.close();
  });
});

describe("bundlePageScript", () => {
  test("bundles the page modules into one script with no imports", async () => {
    const script = await bundlePageScript(join(HERE, "page", "main.ts"));

    expect(script).toContain("function renderSummary()");
    expect(script).toContain("function wdiff(");
    expect(script).not.toMatch(/^\s*(import|export)\b/m);
    expect(script).not.toContain(HERE);
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
    if ("error" in event) {
      errors.push(event.error);
    }
  });

  window.document.write(await render(page));
  await window.happyDOM.waitUntilComplete();

  return { window, document: window.document, errors };
}

describe("page", () => {
  test("renders the example without errors", async () => {
    const { window, document, errors } = await openPage(
      await build(await exampleData(), EXAMPLE),
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
      await build(data, EXAMPLE),
    );

    expect(errors).toEqual([]);
    expect(document.body.classList.contains("record")).toBe(true);
    expect(document.querySelector(".status-banner")?.textContent).toContain(
      "Applied",
    );
    await window.happyDOM.close();
  });

  test("reports a page that throws", async () => {
    const page = await build(await exampleData(), EXAMPLE);
    const { window, errors } = await openPage({ ...page, next: [null] });

    expect(errors).not.toEqual([]);
    await window.happyDOM.close();
  });
});

/**
 * Decides a candidate the way the user does, with its button.
 */
function press(
  document: Awaited<ReturnType<typeof openPage>>["document"],
  candidateId: string,
  decision: "apply" | "skip" | "later",
): void {
  document
    .querySelector<HTMLButtonElement>(
      `.choice button[data-id="${candidateId}"][data-v="${decision}"]`,
    )
    ?.click();
}

describe("guard page", () => {
  test("renders one card per candidate, with no preview", async () => {
    const { window, document, errors } = await openPage(
      await build(await guardData(), EXAMPLE),
    );
    const total = document.getElementById(`card-${TOTAL}`);

    expect(errors).toEqual([]);
    expect(document.querySelectorAll(".card.guard")).toHaveLength(5);
    expect(document.getElementById("preview")?.hasAttribute("hidden")).toBe(
      true,
    );
    expect(document.querySelector(".tabs")?.hasAttribute("hidden")).toBe(true);
    expect(document.querySelector(".meter")).toBeNull();
    expect(total?.querySelector(".badge")?.textContent).toBe("recommended");
    expect(total?.querySelectorAll(".quotes li")).toHaveLength(3);
    expect(total?.querySelector(".g-sec h4 span")?.textContent).toBe(
      "3 reviews flagged this",
    );
    expect(total?.querySelector(".code.msg")?.textContent).toContain(
      "Replace this sum over $order->lines with $order->total().",
    );
    expect(total?.querySelector(".choice")?.textContent).toContain("Build");
    expect(document.getElementById(`card-${NOW}`)?.textContent).toContain(
      "Rewrites the code on commit",
    );
    expect(
      document.querySelector(`#card-${USERS} [data-diff]`)?.textContent,
    ).toContain("look for a deleted one");
    expect(document.querySelectorAll("[data-pull]")).toHaveLength(2);
    expect(document.querySelectorAll(".none-list li")).toHaveLength(5);
    expect(document.querySelector(".ships")?.textContent).toContain(
      "labelled guardrail",
    );
    await window.happyDOM.close();
  });

  test("sends the decisions as a build message", async () => {
    const { window, document, errors } = await openPage(
      await build(await guardData(), EXAMPLE),
    );

    press(document, TOTAL, "apply");
    press(document, STATUS, "later");
    press(document, NOW, "apply");
    press(document, USERS, "apply");
    press(document, PAYMENTS, "skip");
    const note = document.querySelector<HTMLTextAreaElement>(
      `textarea[data-note="${PAYMENTS}"]`,
    );
    if (note !== null) {
      note.value = "Fold it into the arch suite.";
      note.dispatchEvent(new window.Event("input"));
    }
    document.querySelector<HTMLInputElement>(`[data-pull="${MONEY}"]`)?.click();

    expect(document.getElementById("go")?.textContent).toBe(
      "Build 4 guardrails",
    );
    document.querySelector<HTMLButtonElement>("#go")?.click();

    expect(errors).toEqual([]);
    expect(document.querySelector<HTMLTextAreaElement>("#export")?.value).toBe(
      [
        "Build the bonsai guard of acme/books#57, round 1, with these decisions:",
        `- ${TOTAL} (rung 3 Static analysis, PHPStan custom rule): build`,
        `- ${STATUS} (rung 1 Unwritable, Enum cast on Order::$status): later`,
        `- ${NOW} (rung 2 Auto-fix, Rector FuncCallToStaticCallRector): build`,
        `- ${USERS} (rung 8 CLAUDE.md line, app/Users/CLAUDE.md new file): build`,
        `- ${PAYMENTS} (rung 4 Arch or guard test, Pest guard test): skip | note: Fold it into the arch suite.`,
        `- not now ${MONEY}: build anyway`,
      ].join("\n"),
    );
    expect(document.querySelector(".answers")?.textContent).toContain(
      "Build 4",
    );
    await window.happyDOM.close();
  });

  test("builds the current card with b", async () => {
    const { window, document } = await openPage(
      await build(await guardData(), EXAMPLE),
    );
    const key = (name: string) => {
      document.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: name }),
      );
    };

    key("j");
    key("b");

    expect(
      document.querySelector<HTMLElement>(`#card-${TOTAL}`)?.dataset.state,
    ).toBe("apply");
    await window.happyDOM.close();
  });

  test("reviews the candidates one by one", async () => {
    const { window, document, errors } = await openPage(
      await build(await guardData(), EXAMPLE),
    );

    document.querySelector<HTMLButtonElement>("#start-focus")?.click();

    expect(errors).toEqual([]);
    expect(document.querySelector("#f-body .card.guard")?.id).toBe(
      `f-card-${TOTAL}`,
    );
    expect(document.getElementById("f-actions")?.textContent).toContain(
      "Build",
    );
    await window.happyDOM.close();
  });

  test("shows the token meter for a line in a resident file", async () => {
    const data = await guardData();
    data.files = [{ path: "CLAUDE.md", resident: true }];
    changeIn(data.changes, USERS).edits = [
      { file: "CLAUDE.md", at: 30, write: ["- Restore a deleted user first."] },
    ];
    const { window, document, errors } = await openPage(
      await build(data, EXAMPLE),
    );

    expect(errors).toEqual([]);
    expect(document.querySelector(".meter")).not.toBeNull();
    expect(document.getElementById("preview")?.hasAttribute("hidden")).toBe(
      true,
    );
    await window.happyDOM.close();
  });

  test("renders a guard record with a PR per candidate", async () => {
    const data = await guardData();
    data.run.status = {
      state: "built",
      prs: {
        [TOTAL]: "https://github.com/acme/books/pull/64",
        [MONEY]: "https://github.com/acme/books/pull/65",
      },
      decisions: { d: { [TOTAL]: "apply" }, pull: { [MONEY]: true } },
    };
    const { window, document, errors } = await openPage(
      await build(data, EXAMPLE),
    );
    const pull = document.querySelector<HTMLInputElement>(
      `[data-pull="${MONEY}"]`,
    );

    expect(errors).toEqual([]);
    expect(document.querySelector(".status-banner")?.textContent).toContain(
      "Built",
    );
    expect(
      document.querySelector(`#card-${TOTAL} a[href$="/pull/64"]`)?.textContent,
    ).toBe("https://github.com/acme/books/pull/64");
    expect(
      document.querySelector('#h-notnow a[href$="/pull/65"]'),
    ).not.toBeNull();
    expect(pull?.checked).toBe(true);
    expect(pull?.disabled).toBe(true);
    await window.happyDOM.close();
  });
});

describe("summary", () => {
  test("counts lanes, questions and resident tokens", async () => {
    const page = await build(await exampleData(), EXAMPLE);

    expect(summary(page)).toBe(
      "9 changes: 4 calls, 4 ready, 1 auto; 1 question; resident est. 361 tokens before",
    );
  });

  test("counts guard candidates by recommendation", async () => {
    const page = await build(await guardData(), EXAMPLE);

    expect(summary(page)).toBe(
      "5 candidates: 2 recommended, 2 close calls, 1 low value; 2 not now; 5 with no guardrail; 0 questions",
    );
  });

  test("counts resident tokens when a guard line edits a resident file", async () => {
    const data = await guardData();
    data.files = [{ path: "CLAUDE.md", resident: true }];
    changeIn(data.changes, USERS).edits = [
      { file: "CLAUDE.md", at: "end", write: ["- Restore a deleted user."] },
    ];

    expect(summary(await build(data, EXAMPLE))).toEndWith(
      "; resident est. 361 tokens before",
    );
  });

  test("pluralizes questions", async () => {
    const data = await exampleData();
    data.questions = [];

    expect(summary(await build(data, EXAMPLE))).toContain("; 0 questions;");
  });
});

describe("command line", () => {
  afterEach(() => {
    mock.restore();
  });

  test("runs as an executable", async () => {
    const proc = Bun.spawn(
      ["bun", BUILD_SCRIPT, join(EXAMPLE, "data.json"), "--check"],
      { stdout: "pipe", stderr: "pipe" },
    );

    expect(await proc.exited).toBe(0);
    expect(await proc.stdout.text()).toStartWith("9 changes:");
  });

  test("checks a guard run", async () => {
    const result = await runCli(join(EXAMPLE, "guard-data.json"), "--check");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toStartWith("5 candidates:");
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
