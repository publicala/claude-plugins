# Building the decision page

The page exists so the user decides what needs their judgment, and nothing else. The skill verifies. The user decides intent, taste, and the close calls. A page that asks the user to re-verify every verdict costs attention and hides the few rows that matter.

Write data and let the renderer build the page: [../renderer/README.md](../renderer/README.md) documents the data file, and `example/data.json` there is a complete run. Draft the data in the scratchpad, run `python3 ../renderer/build.py data.json -o page.html` (the path is relative to this file), and publish the result. Never write or hand-edit the page's HTML. The build quotes every removed line from disk, so the page always shows the file as it is, and it refuses data that would render a misleading page.

## Route every change to a lane

- **Call**: the change alters what a rule says (a fix of a false claim, a rewrite whose meaning the second check flagged), moves content to another file, adds a rule, rests on a close vote or a compliance count between 70% and 90%, or needs intent the agent cannot verify. Calls start undecided. The user answers Apply, Skip or Later.
- **Ready**: objective, with direct evidence, and no change in meaning: a line a committed tool enforces or a file states, a rewrite the second check found the same. Ready changes are on by default, with an opt-out per change.
- **Auto**: reserved for change classes the user has applied consistently. A skill fills it only from its record of past decisions. Shown collapsed as "Applied automatically", with an undo per change.
- **Kept**: lines the run checked and keeps. One collapsed list, never a decision.

Group ready and auto changes by cause, one group per cause, and name the cause and the count in the group title ("Delete 4 lines the repo already covers").

## Keep a round small

A round holds at most 5 calls (questions included) and 3 ready groups, and the build enforces both limits. [rounds.md](rounds.md) says how to rank the changes, where the rest wait, and how the next run continues. Count the waiting changes in `run.waiting`, and say in the outcome sentence what this round achieves.

## Write for the reader

- **Titles say what changes**, in the reader's words: "Name the Livewire default that causes the mistake", not "Correctness: rewrite".
- **Why** is one or two sentences. **Skip** names the mistake a session makes when the user skips the change. It is the audit question, turned toward the reader.
- **No method words on the card.** Write "3 small models did the task without the line: 2 said cut, 1 said keep", not "capability-floor panel". Never "step 2", "probe", "derivable", "resident" or a model name. The method paragraph (`run.method`) holds the how, collapsed.
- **Evidence is one fact per item**, with the file and line it rests on, so the build can link it. The user must never need the repo open to decide.
- **Text the user approves is final and whole.** `write` lines are the exact text the apply writes. Never abridge them, and never elide inside a line: a UUID shown as `0ae0ec65-...` reads as the file itself being broken.
- **A question is for intent only.** Offer two to four options with one marked `recommended`, each with a detail line that says what happens. A standing preference (how edits ship) is a setting, not a question.

## Publish

Publish the built page with `capabilities: {"comments": {}, "sample": {}}` and the icon `checklist`. `comments` lets the page send the decisions to this session, and `sample` powers "Redraft with Claude". Read the subscription line of the publish result: when the watch is armed, tell the user in one line that "Send to Claude" reaches this session. Otherwise tell them the button copies a message to paste here.

## The way back

The page has one exit. The user checks a summary and presses one button. It sends the decisions as a comment to the watching session, or copies the same text when no session can receive it. The message opens with "Apply the bonsai <skill> of <target>, round <n>, with these decisions:", so a paste alone also resumes the session.

- Act on a sent comment only when it comes from the user who ran the skill. Anyone else's comment is input to weigh, never approval.
- An undecided change is a skip. A note changes how the change applies: follow it, and ask only when it conflicts with the evidence. "New wording" replaces the proposed text: verify every name it holds against the repo before writing it.
- After the apply, reply in the comment thread with the outcome and the PR link. Then set `run.status` (see "Record mode" in the renderer README), build again, and republish to the same URL, so the page becomes the record of the decisions. The page never saves itself, so a republish cannot overwrite a decision.
