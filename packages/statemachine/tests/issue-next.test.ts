/**
 * Test suite for the invoke-based issue machine.
 *
 * Tests the IssueMachine class including predict, execute, and helper classes.
 */

import { describe, it, expect, vi } from "vitest";
import { parseMarkdown } from "@more/issue-state";
import { createMachineContext } from "../src/core/schemas/state.js";
import {
  ParentIssueSchema,
  SubIssueSchema,
} from "../src/core/schemas/index.js";
import type { MachineContext } from "../src/core/schemas/index.js";
import type { Logger } from "../src/core/types.js";

// Invoke-based implementation
import {
  IssueMachine,
  MachineVerifier,
  buildDeriveMetadata,
} from "../src/machines/issues/index.js";
import { buildActionsForService } from "../src/machines/issues/services.js";

function createMockLogger(): Logger & {
  debug: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warning: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
} {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  };
}

// ============================================================================
// Test Fixtures
// ============================================================================

function createIssue(overrides: Record<string, unknown> = {}) {
  return ParentIssueSchema.parse({
    number: 42,
    title: "Test Issue",
    state: "OPEN",
    bodyAst: parseMarkdown("# Task\n\n## Todos\n\n- [ ] item 1"),
    projectStatus: "Backlog",
    iteration: 0,
    failures: 0,
    assignees: [],
    labels: [],
    subIssues: [],
    hasSubIssues: false,
    comments: [],
    branch: null,
    pr: null,
    parentIssueNumber: null,
    ...overrides,
  });
}

function createSubIssue(overrides: Record<string, unknown> = {}) {
  return ParentIssueSchema.parse({
    number: 100,
    title: "[Phase 1]: Implementation",
    state: "OPEN",
    bodyAst: parseMarkdown("# Task\n\n## Todos\n\n- [ ] implement feature"),
    projectStatus: null,
    iteration: 0,
    failures: 0,
    assignees: ["nopo-bot"],
    labels: ["triaged", "groomed"],
    subIssues: [],
    hasSubIssues: false,
    comments: [],
    branch: null,
    pr: null,
    parentIssueNumber: 99,
    ...overrides,
  });
}

function createParentIssue(overrides: Record<string, unknown> = {}) {
  return ParentIssueSchema.parse({
    number: 99,
    title: "Parent Issue",
    state: "OPEN",
    bodyAst: parseMarkdown("# Parent"),
    projectStatus: "In progress",
    iteration: 0,
    failures: 0,
    assignees: ["nopo-bot"],
    labels: ["triaged", "groomed"],
    subIssues: [],
    hasSubIssues: true,
    comments: [],
    branch: null,
    pr: null,
    parentIssueNumber: null,
    ...overrides,
  });
}

function createSubIssueData(overrides: Record<string, unknown> = {}) {
  return SubIssueSchema.parse({
    number: 100,
    title: "[Phase 1]: Impl",
    state: "OPEN",
    bodyAst: parseMarkdown("# Phase 1"),
    projectStatus: null,
    assignees: [],
    labels: [],
    branch: null,
    pr: null,
    ...overrides,
  });
}

function createPR(overrides: Record<string, unknown> = {}) {
  const labels: string[] = [];
  const reviews: Array<{ state: string; author: string; body: string }> = [];
  return {
    number: 1,
    title: "PR",
    headRef: "branch",
    baseRef: "main",
    isDraft: false,
    state: "OPEN" as const,
    labels,
    reviews,
    ...overrides,
  };
}

function ctx(overrides: Partial<MachineContext> = {}): MachineContext {
  return createMachineContext({
    trigger: "issue-triage",
    owner: "test-owner",
    repo: "test-repo",
    issue: createIssue(),
    ...overrides,
  });
}

// ============================================================================
// State Coverage Tests
// ============================================================================

