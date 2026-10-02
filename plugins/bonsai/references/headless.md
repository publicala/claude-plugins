# Headless mode

Run a bonsai skill with `--headless` when someone else should review the result in a pull request: no questions, no page. The skill runs every check, applies the round on a branch, and opens a draft PR in which each call is one review thread.

## The pull request

1. Cut a branch from the default branch. Stop when the working tree is dirty: headless never asks.
2. Commit each ready group as one commit, named for its cause. Auto changes join their group.
3. Commit each call as its own commit, so one revert undoes it.
4. Push and open a draft PR. The body holds the outcome sentence, the est. tokens before and after, the ready groups with their counts, and one line per call linking its review thread. Close the body with: "Each call is a review thread: resolve it to keep the change, or commit its suggestion to undo it. Mark the PR ready when every thread is resolved."
5. Post one review with a comment per call. Questions go in the review body as a checklist, with the options and the recommended one marked.

## One review thread per call

A review comment can sit only on a line the PR's diff shows, which is why every call is committed: its new text is in the diff, and the comment sits on it.

- The comment holds the title, the why, "If you skip: …", the second-check result when there is one, and the call's commit SHA.
- When the call edits one contiguous region of one file, add a `suggestion` block that restores the current text. "Commit suggestion" then undoes the call in one click. For a pure deletion, anchor the comment on the first line after the removed range (the last line before it at the end of a file), and suggest the removed lines together with that line.
- When the call edits several regions or files (a move), give no suggestion. Name the commit instead: reverting it undoes the call.

## What headless never does

- Ask a question, publish a page, or merge.
- Apply a change outside the round, or exceed the round budget in [rounds.md](rounds.md). The waiting changes stay in the run file for the next run.
- Write to the decision log. Only the user's own decisions train auto-apply ([decision-memory.md](decision-memory.md)).
