# Decision page renderer

Turn a bonsai run into a page the user can decide from in a few minutes. You write the data, and `build.ts` reads the quoted lines from disk, checks the data, and writes one HTML page ready to publish as an artifact.

```
bun build.ts data.json -o page.html
bun build.ts data.json --check
```

The script needs [Bun](https://bun.sh) 1.1.9 or later and nothing else: no install step, no dependencies. It prints a one-line summary on success, and on failure one error that names the change and what to fix.

## The data file

`example/data.json` is a complete run against the fixture in `example/repo/`. Start from it. A trimmed version:

```json
{
  "run": {
    "skill": "audit",
    "title": "Acme Books CLAUDE.md Audit",
    "heading": "Acme Books",
    "subject": "CLAUDE.md",
    "target": "acme-books",
    "date": "2026-10-02",
    "round": 1,
    "rounds": 2,
    "waiting": 3,
    "root": "/abs/path/to/repo",
    "editor": "zed",
    "outcome": "Make the always-loaded CLAUDE.md smaller, and fix two rules that point sessions the wrong way."
  },
  "files": [{ "path": "CLAUDE.md", "resident": true }],
  "groups": [{ "id": "covered", "lane": "ready", "title": "Delete 3 lines the repo already covers" }],
  "changes": [
    {
      "id": "livewire",
      "lane": "call",
      "verb": "fix",
      "title": "Name the Livewire default that causes the mistake",
      "why": "The real trap is `make:livewire`: in Livewire 4 it makes single-file components by default.",
      "skip": "A session runs `make:livewire` and gets a single-file component.",
      "edits": [{ "file": "CLAUDE.md", "lines": [26, 26], "write": ["- Pages are class-based Livewire components, never single-file components."] }],
      "evidence": [{ "text": "All 41 components in `app/Livewire` are class-based." }],
      "check": { "verdict": "same", "summary": "Both lines cover every page component." }
    }
  ]
}
```

Text in backticks renders as code everywhere on the page.

## run

| Field | Meaning |
| --- | --- |
| `skill` | `audit`, `bake`, `feed` or `split`. Names the skill in the apply message. |
| `title` | The artifact's name in the gallery: a short noun phrase. |
| `heading`, `subject` | The page heading, for example "Acme Books" and "CLAUDE.md". `subject` is optional. |
| `target` | What the run covers, as the apply message names it. |
| `date`, `round`, `rounds` | The run date, this round, and how many rounds the run expects. |
| `waiting` | Changes queued for later rounds, shown in the summary. A whole number from 0. |
| `root` | The repository the edits apply to. A relative path resolves against the data file's directory. |
| `editor` | `zed`, `vscode`, `cursor`, `phpstorm`, or `null`. Builds open-in-editor links. Use `null` in a remote session, where the user's editor cannot reach the path. |
| `outcome` | One sentence: what the run achieves when every change applies. |
| `method` | Optional. One paragraph on how the skill checked, shown collapsed. |
| `status` | Set only after the apply. See "Record mode". |

## files

Every file a change edits. `resident: true` marks files every session loads, and the token meter counts only those. `new: true` marks a file a change creates. The build refuses a file that is missing without the flag, or present with it. Files longer than 400 lines preview only the changed regions.

## changes

| Field | Meaning |
| --- | --- |
| `id` | Unique, short, readable: letters, digits, `-` and `_`. It appears in the apply message. |
| `lane` | `call`, `ready` or `auto`. See the [decision-page reference](../references/decision-artifact.md) for routing. |
| `group` | Required for `ready` and `auto`: the id of a group in the same lane. |
| `verb` | `fix`, `delete`, `shorten`, `rewrite`, `move`, `add` or `automate`. |
| `title` | What changes, in the reader's words. |
| `why` | One or two sentences. |
| `skip` | Required for calls: what goes wrong if the user skips the change. |
| `split` | Optional, for a close vote, for example "2 cut, 1 keep". |
| `edits` | One or more edits, in any files. |
| `evidence` | Optional list of `{ "text", "file", "line" }` or `{ "text", "url" }`. Shown under "How we know". |
| `check` | Optional second check: `{ "verdict": "same" or "drift", "summary" }`. A drift must sit in lane `call`. |

An edit either replaces lines or inserts new ones:

```json
{ "file": "CLAUDE.md", "lines": [5, 8], "write": [] }
{ "file": "CLAUDE.md", "lines": [26, 26], "write": ["- The new line."] }
{ "file": "tests/CLAUDE.md", "at": "end", "write": ["# Tests", "", "- The moved rule."] }
```

`lines` is the 1-based, inclusive range the edit removes, and `write` is the text that takes its place. `at` inserts before a line number, or at the `"end"`. The build quotes the removed lines from disk, so the page never shows text the file does not hold. Two changes may not edit the same line: merge them into one change.

## groups, questions, kept, next, ship

- `groups`: `{ "id", "lane", "title", "lede" }`. A `ready` group is on by default with an opt-out per change. An `auto` group renders collapsed as "Applied automatically", with an undo per change.
- `questions`: `{ "id", "text", "why", "options": [{ "id", "label", "detail", "recommended" }] }`. No option is preselected. Questions count as calls.
- `kept`: `{ "file", "lines": [first, last], "title", "why" }` for lines the run checked and keeps, shown collapsed.
- `next`: `{ "id", "title", "why", "command", "default" }` for follow-ups such as a bake run.
- `ship`: `{ "default", "remembered", "options": [{ "id", "label" }] }`. How the edits land. `remembered: true` labels the default as the user's usual choice.

## What the build refuses

- A call without `skip`, or a `drift` check outside lane `call`
- More than 5 calls (questions included) or more than 3 ready groups in one round
- Edit or `kept` lines outside the file, overlapping edits (in one change or across changes), an insert inside a replaced range, or a file that does not match its `new` flag
- A `run.round` or `run.rounds` that is not a whole number from 1, or a `run.waiting` that is not a whole number from 0
- A change in a group of another lane, or an empty group
- A question or `ship` with fewer than two options, or an option without a unique `id` and a `label`
- A `ship.default` that names none of its options, or a `next` item without a unique `id` and a `title`
- A file that is not UTF-8 text
- Any id (change, group, question, option, next) with characters other than letters, digits, `-` and `_`, one that is a built-in object key such as `constructor`, or one used twice in the same list
- An evidence `url` or `run.status.link` that is not http or https, or a `run.status` without a `state`
- `run.status.decisions` that name unknown changes, questions, options or next items, or hold values the page cannot show

## Record mode

After the apply, set `run.status` and build again:

```json
"status": {
  "state": "applied",
  "date": "2026-10-02",
  "summary": "8 changes applied, 1 skipped, 1 for the next round.",
  "link": "https://github.com/acme/books/pull/42",
  "decisions": { "d": { "livewire": "apply", "framing": "skip" }, "q": { "search-doc": "delete" }, "note": {}, "custom": {}, "ship": "pr" }
}
```

The page then shows the outcome and the decisions, with every control disabled. Every key in `decisions` is optional:

| Key | Shape |
| --- | --- |
| `d` | Change id to `"apply"`, `"skip"`, `"later"` or `null`. |
| `q` | Question id to one of its option ids, or `null`. |
| `note` | Change id, or `"q:"` plus a question id, to the user's note as text. |
| `custom` | Change id to the user's redrafted wording as text, lines joined with `\n`. |
| `gnote` | Group id to the user's note on the group as text. |
| `next` | Next item id to `true` or `false`. |
| `ship` | One of the `ship` option ids, or `null`. |

## Tests

From the repository root:

```
bun install
bun test plugins/bonsai/renderer
```
