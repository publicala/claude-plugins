# When a check replaces prose

A session meets a checked rule when the check fails, and the failure message is all it reads about the rule. So a check makes the rule's prose redundant once its message carries what the prose carried and the session meets it while the change is still in its hands. The prose then costs tokens in every session to save one local fix in the few that break the rule.

## A check holds a rule when it is

- **Committed**: it lives in a committed file (a tool config, a test, a hook, a CI workflow, the project's `.claude/settings.json`). A check in someone's local settings enforces nothing for teammates or CI.
- **Covering the rule's paths**: its file globs or analysed paths reach every path the rule governs. A rule about `app/` and `routes/` held by a check that reads only `app/` is unenforced in `routes/`.
- **Run before code lands**: a formatter, a hook, or a step of the lint or test command CI runs, so the failure reaches the session that wrote the code, locally or on its pull request.
- **Passing on the whole tree**: no baseline entry and no blanket ignore for the rule. A suppression of one site names the check and carries its reason next to it.
- **Naming the fix**: its message says what is wrong at the flagged site and what to write instead, in the project's words, as [rule-writing.md](rule-writing.md) prescribes. "Rule X violated" leaves the session guessing.

A formatter that rewrites the violation needs no message: the violation never survives the next format.

A check that misses one condition holds the rule with a gap. Treat the rule as unenforced until the gap closes: widen the paths, rewrite the message, or clear the baseline. Each of those is a `/bonsai:bake` change. A baseline counts as a gap because the code it lists still teaches the wrong pattern to every session that reads it.

## When one line stays next to a check

When following the message means restructuring work already done (which layer owns a call, where a class lives), the session has built on the wrong shape by the time the check fails. Keep one line that states the rule. A fix that is a local edit (rename, swap a call, add an argument, name a constant) needs no line.

## Pointers to checks

A line or clause that only names the check holding a rule ("held by an arch test", "PHPStan enforces this") goes with the prose. The check names itself when it fails, and a session that changes the rule finds the check with a search.
