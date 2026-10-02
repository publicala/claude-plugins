# Rounds

A run can find more changes than one sitting absorbs. Verification is the expensive part, so it runs once, over the whole scope. The decisions then come in rounds the user can finish in a few minutes, and the next run of the skill continues where the last round stopped.

## Budget

A round holds at most 5 calls (questions included) and 3 ready groups. Fill it in this order:

1. Fixes to false or stale claims: they change what sessions do today.
2. Changes the second check flagged, and moves between files.
3. Close calls: split votes, borderline compliance counts.
4. Ready groups, largest token saving first.

Everything past the budget waits. Count it in `run.waiting` and set `run.rounds` to the rounds the run expects. A change the user marks Later joins the waiting set.

The same limit holds in plain text: one round per message, with its own approval.

## Run file

Write the full verdict list, every round included, to `~/.claude/bonsai/runs/<key>/<skill>-<date>.json` before you present the first round. `<key>` is the repository key from [intake-entry.md](intake-entry.md). Keep one entry per change:

```json
{
  "id": "livewire",
  "round": 1,
  "status": "proposed",
  "change": { "lane": "call", "verb": "fix", "title": "...", "edits": [] },
  "before": { "CLAUDE.md": ["exact text of every removed line"] }
}
```

`status` moves from `waiting` or `proposed` to `applied`, `skipped` or `later`. `change` is the change exactly as the page data holds it. `before` keeps the removed text so a later run can tell whether the file moved under it.

## Continue a run

When the skill starts, read the newest run file for this key and skill. If changes still wait or sit at `later`:

- Re-read every file they edit. A change whose removed lines still match `before` keeps its verdict and evidence. Locate the lines again by their text, since earlier rounds shift line numbers.
- A change whose lines changed goes back through the skill's checks, for those lines only.
- Present the next round from the waiting changes, ranked again. Do not repeat the verification for the rest.

A skipped change never comes back in a later round of the same run. A run ends when nothing waits. The file stays as the record.

## Apply

The decisions message is the approval for everything it names, including the ship choice: `pr` means a branch from the default branch, one commit per cause, and a PR. `local` means edits only. Stop and ask when the working tree is dirty.

- One commit per ready group that has at least one applied change, named for its cause.
- One commit per applied call.
- Local files outside a repository (user-level memory, `CLAUDE.local.md`): edit directly after a backup, no commits.

After the apply, update every entry's `status` in the run file, then reply on the page and republish it as the record (see [decision-artifact.md](decision-artifact.md)).
