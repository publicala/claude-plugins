// Diff rows: the lines an edit removes and writes, with word marks on the
// pairs that read as edits of each other. They touch no DOM.
import type { Line } from "./data";
import { esc } from "./text";

/* ---------- word-level diff: LCS on tokens, marks only what changed ---------- */
const tokens = (s: string): string[] =>
  s.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) ?? [];

/** dp[i][j] is the LCS length of A from i and B from j. */
const cell = (dp: Uint16Array[], i: number, j: number): number =>
  dp[i]?.[j] ?? 0;

function lcs(A: string[], B: string[]): Uint16Array[] {
  const n = A.length,
    m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    const row = dp[i];
    if (!row) continue;
    for (let j = m - 1; j >= 0; j--)
      row[j] =
        A[i] === B[j]
          ? cell(dp, i + 1, j + 1) + 1
          : Math.max(cell(dp, i + 1, j), cell(dp, i, j + 1));
  }
  return dp;
}

export function similarity(a: string, b: string): number {
  const A = tokens(a),
    B = tokens(b);
  if (!A.length || !B.length || A.length * B.length > 250000) return 0;
  return (2 * cell(lcs(A, B), 0, 0)) / (A.length + B.length);
}

/** A token and whether it changed: 1 when it did. */
type Part = [string, number];

export function wdiff(a: string, b: string): [string, string] {
  const A = tokens(a),
    B = tokens(b);
  const dp = lcs(A, B),
    ra: Part[] = [],
    rb: Part[] = [];
  let i = 0,
    j = 0;
  while (i < A.length && j < B.length) {
    const ta = A[i] ?? "",
      tb = B[j] ?? "";
    if (ta === tb) {
      ra.push([ta, 0]);
      rb.push([tb, 0]);
      i++;
      j++;
    } else if (cell(dp, i + 1, j) >= cell(dp, i, j + 1)) {
      ra.push([ta, 1]);
      i++;
    } else {
      rb.push([tb, 1]);
      j++;
    }
  }
  while (i < A.length) ra.push([A[i++] ?? "", 1]);
  while (j < B.length) rb.push([B[j++] ?? "", 1]);
  const paint = (parts: Part[]) => {
    parts.forEach((p, k) => {
      if (!p[1] && /^\s+$/.test(p[0]) && parts[k - 1]?.[1] && parts[k + 1]?.[1])
        p[1] = 1;
    });
    let out = "",
      open = false;
    for (const [t, ch] of parts) {
      if (ch && !open) {
        out += "<mark>";
        open = true;
      }
      if (!ch && open) {
        out += "</mark>";
        open = false;
      }
      out += esc(t);
    }
    return out + (open ? "</mark>" : "");
  };
  return [paint(ra), paint(rb)];
}

export const line = (cls: string, g: string | number, html: string): string =>
  `<div class="dl ${cls}"><span class="g">${g}</span><span class="t">${html || " "}</span></div>`;

/* Removed and written lines, in file order, with word marks on pairs that read as edits of each other. */
export function editRows(before: Line[], after: string[]): string[] {
  const delHtml = before.map((l) => esc(l.text)),
    insHtml = after.map((t) => esc(t));
  let from = 0;
  for (const [i, removed] of before.entries()) {
    for (let j = from; j < after.length; j++) {
      const written = after[j] ?? "";
      if (similarity(removed.text, written) >= 0.4) {
        [delHtml[i], insHtml[j]] = wdiff(removed.text, written);
        from = j + 1;
        break;
      }
    }
  }
  return [
    ...before.map((l, i) => line("del", l.n, delHtml[i] ?? "")),
    ...after.map((_, j) => line("ins", "+", insHtml[j] ?? "")),
  ];
}
