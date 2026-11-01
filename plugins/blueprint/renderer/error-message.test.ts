import { describe, expect, test } from "bun:test";

import { errorMessage } from "./error-message";

describe("errorMessage", () => {
  test("reads an Error's message", () => {
    expect(errorMessage(new TypeError("Unknown option '--pfd'"))).toBe(
      "Unknown option '--pfd'",
    );
  });

  test("prints any other thrown value as text", () => {
    expect(errorMessage("disk full")).toBe("disk full");
    expect(errorMessage(42)).toBe("42");
    expect(errorMessage(undefined)).toBe("undefined");
  });
});
