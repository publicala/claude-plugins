import { describe, expect, test } from "bun:test";

import {
  exitCode,
  resultTable,
  streamCost,
  summaryLine,
  type Row,
  type RowResult,
} from "./report";

function row(result: RowResult, overrides: Partial<Row> = {}): Row {
  return {
    id: "nested-on-read",
    result,
    detail: "pkg/CLAUDE.md: right after step 1 (Read pkg/a.txt)",
    update: "load-model.md, Four classes.",
    attempts: 1,
    seconds: 5.4,
    ...overrides,
  };
}

describe("resultTable", () => {
  test("prints one row per canary", () => {
    expect(resultTable([row("PASS")])).toBe(
      [
        "| Canary | Result | Time | Detail |",
        "| --- | --- | --- | --- |",
        "| `nested-on-read` | PASS | 5s | pkg/CLAUDE.md: right after step 1 (Read pkg/a.txt) |",
      ].join("\n"),
    );
  });

  test("names the fact to update on a FAIL", () => {
    expect(
      resultTable([row("FAIL", { detail: "pkg/CLAUDE.md: never." })]),
    ).toContain(
      "| pkg/CLAUDE.md: never. **Fact to update**: load-model.md, Four classes. |",
    );
  });

  test("escapes pipes and newlines, and shows a retry", () => {
    const table = resultTable([
      row("INVALID", { detail: "Bash cat a | head\nagain", attempts: 2 }),
    ]);

    expect(table).toContain(
      "| INVALID (attempt 2) | 5s | Bash cat a \\| head again |",
    );
  });
});

describe("exitCode", () => {
  test.each([
    [["PASS", "SKIP"], 0],
    [["PASS", "INVALID"], 2],
    [["ERROR"], 2],
    [["INVALID", "FAIL"], 1],
  ] satisfies [RowResult[], number][])(
    "exits for %p with %p",
    (results, code) => {
      expect(exitCode(results.map((result) => row(result)))).toBe(code);
    },
  );
});

describe("summaryLine", () => {
  test("counts results and totals cost and time", () => {
    expect(
      summaryLine([row("PASS"), row("PASS"), row("FAIL")], 0.0184, 0, 30.6),
    ).toBe("2 PASS, 1 FAIL. Claude cost $0.018, 31s wall-clock.");
  });

  test("adds Codex tokens when Codex ran", () => {
    expect(summaryLine([row("SKIP")], 0, 87_408, 1)).toBe(
      "1 SKIP. Claude cost $0.000, Codex 87408 tokens, 1s wall-clock.",
    );
  });
});

describe("streamCost", () => {
  test("takes the highest cost among the result events", () => {
    const stream = [
      '{"type":"system","subtype":"init"}',
      '{"type":"result","total_cost_usd":0.004}',
      '{"type":"result","total_cost_usd":0.011}',
    ].join("\n");

    expect(streamCost(stream)).toBe(0.011);
  });

  test("counts a result line a timeout cut short as no cost", () => {
    const stream = [
      '{"type":"result","total_cost_usd":0.004}',
      '{"type":"result","total_cost_us',
    ].join("\n");

    expect(streamCost(stream)).toBe(0.004);
  });
});
