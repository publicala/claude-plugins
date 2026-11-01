# bonsai evals

`claude plugin eval` runs the cases here against the plugin and scores each run. Each skill keeps its eval plan in `<skill>/PLAN.md`. The guard skill also has a suite that runs: three cases under `guard/`, one per promise below.

## Run the guard suite

From `plugins/bonsai`:

```bash
claude plugin eval . --case 'guard-*' --scaffold --allow-tools Bash Write Edit
```

- **`--scaffold`**: builds each case's workspace with `guard/fixture/setup.sh`, which runs as you outside the sandbox. It writes only to the run's temporary workspace and home.
- **`--allow-tools Bash Write Edit`**: guard reads pull requests with `gh` and the repository with `git`, and writes its scratch files. Bash runs inside the eval's OS sandbox: writes stay in the workspace and the network is closed.
- **`--trust-plugin`**: add it when the shell cannot answer the trust prompt (CI, or a run Claude starts for you).

Each case runs three times with the plugin and three times without it, so a full run is 18 sessions on your login and takes about TODO. One case once, while you change a grader: `--case guard-design-choice-is-none --runs 1 --ablation none`. Results land in `results/`, which git ignores. Add `--keep-temp` to keep each run's workspace and transcript.

## The fixture

The sandbox has no network, so `guard/fixture/` stands in for GitHub:

- **The repository**: `setup.sh` builds a small Go service for Acme Books at the workspace root, with the history of three pull requests (41 and 42 merged, 43 open) and an `origin` that points at `github.com/acme-books/inventory` but fetches from a local bare repository.
- **A fake `gh`**: `fixture/gh`, first on the sandbox's PATH, answers the reads guard makes (review threads over GraphQL, `gh pr view`, `gh pr diff`, `gh pr list`, the REST endpoints) from `prs/<number>/pr.json`. It refuses every write, and logs each call to `.git/eval-gh-calls.log` as `READ`, `WRITE` or `UNSUPPORTED`. The graders read that log, so a write made from a subagent or a script still counts.
- **A git wrapper**: macOS's `/usr/bin/git` is a shim that needs `xcrun`, which the sandbox blocks. `setup.sh` puts wrappers for the real git first on PATH, for the shell and for git's own subprocesses.

An `UNSUPPORTED` line in the log means guard asked for something the fake does not serve yet: add it to `fixture/gh` and run the case again.

## What each case guards

| Case | Pull request | It fails when guard |
| --- | --- | --- |
| `guard-auto-fix-candidate` | 41: a reviewer flags `for i, _ := range`, which `gofmt -s` rewrites | misses the candidate, picks a rung below auto-fix, or fills the cost line without a scratch run of `gofmt -s` in a throwaway worktree |
| `guard-design-choice-is-none` | 42: a reviewer asks for a map, the author keeps the slice and says why | turns the design choice into a check or a CLAUDE.md line, or gives another reason |
| `guard-overridden-check-is-held` | 43: the author adds the new file to the allowlist of the test that fired | proposes a new check for a rule a check already holds, or misses that the author overrode it |

Every case also fails when guard writes to GitHub, creates a guardrail branch or pushes before the user approves a candidate, or reads the threads without GraphQL. `skill-fired` reports whether the skill ran, and stays out of the score when the run has a baseline arm.
