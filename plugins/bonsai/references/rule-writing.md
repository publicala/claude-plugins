# Writing a rule

The standard for any rule text bonsai writes or records: a feed proposal, an intake candidate's `Rule` or `Check`, an audit rewrite, the message of a check bake adds.

- Lead with the rule, imperative voice, present tense
- A check's message leads with what is wrong at the flagged site, since the session reads it there, then says what to write instead, so a session that never saw the rule fixes it from the message alone
- One or two sentences, or a tight bullet list: a CLAUDE.md line. When the text runs past about forty words, the rationale is in the rule and belongs in a `Why:` line or nowhere
- Add a `Why:` line only when the reason is non-obvious and a session needs it to judge edge cases
- Match the voice of the file the rule lands in
- Verify every symbol an example references against the real codebase: an example calling a method that does not exist teaches a wrong API and is worse than no example
- Precise but generic: keep load-bearing identifiers exact. Never enumerate driftable inventories (class lists, file lists, counts)
- Write for the class of mistake. The correction that prompted a rule is evidence for it, and its wording stays out of the rule
- No document metadata or biography (version stamps, rename history, "previously X, now Z"). State the rule present tense. Git is the history, and the audit cuts these on sight
