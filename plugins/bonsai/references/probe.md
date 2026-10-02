# The clean-context probe

A probe replaces the loaded model's guess about what a fresh session would do. The model running a bonsai skill has read the line, the file, and the codebase, and it cannot un-read them, so its opinion that "a fresh session would derive this" or "would read that file first" is a simulation, not evidence. The probe runs the situation instead: one fresh low-effort agent (the weakest model the docs serve), given one concrete task in the real repository, without the line or rule under test, and the record of what it did decides.

Each skill states the question its probe answers. The mechanics and the validity rules below are the same everywhere.

## Kinds

- **Derivability probe** (audit, feed): give the agent a task the line governs, in the file's scope, without the line. Record whether it derives the fact or makes the mistake the line prevents. Makes the mistake: the line stays. Derives it: the line is cuttable or skippable.
- **Load-path probe** (split): give the agent the task that would commit the mistake, without mentioning the rule. Record from its tool calls whether it reads an in-scope file before the point where the mistake happens.
- **Marker probe** (split, after apply): give the agent one file matched by the scoped file's glob to read, and ask it to quote every context line containing a phrase unique to the scoped file. The phrase comes back: the glob fires.
- **Classification probe** (audit, extract pass): hand the agent a section with one question ("which execution environments does each sentence govern") and take its answer as the classification.
- **Meaning check** (audit, split): hand the agent, per change, the current text, the proposed text and the reason in one sentence. It verifies every claim and identifier against the repository and answers "same" or "drift: <what changed and why it matters>" per change, in at most 25 words. Drift covers a widened or narrowed scope, a dropped constraint nothing else enforces, a new claim the repository contradicts, and a wrong identifier. Never pass the auditor's notes or evidence: the check is worth something only because it did not reason the way the author did.
- **Planted-violation check** (bake): in a scratch copy of the repository, write one violation of the rule into a file the check covers, run the proposed check, and record whether it fails. Then run it on the untouched tree and record that it passes. A check that misses the planted violation, or fails on the clean tree, never reaches the user.

## Budget

Probes are the expensive step, and nothing above says how many. Before spawning any, group the derivability and load-path candidates by the task that would reveal them: one agent runs that task once, and its transcript yields a verdict per line the task exercised, so a section of six related lines costs one agent, not six. Cap those at about ten agents per pass (reruns included) and report every candidate the cap left unprobed as an open question, never as a verdict. A candidate that shares no task with any other gets its own agent only when the cap has room.

Post-apply marker probes sit outside the cap: every created or changed glob gets verified, so apply only as many globs per round as the run can verify. Meaning checks and planted-violation checks sit outside it too: one agent checks every rewrite of the run, and every proposed check gets its planted violation.

## Validity rules

- **For a behavioral probe, the probed line must be absent from the agent's context.** A derivability or load-path probe measures what an agent does without the line, so a line it can see measures nothing. Subagents receive the resident CLAUDE.md set the parent session loaded at launch, whatever working directory they run in: a worktree-isolated subagent gets the same set, and a file added or edited in a worktree after launch is not in it. So a line in an always-resident file (the root CLAUDE.md, user-level and ancestor files, `@path` imports) is present in every subagent, and no probe of it runs clean. Record that for those candidates and send them to the capability-floor panel. Scope-triggered and deferred files are absent until read, so their lines probe clean. A classification probe is exempt: it receives the section by design, because its question is about the text, not about behavior without it.
- **A behavioral probe runs the task, a judging probe answers only.** A derivability or load-path probe is evidence only if the agent attempts the task: the mistake, or the read before the mistake, has to appear in its transcript. A classification probe, a marker probe, a meaning check, and a capability-floor panelist return the answer and stop: tell them so, because a floor model handed a task or a block will otherwise start executing it. A meaning check receives the proposed text by design, like a classification probe.
- **Search the whole context, not just the file.** For a marker probe, say explicitly that the phrase may sit anywhere in the context window. Asked about "the file", an agent answers about the file alone and returns a false NONE.
- **Rerun once before judging a NONE.** Self-report probes return false negatives at a measurable rate even when phrased correctly. One NONE is a retry, two are the verdict.
- **One question per agent.** A behavioral probe asks one task, and the transcript answers for every line that task exercised, and for no other: one task cannot vouch for a line it never exercised. A marker probe asks about one glob: one file cannot vouch for a glob that did not select it.
