# Decision memory

Bonsai remembers what the user decided, so the same question does not come back and a kind of change the user always applies stops asking. Everything lives under `~/.claude/bonsai/`, outside every repository, like the intake ledger.

## Files

- `~/.claude/bonsai/settings.json`: preferences that hold in every repository. Today `delivery`: `"page"` or `"text"`.
- `~/.claude/bonsai/decisions/<key>/settings.json`: preferences for one repository. Today `ship`: `"pr"` or `"local"`. `<key>` is the repository key from [intake-entry.md](intake-entry.md).
- `~/.claude/bonsai/decisions/<key>/log.jsonl`: one line per decided change, appended at apply time.

```json
{"date": "2026-10-02", "skill": "audit", "class": "audit:delete:standard-cli-usage", "id": "dev", "lane": "ready", "decision": "apply", "note": false, "removed": "- `composer dev` starts the server, queue, logs and Vite."}
```

`decision` is `apply`, `skip` or `later`. An undo of an automatically applied change logs as `skip`. `removed` is the removed text, joined with newlines, so a later run can recognize the same change.

## Change classes

A class names the cause of a change, the same way in every run and every repository: `<skill>:<verb>:<cause>`, for example `audit:delete:version-inventory`, `audit:delete:tool-enforced`, `audit:rewrite:pointer-to-trigger`, `split:move:subtree-rule`. A ready group is one cause, so its changes share a class. Reuse a class name from the logs before you mint a new one, and keep it in kebab case.

## Read it at the start

Before the first round, read both settings files and every log for this skill across all keys.

- **Standing preferences** are settings, never questions. When a preference is missing, ask it once, in the first round that needs it, and store the answer. Show the stored ship choice on the page with `remembered: true`.
- **A skipped change stays skipped.** Do not propose a change whose class and removed text match a `skip` in this key's log. It comes back only when its evidence changed: the removed text changed, or a new fact contradicts the reason the user gave in the note.
- **Earned autonomy.** A class moves to lane `auto` when the logs hold at least 20 decisions for it, at least 95% of them `apply`, and no `skip` among its last 10. Auto changes still show on the page, collapsed under "Applied automatically" with an undo per change, until the user says otherwise. A skip or an undo counts against the class at once, so a class that stops earning trust drops back to `ready` on the next run.

Calls never become auto. A fix, a drift, a move, a close vote or a new rule needs a person every time.

## Write it at apply time

Append one line per decided change, for every lane. Headless runs write nothing: only the user's own decisions train autonomy.
