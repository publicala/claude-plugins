import { describe, expect, test } from "bun:test";

import {
  codexCommands,
  codexInstructions,
  codexThreadId,
  codexTokens,
} from "./codex-events";

describe("codex events", () => {
  const events = [
    '{"type":"thread.started","thread_id":"01a1bdd6"}',
    "Reading additional input from stdin...",
    '{"type":"item.completed","item":{"type":"command_execution","command":"/bin/zsh -lc \'cat pkg/a.txt\'"}}',
    '{"type":"item.completed","item":{"type":"command_execution","command":"/bin/bash -lc \'cat pkg/missing.txt\'","exit_code":1}}',
    '{"type":"item.completed","item":{"type":"command_execution","command":"ls pkg"}}',
    '{"type":"item.completed","item":{"type":"agent_message","text":"DONE"}}',
    '{"type":"item.completed"}',
    '{"type":"turn.completed","usage":{"input_tokens":40000,"output_tokens":78}}',
    '{"type":"turn.completed"}',
    '{"type":"turn.completed","usage":{"cached_input_tokens":5}}',
  ].join("\n");

  test("reads the thread id", () => {
    expect(codexThreadId(events)).toBe("01a1bdd6");
    expect(codexThreadId("")).toBeNull();
  });

  test("lists the commands the session ran", () => {
    expect(codexCommands(events)).toEqual([
      { command: "cat pkg/a.txt", exitCode: null },
      { command: "cat pkg/missing.txt", exitCode: 1 },
      { command: "ls pkg", exitCode: null },
    ]);
  });

  test("totals input and output tokens", () => {
    expect(codexTokens(events)).toBe(40_078);
  });
});

function message(role: string, text: string): string {
  return JSON.stringify({
    type: "response_item",
    payload: {
      type: "message",
      role,
      content: [{ type: "input_text", text }],
    },
  });
}

describe("codex instructions", () => {
  test("reads only the AGENTS.md instructions Codex sent at start", () => {
    const rollout = [
      JSON.stringify({ type: "session_meta", payload: { id: "01a1" } }),
      message("developer", "# AGENTS.md instructions for /repo\n\nDEVELOPER"),
      message(
        "user",
        "# AGENTS.md instructions for /repo\n\n<INSTRUCTIONS>\nROOT\n</INSTRUCTIONS>",
      ),
      message("user", "Run `cat pkg/AGENTS.md`."),
      JSON.stringify({
        type: "response_item",
        payload: {
          type: "custom_tool_call_output",
          output: [{ type: "input_text", text: "NESTED" }],
        },
      }),
      JSON.stringify({ type: "world_state", payload: { text: "NESTED" } }),
    ].join("\n");

    expect(codexInstructions(rollout)).toBe(
      "# AGENTS.md instructions for /repo\n\n<INSTRUCTIONS>\nROOT\n</INSTRUCTIONS>",
    );
  });
});
