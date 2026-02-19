/**
 * Integration tests for the example PEV machine.
 *
 * Tests the full domain routing → action queue building → PEV execution
 * cycle. Uses only example and core imports (no legacy/issues).
 */

import { describe, it, expect } from "vitest";
import { createActor, waitFor } from "xstate";
import { exampleMachine } from "../../src/machines/example/machine.js";
import { type ExampleContext } from "../../src/machines/example/context.js";
import type { ExternalRunnerContext } from "../../src/core/pev/types.js";
import {
  mockExampleContext,
  mockExampleIssue,
  mockExamplePR,
} from "./mock-factories.js";
import type { IssueStateRepository } from "../../src/machines/example/context.js";

// ============================================================================
// Helpers
// ============================================================================

const RUNNER_CTX: ExternalRunnerContext = {
  token: "test-token",
  owner: "test-owner",
  repo: "test-repo",
};

async function runExampleMachine(domain: ExampleContext, maxTransitions = 10) {
  const triage =
    domain.services?.triage ??
    ({
      triageIssue: async () => ({
        labelsToAdd: ["triaged"],
        summary: "Issue triaged",
      }),
    } satisfies NonNullable<ExampleContext["services"]>["triage"]);
  const grooming =
    domain.services?.grooming ??
    ({
      groomIssue: async (input: {
        issueNumber: number;
        promptVars: {
          ISSUE_NUMBER: string;
          ISSUE_TITLE: string;
          ISSUE_BODY: string;
          ISSUE_COMMENTS: string;
          ISSUE_LABELS: string;
        };
      }) => ({
        labelsToAdd: ["groomed"],
        decision: "ready" as const,
        summary: "Issue groomed",
      }),
    } satisfies NonNullable<ExampleContext["services"]>["grooming"]);
  const iteration =
    domain.services?.iteration ??
    ({
      iterateIssue: async () => ({
        labelsToAdd: ["iteration:ready"],
        summary: "Iteration plan ready",
      }),
    } satisfies NonNullable<ExampleContext["services"]>["iteration"]);
  const review =
    domain.services?.review ??
    ({
      reviewIssue: async () => ({
        labelsToAdd: ["reviewed"],
        summary: "Review analyzed",
      }),
    } satisfies NonNullable<ExampleContext["services"]>["review"]);
  const prResponse =
    domain.services?.prResponse ??
    ({
      respondToPr: async () => ({
        labelsToAdd: ["response-prepared"],
        summary: "Response prepared",
      }),
    } satisfies NonNullable<ExampleContext["services"]>["prResponse"]);
  domain.services = {
    ...domain.services,
    triage,
    grooming,
    iteration,
    review,
    prResponse,
  };

  const actor = createActor(exampleMachine, {
    input: { domain, maxTransitions, runnerCtx: RUNNER_CTX },
  });

  actor.start();
  actor.send({ type: "DETECT" });

  return waitFor(actor, (s) => s.status === "done", { timeout: 5000 });
}

// ============================================================================
// Triage Tests
// ============================================================================

