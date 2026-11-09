import { describe, expect, test } from "bun:test";

import {
  CANARIES,
  judgeClaude,
  judgeCodex,
  judgeSession,
  mainPrompt,
  sessionPrompt,
  type ClaudePlan,
  type CodexEvidence,
  type CodexPlan,
  type Result,
  type Session,
} from "./canaries";
import { FakeTranscript, followingSession, stepInput } from "./fake-transcript";
import { parseTranscript } from "./transcript";

const ROOT = "/tmp/bonsai-canary-test";
const CONTEXT = { root: ROOT, nonce: "N0NCE" };

function claudeCanaries(): [string, ClaudePlan][] {
  return CANARIES.flatMap((canary): [string, ClaudePlan][] =>
    canary.agent === "claude" ? [[canary.id, canary.plan(CONTEXT)]] : [],
  );
}

function codexPlan(): CodexPlan {
  const canary = CANARIES.find((candidate) => candidate.agent === "codex");

  if (canary?.agent !== "codex") {
    throw new Error("The suite has no Codex canary.");
  }

  return canary.plan(CONTEXT);
}

/** Judges a plan whose sessions load every marker where expected, or where `arrivals` moves it. */
function judgeFollowing(
  plan: ClaudePlan,
  arrivals: Record<string, number | "never"> = {},
) {
  const main = parseTranscript(
    followingSession(ROOT, plan.main, arrivals).jsonl(),
  );
  const subagent =
    plan.subagent === undefined
      ? null
      : parseTranscript(
          followingSession(ROOT, plan.subagent, arrivals).jsonl(),
        );

  return judgeClaude(plan, main, subagent);
}

function judgedExpectations(plan: ClaudePlan) {
  return (plan.subagent ?? plan.main).expectations;
}

