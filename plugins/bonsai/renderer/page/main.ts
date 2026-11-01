// The decision page's script. build.ts bundles this module into the page,
// inside a function that holds the run as D.
import type {
  Candidate,
  Change,
  Decision,
  Edit,
  Group,
  Lane,
  PageData,
  PageFile,
  Question,
  ReplaceEdit,
} from "./data";
import { editRows, line } from "./diff";
import { type Comments, errorCode, type Sample } from "./host";
import { esc, plain, plural, prose } from "./text";

declare const D: PageData;

/** A value the page cannot work without: a missing one throws. */
function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined)
    throw new Error(`The page has no ${what}.`);
  return value;
}

const run = D.run;
const RECORD = Boolean(run.status);
const KEY = `bonsai:${run.skill}:${run.target}:${run.date}:${run.round}`;
const changes = D.changes;
const byId = Object.fromEntries(changes.map((c) => [c.id, c]));
const changeById = (id: string) => must(byId[id], `change ${id}`);
const groups = D.groups;
const groupsIn = (lane: Lane) => groups.filter((g) => g.lane === lane);
const inGroup = (gid: string) => changes.filter((c) => c.group === gid);
const calls = changes.filter((c) => c.lane === "call");
const questions = D.questions;
const callIds = [
  ...calls.map((c) => c.id),
  ...questions.map((q) => "q:" + q.id),
];
const files = Object.fromEntries(D.files.map((f) => [f.path, f]));
const fileAt = (path: string): PageFile => must(files[path], `file ${path}`);
const resident = D.files.filter((f) => f.resident);
const residentBefore = resident.reduce((n, f) => n + f.tokens, 0);
const GUARD = run.skill === "guard";
const notNow = D.notNow;
const none = D.none;
/* A guard run decides the same way, and Apply reads as Build. */
const APPLY = GUARD
  ? { label: "Build", key: "b", word: "build" }
  : { label: "Apply", key: "a", word: "apply" };
const NOUN = GUARD ? "candidate" : "change";
const SHIPS =
  "Each candidate you build becomes its own pull request from the default branch, labelled `guardrail`.";

const isCandidate = (c: Change): c is Candidate =>
  c.recommendation !== undefined &&
  c.caught !== undefined &&
  c.mistake !== undefined &&
  c.guardrail !== undefined &&
  c.cost !== undefined;
const isDecision = (v: unknown): v is Decision =>
  v === "apply" || v === "skip" || v === "later";

/* ---------- state ---------- */
interface State {
  d: Record<string, Decision | null>;
  q: Record<string, string | null>;
  note: Record<string, string>;
  custom: Record<string, string>;
  gnote: Record<string, string>;
  next: Record<string, boolean>;
  pull: Record<string, boolean>;
  ship: string | null;
  pv: string;
  file: string | null;
}
function fresh(): State {
  const s: State = {
    d: {},
    q: {},
    note: {},
    custom: {},
    gnote: {},
    next: {},
    pull: {},
    ship: D.ship?.default ?? null,
    pv: "changes",
    file: null,
  };
  for (const c of changes) s.d[c.id] = c.lane === "call" ? null : "apply";
  for (const n of D.next) s.next[n.id] = n.default !== false;
  return s;
}
const S = fresh();
if (run.status) Object.assign(S, run.status.decisions ?? {});
else {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    Object.assign(S, stored);
  } catch {
    /* No storage, or a state it cannot read: start fresh. */
  }
}
const save = () => {
  if (RECORD) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(S));
  } catch {
    /* No storage: the decisions last as long as the page. */
  }
};

/* ---------- helpers ---------- */
const find = (id: string) => document.getElementById(id);
const $ = (id: string): HTMLElement => must(find(id), `#${id}`);
function $as<T extends HTMLElement>(id: string, type: new () => T): T {
  const el = $(id);
  if (!(el instanceof type)) throw new Error(`#${id} is not a ${type.name}.`);
  return el;
}
/* A data attribute the selector already requires. */
const data = (el: HTMLElement, key: string) => el.dataset[key] ?? "";
const fmt = (n: number) => n.toLocaleString("en-US");
const estTok = (t: string) => (t ? Math.max(1, Math.round(t.length / 4)) : 0);
const link = (href: string | null, text: string, cls = "loc") =>
  href
    ? `<a class="${cls}" href="${esc(href)}" target="_blank" rel="noopener">${text}</a>`
    : `<span class="${cls}">${text}</span>`;
const range = (a: number, b: number) => (a === b ? `L${a}` : `L${a}-${b}`);
const where = (e: Edit) =>
  e.lines
    ? range(e.lines[0], e.lines[1])
    : fileAt(e.file).new
      ? "new file"
      : e.at > fileAt(e.file).lines.length
        ? "end"
        : `before L${e.at}`;

/* The one edit "Redraft with Claude" may rewrite: a single in-place edit. */
const redraftable = (c: Change) => {
  const [e] = c.edits;
  return (
    c.lane === "call" &&
    c.edits.length === 1 &&
    e !== undefined &&
    e.lines !== null &&
    e.write.length > 0
  );
};
const written = (c: Change, e: Edit) => {
  const custom = S.custom[c.id];
  return custom && redraftable(c) ? custom.split("\n") : e.write;
};
function saved(c: Change) {
  let n = 0;
  for (const e of c.edits) {
    if (!fileAt(e.file).resident) continue;
    n +=
      e.before.reduce((m, l) => m + estTok(l.text), 0) -
      written(c, e).reduce((m, t) => m + estTok(t), 0);
  }
  return n;
}
const tokText = (c: Change) => {
  const t = saved(c);
  return t > 0 ? `−${t} tokens` : t < 0 ? `+${-t} tokens` : "";
};

function diffHtml(c: Change, override?: string[]) {
  const many =
    c.edits.length > 1 || new Set(c.edits.map((e) => e.file)).size > 1;
  const rows = [];
  for (const e of c.edits) {
    const after = override ?? written(c, e);
    if (many || !e.lines)
      rows.push(
        line(
          "ctx",
          "",
          esc(
            `${e.file}, ${e.lines ? range(e.lines[0], e.lines[1]) : fileAt(e.file).new ? "new file" : e.at > fileAt(e.file).lines.length ? "at the end" : `before line ${e.at}`}`,
          ),
        ),
      );
    rows.push(...editRows(e.before, after));
  }
  return `<div class="diff">${rows.join("")}</div>`;
}
function evidenceHtml(c: Change) {
  if (!c.evidence.length) return "";
  const li = c.evidence
    .map(
      (e) =>
        `<li>${prose(e.text)}${e.href ? ` <a href="${esc(e.href)}" target="_blank" rel="noopener">open</a>` : ""}</li>`,
    )
    .join("");
  return `<details class="how"><summary>How we know</summary><ul>${li}</ul></details>`;
}
function checkHtml(c: Change) {
  if (!c.check) return "";
  const drift = c.check.verdict === "drift";
  return `<p class="check ${drift ? "drift" : ""}"><span>${drift ? "Second check found a change in meaning: " : "Second check: same meaning. "}${prose(c.check.summary)}</span></p>`;
}
function locHtml(c: Change) {
  const e = must(c.edits[0], `edit in ${c.id}`);
  const extra = c.edits.length > 1 ? ` +${c.edits.length - 1}` : "";
  return link(e.href, `${esc(e.file)} ${where(e)}${extra}`);
}

