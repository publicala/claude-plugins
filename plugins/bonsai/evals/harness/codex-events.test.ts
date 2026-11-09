import { describe, expect, test } from "bun:test";

import { codexCommands, codexThreadId, codexTokens } from "./codex-events";

describe("codex events", () => {
  const events = [
    '{"type":"thread.started","thread_id":"01a1bdd6"}',
    "Reading additional input from stdin...",
    '{"type":"item.completed","item":{"type":"command_execution","command":"/bin/zsh -lc \'cat pkg/a.txt\'"}}',
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
    expect(codexCommands(events)).toEqual(["/bin/zsh -lc 'cat pkg/a.txt'"]);
  });

  test("totals input and output tokens", () => {
    expect(codexTokens(events)).toBe(40_078);
  });
});
