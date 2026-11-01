// The run as build.ts embeds it in the page, after validation. build.ts owns
// the shape: these types state what the page reads from it.

export type Lane = "call" | "ready" | "auto";

export type Decision = "apply" | "skip" | "later";

/** Every key is optional: record mode merges what the run recorded. */
export interface Decisions {
  d?: Record<string, Decision | null>;
  q?: Record<string, string | null>;
  note?: Record<string, string>;
  custom?: Record<string, string>;
  gnote?: Record<string, string>;
  next?: Record<string, boolean>;
  ship?: string | null;
  pull?: Record<string, boolean>;
}

export interface RunStatus {
  state: string;
  date?: string;
  summary?: string;
  link?: string;
  /** Guard runs: candidate or not-now id to its pull request. */
  prs?: Record<string, string>;
  decisions?: Decisions;
}

export interface Run {
  skill: string;
  title: string;
  heading: string;
  subject?: string;
  target: string;
  date: string;
  round: number;
  rounds: number;
  waiting: number;
  outcome: string;
  method?: string;
  /** Guard runs: how the built candidates land. */
  prs?: string;
  status?: RunStatus;
}

export interface PageFile {
  path: string;
  resident: boolean;
  new: boolean;
  lines: string[];
  /** Long files preview only the regions around the edits. */
  hunks: boolean;
  tokens: number;
  href: string | null;
}

export interface Line {
  n: number;
  text: string;
}

interface EditBase {
  file: string;
  write: string[];
  before: Line[];
  href: string | null;
}

/** Replaces lines [first, last]. */
export interface ReplaceEdit extends EditBase {
  lines: [number, number];
  at: null;
}

/** Inserts before line `at`, one past the last line for the end. */
export interface InsertEdit extends EditBase {
  lines: null;
  at: number;
}

export type Edit = ReplaceEdit | InsertEdit;

export interface Evidence {
  text: string;
  href: string | null;
}

export interface SecondCheck {
  verdict: "same" | "drift";
  summary: string;
}

export interface Quote {
  reviewer: string;
  text: string;
  url: string;
}

export interface Guardrail {
  rung: number;
  name: string;
  tool: string | null;
  where: string[];
  message: string | null;
}

export interface Change {
  id: string;
  lane: Lane;
  group?: string;
  verb?: string;
  title: string;
  /** Guard candidates may leave it out. */
  why?: string;
  skip?: string;
  split?: string;
  edits: Edit[];
  evidence: Evidence[];
  check?: SecondCheck | null;
  recommendation?: string;
  caught?: { count: number; quotes: Quote[] };
  mistake?: {
    lang: string | null;
    wrong: string;
    right: string;
    note: string | null;
  };
  guardrail?: Guardrail;
  cost?: { label: string; value: string }[];
  alternative?: string;
}

/** A change in a guard run: a candidate check, always a call. */
export type Candidate = Change &
  Required<
    Pick<Change, "recommendation" | "caught" | "mistake" | "guardrail" | "cost">
  >;

export interface Group {
  id: string;
  lane: Lane;
  title: string;
  lede?: string;
}

export interface Option {
  id: string;
  label: string;
  detail?: string;
  recommended?: boolean;
}

export interface Question {
  id: string;
  text: string;
  why?: string;
  options: Option[];
}

export interface Kept {
  file: string;
  lines: [number, number];
  title: string;
  why: string;
  href: string | null;
}

export interface NextItem {
  id: string;
  title: string;
  why?: string;
  command?: string;
  default?: boolean;
}

export interface Ship {
  default: string;
  remembered?: boolean;
  options: Option[];
}

export interface NotNow {
  id: string;
  title: string;
  why: string;
  threads: string[];
}

export interface NoGuardrail {
  finding: string;
  verdict: string;
  url?: string;
}

export interface PageData {
  schema: 1;
  run: Run;
  files: PageFile[];
  groups: Group[];
  changes: Change[];
  questions: Question[];
  kept: Kept[];
  next: NextItem[];
  ship: Ship | null;
  notNow: NotNow[];
  none: NoGuardrail[];
}
