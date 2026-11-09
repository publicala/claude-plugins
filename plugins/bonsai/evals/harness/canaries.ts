/**
 * One canary per fact in `references/load-model.md` about when Claude Code
 * (or Codex) loads an instruction file. Each builds a fixture repository
 * with unique markers, prescribes the tool calls a session makes in it, and
 * states where each marker must first reach the context.
 */
import {
  callMatchesStep,
  describeCall,
  describeStep,
  markerArrival,
  nextModelTurn,
  type Step,
  type Transcript,
} from "./transcript";

export type Result = "PASS" | "FAIL" | "INVALID";

export interface Outcome {
  result: Result;
  detail: string;
}

/**
 * Where a marker must first reach the context: right after the result of a
 * step (1-based), before the model's next turn, or never. A list accepts
 * any of its steps, for a load Claude Code does not make at the same step
 * every run.
 */
export interface Expectation {
  what: string;
  marker: string;
  afterStep: number | number[] | "never";
}

export interface Session {
  steps: Step[];
  expectations: Expectation[];
}

export interface ClaudePlan {
  files: Record<string, string>;
  tools: string[];
  main: Session;
  /** The session the main one starts with its single Agent step. */
  subagent?: Session;
}

export interface CodexRun {
  /** The directory Codex starts in, relative to the fixture root. */
  cwd: string;
  prompt: string;
}

export interface CodexPlan {
  files: Record<string, string>;
  runs: { fromRoot: CodexRun; fromNested: CodexRun };
  markers: { root: string; nested: string };
}

export interface FixtureContext {
  root: string;
  nonce: string;
}

interface CanaryBase {
  id: string;
  fact: string;
  /** The load-model.md statement a FAIL contradicts. */
  update: string;
}

export type Canary =
  | (CanaryBase & {
      agent: "claude";
      plan: (context: FixtureContext) => ClaudePlan;
    })
  | (CanaryBase & {
      agent: "codex";
      plan: (context: FixtureContext) => CodexPlan;
    });

const BASE_FILES: Record<string, string> = {
  "CLAUDE.md": "# Acme Books inventory\n\nKeep changes small.\n",
  "README.md": "# Acme Books inventory\n",
};

function marker(context: FixtureContext, role: string): string {
  return `ACME-${role}-${context.nonce}`;
}

function nestedMemory(markerText: string): string {
  return `# Package notes\n\nMarker: ${markerText}\n`;
}

function rule(globs: string[], markerText: string): string {
  const paths = globs.map((glob) => `  - "${glob}"`).join("\n");

  return `---\npaths:\n${paths}\n---\n\nMarker: ${markerText}\n`;
}

function skill(
  name: string,
  description: string,
  body: string,
  globs: string[] = [],
): string {
  const paths =
    globs.length === 0
      ? ""
      : `paths:\n${globs.map((glob) => `  - "${glob}"`).join("\n")}\n`;

  return `---\nname: ${name}\ndescription: ${description}\n${paths}---\n\n${body}\n`;
}

function stepInstruction(
  root: string,
  step: Step,
  subagentPrompt: string,
): string {
  if (step.tool === "Read") {
    return `Use the Read tool on \`${root}/${step.path}\`.`;
  }

  if (step.tool === "Write") {
    return `Use the Write tool to create \`${root}/${step.path}\` holding exactly \`${step.content}\`.`;
  }

  if (step.tool === "Edit") {
    return `Use the Edit tool on \`${root}/${step.path}\` to replace \`${step.find}\` with \`${step.replace}\`.`;
  }

  if (step.tool === "Bash") {
    return `Use the Bash tool to run exactly this command, unchanged:\n\n    ${step.command}`;
  }

  if (step.tool === "Skill") {
    return `Use the Skill tool to run the skill named \`${step.skill}\`.`;
  }

  const indented = subagentPrompt
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");

  return `Use the Agent tool with subagent_type \`general-purpose\` and model \`haiku\`, passing it this prompt word for word:\n\n${indented}\n\nThen wait for the agent to finish.`;
}