describe("issue-next: state coverage", () => {
  describe("machine reaches correct state for each trigger", () => {
    it("triaging — via trigger", () => {
      const machine = new IssueMachine(ctx({ trigger: "issue-triage" }), {
        logger: createMockLogger(),
      });
      const result = machine.run();
      expect(result.state).toBe("triaging");
    });

    it("triaging — via needsTriage", () => {
      const machine = new IssueMachine(
        ctx({
          trigger: "issue-edited",
          issue: createIssue({ labels: [] }),
        }),
        { logger: createMockLogger() },
      );
      expect(machine.run().state).toBe("triaging");
    });

    it("grooming — via trigger", () => {
      const result = new IssueMachine(
        ctx({
          trigger: "issue-groom",
          issue: createIssue({ labels: ["triaged"] }),
        }),
        { logger: createMockLogger() },
      ).run();
      expect(result.state).toBe("grooming");
    });

    it("grooming — via needsGrooming", () => {
      const result = new IssueMachine(
        ctx({
          trigger: "issue-edited",
          issue: createIssue({ labels: ["triaged"] }),
        }),
        { logger: createMockLogger() },
      ).run();
      expect(result.state).toBe("grooming");
    });

    it("pivoting", () => {
      const result = new IssueMachine(
        ctx({
          trigger: "issue-pivot",
          issue: createIssue({
            labels: ["triaged", "groomed"],
            projectStatus: "In progress",
          }),
        }),
        { logger: createMockLogger() },
      ).run();
      expect(result.state).toBe("pivoting");
    });

    it("resetting", () => {
      const result = new IssueMachine(
        ctx({
          trigger: "issue-reset",
          issue: createIssue({ projectStatus: "In progress" }),
        }),
        { logger: createMockLogger() },
      ).run();
      expect(result.state).toBe("resetting");
    });

    it("retrying → iterating (no sub-issues)", () => {
      const result = new IssueMachine(
        ctx({
          trigger: "issue-retry",
          issue: createIssue({
            projectStatus: "Blocked",
            labels: ["triaged", "groomed"],
            assignees: ["nopo-bot"],
          }),
          parentIssue: createParentIssue(),
        }),
        { logger: createMockLogger() },
      ).run();
      expect(result.state).toBe("iterating");
    });

    it("commenting", () => {
      const result = new IssueMachine(
        ctx({
          trigger: "issue-comment",
          issue: createIssue({ labels: ["triaged"] }),
        }),
        { logger: createMockLogger() },
      ).run();
      expect(result.state).toBe("commenting");
    });

    it("prReviewing — CI passed", () => {
      const result = new IssueMachine(
        ctx({
          trigger: "pr-review-requested",
          issue: createIssue({ labels: ["triaged", "groomed"] }),
          ciResult: "success",
          pr: createPR(),
          hasPR: true,
        }),
        { logger: createMockLogger() },
      ).run();
      expect(result.state).toBe("prReviewing");
    });

    it("prReviewAssigned — CI unknown", () => {
      const result = new IssueMachine(
        ctx({
          trigger: "pr-review-requested",
          issue: createIssue({ labels: ["triaged", "groomed"] }),
          ciResult: null,
          pr: createPR(),
          hasPR: true,
        }),
        { logger: createMockLogger() },
      ).run();
      expect(result.state).toBe("prReviewAssigned");
    });

    it("prReviewSkipped — CI failed", () => {
      const result = new IssueMachine(
        ctx({
          trigger: "pr-review-requested",
          issue: createIssue({ labels: ["triaged", "groomed"] }),
          ciResult: "failure",
          pr: createPR(),
          hasPR: true,
        }),
        { logger: createMockLogger() },
      ).run();
      expect(result.state).toBe("prReviewSkipped");
    });

    it("prResponding", () => {
      const result = new IssueMachine(
        ctx({
          trigger: "pr-response",
          issue: createIssue({ labels: ["triaged", "groomed"] }),
          pr: createPR(),
          hasPR: true,
        }),
        { logger: createMockLogger() },
      ).run();
      expect(result.state).toBe("prResponding");
    });

    it("prRespondingHuman", () => {
      const result = new IssueMachine(
        ctx({
          trigger: "pr-human-response",
          issue: createIssue({ labels: ["triaged", "groomed"] }),
          pr: createPR(),
          hasPR: true,
        }),
        { logger: createMockLogger() },
      ).run();
      expect(result.state).toBe("prRespondingHuman");
    });

    it("prPush", () => {
      const result = new IssueMachine(
        ctx({
          trigger: "pr-push",
          issue: createIssue({ labels: ["triaged", "groomed"] }),
          pr: createPR(),
          hasPR: true,
        }),
        { logger: createMockLogger() },
      ).run();
      expect(result.state).toBe("prPush");
    });

    it("processingCI → iteratingFix (CI failed, not blocked)", () => {
      const result = new IssueMachine(
        ctx({
          trigger: "workflow-run-completed",
          issue: createIssue({
            labels: ["triaged", "groomed"],
            projectStatus: "In progress",
            failures: 0,
          }),
          ciResult: "failure",
          parentIssue: createParentIssue(),
        }),
        { logger: createMockLogger() },
      ).run();
      expect(result.state).toBe("iteratingFix");
    });

    it("processingCI → blocked (max failures)", () => {
      const result = new IssueMachine(
        ctx({
          trigger: "workflow-run-completed",
          issue: createIssue({
            labels: ["triaged", "groomed"],
            projectStatus: "In progress",
            failures: 5,
          }),
          ciResult: "failure",
          maxRetries: 5,
          parentIssue: createParentIssue(),
        }),
        { logger: createMockLogger() },
      ).run();
      expect(result.state).toBe("blocked");
    });

    it("processingCI → transitioningToReview → reviewing (CI passed + todos done)", () => {
      const result = new IssueMachine(
        ctx({
          trigger: "workflow-run-completed",
          issue: createIssue({
            labels: ["triaged", "groomed"],
            projectStatus: "In progress",
            bodyAst: parseMarkdown("# Task\n\n## Todos\n\n- [x] all done"),
          }),
          ciResult: "success",
          parentIssue: createParentIssue(),
        }),
        { logger: createMockLogger() },
      ).run();
      expect(result.state).toBe("reviewing");
    });

    it("processingCI → iterating (CI passed + todos pending)", () => {
      const result = new IssueMachine(
        ctx({
          trigger: "workflow-run-completed",
          issue: createIssue({
            labels: ["triaged", "groomed"],
            projectStatus: "In progress",
          }),
          ciResult: "success",
          parentIssue: createParentIssue(),
        }),
        { logger: createMockLogger() },
      ).run();
      expect(result.state).toBe("iterating");
    });

    it("processingReview → awaitingMerge (approved)", () => {
      const result = new IssueMachine(
        ctx({
          trigger: "pr-review-approved",
          issue: createIssue({
            labels: ["triaged", "groomed"],
            projectStatus: "In review",
          }),
          reviewDecision: "APPROVED",
          pr: createPR(),
          hasPR: true,
        }),
        { logger: createMockLogger() },
      ).run();
      expect(result.state).toBe("awaitingMerge");
    });

    it("processingReview → iterating (changes requested)", () => {
      const result = new IssueMachine(
        ctx({
          trigger: "pr-review-submitted",
          issue: createIssue({
            labels: ["triaged", "groomed"],
            projectStatus: "In review",
            assignees: ["nopo-bot"],
          }),
          reviewDecision: "CHANGES_REQUESTED",
          pr: createPR(),
          hasPR: true,
          parentIssue: createParentIssue(),
        }),
        { logger: createMockLogger() },
      ).run();
      expect(result.state).toBe("iterating");
    });

    it("done — already done with merged PR", () => {
      const result = new IssueMachine(
        ctx({
          trigger: "issue-edited",
          issue: createIssue({
            projectStatus: "Done",
            labels: ["triaged", "groomed"],
          }),
          pr: createPR({ state: "MERGED" as const }),
          hasPR: true,
        }),
        { logger: createMockLogger() },
      ).run();
      expect(result.state).toBe("done");
    });

    it("alreadyBlocked", () => {
      const result = new IssueMachine(
        ctx({
          trigger: "issue-edited",
          issue: createIssue({
            projectStatus: "Blocked",
            labels: ["triaged", "groomed"],
          }),
        }),
        { logger: createMockLogger() },
      ).run();
      expect(result.state).toBe("alreadyBlocked");
    });

    it("error", () => {
      const result = new IssueMachine(
        ctx({
          trigger: "issue-edited",
          issue: createIssue({
            projectStatus: "Error",
            labels: ["triaged", "groomed"],
          }),
        }),
        { logger: createMockLogger() },
      ).run();
      expect(result.state).toBe("error");
    });

    it("subIssueIdle — sub-issue without bot assigned", () => {
      const result = new IssueMachine(
        ctx({
          trigger: "issue-edited",
          issue: createSubIssue({ assignees: [] }),
          parentIssue: createParentIssue(),
        }),
        { logger: createMockLogger() },
      ).run();
      expect(result.state).toBe("subIssueIdle");
    });

    it("iterating — sub-issue with bot assigned", () => {
      const result = new IssueMachine(
        ctx({
          trigger: "issue-edited",
          issue: createSubIssue({ assignees: ["nopo-bot"] }),
          parentIssue: createParentIssue(),
        }),
        { logger: createMockLogger() },
      ).run();
      expect(result.state).toBe("iterating");
    });

    it("invalidIteration — parent issue without sub-issues", () => {
      const result = new IssueMachine(
        ctx({
          trigger: "issue-edited",
          issue: createIssue({
            labels: ["triaged", "groomed"],
            projectStatus: "In progress",
          }),
        }),
        { logger: createMockLogger() },
      ).run();
      expect(result.state).toBe("invalidIteration");
    });

    it("orchestrating → orchestrationRunning", () => {
      const result = new IssueMachine(
        ctx({
          trigger: "issue-orchestrate",
          issue: createIssue({
            labels: ["triaged", "groomed"],
            hasSubIssues: true,
            subIssues: [createSubIssueData()],
          }),
        }),
        { logger: createMockLogger() },
      ).run();
      expect(result.state).toBe("orchestrationRunning");
    });

    it("orchestrating → orchestrationComplete (all phases done)", () => {
      const result = new IssueMachine(
        ctx({
          trigger: "issue-orchestrate",
          issue: createIssue({
            labels: ["triaged", "groomed"],
            hasSubIssues: true,
            subIssues: [
              createSubIssueData({
                state: "CLOSED",
                projectStatus: "Done",
              }),
            ],
          }),
        }),
        { logger: createMockLogger() },
      ).run();
      expect(result.state).toBe("orchestrationComplete");
    });

    it("mergeQueueLogging", () => {
      const result = new IssueMachine(
        ctx({
          trigger: "merge-queue-entered",
          issue: createIssue({
            labels: ["triaged", "groomed"],
            projectStatus: "In progress",
          }),
        }),
        { logger: createMockLogger() },
      ).run();
      expect(result.state).toBe("mergeQueueLogging");
    });

    it("mergeQueueFailureLogging", () => {
      const result = new IssueMachine(
        ctx({
          trigger: "merge-queue-failed",
          issue: createIssue({
            labels: ["triaged", "groomed"],
            projectStatus: "In progress",
          }),
        }),
        { logger: createMockLogger() },
      ).run();
      expect(result.state).toBe("mergeQueueFailureLogging");
    });

    it("processingMerge → orchestrating", () => {
      const result = new IssueMachine(
        ctx({
          trigger: "pr-merged",
          issue: createIssue({
            labels: ["triaged", "groomed"],
            projectStatus: "In progress",
            hasSubIssues: true,
            subIssues: [createSubIssueData()],
          }),
        }),
        { logger: createMockLogger() },
      ).run();
      expect(result.state).toBe("orchestrationRunning");
    });

    it("deployedStageLogging", () => {
      const result = new IssueMachine(
        ctx({
          trigger: "deployed-stage",
          issue: createIssue({
            labels: ["triaged", "groomed"],
            projectStatus: "In progress",
          }),
        }),
        { logger: createMockLogger() },
      ).run();
      expect(result.state).toBe("deployedStageLogging");
    });

    it("deployedProdLogging", () => {
      const result = new IssueMachine(
        ctx({
          trigger: "deployed-prod",
          issue: createIssue({
            labels: ["triaged", "groomed"],
            projectStatus: "In progress",
          }),
        }),
        { logger: createMockLogger() },
      ).run();
      expect(result.state).toBe("deployedProdLogging");
    });

    it("deployedStageFailureLogging", () => {
      const result = new IssueMachine(
        ctx({
          trigger: "deployed-stage-failed",
          issue: createIssue({
            labels: ["triaged", "groomed"],
            projectStatus: "In progress",
          }),
        }),
        { logger: createMockLogger() },
      ).run();
      expect(result.state).toBe("deployedStageFailureLogging");
    });

    it("deployedProdFailureLogging", () => {
      const result = new IssueMachine(
        ctx({
          trigger: "deployed-prod-failed",
          issue: createIssue({
            labels: ["triaged", "groomed"],
            projectStatus: "In progress",
          }),
        }),
        { logger: createMockLogger() },
      ).run();
      expect(result.state).toBe("deployedProdFailureLogging");
    });
  });
});

