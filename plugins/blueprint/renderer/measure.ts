// Functions that run inside the rendered figure. Puppeteer serializes each
// one into the page, so they stay self-contained: no runtime imports and
// no references to module scope.
import type { Measurement } from "./checks";
import type {
  PageComputedStyle,
  PageDocument,
  PageElement,
  PageText,
} from "./page-globals";

declare const document: PageDocument;
declare const NodeFilter: {
  readonly SHOW_ELEMENT: number;
  readonly SHOW_TEXT: number;
  readonly FILTER_ACCEPT: number;
  readonly FILTER_REJECT: number;
};
declare function getComputedStyle(element: PageElement): PageComputedStyle;

export function measureFigure(): Measurement {
  const canvas = document.querySelector(".canvas");

  if (canvas === null) {
    throw new Error("The page has no canvas.");
  }

  // A hidden element leaves out everything inside it, so the checks judge
  // only what shows, such as the one scene a walkthrough isolates.
  const rendered = document.createTreeWalker<PageElement>(
    canvas,
    NodeFilter.SHOW_ELEMENT,
    (element) =>
      getComputedStyle(element).display === "none"
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  );
  const elements = [canvas];

  while (rendered.nextNode()) {
    elements.push(rendered.currentNode);
  }

  const indexOf = new Map(elements.map((element, index) => [element, index]));

  const texts: Measurement["texts"] = [];
  const walker = document.createTreeWalker<PageText>(
    canvas,
    NodeFilter.SHOW_TEXT,
  );

  while (walker.nextNode()) {
    const parent = walker.currentNode.parentElement ?? canvas;
    const element = indexOf.get(parent);

    if (element === undefined) {
      continue;
    }

    texts.push({
      element,
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

  if (canvas === null) {
    throw new Error("The page has no canvas.");
  }

  const { top, bottom } = canvas.getBoundingClientRect();

  canvas.style.height = `${Math.ceil(bottom - top)}px`;
}