describe("Example Machine — Triage", () => {
  it("routes to triage for untriaged issues", async () => {
    const domain = mockExampleContext({
      trigger: "issue-triage",
      issue: mockExampleIssue({ labels: [] }),
    });

    const snap = await runExampleMachine(domain);

    expect(String(snap.value)).toBe("done");
    expect(snap.context.completedActions.length).toBeGreaterThanOrEqual(1);
    const actionTypes = snap.context.completedActions.map((a) => a.action.type);
    expect(actionTypes).toContain("appendHistory");
    expect(actionTypes).toContain("runClaudeTriage");
    expect(actionTypes).toContain("applyTriageOutput");
    expect(actionTypes).toContain("updateStatus");
  });

  it("routes action failure through actionFailure state and logs history", async () => {
    const domain = mockExampleContext({
      trigger: "issue-triage",
      issue: mockExampleIssue({ labels: [] }),
      services: {
        triage: {
          triageIssue: async () => {
            throw new Error("triage service unavailable");
          },
        },
      },
    });

    const snap = await runExampleMachine(domain);

    expect(String(snap.value)).toBe("done");
    expect(snap.context.error).toContain("triage service unavailable");
    const historyActions = snap.context.completedActions.filter(
      (a) => a.action.type === "appendHistory",
    );
    expect(
      historyActions.some(
        (a) =>
          "payload" in a.action &&
          typeof a.action.payload === "object" &&
          a.action.payload !== null &&
          "message" in a.action.payload &&
          typeof a.action.payload.message === "string" &&
          a.action.payload.message.includes("Action execution failed"),
      ),
    ).toBe(true);
  });

  it("routes verification failure through actionFailure and logs history", async () => {
    const domain = mockExampleContext({
      trigger: "issue-triage",
      issue: mockExampleIssue({ labels: [] }),
      triageOutput: null,
      services: {
        triage: {
          triageIssue: async () => ({
            labelsToAdd: ["triaged"],
            summary: "ok",
          }),
        },
      },
    });
    const repository: IssueStateRepository & { save: () => Promise<boolean> } =
      {
        setIssueStatus: () => {},
        addIssueLabels: () => {
          // Intentionally no-op to force prediction-check failure.
        },
        reconcileSubIssues: () => {},
        save: async () => true,
      };
    domain.repository = repository;

    const snap = await runExampleMachine(domain);

    expect(String(snap.value)).toBe("done");
    expect(snap.context.error).toContain("Verification failed");
    const historyActions = snap.context.completedActions.filter(
      (a) => a.action.type === "appendHistory",
    );
    expect(
      historyActions.some(
        (a) =>
          "payload" in a.action &&
          typeof a.action.payload === "object" &&
          a.action.payload !== null &&
          "message" in a.action.payload &&
          typeof a.action.payload.message === "string" &&
          a.action.payload.message.includes("Action execution failed"),
      ),
    ).toBe(true);
  });
});

// ============================================================================
// Grooming Tests
// ============================================================================

describe("Example Machine — Grooming", () => {
  it("routes to grooming for issue-groom trigger", async () => {
    const domain = mockExampleContext({
      trigger: "issue-groom",
      issue: mockExampleIssue({
        labels: ["triaged"],
      }),
    });

    const snap = await runExampleMachine(domain);

    expect(String(snap.value)).toBe("done");
    const actionTypes = snap.context.completedActions.map((a) => a.action.type);
    expect(actionTypes).toContain("appendHistory");
    expect(actionTypes).toContain("runClaudeGrooming");
    expect(actionTypes).toContain("applyGroomingOutput");
    expect(actionTypes).toContain("reconcileSubIssues");
  });

  it("routes to grooming when triaged but not groomed", async () => {
    const domain = mockExampleContext({
      trigger: "issue-edited",
      issue: mockExampleIssue({
        labels: ["triaged"],
      }),
    });

    const snap = await runExampleMachine(domain);

    expect(String(snap.value)).toBe("done");
    const actionTypes = snap.context.completedActions.map((a) => a.action.type);
    expect(actionTypes).toContain("runClaudeGrooming");
  });

  it("routes to grooming for issue-groom-summary trigger", async () => {
    const domain = mockExampleContext({
      trigger: "issue-groom-summary",
      issue: mockExampleIssue({
        labels: ["triaged"],
      }),
    });

    const snap = await runExampleMachine(domain);
    expect(String(snap.value)).toBe("done");
    const actionTypes = snap.context.completedActions.map((a) => a.action.type);
    expect(actionTypes).toEqual([
      "appendHistory",
      "runClaudeGrooming",
      "applyGroomingOutput",
      "reconcileSubIssues",
    ]);
  });
});

// ============================================================================
// Iterate Tests
// ============================================================================

