# Load model

What a session pays for a CLAUDE.md line depends on how the file reaches the context, not on what the file is called. Classify every in-scope file before judging or placing its lines.

## Four classes

- **Always resident**: the root CLAUDE.md, user-level and ancestor-directory files, and anything they pull in with `@path` imports. Full price in every session. An `@path` import costs the same as inline text, so moving content behind one saves nothing.
- **Nested CLAUDE.md** (`<subdir>/CLAUDE.md`): loads when the session reads a file under that directory, then stays for the session. Scopes by subtree.
- **Path-scoped rule** (`.claude/rules/<topic>.md` with `paths` globs in the frontmatter): loads when the session reads a file matching a glob. The only class that scopes by file pattern across directories.
- **Deferred**: a plain markdown pointer loads nothing until an agent chooses to read the target. The only class where content is close to free.

Nested files and path-scoped rules are the two scope-triggered classes. Judge their lines against a fresh session working in their scope, not against every session.

## The trigger is a read

A scoped file loads on a read, and only on a read. A session that creates a new in-scope file without reading a neighbor first, or that touches in-scope paths only through shell commands, never loads it. Edits are covered, because the harness refuses an edit without a prior read. Every demotion verdict hangs on this fact.

Compaction adds an asymmetry: the root file is re-injected after a compaction automatically, while scoped files return only on the next in-scope read.

## Safety prohibition

Both audit's "Never cut" and split's "Never demote" protect safety prohibitions, defined narrowly: rules guarding actions whose harm lands outside the working tree the moment the action runs (data loss, mutating a shared or production system, publishing, deleting history). Review cannot catch these, and the action is rarely gated behind reading one subtree, so a scoped copy can be absent at the moment it matters.

A convention phrased with "never" is not a safety prohibition. "Never import Carbon\Carbon" bans a pattern a reviewer catches in the diff. Audit still keeps such a line, as a convention that differs from the default, but split places it through the normal pass.