/** The prompt that makes a session run exactly these steps. */
export function sessionPrompt(
  root: string,
  steps: Step[],
  subagentPrompt = "",
): string {
  const numbered = steps
    .map(
      (step, index) =>
        `${index + 1}. ${stepInstruction(root, step, subagentPrompt)}`,
    )
    .join("\n");

  return `Run these steps in order, one tool call per step:

${numbered}

Make no other tool call: do not read, list or search any other file, and do not open any CLAUDE.md, SKILL.md or rule file. If a step fails, go on to the next one. After the last step, reply DONE.`;
}

export function mainPrompt(plan: ClaudePlan, root: string): string {
  const subagentPrompt =
    plan.subagent === undefined ? "" : sessionPrompt(root, plan.subagent.steps);

  return sessionPrompt(root, plan.main.steps, subagentPrompt);
}

function position(
  transcript: Transcript,
  steps: Step[],
  arrival: number | null,
): string {
  if (arrival === null) {
    return "never";
  }

  const calls = transcript.toolCalls.slice(0, steps.length);
  let latest = -1;
  calls.forEach((call, index) => {
    if (call.resultAt !== null && call.resultAt < arrival) {
      latest = index;
    }
  });
  const step = steps[latest];
  const call = calls[latest];

  if (step === undefined || call === undefined || call.resultAt === null) {
    return "at session start";
  }

  const label = `step ${latest + 1} (${describeStep(step)})`;

  return arrival < nextModelTurn(transcript, call.resultAt)
    ? `right after ${label}`
    : `after ${label}, past the model's next turn`;
}

/**
 * Judges one session: INVALID when it strayed from the prescribed steps,
 * else PASS when every marker arrived where its expectation says.
 */
export function judgeSession(
  transcript: Transcript,
  session: Session,
): Outcome {
  const { steps, expectations } = session;
  const calls = transcript.toolCalls;

  for (const [index, step] of steps.entries()) {
    const call = calls[index];

    if (call === undefined) {
      return {
        result: "INVALID",
        detail: `The session made ${calls.length} tool calls, so step ${index + 1} (${describeStep(step)}) never ran.`,
      };
    }

    if (!callMatchesStep(call, step)) {
      return {
        result: "INVALID",
        detail: `Step ${index + 1} expected ${describeStep(step)}, the session called ${describeCall(call)}.`,
      };
    }

    if (call.resultAt === null) {
      return {
        result: "INVALID",
        detail: `Step ${index + 1} (${describeStep(step)}) has no result.`,
      };
    }
  }

  const extra = calls[steps.length];

  if (extra !== undefined) {
    return {
      result: "INVALID",
      detail: `The session made an extra tool call after the last step: ${describeCall(extra)}.`,
    };
  }

  const findings = expectations.map((expectation) => {
    const arrival = markerArrival(transcript, expectation.marker);
    const where = position(transcript, steps, arrival);
    const accepted =
      expectation.afterStep === "never"
        ? ["never"]
        : [expectation.afterStep]
            .flat()
            .map(
              (number) =>
                `right after step ${number} (${describeStep(stepAt(steps, number))})`,
            );

    return {
      holds: accepted.includes(where),
      text: `${expectation.what}: ${where}`,
      expected: accepted.join(" or "),
    };
  });
  const failures = findings.filter((finding) => !finding.holds);

  if (failures.length > 0) {
    const errors = calls
      .slice(0, steps.length)
      .flatMap((call, index) =>
        call.error === null
          ? []
          : [` Step ${index + 1} returned an error: ${call.error}`],
      )
      .join("");

    return {
      result: "FAIL",
      detail: `${failures.map((failure) => `${failure.text}, expected ${failure.expected}.`).join(" ")}${errors}`,
    };
  }

  return {
    result: "PASS",
    detail: findings.map((finding) => finding.text).join("; "),
  };
}

function stepAt(steps: Step[], number: number): Step {
  const step = steps[number - 1];

  if (step === undefined) {
    throw new Error(
      `An expectation names step ${number}, and the canary has ${steps.length} steps.`,
    );
  }

  return step;
}