describe("the canary set", () => {
  test("names each canary once", () => {
    const ids = CANARIES.map((canary) => canary.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  test.each(claudeCanaries())(
    "%s states at least one expectation",
    (_id, plan) => {
      expect(judgedExpectations(plan).length).toBeGreaterThan(0);
    },
  );

  test.each(claudeCanaries())(
    "%s plants every marker in a fixture file",
    (_id, plan) => {
      const fixture = Object.values(plan.files).join("\n");

      for (const expectation of judgedExpectations(plan)) {
        expect(fixture).toContain(expectation.marker);
      }
    },
  );

  test.each(claudeCanaries())(
    "%s never names a marker in its prompt",
    (_id, plan) => {
      const prompt = mainPrompt(plan, ROOT);

      for (const expectation of judgedExpectations(plan)) {
        expect(prompt).not.toContain(expectation.marker);
      }
    },
  );

  test.each(claudeCanaries())(
    "%s grants every tool its steps use",
    (_id, plan) => {
      const steps = [...plan.main.steps, ...(plan.subagent?.steps ?? [])];

      for (const step of steps) {
        expect(plan.tools).toContain(step.tool);
      }
    },
  );

  test("marks each run with its nonce", () => {
    const [, plan] = claudeCanaries()[0] ?? [];

    expect(plan?.main.expectations[0]?.marker).toContain("N0NCE");
  });
});

function refusedEdit(session: Session): FakeTranscript {
  return new FakeTranscript(ROOT)
    .prompt("go")
    .tool("Edit", stepInput(ROOT, session.steps[0] ?? { tool: "Agent" }), {
      content: "<tool_use_error>File has not been read yet.</tool_use_error>",
      isError: true,
    })
    .reply("DONE");
}

describe("judging a Claude canary", () => {
  test.each(claudeCanaries())(
    "%s passes when every marker arrives as expected",
    (_id, plan) => {
      expect(judgeFollowing(plan).result).toBe("PASS");
    },
  );

  test.each(claudeCanaries())(
    "%s fails when a marker is resident from the start",
    (_id, plan) => {
      const expectation = judgedExpectations(plan)[0];

      if (expectation === undefined) {
        throw new Error("The canary states no expectation.");
      }

      const outcome = judgeFollowing(plan, { [expectation.marker]: 0 });

      expect(outcome.result).toBe("FAIL");
      expect(outcome.detail).toContain(
        `${expectation.what}: at session start, expected`,
      );
    },
  );

  test("fails a paths-scoped skill whose body arrives with its description", () => {
    const plan = claudeCanaries().find(([id]) => id === "paths-skill")?.[1];
    const body = plan?.main.expectations.find(
      (expectation) => expectation.what === "skill body",
    )?.marker;

    if (plan === undefined || body === undefined) {
      throw new Error("The paths-skill canary or its body marker is missing.");
    }

    const outcome = judgeFollowing(plan, { [body]: 2 });

    expect(outcome.result).toBe("FAIL");
    expect(outcome.detail).toContain(
      "skill body: right after step 2 (Read src/app/main.ts), expected never.",
    );
  });

  test("fails a marker that should never arrive and does", () => {
    const plan = claudeCanaries().find(
      ([id]) => id === "gitignored-skill",
    )?.[1];

    if (plan === undefined) {
      throw new Error("The gitignored-skill canary is missing.");
    }

    const ignored = plan.main.expectations[0]?.marker ?? "";
    const outcome = judgeFollowing(plan, { [ignored]: 1 });

    expect(outcome).toEqual({
      result: "FAIL",
      detail:
        "gitignored skill: right after step 1 (Read vendor/acme/a.txt), expected never.",
    });
  });

  describe("a step that returns an error", () => {
    const edit = {
      tool: "Edit" as const,
      path: "pkg/a.txt",
      find: "a",
      replace: "b",
    };
    const expectations = [
      { what: "pkg/CLAUDE.md", marker: "ACME-NESTED", afterStep: 1 },
    ];

    test("is invalid, so the canary reruns instead of failing", () => {
      const session = { steps: [edit], expectations };

      expect(
        judgeSession(parseTranscript(refusedEdit(session).jsonl()), session),
      ).toEqual({
        result: "INVALID",
        detail:
          "Step 1 (Edit pkg/a.txt) returned an error: File has not been read yet.",
      });
    });

    test("is judged when the step may fail, and the failure names the error", () => {
      const session = {
        steps: [{ ...edit, mayFail: true as const }],
        expectations,
      };

      expect(
        judgeSession(parseTranscript(refusedEdit(session).jsonl()), session),
      ).toEqual({
        result: "FAIL",
        detail:
          "pkg/CLAUDE.md: never, expected right after step 1 (Edit pkg/a.txt). Step 1 returned an error: File has not been read yet.",
      });
    });
  });

  test("ignores a marker in an API request log before the real load", () => {
    const session = {
      steps: [{ tool: "Read" as const, path: "pkg/a.txt" }],
      expectations: [
        { what: "pkg/CLAUDE.md", marker: "ACME-NESTED", afterStep: 1 },
      ],
    };
    const transcript = new FakeTranscript(ROOT)
      .prompt("go")
      .raw({ type: "api-request-blob", content: "ACME-NESTED" })
      .raw({ type: "api-request", body: "ACME-NESTED" })
      .tool("Read", stepInput(ROOT, session.steps[0] ?? { tool: "Agent" }))
      .attach("nested_memory", { content: "ACME-NESTED" })
      .reply("DONE");

    expect(judgeSession(parseTranscript(transcript.jsonl()), session)).toEqual({
      result: "PASS",
      detail: "pkg/CLAUDE.md: right after step 1 (Read pkg/a.txt)",
    });
  });

  describe("an expectation that accepts several steps", () => {
    const session = {
      steps: [
        { tool: "Bash" as const, command: "cat pkg/a.txt | head -n 5" },
        { tool: "Edit" as const, path: "pkg/a.txt", find: "a", replace: "b" },
        { tool: "Read" as const, path: "pkg/a.txt" },
      ],
      expectations: [
        { what: "pkg/CLAUDE.md", marker: "ACME-NESTED", afterStep: [2, 3] },
      ],
    };

    test.each([2, 3])(
      "passes a marker that arrives right after step %i",
      (step) => {
        const transcript = followingSession(ROOT, session, {
          "ACME-NESTED": step,
        });

        expect(
          judgeSession(parseTranscript(transcript.jsonl()), session).result,
        ).toBe("PASS");
      },
    );

    test("fails a marker that arrives at another step, naming every accepted one", () => {
      const transcript = followingSession(ROOT, session, { "ACME-NESTED": 1 });

      expect(
        judgeSession(parseTranscript(transcript.jsonl()), session),
      ).toEqual({
        result: "FAIL",
        detail:
          "pkg/CLAUDE.md: right after step 1 (Bash `cat pkg/a.txt | head -n 5`), expected right after step 2 (Edit pkg/a.txt) or right after step 3 (Read pkg/a.txt).",
      });
    });
  });

  test("fails a marker that arrives only after the model's next turn", () => {
    const session = {
      steps: [{ tool: "Read" as const, path: "pkg/a.txt" }],
      expectations: [
        { what: "pkg/CLAUDE.md", marker: "ACME-NESTED", afterStep: 1 },
      ],
    };
    const transcript = new FakeTranscript(ROOT)
      .tool("Read", { file_path: `${ROOT}/pkg/a.txt` })
      .reply("Reading done.")
      .attach("nested_memory", { content: "ACME-NESTED" });

    expect(
      judgeSession(parseTranscript(transcript.jsonl()), session).detail,
    ).toBe(
      "pkg/CLAUDE.md: after step 1 (Read pkg/a.txt), past the model's next turn, expected right after step 1 (Read pkg/a.txt).",
    );
  });

  test("throws when an expectation names a step the canary lacks", () => {
    const session = {
      steps: [{ tool: "Read" as const, path: "pkg/a.txt" }],
      expectations: [
        { what: "pkg/CLAUDE.md", marker: "ACME-NESTED", afterStep: 3 },
      ],
    };
    const transcript = parseTranscript(
      followingSession(ROOT, { ...session, expectations: [] }).jsonl(),
    );

    expect(() => judgeSession(transcript, session)).toThrow(
      "names step 3, and the canary has 1 steps",
    );
  });
});

describe("a session that strays from its steps", () => {
  const session = {
    steps: [
      { tool: "Read" as const, path: "pkg/a.txt" },
      { tool: "Read" as const, path: "pkg/b.txt" },
    ],
    expectations: [],
  };

  test("is invalid when a step never ran", () => {
    const transcript = new FakeTranscript(ROOT).tool("Read", {
      file_path: `${ROOT}/pkg/a.txt`,
    });

    expect(judgeSession(parseTranscript(transcript.jsonl()), session)).toEqual({
      result: "INVALID",
      detail:
        "The session made 1 tool calls, so step 2 (Read pkg/b.txt) never ran.",
    });
  });

  test("is invalid when a step called another tool", () => {
    const transcript = new FakeTranscript(ROOT)
      .tool("Read", { file_path: `${ROOT}/pkg/a.txt` })
      .tool("Bash", { command: "ls pkg" });

    expect(judgeSession(parseTranscript(transcript.jsonl()), session)).toEqual({
      result: "INVALID",
      detail: "Step 2 expected Read pkg/b.txt, the session called Bash ls pkg.",
    });
  });

  test("is invalid when a step has no result", () => {
    const transcript = new FakeTranscript(ROOT)
      .tool("Read", { file_path: `${ROOT}/pkg/a.txt` })
      .unansweredTool("Read", { file_path: `${ROOT}/pkg/b.txt` });

    expect(
      judgeSession(parseTranscript(transcript.jsonl()), session).detail,
    ).toBe("Step 2 (Read pkg/b.txt) has no result.");
  });

  test("is invalid when it makes an extra call", () => {
    const transcript = followingSession(ROOT, session).tool("Read", {
      file_path: `${ROOT}/CLAUDE.md`,
    });

    expect(
      judgeSession(parseTranscript(transcript.jsonl()), session).detail,
    ).toBe(
      `The session made an extra tool call after the last step: Read ${ROOT}/CLAUDE.md.`,
    );
  });
});

describe("judging the subagent canary", () => {
  const plan = claudeCanaries().find(([id]) => id === "subagent")?.[1];

  if (plan?.subagent === undefined) {
    throw new Error("The subagent canary is missing.");
  }

  const main = parseTranscript(followingSession(ROOT, plan.main).jsonl());

  test("is invalid without a subagent transcript", () => {
    expect(judgeClaude(plan, main, null)).toEqual({
      result: "INVALID",
      detail: "The Agent step left no subagent transcript.",
    });
  });

  test("returns the main session's outcome when the main session strayed", () => {
    const strayed = parseTranscript(
      new FakeTranscript(ROOT)
        .tool("Read", { file_path: `${ROOT}/pkg/a.txt` })
        .jsonl(),
    );

    expect(judgeClaude(plan, strayed, null).result).toBe("INVALID");
  });

  test("prefixes the subagent's detail", () => {
    expect(judgeFollowing(plan).detail).toStartWith(
      "Subagent: pkg/CLAUDE.md: right after step 1",
    );
  });
});

describe("prompts", () => {
  test("number each step and spell out its tool call", () => {
    const prompt = sessionPrompt(ROOT, [
      { tool: "Read", path: "pkg/a.txt" },
      { tool: "Write", path: "pkg/b.txt", content: "ok" },
      { tool: "Edit", path: "pkg/a.txt", find: "stock", replace: "stock ok" },
      { tool: "Bash", command: "cat pkg/a.txt | head -n 5" },
      { tool: "Skill", skill: "acme-restock" },
    ]);

    expect(prompt).toContain(`1. Use the Read tool on \`${ROOT}/pkg/a.txt\`.`);
    expect(prompt).toContain(
      `2. Use the Write tool to create \`${ROOT}/pkg/b.txt\` holding exactly \`ok\`.`,
    );
    expect(prompt).toContain("3. Use the Edit tool on");
    expect(prompt).toContain("    cat pkg/a.txt | head -n 5");
    expect(prompt).toContain(
      "5. Use the Skill tool to run the skill named `acme-restock`.",
    );
    expect(prompt).toContain("Make no other tool call");
  });

  test("hand the subagent its own steps, indented", () => {
    const plan = claudeCanaries().find(([id]) => id === "subagent")?.[1];

    if (plan === undefined) {
      throw new Error("The subagent canary is missing.");
    }

    const prompt = mainPrompt(plan, ROOT);

    expect(prompt).toContain(
      "1. Use the Agent tool with subagent_type `general-purpose`",
    );
    expect(prompt).toContain(
      `    1. Use the Read tool on \`${ROOT}/pkg/a.txt\`.`,
    );
    expect(prompt).toContain("Then wait for the agent to finish.");
  });
});

describe("judging the Codex canary", () => {
  const plan = codexPlan();
  const { root, nested } = plan.markers;
  const passing: CodexEvidence = {
    fromRoot: {
      instructions: `instructions ${root}`,
      commands: [{ command: "cat pkg/a.txt", exitCode: 0 }],
      created: true,
    },
    fromNested: { instructions: `instructions ${root} ${nested}` },
  };

  test("passes when only the start directory's chain loads", () => {
    expect(judgeCodex(plan, passing).result).toBe("PASS");
  });

  const cases: [string, CodexEvidence, Result, string][] = [
    [
      "the run never read the file",
      {
        ...passing,
        fromRoot: {
          ...passing.fromRoot,
          commands: [{ command: "ls pkg/a.txt", exitCode: 0 }],
        },
      },
      "INVALID",
      "never ran `cat pkg/a.txt`",
    ],
    [
      "the read failed",
      {
        ...passing,
        fromRoot: {
          ...passing.fromRoot,
          commands: [{ command: "cat pkg/a.txt", exitCode: 1 }],
        },
      },
      "INVALID",
      "never ran `cat pkg/a.txt`",
    ],
    [
      "the run never wrote the file",
      { ...passing, fromRoot: { ...passing.fromRoot, created: false } },
      "INVALID",
      "never created pkg/new.txt",
    ],
    [
      "the root file is missing",
      {
        ...passing,
        fromRoot: { ...passing.fromRoot, instructions: "instructions" },
      },
      "FAIL",
      "did not load the root AGENTS.md",
    ],
    [
      "the nested file loads below it",
      {
        ...passing,
        fromRoot: { ...passing.fromRoot, instructions: `${root} ${nested}` },
      },
      "FAIL",
      "loaded pkg/AGENTS.md",
    ],
    [
      "the start directory's file is missing",
      { ...passing, fromNested: { instructions: root } },
      "FAIL",
      "Started in pkg/",
    ],
  ];

  test.each(cases)(
    "judges the case where %s",
    (_case, evidence, result, detail) => {
      const outcome = judgeCodex(plan, evidence);

      expect(outcome.result).toBe(result);
      expect(outcome.detail).toContain(detail);
    },
  );

  test("never names a marker in its prompts", () => {
    const prompts = `${plan.runs.fromRoot.prompt} ${plan.runs.fromNested.prompt}`;

    expect(prompts).not.toContain(root);
    expect(prompts).not.toContain(nested);
  });
});
