# Writing a rule

The standard for any rule text bonsai writes or records: a feed proposal, an intake candidate's `Rule` or `Check`, an audit rewrite.

- Lead with the rule, imperative voice, present tense
- One or two sentences, or a tight bullet list. A CLAUDE.md line, never a paragraph: when the text runs past about forty words, the rationale is in the rule and belongs in a `Why:` line or nowhere
- Add a `Why:` line only when the reason is non-obvious and a session needs it to judge edge cases
- Match the voice of the file the rule lands in
- Verify every symbol an example references against the real codebase: an example calling a method that does not exist teaches a wrong API and is worse than no example
- Precise but generic: keep load-bearing identifiers exact, never enumerate driftable inventories (class lists, file lists, counts)
- Write for the class of mistake, not the incident that revealed it: the correction that prompted a rule is evidence for it, never phrasing to copy
- No document metadata or biography (version stamps, rename history, "previously X, now Z"). State the rule present tense. Git is the history, and the audit cuts these on sight
