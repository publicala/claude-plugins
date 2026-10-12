// The walkthrough timeline. It runs inside the page, so it stays
// self-contained: no imports and no references to module scope. It sets
// window.walkthrough, whose render(t) draws the frame at t seconds, the same
// way every time.
import type { PageDocument, PageElement } from "./page-globals";

export interface SceneTiming {
  title: string;
  start: number;
  end: number;
  /** Seconds after the scene starts when its last element is in place. */
  settled: number;
  words: number;
}

export interface Walkthrough {
  duration: number;
  fade: number;
  scenes: SceneTiming[];
  render(t: number): void;
}

declare const document: PageDocument;
declare const window: { walkthrough?: Walkthrough };

export function installTimeline(): void {
  const FADE = 0.4;
  const REVEAL = 0.55;
  const DRAW = 0.5;
  const COUNT = 1.2;
  const FILL = 0.9;

  const clamp = (x: number) => Math.max(0, Math.min(1, x));
  const ease = (x: number) => 1 - (1 - x) ** 3;
  const seconds = (value: string | undefined) =>
    Number.parseFloat(value ?? "0") || 0;

  let cursor = 0;
  const scenes = [...document.querySelectorAll(".scene")].map((element) => {
    const start = cursor;

    cursor += seconds(element.dataset.duration) || 5;

    return { element, title: element.dataset.title ?? "", start, end: cursor };
  });
  const duration = cursor;

  // An offset counts from the start of its scene, or from 0 outside scenes.
  const sceneStart = (element: PageElement) =>
    scenes.find((scene) => scene.element.contains(element))?.start ?? 0;
  const revealOf = (element: PageElement) =>
    seconds(element.closest("[data-in]")?.dataset.in);

  const timed = (attribute: "in" | "draw", length: number) =>
    [...document.querySelectorAll(`[data-${attribute}]`)].map((element) => {
      const offset = seconds(element.dataset[attribute]);

      return { element, offset, at: sceneStart(element) + offset, length };
    });

  const reveals = timed("in", REVEAL);
  const draws = timed("draw", DRAW);
  // A count reads its number from its own text and keeps the grouping
  // separator, so "5.150" counts as 5.150 and "1,240" as 1,240.
  const counts = [...document.querySelectorAll("[data-count]")].map(
    (element) => {
      const text = element.textContent ?? "";
      const number = /\d+(?:[.,\u00a0 ]\d{3})*/.exec(text)?.[0] ?? "0";
      const separator = /\d([.,\u00a0 ])\d{3}/.exec(number)?.[1] ?? "";
      const offset =
        element.dataset.at === undefined
          ? revealOf(element)
          : seconds(element.dataset.at);

      return {
        element,
        text,
        value: Number(number.replace(/\D/g, "")),
        before: text.slice(0, text.indexOf(number)),
        after: text.slice(text.indexOf(number) + number.length),
        separator,
        offset,
        at: sceneStart(element) + offset,
        length: COUNT,
      };
    },
  );
  const meters = [...document.querySelectorAll(".scene .meter")].map(
    (element) => {
      const offset = revealOf(element);

      return {
        element,
        value: seconds(element.style.getPropertyValue("--value")),
        offset,
        at: sceneStart(element) + offset,
        length: FILL,
      };
    },
  );

  const fig = document.querySelector("[data-fig]");
  const progress = document.querySelector(".progress");

  const render = (t: number) => {
    scenes.forEach((scene, index) => {
      const last = index === scenes.length - 1;
      const on = t >= scene.start && (t < scene.end || last);
      const fadeOut = last ? 1 : clamp((scene.end - t) / FADE);
      const opacity = on
        ? Math.min(clamp((t - scene.start) / FADE), fadeOut)
        : 0;

      scene.element.style.opacity = String(opacity);
      scene.element.style.visibility = opacity > 0 ? "visible" : "hidden";

      if (on && fig) {
        fig.textContent = `Fig. ${index + 1} · ${scene.title}`;
      }
    });

    for (const { element, at, length } of reveals) {
      const p = ease(clamp((t - at) / length));

      element.style.opacity = String(p);
      element.style.transform = p < 1 ? `translateY(${(1 - p) * 10}px)` : "";
    }

    for (const { element, at, length } of draws) {
      const p = ease(clamp((t - at) / length));

      element.style.setProperty("--draw", String(p));
      element.style.setProperty("--arrow", p > 0.98 ? "1" : "0");
    }

    for (const {
      element,
      text,
      value,
      before,
      after,
      separator,
      at,
      length,
    } of counts) {
      const p = ease(clamp((t - at) / length));
      const grouped = String(Math.round(value * p)).replace(
        /\B(?=(\d{3})+(?!\d))/g,
        separator,
      );

      element.textContent = p < 1 ? before + grouped + after : text;
    }

    for (const { element, value, at, length } of meters) {
      element.style.setProperty(
        "--value",
        `${value * ease(clamp((t - at) / length))}%`,
      );
    }

    if (progress) {
      progress.style.width = `${clamp(t / duration) * 100}%`;
    }
  };

  const motions = [...reveals, ...draws, ...counts, ...meters];

  window.walkthrough = {
    duration,
    fade: FADE,
    scenes: scenes.map(({ element, title, start, end }) => ({
      title,
      start,
      end,
      settled: Math.max(
        0,
        ...motions
          .filter((motion) => element.contains(motion.element))
          .map((motion) => motion.offset + motion.length),
      ),
      words: (element.textContent ?? "")
        .split(/\s+/)
        .filter((word) => /[\p{L}\p{N}]/u.test(word)).length,
    })),
    render,
  };

  render(0);
}

// Shows one scene alone, so the figure checks measure it without the others.
export function isolateScene(index: number): void {
  [...document.querySelectorAll(".scene")].forEach((scene, position) => {
    scene.style.display = index === -1 || position === index ? "" : "none";
  });
}