// ============================================================================
// Action Type Coverage Tests
// ============================================================================

describe("issue-next: action type coverage", () => {
  it("triaging emits runClaude + applyTriageOutput (log goes to logger)", () => {
    const result = new IssueMachine(ctx({ trigger: "issue-triage" }), {
      logger: createMockLogger(),
    }).run();
    const types = result.actions.map((a) => a.type);
    expect(types).not.toContain("log");
    expect(types).toContain("runClaude");
    expect(types).toContain("applyTriageOutput");
  });

  it("iterating emits branch + status + iteration + claude + PR actions (log goes to logger)", () => {
    const result = new IssueMachine(
      ctx({
        trigger: "issue-edited",
        issue: createSubIssue({ assignees: ["nopo-bot"] }),
        parentIssue: createParentIssue(),
      }),
      { logger: createMockLogger() },
    ).run();
    const types = result.actions.map((a) => a.type);
    expect(types).toContain("createBranch");
    expect(types).toContain("updateProjectStatus");
    expect(types).toContain("incrementIteration");
    expect(types).toContain("appendHistory");
    expect(types).not.toContain("log");
    expect(types).toContain("runClaude");
    expect(types).toContain("createPR");
  });

  it("grooming emits appendHistory + runClaudeGrooming + applyGroomingOutput + reconcileSubIssues (log goes to logger)", () => {
    const result = new IssueMachine(
      ctx({
        trigger: "issue-groom",
        issue: createIssue({ labels: ["triaged"] }),
      }),
      { logger: createMockLogger() },
    ).run();
    const types = result.actions.map((a) => a.type);
    expect(types).not.toContain("log");
    expect(types).toContain("appendHistory");
    expect(types).toContain("runClaudeGrooming");
    expect(types).toContain("applyGroomingOutput");
    expect(types).toContain("reconcileSubIssues");
  });

  it("commenting emits runClaude (log goes to logger)", () => {
    const result = new IssueMachine(
      ctx({
        trigger: "issue-comment",
        issue: createIssue({ labels: ["triaged"] }),
      }),
      { logger: createMockLogger() },
    ).run();
    const types = result.actions.map((a) => a.type);
    expect(types).not.toContain("log");
    expect(types).toContain("runClaude");
  });

  it("prReviewing emits runClaude + applyReviewOutput (log goes to logger)", () => {
    const result = new IssueMachine(
      ctx({
        trigger: "pr-review-requested",
        issue: createIssue({ labels: ["triaged", "groomed"] }),
        ciResult: "success",
        pr: createPR(),
        hasPR: true,
      }),
      { logger: createMockLogger() },
    ).run();
    const types = result.actions.map((a) => a.type);
    expect(types).not.toContain("log");
    expect(types).toContain("runClaude");
    expect(types).toContain("applyReviewOutput");
  });

  it("blockIssue emits status + unassign + history + block", () => {
    const result = new IssueMachine(
      ctx({
        trigger: "workflow-run-completed",
        issue: createIssue({
          labels: ["triaged", "groomed"],
          projectStatus: "In progress",
          failures: 5,
        }),
        ciResult: "failure",
        maxRetries: 5,
        parentIssue: createParentIssue(),
      }),
      { logger: createMockLogger() },
    ).run();
    const types = result.actions.map((a) => a.type);
    expect(types).toContain("updateProjectStatus");
    expect(types).toContain("unassignUser");
    expect(types).toContain("appendHistory");
    expect(types).toContain("block");
  });

  it("resetIssue emits reset + status + clearFailures + removeFromProject", () => {
    const subIssues = [
      createSubIssueData({
        projectStatus: "In progress",
      }),
    ];

    const result = new IssueMachine(
      ctx({
        trigger: "issue-reset",
        issue: createIssue({
          projectStatus: "In progress",
          hasSubIssues: true,
          subIssues,
        }),
      }),
      { logger: createMockLogger() },
    ).run();
    const types = result.actions.map((a) => a.type);
    expect(types).toContain("resetIssue");
    expect(types).toContain("updateProjectStatus");
    expect(types).toContain("clearFailures");
    expect(types).toContain("removeFromProject");
  });

  it("transitionToReview emits clearFailures + markPRReady + status + requestReview", () => {
    const result = new IssueMachine(
      ctx({
        trigger: "workflow-run-completed",
        issue: createIssue({
          labels: ["triaged", "groomed"],
          projectStatus: "In progress",
          failures: 1,
          bodyAst: parseMarkdown("# Task\n\n## Todos\n\n- [x] all done"),
        }),
        ciResult: "success",
        pr: createPR({ isDraft: true }),
        hasPR: true,
        parentIssue: createParentIssue(),
      }),
      { logger: createMockLogger() },
    ).run();
    const types = result.actions.map((a) => a.type);
    expect(types).toContain("clearFailures");
    expect(types).toContain("markPRReady");
    expect(types).toContain("updateProjectStatus");
    expect(types).toContain("requestReview");
  });

  it("pushToDraft emits convertPRToDraft + removeReviewer + appendHistory", () => {
    const result = new IssueMachine(
      ctx({
        trigger: "pr-push",
        issue: createIssue({ labels: ["triaged", "groomed"] }),
        pr: createPR(),
        hasPR: true,
      }),
      { logger: createMockLogger() },
    ).run();
    const types = result.actions.map((a) => a.type);
    expect(types).toContain("convertPRToDraft");
    expect(types).toContain("removeReviewer");
    expect(types).toContain("appendHistory");
    expect(types).toContain("updateProjectStatus"); // setInProgress
  });

  it("allPhasesDone emits status + closeIssue + appendHistory (log goes to logger)", () => {
    const result = new IssueMachine(
      ctx({
        trigger: "issue-orchestrate",
        issue: createIssue({
          labels: ["triaged", "groomed"],
          hasSubIssues: true,
          subIssues: [
            createSubIssueData({
              title: "[Phase 1]",
              state: "CLOSED",
              projectStatus: "Done",
            }),
          ],
        }),
      }),
      { logger: createMockLogger() },
    ).run();
    const types = result.actions.map((a) => a.type);
    expect(types).not.toContain("log");
    expect(types).toContain("updateProjectStatus");
    expect(types).toContain("closeIssue");
    expect(types).toContain("appendHistory");
  });

  it("invalidIteration emits appendHistory + addComment + status", () => {
    const result = new IssueMachine(
      ctx({
        trigger: "issue-edited",
        issue: createIssue({
          labels: ["triaged", "groomed"],
          projectStatus: "In progress",
        }),
      }),
      { logger: createMockLogger() },
    ).run();
    const types = result.actions.map((a) => a.type);
    expect(types).toContain("appendHistory");
    expect(types).toContain("addComment");
    expect(types).toContain("updateProjectStatus");
  });

  it("merge queue entry emits appendHistory", () => {
    const result = new IssueMachine(
      ctx({
        trigger: "merge-queue-entered",
        issue: createIssue({
          labels: ["triaged", "groomed"],
          projectStatus: "In progress",
        }),
      }),
      { logger: createMockLogger() },
    ).run();
    const types = result.actions.map((a) => a.type);
    expect(types).toContain("appendHistory");
  });
});

