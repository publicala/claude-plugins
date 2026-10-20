# Load model

What a session pays for a CLAUDE.md line depends only on how the file reaches the context. Classify every in-scope file before judging or placing its lines.

## Four classes

- **Always resident**: the root CLAUDE.md, user-level and ancestor-directory files, and anything they pull in with `@path` imports. Full price in every session. An `@path` import costs the same as inline text, so moving content behind one saves nothing.
- **Nested CLAUDE.md** (`<subdir>/CLAUDE.md`): loads when the session reads a file under that directory, then stays for the session. Scopes by subtree.
- **Path-scoped rule** (`.claude/rules/<topic>.md` with `paths` globs in the frontmatter): loads when the session reads a file matching a glob. The only class that scopes by file pattern across directories.
- **Deferred**: a plain markdown pointer loads nothing until an agent chooses to read the target. The only class where content is close to free.

Nested files and path-scoped rules are the two scope-triggered classes. Judge their lines against a fresh session working in their scope, since only those sessions load them.

## The trigger is a read

A scoped file loads when the session reads a file in its scope, and only then. Two kinds of read fire it:

- **A file-tool read** of any in-scope file.
- **A plain shell read**: a command whose every part reads a named in-scope file (`cat`, `head`, `tail`, `sed -n`, `grep` on a file), joined by `;` or `&&` with nothing but `echo`. The harness misses the read when the file comes through a pipe (`cat f | head`), a variable (`cat "$f"`), a directory listing or recursive search (`ls`, `grep -r`), or a compound command that mixes one of those in.

A session that creates a new in-scope file before it reads a neighbor never loads the scoped file. Neither does a session whose only reads take a shape the harness misses. Every demotion verdict hangs on these facts.

An edit doesn't guarantee a load. The harness refuses an edit without a prior read, but a shell read it missed still counts as that read, so a session can edit an in-scope file while the scoped file never loaded.

Some harness modes tell the session to read files through shell commands. Those sessions load scoped files only when their commands take the plain shape, so a demotion stands for them only on a probe run in that mode.

Compaction adds an asymmetry: the root file is re-injected after a compaction automatically, while scoped files return only on the next in-scope read.

## Safety prohibition

Both audit's "Never cut" and split's "Never demote" protect safety prohibitions, defined narrowly: rules guarding actions whose harm lands outside the working tree the moment the action runs (data loss, mutating a shared or production system, publishing, deleting history). Review cannot catch these, and the action is rarely gated behind reading one subtree, so a scoped copy can be absent at the moment it matters.

A convention phrased with "never" is not a safety prohibition. "Never import Carbon\Carbon" bans a pattern a reviewer catches in the diff. Audit still keeps such a line, as a convention that differs from the default, but split places it through the normal pass.
