# Decision page renderer

Turn a bonsai run into a page the user can decide from in a few minutes. You write the data, and `build.ts` reads the quoted lines from disk, checks the data, and writes one HTML page ready to publish as an artifact.

```bash
bun build.ts data.json -o page.html
bun build.ts data.json --check
```

The script needs [Bun](https://bun.sh) 1.1.9 or later and nothing else: no install step, no dependencies. It prints a one-line summary on success, and on failure one error that names the change and what to fix. The page draws in Blueprint's tokens (`blueprint-tokens.css`, owned by the blueprint plugin).

The page's markup and style are in `template.html`, and its script is TypeScript in `page/`: `main.ts` runs the page, and the modules it imports hold the data's types, the word diff and the text helpers. The build bundles `page/` with Bun into the page's one `<script>`, so the page needs nothing at runtime. The bundling lives in `page-script.ts`, a symlink to the blueprint renderer's, which install copies in its place. `bun run typecheck` checks `page/` against the DOM.

## The data file

`example/data.json` is a complete run against the fixture in `example/repo/`. Start from it. A guard run has its own shape: see the Guard runs section and `example/guard-data.json`. A trimmed audit run:

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
    "waitingTokens": 1200,
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
| `waitingTokens` | Optional. Est. tokens all waiting changes remove from always-loaded files, shown next to the waiting count so the first round already says what later rounds save. The page says "the next round" when one round remains and "later rounds" when more do. A whole number from 0, and above 0 only when `waiting` is. |
| `channel` | Optional. `send` (the default) or `paste`: how the decisions reach the session. `send` uses the host's comments capability when it offers one, and copies otherwise. `paste` always copies, and never calls the capability. Use `paste` when no session can receive a sent comment: the host still accepts the comment and reports it sent, and nobody receives it. |
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
| `lane` | `call`, `ready` or `auto`. See the decision-page reference, `../references/decision-artifact.md`, for routing. |
| `group` | Required for `ready` and `auto`: the id of a group in the same lane. |
| `verb` | `fix`, `delete`, `shorten`, `rewrite`, `move`, `add` or `automate`. |
| `destination` | Required for a `move`, and only there: the rung of the delivery ladder (`../references/delivery.md`) the text lands on. `scoped-file` (a nested CLAUDE.md or a path-scoped rule), `root`, `deferred-doc` (a doc behind a read-trigger), `skill`, `code` (a docblock, a command description or `--help`, a check message) or `html-comment` (a reviewer-only why in a CLAUDE.md). At least one edit must write the destination's file: the root `CLAUDE.md`, a nested CLAUDE.md or a `.claude/rules/` file, a `.claude/skills/<name>/SKILL.md`, a file other than Markdown, a Markdown doc outside `.claude/` and the CLAUDE.md files, or a CLAUDE.md line holding `<!--`. Other edits (a root pointer) may sit beside it. A ready or auto move edits only Markdown outside `.claude/`, plus `.claude/rules/` files and `.claude/CLAUDE.md`: code, a skill, settings or a hook at any depth makes it a call. The card names it next to the verb. A move to `skill`, `code` or `html-comment` edits code or settings, or hides the line from sessions, so it sits in lane `call`. |
| `title` | What changes, in the reader's words, opening with the action. A `delete`, `move` or `add` opens with the word on its chip ("Delete", "Move", "Add"), and those words and "Remove" open no other verb's card. 80 characters at most, inline code counted without its backticks. |
| `why` | One or two sentences. |
| `tool`, `runs` | Required on an `automate` change, and only there: the check's tool, as the repository's own people name it ("PHPStan custom rule", "ESLint rule"), and the command, hook or CI job that runs it. The card shows both in a band under the title, so the title says only the rule. The build refuses a rung name as the tool, and a title that names the tool by its first word. |
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

`/bonsai:guard` turns one review round into candidate checks, and the user decides each one with Build, Skip or Later. A card carries everything the decision needs, so the user never opens the repository or the PR. It reads in two layers. The open one answers whether to build: the rule, one instance of the mistake, the tool that will run, the facts that weigh, the verdict, the code to write and what a session sees when it breaks the rule. The folded one holds the proof: why it comes back, the cost and tradeoff rows, the review quotes and the alternative. `example/guard-data.json` is a complete round. One candidate:

```json
{
  "id": "order-total-summed-by-hand",
  "title": "Read every order total from `Order::total()`",
  "case": "Invoice a taxed order: the hand-built total leaves out the VAT and bills low.",
  "recommendation": "recommended",
  "why": {
    "recurs": "seen-again",
    "verdict": "Recommended: one PHPStan rule holds it, with one exception.",
    "text": "A hand-built total skips the discount and VAT, so an invoice comes out low and a refund pays back too much. Three reviews caught it in three files, and summing the lines is the first thing a session writes when it needs a total."
  },
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
    "runs": "Runs in `composer phpstan`, which `composer test` and CI run.",
    "message": "Order totals come from Order::total(), which applies discounts and VAT."
  },
  "tradeoff": {
    "forbids": "Any sum over `$order->lines`, even one that wants the subtotal. The way past it is `Order::subtotal()`.",
    "breaks": "`Order::total()` is renamed: the rule names it, so its test fails and names the rename."
  },
  "cost": {
    "violations": "4 violations, all fixed. This PR fixes all four.",
    "exceptions": "1 exception. `Order::total()` itself sums the lines.",
    "falsePositives": "None",
    "runTime": "+1s on `composer phpstan`",
    "newTools": "None. PHPStan runs in `composer test` and CI.",
    "overlap": "#61 edits `InvoicePdf.php`. Merge this one after it."
  }
}
```

| Field | Meaning |
| --- | --- |
| `id` | As for changes. Name it by the mistake a session makes. |
| `title` | The rule as what a session writes, in the code's own terms: "Read every order total from `Order::total()`". The title rules every card follows apply, in 60 characters, since the badge shares its line. |
| `case` | One concrete instance of the mistake, open under the title: what a session does and what goes wrong. 110 characters at most. |
| `recommendation` | `recommended`, `close call` or `low value`, shown as a badge. |
| `why` | Why the guardrail is worth building. `recurs` says why a fresh session writes the mistake again: `framework-default` (the framework's own helper or default), `seen-again` (the review raised it in two or more threads), `code-shows-it` (the surrounding code teaches the wrong form) or `once` (one caller wrote it once). `verdict` is one sentence, open on the card, of 140 characters at most: what the recommendation rests on, opening with it ("Close call: ..."). `text` is two sentences at least, folded: what goes wrong when the mistake ships, then why a session writes it again. A count or a time lives in its cost row alone, so the build refuses a number above 1 in the why that a cost row holds. |
| `caught` | `quotes`: 1 to 4 of `{ "reviewer", "text", "url" }`, each excerpt at most 300 characters, with the http or https link to its thread. They sit in the "What reviewers said" fold. `count`: how many threads raised it, shown on the first chip. It defaults to the number of quotes. |
| `mistake` | `wrong` and `right`: the code a session wrote and the code to write instead, shown as two blocks. `lang` labels both, and `note` adds one line under them. |
| `guardrail` | `rung` from 1 to 8, `tool`, `where` (the files the check lives in), `runs` (the command, hook or CI job that runs it) and `message` (the exact text it prints when it fails). `tool` is free text, as the repository's own people name it ("Pest arch()", "ESLint rule", "Rector rule"), so a new tool needs no change here. The build refuses a rung name in its place, and a title that names the tool by its first word. The tool band under the case shows the tool, the rung, `where` and `runs`. The table below says which each rung needs. |
| `tradeoff` | What the check costs in rigidity. `forbids`: the forms it blocks that someone may write on purpose, and the way past it (a helper, an exception list, a suppression with its reason). `breaks`: the change that makes the check fail for the wrong reason or scan nothing (a moved path, a renamed helper, a constant that drifts from the real value). Checks only: a CLAUDE.md line carries none, and its tool band says that nothing enforces a line. |
| `cost` | The cost line as an object with one text value per row. A check: `violations` (on the default branch, and whether this PR fixes them), `exceptions`, `falsePositives`, `runTime`, `newTools`, `overlap` (with open PRs). A CLAUDE.md line: `violations`, `tokens`, `loadsWhen` (which sessions load the file), `alreadyStated`, `overlap`. Every row is required, and the build refuses any other: a reason the cost gate weighed goes in `why`, and a rigidity in `tradeoff`. A row or a tradeoff runs 200 characters at most: how the check was measured goes in the PR. |
| `alternative` | Optional. A cheaper or narrower check, in one sentence. |
| `edits` | Only for a CLAUDE.md line: the line it writes, as for changes. |
| `evidence`, `check` | Optional, as for changes. |

A candidate is always a call, so it needs no `lane` or `verb`, and a guard run has no groups. It carries no `skip` either: the first sentence of `why.text` says what goes wrong when the mistake ships.

| Rung | `tool`, `where` and `runs` | `message` | `tradeoff` |
| --- | --- | --- | --- |
| 1 Unwritable | Required | Required: the error the type or schema raises | Required |
| 2 Auto-fix | Required | Optional. Without one the card says the tool rewrites the code on commit. | Required |
| 3 Static analysis, 4 Arch or guard test, 5 ast-grep, 6 Git hook, 7 Runtime guard | Required | Required | Required |
| 8 CLAUDE.md line | `tool` optional, `runs` refused. The band names the files its `edits` write. | None. The line goes in `edits`. | None |

The rest of a guard round:

- `run.branch`: optional. The default branch the checks ran on, so the cost table reads "Violations on `main`". Without it the label says "the default branch".
- `run.prs`: optional. One sentence on how built candidates land, shown in the summary and before sending. It defaults to "Each candidate you build becomes its own pull request from the default branch, labelled `guardrail`."
- `notNow`: `{ "id", "title", "why", "threads" }` for the candidates the cost gate stopped, titled as a candidate is. `why` is the reason, and `threads` lists their thread links. They render collapsed, each with a "Build anyway" switch.
- `none`: `{ "finding", "verdict", "url" }` for the findings with no guardrail, as the triage table states them: "Inbox keys act under an open dialog" with "One-off bug, fixed in the PR". They render collapsed, with nothing to decide.
- `questions` and `next` work as in any run. A guard run takes no `ship`.

A card reads top down in the order a decision needs: the title and badge, the case, the tool band, a strip of chips, the verdict, the mistake, and what a session that breaks the rule sees (the message, the line a CLAUDE.md candidate writes, or a note that an auto-fix rewrites the code). The strip holds the threads and the PRs of the quotes, the `recurs` chip, and the first sentence of `violations`, `exceptions` and `runTime`, or of `tokens` and `loadsWhen` for a line. A chip reads alone, so the build refuses a first sentence over 24 characters, or one that says only "None": open with the count or the time and its noun ("4 violations, all fixed", "No exceptions"), and give the detail in a second sentence. When `newTools` opens with any word other than "None", "No" or "Nothing", its first sentence flags the tool band as a new tool, under the same limit. Four folds follow, all closed: "Why it comes back", "Cost and tradeoffs" ("Cost" for a line), "What reviewers said" and "Alternative".

The page has no preview pane, since each card shows the whole line it writes. The token meter appears only when a CLAUDE.md line edits a resident file. The buttons read Build, Skip and Later (keys `b`, `s` and `l`), and the message opens with `Build the bonsai guard of <target>, round <n>, with these decisions:`. It holds one line per candidate with its rung and tool, then `- not now <id>: build anyway` for each candidate the user pulled back in.

In record mode, `run.status.state` set to `built` shows as Built, `run.status.prs` maps each candidate or not-now id to its PR and shows the link on its card, `decisions.d` keeps `apply` for Build, and `decisions.pull` records the switches.

The build refuses, in a guard run:

- A candidate without `title`, `case`, `recommendation`, `why`, `caught`, `mistake`, `guardrail` or `cost`, with a `skip`, or with a `recommendation` other than the three
- A candidate or not-now title over 60 characters, or a `case` over 110
- A `why` without `verdict` or `text`, a `verdict` that is not one sentence of 140 characters at most, a `text` under two sentences, a number above 1 in either that a cost row holds, a `recurs` other than the four, or `seen-again` on a `caught.count` of 1
- A `rung` that is not a whole number from 1 to 8, or a rung that lacks what the table above requires
- A `tool` that names a rung ("Static analysis"), a check without `runs`, or a CLAUDE.md line with `runs`
- A check (rungs 1 to 7) that carries `edits` or lacks `tradeoff.forbids` or `tradeoff.breaks`, a CLAUDE.md line without `edits`, or a CLAUDE.md line with a `message` or a `tradeoff`
- A `cost` that is a list, that lacks a row its rung measures, that holds a row its rung does not, or that holds a value other than text. A row or a tradeoff over 200 characters. A chip row (or a `newTools` that names a tool) whose first sentence runs past 24 characters, or a chip row that opens with "None"
- No quotes or more than 4, a quote over 300 characters or without a `reviewer`, a quote `url` or a `notNow` thread that is not http or https, or a `count` below the quotes shown
- A `notNow` item without `id`, `title` and `why`, or with an id another not-now item or a candidate uses, and a `none` row without `finding` and `verdict`
- A `ship`, or a round with no candidate and nothing not now
- A `run.status.prs` link for a candidate the decisions do not build: one without `apply` in `decisions.d`, or a not-now id without `true` in `decisions.pull`
- `notNow`, `none`, `run.branch`, `run.prs`, `run.status.prs` or a candidate field (`case` included) in any other run

## What the build refuses

- A title of a change, group, guard candidate or not-now candidate that opens with "A", "An" or "The", or that runs past 80 characters. A `delete`, `move` or `add` whose title opens with another word than its own, or a change of another verb whose title opens with "Delete", "Remove", "Move" or "Add"
- An `automate` change without `tool` and `runs`, a `tool` that names a rung, or a `tool` or `runs` on any other verb
- A call without `skip`, or a `drift` check outside lane `call`
- A `move` without a `destination` from the list, a `destination` on any other verb or on a guard candidate, a move whose edits write no file of its destination, a ready or auto move that edits code, a skill, settings or a hook, or a move to `skill`, `code` or `html-comment` outside lane `call`
- More than 5 calls (questions and guard candidates included) or more than 3 ready groups in one round
- Edit or `kept` lines outside the file, overlapping edits (in one change or across changes), an insert inside a replaced range, or a file that does not match its `new` flag
- A `run.round` or `run.rounds` that is not a whole number from 1, a `run.waiting` or `run.waitingTokens` that is not a whole number from 0, or a `run.waitingTokens` above 0 with no waiting change
- A `run.channel` other than `send` or `paste`
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

```bash
bun install
bun test plugins/bonsai/renderer
```
