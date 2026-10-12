import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

import { measureFigure, roundCanvasHeight } from "./measure";

// happy-dom has no layout, so these tests cover what the functions read and
// how they link elements. renderer.test.ts measures real boxes in Chrome.
const GLOBALS = ["document", "getComputedStyle", "NodeFilter"] as const;

function loadPage(body: string): Window {
  const window = new Window();

  window.document.body.innerHTML = body;
  Object.defineProperty(window.document, "fonts", {
    value: [
      { status: "loaded", family: "Inter", weight: "400" },
      { status: "error", family: "JetBrains Mono", weight: "600" },
    ],
  });

  for (const name of GLOBALS) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value:
        name === "getComputedStyle"
          ? window.getComputedStyle.bind(window)
          : window[name],
    });
  }

  return window;
}

afterEach(() => {
  for (const name of GLOBALS) {
    Reflect.deleteProperty(globalThis, name);
  }
});

describe("measureFigure", () => {
  test("lists the canvas first and links every element to its parent", () => {
    loadPage(
      '<div class="canvas"><div class="node accent"><div class="h">  API\n server </div></div></div>',
    );

    const { elements } = measureFigure();

    expect(
      elements.map(({ parent, classes, tag, text }) => ({
        parent,
        classes,
        tag,
        text,
      })),
    ).toEqual([
      { parent: -1, classes: ["canvas"], tag: "div", text: "API server" },
      {
        parent: 0,
        classes: ["node", "accent"],
        tag: "div",
        text: "API server",
      },
      { parent: 1, classes: ["h"], tag: "div", text: "API server" },
    ]);
    expect(elements[0]?.box).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
  });

  test("reads the text with its case and whether it is quoted", () => {
    loadPage(
      '<div class="canvas"><span class="label" style="text-transform: uppercase">publica.la</span><div class="quote">a; b</div><p><code>c; d</code></p></div>',
    );

    expect(measureFigure().texts).toEqual([
      { element: 1, text: "publica.la", uppercase: true, quoted: false },
      { element: 2, text: "a; b", uppercase: false, quoted: true },
      { element: 4, text: "c; d", uppercase: false, quoted: true },
    ]);
  });

  test("names the fonts that failed and reads sizes from the computed style", () => {
    loadPage(
      '<div class="canvas"><div class="d" style="font-size: 10px; line-height: 14px">x</div><div class="d" style="font-size: 10px">y</div></div>',
    );

    const { failedFonts, overflow, elements } = measureFigure();

    expect(failedFonts).toEqual(["JetBrains Mono 600"]);
    expect(overflow).toEqual({ x: 0, y: 0 });
    expect(elements[1]?.lineHeight).toBe(14);
    expect(elements[2]?.lineHeight).toBe(12);
  });
});

describe("roundCanvasHeight", () => {
  test("fixes the canvas height in whole pixels", () => {
    const window = loadPage('<div class="canvas"></div>');

    roundCanvasHeight();

    expect(
      window.document.querySelector(".canvas")?.getAttribute("style"),
    ).toBe("height: 0px;");
  });
});