describe("Example Machine — Iterate", () => {
  it("routes to iterate for sub-issues with bot assigned", async () => {
    const parentIssue = mockExampleIssue({
      number: 99,
      projectStatus: "In progress",
      assignees: ["nopo-bot"],
      labels: ["triaged", "groomed"],
      hasSubIssues: true,
    });

    const domain = mockExampleContext({
      trigger: "issue-assigned",
      issue: mockExampleIssue({
        number: 100,
        assignees: ["nopo-bot"],
        labels: ["triaged", "groomed"],
      }),
      parentIssue,
    });

    const snap = await runExampleMachine(domain);

    expect(String(snap.value)).toBe("done");
    const actionTypes = snap.context.completedActions.map((a) => a.action.type);
    expect(actionTypes).toContain("updateStatus");
    expect(actionTypes).toContain("runClaudeIteration");
    expect(actionTypes).toContain("applyIterationOutput");
  });

  it("records failure and re-enters iteration on first CI failure", async () => {
    const parentIssue = mockExampleIssue({
      number: 99,
      projectStatus: "In progress",
      assignees: ["nopo-bot"],
      labels: ["triaged", "groomed"],
      hasSubIssues: true,
    });
    const domain = mockExampleContext({
      trigger: "workflow-run-completed",
      ciResult: "failure",
      maxRetries: 3,
      issue: mockExampleIssue({
        number: 100,
        assignees: ["nopo-bot"],
        labels: ["triaged", "groomed"],
        failures: 0,
      }),
      parentIssue,
    });

    const snap = await runExampleMachine(domain);
    expect(String(snap.value)).toBe("done");
    expect(
      snap.context.completedActions.some(
        (a) => a.action.type === "recordFailure",
      ),
    ).toBe(true);
    expect(
      snap.context.completedActions.some((a) => {
        if (a.action.type !== "appendHistory" || !("payload" in a.action))
          return false;
        const p = a.action.payload;
        const msg =
          p && typeof p === "object" && "message" in p
            ? Reflect.get(p, "message")
            : undefined;
        return msg === "CI failed, returning to iteration";
      }),
    ).toBe(true);
    expect(snap.context.domain.issue.failures).toBe(1);
  });

  it("adds CI failure context when re-entering iteration from CI", async () => {
    const parentIssue = mockExampleIssue({
      number: 99,
      projectStatus: "In progress",
      assignees: ["nopo-bot"],
      labels: ["triaged", "groomed"],
      hasSubIssues: true,
    });
    const domain = mockExampleContext({
      trigger: "workflow-run-completed",
      ciResult: "failure",
      issue: mockExampleIssue({
        number: 100,
        assignees: ["nopo-bot"],
        labels: ["triaged", "groomed"],
      }),
      parentIssue,
    });

    const snap = await runExampleMachine(domain);
    expect(String(snap.value)).toBe("done");
    const historyActions = snap.context.completedActions.filter(
      (a) => a.action.type === "appendHistory",
    );
    expect(
      historyActions.some(
        (a) =>
          "payload" in a.action &&
          typeof a.action.payload === "object" &&
          a.action.payload !== null &&
          "message" in a.action.payload &&
          a.action.payload.message === "CI failed, returning to iteration",
      ),
    ).toBe(true);
  });

  it("routes to blocked when CI fails at max retries (circuit breaker)", async () => {
    const parentIssue = mockExampleIssue({
      number: 99,
      projectStatus: "In progress",
      assignees: ["nopo-bot"],
      labels: ["triaged", "groomed"],
      hasSubIssues: true,
    });

    const domain = mockExampleContext({
      trigger: "workflow-run-completed",
      ciResult: "failure",
      maxRetries: 3,
      issue: mockExampleIssue({
        number: 100,
        assignees: ["nopo-bot"],
        labels: ["triaged", "groomed"],
        failures: 3,
      }),
      parentIssue,
    });

    const snap = await runExampleMachine(domain);

    expect(String(snap.value)).toBe("done");
    expect(snap.context.domain.issue.projectStatus).toBe("Blocked");
    expect(
      snap.context.completedActions.some((a) => {
        if (a.action.type !== "updateStatus" || !("payload" in a.action))
          return false;
        const status = Reflect.get(a.action.payload, "status");
        return status === "Blocked";
      }),
    ).toBe(true);
    expect(
      snap.context.completedActions.some((a) => {
        if (a.action.type !== "appendHistory" || !("payload" in a.action))
          return false;
        const msg = Reflect.get(a.action.payload, "message");
        return typeof msg === "string" && msg.includes("Max failures");
      }),
    ).toBe(true);
  });

  it("adds review-changes context when re-entering iteration from review", async () => {
    const parentIssue = mockExampleIssue({
      number: 99,
      projectStatus: "In progress",
      assignees: ["nopo-bot"],
      labels: ["triaged", "groomed"],
      hasSubIssues: true,
    });
    const domain = mockExampleContext({
      trigger: "pr-review-submitted",
      reviewDecision: "CHANGES_REQUESTED",
      issue: mockExampleIssue({
        number: 100,
        assignees: ["nopo-bot"],
        labels: ["triaged", "groomed"],
      }),
      parentIssue,
    });

    const snap = await runExampleMachine(domain);
    expect(String(snap.value)).toBe("done");
    const historyActions = snap.context.completedActions.filter(
      (a) => a.action.type === "appendHistory",
    );
    expect(
      historyActions.some(
        (a) =>
          "payload" in a.action &&
          typeof a.action.payload === "object" &&
          a.action.payload !== null &&
          "message" in a.action.payload &&
          a.action.payload.message ===
            "Review requested changes, returning to iteration",
      ),
    ).toBe(true);
  });
});

