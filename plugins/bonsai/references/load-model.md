# Load model

What a session pays for a CLAUDE.md line depends only on how the file reaches the context. Classify every in-scope file before judging or placing its lines.

The harness canaries check when nested files, path rules and skills load, in a session and in a subagent, and which AGENTS.md files Codex reads, against the Claude Code and Codex installed on your machine: run `bun evals/harness/run.ts` from the plugin root after an update ([../evals/README.md](../evals/README.md)). Every other fact here rests on manual probes.

## Four classes

- **Always resident**: the root CLAUDE.md, user-level and ancestor-directory files, and anything they pull in with `@path` imports. Full price in every session. An `@path` import costs the same as inline text, so moving content behind one saves nothing.
- **Nested CLAUDE.md** (`<subdir>/CLAUDE.md`): loads when the session reads, writes or edits a file under that directory, then stays for the session. Scopes by subtree.
- **Path-scoped rule** (`.claude/rules/<topic>.md` with `paths` globs in the frontmatter): loads when the session reads, writes or edits a file matching a glob. The only class that scopes by file pattern across directories. Globs match like gitignore patterns: a glob with no slash (`package.json`), a leading `**/` (`**/lib/**`), or only the slash of a trailing `/**` (`dir/**`) matches at any depth. Any other slash (`src/lib/**`) anchors it to the root, and so does a leading `/`.
- **Deferred**: a plain markdown pointer loads nothing until an agent chooses to read the target. The only class where content is close to free.

Nested files and path-scoped rules are the two scope-triggered classes. Judge their lines against a fresh session working in their scope, since only those sessions load them.

When `~/.claude/bonsai/loads/<key>.jsonl` exists for the repository, count loads from it in place of estimating them: one JSON line per load with the file, its `load_reason` and the blob hash it had (format in the plugin README, "Load log"). Count only lines whose `blob` matches the file as it stands, since older lines describe an earlier file.

## What triggers a load

A scoped file loads when the session touches a file in its scope, and the harness attaches it right after that tool call's result. Two kinds of touch fire it:

- **A Read, Write or Edit tool call** on any in-scope file. A Write that creates the first file in a directory counts, at any depth below the scoped directory. That first write lands without the scoped file, and the session sees the file before its next step, so it can still correct what it wrote. An Edit whose only prior read was a shell read that loaded nothing also lands without the scoped file, and the load after it varies between runs: the scoped file usually arrives right after that Edit, and sometimes only at the next file-tool call. Claude Code can also refuse that Edit.
- **A plain shell read**: a command whose every part reads a named in-scope file (`cat`, `head`, `tail`, `sed -n`, `grep` on a file), joined by `;` or `&&` with nothing but `echo`. The harness misses the read when the file comes through a pipe (`cat f | head`), a variable (`cat "$f"`), a directory listing or recursive search (`ls`, `grep -r`), or a compound command that mixes one of those in. A `cd <dir> &&` or `cd <dir>;` prefix the session writes is such a part: `sed -n 1,3p src/trust.ts` loads the scoped file, and the same read after a `cd` does not.

Any other shell command loads nothing: running a script, a migration or a generator, `git`, or editing through `sed -i`. Work that starts with a command, or acts outside the files (a deploy, a query against a shared database), gets no scoped file until its first in-scope file-tool call or plain shell read, if one ever comes. Every demotion verdict hangs on these facts.

Some harness modes tell the session to read and edit files through shell commands. Those sessions load scoped files only on plain shell reads, so a demotion stands for them only on a probe run in that mode.

Compaction adds an asymmetry: the root file is re-injected after a compaction automatically, while scoped files return only on the next in-scope touch.

## Skills

A skill's description sits in the context from the session's start unless the list below delays it, and its body loads when the skill runs. `disable-model-invocation: true` in the frontmatter takes the description out as well.

- **Nested skill** (`<dir>/.claude/skills/<name>/SKILL.md`): hidden until the first Read, Write or Edit of a file under `<dir>`, in the main session and in subagents. Then only its description arrives. Scopes a procedure by subtree, like a nested CLAUDE.md.
- **`paths:` globs** in a skill's frontmatter keep it out of the listing until the session first touches a matching file. Then only its description arrives. Scopes a procedure that spans directories.
- **Gitignored or uncommitted**: the harness never scans a gitignored directory for skills, and a skill linked from outside the repository (an untracked or machine-local symlink) reaches only the machines that create the link. Neither reaches a clone or a cloud session. A committed symlink whose target is committed in the repository works like a committed skill.

## Other agents

Codex reads `AGENTS.md` files once, at start, from the repository root down to the directory it starts in. A file it reads or writes later loads nothing, so a nested `AGENTS.md` reaches a Codex session started at the root only when it reads that file on purpose. A rule moved into a Claude-only mechanism (a nested CLAUDE.md, a path-scoped rule, a skill, a hook) reaches Codex only through a one-line pointer in a root file Codex reads. When the root `AGENTS.md` is a symlink to `CLAUDE.md`, the pointer in `CLAUDE.md` serves both. Otherwise it goes in the root `AGENTS.md`, and a repository with no root `AGENTS.md` makes the pointer a call, since creating one changes what Codex reads.

Whether a repository serves such an agent is the `agents` setting in `decision-memory.md`, in this directory: read it there, and leave the pointer only when it names one.

## Safety prohibition

Both audit's "Never cut" and split's "Never demote" protect safety prohibitions, defined narrowly: rules guarding actions whose harm lands outside the working tree the moment the action runs (data loss, mutating a shared or production system, publishing, deleting history). Review cannot catch these, and the action is rarely gated behind reading one subtree, so a scoped copy can be absent at the moment it matters.

A convention phrased with "never" is not a safety prohibition. "Never import Carbon\Carbon" bans a pattern a reviewer catches in the diff. Audit keeps such a line as a convention that differs from the default until a check holds it, and split places it through the normal pass.
