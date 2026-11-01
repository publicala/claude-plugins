import { describe, expect, test } from "bun:test";

import { readTypeScript } from "./typescript-source";

describe("readTypeScript", () => {
  test("blanks comments and string contents, and keeps every offset", () => {
    const source = [
      'const a = "x // y"; // note',
      "/* block",
      "   end */ const b = 'z';",
    ].join("\n");
    const { masked, strings } = readTypeScript(source);

    expect(masked).toHaveLength(source.length);
    expect(masked.split("\n")).toEqual([
      'const a = "      ";        ',
      "        ",
      "          const b = ' ';",
    ]);
    expect(strings.map(({ value }) => value)).toEqual(["x // y", "z"]);
  });

  test("keeps a template's text and reads the code in its ${}", () => {
    const source =
      'const t = `a "b" ${f("c", { d: 1 })} e // f` + "g"; // h\nconst x = "\\"q\\"";';
    const { masked, strings } = readTypeScript(source);

    expect(strings.map(({ value }) => value)).toEqual(["c", "g", '\\"q\\"']);
    expect(masked).toContain('`a "b" ${f(" ", { d: 1 })} e // f`');
    expect(masked).not.toContain("// h");
  });

  test("ends an unclosed comment, string or template at the end of the source", () => {
    expect(readTypeScript("/* open").masked).toBe("       ");
    expect(readTypeScript('"open').strings).toEqual([
      { start: 0, end: 6, value: "open" },
    ]);
    expect(readTypeScript("`open \\` ${").masked).toBe("`open \\` ${");
  });
});