// ============================================================================
// Review Tests
// ============================================================================

describe("Example Machine — Review", () => {
  it("routes to review when status is In review", async () => {
    const domain = mockExampleContext({
      trigger: "issue-edited",
      issue: mockExampleIssue({
        projectStatus: "In review",
        labels: ["triaged", "groomed"],
      }),
    });

    const snap = await runExampleMachine(domain);

    expect(String(snap.value)).toBe("done");
    const actionTypes = snap.context.completedActions.map((a) => a.action.type);
    expect(actionTypes).toContain("updateStatus");
    expect(actionTypes).toContain("appendHistory");
  });

  it("adds comment context when staying in review after comments", async () => {
    const domain = mockExampleContext({
      trigger: "pr-review-submitted",
      reviewDecision: "COMMENTED",
      issue: mockExampleIssue({
        projectStatus: "In review",
        labels: ["triaged", "groomed"],
      }),
    });

    const snap = await runExampleMachine(domain);
    expect(String(snap.value)).toBe("done");
    const historyActions = snap.context.completedActions.filter(
      (a) => a.action.type === "appendHistory",
    );
    expect(
      historyActions.some(
        (a) =>
          "payload" in a.action &&
          typeof a.action.payload === "object" &&
          a.action.payload !== null &&
          "message" in a.action.payload &&
          a.action.payload.message === "Review commented, staying in review",
      ),
    ).toBe(true);
  });

  it("runs awaiting-merge queue for approved review trigger", async () => {
    const domain = mockExampleContext({
      trigger: "pr-review-approved",
      issue: mockExampleIssue({
        projectStatus: "In review",
        labels: ["triaged", "groomed"],
      }),
    });

    const snap = await runExampleMachine(domain);

    expect(String(snap.value)).toBe("done");
    const actionTypes = snap.context.completedActions.map((a) => a.action.type);
    expect(actionTypes).toContain("appendHistory");
    expect(actionTypes).not.toContain("runAgent");
  });

  it("runs merge queue for pr-merged trigger and marks done", async () => {
    const domain = mockExampleContext({
      trigger: "pr-merged",
      issue: mockExampleIssue({
        projectStatus: "In review",
        labels: ["triaged", "groomed"],
      }),
    });

    const snap = await runExampleMachine(domain);

    expect(String(snap.value)).toBe("done");
    const actionTypes = snap.context.completedActions.map((a) => a.action.type);
    expect(actionTypes).toContain("updateStatus");
    expect(actionTypes).toContain("appendHistory");
    expect(snap.context.domain.issue.projectStatus).toBe("Done");
  });

  it("handles pr-review-requested trigger via review queue", async () => {
    const domain = mockExampleContext({
      trigger: "pr-review-requested",
      issue: mockExampleIssue({
        projectStatus: "In review",
        labels: ["triaged", "groomed"],
      }),
    });

    const snap = await runExampleMachine(domain);
    expect(String(snap.value)).toBe("done");
    expect(snap.context.completedActions.map((a) => a.action.type)).toEqual([
      "updateStatus",
      "appendHistory",
    ]);
  });
});

