// The walkthrough timeline. It runs inside the page, so it stays
// self-contained: no runtime imports and no references to module scope.
// It sets window.walkthrough, whose render(t) draws the frame at t
// seconds, the same way every time.
import type { PageDocument, PageElement } from "./page-globals";

export interface SceneTiming {
  title: string;
  start: number;
  end: number;
  /** Seconds after the scene starts when its last element is in place. */
  settled: number;
  /** Equal to end for the last scene, which never fades out. */
  fadesOutAt: number;
  words: number;
  /** A data-duration that is not a number of seconds above zero, as written. */
  invalidDuration: string | null;
}

interface Walkthrough {
  duration: number;
  scenes: SceneTiming[];
  /** The frame that stands for the video: the first scene in full, or 0. */
  poster: number;
  render(t: number): void;
}

export type Timing = Omit<Walkthrough, "render">;

declare const document: PageDocument;
declare const window: { walkthrough: Walkthrough };

export function installTimeline(): void {
  const FADE = 0.4;
  const DEFAULT_DURATION = 5;
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
    const written = element.dataset.duration;
    const length = written === undefined ? DEFAULT_DURATION : Number(written);
    const isValid = Number.isFinite(length) && length > 0;

    cursor += isValid ? length : DEFAULT_DURATION;

    return {
      element,
      title: element.dataset.title ?? "",
      start,
      end: cursor,
      invalidDuration: isValid ? null : (written ?? null),
    };
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
        value:
          Number.parseFloat(element.style.getPropertyValue("--value")) || 0,
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
      const isLast = index === scenes.length - 1;
      const isOnScreen = t >= scene.start && (t < scene.end || isLast);
      const fadeOut = isLast ? 1 : clamp((scene.end - t) / FADE);
      const opacity = isOnScreen
        ? Math.min(clamp((t - scene.start) / FADE), fadeOut)
        : 0;

      scene.element.style.opacity = String(opacity);
      scene.element.style.visibility = opacity > 0 ? "visible" : "hidden";

      if (isOnScreen && fig) {
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

  const timings = scenes.map(
    ({ element, title, start, end, invalidDuration }, index) => ({
      title,
      start,
      end,
      fadesOutAt: index === scenes.length - 1 ? end : end - FADE,
      invalidDuration,
      settled: Math.max(
        0,
        ...motions
          .filter((motion) => element.contains(motion.element))
          .map((motion) => motion.offset + motion.length),
      ),
      words: (element.textContent ?? "")
        .split(/\s+/)
        .filter((word) => /[\p{L}\p{N}]/u.test(word)).length,
    }),
  );

  window.walkthrough = {
    duration,
    scenes: timings,
    poster: timings[0] === undefined ? 0 : timings[0].fadesOutAt - 0.01,
    render,
  };

  render(0);
}

// page.evaluate returns plain data, so the timing leaves render behind.
export function readTiming(): Timing {
  const { duration, scenes, poster } = window.walkthrough;

  return { duration, scenes, poster };
}

export function renderFrame(t: number): void {
  window.walkthrough.render(t);
}

// Shows one scene alone, so the figure checks measure it without the others.
export function isolateScene(index: number): void {
  [...document.querySelectorAll(".scene")].forEach((scene, position) => {
    scene.style.display = position === index ? "" : "none";
  });
}

export function showAllScenes(): void {
  for (const scene of document.querySelectorAll(".scene")) {
    scene.style.display = "";
  }
}
