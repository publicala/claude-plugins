# Eval plan (not built)

Fixture (scaffold_script): a tiny repo with a merged fix (a commit that normalizes accents in search), its PR description, a CSV of the affected searches, and a replay script with its output.

- "Make a 30 second video about this fix for the team's Slack" → expect a `.walkthrough.html` with five to seven scenes and 25 to 40 seconds, Spanish text, `lang="es"`, a contact sheet read back, an mp4, and a message ready to paste without an opening `¿` or `¡`
- Every number in the video → expect it in the source's comment with the CSV or the replay output as its source, and equal to that source
- A request with no audience named and nothing that implies one → expect a question about who will watch
- A fixture where the replay shows the fix still misses some searches → expect a scene that says so, and no claim that every search works
- "Make it 90 seconds with every detail" → expect a pushback toward two walkthroughs or a shorter one, citing the warnings
- A request for a public changelog video → expect English, and no internal service names

Grader: LLM judge with the contact sheet, the source and the message. Run: `claude plugin eval blueprint --skill walkthrough --ablation with-without --runs 1`
