/** Reads the JSONL events `codex exec --json` prints. */

function events(jsonl: string): Record<string, unknown>[] {
  return jsonl
    .split("\n")
    .filter((line) => line.trim().startsWith("{"))
    .map((line): unknown => JSON.parse(line))
    .filter(
      (event): event is Record<string, unknown> =>
        typeof event === "object" && event !== null,
    );
}

function item(event: Record<string, unknown>): Record<string, unknown> {
  const value = event["item"];

  return typeof value === "object" && value !== null
    ? Object.fromEntries(Object.entries(value))
    : {};
}

/** The thread id, which names the session's rollout file. */
export function codexThreadId(jsonl: string): string | null {
  const started = events(jsonl).find(
    (event) => event["type"] === "thread.started",
  );
  const id = started?.["thread_id"];

  return typeof id === "string" ? id : null;
}

export interface CodexCommand {
  /** The command as the model wrote it, outside Codex's shell wrapper. */
  command: string;
  exitCode: number | null;
}

/** Codex runs each command as `<shell> -lc '<command>'`. */
function unwrapped(command: string): string {
  const match = /^\S*\/(?:ba|z)?sh -lc (['"])([\s\S]*)\1$/.exec(command);

  return match?.[2] ?? command;
}

/** Every shell command the session ran, with its exit code. */
export function codexCommands(jsonl: string): CodexCommand[] {
  return events(jsonl)
    .filter((event) => event["type"] === "item.completed")
    .map(item)
    .filter((completed) => completed["type"] === "command_execution")
    .map((completed) => ({
      command: unwrapped(String(completed["command"])),
      exitCode:
        typeof completed["exit_code"] === "number"
          ? completed["exit_code"]
          : null,
    }));
}

/** The parts of a message's content that are objects. */
function contentParts(content: unknown): Record<string, unknown>[] {
  if (!Array.isArray(content)) {
    return [];
  }

  return content
    .filter((part): part is object => typeof part === "object" && part !== null)
    .map((part) => Object.fromEntries(Object.entries(part)));
}

const INSTRUCTIONS_HEADING = "# AGENTS.md instructions for ";

/**
 * The AGENTS.md instructions Codex put in the context at session start,
 * read from the rollout file. Codex sends them as a user message whose
 * text opens with a fixed heading, so a command that prints an AGENTS.md
 * file never counts.
 */
export function codexInstructions(rollout: string): string {
  return events(rollout)
    .map((entry) => entry["payload"])
    .filter(
      (payload): payload is Record<string, unknown> =>
        typeof payload === "object" && payload !== null,
    )
    .filter(
      (payload) => payload["type"] === "message" && payload["role"] === "user",
    )
    .flatMap((payload) => contentParts(payload["content"]))
    .map((part) => part["text"])
    .filter(
      (text): text is string =>
        typeof text === "string" && text.startsWith(INSTRUCTIONS_HEADING),
    )
    .join("\n");
}

/** Input plus output tokens over every turn. */
export function codexTokens(jsonl: string): number {
  return events(jsonl)
    .filter((event) => event["type"] === "turn.completed")
    .map((event) => {
      const usage = event["usage"];

      if (typeof usage !== "object" || usage === null) {
        return 0;
      }

      const counts = Object.fromEntries(Object.entries(usage));

      return (
        Number(counts["input_tokens"] ?? 0) +
        Number(counts["output_tokens"] ?? 0)
      );
    })
    .reduce((sum, tokens) => sum + tokens, 0);
}
