# Writing a rule

The standard for any rule text bonsai writes or records: a feed proposal, an intake candidate's `Rule` or `Check`, an audit rewrite, the message of a check bake adds.

- Lead with the rule, imperative voice, present tense
- A check's message leads with what is wrong at the flagged site, since the session reads it there, then says what to write instead, so a session that never saw the rule fixes it from the message alone
- One or two sentences, or a tight bullet list: a CLAUDE.md line. When the text runs past about forty words, the rationale is in the rule and belongs in a `Why:` line, an HTML comment, or nowhere
- Add a `Why:` line only when the reason is non-obvious and a session needs it to judge edge cases. A why only a reviewer needs goes in an HTML comment in a CLAUDE.md, which the harness strips before injection and a plain file read still shows. Skills and rule files carry no promise to strip one, so there the why goes in the commit or the PR (`delivery.md`, R0)
- Match the voice of the file the rule lands in
- Verify every symbol an example references against the real codebase: an example calling a method that does not exist teaches a wrong API and is worse than no example
- Precise but generic: keep load-bearing identifiers exact. Never enumerate driftable inventories (class lists, file lists, counts)
- Write for the class of mistake. The correction that prompted a rule is evidence for it, and its wording stays out of the rule
- Name a repository path in backticks, written from the repository root, never as a Markdown link: agents read the path, and nobody clicks it. An `@path` import stays bare and keeps its own base (it resolves from the importing file), since backticks stop it importing
- Point only at a file the harness does not already load in the rule's situation (`load-model.md`, in this directory), and never tell a session to run a discovery command it knows (`list`, `--help`) unless the rule needs it at a specific step
- No document metadata or biography (version stamps, rename history, "previously X, now Z"). State the rule present tense. Git is the history, and the audit cuts these on sight
