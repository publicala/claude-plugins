# The clean-context probe

A probe replaces the loaded model's guess about what a fresh session would do. The model running a bonsai skill has read the line, the file, and the codebase, and it cannot un-read them, so its opinion that "a fresh session would derive this" or "would read that file first" is a simulation, not evidence. The probe runs the situation instead: one fresh low-effort agent (the weakest model the docs serve), given one concrete task in the real repository, without the line or rule under test, and the record of what it did decides.

Each skill states the question its probe answers. The mechanics and the validity rules below are the same everywhere.

## Kinds

- **Derivability probe** (audit, feed): give the agent a task the line governs, in the file's scope, without the line. Record whether it derives the fact or makes the mistake the line prevents. Makes the mistake: the line stays. Derives it: the line is cuttable or skippable.
- **Load-path probe** (split): give the agent the task that would commit the mistake, without mentioning the rule. Record from its tool calls whether it reads an in-scope file before the point where the mistake happens.
- **Marker probe** (split, after apply): give the agent one file matched by the scoped file's glob to read, and ask it to quote every context line containing a phrase unique to the scoped file. The phrase comes back: the glob fires.
- **Classification probe** (audit, extract pass): hand the agent a section with one question ("which execution environments does each sentence govern") and take its answer as the classification.

## Validity rules

- **The probed line must be absent from the probe agent's context.** Otherwise the probe measures nothing. Subagents receive the resident CLAUDE.md set the parent session loaded at launch, whatever working directory they run in: a worktree-isolated subagent gets the same set, and a file added or edited in a worktree after launch is not in it. So a line in an always-resident file (the root CLAUDE.md, user-level and ancestor files, `@path` imports) is present in every subagent, and no probe of it runs clean. Record that for those candidates and send them to the capability-floor panel. Scope-triggered and deferred files are absent until read, so their lines probe clean.
- **Verdict only, never the task.** Tell the agent to answer the recorded question and stop. A floor model handed a task or a block will otherwise start executing it, and the transcript stops being evidence.
- **Search the whole context, not just the file.** For a marker probe, say explicitly that the phrase may sit anywhere in the context window. Asked about "the file", an agent answers about the file alone and returns a false NONE.
- **Rerun once before judging a NONE.** Self-report probes return false negatives at a measurable rate even when phrased correctly. One NONE is a retry, two are the verdict.
- **One agent per question.** A probe answers one question about one line, rule, or glob. One file cannot vouch for a glob that did not select it, and one task cannot vouch for a line it never exercised.
