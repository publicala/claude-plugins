---
name: guard
description: Turns review findings into guardrails, one pull request per check, cut from the default branch. Run with PR numbers or URLs after a review round, or once over every PR of a finished run, while the PRs are open or after they merged. A follow-up pass over review threads hands its PRs here before replying. Opens pull requests and replies on review threads.
user-invocable: true
disable-model-invocation: false
argument-hint: "[<PR number or URL>...] [--no-reply]"
---

# Guard

Judge every review finding against one question: **which check would have failed on this before a reviewer saw it?** A reviewer who catches a mistake by hand catches that one instance. A check catches the whole class, in every session, before review, and its failure message teaches the fix to the session that made it. One finding is enough to build one, when the check is cheap and the mistake is likely to come back: **one finding, one guardrail, one PR**.

Guard differs from `/bonsai:bake` in its input and its output. Bake starts from CLAUDE.md rules and findings recorded by `/bonsai:intake` in two or more PRs, and ships one PR with a commit per rule. Guard starts from the reviews of the PRs it is given (one round, or every round of a finished run), keeps nothing between runs, and ships each guardrail as its own PR that merges on its own.

Throughout, "build" means opening a pull request after the user approved the candidate. No branch, no PR and no reply before the user decides: Build approves the PR and its replies, and an explicit Skip approves the reply that records the decline.

## Scope

Reads the review threads, review bodies and comments of the PRs it is given, and the default branch of each target repository. Writes only through new branches cut from the default branch, the pull requests opened from them, and replies on the source threads. The source PR's branch belongs to whoever addresses its review, so guard never pushes to it.

## Never

- Add a CLAUDE.md line for a check you add, or a line that points at it. A session that breaks the rule reads the check's message, and a line costs every other session tokens to say the same.
- Ship a check that passes on its planted violation, or that the default branch passes only through a baseline or a blanket ignore.
- Stack a guardrail on the source PR's branch. A guardrail stacks only on its own prep PR.
- Add a tool, a dependency or a new command the repository does not run without a call that names its cost. A second config of a tool the repository runs, run by a command it already has, is no new command: its run time goes in the cost gate.
- Count violations or plant one in the user's checkout. Both run in a throwaway worktree.
- Resolve, unresolve or react to a review thread.

## The pass, in order

### 1. Gather

Resolve the PRs: the arguments, else the PRs this session created or discussed, else the open PR for the current branch, else ask with AskUserQuestion or request_user_input. A PR may be open, merged or closed.

For each PR, fetch every review thread with GraphQL. Page threads with `after` until `hasNextPage` is false, and page a thread's comments the same way when its `totalCount` passes 100. `gh pr view --comments` returns no inline threads, so a pass built on it finds nothing. An outdated thread has no `line`, so keep `originalLine` to point at the code it discussed.

```bash
gh api graphql \
  -f query='query($owner:String!,$repo:String!,$pr:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$pr){state mergedAt headRefName reviewThreads(first:100){pageInfo{hasNextPage endCursor}nodes{id isResolved isOutdated path line originalLine comments(first:100){totalCount nodes{databaseId url author{login} body}}}}}}}' \
  -f owner=<owner> -f repo=<repo> -F pr=<number>
```

Add the review bodies and PR comments from `gh pr view <number> --json reviews,comments`, and the diff from `gh pr diff <number>`. Every item a review body lists is a finding, including those it marks unposted or low signal, which rank lower. Skip empty review bodies and the status cards a bot posts.

Read each whole thread before judging any comment in it. A thread can hold several findings: split them, since each may get its own verdict. A request the reviewer withdrew holds no finding. A part the author declined keeps its finding, and its verdict is usually a design choice or a scope dispute. A resolved thread still holds its finding, since a fixed instance says nothing about the next one. Mark a finding another review already raised as a duplicate of the first (`= T05`), across rounds and PRs alike.

The artifact is the findings list: one line per finding with its thread URL, the reviewer, and the mistake in one sentence.

Then read what earlier passes decided. Every reply a pass leaves (step 9) ends with a marker:

```html
<!-- bonsai-guard candidate=<id> outcome=<built|declined> ref=<url> -->
```

