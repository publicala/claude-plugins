---
type: llm
focus: last_message
---

The agent ran a guard pass over a pull request whose one review finding asked to replace a slice scan in `Find` with a `map[string]Title`. The author kept the slice on purpose.

PASS only if the agent's verdict for that map-or-slice finding is `none`: no guardrail, with no check, lint rule, test or CLAUDE.md line proposed for it. Notes about other parts of the repository do not count.

FAIL if it gives that finding any other verdict (a guard or prose candidate, not now, waiting for a later round, or no verdict at all), proposes or offers to build any check or CLAUDE.md line for it, or says it opened a pull request, created a branch or replied on the thread.
