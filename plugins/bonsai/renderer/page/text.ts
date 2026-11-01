// Text helpers the page builds its HTML with. They touch no DOM.

const ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export type Text = string | number | null | undefined;

export const esc = (s: Text): string =>
  String(s ?? "").replace(/[&<>"']/g, (ch) => ENTITIES[ch] ?? ch);

/** Escapes, then renders text in backticks as code. */
export const prose = (s: Text): string =>
  esc(s).replace(/`([^`]+)`/g, "<code>$1</code>");

/** Drops the backticks, for text that leaves the page as plain text. */
export const plain = (s: string): string => s.replace(/`/g, "");

export const plural = (n: number, one: string, many = one + "s"): string =>
  `${n} ${n === 1 ? one : many}`;
