import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const GRADERS = join(import.meta.dir, "..", "auto-fix-candidate", "graders");

/** The regex a regex grader runs, built from its front matter. */
async function graderPattern(name: string): Promise<RegExp> {
  const text = await Bun.file(join(GRADERS, `${name}.md`)).text();
  const pattern = /^pattern: '(.*)'$/m.exec(text)?.[1];
  const flags = /^flags: (\w+)$/m.exec(text)?.[1] ?? "";

  if (pattern === undefined) {
    throw new Error(`${name}.md has no single-quoted pattern line`);
  }

  return new RegExp(pattern.replaceAll("''", "'"), flags);
}

// The cost lines of guard replies the suite recorded, word for word.
const FIXES_LABEL = `**The cost** (measured by running \`gofmt -s\` on a throwaway copy of \`origin/main\`):
- **Fixes:** 2 files change, both rewritten by the tool in the same PR:
  - the same loop in \`internal/stock/stock.go:14\`
  - the repeated \`Title{...}\` type in the list in \`internal/catalog/seed.go:13-14\`
- **Exceptions and false positives:** none.`;

const VIOLATIONS_ROW =
  "  | Violations on `main` | 2 files, both fixed by `make fmt` in this PR: the blank index in `internal/stock/stock.go`, and repeated `Title{` type names in the list in `internal/catalog/seed.go` |";

const FIXES_NEEDED = `- **Fixes needed on \`main\`:** 2 files, both rewritten by \`make fmt\` in the same PR:
  - \`internal/stock/stock.go\`: the same loop.
  - \`internal/catalog/seed.go\`: \`Title{...}\` repeated inside a \`[]Title{}\` literal. \`-s\` simplifies that form too.
- **Exceptions:** none.`;

describe("cost-names-the-violations", () => {
  test.each([
    ["the Fixes label", FIXES_LABEL],
    ["the Violations row of a cost table", VIOLATIONS_ROW],
    ["the Fixes needed label", FIXES_NEEDED],
  ])("passes a cost line under %s", async (_label, reply) => {
    expect((await graderPattern("cost-names-the-violations")).test(reply)).toBe(
      true,
    );
  });

  test.each([
    [
      "without the count",
      FIXES_LABEL.replace("2 files change", "files change"),
    ],
    [
      "with another count",
      FIXES_LABEL.replace("2 files change", "3 files change"),
    ],
    [
      "without stock.go",
      FIXES_LABEL.replace("internal/stock/stock.go:14", "the stock ledger"),
    ],
    [
      "without seed.go",
      FIXES_LABEL.replace("internal/catalog/seed.go:13-14", "the seed list"),
    ],
    ["without a cost label", FIXES_LABEL.replace("**Fixes:** ", "")],
  ])("fails a cost line %s", async (_label, reply) => {
    expect((await graderPattern("cost-names-the-violations")).test(reply)).toBe(
      false,
    );
  });
});
