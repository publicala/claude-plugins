import { describe, expect, test } from "bun:test";

import { editRows, line, similarity, wdiff } from "./page/diff";
import { esc, plain, plural, prose } from "./page/text";

// The page's pure helpers, run here without a DOM. build.test.ts drives the
// whole page in one.

describe("text", () => {
  test("esc escapes the five HTML characters, and prints nothing for null", () => {
    expect(esc(`<a href="x">'&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;",
    );
    expect(esc(null)).toBe("");
    expect(esc(undefined)).toBe("");
    expect(esc(3)).toBe("3");
  });

  test("prose escapes, then renders backticks as code", () => {
    expect(prose("Run `a<b` now")).toBe("Run <code>a&lt;b</code> now");
  });

  test("plain drops the backticks", () => {
    expect(plain("`x` and `y`")).toBe("x and y");
  });

  test("plural counts in the word's own form", () => {
    expect(plural(1, "change")).toBe("1 change");
    expect(plural(2, "change")).toBe("2 changes");
    expect(plural(2, "finding gets", "findings get")).toBe("2 findings get");
  });
});

describe("diff", () => {
  test("wdiff marks only the words that changed", () => {
    expect(
      wdiff(
        "Run `composer test` before a push.",
        "Run `composer test` before every push.",
      ),
    ).toEqual([
      "Run `composer test` before <mark>a</mark> push.",
      "Run `composer test` before <mark>every</mark> push.",
    ]);
  });

  test("wdiff joins changed words across the space between them", () => {
    expect(wdiff("a b c", "x y z")).toEqual([
      "<mark>a b c</mark>",
      "<mark>x y z</mark>",
    ]);
  });

  test("similarity is the share of tokens in common", () => {
    expect(similarity("same words", "same words")).toBe(1);
    expect(similarity("a b", "c d")).toBeCloseTo(1 / 3);
    expect(similarity("", "x")).toBe(0);
  });

  test("similarity gives up on lines too long to compare", () => {
    expect(similarity("x ".repeat(600), "x ".repeat(600))).toBe(0);
  });

  test("editRows pairs removed and written lines that read alike", () => {
    expect(
      editRows(
        [
          { n: 5, text: "- Use Pest for <tests>." },
          { n: 6, text: "- Unrelated line." },
        ],
        ["- Use Pest for every test.", "- Brand new."],
      ),
    ).toEqual([
      line("del", 5, "- Use Pest for <mark>&lt;tests&gt;</mark>."),
      line("del", 6, "- <mark>Unrelated line</mark>."),
      line("ins", "+", "- Use Pest for <mark>every test</mark>."),
      line("ins", "+", "- <mark>Brand new</mark>."),
    ]);
  });

  test("editRows escapes lines that pair with nothing", () => {
    expect(editRows([{ n: 1, text: "<b>" }], [])).toEqual([
      line("del", 1, "&lt;b&gt;"),
    ]);
    expect(editRows([{ n: 1, text: "alpha" }], ["omega"])).toEqual([
      line("del", 1, "alpha"),
      line("ins", "+", "omega"),
    ]);
  });

  test("line keeps an empty line one space tall", () => {
    expect(line("ctx", "", "")).toBe(
      '<div class="dl ctx"><span class="g"></span><span class="t"> </span></div>',
    );
  });
});