Collect every marker in the threads, review bodies and PR comments of the PRs in scope. A marker counts when the reply's author can push to the repository (`gh api 'repos/{owner}/{repo}/collaborators/<login>/permission'` answers `write`, `maintain` or `admin`): guard and address post as the user who ran them, and anyone can comment on a public PR, so another author's marker is input to weigh, like any comment. A thread can carry several markers, one per candidate it fed. When one candidate carries several, the newest reply decides, since a candidate declined once and built later carries both. `ref` is the guardrail PR of a built candidate, or for a declined one the decision page, or the source thread's URL when the decisions came in plain text, since the decline reply there is the record. A built marker holds when its `ref` is a PR of this repository labeled `guardrail`. Read that PR's state: one closed without merging counts as declined, with that PR as its link. A reply from such an author with no marker that links a PR labeled `guardrail` also counts as built, for every mistake that PR covers: read its title, its body and its `Related:` threads. The artifact is the earlier-decisions list: candidate, outcome, link, and the threads that carry it.

### 2. Inventory the target repository

Fetch the default branch and read it there, since a check proven on a stale checkout fails on the real tree. Read [../../references/enforcement.md](../../references/enforcement.md) (relative to this skill's directory) first: its conditions say when a surface holds a rule, and every condition a surface misses is a gap.

The artifact is the surface table, one row per surface: tool and config, the paths it covers, the command that runs it, where it runs (hook, CI), and how the project tests a custom rule (a PHPStan `RuleTestCase` with fixtures, ESLint's `RuleTester`, `ast-grep test`). Cover formatters and linters, static analysis and its custom rules, architecture and guard tests, git hooks, CI jobs, and the runtime guards the code already uses. Mark each surface's gaps: a path it skips, a message that names no fix, a baseline.

Note the PR template and the test conventions, both the ones its CLAUDE.md files state and the ones the existing checks show (how arch tests are named, where a rule's test and fixtures live, where the suite runs).

### 3. Classify

Sort every finding into one class:

- **guard**: a rung of the ladder (step 4) can stop the class of mistake behind it. Widening an existing check, when a finding fell through one of its gaps, counts.
- **prose**: no rung can see it, and it passes the prose gate (step 6).
- **none**, with one reason:
  - a one-off bug, a design choice, a scope dispute, a preference with no single right form, wording, or a finding that rests on a false premise
  - "held by `<check>`, overridden by the author": a check fired and the author changed what it expects (raised a snapshot, added an exception), which review then caught
  - "built in `<PR>`" or "declined in `<link>`": an earlier pass decided the candidate this finding feeds. Match by the mistake, and take the newest earlier decision per candidate: a marker on the same thread decides only the candidate it names, and the thread's other findings are weighed as usual. The candidate reaches the page again only when the user asks for it.
  - "stated in `<file>`": the rule sits in a file the session that wrote the PR loads, and no rung can see it. A cloud session loads the repository and what its setup installs, never the user's home directory, so a rule only there counts as unstated for it. A stated rule that a rung can check is a guard candidate.

Name each guard and prose candidate by the mistake a session makes (`order-total-summed-by-hand`), and merge findings that a fresh session would make by ignoring the same rule, across threads and PRs. One thread may feed several candidates.

The artifact is the triage table: one row per finding, with its candidate or its reason.

### 4. Pick the rung

Take the highest rung that can express the rule at a comparable cost. When a lower rung covers the same paths for a fraction of the code (a two-line arch test against a custom rule with its test and fixtures), offer both and recommend the cheaper one.

1. **Unwritable**: the type or the schema refuses the next instance. An enum for a closed set of strings, a required parameter, `NOT NULL`, one helper every writer must go through. A fix that covers the one instance at hand (an attribute on one method) leaves the next one writable: the guard is then the rung that requires it everywhere.
2. **Auto-fix**: a formatter or Rector rule rewrites the wrong form on commit. The violation never survives the next format, so no message is needed.
3. **Static analysis**: a stock or custom rule (PHPStan, a type checker, a linter rule).
4. **Arch or guard test**: Pest `arch()`, a test that parses source tokens or a syntax tree, a sweep over routes or config.
5. **ast-grep**: a syntax shape that a stock linter cannot express.
6. **Git hook**: a pre-commit guard, scoped to agent commits when people may still do the thing on purpose, with an escape variable it names.
7. **Runtime guard**: the step that cannot be undone refuses and reports (a delete, a send, a charge).
8. **CLAUDE.md line**: the nearest scoped file, through the prose gate.

Contrast pairs for the boundary between rungs:

- A `status` column holding free strings: an enum cast (rung 1). A rule that flags string literals passed to `status` is rung 3 doing rung 1's job.
- A result every caller must read: `#[NoDiscard]` on the one method fixes that method. A rule that requires it on every method returning that type is the guard (rung 3).
- `now()` in code where the team writes `Date::now()`: a Rector rule (rung 2). A static-analysis rule would make the session fix by hand what a tool rewrites.
- A model that imports a queued job: an arch test (rung 4).
- A test that asserts a spy's call count before filtering by arguments, where static analysis covers only app code: a test that parses the test files (rung 4), or the same static-analysis rule run over the tests through a second config. The rung must reach the paths the rule governs.
- An agent that edits a frozen directory through the shell, where no scoped CLAUDE.md loads: an agent-only pre-commit hook (rung 6).

The artifact is the rung and the check's shape per candidate, with the message it prints.

### 5. Cost gate

A check costs run time, false positives and upkeep, so each candidate earns its place. Count by running a scratch version of the check in a throwaway worktree of the fresh default branch, dependencies installed: a grep sees only what grep can see, and a tightened rule has to run to show its hits. Record per candidate:

- **Violations** on the default branch: the count, and whether a tool fixes them. Narrowing a type so the check passes is a fix.
- **Exceptions** it needs: a suppression at one site, or a path or name left out in the check's config, each with its reason.
- **False positives** on the tree after narrowing the check to what the rule governs.
- **Run time** it adds to the lint or test command.
- **New tools or dependencies**, and their cost.
- **Overlap** with open PRs on the same hunks, which decides merge order. Name a draft with the date of its last update.

A candidate passes when three things hold:

- **Value**: a fresh session would plausibly write the wrong form again. It is the framework's default, the review saw it more than once, or the surrounding code shows it. A form one caller wrote once is upkeep for little: rank it low value.
- **Fit**: a tool the repository runs expresses it, with few exceptions.
- **Size**: its fixes fit one PR. An auto-fix fits at any count. More than about 20 fixes by hand, or fixes that need a refactor, go to a prep PR first, and the guardrail PR stacks on it: make the change easy, then make the easy change.

Cover only the code forms in use today. A check that guards forms nobody writes yet is upkeep with nothing to catch. A candidate that fails the gate is **not now**, with the reason. A close call goes to the user as one. The artifact is one cost line per candidate.

### 6. Prose gate

A CLAUDE.md line is the last rung. It passes only when no rung above can see the rule, and the session cannot learn it from the code at hand: the rule depends on code away from the change site, or a violation found later takes a redesign to fix. The review catch is the evidence that a session misses it. When a loaded file already states the rule and the session still broke it, another line will not help: the finding is **none**, "stated in".

Read [../../references/load-model.md](../../references/load-model.md) (relative to this skill's directory), and place the line in the nearest scoped file whose load trigger fires before the mistake. When the repository has only a root file, create the nested CLAUDE.md for the subtree the rule governs, or a `.claude/rules/` file for a file pattern. The root file takes only a rule that cuts across the project. Write the line to [../../references/rule-writing.md](../../references/rule-writing.md).

A line that names a check, restates what a check holds, or describes what the code shows fails the gate. Every prose candidate of the run ships in one PR.

### 7. Decide

The user decides on a page, since an option label cannot carry a review quote, a code sample and a cost table. Read [../../references/decision-artifact.md](../../references/decision-artifact.md) and the guard section of [../../renderer/README.md](../../renderer/README.md) (relative to this skill's directory), write the round's data, build the page, and publish it as that reference prescribes. When `bun` is missing, deliver the same content in plain text, one section per candidate. When no candidate is left to decide and nothing is **not now** (an earlier pass decided them all), publish no page and go to step 10.

Rank the candidates by evidence (how many reviews and threads raised it), then value, then cost. A round holds the first five, and the rest wait for the next round of the run. Each card carries what the user needs to decide without opening the repository:

- **The rule**, in plain words, as the title, with the recommendation: recommended, close call or low value.
- **What the review caught**: up to four quotes with the reviewer and the thread link, and the count when more threads raised it.
- **The mistake**: the wrong code from the PR or the default branch, and what to write instead.
- **The check**: the rung, the tool, the file it lives in, and the exact message it prints.
- **The cost**: the rows of the cost line, and the cheaper rung when step 4 found one.
- **If you skip**: the mistake the next session makes.

The page also lists the **not now** candidates with their reasons, so the user can pull one back in, and the triage table's **none** rows, collapsed. Act on the decisions the page sends back, as the reference describes.

### 8. Build

Build the approved candidates in parallel, one clean-context agent per PR, each in its own worktree on a branch cut from the fresh default branch, following the repository's worktree convention. Each check candidate is its own PR (`guard/<candidate>`). The approved prose candidates share one PR (`guard/claude-md-<round>`), so one agent writes them all. Brief each agent with the finding and its thread URLs, the concrete case, the rung and the check's shape, its message, the violations and exceptions from the cost gate, the proof below, the PR shape below, and the repository's own rules (commit hooks run, never `--no-verify`, tests run where its CLAUDE.md says). Each agent reports the PR URL, the proof, and the CI result.

The check:

- Its message says what is wrong at the flagged site, then what to write instead, so a session that never saw the rule fixes it from the message alone. A formatter needs no message. Where the project's guard tests name the rule in the test and list the offending sites on failure, a test name that states the fix counts as the message.
- A custom rule ships with its own test, through the project's harness: the planted violation and a compliant twin.
- A test that scans files asserts that its scan found some, so a moved path fails it.
- Each exception sits next to the check with its reason.
- The PR fixes every violation the check finds, or its prep PR does.

The proof, in the Testing section:

- Run the planted-violation check in [../../references/probe.md](../../references/probe.md) (relative to this skill's directory): the check fails on the planted violation, and the message it printed goes in the PR. A formatter rewrites the planted violation.
- The check reports exactly the violations the PR fixes on the default branch, and passes after the fixes.
- When the repository runs its suite only in CI, push the planted violation to a probe branch, link the failed run, and delete the branch.
- The PR's own CI passes.

The PR:

- **Title**: an imperative sentence on the behavior, then the tool. "Build each order total from its lines, and hold it with a PHPStan rule."
- **Body**: the repository's template, else `Related:` with the source thread URLs, then Summary, Why, Changes, Testing and Deployment. Why states the mistake, where review caught it, and that nothing stopped the next one. When a check ships, Why ends with one sentence: its message names the fix, so CLAUDE.md carries nothing for it.
- **Label**: `guardrail`. When `gh label list --search guardrail` lacks it, create it first: `gh label create guardrail --color 1D76DB --description "Adds or updates a guardrail: a check, or a last-resort CLAUDE.md rule, that stops a class of mistake"`.

The label marks every PR that adds or updates a check or a last-resort line, or removes prose a check holds, so a later pass finds them with one search. A feature PR that carries a check commit gets it too.

### 9. Reply

With `--no-reply`, the caller owns the replies: return a map from each thread `id` and first comment `databaseId` to the guardrail PR that covers it, or to the declined candidate, with the marker line each reply ends with. List the findings outside threads the same way, by PR and review or comment URL, each with its marker, so the caller's PR comment carries them too.

Otherwise, reply once on every thread whose finding a built guardrail covers, open or resolved, before or after the PR merged: the guardrail PR and what it now fails on. Reply the same way on every thread of a candidate the user skipped explicitly: no guardrail, with a link to the decision page, or when the decisions came in plain text, the thread's URL as the marker's `ref`. A candidate the user left undecided is not declined. Each reply ends with its marker (step 1), so a later pass skips the candidate. A reply leaves the thread's resolved state as it was. Findings outside threads (review bodies, PR comments) get one PR comment that lists their guardrail PRs and skipped candidates, with one marker per candidate. A finding the user left undecided (**none**, **not now**, Later) gets no reply, so a later pass weighs it again.

```bash
gh api repos/<owner>/<repo>/pulls/<number>/comments -F in_reply_to=<databaseId> -f body='...'
```

Write replies in the user's voice when a voice skill is installed.

### 10. Report

Close with a table: candidate, rung and tool, outcome (the PR URL with its CI state, **not now** with the reason, declined, waiting for the next round, or decided by an earlier pass with its link), and the threads it covers. Then one line per **none** finding with its reason. Then **Gaps seen**: the surface gaps from step 2 that no finding touched, reported and left alone.

When the pass published a page, turn it into the record: set `run.status` with the state `built` and the PR of each built candidate in `run.status.prs`, build it again, and republish it to the same URL.