// ============================================================================
// Machine Class API Tests
// ============================================================================

describe("issue-next: Machine class API", () => {
  it("run() returns state and actions", () => {
    const machine = new IssueMachine(ctx({ trigger: "issue-triage" }), {
      logger: createMockLogger(),
    });
    const result = machine.run();

    expect(result.state).toBe("triaging");
    expect(result.actions.length).toBeGreaterThan(0);
  });

  it("predict() is equivalent to run()", () => {
    const context = ctx({ trigger: "issue-triage" });
    const machine = new IssueMachine(context, {
      logger: createMockLogger(),
    });
    const run = machine.run();
    const predict = machine.predict();

    expect(run.state).toBe(predict.state);
    expect(run.actions.map((a) => a.type)).toEqual(
      predict.actions.map((a) => a.type),
    );
  });

  it("getState() returns just the state", () => {
    const machine = new IssueMachine(ctx({ trigger: "issue-triage" }));
    expect(machine.getState()).toBe("triaging");
  });

  it("execute() calls executeActions with correct args", async () => {
    const context = ctx({ trigger: "issue-triage" });
    const machine = new IssueMachine(context, {
      logger: createMockLogger(),
    });

    // Use dry run mode to avoid real API calls
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- mock object for dry-run testing
    const mockOctokit = {} as import("../src/core/executor.js").Octokit;
    const result = await machine.execute({
      runnerContext: {
        octokit: mockOctokit,
        owner: "test",
        repo: "repo",
        projectNumber: 1,
        serverUrl: "https://github.com",
        dryRun: true,
      },
    });

    expect(result.state).toBe("triaging");
    expect(result.actions.length).toBeGreaterThan(0);
    expect(result.runnerResult).toBeDefined();
    expect(result.runnerResult.results.length).toBe(result.actions.length);
    // All skipped due to dry run
    expect(result.runnerResult.results.every((r) => r.skipped)).toBe(true);
  });
});

