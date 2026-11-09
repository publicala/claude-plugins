# bonsai evals

`claude plugin eval` runs the cases here against the plugin and scores each run. Each skill keeps its eval plan in `<skill>/PLAN.md`. The guard skill also has a suite that runs: three cases under `guard/`, one per promise below.

## Run the guard suite

The suite runs on a developer's Claude Code login, never in CI. Run it before a change to `skills/guard/` merges, from `plugins/bonsai`:

```bash
claude plugin eval . --case 'guard-*' --scaffold --allow-tools Bash Write Edit --judge-model sonnet -j 3
```

- **`--scaffold`**: builds each case's workspace with `guard/fixture/setup.sh`, which runs as you outside the sandbox. It writes only to the run's temporary workspace and home.
- **`--allow-tools Bash Write Edit`**: guard reads pull requests with `gh` and the repository with `git`, and writes its scratch files. Bash runs inside the eval's OS sandbox: writes stay in the workspace and the network is closed.
- **`--judge-model sonnet`**: the judge answers PASS or FAIL in one word, and the default small judge flips on replies this long.
- **`-j 3`**: three sessions at a time, on one rate limit.
- **`--trust-plugin`**: add it when the shell cannot answer the trust prompt, as in a run Claude starts for you.

Each case runs three times with the plugin and three times without it, so a full run is 18 sessions on your login: about 5 minutes and $5 at list price with `-j 3`. The command exits 1 when a case scores below the default threshold of 1.0, and a change to the skill merges when every case scores 1.00. One case once, while you change a grader: `--case guard-design-choice-is-none --runs 1 --ablation none`. Results land in `results/`, which git ignores. Add `--keep-temp` to keep each run's workspace and transcript.

## Run the harness canaries

`references/load-model.md` states when Claude Code loads a nested CLAUDE.md, a path-scoped rule or a skill, and the skills judge every demotion by it. `harness/` checks each of those facts against the Claude Code installed here. One canary per fact builds a fresh git repository with unique markers, has a `claude -p` session on Haiku make exact tool calls in it, and reads the session's transcript for where each marker first reached the context. The `nested_memory`, `skill_listing` and `dynamic_skill` attachments there are the evidence, so no canary asks the model what it saw.

Run it from `plugins/bonsai` after a Claude Code update, on your own login, never in CI:

```bash
bun evals/harness/run.ts
```

- **`--only <id>,<id>`**: runs some canaries, named as the table names them.
- **`--jobs <n>`**: sessions at a time, a positive whole number, 4 by default.
- **`--keep`**: keeps each fixture and transcript, and prints their paths.

A full run is 14 canaries in about 30 seconds: $0.02 of Claude at list price, plus about 90,000 Codex tokens for the Codex canary, which skips when `codex` is not on PATH. The sessions skip your user settings, plugins and MCP servers (`--setting-sources project --strict-mcp-config`), and each may use only the tools its steps name. Their transcripts land under `~/.claude/projects/` and `~/.codex/sessions/`, and the run deletes them.

Each row ends in one result, and the exit status follows the worst:

- **PASS**: the fact holds.
- **FAIL**: Claude Code changed. The row says where the marker arrived and names the load-model.md statement to update. Exit 1.
- **INVALID**: twice, the session strayed from its steps, or a step returned an error the canary does not allow, so nothing was judged. Exit 2, like **ERROR**, which means `claude` or `codex` failed or exited non-zero.

`harness/*.test.ts` cover the transcript reading and every verdict without calling `claude`, so `bun run check` runs them. A new fact in load-model.md gets its canary in `harness/canaries.ts`.

## The fixture

The sandbox has no network, so `guard/fixture/` stands in for GitHub:

- **The repository**: `setup.sh` builds a small Go service for Acme Books at the workspace root, with the history of three pull requests (41 and 42 merged, 43 open) and an `origin` that points at `github.com/acme-books/inventory` but fetches from a local bare repository.
- **A fake `gh`**: `fixture/gh`, first on the sandbox's PATH, answers the reads guard makes (review threads over GraphQL, `gh pr view`, `gh pr diff`, `gh pr list`, the REST endpoints) from `prs/<number>/pr.json`. It serves only this repository's pull requests, by number or URL, refuses every write, and logs each call to `.git/eval-gh-calls.log` as `READ`, `WRITE` or `UNSUPPORTED`, with the query of a GraphQL call sent as a file or a request body, and the pull request it resolved to as `[pr=<number>]`. The graders read that log, so a write made from a subagent or a script still counts.
- **A git wrapper**: `fixture/git`, also first on PATH, runs the real git and logs each call to `.git/eval-git-calls.log`, with `WRITE` for a push, a commit in the workspace's own checkout, or any call after which a new local branch exists (it compares `refs/heads` before and after, so a checkout that guesses a branch from `origin` counts). Each line ends with git's exit status. A scratch worktree with a detached HEAD is a read. It's also how git runs at all on macOS: `/usr/bin/git` there is a shim that needs `xcrun`, which the sandbox blocks, so `setup.sh` points the wrapper, and git's own subprocesses, at the real binary.
- **A gofmt wrapper**: `fixture/gofmt` runs the real gofmt and logs each run to the git log as `RAN gofmt <args> where=<place> exit=<status>`. The place is `worktree` when every file it reads sits in a linked worktree of the repository, and `checkout` when one sits in the user's checkout, so a scratch run tells apart from a rewrite. The fixture needs Go installed: `setup.sh` fails without `gofmt`.

`fixture/fixture.test.ts` covers the three tools and their logs.

An `UNSUPPORTED` line in the log means guard asked for something the fake does not serve yet, and fails the `fixture-served-every-call` grader: add it to `fixture/gh` and run the case again.

## What each case guards

| Case | Pull request | It fails when guard |
| --- | --- | --- |
| `guard-auto-fix-candidate` | 41: a reviewer flags `for i, _ := range`, which `gofmt -s` rewrites | misses the candidate, picks a rung below auto-fix, skips the scratch run of `gofmt -s` in a throwaway worktree that finds the two files on the default branch it would rewrite, or rewrites them in the user's checkout |
| `guard-design-choice-is-none` | 42: a reviewer asks for a map, the author keeps the slice and says why | turns the design choice into a check or a CLAUDE.md line, or gives another reason |
| `guard-overridden-check-is-held` | 43: the author adds the new file to the allowlist of the test that fired | proposes a new check for a rule a check already holds, or misses that the author overrode it |

Every case also fails when guard writes to GitHub, creates a branch, commits to the checkout or pushes before the user approves a candidate, or reads the threads without GraphQL. The verdicts are graded by a judge model from the final reply, and everything else from the logs, the files and the transcript.

An eval run cannot publish the decision page (the Artifact tool is off) or build it (on macOS the sandbox cannot read the renderer under your home directory), so guard delivers the round in its reply, and the graders read the reply. Where the page builds, a reply that only links it fails `cost-names-the-violations`: grade the page's data file there too. `skill-fired` reports whether the skill ran, and stays out of the score when the run has a baseline arm.
