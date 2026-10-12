import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

import { installTimeline, isolateScene, type Walkthrough } from "./timeline";

const PAGE = `
<div class="canvas">
  <header class="masthead" data-in="0.1">Title</header>
  <main class="stage">
    <section class="scene" data-duration="4" data-title="First">
      <h2 data-in="0.5">Two words</h2>
      <div class="wire" data-draw="1"><span class="label">HTTPS</span></div>
    </section>
    <section class="scene" data-title="Second">
      <div class="layer" data-in="1">
        <div class="v" data-count>5.150 tests</div>
        <div class="v" data-count data-at="2">1,240</div>
        <div class="v" data-count>18%</div>
        <div class="meter" style="--value: 80%"></div>
      </div>
    </section>
  </main>
  <footer class="colophon"><span data-fig></span><i class="progress"></i></footer>
</div>`;

let window: Window;

beforeEach(() => {
  window = new Window();
  window.document.body.innerHTML = PAGE;
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: window.document,
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: globalThis,
  });
  installTimeline();
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "document");
  Reflect.deleteProperty(globalThis, "walkthrough");
  Reflect.deleteProperty(globalThis, "window");
});

const walkthrough = () =>
  (globalThis as unknown as { walkthrough: Walkthrough }).walkthrough;
const query = (selector: string) => {
  const element = window.document.querySelector(selector);

  if (element === null) {
    throw new Error(`No ${selector} on the page.`);
  }

  return element;
};
const style = (selector: string) => query(selector).getAttribute("style") ?? "";
const counts = () =>
  [...window.document.querySelectorAll("[data-count]")].map(
    (element) => element.textContent,
  );

describe("installTimeline", () => {
  test("lays the scenes end to end, five seconds when a scene sets no duration", () => {
    const { duration, fade, scenes } = walkthrough();

    expect(duration).toBe(9);
    expect(fade).toBe(0.4);
    expect(
      scenes.map(({ title, start, end }) => ({ title, start, end })),
    ).toEqual([
      { title: "First", start: 0, end: 4 },
      { title: "Second", start: 4, end: 9 },
    ]);
  });

  test("knows when each scene settles and how many words it shows", () => {
    expect(
      walkthrough().scenes.map(({ settled, words }) => ({ settled, words })),
    ).toEqual([
      { settled: 1.5, words: 3 },
      { settled: 3.2, words: 4 },
    ]);
  });
});

describe("scene durations", () => {
  test("fall back to five seconds, and name what they refuse", () => {
    window.document.body.innerHTML = [
      "Infinity",
      "-2",
      "6s",
      "",
      "1e309",
      "2.5",
    ]
      .map(
        (written) =>
          `<section class="scene" data-duration="${written}"></section>`,
      )
      .join("");
    installTimeline();

    expect(
      walkthrough().scenes.map(({ end, invalidDuration }) => ({
        end,
        invalidDuration,
      })),
    ).toEqual([
      { end: 5, invalidDuration: "Infinity" },
      { end: 10, invalidDuration: "-2" },
      { end: 15, invalidDuration: "6s" },
      { end: 20, invalidDuration: "" },
      { end: 25, invalidDuration: "1e309" },
      { end: 27.5, invalidDuration: null },
    ]);
  });
});

describe("render", () => {
  test("fades scenes in and out and names the one on screen", () => {
    walkthrough().render(0.2);
    expect(style(".scene[data-title='First']")).toContain("opacity: 0.5");

    walkthrough().render(3.8);
    expect(style(".scene[data-title='First']")).toContain("opacity: 0.5");
    expect(style(".scene[data-title='Second']")).toContain(
      "visibility: hidden",
    );

    walkthrough().render(9);
    expect(style(".scene[data-title='First']")).toContain("visibility: hidden");
    expect(style(".scene[data-title='Second']")).toContain("opacity: 1");
    expect(query("[data-fig]").textContent).toBe("Fig. 2 · Second");
    expect(style(".progress")).toContain("width: 100%");
  });

  test("reveals elements from their scene's start, and the masthead from zero", () => {
    walkthrough().render(0.1);
    expect(style(".masthead")).toContain("opacity: 0");
    expect(style("h2")).toContain("translateY(10px)");

    walkthrough().render(1.2);
    expect(style(".masthead")).toContain("opacity: 1");
    expect(style("h2")).toContain("opacity: 1");
    expect(style("h2")).not.toContain("translateY");
  });

  test("draws a wire, and lands the arrowhead at the end", () => {
    walkthrough().render(1.1);
    expect(style(".wire")).toContain("--arrow: 0");

    walkthrough().render(1.5);
    expect(style(".wire")).toContain("--draw: 1");
    expect(style(".wire")).toContain("--arrow: 1");
  });

  test("counts up with each number's own separator, and ends on its text", () => {
    walkthrough().render(4);
    expect(counts()).toEqual(["0 tests", "0", "0%"]);

    walkthrough().render(5.6);
    expect(counts()).toEqual(["4.506 tests", "0", "16%"]);

    walkthrough().render(9);
    expect(counts()).toEqual(["5.150 tests", "1,240", "18%"]);
  });

  test("fills a meter to its value", () => {
    walkthrough().render(4);
    expect(style(".meter")).toContain("--value: 0%");

    walkthrough().render(9);
    expect(style(".meter")).toContain("--value: 80%");
  });
});

describe("isolateScene", () => {
  test("hides every other scene, and -1 shows them all again", () => {
    isolateScene(1);
    expect(style(".scene[data-title='First']")).toContain("display: none");
    expect(style(".scene[data-title='Second']")).not.toContain("display");

    isolateScene(-1);
    expect(style(".scene[data-title='First']")).not.toContain("display");
  });
});
