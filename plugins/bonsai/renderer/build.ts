#!/usr/bin/env bun

/**
 * Builds a bonsai decision page from a data file.
 *
 *     bun build.ts data.json -o page.html
 *     bun build.ts data.json --check
 *
 * The data file describes the run, the files it touches and every proposed
 * change (see README.md). The build reads the quoted lines from disk, so
 * the page always shows the file exactly as it is, then validates the data,
 * computes token estimates and editor links, and writes one HTML page ready
 * to publish as an artifact.
 */

import { existsSync, realpathSync, statSync } from "node:fs";
import { dirname, format, isAbsolute, join, parse } from "node:path";
import { parseArgs } from "node:util";

type JsonObject = Record<string, unknown>;

export const TEMPLATE = join(import.meta.dir, "template.html");
export const DATA_PLACEHOLDER = "/*__DATA__*/ null";
const TITLE_PLACEHOLDER = "<title>bonsai</title>";

const SKILLS = ["audit", "bake", "feed", "split"] as const;
const LANES = ["call", "ready", "auto"] as const;
const GROUP_LANES = ["ready", "auto"] as const;
const VERBS = [
  "fix",
  "delete",
  "shorten",
  "rewrite",
  "move",
  "add",
  "automate",
] as const;
const EDITORS = ["zed", "vscode", "cursor", "phpstorm"] as const;
const VERDICTS = ["same", "drift"] as const;
const MAX_CALLS = 5;
const MAX_READY_GROUPS = 3;

// Files longer than this show only the changed regions in the preview.
const FULL_PREVIEW_LINES = 400;

type Lane = (typeof LANES)[number];
type Editor = (typeof EDITORS)[number];

export interface PageFile {
  path: string;
  resident: boolean;
  new: boolean;
  lines: string[];
  hunks: boolean;
  tokens: number;
  href: string | null;
}

export interface PageEdit {
  file: string;
  lines: [number, number] | null;
  at: number | null;
  write: string[];
  before: { n: number; text: string }[];
  href: string | null;
}

export interface PageEvidence {
  text: string;
  href: string | null;
}

export interface PageGroup extends JsonObject {
  id: string;
  lane: Lane;
}

export interface PageChange extends JsonObject {
  id: string;
  lane: Lane;
  group?: unknown;
  edits: PageEdit[];
  evidence: PageEvidence[];
}

export interface Page {
  schema: 1;
  run: JsonObject & {
    title: string;
    root: string;
    round: number;
    rounds: number;
    waiting: unknown;
  };
  files: PageFile[];
  groups: PageGroup[];
  changes: PageChange[];
  questions: JsonObject[];
  kept: JsonObject[];
  next: unknown;
  ship: unknown;
}

interface LoadedFile {
  page: PageFile;
  absolutePath: string;
}

/**
 * A data file that would render a wrong or misleading page.
 */
export class DataError extends Error {}

function require(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new DataError(message);
  }
}

function quote(value: unknown): string {
  return value === undefined ? "nothing" : JSON.stringify(value);
}

function oneOf(values: readonly string[]): string {
  return `${values.slice(0, -1).join(", ")} or ${String(values.at(-1))}`;
}

function isOneOf<T extends string>(
  values: readonly T[],
  value: unknown,
): value is T {
  return values.some((candidate) => candidate === value);
}

function isFilledString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1;
}

function isWebUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    URL.canParse(value) &&
    ["http:", "https:"].includes(new URL(value).protocol)
  );
}

/**
 * Ids end up in element ids, CSS selectors and object keys
 * on the page, so they stay plain and never shadow a built-in.
 */
function isId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value) &&
    !(value in Object.prototype)
  );
}

const ID_RULE =
  'An id uses letters, digits, "-" and "_", and is not a built-in object key such as "constructor".';

function isLineRange(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) && value.length === 2 && value.every(Number.isInteger)
  );
}

function records(value: unknown, field: string): JsonObject[] {
  if (value === undefined) {
    return [];
  }

  require(Array.isArray(value) &&
    value.every(isRecord), `"${field}" must be a list of objects.`);

  return value;
}

export function estimateTokens(text: string): number {
  return text === "" ? 0 : Math.max(1, Math.round(Array.from(text).length / 4));
}

/**
 * Percent-encodes everything outside the RFC 3986 unreserved set,
 * which encodeURIComponent leaves partly unescaped (!'()*).
 */