// ============================================================================
// Deploy Tests
// ============================================================================

describe("Example Machine — Deploy", () => {
  it("runs stage deploy queue for deployed-stage trigger", async () => {
    const domain = mockExampleContext({
      trigger: "deployed-stage",
      issue: mockExampleIssue({
        projectStatus: "Done",
        labels: ["triaged", "groomed"],
      }),
    });

    const snap = await runExampleMachine(domain);

    expect(String(snap.value)).toBe("done");
    const actionTypes = snap.context.completedActions.map((a) => a.action.type);
    expect(actionTypes).toContain("appendHistory");
    expect(
      snap.context.completedActions.some(
        (a) =>
          "payload" in a.action &&
          typeof a.action.payload === "object" &&
          a.action.payload !== null &&
          "message" in a.action.payload &&
          a.action.payload.message === "Deployment to stage succeeded",
      ),
    ).toBe(true);
  });

  it("runs prod deploy queue for deployed-prod trigger", async () => {
    const domain = mockExampleContext({
      trigger: "deployed-prod",
      issue: mockExampleIssue({
        projectStatus: "Done",
        labels: ["triaged", "groomed"],
      }),
    });

    const snap = await runExampleMachine(domain);

    expect(String(snap.value)).toBe("done");
    const actionTypes = snap.context.completedActions.map((a) => a.action.type);
    expect(actionTypes).toContain("updateStatus");
    expect(actionTypes).toContain("appendHistory");
    expect(snap.context.domain.issue.projectStatus).toBe("Done");
  });

  it("runs stage failure queue and marks error", async () => {
    const domain = mockExampleContext({
      trigger: "deployed-stage-failed",
      issue: mockExampleIssue({
        projectStatus: "Done",
        labels: ["triaged", "groomed"],
      }),
    });

    const snap = await runExampleMachine(domain);

    expect(String(snap.value)).toBe("done");
    expect(snap.context.domain.issue.projectStatus).toBe("Error");
    expect(
      snap.context.completedActions.some(
        (a) =>
          "payload" in a.action &&
          typeof a.action.payload === "object" &&
          a.action.payload !== null &&
          "message" in a.action.payload &&
          a.action.payload.message === "Deployment to stage failed",
      ),
    ).toBe(true);
  });

  it("runs prod failure queue and marks error", async () => {
    const domain = mockExampleContext({
      trigger: "deployed-prod-failed",
      issue: mockExampleIssue({
        projectStatus: "Done",
        labels: ["triaged", "groomed"],
      }),
    });

    const snap = await runExampleMachine(domain);

    expect(String(snap.value)).toBe("done");
    expect(snap.context.domain.issue.projectStatus).toBe("Error");
    expect(
      snap.context.completedActions.some(
        (a) =>
          "payload" in a.action &&
          typeof a.action.payload === "object" &&
          a.action.payload !== null &&
          "message" in a.action.payload &&
          a.action.payload.message === "Deployment to production failed",
      ),
    ).toBe(true);
  });
});

// ============================================================================
// Terminal State Tests
// ============================================================================

