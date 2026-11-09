import { describe, expect, test } from "bun:test";

import { FakeTranscript } from "./fake-transcript";
import {
  callMatchesStep,
  describeCall,
  describeStep,
  markerArrival,
  nextModelTurn,
  parseTranscript,
  type Step,
  type ToolCall,
} from "./transcript";

describe("parseTranscript", () => {
  test("pairs each tool call with its result", () => {
    const transcript = parseTranscript(
      new FakeTranscript()
        .prompt("go")
        .tool("Read", { file_path: "/repo/pkg/a.txt" })
        .tool(
          "Edit",
          { file_path: "/repo/pkg/a.txt" },
          {
            content:
              "<tool_use_error>File has not been read yet.</tool_use_error>",
            isError: true,
          },
        )
        .reply("DONE")
        .jsonl(),
    );

    expect(transcript.toolCalls).toEqual([
      {
        name: "Read",
        input: { file_path: "/repo/pkg/a.txt" },
        callAt: 1,
        resultAt: 2,
        error: null,
      },
      {
        name: "Edit",
        input: { file_path: "/repo/pkg/a.txt" },
        callAt: 3,
        resultAt: 4,
        error: "File has not been read yet.",
      },
    ]);
    expect([...transcript.modelTurns]).toEqual([1, 3, 5]);
  });

  test("reads an error result given as content blocks", () => {
    const transcript = parseTranscript(
      new FakeTranscript()
        .tool(
          "Bash",
          { command: "false" },
          { content: [{ type: "text", text: "exit 1" }], isError: true },
        )
        .jsonl(),
    );

    expect(transcript.toolCalls[0]?.error).toBe(
      '[{"type":"text","text":"exit 1"}]',
    );
  });

  test("ignores tool blocks copied into entries that are not turns", () => {
    const copied = {
      type: "api-request-blob",
      message: {
        content: [{ type: "tool_use", id: "toolu_9", name: "Read", input: {} }],
      },
    };
    const transcript = parseTranscript(
      new FakeTranscript()
        .tool("Read", { file_path: "/repo/a.txt" })
        .raw(copied)
        .jsonl(),
    );

    expect(transcript.toolCalls.map((call) => call.name)).toEqual(["Read"]);
  });

  test("keeps the first result of a call, and skips results of unknown calls", () => {
    const repeated = {
      type: "user",
      message: {
        content: [
          { type: "tool_result", tool_use_id: "toolu_1", content: "again" },
        ],
      },
    };
    const stray = {
      type: "user",
      message: {
        content: [
          { type: "tool_result", tool_use_id: "toolu_404", content: "?" },
        ],
      },
    };
    const transcript = parseTranscript(
      new FakeTranscript()
        .tool("Read", { file_path: "/a" })
        .raw(repeated)
        .raw(stray)
        .jsonl(),
    );

    expect(transcript.toolCalls[0]?.resultAt).toBe(1);
  });

  test("reads a tool call without input as empty input", () => {
    const transcript = parseTranscript(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "tool_use", id: "toolu_1", name: "Agent" }],
        },
      }),
    );

    expect(transcript.toolCalls[0]?.input).toEqual({});
  });

  test("skips blank lines and lines that hold no object", () => {
    const transcript = parseTranscript(
      `\n[1]\n${JSON.stringify({ type: "assistant" })}\n\n`,
    );

    expect(transcript.lines).toEqual(['{"type":"assistant"}']);
  });
});

describe("markerArrival", () => {
  const transcript = parseTranscript(
    new FakeTranscript()
      .prompt("go")
      .tool("Read", { file_path: "/repo/pkg/ACME-ECHO/a.txt" })
      .attach("nested_memory", { content: "Marker: ACME-NESTED" })
      .reply("DONE")
      .jsonl(),
  );

  test("finds the first entry the model did not write", () => {
    expect(markerArrival(transcript, "ACME-NESTED")).toBe(3);
  });

  test("ignores a marker only the model wrote", () => {
    expect(markerArrival(transcript, "ACME-ECHO")).toBeNull();
  });

  test("returns null for a marker that never arrived", () => {
    expect(markerArrival(transcript, "ACME-ABSENT")).toBeNull();
  });
});

describe("nextModelTurn", () => {
  const transcript = parseTranscript(
    new FakeTranscript()
      .prompt("go")
      .tool("Read", { file_path: "/a" })
      .attach("date", {})
      .jsonl(),
  );

  test("finds the model's next turn", () => {
    expect(nextModelTurn(transcript, 0)).toBe(1);
  });

  test("returns the end when the model never speaks again", () => {
    expect(nextModelTurn(transcript, 2)).toBe(4);
  });
});

const STEPS: [Step, string][] = [
  [{ tool: "Read", path: "pkg/a.txt" }, "Read pkg/a.txt"],
  [{ tool: "Write", path: "pkg/b.txt", content: "ok" }, "Write pkg/b.txt"],
  [
    { tool: "Edit", path: "pkg/a.txt", find: "a", replace: "b" },
    "Edit pkg/a.txt",
  ],
  [{ tool: "Bash", command: "cat pkg/a.txt" }, "Bash `cat pkg/a.txt`"],
  [{ tool: "Skill", skill: "acme-restock" }, "Skill acme-restock"],
  [{ tool: "Agent" }, "Agent"],
];

test.each(STEPS)("describeStep names %p", (step, description) => {
  expect(describeStep(step)).toBe(description);
});

describe("describeCall", () => {
  test.each([
    [{ file_path: "/repo/a.txt" }, "Read /repo/a.txt"],
    [{ command: "ls" }, "Read ls"],
    [{ skill: "acme" }, "Read acme"],
    [{ description: "Run" }, "Read Run"],
    [{}, "Read"],
  ])("names the call's target from %p", (input, description) => {
    expect(
      describeCall({
        name: "Read",
        input,
        callAt: 0,
        resultAt: null,
        error: null,
      }),
    ).toBe(description);
  });
});

function toolCall(name: string, input: Record<string, unknown>): ToolCall {
  return { name, input, callAt: 0, resultAt: 1, error: null };
}

describe("callMatchesStep", () => {
  test.each([
    [toolCall("Read", { file_path: "/repo/pkg/a.txt" }), STEPS[0]?.[0], true],
    [toolCall("Read", { file_path: "pkg/a.txt" }), STEPS[0]?.[0], true],
    [
      toolCall("Read", { file_path: "/repo/other/pkg/a.txt.bak" }),
      STEPS[0]?.[0],
      false,
    ],
    [toolCall("Read", {}), STEPS[0]?.[0], false],
    [toolCall("Write", { file_path: "/repo/pkg/a.txt" }), STEPS[0]?.[0], false],
    [toolCall("Bash", { command: " cat pkg/a.txt\n" }), STEPS[3]?.[0], true],
    [
      toolCall("Bash", { command: "cat pkg/a.txt | head" }),
      STEPS[3]?.[0],
      false,
    ],
    [toolCall("Skill", { skill: "acme-restock" }), STEPS[4]?.[0], true],
    [toolCall("Skill", { skill: "acme-other" }), STEPS[4]?.[0], false],
    [toolCall("Agent", {}), STEPS[5]?.[0], true],
    [toolCall("Task", {}), STEPS[5]?.[0], true],
    [toolCall("Read", {}), STEPS[5]?.[0], false],
  ])("matches %p against %p: %p", (call, step, matches) => {
    if (step === undefined) {
      throw new Error("The step table is shorter than the test expects.");
    }

    expect(callMatchesStep(call, step)).toBe(matches);
  });
});
