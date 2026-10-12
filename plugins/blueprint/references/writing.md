# Writing

The text on a figure or a scene, and the message that carries it to its readers.

## Language

- The audience picks the language: Spanish for the team's Slack and other internal readers, English for public, customer and third-party readers. When the audience is unclear, ask.
- Messages to the team's Slack drop the opening `¿` and `¡`. For any other Spanish text, ask.
- Set `lang="es"` on the canvas of a Spanish figure. Numbers follow the language: `5,150` in English, `5.150` in Spanish.

## Voice

- Direct, practical, concise. The facts and the numbers carry the figure. No marketing adjectives ("seamless", "robust", "powerful").
- Titles and descriptions in sentence case. Uppercase comes only from the label classes, so never type it by hand.
- A node title names the thing in a few words. Its description says what it does or holds, in one line, two at most.
- State the claim directly. "Not X, but Y" stays only when a reader would plausibly assume X.
- Plain words over jargon. A term stays only when the reader needs that concept.
- No em dashes, semicolons or curly quotes. The renderer rejects all three, except inside a `quote` or `code`, which keep their own conventions.

## The message that carries it

A figure or a video usually travels in a Slack message, a PR or an email. Write that message ready to paste.

- **Slack**: the main point first, in two or three sentences. Details go in the thread. Tag the people who need to act.
- **Technical readers**: lead with the numbers, as bullets when there are more than two.
- **Every message**: end with one explicit next step, or the decision the reader needs to make.