/** Judges both sessions of a canary that runs a subagent. */
export function judgeClaude(
  plan: ClaudePlan,
  main: Transcript,
  subagent: Transcript | null,
): Outcome {
  const mainOutcome = judgeSession(main, plan.main);

  if (plan.subagent === undefined || mainOutcome.result !== "PASS") {
    return mainOutcome;
  }

  if (subagent === null) {
    return {
      result: "INVALID",
      detail: "The Agent step left no subagent transcript.",
    };
  }

  const subagentOutcome = judgeSession(subagent, plan.subagent);

  return {
    result: subagentOutcome.result,
    detail: `Subagent: ${subagentOutcome.detail}`,
  };
}

export interface CodexEvidence {
  fromRoot: { rollout: string; commands: string[]; created: boolean };
  fromNested: { rollout: string };
}

export function judgeCodex(plan: CodexPlan, evidence: CodexEvidence): Outcome {
  const { fromRoot, fromNested } = evidence;
  const { root, nested } = plan.markers;

  if (!fromRoot.commands.some((command) => command.includes("pkg/a.txt"))) {
    return {
      result: "INVALID",
      detail: "The run from the root never read pkg/a.txt.",
    };
  }

  if (!fromRoot.created) {
    return {
      result: "INVALID",
      detail: "The run from the root never created pkg/new.txt.",
    };
  }

  if (!fromRoot.rollout.includes(root)) {
    return {
      result: "FAIL",
      detail: "Started at the root, Codex did not load the root AGENTS.md.",
    };
  }

  if (fromRoot.rollout.includes(nested)) {
    return {
      result: "FAIL",
      detail:
        "Started at the root, Codex loaded pkg/AGENTS.md after a read and a write below it.",
    };
  }

  if (
    !fromNested.rollout.includes(nested) ||
    !fromNested.rollout.includes(root)
  ) {
    return {
      result: "FAIL",
      detail:
        "Started in pkg/, Codex did not load both the root and the pkg/AGENTS.md.",
    };
  }

  return {
    result: "PASS",
    detail:
      "From the root: root AGENTS.md only, also after the read and write under pkg/. From pkg/: both.",
  };
}

const NESTED_CLAUDE_MD = "pkg/CLAUDE.md";