/* ---------- totals ---------- */
function totals() {
  const t = {
    apply: [] as Change[],
    skip: [] as Change[],
    later: [] as Change[],
    open: [] as Change[],
    tok: 0,
    openQuestions: [] as Question[],
    after: 0,
  };
  for (const c of changes) {
    const v = S.d[c.id];
    (v ? t[v] : t.open).push(c);
    if (v === "apply") t.tok += saved(c);
  }
  t.openQuestions = questions.filter((q) => !S.q[q.id]);
  t.after = residentBefore - t.tok;
  return t;
}
const openCalls = () =>
  calls.filter((c) => !S.d[c.id]).length +
  questions.filter((q) => !S.q[q.id]).length;

/* ---------- summary ---------- */
function renderSummary() {
  const ready = changes.filter((c) => c.lane === "ready").length;
  const auto = changes.filter((c) => c.lane === "auto").length;
  const minutes = Math.max(
    1,
    Math.round(
      (callIds.length * (GUARD ? 60 : 35) + groupsIn("ready").length * 15) / 60,
    ),
  );
  const st = run.status;
  $("summary").innerHTML = `
      <p class="eyebrow">bonsai ${esc(run.skill)} · ${esc(run.target)} · ${esc(run.date)} · round ${run.round} of ${run.rounds}</p>
      <h1 id="title">${esc(run.heading)}${run.subject ? ` <span>${esc(run.subject)}</span>` : ""}</h1>
      ${st ? `<div class="status-banner" role="status"><span><b>${esc(st.state === "applied" ? "Applied" : st.state === "built" ? "Built" : st.state)}</b>${st.date ? ` on ${esc(st.date)}` : ""}. ${prose(st.summary ?? "")}</span>${st.link ? `<a href="${esc(st.link)}" target="_blank" rel="noopener">${esc(st.link)}</a>` : ""}<span class="muted">This page is now the record of the decisions.</span></div>` : ""}
      <p class="outcome">${prose(run.outcome)}</p>
      ${resident.length ? `<div class="meter"><div class="bar" role="img" id="meter-bar"><span class="keep" id="m-keep"></span><span class="cut" id="m-cut"></span></div><div class="legend" aria-live="polite"><span id="m-text"></span><span id="m-pct"></span></div></div>` : ""}
      <div class="facts">
        ${callIds.length ? `<span class="fact callf"><b>${callIds.length}</b> need your call</span>` : ""}
        ${ready ? `<span class="fact"><b>${ready}</b> ready to apply, in ${plural(groupsIn("ready").length, "group")}</span>` : ""}
        ${auto ? `<span class="fact"><b>${auto}</b> applied automatically</span>` : ""}
        ${D.kept.length ? `<span class="fact"><b>${D.kept.length}</b> stay as they are</span>` : ""}
        ${notNow.length ? `<span class="fact"><b>${notNow.length}</b> not now</span>` : ""}
        ${none.length ? `<span class="fact"><b>${none.length}</b> with no guardrail</span>` : ""}
        ${run.waiting ? `<span class="fact"><b>${run.waiting}</b> wait for the next round</span>` : ""}
        ${RECORD ? "" : `<span class="fact">about ${plural(minutes, "minute")}</span>`}
      </div>
      ${GUARD ? `<p class="ships"><b>How they ship:</b> ${prose(run.prs ?? SHIPS)}</p>` : ""}
      ${RECORD || !callIds.length ? "" : `<div class="actions"><button class="btn primary" id="start-focus" type="button">Review one by one</button></div>`}`;
  find("start-focus")?.addEventListener("click", () => {
    openFocus(0);
  });
}
function syncMeter() {
  if (!resident.length) return;
  const t = totals(),
    b = Math.max(residentBefore, 1),
    cut = Math.max(t.tok, 0);
  $("m-keep").style.width = `${(Math.min(t.after, b) / b) * 100}%`;
  $("m-cut").style.width = `${(cut / b) * 100}%`;
  $("m-text").innerHTML =
    `Every session loads <b class="num">${fmt(residentBefore)}</b> → <b class="num">${fmt(t.after)}</b> tokens (est.)`;
  $("m-pct").innerHTML = t.tok
    ? `<b class="num">${t.tok > 0 ? "−" : "+"}${Math.round((Math.abs(t.tok) / b) * 100)}%</b> ${RECORD ? "with these decisions" : "with your decisions so far"}`
    : "no change yet";
  $("meter-bar").setAttribute(
    "aria-label",
    `${fmt(residentBefore)} tokens before, ${fmt(t.after)} after`,
  );
}

/* ---------- decide column ---------- */
const disabled = RECORD ? "disabled" : "";
function choiceHtml(id: string) {
  const v = S.d[id];
  const b = (val: Decision, label: string, key: string) =>
    `<button type="button" data-id="${id}" data-v="${val}" aria-pressed="${String(v === val)}" ${disabled}>${label} <kbd>${key}</kbd></button>`;
  return `<div class="choice" role="group" aria-label="Decision">${b("apply", APPLY.label, APPLY.key)}${b("skip", "Skip", "s")}${b("later", "Later", "l")}</div>`;
}
function callCard(c: Change, p = "") {
  return `
    <article class="card" id="${p}card-${c.id}" data-id="${c.id}" tabindex="-1">
      <div class="card-meta">
        <span class="verb ${esc(c.verb)}">${esc(c.verb)}</span>
        ${locHtml(c)}
        ${c.split ? `<span class="split-vote">Close vote: ${esc(c.split)}</span>` : ""}
        <span class="tok num" data-tok="${c.id}">${tokText(c)}</span>
      </div>
      <h3>${prose(c.title)}</h3>
      <p class="why">${prose(c.why)}</p>
      <div data-diff="${c.id}">${diffHtml(c)}</div>
      ${checkHtml(c)}
      <p class="ifskip"><b>If you skip:</b> ${prose(c.skip)}</p>
      ${evidenceHtml(c)}
      ${noteHtml(c, p)}
      ${redraftHtml(c)}
      ${p ? "" : choiceHtml(c.id)}
    </article>`;
}
const noteHtml = (c: Change, p: string) =>
  `<textarea id="${p}note-${c.id}" data-note="${c.id}" rows="1" maxlength="600" placeholder="Note for Claude (optional)" ${disabled}>${esc(S.note[c.id] ?? "")}</textarea>`;
const redraftHtml = (c: Change) =>
  redraftable(c) && !RECORD
    ? `<div class="redraft-row" data-redraft="${c.id}" hidden><button class="btn small" type="button" data-redraft-go="${c.id}">Redraft with Claude</button><span class="muted">Turns your note into new wording. You approve it.</span></div><div class="redraft-out" data-redraft-out="${c.id}"></div>`
    : "";

/* ---------- guard candidates ---------- */
const ext = (href: string, text: string) =>
  `<a href="${esc(href)}" target="_blank" rel="noopener">${text}</a>`;
const prLabel = (url: string) => {
  const pr = /\/pull\/(\d+)/.exec(url);
  return pr ? `PR #${pr[1] ?? ""}` : "open";
};
const kv = (pairs: [string, string][]) =>
  `<table class="kv"><tbody>${pairs.map(([label, value]) => `<tr><th scope="row">${label}</th><td>${value}</td></tr>`).join("")}</tbody></table>`;
