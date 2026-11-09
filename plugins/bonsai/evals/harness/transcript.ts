/**
 * Reads a Claude Code session transcript (the JSONL file under
 * `~/.claude/projects/`) as far as a canary needs: the tool calls in
 * order, and where in the session a marker first reached the context.
 */

/** A tool call, with the transcript positions of its call and its result. */
export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  callAt: number;
  resultAt: number | null;
  /** The result's text when the tool reported an error. */
  error: string | null;
}

export interface Transcript {
  /** Each entry serialized back to one line, in transcript order. */
  lines: string[];
  /** Positions of the entries the model wrote. */
  modelTurns: Set<number>;
  toolCalls: ToolCall[];
}

/** One step a canary prescribes, as the tool call the session must make. */
export type Step =
  | { tool: "Read"; path: string }
  | { tool: "Write"; path: string; content: string }
  | { tool: "Edit"; path: string; find: string; replace: string }
  | { tool: "Bash"; command: string }
  | { tool: "Skill"; skill: string }
  | { tool: "Agent" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The content blocks of a conversation turn. Other entries (API request
 * logs, snapshots) can carry copies of earlier turns, so they hold none.
 */
function contentBlocks(entry: Record<string, unknown>): unknown[] {
  if (entry["type"] !== "assistant" && entry["type"] !== "user") {
    return [];
  }

  const message = entry["message"];
  const content = isRecord(message) ? message["content"] : undefined;

  return Array.isArray(content) ? content : [];
}

function resultText(content: unknown): string {
  const text = typeof content === "string" ? content : JSON.stringify(content);

  return text.replaceAll(/<\/?tool_use_error>/g, "").trim();
}

export function parseTranscript(jsonl: string): Transcript {
  const entries = jsonl
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line): unknown => JSON.parse(line))
    .filter(isRecord);
  const modelTurns = new Set<number>();
  const toolCalls: ToolCall[] = [];
  const callsById = new Map<string, ToolCall>();

  entries.forEach((entry, at) => {
    if (entry["type"] === "assistant") {
      modelTurns.add(at);
    }

    for (const block of contentBlocks(entry).filter(isRecord)) {
      if (block["type"] === "tool_use" && typeof block["id"] === "string") {
        const input = block["input"];
        const call: ToolCall = {
          name: String(block["name"]),
          input: isRecord(input) ? input : {},
          callAt: at,
          resultAt: null,
          error: null,
        };
        toolCalls.push(call);
        callsById.set(block["id"], call);
      }

      if (block["type"] === "tool_result") {
        const call = callsById.get(String(block["tool_use_id"]));

        if (call !== undefined && call.resultAt === null) {
          call.resultAt = at;
          call.error =
            block["is_error"] === true ? resultText(block["content"]) : null;
        }
      }
    }
  });

  return {
    lines: entries.map((entry) => JSON.stringify(entry)),
    modelTurns,
    toolCalls,
  };
}

/**
 * Where a marker first reached the context: the first entry holding it that
 * the model did not write. The prompts never name a marker and the steps
 * never read an instruction file, so any such entry is the harness loading
 * one.
 */
export function markerArrival(
  transcript: Transcript,
  marker: string,
): number | null {
  const at = transcript.lines.findIndex(
    (line, index) => !transcript.modelTurns.has(index) && line.includes(marker),
  );

  return at === -1 ? null : at;
}

/** The position of the model's next turn after an entry, or the end. */
export function nextModelTurn(transcript: Transcript, after: number): number {
  for (let at = after + 1; at < transcript.lines.length; at++) {
    if (transcript.modelTurns.has(at)) {
      return at;
    }
  }

  return transcript.lines.length;
}

export function describeStep(step: Step): string {
  if (step.tool === "Bash") {
    return `Bash \`${step.command}\``;
  }

  if (step.tool === "Skill") {
    return `Skill ${step.skill}`;
  }

  if (step.tool === "Agent") {
    return "Agent";
  }

  return `${step.tool} ${step.path}`;
}

export function describeCall(call: ToolCall): string {
  const target = ["file_path", "command", "skill", "description"]
    .map((field) => call.input[field])
    .find((value) => typeof value === "string");

  return `${call.name} ${target ?? ""}`.trim();
}

/** Whether a tool call is the one a step prescribes. Paths are relative. */
export function callMatchesStep(call: ToolCall, step: Step): boolean {
  if (step.tool === "Bash") {
    return (
      call.name === "Bash" &&
      String(call.input["command"]).trim() === step.command
    );
  }

  if (step.tool === "Skill") {
    return call.name === "Skill" && call.input["skill"] === step.skill;
  }

  if (step.tool === "Agent") {
    return call.name === "Agent" || call.name === "Task";
  }

  const path = call.input["file_path"];

  return (
    call.name === step.tool &&
    typeof path === "string" &&
    (path === step.path || path.endsWith(`/${step.path}`))
  );
}
