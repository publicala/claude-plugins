import { describe, expect, spyOn, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import type { Annotation } from "./workflow-command";
import {
  linkTargets,
  main,
  validateFrontmatter,
  validateLinks,
  validatePlugins,
  validateSkillPaths,
} from "./validate-plugins";
import { tempRepo } from "./temp-repo";

const SKILL = "/repo/plugins/demo/skills/audit/SKILL.md";

describe("linkTargets", () => {
  test("reads inline, angle-bracket, image and reference destinations", () => {
    const text = [
      '[a](one.md "Title") [b](<two words.md>) ![c](four.png) [d][ref]',
      "",
      "[ref]: three.md",
    ].join("\n");

    expect(linkTargets(text)).toEqual([
      "one.md",
      "two words.md",
      "four.png",
      "three.md",
    ]);
  });

  test("skips links in code blocks and code spans", () => {
    const text = [
      "`[a](span.md)`",
      "",
      "```",
      "[b](fenced.md)",
      "```",
      "",
      "    [c](indented.md)",
    ].join("\n");

    expect(linkTargets(text)).toEqual([]);
  });
});

describe("validateLinks", () => {
  test("skips urls and anchors, and checks files without their anchor", () => {
    const text =
      "[a](https://example.com) [b](#top) [c](validate-plugins.ts#L1) [d](missing.md)";

    expect(validateLinks(join(import.meta.dir, "README.md"), text)).toEqual([
      {
        line: 1,
        message:
          "links to missing.md, which does not exist. Fix the path or remove the link.",
      },
    ]);
  });

  test("names the line of the link, past a copy of it in a code example", () => {
    const text = [
      "```md",
      "[a](gone.md)",
      "```",
      "",
      "See `[b](gone.md)` and [c](dir/gone.md), then [d](gone.md).",
      "",
      "[e][ref]",
      "",
      "[ref]: gone.md",
    ].join("\n");

    expect(
      validateLinks(join(import.meta.dir, "README.md"), text).map(
        ({ line, message }) => `${line} ${message.split(",")[0]}`,
      ),
    ).toEqual([
      "5 links to dir/gone.md",
      "5 links to gone.md",
      "9 links to gone.md",
    ]);
  });

  test("keeps a reference whose label is its destination", () => {
    expect(
      validateLinks(
        join(import.meta.dir, "README.md"),
        "See [missing.md].\n\n[missing.md]: missing.md\n",
      ),
    ).toEqual([
      {
        line: 3,
        message:
          "links to missing.md, which does not exist. Fix the path or remove the link.",
      },
    ]);
  });

  test("names the line of each occurrence of a repeated target", () => {
    const text = "[a](gone.md)\n\n[b](gone.md)\n";

    expect(
      validateLinks(join(import.meta.dir, "README.md"), text).map(
        ({ line }) => line,
      ),
    ).toEqual([1, 3]);
  });
});

describe("validateSkillPaths", () => {
  const ROOT = join(import.meta.dir, "..");
  const DIAGRAM = "plugins/blueprint/skills/diagram/SKILL.md";

  test("resolves the skill directory and the plugin root, in code spans and fenced blocks", () => {
    const text = [
      "Start from `${CLAUDE_SKILL_DIR}/examples/flow.diagram.html`.",
      "",
      "```bash",
      "bun ${CLAUDE_PLUGIN_ROOT}/renderer/render.ts figure.html",
      "bun install --cwd ${CLAUDE_PLUGIN_ROOT}",
      "```",
    ].join("\n");

    expect(validateSkillPaths(ROOT, DIAGRAM, text)).toEqual([]);
  });

  test("checks the part before a placeholder, and ignores the period that ends a sentence", () => {
    const text = [
      "Copy `${CLAUDE_SKILL_DIR}/examples/<name>.diagram.html` or `${CLAUDE_SKILL_DIR}/examples/*.png`.",
      "Run ${CLAUDE_PLUGIN_ROOT}/renderer/render.ts.",
    ].join("\n");

    expect(validateSkillPaths(ROOT, DIAGRAM, text)).toEqual([]);
  });

  test("names the variable, the resolved path and the fix", () => {
    const text = [
      "Intro.",
      "",
      "```bash",
      "bun ${CLAUDE_PLUGIN_ROOT}/renderer/gone.ts",
      "```",
      "",
      "See `${CLAUDE_SKILL_DIR}/examples/gone-<name>.html`.",
    ].join("\n");

    expect(validateSkillPaths(ROOT, DIAGRAM, text)).toEqual([
      {
        line: 4,
        message:
          "${CLAUDE_PLUGIN_ROOT}/renderer/gone.ts resolves to plugins/blueprint/renderer/gone.ts, which does not exist. Fix the path or restore the file.",
      },
    ]);
    expect(
      validateSkillPaths(
        ROOT,
        DIAGRAM,
        "Run `bun \"${CLAUDE_PLUGIN_ROOT}\"/renderer/gone.ts` or `bun '${CLAUDE_PLUGIN_ROOT}'/renderer/render.ts`.",
      ),
    ).toEqual([
      {
        line: 1,
        message:
          "${CLAUDE_PLUGIN_ROOT}/renderer/gone.ts resolves to plugins/blueprint/renderer/gone.ts, which does not exist. Fix the path or restore the file.",
      },
    ]);
    expect(
      validateSkillPaths(ROOT, DIAGRAM, "`${CLAUDE_SKILL_DIR}/gone/<name>.md`"),
    ).toEqual([
      {
        line: 1,
        message:
          "${CLAUDE_SKILL_DIR}/gone resolves to plugins/blueprint/skills/diagram/gone, which does not exist. Fix the path or restore the file.",
      },
    ]);
  });
});

describe("validateFrontmatter", () => {
  const complete = [
    "---",
    "name: audit",
    "description: Prunes.",
    "user-invocable: true",
    "disable-model-invocation: false",
    "---",
    "",
  ].join("\n");

  test("accepts complete frontmatter", () => {
    expect(validateFrontmatter(SKILL, complete)).toEqual([]);
  });

  test("accepts every key Claude Code reads, and a quoted one-line description", () => {
    const text = complete.replace(
      "description: Prunes.",
      [
        'description: "Prunes: one cut per line."',
        'argument-hint: "[path]"',
        "allowed-tools: Bash(git *)",
        "model: inherit",
        "effort: high",
        "context: fork",
        "agent: Explore",
        "paths: [src/**]",
        "license: MIT",
      ].join("\n"),
    );

    expect(validateFrontmatter(SKILL, text)).toEqual([]);
  });

  test("names missing keys and the line to add", () => {
    expect(
      validateFrontmatter(
        SKILL,
        complete.replace("user-invocable: true\n", ""),
      ),
    ).toEqual([
      {
        line: 1,
        message:
          'frontmatter lacks user-invocable. Add the line "user-invocable: true".',
      },
    ]);
  });

  test("names the line to add for every required key", () => {
    expect(
      validateFrontmatter(SKILL, "---\nlicense: MIT\n---\n").map(
        ({ message }) => message,
      ),
    ).toEqual([
      'frontmatter lacks name. Add the line "name: audit".',
      'frontmatter lacks description. Add the line "description: <what the skill does and when to use it>".',
      'frontmatter lacks user-invocable. Add the line "user-invocable: true".',
      'frontmatter lacks disable-model-invocation. Add the line "disable-model-invocation: false".',
    ]);
  });

  test("requires the name to match the directory", () => {
    expect(
      validateFrontmatter(
        SKILL,
        complete.replace("name: audit", "name: prune"),
      ),
    ).toEqual([
      {
        line: 2,
        message:
          'name "prune" differs from the directory "audit". Write "name: audit" or rename the directory.',
      },
    ]);
  });

  test.each<[string, string]>([
    [">", "folded"],
    ["|", "literal"],
  ])(
    "flags a description written as the %p block scalar",
    (indicator, kind) => {
      expect(
        validateFrontmatter(
          SKILL,
          complete.replace(
            "description: Prunes.",
            `description: ${indicator}\n  Prunes.`,
          ),
        ),
      ).toEqual([
        {
          line: 3,
          message: `description is a ${kind} block scalar (${indicator}). Write it on one line after "description:", in double quotes when it holds ": ".`,
        },
      ]);
    },
  );

  test("flags a plain description that continues on the next line", () => {
    expect(
      validateFrontmatter(
        SKILL,
        complete.replace(
          "description: Prunes.",
          "description: Prunes\n  more.",
        ),
      ),
    ).toEqual([
      {
        line: 3,
        message:
          'description continues on line 4. Write it on one line after "description:".',
      },
    ]);
  });

  test.each(["description:", 'description: ""', "description: [a, b]"])(
    "flags %p, which is no text",
    (line) => {
      const [finding] = validateFrontmatter(
        SKILL,
        complete.replace("description: Prunes.", line),
      );

      expect(finding?.line).toBe(3);
      expect(finding?.message).toEndWith(
        'Write what the skill does and when to use it, on one line after "description:".',
      );
    },
  );

  test("requires booleans to be YAML booleans", () => {
    expect(
      validateFrontmatter(
        SKILL,
        complete
          .replace("user-invocable: true", 'user-invocable: "true"')
          .replace(
            "disable-model-invocation: false",
            "disable-model-invocation: no",
          ),
      ),
    ).toEqual([
      {
        line: 4,
        message:
          'user-invocable is "true". Write "user-invocable: true" or "user-invocable: false".',
      },
      {
        line: 5,
        message:
          'disable-model-invocation is "no". Write "disable-model-invocation: true" or "disable-model-invocation: false".',
      },
    ]);
  });

  test("requires argument-hint to be a string", () => {
    expect(
      validateFrontmatter(
        SKILL,
        complete.replace("false\n", "false\nargument-hint: [path]\n"),
      ),
    ).toEqual([
      {
        line: 6,
        message:
          'argument-hint is ["path"]. Write it as a quoted string, like argument-hint: "[issue-number]".',
      },
    ]);
  });

  test("names an unknown key and the keys Claude Code reads", () => {
    const [finding] = validateFrontmatter(
      SKILL,
      complete.replace("false\n", "false\nversion: 2\n"),
    );

    expect(finding?.line).toBe(6);
    expect(finding?.message).toStartWith(
      'frontmatter has the unknown key "version". Remove it, or use a key Claude Code reads: name, description,',
    );
  });

  test("reads frontmatter with CRLF line endings", () => {
    expect(
      validateFrontmatter(SKILL, complete.replaceAll("\n", "\r\n")),
    ).toEqual([]);
  });

  test("reports frontmatter that is not valid YAML", () => {
    const [error] = validateFrontmatter(
      SKILL,
      complete.replace("description: Prunes.", "description: [Prunes."),
    );

    expect(error?.message).toStartWith("frontmatter is not valid YAML (");
    expect(error?.message).toEndWith("Fix the syntax between the --- lines.");
  });

  test("reports frontmatter that is not a mapping", () => {
    expect(validateFrontmatter(SKILL, "---\n- name\n---\n")).toEqual([
      {
        line: 2,
        message:
          "frontmatter is not a YAML mapping. Write one key: value pair per line.",
      },
    ]);
  });

  test("requires frontmatter", () => {
    expect(validateFrontmatter(SKILL, "# Audit\n")).toEqual([
      {
        line: 1,
        message:
          "has no frontmatter. Open the file with a --- block that sets name, description, user-invocable and disable-model-invocation.",
      },
    ]);
  });
});

// A repository that passes every check, for a test to plant one problem in.
// A file set to null is left out.
const COMPLIANT_SKILL = [
  "---",
  "name: audit",
  "description: Prunes.",
  "user-invocable: true",
  "disable-model-invocation: false",
  "---",
  "",
  "Read [the README](../../README.md).",
  "",
].join("\n");

const COMPLIANT_MARKETPLACE = JSON.stringify(
  {
    name: "acme-books",
    plugins: [
      {
        name: "demo",
        description: "Prunes.",
        source: "./plugins/demo",
        homepage:
          "https://github.com/publicala/claude-plugins/tree/main/plugins/demo",
      },
    ],
  },
  null,
  2,
);

const COMPLIANT: Record<string, string> = {
  "README.md": "See [the demo plugin](plugins/demo).\n",
  "plugins/demo/skills/audit/SKILL.md": COMPLIANT_SKILL,
  "plugins/demo/README.md": "# Demo\n",
  "plugins/demo/.claude-plugin/plugin.json": JSON.stringify(
    { name: "demo", description: "Prunes." },
    null,
    2,
  ),
  ".claude-plugin/marketplace.json": COMPLIANT_MARKETPLACE,
};

async function problemsIn(
  files: Record<string, string | null>,
): Promise<Annotation[]> {
  const root = await tempRepo(
    Object.fromEntries(
      Object.entries({ ...COMPLIANT, ...files }).filter(
        (entry): entry is [string, string] => entry[1] !== null,
      ),
    ),
  );

  try {
    return (await validatePlugins(root)).problems;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

// The parser's own words change with Bun, so a test checks only that some are there.
function withParserTextHidden(problems: Annotation[]): Annotation[] {
  return problems.map((problem) => ({
    ...problem,
    message: problem.message.replace(
      /^is not valid JSON \(.+\)\./,
      "is not valid JSON (<parser text>).",
    ),
  }));
}

describe("validatePlugins", () => {
  test("passes on this repository", async () => {
    const result = await validatePlugins(join(import.meta.dir, ".."));

    expect(result.problems).toEqual([]);
    expect(result.checked.markdown).toBeGreaterThan(0);
    expect(result.checked.plugins).toBeGreaterThan(0);
  });

  test("passes on the compliant fixture", async () => {
    expect(await problemsIn({})).toEqual([]);
  });

  test("checks the links in every Markdown file git would commit, never ignored ones", async () => {
    expect(
      await problemsIn({
        ".gitignore": "node_modules\n",
        "README.md": "See [the guide](docs/gone.md).\n",
        "docs/intro.md": "# Intro\n\nRead [the setup](setup.md).\n",
        "plugins/demo/node_modules/dep/README.md": "[a](gone.md)\n",
      }),
    ).toEqual([
      {
        file: "README.md",
        line: 1,
        message:
          "links to docs/gone.md, which does not exist. Fix the path or remove the link.",
      },
      {
        file: "docs/intro.md",
        line: 3,
        message:
          "links to setup.md, which does not exist. Fix the path or remove the link.",
      },
    ]);
  });

  test("resolves the bundled paths a SKILL.md names", async () => {
    expect(
      await problemsIn({
        "plugins/demo/skills/audit/SKILL.md": `${COMPLIANT_SKILL}\n\`\`\`bash\nbun \${CLAUDE_PLUGIN_ROOT}/scripts/prune.ts\n\`\`\`\n`,
      }),
    ).toEqual([
      {
        file: "plugins/demo/skills/audit/SKILL.md",
        line: 11,
        message:
          "${CLAUDE_PLUGIN_ROOT}/scripts/prune.ts resolves to plugins/demo/scripts/prune.ts, which does not exist. Fix the path or restore the file.",
      },
    ]);
  });

  test("flags a SKILL.md description written as a block scalar", async () => {
    expect(
      await problemsIn({
        "plugins/demo/skills/audit/SKILL.md": COMPLIANT_SKILL.replace(
          "description: Prunes.",
          "description: >\n  Prunes.",
        ),
      }),
    ).toEqual([
      {
        file: "plugins/demo/skills/audit/SKILL.md",
        line: 3,
        message:
          'description is a folded block scalar (>). Write it on one line after "description:", in double quotes when it holds ": ".',
      },
    ]);
  });

  test("flags a plugin.json that carries a version", async () => {
    expect(
      await problemsIn({
        "plugins/demo/.claude-plugin/plugin.json": JSON.stringify(
          { name: "demo", version: "1.2.0", description: "Prunes." },
          null,
          2,
        ),
      }),
    ).toEqual([
      {
        file: "plugins/demo/.claude-plugin/plugin.json",
        line: 3,
        message:
          'carries "version", and CLAUDE.md says: "plugin.json carries no version, so every merge reaches users." Remove the "version" key.',
      },
    ]);
  });

  test("flags a plugin without a plugin.json, or with one that does not parse", async () => {
    expect(
      withParserTextHidden(
        await problemsIn({
          "plugins/demo/.claude-plugin/plugin.json": "{ name: demo }",
          "plugins/extra/README.md": "# Extra\n",
        }),
      ),
    ).toEqual([
      {
        file: "plugins/demo/.claude-plugin/plugin.json",
        line: 1,
        message: "is not valid JSON (<parser text>). Fix the syntax.",
      },
      {
        file: "plugins/extra/.claude-plugin/plugin.json",
        message:
          'is missing, so Claude Code cannot install plugins/extra. Add it with "name": "extra" and a "description".',
      },
      {
        file: ".claude-plugin/marketplace.json",
        line: 3,
        message:
          'does not list plugins/extra, so it cannot be installed. Add an entry with its name, description, "source": "./plugins/extra" and "homepage": "https://github.com/publicala/claude-plugins/tree/main/plugins/extra".',
      },
    ]);
  });

  test("flags a marketplace entry whose description drifted from plugin.json", async () => {
    expect(
      await problemsIn({
        ".claude-plugin/marketplace.json": COMPLIANT_MARKETPLACE.replace(
          '"Prunes."',
          '"Prunes old rules."',
        ),
      }),
    ).toEqual([
      {
        file: ".claude-plugin/marketplace.json",
        line: 6,
        message:
          '"description" of plugins/demo is "Prunes old rules.", and plugins/demo/.claude-plugin/plugin.json says "Prunes.". Copy the plugin.json value here.',
      },
    ]);
  });

  test("flags a plugin.json that is not an object", async () => {
    expect(
      await problemsIn({ "plugins/demo/.claude-plugin/plugin.json": "[]" }),
    ).toEqual([
      {
        file: "plugins/demo/.claude-plugin/plugin.json",
        line: 1,
        message: "is not a JSON object. Write its keys inside { }.",
      },
    ]);
  });

  test("names the file whose frontmatter is not valid YAML", async () => {
    const problems = await problemsIn({
      "plugins/demo/skills/audit/SKILL.md": "---\nname: [audit\n---\n",
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]?.file).toBe("plugins/demo/skills/audit/SKILL.md");
    expect(problems[0]?.message).toStartWith("frontmatter is not valid YAML (");
  });
});

describe("main", () => {
  test("prints the count and exits 0 on this repository", async () => {
    const log = spyOn(console, "log").mockImplementation(() => undefined);

    try {
      expect(await main()).toBe(0);
      expect(log.mock.calls[0]?.[0]).toMatch(
        /^checked \d+ Markdown files and \d+ plugins$/,
      );
    } finally {
      log.mockRestore();
    }
  });

  test("prints each problem as a GitHub annotation and exits 1", async () => {
    const root = await tempRepo({ "README.md": "One.\n\n[a](gone.md)\n" });
    const error = spyOn(console, "error").mockImplementation(() => undefined);

    try {
      expect(await main(root)).toBe(1);
      expect(error.mock.calls).toEqual([
        [
          "::error file=README.md,line=3::links to gone.md, which does not exist. Fix the path or remove the link.",
        ],
      ]);
    } finally {
      error.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });
});