function encodeStrictly(text: string): string {
  return encodeURIComponent(text).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function editorLink(
  editor: Editor | null,
  absolutePath: string,
  line = 1,
): string | null {
  if (editor === null) {
    return null;
  }

  if (editor === "phpstorm") {
    return `phpstorm://open?file=${encodeStrictly(absolutePath)}&line=${String(line)}`;
  }

  const encodedPath = absolutePath.split("/").map(encodeStrictly).join("/");

  return `${editor}://file${encodedPath}:${String(line)}`;
}

/**
 * Splits text into lines the way editors and agents number them
 * (only \n, \r\n and \r break a line), and a final newline
 * closes the last line rather than opening an empty one.
 */
function splitLines(text: string): string[] {
  const lines = text.split(/\r\n|\r|\n/);

  if (lines.at(-1) === "") {
    lines.pop();
  }

  return lines;
}

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

function isDirectory(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

/**
 * Appends a relative path without normalizing it, so the filesystem
 * resolves `..` after any symlink before it, the way a shell does.
 */
function appendPath(base: string, path: string): string {
  return isAbsolute(path) ? path : `${base.replace(/\/+$/, "")}/${path}`;
}

/**
 * Resolves symlinks one component at a time, because realpathSync
 * drops `..` before it follows the symlink that precedes it.
 */
function resolveRealPath(base: string, path: string): string {
  return appendPath(base, path)
    .split("/")
    .reduce((resolved, part) => {
      if (part === "" || part === ".") {
        return resolved;
      }

      if (part === "..") {
        return dirname(resolved);
      }

      const next = join(resolved, part);

      return existsSync(next) ? realpathSync(next) : next;
    }, "/");
}

const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

async function readLines(
  path: string,
  absolutePath: string,
): Promise<string[]> {
  const bytes = await Bun.file(absolutePath).bytes();

  try {
    return splitLines(UTF8.decode(bytes));
  } catch {
    throw new DataError(
      `Unable to read ${path} at ${absolutePath} as UTF-8 text.`,
    );
  }
}

async function loadFiles(
  entries: JsonObject[],
  root: string,
  editor: Editor | null,
): Promise<Map<string, LoadedFile>> {
  const files = new Map<string, LoadedFile>();

  for (const entry of entries) {
    const path = entry.path;
    require(isFilledString(path) &&
      !path.startsWith(
        "/",
      ), `Every file needs a repo-relative path, got ${quote(path)}.`);
    require(!files.has(path), `The file ${path} is listed twice.`);

    const absolutePath = appendPath(root, path);
    const isNew = Boolean(entry.new);

    if (isNew) {
      require(!existsSync(
        absolutePath,
      ), `The file ${path} is marked new, but it exists at ${absolutePath}.`);
    } else {
      require(isFile(
        absolutePath,
      ), `Unable to read ${path} at ${absolutePath}. Mark it "new": true if a change creates it.`);
    }

    const lines = isNew ? [] : await readLines(path, absolutePath);

    files.set(path, {
      page: {
        path,
        resident: Boolean(entry.resident),
        new: isNew,
        lines,
        hunks: lines.length > FULL_PREVIEW_LINES,
        tokens: lines.reduce((sum, line) => sum + estimateTokens(line), 0),
        href: isNew ? null : editorLink(editor, absolutePath),
      },
      absolutePath,
    });
  }

  require(files.size >
    0, 'The data lists no files. Add every file a change edits to "files".');

  return files;
}

function resolveEdit(
  changeId: string,
  edit: JsonObject,
  files: Map<string, LoadedFile>,
  editor: Editor | null,
): PageEdit {
  const path = edit.file;
  const file = typeof path === "string" ? files.get(path) : undefined;
  require(typeof path === "string" &&
    file, `Change '${changeId}' edits ${quote(path)}, which is missing from "files".`);

  const count = file.page.lines.length;
  const write = edit.write === undefined ? [] : edit.write;
  require(Array.isArray(write) &&
    write.every(
      (line) => typeof line === "string",
    ), `Change '${changeId}' needs "write" as a list of lines.`);

  if ("lines" in edit) {
    require(isLineRange(
      edit.lines,
    ), `Change '${changeId}' needs "lines" in ${path} as [first, last].`);

    const [first, last] = edit.lines;
    require(1 <= first &&
      first <= last &&
      last <=
        count, `Change '${changeId}' edits ${path} lines ${String(first)}-${String(last)}, but the file has ${String(count)} lines.`);

    return {
      file: path,
      lines: [first, last],
      at: null,
      write,
      before: file.page.lines
        .slice(first - 1, last)
        .map((text, index) => ({ n: first + index, text })),
      href: editorLink(editor, file.absolutePath, first),
    };
  }

  const at = edit.at;
  require(at === "end" ||
    (isPositiveInteger(at) &&
      at <=
        count +
          1), `Change '${changeId}' inserts into ${path} at ${quote(at)}. Use a line number from 1 to ${String(count + 1)}, or "end".`);
  require(write.length >
    0, `Change '${changeId}' inserts into ${path} but writes no lines.`);
  const position = at === "end" ? count + 1 : at;

  return {
    file: path,
    lines: null,
    at: position,
    write,
    before: [],
    href: file.page.new
      ? null
      : editorLink(
          editor,
          file.absolutePath,
          Math.min(position, Math.max(count, 1)),
        ),
  };
}

function resolveEvidence(
  changeId: string,
  evidence: JsonObject[],
  root: string,
  editor: Editor | null,
): PageEvidence[] {
  return evidence.map((item) => {
    require(isFilledString(item.text), 'Every evidence item needs "text".');

    if (item.file === undefined) {
      require(item.url === undefined ||
        isWebUrl(
          item.url,
        ), `Change '${changeId}' has evidence with "url" ${quote(item.url)}. Use an http or https URL.`);

      return { text: item.text, href: item.url ?? null };
    }

    const line = item.line ?? 1;
    require(isFilledString(item.file) &&
      isPositiveInteger(
        line,
      ), `Change '${changeId}' has evidence that needs "file" as a path and "line" as a line number.`);

    return {
      text: item.text,
      href: editorLink(editor, appendPath(root, item.file), line),
    };
  });
}

function resolveGroups(entries: JsonObject[]): Map<string, PageGroup> {
  const groups = new Map<string, PageGroup>();

  for (const group of entries) {
    const groupId = group.id;
    require(isId(groupId) &&
      !groups.has(
        groupId,
      ), `Every group needs a unique id, got ${quote(groupId)}. ${ID_RULE}`);
    require(isOneOf(
      GROUP_LANES,
      group.lane,
    ), `Group '${groupId}' needs lane "ready" or "auto".`);
    require(isFilledString(group.title), `Group '${groupId}' needs a title.`);
    groups.set(groupId, { ...group, id: groupId, lane: group.lane });
  }

  return groups;
}

function resolveChange(
  change: JsonObject,
  seenIds: Set<string>,
  groups: Map<string, PageGroup>,
  files: Map<string, LoadedFile>,
  root: string,
  editor: Editor | null,
): PageChange {
  const changeId = change.id;
  require(isId(changeId) &&
    !seenIds.has(
      changeId,
    ), `Every change needs a unique id, got ${quote(changeId)}. ${ID_RULE}`);
  seenIds.add(changeId);

  const lane = change.lane;
  require(isOneOf(
    LANES,
    lane,
  ), `Change '${changeId}' needs lane call, ready or auto.`);
  require(isOneOf(
    VERBS,
    change.verb,
  ), `Change '${changeId}' has verb ${quote(change.verb)}. Use one of ${oneOf(VERBS)}.`);
  require(isFilledString(change.title) &&
    isFilledString(
      change.why,
    ), `Change '${changeId}' needs a title and a why.`);

  const edits = change.edits;
  require(Array.isArray(edits) &&
    edits.length > 0 &&
    edits.every(isRecord), `Change '${changeId}' has no edits.`);

  if (lane === "call") {
    require(isFilledString(
      change.skip,
    ), `Change '${changeId}' is a call, so it needs "skip": what goes wrong if the user skips it.`);
  } else {
    const group =
      typeof change.group === "string" ? groups.get(change.group) : undefined;
    require(group, `Change '${changeId}' is in lane ${lane}, so it needs a "group" from "groups".`);
    require(group.lane ===
      lane, `Change '${changeId}' is in lane ${lane}, but its group '${group.id}' is ${group.lane}.`);
  }

  const check = change.check ?? null;
  if (check !== null) {
    require(isRecord(check) &&
      isOneOf(VERDICTS, check.verdict) &&
      isFilledString(
        check.summary,
      ), `Change '${changeId}' has a check without a verdict (same or drift) and a summary.`);
    require(!(
      check.verdict === "drift" && lane !== "call"
    ), `Change '${changeId}' drifted in the second check, so it belongs in lane call.`);
  }

  return {
    ...change,
    id: changeId,
    lane,
    edits: edits.map((edit) => resolveEdit(changeId, edit, files, editor)),
    evidence: resolveEvidence(
      changeId,
      records(change.evidence, `changes[${changeId}].evidence`),
      root,
      editor,
    ),
  };
}

function rejectOverlaps(changes: PageChange[]): void {
  const owners = new Map<string, string>();

  for (const change of changes) {
    for (const edit of change.edits) {
      if (edit.lines === null) {
        continue;
      }

      const [first, last] = edit.lines;

      for (let line = first; line <= last; line++) {
        const key = `${edit.file}\n${String(line)}`;
        const owner = owners.get(key);
        require(owner !==
          change.id, `Change '${change.id}' edits ${edit.file} line ${String(line)} twice. Merge those edits into one.`);
        require(owner ===
          undefined, `Changes '${String(owner)}' and '${change.id}' both edit ${edit.file} line ${String(line)}. Merge them into one change.`);
        owners.set(key, change.id);
      }
    }
  }

  for (const change of changes) {
    for (const edit of change.edits) {
      if (edit.at === null) {
        continue;
      }

      const owner = owners.get(`${edit.file}\n${String(edit.at)}`);
      require(owner ===
        undefined, `Change '${change.id}' inserts into ${edit.file} at line ${String(edit.at)}, which change '${String(owner)}' replaces. Add the lines to that edit's "write" instead.`);
    }
  }
}

function validateOptions(options: unknown, owner: string): Set<string> {
  require(Array.isArray(options) &&
    options.length >= 2, `${owner} needs at least two options.`);

  const optionIds = new Set<string>();

  for (const option of options) {
    require(isRecord(option) &&
      isId(option.id) &&
      isFilledString(option.label) &&
      !optionIds.has(
        option.id,
      ), `${owner} needs every option as { "id", "label" } with a unique id. ${ID_RULE}`);
    optionIds.add(option.id);
  }

  return optionIds;
}

function validateQuestions(questions: JsonObject[]): Map<string, Set<string>> {
  const questionOptions = new Map<string, Set<string>>();

  for (const question of questions) {
    require(isId(question.id) &&
      isFilledString(
        question.text,
      ), `Every question needs an id and text. ${ID_RULE}`);
    require(!questionOptions.has(
      question.id,
    ), `The question id '${question.id}' is used twice.`);
    questionOptions.set(
      question.id,
      validateOptions(question.options, `Question '${question.id}'`),
    );
  }

  return questionOptions;
}

function validateShip(ship: unknown): Set<string> {
  if (ship === undefined || ship === null) {
    return new Set();
  }

  require(isRecord(ship), '"ship" must be an object.');
  const optionIds = validateOptions(ship.options, '"ship"');
  require(typeof ship.default === "string" &&
    optionIds.has(
      ship.default,
    ), `"ship.default" must be the id of one of its options, got ${quote(ship.default)}.`);

  return optionIds;
}

interface RoundIds {
  changes: Set<string>;
  groups: Set<string>;
  questionOptions: Map<string, Set<string>>;
  next: Set<string>;
  shipOptions: Set<string>;
}

const DECISION_KEYS = ["d", "q", "note", "custom", "gnote", "next", "ship"];
const CHANGE_DECISIONS = ["apply", "skip", "later"] as const;

function requireMap(
  value: unknown,
  field: string,
  isValidEntry: (key: string, entry: unknown) => boolean,
  expectation: string,
): void {
  require(value === undefined ||
    (isRecord(value) &&
      Object.entries(value).every(([key, entry]) =>
        isValidEntry(key, entry),
      )), `run.status.decisions.${field} must map ${expectation}.`);
}

function validateStatus(status: unknown, ids: RoundIds): void {
  if (status === undefined || status === null) {
    return;
  }

  require(isRecord(status) &&
    isFilledString(
      status.state,
    ), 'run.status needs a "state", for example "applied".');
  require(status.link === undefined ||
    isWebUrl(
      status.link,
    ), `run.status.link must be an http or https URL, got ${quote(status.link)}.`);

  const decisions = status.decisions;
  if (decisions === undefined) {
    return;
  }

  require(isRecord(decisions), "run.status.decisions must be an object.");

  const unknownKey = Object.keys(decisions).find(
    (key) => !DECISION_KEYS.includes(key),
  );
  require(unknownKey ===
    undefined, `run.status.decisions has the unknown key ${quote(unknownKey)}. Use ${oneOf(DECISION_KEYS)}.`);

  const isNoteKey = (key: string) =>
    ids.changes.has(key) ||
    (key.startsWith("q:") && ids.questionOptions.has(key.slice(2)));

  requireMap(
    decisions.d,
    "d",
    (key, entry) =>
      ids.changes.has(key) &&
      (entry === null || isOneOf(CHANGE_DECISIONS, entry)),
    "change ids to apply, skip, later or null",
  );
  requireMap(
    decisions.q,
    "q",
    (key, entry) =>
      ids.questionOptions.has(key) &&
      (entry === null ||
        (typeof entry === "string" &&
          ids.questionOptions.get(key)?.has(entry) === true)),
    "question ids to one of their option ids",
  );
  requireMap(
    decisions.note,
    "note",
    (key, entry) => isNoteKey(key) && typeof entry === "string",
    'change ids and "q:" question ids to text',
  );
  requireMap(
    decisions.custom,
    "custom",
    (key, entry) => ids.changes.has(key) && typeof entry === "string",
    "change ids to text",
  );
  requireMap(
    decisions.gnote,
    "gnote",
    (key, entry) => ids.groups.has(key) && typeof entry === "string",
    "group ids to text",
  );
  requireMap(
    decisions.next,
    "next",
    (key, entry) => ids.next.has(key) && typeof entry === "boolean",
    "next item ids to true or false",
  );
  require(decisions.ship === undefined ||
    decisions.ship === null ||
    (typeof decisions.ship === "string" &&
      ids.shipOptions.has(
        decisions.ship,
      )), `run.status.decisions.ship must be one of the ship option ids, got ${quote(decisions.ship)}.`);
}

function validateNext(next: JsonObject[]): Set<string> {
  const nextIds = new Set<string>();

  for (const item of next) {
    require(isId(item.id) &&
      isFilledString(
        item.title,
      ), `Every next item needs an id and a title. ${ID_RULE}`);
    require(!nextIds.has(
      item.id,
    ), `The next item id '${item.id}' is used twice.`);
    nextIds.add(item.id);
  }

  return nextIds;
}

function validateRoundSize(
  changes: PageChange[],
  questions: JsonObject[],
): void {
  const calls =
    changes.filter((change) => change.lane === "call").length +
    questions.length;
  require(calls <=
    MAX_CALLS, `This round holds ${String(calls)} calls (questions included), but a round holds at most ${String(MAX_CALLS)}. Move the rest to the next round.`);

  const readyGroups = new Set(
    changes
      .filter((change) => change.lane === "ready")
      .map((change) => change.group),
  );
  require(readyGroups.size <=
    MAX_READY_GROUPS, `This round holds ${String(readyGroups.size)} ready groups, but a round holds at most ${String(MAX_READY_GROUPS)}. Move the rest to the next round.`);
}

function resolveKept(
  entries: JsonObject[],
  files: Map<string, LoadedFile>,
  editor: Editor | null,
): JsonObject[] {
  return entries.map((item) => {
    const file =
      typeof item.file === "string" ? files.get(item.file) : undefined;
    require(file, `Kept item ${quote(item.title)} names ${quote(item.file)}, which is missing from "files".`);
    require(isLineRange(
      item.lines,
    ), `Kept item ${quote(item.title)} needs "lines" as [first, last].`);

    return {
      ...item,
      href: editorLink(editor, file.absolutePath, item.lines[0]),
    };
  });
}

export async function build(data: unknown, base: string): Promise<Page> {
  require(isRecord(data), "The data file must hold a JSON object.");

  const run = data.run ?? {};
  require(isRecord(run), '"run" must be an object.');
  require(isOneOf(
    SKILLS,
    run.skill,
  ), `run.skill must be one of ${oneOf(SKILLS)}, got ${quote(run.skill)}.`);
  for (const key of ["title", "heading", "target", "date", "outcome"]) {
    require(isFilledString(run[key]), `run.${key} is required.`);
  }
  const title = run.title as string;

  const editor = run.editor ?? null;
  require(editor === null ||
    isOneOf(
      EDITORS,
      editor,
    ), `run.editor must be one of ${oneOf(EDITORS)}, or null, got ${quote(editor)}.`);

  const round = run.round ?? 1;
  const rounds = run.rounds ?? 1;
  require(isPositiveInteger(round) &&
    isPositiveInteger(
      rounds,
    ), `run.round and run.rounds must be whole numbers from 1, got ${quote(round)} and ${quote(rounds)}.`);

  require(isFilledString(
    run.root,
  ), "run.root is required: the repository the changes edit.");
  const root = resolveRealPath(base, run.root);
  require(isDirectory(
    root,
  ), `run.root must be the repository directory, got ${quote(run.root)}, which resolves to ${root}.`);

  const files = await loadFiles(records(data.files, "files"), root, editor);
  const groups = resolveGroups(records(data.groups, "groups"));

  const seenIds = new Set<string>();
  const changes = records(data.changes, "changes").map((change) =>
    resolveChange(change, seenIds, groups, files, root, editor),
  );
  require(changes.length >
    0, "The data holds no changes. A run with nothing to decide needs no page.");
  rejectOverlaps(changes);

  const questions = records(data.questions, "questions");
  const questionOptions = validateQuestions(questions);
  validateRoundSize(changes, questions);
  const shipOptions = validateShip(data.ship);

  const next = records(data.next, "next");
  validateStatus(run.status, {
    changes: new Set(changes.map((change) => change.id)),
    groups: new Set(groups.keys()),
    questionOptions,
    next: validateNext(next),
    shipOptions,
  });

  const usedGroups = new Set(changes.map((change) => change.group));
  for (const groupId of groups.keys()) {
    require(usedGroups.has(
      groupId,
    ), `Group '${groupId}' has no changes. Remove it.`);
  }

  return {
    schema: 1,
    run: {
      ...run,
      title,
      root,
      round,
      rounds: Math.max(rounds, round),
      waiting: run.waiting ?? 0,
    },
    files: [...files.values()].map((file) => file.page),
    groups: [...groups.values()],
    changes,
    questions,
    kept: resolveKept(records(data.kept, "kept"), files, editor),
    next,
    ship: data.ship ?? null,
  };
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export async function render(page: Page): Promise<string> {
  const template = await Bun.file(TEMPLATE).text();
  const payload = JSON.stringify(page).replaceAll("</", "<\\/");

  // Replacer functions keep `$` sequences in the data literal.
  return template
    .replace(
      TITLE_PLACEHOLDER,
      () => `<title>${escapeHtml(page.run.title)}</title>`,
    )
    .replace(DATA_PLACEHOLDER, () => payload);
}

export function summary(page: Page): string {
  const count = (lane: Lane) =>
    String(page.changes.filter((change) => change.lane === lane).length);
  const questions = page.questions.length;
  const resident = page.files
    .filter((file) => file.resident)
    .reduce((sum, file) => sum + file.tokens, 0);

  return (
    `${String(page.changes.length)} changes: ${count("call")} calls, ${count("ready")} ready, ${count("auto")} auto; ` +
    `${String(questions)} question${questions === 1 ? "" : "s"}; resident est. ${String(resident)} tokens before`
  );
}

const USAGE = "Usage: bun build.ts data.json [-o page.html] [--check]";

const HELP = `${USAGE}

Build a bonsai decision page from a data file.

  -o, --output  where to write the page (default: the data file with .html)
  --check       validate only, write nothing`;

async function readData(path: string): Promise<unknown> {
  const file = Bun.file(path);
  require(await file.exists(), `Unable to find the data file at ${path}.`);

  try {
    return (await file.json()) as unknown;
  } catch (error) {
    throw new DataError(
      `The data file ${path} is not valid JSON: ${(error as Error).message}`,
    );
  }
}

function parseCommandLine(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      output: { type: "string", short: "o" },
      check: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
}

export async function main(argv: string[]): Promise<number> {
  let commandLine: ReturnType<typeof parseCommandLine>;

  try {
    commandLine = parseCommandLine(argv);
  } catch (error) {
    console.error(`bonsai: ${(error as Error).message}\n${USAGE}`);
    return 2;
  }

  const { values, positionals } = commandLine;

  if (values.help) {
    console.log(HELP);
    return 0;
  }

  const [dataPath] = positionals;

  if (dataPath === undefined || positionals.length > 1) {
    console.error(`bonsai: Pass exactly one data file.\n${USAGE}`);
    return 2;
  }

  let page: Page;

  try {
    const data = await readData(dataPath);
    page = await build(data, dirname(resolveRealPath(process.cwd(), dataPath)));
  } catch (error) {
    if (!(error instanceof DataError)) {
      throw error;
    }

    console.error(`bonsai: ${error.message}`);
    return 1;
  }

  if (!values.check) {
    const output =
      values.output ?? format({ ...parse(dataPath), base: "", ext: ".html" });
    await Bun.write(output, await render(page));
    console.log(`Wrote ${output}`);
  }

  console.log(summary(page));

  return 0;
}

if (import.meta.main) {
  process.exit(await main(Bun.argv.slice(2)));
}
