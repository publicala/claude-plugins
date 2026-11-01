import { describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { main } from "./validate-json";
import { errorAnnotation } from "./workflow-command";

const at = { line: 3, col: 7 };

describe("errorAnnotation", () => {
  test("passes a plain path and message through unchanged", () => {
    expect(
      errorAnnotation({ file: "plugins/a.json", ...at, message: "Broken" }),
    ).toBe("::error file=plugins/a.json,line=3,col=7::Broken");
  });

  test("keeps a newline in the path or message on one line", () => {
    const annotation = errorAnnotation({
      file: "a\nb.json",
      ...at,
      message: "one\r\n::error::two",
    });

    expect(annotation.split("\n")).toHaveLength(1);
    expect(annotation).toBe(
      "::error file=a%0Ab.json,line=3,col=7::one%0D%0A::error::two",
    );
  });

  test("escapes a percent sign", () => {
    expect(
      errorAnnotation({ file: "50%.json", ...at, message: "100% broken" }),
    ).toBe("::error file=50%25.json,line=3,col=7::100%25 broken");
  });

  test("escapes a colon and a comma in a property, and keeps them in the message", () => {
    expect(
      errorAnnotation({
        file: "a,line=1:b.json",
        ...at,
        message: "Expected a, b: c",
      }),
    ).toBe("::error file=a%2Cline=1%3Ab.json,line=3,col=7::Expected a, b: c");
  });
});

describe("validate-json main", () => {
  test("annotates a bad file through errorAnnotation", async () => {
    const root = await mkdtemp(join(tmpdir(), "workflow-command-"));
    const error = spyOn(console, "error").mockImplementation(() => undefined);

    try {
      await Bun.write(join(root, "odd,50%:name.json"), '{"a": 1 "b": 2}\n');
      Bun.spawnSync(["git", "init", "--quiet"], { cwd: root });

      expect(await main(root)).toBe(1);
      expect(error).toHaveBeenCalledWith(
        "::error file=odd%2C50%25%3Aname.json,line=1,col=9::odd,50%25:name.json line 1, column 9: Comma expected",
      );
    } finally {
      error.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });
});
