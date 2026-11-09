# bonsai

Keeps CLAUDE.md files like a bonsai: small on purpose, shaped by continuous feeding and pruning.

Every line in a CLAUDE.md loads in every session, so a line that changes nothing still costs context. And a rule a linter or a test can enforce does its job better as a check, because the check runs before review and its failure message teaches the fix. bonsai keeps only the lines that need judgment, in the scope of the sessions they govern. Every skill places a rule on the same ladder, from a type that makes the mistake impossible, through a check and a scoped file, down to a doc read on demand (`references/delivery.md`). Six skills cover the lifecycle:

| Skill | Role |
| --- | --- |
| `/bonsai:intake` | Records verified evidence from PR review threads outside the repo, shared only with `--export` |
| `/bonsai:feed` | Adds rules from observed patterns (commits, in-session corrections, intake entries) |
| `/bonsai:bake` | Converts crystallized rules into automated checks and removes the prose |
| `/bonsai:guard` | Turns review findings into checks, each its own PR from the default branch |
| `/bonsai:audit` | Prunes and verifies what remains, every cut backed by evidence |
| `/bonsai:split` | Moves what remains to the load scope of the sessions it governs |

## When to run each one

- **intake**: after each review round. Run it once with `--search` to start from a reviewer's past PRs
- **feed**: after a working session
- **bake**: once enough rules have accumulated to be worth automating
- **guard**: after a review round whose findings a check could have caught before review, or once over every PR of a finished run
- **audit**: when CLAUDE.md files have grown without review. Claude Code's `/doctor prompt-audit` is a useful cross-check afterwards: it verifies the same files independently, and also lints skills and dated phrasing
- **split**: after an audit leaves a resident file carrying rules that govern one area

## Evidence

`/bonsai:intake` writes under `~/.claude/bonsai/intake/<owner>/<repo>/`, outside every repository. Review threads quote customers, internal names, and unreleased design, so the ledger never leaves the machine. Recurrence counted there is per person. With `--export`, the candidate sections alone (rule text, target, symbols, ratio) also land in the target repository under `.claude/bonsai/candidates/`, uncommitted, so once committed the whole team's reviews count toward the same threshold. `references/intake-entry.md` is the contract.

## Load log

Placement decisions rest on which instruction files real sessions load. An optional hook records that, so audit and split can read counts in place of estimates. It's off by default. Turn it on in `~/.claude/settings.json`:

```json
{ "env": { "BONSAI_LOAD_LOG": "1" } }
```

Remove the line, or set any other value, to turn it off. Off, the hook exits before starting anything.

Each load of a CLAUDE.md, an import or a `.claude/rules` file appends one JSON line to `~/.claude/bonsai/loads/<owner>/<repo>.jsonl`, keyed by the `upstream` remote, else `origin`, else the directory name. The hook makes no network call, so a fork clone without an `upstream` remote logs under the fork's name. A reader that resolves the canonical key should also read the log under the fork's key. A line holds the time, the session and subagent ids, the working directory and worktree root, the loaded file's path from the root (absolute outside it), its scope (`memory_type`), the load cause (`session_start`, `nested_traversal`, `path_glob_match`, `include`, `compact`), the `paths` globs, the file that triggered the load or the file that imported it, and the file's git blob hash at load time:

```json
{"time":"2026-11-09T12:00:00.000Z","session_id":"9f1c…","cwd":"/work/catalog","root":"/work/catalog","file":"api/CLAUDE.md","memory_type":"Project","load_reason":"nested_traversal","trigger_file":"api/routes.ts","blob":"5b2a…"}
```

It never records file contents, prompts or tool output. A headless session (`claude -p`) loads its session-start files before plugin hooks start, so its log holds only the lazy loads. The hook runs in the background, needs [Bun](https://bun.sh) and a POSIX `sh` (native Windows without Git Bash writes no log), and writes nothing when Bun is missing or anything fails. The log stays on your machine. Delete the directory to clear it.

## Install

```text
/plugin marketplace add publicala/claude-plugins
/plugin install bonsai@publicala
```

## Layout

- `skills/<verb>/SKILL.md`: one skill per lifecycle verb
- `references/`: guidance shared by the skills, loaded on demand: the delivery ladder and when a check runs, the load model, the clean-context probe and the second checks, when a check replaces prose, the rule-writing standard, rounds and the run file, decision memory, headless mode, the decision-page spec, the intake entry contract
- `hooks/`: the optional load log
- `renderer/`: builds the decision page from a data file, with its tests and an example run
- `evals/`: eval plans per skill in `<verb>/PLAN.md`, and the guard suite `claude plugin eval` runs ([evals/README.md](evals/README.md))

## License

MIT
