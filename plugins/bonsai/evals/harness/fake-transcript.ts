/**
 * Builds session transcripts in the shape Claude Code writes them, so the
 * tests judge canaries without running `claude`.
 */
import type { Session } from "./canaries";
import type { Step } from "./transcript";

export class FakeTranscript {
  private readonly entries: Record<string, unknown>[];
  private readonly cwd: string | null;
  private nextId: number;

  /** Every conversation entry names `cwd`, as Claude Code writes them. */
  constructor(cwd: string | null = null) {
    this.entries = [];
    this.cwd = cwd;
    this.nextId = 1;
  }

  private push(entry: Record<string, unknown>): void {
    this.entries.push(this.cwd === null ? entry : { ...entry, cwd: this.cwd });
  }

  prompt(text: string): this {
    this.push({
      type: "user",
      message: { role: "user", content: text },
    });

    return this;
  }

  attach(type: string, payload: Record<string, unknown>): this {
    this.push({ type: "attachment", attachment: { type, ...payload } });

    return this;
  }

  /** A tool call and its result, as two turns. */
  tool(
    name: string,
    input: Record<string, unknown>,
    result: { content?: unknown; isError?: boolean } = {},
  ): this {
    const id = `toolu_${this.nextId++}`;

    this.push({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "tool_use", id, name, input }],
      },
    });
    this.push({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: id,
            content: result.content ?? "ok",
            ...(result.isError === true ? { is_error: true } : {}),
          },
        ],
      },
    });

    return this;
  }

  /** A tool call whose result never came. */
  unansweredTool(name: string, input: Record<string, unknown>): this {
    this.push({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "tool_use", id: `toolu_${this.nextId++}`, name, input },
        ],
      },
    });

    return this;
  }

  reply(text: string): this {
    this.push({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text }] },
    });

    return this;
  }

  /** Any other entry, such as the API request logs Claude Code keeps. */
  raw(entry: Record<string, unknown>): this {
    this.entries.push(entry);

    return this;
  }

  jsonl(): string {
    return this.entries.map((entry) => JSON.stringify(entry)).join("\n");
  }
}

export function stepInput(root: string, step: Step): Record<string, unknown> {
  if (step.tool === "Write") {
    return { file_path: `${root}/${step.path}`, content: step.content };
  }

  if (step.tool === "Edit") {
    return {
      file_path: `${root}/${step.path}`,
      old_string: step.find,
      new_string: step.replace,
    };
  }

  if (step.tool === "Bash") {
    return { command: step.command, description: "Run the step" };
  }

  if (step.tool === "Skill") {
    return { skill: step.skill };
  }

  if (step.tool === "Agent") {
    return { description: "Run the steps", prompt: "Run these steps" };
  }

  return { file_path: `${root}/${step.path}` };
}

/**
 * A session that runs its steps and loads each marker where its
 * expectation says, or where `arrivals` moves it (0 is the session start).
 */
export function followingSession(
  root: string,
  session: Session,
  arrivals: Record<string, number | "never"> = {},
): FakeTranscript {
  const arrivalOf = (
    marker: string,
    expected: number | number[] | "never",
  ): number | "never" =>
    arrivals[marker] ??
    (Array.isArray(expected) ? (expected[0] ?? "never") : expected);
  const loadsAt = (position: number): string[] =>
    session.expectations
      .filter(
        (expectation) =>
          arrivalOf(expectation.marker, expectation.afterStep) === position,
      )
      .map((expectation) => expectation.marker);
  const transcript = new FakeTranscript(root).prompt("Run these steps");

  for (const marker of loadsAt(0)) {
    transcript.attach("skill_listing", { content: `- helper: ${marker}` });
  }

  session.steps.forEach((step, index) => {
    transcript.tool(step.tool, stepInput(root, step));

    for (const marker of loadsAt(index + 1)) {
      transcript.attach("nested_memory", {
        content: { content: `Marker: ${marker}` },
      });
    }
  });

  return transcript.reply("DONE");
}