describe("Example Machine — Terminal States", () => {
  it("routes to done for already-done issues", async () => {
    const domain = {
      ...mockExampleContext({
        trigger: "issue-edited",
        issue: mockExampleIssue({
          projectStatus: "Done",
          labels: ["triaged", "groomed"],
        }),
      }),
      pr: mockExamplePR({ state: "MERGED", title: "Test PR" }),
      hasPR: true,
    };

    const snap = await runExampleMachine(domain);

    expect(String(snap.value)).toBe("done");
    expect(snap.context.completedActions).toHaveLength(0);
  });

  it("routes to alreadyBlocked for blocked issues", async () => {
    const domain = mockExampleContext({
      trigger: "issue-edited",
      issue: mockExampleIssue({
        projectStatus: "Blocked",
        labels: ["triaged", "groomed"],
      }),
    });

    const snap = await runExampleMachine(domain);

    expect(String(snap.value)).toBe("alreadyBlocked");
    expect(snap.context.completedActions).toHaveLength(0);
  });

  it("routes to error for error-status issues", async () => {
    const domain = mockExampleContext({
      trigger: "issue-edited",
      issue: mockExampleIssue({
        projectStatus: "Error",
        labels: ["triaged", "groomed"],
      }),
    });

    const snap = await runExampleMachine(domain);

    expect(String(snap.value)).toBe("error");
    expect(snap.context.completedActions).toHaveLength(0);
  });

  it("routes sub-issue without bot assigned to subIssueIdle", async () => {
    const parentIssue = mockExampleIssue({
      number: 99,
      projectStatus: "In progress",
      assignees: ["nopo-bot"],
      labels: ["triaged", "groomed"],
      hasSubIssues: true,
    });

    const domain = mockExampleContext({
      trigger: "issue-edited",
      issue: mockExampleIssue({
        number: 100,
        assignees: [],
        labels: ["triaged", "groomed"],
      }),
      parentIssue,
    });

    const snap = await runExampleMachine(domain);

    expect(String(snap.value)).toBe("subIssueIdle");
    expect(snap.context.completedActions).toHaveLength(0);
  });

  it("routes parent in progress without sub-issues to invalidIteration", async () => {
    const domain = mockExampleContext({
      trigger: "issue-edited",
      issue: mockExampleIssue({
        labels: ["triaged", "groomed"],
        projectStatus: "In progress",
        hasSubIssues: false,
        subIssues: [],
      }),
    });

    const snap = await runExampleMachine(domain);

    expect(String(snap.value)).toBe("invalidIteration");
    expect(snap.context.completedActions).toHaveLength(0);
  });

  it("routes to idle when no guard matches", async () => {
    const domain = mockExampleContext({
      trigger: "issue-edited",
      issue: mockExampleIssue({
        projectStatus: "Backlog",
        labels: ["triaged", "groomed"],
      }),
    });

    const snap = await runExampleMachine(domain);

    expect(String(snap.value)).toBe("idle");
    expect(snap.context.completedActions).toHaveLength(0);
  });
});

// ============================================================================
// Max Transitions Tests
// ============================================================================

describe("Example Machine — Max Transitions", () => {
  it("exits gracefully when max transitions reached mid-queue", async () => {
    const domain = mockExampleContext({
      trigger: "issue-triage",
      issue: mockExampleIssue({ labels: [] }),
    });

    const snap = await runExampleMachine(domain, 2);

    expect(String(snap.value)).toBe("transitionLimitReached");
    expect(snap.context.completedActions).toHaveLength(2);
    expect(snap.context.actionQueue.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// Multiple Actions Tests
// ============================================================================

describe("Example Machine — Multiple Actions", () => {
  it("processes all actions in triage queue", async () => {
    const domain = mockExampleContext({
      trigger: "issue-triage",
      issue: mockExampleIssue({ labels: [] }),
    });

    const snap = await runExampleMachine(domain, 100);

    expect(String(snap.value)).toBe("done");
    expect(snap.context.completedActions).toHaveLength(4);
    expect(snap.context.completedActions.map((a) => a.action.type)).toEqual([
      "appendHistory",
      "runClaudeTriage",
      "applyTriageOutput",
      "updateStatus",
    ]);
    expect(snap.context.actionQueue).toHaveLength(0);
  });
});
