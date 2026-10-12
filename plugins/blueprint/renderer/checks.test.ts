import { describe, expect, test } from "bun:test";

import {
  type Box,
  findFigureProblems,
  type MeasuredElement,
  type MeasuredText,
  type Measurement,
} from "./checks";

const CANVAS: Box = { left: 0, top: 0, right: 1600, bottom: 900 };

function element(
  overrides: Partial<MeasuredElement> & { classes?: string[] } = {},
): MeasuredElement {
  return {
    parent: 0,
    classes: [],
    tag: "div",
    text: "",
    box: { left: 10, top: 10, right: 110, bottom: 40 },
    scrollWidth: 100,
    clientWidth: 100,
    scrollHeight: 30,
    clientHeight: 30,
    fontSize: 13.5,
    lineHeight: 16,
    ...overrides,
  };
}

function measure({
  elements = [],
  texts = [],
  failedFonts = [],
  overflow = { x: 0, y: 0 },
}: {
  elements?: MeasuredElement[];
  texts?: MeasuredText[];
  failedFonts?: string[];
  overflow?: { x: number; y: number };
}): Measurement {
  return {
    failedFonts,
    overflow,
    elements: [
      element({ parent: -1, classes: ["canvas"], box: CANVAS }),
      ...elements,
    ],
    texts,
  };
}

function text(overrides: Partial<MeasuredText>): MeasuredText {
  return {
    element: 0,
    text: "",
    uppercase: false,
    quoted: false,
    ...overrides,
  };
}

const row = (index: number): Box => ({
  left: 10 + index * 110,
  top: 10,
  right: 110 + index * 110,
  bottom: 40,
});

