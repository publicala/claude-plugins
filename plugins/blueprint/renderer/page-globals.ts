// Types for the page globals that the in-page functions (measure.ts,
// timeline.ts) read. Each of those files declares the globals it uses with
// these types, so the DOM library stays out of the Bun scripts that share
// the TypeScript program.

export interface PageBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface PageStyle {
  height: string;
  width: string;
  opacity: string;
  visibility: string;
  transform: string;
  display: string;
  setProperty(name: string, value: string): void;
  getPropertyValue(name: string): string;
}

export interface PageElement {
  readonly classList: Iterable<string>;
  readonly tagName: string;
  textContent: string | null;
  readonly parentElement: PageElement | null;
  readonly scrollWidth: number;
  readonly scrollHeight: number;
  readonly clientWidth: number;
  readonly clientHeight: number;
  readonly style: PageStyle;
  readonly dataset: Record<string, string | undefined>;
  getBoundingClientRect(): PageBox;
  getAttribute(name: string): string | null;
  querySelector(selectors: string): PageElement | null;
  querySelectorAll(selectors: string): Iterable<PageElement>;
  closest(selectors: string): PageElement | null;
  contains(other: PageElement): boolean;
}

export interface PageDocument {
  querySelector(selectors: string): PageElement | null;
  querySelectorAll(selectors: string): Iterable<PageElement>;
  createTreeWalker(
    root: PageElement,
    whatToShow: number,
  ): {
    nextNode(): unknown;
    readonly currentNode: Pick<PageElement, "parentElement" | "textContent">;
  };
  readonly fonts: Iterable<{ status: string; family: string; weight: string }>;
}

export interface ComputedStyle {
  textTransform: string;
  fontSize: string;
  lineHeight: string;
}
