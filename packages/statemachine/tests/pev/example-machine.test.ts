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
import type { ExampleServices } from "../../src/machines/example/services.js";
import {
  mockExampleContext,
  mockExampleIssue,
  mockExamplePR,
  mockExampleServices,
} from "./mock-factories.js";
import type { IssueStateRepository } from "../../src/machines/example/context.js";
// History messages are now written to issue body via auto-history, not completedActions

// ============================================================================
// Helpers
// ============================================================================

const RUNNER_CTX: ExternalRunnerContext = {
  token: "test-token",
  owner: "test-owner",
  repo: "test-repo",
};

async function runExampleMachine(
  domain: ExampleContext,
  opts?: { maxCycles?: number; services?: Partial<ExampleServices> },
) {
  const services = mockExampleServices(opts?.services);

  const actor = createActor(exampleMachine, {
    input: {
      domain,
      maxCycles: opts?.maxCycles ?? 1,
      runnerCtx: RUNNER_CTX,
      services,
    },
  });

  actor.start();

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
    expect(actionTypes).toContain("runClaudeTriage");
    expect(actionTypes).toContain("applyTriageOutput");
    expect(actionTypes).toContain("updateStatus");
  });

  it("routes action failure through actionFailure state and logs history", async () => {
    const domain = mockExampleContext({
      trigger: "issue-triage",
      issue: mockExampleIssue({ labels: [] }),
    });

    const snap = await runExampleMachine(domain, {
      services: {
        triage: {
          triageIssue: async () => {
            throw new Error("triage service unavailable");
          },
        },
      },
    });

    expect(String(snap.value)).toBe("done");
    expect(snap.context.error).toContain("triage service unavailable");
  });

  it("routes verification failure through actionFailure and logs history", async () => {
    const domain = mockExampleContext({
      trigger: "issue-triage",
      issue: mockExampleIssue({ labels: [] }),
      triageOutput: null,
    });
    const repository: IssueStateRepository = {
      setIssueStatus: () => {},
      addIssueLabels: () => {
        // Intentionally no-op to force prediction-check failure.
      },
      reconcileSubIssues: () => {},
      updateBody: () => {},
    };
    domain.repository = repository;

    const snap = await runExampleMachine(domain, {
      services: {
        triage: {
          triageIssue: async () => ({
            labelsToAdd: ["triaged"],
            summary: "ok",
          }),
        },
      },
    });

    expect(String(snap.value)).toBe("done");
    expect(snap.context.error).toContain("Verification failed");
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
        projectStatus: "Triaged",
      }),
    });

    const snap = await runExampleMachine(domain);

    expect(String(snap.value)).toBe("done");
    const actionTypes = snap.context.completedActions.map((a) => a.action.type);
    expect(actionTypes).toContain("runClaudeGrooming");
    expect(actionTypes).toContain("applyGroomingOutput");
    expect(actionTypes).toContain("reconcileSubIssues");
  });

  it("routes to grooming when triaged but not groomed", async () => {
    const domain = mockExampleContext({
      trigger: "issue-edited",
      issue: mockExampleIssue({
        projectStatus: "Triaged",
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
        projectStatus: "Triaged",
      }),
    });

    const snap = await runExampleMachine(domain);
    expect(String(snap.value)).toBe("done");
    const actionTypes = snap.context.completedActions.map((a) => a.action.type);
    expect(actionTypes).toEqual([
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
    // Override GITHUB_ACTIONS so git actions use their fast (skipped) path in CI
    const origGHA = process.env.GITHUB_ACTIONS;
    process.env.GITHUB_ACTIONS = "";
    try {
      const parentIssue = mockExampleIssue({
        number: 99,
        projectStatus: "In progress",
        assignees: ["nopo-bot"],

        hasSubIssues: true,
      });

      const domain = mockExampleContext({
        trigger: "issue-assigned",
        issue: mockExampleIssue({
          number: 100,
          assignees: ["nopo-bot"],
        }),
        parentIssue,
      });

      // Cycle 1: prepare queue (setupGit + prepareBranch)
      const snap = await runExampleMachine(domain);

      expect(String(snap.value)).toBe("done");
      const actionTypes = snap.context.completedActions.map(
        (a) => a.action.type,
      );
      expect(actionTypes).toContain("setupGit");
      expect(actionTypes).toContain("prepareBranch");
      // branchPrepResult is set to "clean" — routing would continue to iterate on next cycle
      expect(snap.context.domain.branchPrepResult).toBe("clean");
    } finally {
      process.env.GITHUB_ACTIONS = origGHA;
    }
  });

  it("records failure and re-enters iteration on first CI failure", async () => {
    const parentIssue = mockExampleIssue({
      number: 99,
      projectStatus: "In progress",
      assignees: ["nopo-bot"],
      hasSubIssues: true,
    });
    const domain = mockExampleContext({
      trigger: "workflow-run-completed",
      ciResult: "failure",
      maxRetries: 3,
      issue: mockExampleIssue({
        number: 100,
        assignees: ["nopo-bot"],

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
    expect(snap.context.domain.issue.failures).toBe(1);
  });

  it("adds CI failure context when re-entering iteration from CI", async () => {
    const parentIssue = mockExampleIssue({
      number: 99,
      projectStatus: "In progress",
      assignees: ["nopo-bot"],
      hasSubIssues: true,
    });
    const domain = mockExampleContext({
      trigger: "workflow-run-completed",
      ciResult: "failure",
      issue: mockExampleIssue({
        number: 100,
        assignees: ["nopo-bot"],
      }),
      parentIssue,
    });

    const snap = await runExampleMachine(domain);
    expect(String(snap.value)).toBe("done");
    // Auto-history writes queue label "iterate" to issue body
    expect(snap.context.domain.issue.body).toContain("iterate");
  });

  it("routes to blocked when CI fails at max retries (circuit breaker)", async () => {
    const parentIssue = mockExampleIssue({
      number: 99,
      projectStatus: "In progress",
      assignees: ["nopo-bot"],
      hasSubIssues: true,
    });

    const domain = mockExampleContext({
      trigger: "workflow-run-completed",
      ciResult: "failure",
      maxRetries: 3,
      issue: mockExampleIssue({
        number: 100,
        assignees: ["nopo-bot"],

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
    // Auto-history writes max failures info to issue body
    expect(snap.context.domain.issue.body).toContain("block");
  });

  it("adds review-changes context when re-entering iteration from review", async () => {
    const parentIssue = mockExampleIssue({
      number: 99,
      projectStatus: "In progress",
      assignees: ["nopo-bot"],
      hasSubIssues: true,
    });
    const domain = mockExampleContext({
      trigger: "pr-review-submitted",
      reviewDecision: "CHANGES_REQUESTED",
      issue: mockExampleIssue({
        number: 100,
        assignees: ["nopo-bot"],
      }),
      parentIssue,
    });

    const snap = await runExampleMachine(domain);
    expect(String(snap.value)).toBe("done");
    // Auto-history writes queue label "iterate" to issue body
    expect(snap.context.domain.issue.body).toContain("iterate");
  });
});

// ============================================================================
// Review Tests
// ============================================================================

describe("Example Machine — Review", () => {
  it("routes to review when status is In review", async () => {
    const parentIssue = mockExampleIssue({
      number: 99,
      projectStatus: "In progress",
      hasSubIssues: true,
    });
    const domain = mockExampleContext({
      trigger: "issue-edited",
      issue: mockExampleIssue({
        projectStatus: "In review",
      }),
      parentIssue,
    });

    const snap = await runExampleMachine(domain);

    // isInReview routes to awaitingReview (final) — no looping, waits for review event
    expect(String(snap.value)).toBe("awaitingReview");
    expect(snap.context.completedActions).toHaveLength(0);
  });

  it("adds comment context when staying in review after comments", async () => {
    const parentIssue = mockExampleIssue({
      number: 99,
      projectStatus: "In progress",
      hasSubIssues: true,
    });
    const domain = mockExampleContext({
      trigger: "pr-review-submitted",
      reviewDecision: "COMMENTED",
      issue: mockExampleIssue({
        projectStatus: "In review",
      }),
      parentIssue,
    });

    const snap = await runExampleMachine(domain);
    expect(String(snap.value)).toBe("done");
    // Auto-history writes queue label "review" to issue body (PR responding queue)
    expect(snap.context.domain.issue.body).toContain("review");
  });

  it("runs awaiting-merge queue for approved review trigger", async () => {
    const parentIssue = mockExampleIssue({
      number: 99,
      projectStatus: "In progress",
      hasSubIssues: true,
    });
    const domain = mockExampleContext({
      trigger: "pr-review-approved",
      issue: mockExampleIssue({
        projectStatus: "In review",
      }),
      parentIssue,
    });

    const snap = await runExampleMachine(domain);

    expect(String(snap.value)).toBe("done");
    const actionTypes = snap.context.completedActions.map((a) => a.action.type);
    expect(actionTypes).not.toContain("runAgent");
  });

  it("runs merge queue for pr-merged trigger and marks done", async () => {
    const domain = mockExampleContext({
      trigger: "pr-merged",
      issue: mockExampleIssue({
        projectStatus: "In review",
      }),
    });

    const snap = await runExampleMachine(domain);

    expect(String(snap.value)).toBe("done");
    const actionTypes = snap.context.completedActions.map((a) => a.action.type);
    expect(actionTypes).toContain("updateStatus");
    expect(snap.context.domain.issue.projectStatus).toBe("Done");
  });

  it("handles pr-review-requested trigger on In review sub-issue by assigning review", async () => {
    const parentIssue = mockExampleIssue({
      number: 99,
      projectStatus: "In progress",
      hasSubIssues: true,
    });
    const domain = mockExampleContext({
      trigger: "pr-review-requested",
      issue: mockExampleIssue({
        projectStatus: "In review",
      }),
      parentIssue,
    });

    const snap = await runExampleMachine(domain);
    // pr-review-requested now routes to the PR review flow (CI not failed → assigned)
    expect(String(snap.value)).toBe("prReviewAssigned");
    expect(snap.context.completedActions).toEqual([]);
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
      }),
    });

    const snap = await runExampleMachine(domain);

    expect(String(snap.value)).toBe("done");
    // Auto-history writes deploy context to issue body
    expect(snap.context.domain.issue.body).toContain("deploy");
  });

  it("runs prod deploy queue for deployed-prod trigger", async () => {
    const domain = mockExampleContext({
      trigger: "deployed-prod",
      issue: mockExampleIssue({
        projectStatus: "Done",
      }),
    });

    const snap = await runExampleMachine(domain);

    expect(String(snap.value)).toBe("done");
    const actionTypes = snap.context.completedActions.map((a) => a.action.type);
    expect(actionTypes).toContain("updateStatus");
    expect(snap.context.domain.issue.projectStatus).toBe("Done");
  });

  it("runs stage failure queue and marks error", async () => {
    const domain = mockExampleContext({
      trigger: "deployed-stage-failed",
      issue: mockExampleIssue({
        projectStatus: "Done",
      }),
    });

    const snap = await runExampleMachine(domain);

    expect(String(snap.value)).toBe("done");
    expect(snap.context.domain.issue.projectStatus).toBe("Error");
  });

  it("runs prod failure queue and marks error", async () => {
    const domain = mockExampleContext({
      trigger: "deployed-prod-failed",
      issue: mockExampleIssue({
        projectStatus: "Done",
      }),
    });

    const snap = await runExampleMachine(domain);

    expect(String(snap.value)).toBe("done");
    expect(snap.context.domain.issue.projectStatus).toBe("Error");
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
      hasSubIssues: true,
    });

    const domain = mockExampleContext({
      trigger: "issue-edited",
      issue: mockExampleIssue({
        number: 100,
        projectStatus: "Backlog",
        assignees: [],
      }),
      parentIssue,
    });

    const snap = await runExampleMachine(domain);

    expect(String(snap.value)).toBe("subIssueIdle");
    expect(snap.context.completedActions).toHaveLength(0);
  });

  it("fixes status when parent is Groomed without sub-issues", async () => {
    const domain = mockExampleContext({
      trigger: "issue-edited",
      issue: mockExampleIssue({
        projectStatus: "Groomed",
        hasSubIssues: false,
        subIssues: [],
      }),
    });

    const snap = await runExampleMachine(domain);

    // fixState catches the misalignment (Groomed without sub-issues → Backlog)
    expect(String(snap.value)).toBe("done");
    expect(snap.context.domain.issue.projectStatus).toBe("Backlog");
  });

  it("fixes status misalignment when parent is In progress without sub-issues", async () => {
    const domain = mockExampleContext({
      trigger: "issue-edited",
      issue: mockExampleIssue({
        projectStatus: "In progress",
        hasSubIssues: false,
      }),
    });

    const snap = await runExampleMachine(domain);

    expect(String(snap.value)).toBe("done");
    // fixState should have corrected status to Backlog
    expect(snap.context.domain.issue.projectStatus).toBe("Backlog");
  });
});

// ============================================================================
// Max Transitions Tests
// ============================================================================

describe("Example Machine — Max Cycles", () => {
  it("completes N full queue cycles before stopping", async () => {
    const domain = mockExampleContext({
      trigger: "issue-triage",
      issue: mockExampleIssue({ labels: [] }),
    });

    const snap = await runExampleMachine(domain, { maxCycles: 2 });

    expect(String(snap.value)).toBe("done");
    // 2 cycles × 3 triage actions (runClaudeTriage, applyTriageOutput, updateStatus) = 6
    expect(snap.context.completedActions.length).toBeGreaterThanOrEqual(6);
    expect(snap.context.cycleCount).toBe(2);
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

    const snap = await runExampleMachine(domain);

    expect(String(snap.value)).toBe("done");
    expect(snap.context.completedActions).toHaveLength(3);
    expect(snap.context.completedActions.map((a) => a.action.type)).toEqual([
      "runClaudeTriage",
      "applyTriageOutput",
      "updateStatus",
    ]);
    expect(snap.context.actionQueue).toHaveLength(0);
  });
});
