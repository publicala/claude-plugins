/** The canary run's result table and exit status. */

export type RowResult = "PASS" | "FAIL" | "INVALID" | "ERROR" | "SKIP";

export interface Row {
  id: string;
  result: RowResult;
  detail: string;
  /** The load-model.md statement to revisit, shown on a FAIL. */
  update: string;
  /** Attempts the canary took: an INVALID run is retried once. */
  attempts: number;
  seconds: number;
}

function cell(text: string): string {
  return text.replaceAll("|", "\\|").replaceAll("\n", " ");
}

export function resultTable(rows: Row[]): string {
  const lines = rows.map((row) => {
    const detail =
      row.result === "FAIL"
        ? `${row.detail} **Fact to update**: ${row.update}`
        : row.detail;
    const attempts = row.attempts > 1 ? ` (attempt ${row.attempts})` : "";

    return `| \`${row.id}\` | ${row.result}${attempts} | ${Math.round(row.seconds)}s | ${cell(detail)} |`;
  });

  return [
    "| Canary | Result | Time | Detail |",
    "| --- | --- | --- | --- |",
    ...lines,
  ].join("\n");
}

/**
 * 1 when a fact changed, 2 when the harness could not judge a canary, and
 * 0 when every canary passed or skipped.
 */
export function exitCode(rows: Row[]): number {
  if (rows.some((row) => row.result === "FAIL")) {
    return 1;
  }

  if (rows.some((row) => row.result === "INVALID" || row.result === "ERROR")) {
    return 2;
  }

  return 0;
}

export function summaryLine(
  rows: Row[],
  costUsd: number,
  codexTokens: number,
  seconds: number,
): string {
  const counts = (["PASS", "FAIL", "INVALID", "ERROR", "SKIP"] as const)
    .map(
      (result) =>
        [result, rows.filter((row) => row.result === result).length] as const,
    )
    .filter(([, count]) => count > 0)
    .map(([result, count]) => `${count} ${result}`)
    .join(", ");
  const codex = codexTokens > 0 ? `, Codex ${codexTokens} tokens` : "";

  return `${counts}. Claude cost $${costUsd.toFixed(3)}${codex}, ${Math.round(seconds)}s wall-clock.`;
}

/**
 * The highest `total_cost_usd` among a session's stream-json result events.
 * A line a timeout cut short carries no cost to read, so it counts as none.
 */
export function streamCost(stream: string): number {
  return stream
    .split("\n")
    .filter((line) => line.includes('"type":"result"'))
    .map((line): unknown => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .map((event) =>
      typeof event === "object" && event !== null && "total_cost_usd" in event
        ? Number(event.total_cost_usd)
        : 0,
    )
    .reduce((highest, cost) => Math.max(highest, cost), 0);
}
