// Functions that run inside the rendered figure. Puppeteer serializes each
// one into the page, so they stay self-contained: no runtime imports and
// no references to module scope.
import type { Box, Measurement } from "./checks";

// The page globals these functions read, typed here so the DOM library
// stays out of the Bun scripts that share the TypeScript program.
interface PageElement {
  readonly classList: Iterable<string>;
  readonly tagName: string;
  readonly textContent: string | null;
  readonly parentElement: PageElement | null;
  readonly scrollWidth: number;
  readonly scrollHeight: number;
  readonly clientWidth: number;
  readonly clientHeight: number;
  readonly style: { height: string };
  getBoundingClientRect(): Box;
  querySelectorAll(selectors: string): Iterable<PageElement>;
  closest(selectors: string): PageElement | null;
}

declare const document: {
  querySelector(selectors: string): PageElement;
  createTreeWalker(
    root: PageElement,
    whatToShow: number,
  ): {
    nextNode(): unknown;
    readonly currentNode: Pick<PageElement, "parentElement" | "textContent">;
  };
  readonly fonts: Iterable<{ status: string; family: string; weight: string }>;
};
declare const NodeFilter: { readonly SHOW_TEXT: number };
declare function getComputedStyle(element: PageElement): {
  textTransform: string;
  fontSize: string;
  lineHeight: string;
};

export function measureFigure(): Measurement {
  const canvas = document.querySelector(".canvas");
  const elements = [canvas, ...canvas.querySelectorAll("*")];
  const indexOf = new Map(elements.map((element, index) => [element, index]));

  const texts: Measurement["texts"] = [];
  const walker = document.createTreeWalker(canvas, NodeFilter.SHOW_TEXT);

  while (walker.nextNode()) {
    const parent = walker.currentNode.parentElement ?? canvas;

    texts.push({
      element: indexOf.get(parent) ?? 0,
      text: walker.currentNode.textContent ?? "",
      uppercase: getComputedStyle(parent).textTransform === "uppercase",
      quoted: parent.closest("code, .quote") !== null,
    });
  }

  return {
    failedFonts: [...document.fonts]
      .filter((face) => face.status === "error")
      .map((face) => `${face.family} ${face.weight}`),
    overflow: {
      x: canvas.scrollWidth - canvas.clientWidth,
      y: canvas.scrollHeight - canvas.clientHeight,
    },
    elements: elements.map((element, index) => {
      const style = getComputedStyle(element);
      const fontSize = Number.parseFloat(style.fontSize);
      const { left, top, right, bottom } = element.getBoundingClientRect();

      return {
        parent:
          index === 0 || element.parentElement === null
            ? -1
            : (indexOf.get(element.parentElement) ?? -1),
        classes: [...element.classList],
        tag: element.tagName.toLowerCase(),
        text: (element.textContent ?? "").trim().replace(/\s+/g, " "),
        box: { left, top, right, bottom },
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
        fontSize,
        lineHeight: Number.parseFloat(style.lineHeight) || fontSize * 1.2,
      };
    }),
    texts,
  };
}

// Whole pixels keep the PNG and the PDF page at exact sizes.
export function roundCanvasHeight(): void {
  const canvas = document.querySelector(".canvas");
  const { top, bottom } = canvas.getBoundingClientRect();

  canvas.style.height = `${Math.ceil(bottom - top)}px`;
}
