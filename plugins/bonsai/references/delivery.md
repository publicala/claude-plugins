# Delivery

A rule bonsai keeps reaches the agent through one mechanism, and a check runs at one moment. This file names both, so audit, split, feed, bake and guard place a rule the same way.

## The ladder

Take the strongest rung that can hold the rule. A strong rung meets the session at the moment of the mistake, or removes the mistake, and costs nothing in the sessions it does not govern. Strongest first:

- **R0 Human only**: an HTML comment (`<!-- -->`) in a CLAUDE.md, the commit, the PR. For a "why" a reviewer needs and a session does not (`rule-writing.md`, in this directory).
  - The harness strips HTML comments from a CLAUDE.md before it injects the file, so a session pays nothing for them, and a plain file read still shows them.
  - Skills and `.claude/rules/` files carry no such promise: there, R0 is the commit or the PR.
- **R1 Make the mistake impossible**: a type, an API shape, a generator stub, a state machine. The next instance fails to compile or has no way to be written. A redesign of domain code comes only from guard (see "Domain redesigns").
- **R2 A check whose message names the fix**: held as `enforcement.md`, in this directory, defines it. Its kinds, strongest first, are auto-fix, static analysis, arch or guard test, ast-grep, git hook and runtime guard. A tool hook that denies a call and names the fix in its reason is a check of this rung, and "The moment" below says when it fits. A custom script comes last, when no tool the repository runs can express the check.
- **R3 Knowledge in the code next to the change**: a docblock, a command's description or `--help`, a check's message. The session reads it when it opens the file or runs the command, and so does every other agent and person.
- **R4 A scoped file**: a nested CLAUDE.md or a path-scoped rule. It loads on the first touch of a file in its scope (`load-model.md`, in this directory).
- **R5 A skill**: a procedure walked start to finish. Placement below.
- **R6 Hook-added context**: text a hook injects into the session. Last resort, bar below.
- **R7 The root file**: every session pays for it. It takes what cuts across the project: safety prohibitions, routing, precedence.
- **R8 A deferred doc with a read-trigger**: content one situation needs, behind a one-line trigger in a file that loads. It reaches only the sessions that follow the trigger.

Guard reads this ladder for one review finding. Its rung 1, Unwritable, is R1. Its rungs 2 to 7 are R2's kinds in the same order. Its rung 8, CLAUDE.md line, is R4, or R7 for a rule that cuts across the project.

## R5: where a skill lives

List the files the procedure touches, then place it:

- **All under one directory**: a nested skill, `<dir>/.claude/skills/<name>/SKILL.md`. It stays hidden until the first Read, Write or Edit of a file under `<dir>`, in the main session and in subagents.
- **Spread across trees**: a root skill, `.claude/skills/<name>/SKILL.md`, with `paths:` globs that cover those files.
- **Starts with a command** before it touches a file (a generator, a deploy), or needs a step before its first write (an approval): a root skill, since a nested one is still hidden when that step matters.
- **The skills directory is gitignored**, or the repository's skills are untracked local symlinks: a call. The skill reaches no clone and no cloud session (`load-model.md`, "Skills").

## R6: the bar for hook-added context

A hook that adds context (a SessionStart or UserPromptSubmit hook, `additionalContext` from a tool hook) passes only when both hold:

- No git event, check, code location or scoped file can see the trigger.
- A missed rule leads to an action that cannot be undone.

The text lives in settings, far from what it governs, so nobody reading the code finds it, and it drifts unseen. Audit may flag a hook as a call when a line meets the bar, and proposes none otherwise.

## The moment a check runs

Measure the check's run time on the repository, then pick the earliest moment it fits:

- **Pre-commit**: a check that takes seconds on the staged files. Wire it through lefthook, or the git hook manager the repository already runs.
- **Pre-push**: a suite too slow to wait on at every commit, up to a minute or two.
- **CI**: what runs longer, or needs services a laptop lacks.

A check that runs only in CI reaches the session after it pushed, so a fast one also runs earlier. CI keeps running it, since a local hook runs only where someone installed it.

A tool hook (PreToolUse or PostToolUse) fits only when no git event sees the rule (a command's flags, a deploy, a query against a shared database) and its result differs from what a git hook would give. When the result is the same, take the git hook through lefthook: it runs for people and every agent, next to the repository's other hooks.

## Domain redesigns

A rule about allowed transitions ("an order goes from pending to paid, and never back") is held best by a state machine or a transition guard (R1). That redesigns domain code, so only guard proposes it, from a review finding, and its cost gate weighs it against an R2 check such as a test of the allowed transitions. Expect the test for a single slip, and the state machine when the same kind of finding recurs or the transitions have many writers.

A candidate from anything other than a review finding (an audited line, a conversation correction, a commit diff) never reaches guard, which reads only PR review threads. It goes to bake for the test. Audit never proposes the refactor: a line that lists transitions becomes a call, "a transition guard or a check would hold this", handed to bake.

## Agents other than Claude Code

Whether the repository serves an agent that reads only the root file is stored per repository (`decision-memory.md`, `agents`). When it does, a move into a Claude-only mechanism (R4, R5, R6) leaves a one-line path pointer where that agent reads it: in `CLAUDE.md` when the root `AGENTS.md` is a symlink to it, else in the root `AGENTS.md` (`load-model.md`, "Other agents").
