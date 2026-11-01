# bonsai evals

`claude plugin eval` runs the cases here against the plugin and scores each run. Each skill keeps its eval plan in `<skill>/PLAN.md`. The guard skill also has a suite that runs: three cases under `guard/`, one per promise below.

## Run the guard suite

From `plugins/bonsai`:

```bash
claude plugin eval . --case 'guard-*' --scaffold --allow-tools Bash Write Edit --judge-model sonnet -j 3
```

- **`--scaffold`**: builds each case's workspace with `guard/fixture/setup.sh`, which runs as you outside the sandbox. It writes only to the run's temporary workspace and home.
- **`--allow-tools Bash Write Edit`**: guard reads pull requests with `gh` and the repository with `git`, and writes its scratch files. Bash runs inside the eval's OS sandbox: writes stay in the workspace and the network is closed.
- **`--judge-model sonnet`**: the judge answers PASS or FAIL in one word, and the default small judge flips on replies this long.
- **`-j 3`**: three sessions at a time, on one rate limit.
- **`--trust-plugin`**: add it when the shell cannot answer the trust prompt (CI, or a run Claude starts for you).

Each case runs three times with the plugin and three times without it, so a full run is 18 sessions on your login: about 5 minutes and $5 at list price with `-j 3`. One case once, while you change a grader: `--case guard-design-choice-is-none --runs 1 --ablation none`. Results land in `results/`, which git ignores. Add `--keep-temp` to keep each run's workspace and transcript.

## The fixture

The sandbox has no network, so `guard/fixture/` stands in for GitHub:

- **The repository**: `setup.sh` builds a small Go service for Acme Books at the workspace root, with the history of three pull requests (41 and 42 merged, 43 open) and an `origin` that points at `github.com/acme-books/inventory` but fetches from a local bare repository.
- **A fake `gh`**: `fixture/gh`, first on the sandbox's PATH, answers the reads guard makes (review threads over GraphQL, `gh pr view`, `gh pr diff`, `gh pr list`, the REST endpoints) from `prs/<number>/pr.json`. It refuses every write, and logs each call to `.git/eval-gh-calls.log` as `READ`, `WRITE` or `UNSUPPORTED`, with the query of a GraphQL call sent as a file or a request body. The graders read that log, so a write made from a subagent or a script still counts.
- **A git wrapper**: `fixture/git`, also first on PATH, runs the real git and logs each call to `.git/eval-git-calls.log`, with `WRITE` for a push, a new branch, or a commit in the workspace's own checkout. A scratch worktree with a detached HEAD is a read. It's also how git runs at all on macOS: `/usr/bin/git` there is a shim that needs `xcrun`, which the sandbox blocks, so `setup.sh` points the wrapper, and git's own subprocesses, at the real binary.

An `UNSUPPORTED` line in the log means guard asked for something the fake does not serve yet, and fails the `fixture-served-every-call` grader: add it to `fixture/gh` and run the case again.

## What each case guards

| Case | Pull request | It fails when guard |
| --- | --- | --- |
| `guard-auto-fix-candidate` | 41: a reviewer flags `for i, _ := range`, which `gofmt -s` rewrites | misses the candidate, picks a rung below auto-fix, skips the scratch run of `gofmt -s` in a throwaway worktree that finds the two files on the default branch it would rewrite, or rewrites them in the user's checkout |
| `guard-design-choice-is-none` | 42: a reviewer asks for a map, the author keeps the slice and says why | turns the design choice into a check or a CLAUDE.md line, or gives another reason |
| `guard-overridden-check-is-held` | 43: the author adds the new file to the allowlist of the test that fired | proposes a new check for a rule a check already holds, or misses that the author overrode it |

Every case also fails when guard writes to GitHub, creates a branch, commits to the checkout or pushes before the user approves a candidate, or reads the threads without GraphQL. The verdicts are graded by a judge model from the final reply, and everything else from the logs, the files and the transcript.

An eval run cannot publish the decision page (the Artifact tool is off) or build it (on macOS the sandbox cannot read the renderer under your home directory), so guard delivers the round in its reply, and the graders read the reply. Where the page builds, a reply that only links it fails `cost-names-the-violations`: grade the page's data file there too. `skill-fired` reports whether the skill ran, and stays out of the score when the run has a baseline arm.
