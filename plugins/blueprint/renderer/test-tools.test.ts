import { afterEach, describe, expect, test } from "bun:test";

import { requireInCi } from "./test-tools";

const ci = process.env.CI;

afterEach(() => {
  if (ci === undefined) {
    delete process.env.CI;
  } else {
    process.env.CI = ci;
  }
});

describe("requireInCi", () => {
  test("reports a tool that is there", () => {
    process.env.CI = "true";

    expect(requireInCi(true, "Tool is missing.")).toBe(true);
  });

  test("lets a missing tool skip its tests outside CI", () => {
    delete process.env.CI;

    expect(requireInCi(false, "Tool is missing.")).toBe(false);
  });

  test("fails on a missing tool under CI, and names it", () => {
    process.env.CI = "true";

    expect(() => requireInCi(false, "Tool is missing.")).toThrow(
      "Tool is missing. CI is set, so the tests fail instead of skip.",
    );
  });
});