describe("findFigureProblems", () => {
  test("passes a clean figure", () => {
    expect(
      findFigureProblems(
        measure({
          elements: [
            element({ classes: ["node", "accent"], box: row(0) }),
            element({ classes: ["node"], box: row(1) }),
          ],
          texts: [text({ text: "publica.la" })],
        }),
      ),
    ).toEqual([]);
  });

  test("names fonts that failed to load", () => {
    expect(findFigureProblems(measure({ failedFonts: ["Inter 400"] }))).toEqual(
      ["Fonts failed to load: Inter 400."],
    );
  });

  test("reports content that runs past the canvas, and elements outside it", () => {
    expect(
      findFigureProblems(
        measure({
          overflow: { x: -2, y: 40 },
          elements: [
            element({
              text: "Too low",
              box: { left: 10, top: 880, right: 110, bottom: 940 },
            }),
            element({ box: { left: 0, top: 2000, right: 0, bottom: 2000 } }),
          ],
        }),
      ),
    ).toEqual([
      "The content runs past the canvas by 0px across and 40px down. Shorten it or pick a larger data-size.",
      '"Too low" sits outside the canvas.',
    ]);
  });

  test("reports text that overflows a box across or down, and sheet cells too", () => {
    expect(
      findFigureProblems(
        measure({
          elements: [
            element({ classes: ["label"], text: "Wide", scrollWidth: 140 }),
            element({ classes: ["sheet"], box: row(1) }),
            element({
              parent: 2,
              tag: "td",
              text: "Cell",
              box: row(1),
              scrollWidth: 130,
            }),
            element({
              tag: "td",
              text: "Loose",
              box: row(2),
              scrollWidth: 130,
            }),
            element({
              classes: ["node"],
              text: "Tall",
              box: row(3),
              scrollHeight: 52,
            }),
          ],
        }),
      ),
    ).toEqual([
      '"Wide" overflows its box.',
      '"Cell" overflows its box.',
      '"Tall" overflows its box.',
    ]);
  });

  test("reports a node title that wraps and a description past two lines", () => {
    expect(
      findFigureProblems(
        measure({
          elements: [
            element({ classes: ["node"], box: { ...row(0), bottom: 200 } }),
            element({
              parent: 1,
              classes: ["h"],
              text: "A long title",
              box: { ...row(0), bottom: 50 },
            }),
            element({
              parent: 1,
              classes: ["d"],
              text: "A long description",
              box: { ...row(0), top: 50, bottom: 98 },
            }),
            element({ classes: ["stat"], box: row(2) }),
            element({
              parent: 4,
              classes: ["d"],
              box: { ...row(2), bottom: 200 },
            }),
          ],
        }),
      ),
    ).toEqual([
      'The node title "A long title" wraps to a second line.',
      'The node description "A long description" takes 3 lines. Keep it to two.',
    ]);
  });

  test("allows one accented node", () => {
    expect(
      findFigureProblems(
        measure({
          elements: [
            element({ classes: ["node", "accent"], text: "One", box: row(0) }),
            element({ classes: ["node", "accent"], text: "Two", box: row(1) }),
          ],
        }),
      ),
    ).toEqual([
      '2 nodes are accented ("One", "Two"). Accent one node at most.',
    ]);
  });

  test("caps a figure at 25 nodes", () => {
    const nodes = Array.from({ length: 26 }, (_, index) =>
      element({
        classes: ["node"],
        box: {
          left: (index % 13) * 120,
          top: 10 + Math.floor(index / 13) * 40,
          right: (index % 13) * 120 + 110,
          bottom: 40 + Math.floor(index / 13) * 40,
        },
      }),
    );

    expect(findFigureProblems(measure({ elements: nodes }))).toEqual([
      "The figure has 26 nodes. Keep it to 25 at most, or make two figures.",
    ]);
  });

  test("asks every wire for a label, and names the wire by what comes before it", () => {
    expect(
      findFigureProblems(
        measure({
          elements: [
            element({ classes: ["layer"], text: "Clients", box: row(0) }),
            element({ classes: ["wire"], box: row(1) }),
            element({ parent: 2, classes: ["label"], box: row(1) }),
            element({ classes: ["layer"], text: "Edge", box: row(2) }),
            element({ classes: ["hwire"], box: row(3) }),
            element({ classes: ["flow"], box: { ...row(4), bottom: 300 } }),
            element({ parent: 6, classes: ["hwire"], box: row(4) }),
          ],
        }),
      ),
    ).toEqual([
      'The wire after "Edge" has no label. Say what crosses it, for example HTTPS.',
      'The first wire in "flow" has no label. Say what crosses it, for example HTTPS.',
    ]);
  });

  test("reports split columns whose layers end at different heights", () => {
    const split = (rightBottom: number) =>
      measure({
        elements: [
          element({ classes: ["split"], box: { ...CANVAS, bottom: 600 } }),
          element({
            parent: 1,
            classes: ["stack"],
            box: { left: 0, top: 0, right: 1000, bottom: 600 },
          }),
          element({
            parent: 2,
            classes: ["layer"],
            box: { left: 0, top: 0, right: 1000, bottom: 500 },
          }),
          element({
            parent: 1,
            classes: ["side"],
            box: { left: 1100, top: 0, right: 1600, bottom: 600 },
          }),
          element({
            parent: 4,
            classes: ["layer", "boxed"],
            box: { left: 1100, top: 0, right: 1600, bottom: rightBottom },
          }),
          element({
            parent: 1,
            classes: ["note"],
            box: { left: 1000, top: 0, right: 1100, bottom: 10 },
          }),
        ],
      });

    expect(findFigureProblems(split(500))).toEqual([]);
    expect(findFigureProblems(split(420))).toEqual([
      "The columns of a split end 80px apart. Add grow to the last layer of the shorter column, or move a node between columns.",
    ]);
  });

  test("reports elements that overlap, but not one inside another", () => {
    expect(
      findFigureProblems(
        measure({
          elements: [
            element({
              classes: ["layer"],
              text: "Layer",
              box: { left: 0, top: 0, right: 600, bottom: 200 },
            }),
            element({
              parent: 1,
              classes: ["node"],
              text: "Inside",
              box: row(0),
            }),
            element({
              classes: ["callout"],
              text: "Callout",
              box: { left: 500, top: 150, right: 900, bottom: 250 },
            }),
          ],
        }),
      ),
    ).toEqual(['"Layer" overlaps "Callout".']);
  });

  test("checks the text a reader sees", () => {
    expect(
      findFigureProblems(
        measure({
          elements: [element({ classes: ["label"], text: "Label" })],
          texts: [
            text({ element: 1, text: "publica.la", uppercase: true }),
            text({ element: 1, text: "By PUBLICA.LA" }),
            text({ element: 1, text: "One — two" }),
            text({ element: 1, text: "One; two" }),
            text({ element: 1, text: "It’s" }),
          ],
        }),
      ),
    ).toEqual([
      '"publica.la" renders in uppercase in "Label". Write it in lowercase, and wrap it in <span class="verbatim"> inside a label.',
      '"publica.la" renders in uppercase in "Label". Write it in lowercase, and wrap it in <span class="verbatim"> inside a label.',
      '"Label" has an em dash. Use parentheses or split the sentence.',
      '"Label" has a semicolon. Split it into two sentences.',
      '"Label" has a curly quote. Use straight quotes.',
    ]);
  });

  test("leaves quoted text and code in their own conventions, except the brand", () => {
    expect(
      findFigureProblems(
        measure({
          texts: [
            text({ text: "const a = 1; — “quoted”", quoted: true }),
            text({ text: "PUBLICA.LA", uppercase: true, quoted: true }),
          ],
        }),
      ),
    ).toEqual([
      '"publica.la" renders in uppercase in "canvas". Write it in lowercase, and wrap it in <span class="verbatim"> inside a label.',
    ]);
  });

  test("refuses a measurement that points at a missing element", () => {
    expect(() =>
      findFigureProblems(
        measure({ elements: [element({ parent: 7, classes: ["h"] })] }),
      ),
    ).toThrow("The measurement has no element 7.");
  });
});