const codeBlock = (
  kind: string,
  caption: string,
  lang: string | null,
  text: string,
) =>
  `<figure class="code ${kind}"><figcaption>${caption}${lang ? `<span>${esc(lang)}</span>` : ""}</figcaption><pre><code>${esc(text)}</code></pre></figure>`;
const builtLink = (id: string) => {
  const pr = run.status?.prs?.[id];
  return pr
    ? `<p class="g-note"><b>Pull request:</b> ${ext(pr, esc(pr))}</p>`
    : "";
};
/* Where a check lives, or, for a CLAUDE.md line, the files its edits write. */
const homes = (c: Candidate) =>
  c.guardrail.where.length
    ? c.guardrail.where
    : [...new Set(c.edits.map((e) => e.file))];
function guardCard(c: Candidate, p = "") {
  const g = c.guardrail,
    m = c.mistake,
    caught = c.caught,
    line = g.rung === 8;
  const flagged =
    caught.count > 1
      ? `<span>${caught.count} reviews flagged this${caught.count > caught.quotes.length ? `, ${caught.quotes.length} quoted` : ""}</span>`
      : "";
  const quotes = caught.quotes
    .map(
      (q) =>
        `<li><blockquote>${prose(q.text)}</blockquote><cite><b>${esc(q.reviewer)}</b> · ${ext(q.url, prLabel(q.url))}</cite></li>`,
    )
    .join("");
  const facts: [string, string][] = [
    ["Rung", `${g.rung} · ${esc(g.name)}`],
    ...(g.tool ? [["Tool", prose(g.tool)] satisfies [string, string]] : []),
    [
      "Lives in",
      homes(c)
        .map(
          (f) => `<code>${esc(f)}</code>${files[f]?.new ? " (new file)" : ""}`,
        )
        .join("<br>"),
    ],
  ];
  const shows = line
    ? `<div data-diff="${c.id}">${diffHtml(c)}</div>`
    : g.message
      ? codeBlock(
          "msg",
          g.rung === 2 ? "It prints" : "It fails with",
          "",
          g.message,
        )
      : `<p class="g-note">Rewrites the code on commit, so it prints no message.</p>`;
  return `
    <article class="card guard" id="${p}card-${c.id}" data-id="${c.id}" tabindex="-1">
      <div class="g-head"><h3>${prose(c.title)}</h3><span class="badge ${c.recommendation.replace(" ", "-")}">${esc(c.recommendation)}</span></div>
      ${builtLink(c.id)}
      <section class="g-sec"><h4>What the review caught ${flagged}</h4><ul class="quotes">${quotes}</ul></section>
      <section class="g-sec"><h4>The mistake</h4><div class="pair">${codeBlock("wrong", "Wrong", m.lang, m.wrong)}${codeBlock("right", "Write instead", m.lang, m.right)}</div>${m.note ? `<p class="g-note">${prose(m.note)}</p>` : ""}</section>
      <section class="g-sec"><h4>${line ? "The line" : "The check"}${line ? ` <span class="tok num" data-tok="${c.id}">${tokText(c)}</span>` : ""}</h4>${kv(facts)}${shows}</section>
      <section class="g-sec"><h4>Cost</h4>${kv(c.cost.map((r): [string, string] => [prose(r.label), prose(r.value)]))}</section>
      <p class="ifskip"><b>If you skip:</b> ${prose(c.skip)}</p>
      ${c.alternative ? `<p class="ifskip"><b>Alternative:</b> ${prose(c.alternative)}</p>` : ""}
      ${checkHtml(c)}
      ${evidenceHtml(c)}
      ${noteHtml(c, p)}
      ${redraftHtml(c)}
      ${p ? "" : choiceHtml(c.id)}
    </article>`;
}
const cardFor = (c: Change, p?: string) =>
  GUARD && isCandidate(c) ? guardCard(c, p) : callCard(c, p);
/* The candidate as the apply message names it. */
const guardWhere = (c: Candidate) =>
  [
    `rung ${c.guardrail.rung} ${c.guardrail.name}`,
    c.guardrail.tool && plain(c.guardrail.tool),
    ...c.edits.map((e) => `${e.file} ${where(e)}`),
  ]
    .filter(Boolean)
    .join(", ");
