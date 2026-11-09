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

/** Every shell command the session ran. */
export function codexCommands(jsonl: string): string[] {
  return events(jsonl)
    .filter((event) => event["type"] === "item.completed")
    .map(item)
    .filter((completed) => completed["type"] === "command_execution")
    .map((completed) => String(completed["command"]));
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