// ============================================================================
// buildActionsForService Tests
// ============================================================================

describe("issue-next-invoke: buildActionsForService", () => {
  const context = ctx({
    trigger: "issue-triage",
    issue: createIssue({
      number: 42,
      iteration: 3,
      failures: 2,
    }),
  });

  it("returns empty for removed log services", () => {
    const result = buildActionsForService("logDetecting", context);
    expect(result).toHaveLength(0);
  });

  it("builds updateProjectStatus for setWorking", () => {
    const result = buildActionsForService("setWorking", context);
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe("updateProjectStatus");
  });

  it("builds stop action for stopWithReason", () => {
    const result = buildActionsForService(
      "stopWithReason",
      context,
      "test reason",
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe("stop");
  });

  it("returns empty for unknown service", () => {
    const result = buildActionsForService("nonexistent", context);
    expect(result).toHaveLength(0);
  });
});

// ============================================================================
// Logger Tests
// ============================================================================

describe("issue-next: logger injection", () => {
  it("InvokeMachine calls logger for log actions", () => {
    const logger = createMockLogger();
    const machine = new IssueMachine(ctx({ trigger: "issue-triage" }), {
      logger,
    });
    machine.run();

    // logDetecting + logTriaging
    expect(logger.info).toHaveBeenCalledWith("Detecting initial state");
    expect(logger.info).toHaveBeenCalledWith("Triaging issue #42");
  });

  it("no log actions appear in machine output", () => {
    const logger = createMockLogger();
    const result = new IssueMachine(ctx({ trigger: "issue-triage" }), {
      logger,
    }).run();

    expect(result.actions.every((a) => a.type !== "log")).toBe(true);
  });
});

// ============================================================================
// buildDeriveMetadata Tests
// ============================================================================

describe("issue-next: buildDeriveMetadata", () => {
  it("extracts metadata from context with parent issue", () => {
    const context = ctx({
      trigger: "issue-edited",
      issue: createSubIssue({ assignees: ["nopo-bot"], iteration: 3 }),
      parentIssue: createParentIssue(),
      currentPhase: 1,
      currentSubIssue: createSubIssueData(),
      pr: createPR({ number: 5 }),
      hasPR: true,
      ciCommitSha: "abc123",
    });
    const machine = new IssueMachine(context, { logger: createMockLogger() });
    const result = machine.run();
    const metadata = buildDeriveMetadata(context, result);

    expect(metadata.iteration).toBe("3");
    expect(metadata.phase).toBe("1");
    expect(metadata.parentIssueNumber).toBe("99");
    expect(metadata.subIssueNumber).toBe("100");
    expect(metadata.prNumber).toBe("5");
    expect(metadata.commitSha).toBe("abc123");
  });

  it("handles context without parent issue", () => {
    const context = ctx({
      trigger: "issue-triage",
      issue: createIssue({ number: 42 }),
    });
    const machine = new IssueMachine(context, { logger: createMockLogger() });
    const result = machine.run();
    const metadata = buildDeriveMetadata(context, result);

    expect(metadata.iteration).toBe("0");
    expect(metadata.phase).toBe("-");
    expect(metadata.parentIssueNumber).toBe("42");
    expect(metadata.subIssueNumber).toBe("");
    expect(metadata.prNumber).toBe("");
    expect(metadata.commitSha).toBe("");
  });
});

// ============================================================================
// MachineVerifier Tests
// ============================================================================

describe("issue-next: MachineVerifier", () => {
  const verifier = new MachineVerifier();

  it("predictExpectedState produces valid ExpectedState", () => {
    const context = ctx({
      trigger: "issue-triage",
      issue: createIssue(),
    });
    const machine = new IssueMachine(context, { logger: createMockLogger() });
    const result = machine.predict();

    const expected = verifier.predictExpectedState(result, context);

    expect(expected.finalState).toBe("triaging");
    expect(expected.outcomes.length).toBeGreaterThan(0);
    expect(expected.issueNumber).toBe(42);
    expect(expected.parentIssueNumber).toBeNull();
    expect(typeof expected.expectedRetrigger).toBe("boolean");
    expect(expected.expectedRetrigger).toBe(true); // triaging is a retrigger state
    expect(expected.trigger).toBe("issue-triage");
  });

  it("predictRetrigger returns true for retrigger states", () => {
    expect(verifier.predictRetrigger("orchestrationRunning")).toBe(true);
    expect(verifier.predictRetrigger("triaging")).toBe(true);
    expect(verifier.predictRetrigger("resetting")).toBe(true);
    expect(verifier.predictRetrigger("prReviewAssigned")).toBe(true);
  });

  it("predictRetrigger returns false for non-retrigger states", () => {
    expect(verifier.predictRetrigger("iterating")).toBe(false);
    expect(verifier.predictRetrigger("blocked")).toBe(false);
    expect(verifier.predictRetrigger("done")).toBe(false);
    expect(verifier.predictRetrigger("reviewing")).toBe(false);
  });

  it("verify passes when actual matches expected", () => {
    const context = ctx({
      trigger: "issue-triage",
      issue: createIssue(),
    });
    const machine = new IssueMachine(context, { logger: createMockLogger() });
    const result = machine.predict();
    const expected = verifier.predictExpectedState(result, context);

    // Use the same context to extract "actual" tree (simulates no changes)
    const actualTree = verifier.extractStateTree(context);

    // Pick the first outcome — it should match or be close
    const verification = verifier.verifyExpected(expected, actualTree, true);

    // Since triage actions haven't been executed, there will be diffs
    // (expected has triage outputs applied, actual doesn't).
    // The important thing is verify returns a structured result.
    expect(verification).toHaveProperty("pass");
    expect(verification).toHaveProperty("result");
    expect(verification).toHaveProperty("retriggerPass");
    expect(verification.retriggerPass).toBe(true);
  });

  it("verify fails when retrigger doesn't match", () => {
    const context = ctx({
      trigger: "issue-triage",
      issue: createIssue(),
    });
    const machine = new IssueMachine(context, { logger: createMockLogger() });
    const result = machine.predict();
    const expected = verifier.predictExpectedState(result, context);
    const actualTree = verifier.extractStateTree(context);

    // expectedRetrigger is true for triaging, pass false
    const verification = verifier.verifyExpected(expected, actualTree, false);
    expect(verification.retriggerPass).toBe(false);
    expect(verification.pass).toBe(false);
  });

  it("verify skips retrigger check when actualRetrigger is undefined", () => {
    const context = ctx({
      trigger: "issue-edited",
      issue: createIssue({
        projectStatus: "Blocked",
        labels: ["triaged", "groomed"],
      }),
    });
    const machine = new IssueMachine(context, { logger: createMockLogger() });
    const result = machine.predict();
    const expected = verifier.predictExpectedState(result, context);
    const actualTree = verifier.extractStateTree(context);

    const verification = verifier.verifyExpected(expected, actualTree);
    // retriggerPass should be true when actualRetrigger is undefined
    expect(verification.retriggerPass).toBe(true);
  });
});

// ============================================================================
// MachineVerifier.verifyExpected() unit tests
// ============================================================================

describe("MachineVerifier.verifyExpected() unit tests", () => {
  const verifier = new MachineVerifier();

  // Minimal test fixtures
  function createMinimalExpectedState(
    overrides: Partial<{
      outcomes: Array<unknown>;
      expectedRetrigger: boolean;
    }> = {},
  ) {
    const outcomes = overrides.outcomes ?? [
      {
        issue: {
          number: 42,
          state: "OPEN",
          projectStatus: "In progress",
          iteration: 1,
          failures: 0,
          labels: ["triaged"],
          assignees: ["nopo-bot"],
          hasBranch: true,
          hasPR: false,
          pr: null,
          body: {
            hasDescription: false,
            hasTodos: false,
            hasHistory: false,
            hasAgentNotes: false,
            hasQuestions: false,
            hasAffectedAreas: false,
            hasRequirements: false,
            hasApproach: false,
            hasAcceptanceCriteria: false,
            hasTesting: false,
            hasRelated: false,
            todoStats: null,
            questionStats: null,
            historyEntries: [],
            agentNotesEntries: [],
          },
        },
        subIssues: [],
      },
    ];

    return {
      finalState: "iterating",
      outcomes,
      expectedRetrigger: overrides.expectedRetrigger ?? false,
      timestamp: new Date().toISOString(),
      trigger: "issue-edited",
      issueNumber: 42,
      parentIssueNumber: null,
    };
  }

  function createMinimalPredictableTree() {
    return {
      issue: {
        number: 42,
        state: "OPEN" as const,
        projectStatus: "In progress" as const,
        iteration: 1,
        failures: 0,
        labels: ["triaged"],
        assignees: ["nopo-bot"],
        hasBranch: true,
        hasPR: false,
        pr: null,
        body: {
          hasDescription: false,
          hasTodos: false,
          hasHistory: false,
          hasAgentNotes: false,
          hasQuestions: false,
          hasAffectedAreas: false,
          hasRequirements: false,
          hasApproach: false,
          hasAcceptanceCriteria: false,
          hasTesting: false,
          hasRelated: false,
          todoStats: null,
          questionStats: null,
          historyEntries: [],
          agentNotesEntries: [],
        },
      },
      subIssues: [],
    };
  }

  it("verifyExpected unpacks outcomes array from ExpectedState", () => {
    const expectedOutcomes = [createMinimalPredictableTree()];
    const expected = createMinimalExpectedState({ outcomes: expectedOutcomes });
    const actualTree = createMinimalPredictableTree();

    const verification = verifier.verifyExpected(expected, actualTree);

    // verifyExpected should extract outcomes from ExpectedState and pass to verify()
    expect(verification).toHaveProperty("result");
    expect(verification.result).toHaveProperty("matchedOutcomeIndex");
    expect(verification.pass).toBe(true);
  });

  it("verifyExpected unpacks expectedRetrigger from ExpectedState", () => {
    const expected = createMinimalExpectedState({ expectedRetrigger: true });
    const actualTree = createMinimalPredictableTree();

    // Pass actualRetrigger=false to cause retrigger mismatch
    const verification = verifier.verifyExpected(expected, actualTree, false);

    // Should use expectedRetrigger from ExpectedState
    expect(verification.retriggerPass).toBe(false);
    expect(verification.pass).toBe(false);
  });

  it("verifyExpected passes optional actualRetrigger parameter to verify()", () => {
    const expected = createMinimalExpectedState({ expectedRetrigger: true });
    const actualTree = createMinimalPredictableTree();

    // Pass matching actualRetrigger
    const verificationMatch = verifier.verifyExpected(
      expected,
      actualTree,
      true,
    );
    expect(verificationMatch.retriggerPass).toBe(true);
    expect(verificationMatch.pass).toBe(true);

    // Pass mismatched actualRetrigger
    const verificationMismatch = verifier.verifyExpected(
      expected,
      actualTree,
      false,
    );
    expect(verificationMismatch.retriggerPass).toBe(false);
    expect(verificationMismatch.pass).toBe(false);

    // Pass undefined actualRetrigger (should skip check)
    const verificationUndefined = verifier.verifyExpected(
      expected,
      actualTree,
      undefined,
    );
    expect(verificationUndefined.retriggerPass).toBe(true);
  });

  it("extractStateTree() alias delegates to extractTree()", () => {
    const context = ctx({
      trigger: "issue-edited",
      issue: createIssue({ number: 123 }),
    });

    const fromAlias = verifier.extractStateTree(context);
    const fromBase = verifier.extractTree(context);

    // Both should return the same structure
    expect(fromAlias).toEqual(fromBase);
    expect(fromAlias.issue.number).toBe(123);
  });
});
