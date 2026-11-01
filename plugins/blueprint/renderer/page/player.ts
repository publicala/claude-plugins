// The player page's script: play, pause and scrub the walkthrough the
// timeline (../timeline.ts) installed as window.walkthrough. walkthrough.ts
// bundles it into the page.
import type { Walkthrough } from "../timeline";

declare global {
  interface Window {
    walkthrough: Walkthrough;
  }
}

/** The player's own element: a missing one throws. */
function element<T extends Element>(
  root: ParentNode,
  selector: string,
  type: new () => T,
): T {
  const el = root.querySelector(selector);
  if (!(el instanceof type)) {
    throw new Error(`The player has no ${type.name} at ${selector}.`);
  }
  return el;
}

const screen = element(document, ".screen", HTMLElement);
const canvas = element(screen, ".canvas", HTMLElement);
const button = element(document, ".controls button", HTMLButtonElement);
const scrubber = element(document, ".controls input", HTMLInputElement);
const clock = element(document, ".controls output", HTMLOutputElement);
const { duration, poster, render } = window.walkthrough;

// Paused, the player shows the poster: the first scene in full.
let t = poster;
let started = false;
let playing = false;
let last = 0;

const time = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

const show = () => {
  render(t);
  scrubber.value = String(t);
  clock.textContent = `${time(t)} / ${time(duration)}`;
};

const setPlaying = (value: boolean) => {
  playing = value;
  button.setAttribute("aria-label", playing ? "Pause" : "Play");
  element(button, ".play", HTMLElement).toggleAttribute("hidden", playing);
  element(button, ".pause", HTMLElement).toggleAttribute("hidden", !playing);
};

const tick = (now: number) => {
  if (!playing) {
    return;
  }

  t = Math.min(duration, t + (now - last) / 1000);
  last = now;
  show();

  if (t >= duration) {
    setPlaying(false);
  } else {
    requestAnimationFrame(tick);
  }
};

const toggle = () => {
  setPlaying(!playing);

  if (!playing) {
    return;
  }

  if (!started || t >= duration) {
    t = 0;
    started = true;
  }

  last = performance.now();
  requestAnimationFrame(tick);
};

const fit = () => {
  screen.style.setProperty(
    "--fit",
    String(screen.clientWidth / canvas.offsetWidth),
  );
};

document.body.style.setProperty("--canvas-width", `${canvas.offsetWidth}px`);
scrubber.max = String(duration);
scrubber.addEventListener("input", () => {
  started = true;
  t = Number(scrubber.value);
  show();
});
button.addEventListener("click", toggle);
screen.addEventListener("click", toggle);
document.addEventListener("keydown", (event) => {
  if (event.key === " " && event.target === document.body) {
    event.preventDefault();
    toggle();
  }
});
new ResizeObserver(fit).observe(screen);

fit();
show();
