# Decision page renderer

Turn a bonsai run into a page the user can decide from in a few minutes. You write the data, and `build.ts` reads the quoted lines from disk, checks the data, and writes one HTML page ready to publish as an artifact.

```
bun build.ts data.json -o page.html
bun build.ts data.json --check
```

The script needs [Bun](https://bun.sh) 1.1.9 or later and nothing else: no install step, no dependencies. It prints a one-line summary on success, and on failure one error that names the change and what to fix. The page draws in Blueprint's tokens (`blueprint-tokens.css`, owned by the blueprint plugin).

The page's markup and style are in `template.html`, and its script is TypeScript in `page/`: `main.ts` runs the page, and the modules it imports hold the data's types, the word diff and the text helpers. The build bundles `page/` with Bun into the page's one `<script>`, so the page needs nothing at runtime. The bundling lives in `page-script.ts`, a symlink to the blueprint renderer's, which install copies in its place. `bun run typecheck` checks `page/` against the DOM.

## The data file

`example/data.json` is a complete run against the fixture in `example/repo/`. Start from it. A guard run has its own shape: see [Guard runs](#guard-runs) and `example/guard-data.json`. A trimmed audit run:

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
      "edits": [{ "file": "CLAUDE.md", "lines": [26, 26], "write": ["- Pages are class-based Livewire components, and `make:livewire` makes single-file ones by default."] }],
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
| `skill` | `audit`, `bake`, `feed`, `guard` or `split`. Names the skill in the apply message. |
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

Every file a change edits. A guard run lists only the files its CLAUDE.md lines write, and may list none. `resident: true` marks files every session loads, and the token meter counts only those. `new: true` marks a file a change creates. The build refuses a file that is missing without the flag, or present with it. Files longer than 400 lines preview only the changed regions.

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

## Guard runs

`/bonsai:guard` turns one review round into candidate checks, and the user decides each one with Build, Skip or Later. A card carries everything the decision needs, so the user never opens the repository or the PR: the review quotes, the mistake as code, the check with its exact message, and its cost. `example/guard-data.json` is a complete round. One candidate:

```json
{
  "id": "order-total-summed-by-hand",
  "title": "Read every order total from `Order::total()`",
  "recommendation": "recommended",
  "caught": {
    "count": 3,
    "quotes": [
      {
        "reviewer": "simplify",
        "text": "This sums `price * quantity` over the lines by hand.",
        "url": "https://github.com/acme/books/pull/57#discussion_r2011401"
      }
    ]
  },
  "mistake": {
    "lang": "php",
    "wrong": "$total = $order->lines->sum('price');",
    "right": "$total = $order->total();"
  },
  "guardrail": {
    "rung": 3,
    "tool": "PHPStan custom rule",
    "where": ["app/PHPStan/OrderTotalRule.php", "phpstan.neon"],
    "message": "Order totals come from Order::total(), which applies discounts and VAT."
  },
  "cost": [{ "label": "Violations on `main`", "value": "4, all fixed in this PR" }],
  "skip": "The next invoice that needs a total sums the lines by hand and drops the discount."
}
```

| Field | Meaning |
| --- | --- |
| `id` | As for changes. Name it by the mistake a session makes. |
| `title` | The rule in plain words. |
| `recommendation` | `recommended`, `close call` or `low value`, shown as a badge. |
| `caught` | `quotes`: 1 to 4 of `{ "reviewer", "text", "url" }`, each excerpt at most 300 characters, with the http or https link to its thread. `count`: how many threads raised it, shown as "3 reviews flagged this". It defaults to the number of quotes. |
| `mistake` | `wrong` and `right`: the code a session wrote and the code to write instead, shown as two blocks. `lang` labels both, and `note` adds one line under them. |
| `guardrail` | `rung` from 1 to 8, `tool`, `where` (the files the check lives in) and `message` (the exact text it prints when it fails). The table below says which each rung needs. |
| `cost` | The cost line as rows of `{ "label", "value" }`: violations on the default branch and whether the PR fixes them, exceptions, run time, new tools, overlap with open PRs. |
| `skip` | The mistake the next session makes when the user skips it. |
| `alternative` | Optional. A cheaper or narrower check, in one sentence. |
| `edits` | Only for a CLAUDE.md line: the line it writes, as for changes. |
| `evidence`, `check` | Optional, as for changes. |

A candidate is always a call, so it needs no `lane`, `verb` or `why`, and a guard run has no groups.

| Rung | `tool` and `where` | `message` |
| --- | --- | --- |
| 1 Unwritable | Required | Required: the error the type or schema raises |
| 2 Auto-fix | Required | Optional. Without one the card says the tool rewrites the code on commit. |
| 3 Static analysis, 4 Arch or guard test, 5 ast-grep, 6 Git hook, 7 Runtime guard | Required | Required |
| 8 CLAUDE.md line | Optional. The card names the files its `edits` write. | None. The line goes in `edits`. |

The rest of a guard round:

- `run.prs`: optional. One sentence on how built candidates land, shown in the summary and before sending. It defaults to "Each candidate you build becomes its own pull request from the default branch, labelled `guardrail`."
- `notNow`: `{ "id", "title", "why", "threads" }` for the candidates the cost gate stopped. `why` is the reason, and `threads` lists their thread links. They render collapsed, each with a "Build anyway" switch.
- `none`: `{ "finding", "verdict", "url" }` for the findings with no guardrail, as the triage table states them: "Inbox keys act under an open dialog" with "One-off bug, fixed in the PR". They render collapsed, with nothing to decide.
- `questions` and `next` work as in any run. A guard run takes no `ship`.

The page has no preview pane, since each card shows the whole line it writes. The token meter appears only when a CLAUDE.md line edits a resident file. The buttons read Build, Skip and Later (keys `b`, `s` and `l`), and the message opens with "Build the bonsai guard of <target>, round <n>, with these decisions:". It holds one line per candidate with its rung and tool, then `- not now <id>: build anyway` for each candidate the user pulled back in.

In record mode, `run.status.state` set to `built` shows as Built, `run.status.prs` maps each candidate or not-now id to its PR and shows the link on its card, `decisions.d` keeps `apply` for Build, and `decisions.pull` records the switches.

The build refuses, in a guard run:

- A candidate without `title`, `recommendation`, `caught`, `mistake`, `guardrail`, `cost` or `skip`, or a `recommendation` other than the three
- A `rung` that is not a whole number from 1 to 8, or a rung that lacks what the table above requires
- A check (rungs 1 to 7) that carries `edits`, a CLAUDE.md line without them, or a CLAUDE.md line with a `message`
- No quotes or more than 4, a quote over 300 characters or without a `reviewer`, a quote `url` or a `notNow` thread that is not http or https, or a `count` below the quotes shown
- A `notNow` item without `id`, `title` and `why`, or with an id another not-now item or a candidate uses, and a `none` row without `finding` and `verdict`
- A `ship`, or a round with no candidate and nothing not now
- A `run.status.prs` link for a candidate the decisions do not build: one without `apply` in `decisions.d`, or a not-now id without `true` in `decisions.pull`
- `notNow`, `none`, `run.prs`, `run.status.prs` or a candidate field in any other run

## What the build refuses

- A call without `skip`, or a `drift` check outside lane `call`
- More than 5 calls (questions and guard candidates included) or more than 3 ready groups in one round
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
| `pull` | Guard runs only: not-now id to `true` when the user pulled it back in, else `false`. |

## Tests

From the repository root:

```
bun install
bun test plugins/bonsai/renderer
```
