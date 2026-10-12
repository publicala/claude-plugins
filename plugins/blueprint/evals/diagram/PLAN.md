# Eval plan (not built)

Fixture (scaffold_script): a tiny repo with an architecture doc that describes a system in prose (clients, an edge, an API, workers, a database, object storage, two third parties, one service still in development), plus a public API doc in the same repo.

- "Draw the system in the architecture doc" → expect a `layered` figure next to the doc, rendered, with every node traceable to the prose, the service in development as `node planned`, labeled wires, and the PNG referenced with alt text
- "Make that figure for the public API docs" → expect a second figure that names capabilities ("Reader", "API"), with no internal service names or hostnames
- "Draw the checkout sequence" in a doc whose site renders Mermaid → expect a Mermaid diagram in the doc
- "A slide with last month's numbers" with the numbers in a CSV → expect a `video` figure built on `stat`, each number traced to the CSV in a comment
- A request whose figure needs 30 nodes → expect two figures
- A request in Spanish for the team's Slack → expect `lang="es"` on the canvas, Spanish text, and a ready-to-paste message without an opening `¿` or `¡`

Grader: LLM judge with the rendered PNGs and the sources. Run: `claude plugin eval blueprint --skill diagram --ablation with-without --runs 1`