export const CANARIES: Canary[] = [
  {
    id: "nested-on-read",
    agent: "claude",
    fact: "A nested CLAUDE.md is absent at start and arrives right after the first Read under its directory.",
    update:
      "load-model.md, Four classes: a nested CLAUDE.md loads on a Read of a file under its directory.",
    plan: (context) => {
      const nested = marker(context, "NESTED");

      return {
        files: {
          ...BASE_FILES,
          [NESTED_CLAUDE_MD]: nestedMemory(nested),
          "pkg/a.txt": "stock\n",
        },
        tools: ["Read"],
        main: {
          steps: [{ tool: "Read", path: "pkg/a.txt" }],
          expectations: [
            { what: NESTED_CLAUDE_MD, marker: nested, afterStep: 1 },
          ],
        },
      };
    },
  },
  {
    id: "nested-on-deep-write",
    agent: "claude",
    fact: "A Write that creates the first file in a new directory two levels below the nested CLAUDE.md loads it right after.",
    update:
      "load-model.md, What triggers a load: a Write that creates the first file in a directory counts, at any depth.",
    plan: (context) => {
      const nested = marker(context, "NESTED");

      return {
        files: {
          ...BASE_FILES,
          [NESTED_CLAUDE_MD]: nestedMemory(nested),
          "pkg/a.txt": "stock\n",
        },
        tools: ["Write"],
        main: {
          steps: [
            { tool: "Write", path: "pkg/sub/deeper/new.txt", content: "ok" },
          ],
          expectations: [
            { what: NESTED_CLAUDE_MD, marker: nested, afterStep: 1 },
          ],
        },
      };
    },
  },
  {
    id: "nested-on-edit-after-piped-read",
    agent: "claude",
    fact: "A piped shell read loads nothing, and the nested CLAUDE.md arrives right after the Edit that follows it or, when that Edit loads nothing, right after the next Read.",
    update:
      "load-model.md, What triggers a load: an Edit whose only prior read was a shell read that loaded nothing lands without the scoped file, which arrives after that Edit or at a later file-tool call, and a piped read is missed.",
    plan: (context) => {
      const nested = marker(context, "NESTED");

      return {
        files: {
          ...BASE_FILES,
          [NESTED_CLAUDE_MD]: nestedMemory(nested),
          "pkg/a.txt": "stock\n",
        },
        tools: ["Bash", "Edit", "Read"],
        main: {
          steps: [
            { tool: "Bash", command: "cat pkg/a.txt | head -n 5" },
            {
              tool: "Edit",
              path: "pkg/a.txt",
              find: "stock",
              replace: "stock ok",
            },
            { tool: "Read", path: "pkg/a.txt" },
          ],
          expectations: [
            { what: NESTED_CLAUDE_MD, marker: nested, afterStep: [2, 3] },
          ],
        },
      };
    },
  },
  {
    id: "nested-on-plain-shell-read",
    agent: "claude",
    fact: "A plain single-file shell read (`cat pkg/a.txt`) loads the nested CLAUDE.md.",
    update:
      "load-model.md, What triggers a load: a plain shell read of a named in-scope file loads the scoped file.",
    plan: (context) => {
      const nested = marker(context, "NESTED");

      return {
        files: {
          ...BASE_FILES,
          [NESTED_CLAUDE_MD]: nestedMemory(nested),
          "pkg/a.txt": "stock\n",
        },
        tools: ["Bash"],
        main: {
          steps: [{ tool: "Bash", command: "cat pkg/a.txt" }],
          expectations: [
            { what: NESTED_CLAUDE_MD, marker: nested, afterStep: 1 },
          ],
        },
      };
    },
  },
  {
    id: "nested-missed-after-cd",
    agent: "claude",
    fact: "The same shell read after `cd pkg &&` loads nothing, and a later Read does.",
    update:
      "load-model.md, What triggers a load: a `cd <dir> &&` prefix makes the harness miss a shell read.",
    plan: (context) => {
      const nested = marker(context, "NESTED");

      return {
        files: {
          ...BASE_FILES,
          [NESTED_CLAUDE_MD]: nestedMemory(nested),
          "pkg/a.txt": "stock\n",
        },
        tools: ["Bash", "Read"],
        main: {
          steps: [
            { tool: "Bash", command: "cd pkg && cat a.txt" },
            { tool: "Read", path: "pkg/a.txt" },
          ],
          expectations: [
            { what: NESTED_CLAUDE_MD, marker: nested, afterStep: 2 },
          ],
        },
      };
    },
  },
  {
    id: "rule-on-read",
    agent: "claude",
    fact: "A path-scoped rule is absent at start, skips a non-matching Read, and arrives right after a matching Read.",
    update:
      "load-model.md, Four classes: a path-scoped rule loads on a Read of a file matching a glob.",
    plan: (context) => {
      const ruleMarker = marker(context, "RULE");

      return {
        files: {
          ...BASE_FILES,
          ".claude/rules/typescript.md": rule(["src/**/*.ts"], ruleMarker),
          "docs/guide.md": "# Guide\n",
          "src/app/main.ts": "export const title = 'Acme';\n",
        },
        tools: ["Read"],
        main: {
          steps: [
            { tool: "Read", path: "docs/guide.md" },
            { tool: "Read", path: "src/app/main.ts" },
          ],
          expectations: [
            {
              what: ".claude/rules/typescript.md",
              marker: ruleMarker,
              afterStep: 2,
            },
          ],
        },
      };
    },
  },
  {
    id: "rule-on-deep-write",
    agent: "claude",
    fact: "A Write that creates the first matching file in a new nested directory loads the path-scoped rule right after.",
    update:
      "load-model.md, Four classes: a path-scoped rule loads on a Write of a file matching a glob.",
    plan: (context) => {
      const ruleMarker = marker(context, "RULE");

      return {
        files: {
          ...BASE_FILES,
          ".claude/rules/typescript.md": rule(["src/**/*.ts"], ruleMarker),
          "src/app/main.ts": "export const title = 'Acme';\n",
        },
        tools: ["Write"],
        main: {
          steps: [
            {
              tool: "Write",
              path: "src/feature/deep/new.ts",
              content: "export {};",
            },
          ],
          expectations: [
            {
              what: ".claude/rules/typescript.md",
              marker: ruleMarker,
              afterStep: 1,
            },
          ],
        },
      };
    },
  },
  {
    id: "rule-glob-unanchored",
    agent: "claude",
    fact: "Rule globs match like gitignore: `lib/**` matches `src/lib/` at any depth, and `/lib/**` only the root `lib/`.",
    update:
      "load-model.md, Four classes: an unanchored `dir/**` glob matches that directory at any depth, and a leading `/` anchors it.",
    plan: (context) => {
      const unanchored = marker(context, "UNANCHORED");
      const anchored = marker(context, "ANCHORED");

      return {
        files: {
          ...BASE_FILES,
          ".claude/rules/unanchored.md": rule(["lib/**"], unanchored),
          ".claude/rules/anchored.md": rule(["/lib/**"], anchored),
          "src/lib/x.ts": "export const x = 1;\n",
          "lib/y.ts": "export const y = 2;\n",
        },
        tools: ["Read"],
        main: {
          steps: [
            { tool: "Read", path: "src/lib/x.ts" },
            { tool: "Read", path: "lib/y.ts" },
          ],
          expectations: [
            { what: "rule `lib/**`", marker: unanchored, afterStep: 1 },
            { what: "rule `/lib/**`", marker: anchored, afterStep: 2 },
          ],
        },
      };
    },
  },
  {
    id: "nested-skill",
    agent: "claude",
    fact: "A nested skill is unlisted at start, its description arrives after the first Read under its directory, and its body only when it runs.",
    update:
      "load-model.md, Skills: a nested skill is hidden until the first touch under its directory, then only its description arrives.",
    plan: (context) => {
      const description = marker(context, "NESTED-SKILL-DESCRIPTION");
      const body = marker(context, "NESTED-SKILL-BODY");

      return {
        files: {
          ...BASE_FILES,
          "tools/.claude/skills/acme-restock/SKILL.md": skill(
            "acme-restock",
            `Restock helper ${description}. Use when restocking titles.`,
            `Reply with the word RESTOCKED. Marker: ${body}`,
          ),
          "tools/a.txt": "stock\n",
        },
        tools: ["Read", "Skill"],
        main: {
          steps: [
            { tool: "Read", path: "tools/a.txt" },
            { tool: "Skill", skill: "acme-restock" },
          ],
          expectations: [
            { what: "skill description", marker: description, afterStep: 1 },
            { what: "skill body", marker: body, afterStep: 2 },
          ],
        },
      };
    },
  },
  {
    id: "paths-skill",
    agent: "claude",
    fact: "A root skill with `paths:` globs is unlisted at start, skips a non-matching Read, and is listed right after a matching Read.",
    update:
      "load-model.md, Skills: a skill's `paths:` globs keep its description out of the listing until a matching file is touched.",
    plan: (context) => {
      const description = marker(context, "PATHS-SKILL-DESCRIPTION");

      return {
        files: {
          ...BASE_FILES,
          ".claude/skills/acme-pricing/SKILL.md": skill(
            "acme-pricing",
            `Pricing helper ${description}. Use when changing prices.`,
            "Reply with the word PRICED.",
            ["src/**/*.ts"],
          ),
          "docs/guide.md": "# Guide\n",
          "src/app/main.ts": "export const title = 'Acme';\n",
        },
        tools: ["Read", "Skill"],
        main: {
          steps: [
            { tool: "Read", path: "docs/guide.md" },
            { tool: "Read", path: "src/app/main.ts" },
          ],
          expectations: [
            { what: "skill description", marker: description, afterStep: 2 },
          ],
        },
      };
    },
  },
  {
    id: "gitignored-skill",
    agent: "claude",
    fact: "A nested skill inside a gitignored directory is never listed, while the same skill in a tracked directory is.",
    update:
      "load-model.md, Skills: the harness never scans a gitignored directory for skills.",
    plan: (context) => {
      const ignored = marker(context, "IGNORED-SKILL");
      const tracked = marker(context, "TRACKED-SKILL");

      return {
        files: {
          ...BASE_FILES,
          ".gitignore": "vendor/\n",
          "vendor/acme/.claude/skills/acme-vendored/SKILL.md": skill(
            "acme-vendored",
            `Vendored helper ${ignored}.`,
            "Reply VENDORED.",
          ),
          "vendor/acme/a.txt": "vendored\n",
          "lib/.claude/skills/acme-tracked/SKILL.md": skill(
            "acme-tracked",
            `Tracked helper ${tracked}.`,
            "Reply TRACKED.",
          ),
          "lib/a.txt": "tracked\n",
        },
        tools: ["Read", "Skill"],
        main: {
          steps: [
            { tool: "Read", path: "vendor/acme/a.txt" },
            { tool: "Read", path: "lib/a.txt" },
          ],
          expectations: [
            { what: "gitignored skill", marker: ignored, afterStep: "never" },
            { what: "tracked skill", marker: tracked, afterStep: 2 },
          ],
        },
      };
    },
  },
  {
    id: "subagent",
    agent: "claude",
    fact: "A subagent gets the nested CLAUDE.md and the nested skill the same way: absent at its start, right after its first Read under the directory.",
    update:
      "load-model.md, Skills: nested skills (and nested CLAUDE.md) load the same way in subagents.",
    plan: (context) => {
      const nested = marker(context, "NESTED");
      const description = marker(context, "NESTED-SKILL-DESCRIPTION");

      return {
        files: {
          ...BASE_FILES,
          [NESTED_CLAUDE_MD]: nestedMemory(nested),
          "pkg/.claude/skills/acme-restock/SKILL.md": skill(
            "acme-restock",
            `Restock helper ${description}. Use when restocking titles.`,
            "Reply RESTOCKED.",
          ),
          "pkg/a.txt": "stock\n",
        },
        tools: ["Agent", "Read", "Skill"],
        main: { steps: [{ tool: "Agent" }], expectations: [] },
        subagent: {
          steps: [{ tool: "Read", path: "pkg/a.txt" }],
          expectations: [
            { what: NESTED_CLAUDE_MD, marker: nested, afterStep: 1 },
            {
              what: "nested skill description",
              marker: description,
              afterStep: 1,
            },
          ],
        },
      };
    },
  },
  {
    id: "codex-agents-md",
    agent: "codex",
    fact: "Codex loads AGENTS.md from the root down to its start directory only, and a read or write below a nested AGENTS.md loads nothing.",
    update:
      "load-model.md, Other agents: Codex reads AGENTS.md files once, at start, from the root down to its start directory.",
    plan: (context) => {
      const root = marker(context, "ROOT-AGENTS");
      const nested = marker(context, "NESTED-AGENTS");

      return {
        files: {
          "AGENTS.md": `# Acme Books inventory\n\nMarker: ${root}\n`,
          "pkg/AGENTS.md": `# Package notes\n\nMarker: ${nested}\n`,
          "pkg/a.txt": "stock\n",
        },
        runs: {
          fromRoot: {
            cwd: ".",
            prompt:
              "Run `cat pkg/a.txt`, then create pkg/new.txt holding the word ok. Do not open or list any AGENTS.md file. Reply DONE.",
          },
          fromNested: {
            cwd: "pkg",
            prompt: "Reply DONE without running any command.",
          },
        },
        markers: { root, nested },
      };
    },
  },
];