function questionCard(q: Question, p = "") {
  const id = "q:" + q.id;
  const opts = q.options
    .map(
      (o) => `
      <label class="option"><input type="radio" name="${p}q-${esc(q.id)}" value="${esc(o.id)}" data-q="${esc(q.id)}" ${S.q[q.id] === o.id ? "checked" : ""} ${disabled}>
        <span class="o-label">${prose(o.label)}${o.recommended ? `<span class="rec">recommended</span>` : ""}</span>
        ${o.detail ? `<span class="o-detail">${prose(o.detail)}</span>` : ""}</label>`,
    )
    .join("");
  return `
    <article class="card" id="${p}card-q-${esc(q.id)}" data-qid="${esc(q.id)}" tabindex="-1" data-state="${S.q[q.id] ? "apply" : ""}">
      <div class="card-meta"><span class="verb question">question</span></div>
      <h3>${prose(q.text)}</h3>
      ${q.why ? `<p class="why">${prose(q.why)}</p>` : ""}
      <div class="options" role="radiogroup" aria-label="${esc(plain(q.text))}">${opts}</div>
      <textarea id="${p}note-${esc(id)}" data-note="${esc(id)}" rows="1" maxlength="600" placeholder="Other answer or note (optional)" ${disabled}>${esc(S.note[id] ?? "")}</textarea>
    </article>`;
}
function groupCard(g: Group, p = "") {
  const items = inGroup(g.id);
  const li = items
    .map(
      (c) => `
      <li class="item ${S.d[c.id] === "apply" ? "" : "off"}" data-item="${c.id}">
        <input type="checkbox" id="${p}cb-${c.id}" data-cb="${c.id}" ${S.d[c.id] === "apply" ? "checked" : ""} ${disabled}>
        <div class="it">
          <div class="it-top"><label class="it-title" for="${p}cb-${c.id}">${prose(c.title)}</label>${locHtml(c)}<span class="tok num muted" data-tok="${c.id}">${tokText(c)}</span></div>
          <p class="it-why">${prose(c.why)}${c.evidence[0]?.href ? ` <a href="${esc(c.evidence[0].href)}" target="_blank" rel="noopener">open</a>` : ""}</p>
          <div data-diff="${c.id}">${diffHtml(c)}</div>
          ${checkHtml(c)}
          <textarea id="${p}why-${c.id}" data-note="${c.id}" rows="1" maxlength="600" placeholder="Why skip it? (optional)" ${S.d[c.id] === "apply" && !S.note[c.id] ? "hidden" : ""} ${disabled}>${esc(S.note[c.id] ?? "")}</textarea>
        </div>
      </li>`,
    )
    .join("");
  const head = `
      <div class="group-head">
        <div><h3>${prose(g.title)}</h3>${g.lede ? `<p class="why muted">${prose(g.lede)}</p>` : ""}<span class="muted num" style="font-size: 0.85rem" data-gtok="${g.id}"></span></div>
        <label class="switch"><input type="checkbox" id="${p}sw-${g.id}" data-switch="${g.id}" ${disabled}> <span>Apply all</span></label>
      </div>`;
  const body = `<ul class="items">${li}</ul><textarea id="${p}gnote-${g.id}" data-gnote="${g.id}" rows="1" maxlength="600" placeholder="Note on any of these (optional)" ${disabled}>${esc(S.gnote[g.id] ?? "")}</textarea>`;
  if (g.lane === "auto" && !p) {
    return `<details class="card auto" id="card-${g.id}" data-group="${g.id}"><summary>${prose(g.title)} <span>· ${plural(items.length, "change")}, undo any</span></summary>${head}${body}</details>`;
  }
  return `<article class="card group" id="${p}card-${g.id}" data-group="${g.id}" tabindex="-1">${head}${body}</article>`;
}
function renderDecide() {
  const ready = groupsIn("ready"),
    auto = groupsIn("auto");
  const nReady = changes.filter((c) => c.lane === "ready").length;
  const sections = [];
  if (callIds.length) {
    sections.push(`
      <section class="lane call" aria-labelledby="h-call">
        <div class="lane-head"><h2 id="h-call">Needs your call <span class="count">${callIds.length}</span></h2>
        <p class="lede">${GUARD ? "Each one is a check, or a last-resort CLAUDE.md line, that stops a mistake the review caught. Nothing is built until you decide." : "Each one changes what a rule says, needs your intent, or a check found a problem. Nothing here applies until you decide."}</p></div>
        ${calls.map((c) => cardFor(c)).join("")}
        ${questions.map((q) => questionCard(q)).join("")}
      </section>`);
  }
  if (notNow.length) {
    sections.push(`
      <details class="quiet" id="h-notnow" ${notNow.some((n) => S.pull[n.id]) ? "open" : ""}><summary>${plural(notNow.length, "candidate")} not now <span>· the cost gate stopped ${notNow.length === 1 ? "it" : "them"}. Pull one back in to build it anyway</span></summary>
        <ul class="held">${notNow.map((n) => `<li><div><b>${prose(n.title)}</b><span class="muted">${prose(n.why)}</span>${n.threads.length ? `<span class="muted">${n.threads.map((u, i) => ext(u, n.threads.length > 1 ? `thread ${i + 1}` : "thread")).join(" · ")}</span>` : ""}${builtLink(n.id)}</div><label class="switch"><input type="checkbox" id="pull-${n.id}" data-pull="${n.id}" ${S.pull[n.id] ? "checked" : ""} ${disabled}> <span>Build anyway</span></label></li>`).join("")}</ul>
      </details>`);
  }
  if (none.length) {
    sections.push(`
      <details class="quiet"><summary>${plural(none.length, "finding gets", "findings get")} no guardrail <span>· the reason for each</span></summary>
        <ul class="none-list">${none.map((r) => `<li><span>${prose(r.finding)}</span><span class="muted">${prose(r.verdict)}${r.url ? ` ${ext(r.url, "open")}` : ""}</span></li>`).join("")}</ul>
      </details>`);
  }
  if (ready.length) {
    sections.push(`
      <section class="lane" aria-labelledby="h-ready">
        <div class="lane-head"><h2 id="h-ready">Ready to apply <span class="count">${nReady}</span></h2>
        <p class="lede">Direct evidence and no change in meaning. These apply unless you turn them off.</p></div>
        ${ready.map((g) => groupCard(g)).join("")}
      </section>`);
  }
  if (auto.length)
    sections.push(
      `<section class="lane" aria-label="Applied automatically">${auto.map((g) => groupCard(g)).join("")}</section>`,
    );
  if (D.kept.length) {
    sections.push(`
      <details class="quiet"><summary>${plural(D.kept.length, "part stays", "parts stay")} as ${D.kept.length === 1 ? "it is" : "they are"} <span>· why each one earns its place</span></summary>
        <ul class="kept">${D.kept.map((k) => `<li>${link(k.href, `${esc(k.file)} ${range(k.lines[0], k.lines[1])}`, "k-l")}<span>${prose(k.title)}</span><span class="k-why">${prose(k.why)}</span></li>`).join("")}</ul>
      </details>`);
  }
  if (D.next.length || D.ship || !RECORD) {
    sections.push(`
      <section class="lane" aria-labelledby="h-next">
        <div class="lane-head"><h2 id="h-next">After this lands</h2></div>
        <div class="card">
          ${D.next
            .map(
              (
                n,
              ) => `<div class="next-row"><input type="checkbox" id="next-${esc(n.id)}" data-next="${esc(n.id)}" ${S.next[n.id] ? "checked" : ""} ${disabled}>
            <label for="next-${esc(n.id)}"><b>${prose(n.title)}</b>${n.command ? ` <span class="muted">· <code>${esc(n.command)}</code></span>` : ""}${n.why ? `<br><span class="muted">${prose(n.why)}</span>` : ""}</label></div>`,
            )
            .join("")}
          ${D.ship ? `<div class="ship"><label for="ship">Ships as</label><select id="ship" ${disabled}>${D.ship.options.map((o) => `<option value="${esc(o.id)}" ${S.ship === o.id ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select>${D.ship.remembered ? `<span class="muted">your usual choice</span>` : ""}</div>` : ""}
          <p class="muted" id="later-line" style="font-size: 0.9rem"></p>
        </div>
      </section>`);
  }
  if (run.method)
    sections.push(
      `<details class="quiet"><summary>How bonsai checked <span>· method</span></summary><p class="muted" style="margin-top: 8px; max-width: 68ch">${prose(run.method)}</p></details>`,
    );
  if (!RECORD)
    sections.push(
      `<p class="keys"><span><kbd>j</kbd>/<kbd>k</kbd> move</span><span><kbd>${APPLY.key}</kbd> ${APPLY.word}</span><span><kbd>s</kbd> skip</span><span><kbd>l</kbd> later</span><span><kbd>n</kbd> note</span><span><kbd>f</kbd> one by one</span>${PREVIEW ? "<span><kbd>p</kbd> preview</span>" : ""}</p>`,
    );
  $("decide").innerHTML = sections.join("");
}

/* ---------- preview ---------- */
const touched = [
  ...new Set(changes.flatMap((c) => c.edits.map((e) => e.file))),
];
/* A guard card shows the whole line it writes, so a guard run needs no preview. */
const PREVIEW = !GUARD && touched.length > 0;
function renderPreviewHead() {
  if (!PREVIEW) return;
  const file =
    S.file !== null && touched.includes(S.file)
      ? S.file
      : must(touched[0], "file to preview");
  S.file = file;
  const sel = $("pv-file");
  sel.hidden = touched.length < 2;
  sel.innerHTML = touched
    .map(
      (f) =>
        `<option value="${esc(f)}" ${f === S.file ? "selected" : ""}>${esc(f)}${fileAt(f).new ? " (new)" : ""}</option>`,
    )
    .join("");
  $("pv-title").textContent =
    touched.length < 2
      ? `${file} after your decisions`
      : "After your decisions";
}
function renderDoc() {
  if (!PREVIEW) return;
  const path = must(S.file, "file to preview"),
    file = fileAt(path),
    count = file.lines.length;
  const removals: Record<number, { c: Change; e: ReplaceEdit }> = {},
    inserts: Record<number, { c: Change; e: Edit }[]> = {};
  for (const c of changes) {
    for (const e of c.edits) {
      if (e.file !== path) continue;
      if (e.lines) removals[e.lines[0]] = { c, e };
      else (inserts[e.at] ??= []).push({ c, e });
    }
  }
  const shown = new Set<number>();
  if (file.hunks) {
    for (const c of changes)
      for (const e of c.edits) {
        if (e.file !== path) continue;
        const [a, b] = e.lines ?? [e.at, e.at];
        for (let n = a - 3; n <= b + 3; n++) shown.add(n);
      }
  }
  const out = [];
  let gap = false;
  for (let n = 1; n <= count + 1; n++) {
    for (const { c, e } of inserts[n] ?? []) {
      if (S.d[c.id] === "apply")
        out.push(
          `<div class="blk" data-blk="${c.id}">${written(c, e)
            .map((t) => line("ins", "+", esc(t)))
            .join("")}</div>`,
        );
    }
    if (n > count) break;
    if (file.hunks && !shown.has(n) && !removals[n]) {
      if (!gap) out.push(line("gap", "", "···"));
      gap = true;
      continue;
    }
    gap = false;
    const r = removals[n];
    if (!r) {
      out.push(line("", n, esc(file.lines[n - 1])));
      continue;
    }
    const rows =
      S.d[r.c.id] === "apply"
        ? editRows(r.e.before, written(r.c, r.e))
        : r.e.before.map((l) => line("", l.n, esc(l.text)));
    out.push(`<div class="blk" data-blk="${r.c.id}">${rows.join("")}</div>`);
    n = r.e.lines[1];
  }
  const doc = $("doc");
  doc.innerHTML = out.join("") || line("ctx", "", "This file starts empty.");
  doc.classList.toggle("clean", S.pv === "clean");
  $("pv-changes").setAttribute("aria-pressed", String(S.pv !== "clean"));
  $("pv-clean").setAttribute("aria-pressed", String(S.pv === "clean"));
}
function highlight(id: string | undefined, scroll: boolean) {
  document.querySelectorAll(".blk.hot").forEach((b) => {
    b.classList.remove("hot");
  });
  if (!id || !PREVIEW) return;
  const ids = byId[id] ? [id] : inGroup(id).map((c) => c.id);
  const target = ids.flatMap((i) => changeById(i).edits.map((e) => e.file))[0];
  if (target && target !== S.file) {
    S.file = target;
    renderPreviewHead();
    renderDoc();
  }
  let first: HTMLElement | null = null;
  for (const i of ids)
    for (const b of document.querySelectorAll<HTMLElement>(
      `[data-blk="${i}"]`,
    )) {
      b.classList.add("hot");
      first ??= b;
    }
  if (scroll && first && getComputedStyle($("preview")).position === "sticky") {
    const doc = $("doc");
    doc.scrollTo({
      top: first.offsetTop - doc.clientHeight / 3,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }
}

/* ---------- the way back to Claude ---------- */
let comments: Comments | null | undefined = null,
  sample: Sample | null | undefined = null,
  channel = "copy";
async function lightCapabilities() {
  if (RECORD) return;
  try {
    sample = await window.claude?.use?.("sample");
  } catch {
    sample = null;
  }
  if (sample)
    document.querySelectorAll<HTMLElement>("[data-redraft]").forEach((r) => {
      r.hidden = false;
    });
  try {
    comments = await window.claude?.use?.("comments");
  } catch {
    comments = null;
  }
  await refreshChannel();
}
async function refreshChannel() {
  channel = "copy";
  if (comments) {
    try {
      channel =
        (await comments.canSendToClaude()) === "available" ? "send" : "copy";
    } catch {
      channel = "copy";
    }
  }
  syncDock();
  return channel;
}

/* ---------- dock ---------- */
function syncDock() {
  if (RECORD) return;
  const t = totals(),
    open = openCalls();
  const dots =
    groupsIn("ready")
      .map(() => `<i class="ready"></i>`)
      .join("") +
    calls
      .map(
        (c) =>
          `<i class="${S.d[c.id] === "apply" ? "done" : S.d[c.id] ? "skipd" : ""}"></i>`,
      )
      .join("") +
    questions.map((q) => `<i class="${S.q[q.id] ? "done" : ""}"></i>`).join("");
  $("dots").innerHTML = dots;
  const ready = changes.filter(
    (c) => c.lane !== "call" && S.d[c.id] === "apply",
  ).length;
  if (open) {
    $("status").innerHTML = GUARD
      ? `${callIds.length - open} of ${callIds.length} calls made`
      : `<b>${ready} ready</b> · ${callIds.length - open} of ${callIds.length} calls made`;
    $("go").textContent = `Decide ${open} more`;
    $("go-sub").textContent = "";
    return;
  }
  const pulled = notNow.filter((n) => S.pull[n.id]).length;
  $("status").innerHTML =
    `<b>All decided.</b> ${t.apply.length} ${APPLY.word}${t.skip.length ? ` · ${t.skip.length} skip` : ""}${t.later.length ? ` · ${t.later.length} later` : ""}${pulled ? ` · ${pulled} not now pulled back` : ""}${resident.length ? ` · ${t.tok >= 0 ? "−" : "+"}${Math.abs(t.tok)} tokens` : ""}`;
  const going = t.apply.length + pulled;
  $("go").textContent = !going
    ? "Send decisions"
    : GUARD
      ? `Build ${plural(going, "guardrail")}`
      : `Apply ${plural(going, "change")}`;
  $("go-sub").textContent =
    channel === "send"
      ? "Sends to the waiting Claude session"
      : "Copies a message for the session";
}

/* ---------- sync what state drives ---------- */
function clampDiffs() {
  document
    .querySelectorAll(".item .diff, .decide .card[data-id] [data-diff] .diff")
    .forEach((d) =>
      d.classList.toggle("clamp", d.scrollHeight > d.clientHeight + 2),
    );
}
function sync() {
  for (const c of changes) {
    const v = S.d[c.id];
    document
      .querySelectorAll<HTMLElement>(`#card-${c.id}, #f-card-${c.id}`)
      .forEach((card) => (card.dataset.state = v ?? ""));
    document
      .querySelectorAll<HTMLElement>(`.choice button[data-id="${c.id}"]`)
      .forEach((b) => {
        b.setAttribute("aria-pressed", String(b.dataset.v === v));
      });
    document
      .querySelectorAll<HTMLInputElement>(`[data-cb="${c.id}"]`)
      .forEach((cb) => {
        cb.checked = v === "apply";
        const item = must(cb.closest(".item"), "item");
        item.classList.toggle("off", v !== "apply");
        const why = item.querySelector<HTMLElement>("textarea[data-note]");
        if (why) why.hidden = v === "apply" && !S.note[c.id];
      });
    document
      .querySelectorAll(`[data-tok="${c.id}"]`)
      .forEach((el) => (el.textContent = tokText(c)));
    if (S.custom[c.id])
      document
        .querySelectorAll(`[data-diff="${c.id}"]`)
        .forEach((el) => (el.innerHTML = diffHtml(c)));
  }
  for (const q of questions)
    document
      .querySelectorAll<HTMLElement>(`[data-qid="${q.id}"]`)
      .forEach((card) => (card.dataset.state = S.q[q.id] ? "apply" : ""));
  for (const g of groups) {
    const ids = inGroup(g.id).map((c) => c.id),
      on = ids.filter((id) => S.d[id] === "apply").length;
    document
      .querySelectorAll<HTMLInputElement>(`[data-switch="${g.id}"]`)
      .forEach((sw) => {
        sw.checked = on === ids.length;
        sw.indeterminate = on > 0 && on < ids.length;
      });
    const tok = inGroup(g.id)
      .filter((c) => S.d[c.id] === "apply")
      .reduce((n, c) => n + saved(c), 0);
    document
      .querySelectorAll(`[data-gtok="${g.id}"]`)
      .forEach(
        (el) =>
          (el.textContent = tok
            ? `${tok > 0 ? "−" : "+"}${Math.abs(tok)} tokens`
            : ""),
      );
  }
  for (const n of notNow)
    document
      .querySelectorAll<HTMLInputElement>(`[data-pull="${n.id}"]`)
      .forEach((cb) => (cb.checked = Boolean(S.pull[n.id])));
  const waiting = totals().later.length + run.waiting;
  const laterLine = find("later-line");
  if (laterLine)
    laterLine.textContent = waiting
      ? `${plural(waiting, NOUN)} ${waiting === 1 ? "waits" : "wait"} for the next round. Run /bonsai:${run.skill} again after this lands.`
      : "";
  syncMeter();
  syncDock();
  renderDoc();
  clampDiffs();
  save();
}

/* ---------- decisions ---------- */
function decide(id: string, v: Decision) {
  S.d[id] = S.d[id] === v ? null : v;
  sync();
}

/* Redraft with Claude, through the sample capability when this viewer grants it. */
async function redraft(id: string, btn: HTMLButtonElement) {
  const c = changeById(id),
    e = must(c.edits[0], `edit in ${id}`),
    note = (S.note[id] ?? "").trim();
  const outs = document.querySelectorAll(`[data-redraft-out="${id}"]`);
  if (!note) {
    outs.forEach(
      (o) =>
        (o.innerHTML = `<p class="pending">Write in the note what should change, then redraft.</p>`),
    );
    return;
  }
  btn.disabled = true;
  outs.forEach(
    (o) => (o.innerHTML = `<p class="pending">Claude is redrafting.</p>`),
  );
  // A candidate may carry no why, or an empty one: the title stands in.
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  const reason = plain(c.why || c.title);
  const prompt = `You rewrite lines of a CLAUDE.md file: instructions an AI coding agent loads in its sessions.
Rules: keep every identifier in backticks exactly as written. State the rule in the present tense, imperative. Keep the line count of the proposal unless the reviewer asks otherwise. No history and no rationale the code already shows. Do not widen or weaken the rule beyond what the reviewer asks.
Current lines:
${e.before.map((l) => l.text).join("\n")}
Proposed lines:
${written(c, e).join("\n")}
Why the change was proposed: ${reason}
Reviewer's note: ${note}
Return only the new lines.`;
  try {
    const res = await must(sample, "sample capability")(prompt, {
      modelTier: "default",
      cache: false,
    });
    const text = res.text
      .trim()
      .replace(/^```\w*\n?|```$/g, "")
      .trim();
    outs.forEach((o) => {
      o.innerHTML = `${diffHtml(c, text.split("\n"))}<div class="redraft-row"><button class="btn small primary" type="button" data-use="${id}">Use this wording</button><span class="muted">Claude checks every name against the repo when it applies.</span></div>`;
      must(o.querySelector("[data-use]"), "use button").addEventListener(
        "click",
        () => {
          S.custom[id] = text;
          S.d[id] = "apply";
          outs.forEach(
            (x) =>
              (x.innerHTML = `<p class="pending">Using the new wording. Change the note and redraft to try again.</p>`),
          );
          sync();
        },
      );
    });
  } catch (err) {
    const msg =
      errorCode(err) === "rate_limited"
        ? "Too many requests. Try again in a minute."
        : "Redraft did not run. Your note still goes to Claude with your decisions.";
    outs.forEach((o) => (o.innerHTML = `<p class="pending">${msg}</p>`));
    if (errorCode(err) === "not_granted")
      document
        .querySelectorAll<HTMLElement>("[data-redraft]")
        .forEach((r) => (r.hidden = true));
  } finally {
    btn.disabled = false;
  }
}

/* ---------- the message Claude applies ---------- */
function message() {
  const out = [
    GUARD
      ? `Build the bonsai guard of ${run.target}, round ${run.round}, with these decisions:`
      : `Apply the bonsai ${run.skill} of ${run.target}, round ${run.round}, with these decisions:`,
  ];
  for (const c of changes) {
    const v = S.d[c.id];
    let l =
      GUARD && isCandidate(c)
        ? `- ${c.id} (${guardWhere(c)}): ${v === "apply" ? "build" : (v ?? "undecided")}`
        : `- ${c.id} (${c.edits.map((e) => `${e.file} ${where(e)}`).join(", ")}): ${v ?? "undecided"}`;
    const custom = S.custom[c.id];
    if (custom) l += `, new wording: ${custom.replace(/\n/g, " / ")}`;
    const note = S.note[c.id];
    if (note) l += ` | note: ${note}`;
    out.push(l);
  }
  for (const q of questions) {
    const note = S.note["q:" + q.id];
    out.push(
      `- question ${q.id}: ${S.q[q.id] ?? "undecided"}${note ? ` | note: ${note}` : ""}`,
    );
  }
  for (const g of groups) {
    const note = S.gnote[g.id];
    if (note) out.push(`- note on group ${g.id}: ${note}`);
  }
  for (const n of notNow)
    if (S.pull[n.id]) out.push(`- not now ${n.id}: build anyway`);
  for (const n of D.next)
    out.push(
      `- after: ${S.next[n.id] ? "yes" : "no"}, ${n.id}${n.command ? ` (${n.command})` : ""}`,
    );
  if (D.ship) out.push(`- ship: ${String(S.ship)}`);
  return out.join("\n");
}

/* ---------- check answers, then the one way out ---------- */
function openSheet() {
  const t = totals();
  const row = (label: string, body: string, jump: string | null) =>
    `<div><dt>${label}</dt><dd>${body}</dd>${jump ? `<button type="button" data-jump="${esc(jump)}">Change</button>` : "<span></span>"}</div>`;
  const names = (list: Change[]) => list.map((c) => prose(c.title)).join("; ");
  const notes =
    Object.values(S.note).filter(Boolean).length +
    Object.values(S.gnote).filter(Boolean).length;
  const queued = D.next.filter((n) => S.next[n.id]);
  const pulled = notNow.filter((n) => S.pull[n.id]);
  const builds = [
    ...t.apply.map((c) => prose(c.title)),
    ...pulled.map((n) => `${prose(n.title)} (not now)`),
  ];
  const first = (list: Change[]) => must(list[0], "change").id;
  $("sheet-in").innerHTML = `
      <h2 id="sheet-title">Check and send</h2>
      <dl class="answers">
        ${GUARD ? row(`Build ${builds.length}`, builds.join("; ") || "Nothing", null) : row(`Apply ${t.apply.length}`, resident.length ? `Every session loads <b>${fmt(t.after)}</b> tokens instead of ${fmt(residentBefore)}.` : names(t.apply), groupsIn("ready").length ? "h-ready" : null)}
        ${t.skip.length ? row(`Skip ${t.skip.length}`, names(t.skip), "card-" + first(t.skip)) : ""}
        ${t.later.length ? row(`Later ${t.later.length}`, `${names(t.later)}. Next round.`, "card-" + first(t.later)) : ""}
        ${questions.map((q) => row("Answer", `${prose(q.text)} <b>${prose(q.options.find((o) => o.id === S.q[q.id])?.label ?? "")}</b>`, "card-q-" + q.id)).join("")}
        ${notes ? row("Notes", `${plural(notes, "note")} for Claude`, null) : ""}
        ${D.ship ? row("Ships as", esc(D.ship.options.find((o) => o.id === S.ship)?.label ?? S.ship), "h-next") : ""}
        ${GUARD ? row("Ships as", prose(run.prs ?? SHIPS), null) : ""}
        ${queued.length ? row("Then", queued.map((n) => prose(n.title)).join("; "), "h-next") : ""}
      </dl>
      <p class="outcome-msg" id="send-msg" aria-live="polite"></p>
      <textarea id="export" readonly hidden>${esc(message())}</textarea>
      <div class="actions">
        <button class="btn primary" id="send" type="button">${channel === "send" ? "Send to Claude" : "Copy for Claude"}</button>
        <button class="btn ghost" id="sheet-close" type="button">Back</button>
      </div>`;
  $("sheet").hidden = false;
  $("send").focus();
  $("sheet-close").addEventListener("click", () => ($("sheet").hidden = true));
  $("sheet-in")
    .querySelectorAll<HTMLElement>("[data-jump]")
    .forEach((b) => {
      b.addEventListener("click", () => {
        $("sheet").hidden = true;
        setTab("decide");
        const el = find(data(b, "jump"));
        el?.scrollIntoView({ block: "center" });
        el?.focus({ preventScroll: true });
      });
    });
  $("send").addEventListener("click", () => {
    void send();
  });
  void refreshChannel().then((ch) => {
    const btn = find("send");
    if (btn instanceof HTMLButtonElement && !btn.disabled)
      btn.textContent = ch === "send" ? "Send to Claude" : "Copy for Claude";
  });
}
async function send() {
  const btn = $as("send", HTMLButtonElement),
    msg = $("send-msg"),
    text = message();
  btn.disabled = true;
  if (channel === "send" && new TextEncoder().encode(text).length <= 4000) {
    try {
      const host = must(comments, "comments capability");
      const anchor = await host.anchorFor($("title"));
      await host.sendToClaude({ anchor, text });
      msg.textContent =
        "Sent. Claude applies it and answers in the comment thread on the title.";
      btn.textContent = "Sent";
      return;
    } catch (err) {
      if (errorCode(err) === "consent_required") {
        msg.textContent =
          "Allow comments from this page to send it, or copy it instead.";
        channel = "copy";
        btn.textContent = "Copy for Claude";
        btn.disabled = false;
        return;
      }
      channel = "copy";
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    msg.textContent = "Copied. Paste it into the Claude session.";
    btn.textContent = "Copied";
  } catch {
    const ex = $as("export", HTMLTextAreaElement);
    ex.hidden = false;
    ex.focus();
    ex.select();
    msg.textContent =
      "Automatic copy failed. Copy the selected text, then paste it into the session.";
    btn.disabled = false;
  }
}

/* ---------- one by one ---------- */
interface Step {
  kind: "call" | "question" | "group";
  id: string;
}
const steps = (): Step[] => [
  ...calls.map((c) => ({ kind: "call" as const, id: c.id })),
  ...questions.map((q) => ({ kind: "question" as const, id: q.id })),
  ...groupsIn("ready").map((g) => ({ kind: "group" as const, id: g.id })),
];
let fi = 0;
function openFocus(i: number) {
  fi = i;
  $("focus").hidden = false;
  document.body.style.overflow = "hidden";
  renderFocus();
}
function closeFocus() {
  $("focus").hidden = true;
  document.body.style.overflow = "";
  renderDecide();
  bindDecide();
  sync();
}
function renderFocus() {
  const st = steps(),
    n = st.length;
  if (fi >= n) {
    closeFocus();
    if (openCalls()) $("go").click();
    else openSheet();
    return;
  }
  $("f-bar").style.width = `${(fi / n) * 100}%`;
  $("f-count").textContent = `${fi + 1} of ${n}`;
  const s = must(st[fi], "step");
  if (s.kind === "call") {
    $("f-body").innerHTML = cardFor(changeById(s.id), "f-");
    $("f-actions").innerHTML = choiceHtml(s.id);
  } else if (s.kind === "question") {
    $("f-body").innerHTML = questionCard(
      must(
        questions.find((q) => q.id === s.id),
        `question ${s.id}`,
      ),
      "f-",
    );
    $("f-actions").innerHTML =
      `<div class="choice"><button type="button" data-v="next" aria-pressed="false">Next</button></div>`;
  } else {
    $("f-body").innerHTML = groupCard(
      must(
        groups.find((g) => g.id === s.id),
        `group ${s.id}`,
      ),
      "f-",
    );
    $("f-actions").innerHTML =
      `<div class="choice" role="group" aria-label="Decision"><button type="button" data-v="apply" aria-pressed="false">Apply checked <kbd>a</kbd></button><button type="button" data-v="skip" aria-pressed="false">Skip all <kbd>s</kbd></button></div>`;
  }
  $("f-actions")
    .querySelectorAll<HTMLElement>("button[data-v]")
    .forEach((b) => {
      b.addEventListener("click", () => {
        const v = b.dataset.v;
        if (v === "next" || isDecision(v)) focusDecide(v);
      });
    });
  bindScope($("f-body"));
  if (sample)
    $("f-body")
      .querySelectorAll<HTMLElement>("[data-redraft]")
      .forEach((r) => (r.hidden = false));
  sync();
  $("f-body").scrollTop = 0;
}
function focusDecide(v: Decision | "next") {
  const s = must(steps()[fi], "step");
  if (s.kind === "question" && v !== "next") return;
  if (s.kind === "call" && v !== "next") S.d[s.id] = v;
  else if (s.kind === "group" && v === "skip")
    inGroup(s.id).forEach((c) => (S.d[c.id] = "skip"));
  else if (s.kind === "group" && v !== "apply") return;
  sync();
  setTimeout(() => {
    fi++;
    renderFocus();
  }, 180);
}

/* ---------- events ---------- */
function bindScope(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>(".choice button[data-id]").forEach((b) => {
    b.addEventListener("click", () => {
      const v = b.dataset.v;
      if (isDecision(v)) decide(data(b, "id"), v);
    });
  });
  root.querySelectorAll<HTMLInputElement>("[data-cb]").forEach((cb) => {
    cb.addEventListener("change", () => {
      S.d[data(cb, "cb")] = cb.checked ? "apply" : "skip";
      sync();
      if (!cb.checked)
        must(cb.closest(".item"), "item").querySelector("textarea")?.focus();
    });
  });
  root.querySelectorAll<HTMLInputElement>("[data-switch]").forEach((sw) => {
    sw.addEventListener("change", () => {
      inGroup(data(sw, "switch")).forEach(
        (c) => (S.d[c.id] = sw.checked ? "apply" : "skip"),
      );
      sync();
    });
  });
  root.querySelectorAll<HTMLInputElement>("[data-q]").forEach((r) => {
    r.addEventListener("change", () => {
      S.q[data(r, "q")] = r.value;
      sync();
    });
  });
  root.querySelectorAll<HTMLTextAreaElement>("[data-note]").forEach((t) => {
    t.addEventListener("input", () => {
      S.note[data(t, "note")] = t.value;
      save();
    });
  });
  root.querySelectorAll<HTMLTextAreaElement>("[data-gnote]").forEach((t) => {
    t.addEventListener("input", () => {
      S.gnote[data(t, "gnote")] = t.value;
      save();
    });
  });
  root.querySelectorAll<HTMLButtonElement>("[data-redraft-go]").forEach((b) => {
    b.addEventListener("click", () => {
      void redraft(data(b, "redraftGo"), b);
    });
  });
  root
    .querySelectorAll(".item [data-diff], .card[data-id] [data-diff]")
    .forEach((d) => {
      d.addEventListener("click", () => {
        must(d.closest(".item") ?? d.closest(".card"), "card").classList.toggle(
          "open",
        );
        clampDiffs();
      });
    });
  root.querySelectorAll<HTMLElement>(".card").forEach((card) => {
    const id = card.dataset.id ?? card.dataset.group;
    if (!id) return;
    card.addEventListener("mouseenter", () => {
      highlight(id, true);
    });
    card.addEventListener("focusin", () => {
      highlight(id, true);
    });
  });
  root.querySelectorAll('a[target="_blank"]').forEach((a) => {
    a.addEventListener(
      "click",
      (e) => {
        e.stopPropagation();
      },
      true,
    );
  });
}
function bindDecide() {
  bindScope($("decide"));
  document.querySelectorAll<HTMLInputElement>("[data-next]").forEach((cb) => {
    cb.addEventListener("change", () => {
      S.next[data(cb, "next")] = cb.checked;
      save();
    });
  });
  const ship = find("ship");
  if (ship instanceof HTMLSelectElement)
    ship.addEventListener("change", () => {
      S.ship = ship.value;
      save();
    });
  document.querySelectorAll<HTMLInputElement>("[data-pull]").forEach((cb) => {
    cb.addEventListener("change", () => {
      S.pull[data(cb, "pull")] = cb.checked;
      sync();
    });
  });
  if (sample)
    document
      .querySelectorAll<HTMLElement>("[data-redraft]")
      .forEach((r) => (r.hidden = false));
}
function setTab(t: string) {
  $("split").dataset.tab = t;
  $("tab-decide").setAttribute("aria-selected", String(t === "decide"));
  $("tab-preview").setAttribute("aria-selected", String(t === "preview"));
  if (t === "decide") clampDiffs();
}

$("go").addEventListener("click", () => {
  const open = calls.find((c) => !S.d[c.id]);
  const q = questions.find((x) => !S.q[x.id]);
  const card = open
    ? find("card-" + open.id)
    : q
      ? find("card-q-" + q.id)
      : null;
  if (!card) {
    openSheet();
    return;
  }
  setTab("decide");
  card.scrollIntoView({ block: "center" });
  card.focus({ preventScroll: true });
  setCur(card);
});
$("f-close").addEventListener("click", closeFocus);
$("pv-changes").addEventListener("click", () => {
  S.pv = "changes";
  renderDoc();
  save();
});
$("pv-clean").addEventListener("click", () => {
  S.pv = "clean";
  renderDoc();
  save();
});
const pvFile = $as("pv-file", HTMLSelectElement);
pvFile.addEventListener("change", () => {
  S.file = pvFile.value;
  renderPreviewHead();
  renderDoc();
  save();
});
document.querySelectorAll<HTMLElement>(".tabs button").forEach((b) => {
  b.addEventListener("click", () => {
    setTab(data(b, "tab"));
  });
});
addEventListener("resize", clampDiffs);

/* Keys: j/k walk the cards, a/s/l decide, n note, f one by one, p preview. */
let cur: HTMLElement | null = null;
function setCur(card: HTMLElement | null) {
  document.querySelectorAll(".card.cur").forEach((c) => {
    c.classList.remove("cur");
  });
  cur = card;
  if (card) {
    card.classList.add("cur");
    highlight(card.dataset.id ?? card.dataset.group, true);
  }
}
const KEYS: Record<string, Decision> = {
  [APPLY.key]: "apply",
  s: "skip",
  l: "later",
};
document.addEventListener("keydown", (e) => {
  if (RECORD || e.metaKey || e.ctrlKey || e.altKey) return;
  const el = document.activeElement;
  const typing =
    /^(TEXTAREA|SELECT)$/.test(el?.tagName ?? "") ||
    (el instanceof HTMLInputElement &&
      !["checkbox", "radio"].includes(el.type));
  if (e.key === "Escape") {
    if (typing) {
      if (el instanceof HTMLElement) el.blur();
      return;
    }
    if (!$("sheet").hidden) {
      $("sheet").hidden = true;
      return;
    }
    if (!$("focus").hidden) {
      closeFocus();
      return;
    }
  }
  if (typing || !$("sheet").hidden) return;
  const keyed = KEYS[e.key];
  if (!$("focus").hidden) {
    if (keyed) focusDecide(keyed);
    else if (e.key === "n") {
      e.preventDefault();
      $("f-body").querySelector<HTMLElement>("textarea:not([hidden])")?.focus();
    } else if (e.key === "ArrowRight") {
      fi = Math.min(fi + 1, steps().length - 1);
      renderFocus();
    } else if (e.key === "ArrowLeft") {
      fi = Math.max(fi - 1, 0);
      renderFocus();
    }
    return;
  }
  const cards = [
    ...document.querySelectorAll<HTMLElement>(
      "#decide .card[data-id], #decide .card[data-qid], #decide article.card[data-group]",
    ),
  ];
  if (e.key === "j" || e.key === "k") {
    e.preventDefault();
    const i = cur ? cards.indexOf(cur) : -1;
    const card =
      cards[
        i < 0
          ? 0
          : e.key === "j"
            ? Math.min(i + 1, cards.length - 1)
            : Math.max(i - 1, 0)
      ];
    if (!card) return;
    setCur(card);
    card.focus({ preventScroll: true });
    card.scrollIntoView({ block: "nearest" });
  } else if (cur && keyed) {
    if (cur.dataset.id) decide(cur.dataset.id, keyed);
    else if (cur.dataset.group && keyed !== "later") {
      inGroup(cur.dataset.group).forEach((c) => (S.d[c.id] = keyed));
      sync();
    }
  } else if (cur && e.key === "n") {
    e.preventDefault();
    cur.querySelector<HTMLElement>("textarea:not([hidden])")?.focus();
  } else if (e.key === "f" && callIds.length) openFocus(0);
  else if (e.key === "p" && PREVIEW)
    setTab($("split").dataset.tab === "preview" ? "decide" : "preview");
});

/* ---------- boot ---------- */
if (RECORD) {
  document.body.classList.add("record");
  $("dock").hidden = true;
}
if (!PREVIEW) {
  $("preview").hidden = true;
  must(document.querySelector<HTMLElement>(".tabs"), ".tabs").hidden = true;
  $("split").classList.add("solo");
}
renderSummary();
renderDecide();
bindDecide();
renderPreviewHead();
sync();
void lightCapabilities();
