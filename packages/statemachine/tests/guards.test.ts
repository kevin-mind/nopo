import { describe, it, expect } from "vitest";
import { parseMarkdown } from "@more/issue-state";
import { createMachineContext } from "../src/index.js";
import * as guards from "../src/machine/guards.js";
import type { MachineContext } from "../src/schemas/index.js";
import { ParentIssueSchema } from "../src/schemas/index.js";

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Create a basic triage context (parent issue, not triaged/groomed)
 */
function createTriageContext(
  overrides: Partial<MachineContext> = {},
): MachineContext {
  const issue = ParentIssueSchema.parse({
    number: 42,
    title: "Test Issue",
    state: "OPEN",
    bodyAst: parseMarkdown("## Todo\n\n- [ ] item 1"),
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
  });

  return createMachineContext({
    trigger: "issue-triage",
    owner: "test-owner",
    repo: "test-repo",
    issue,
    ...overrides,
  });
}

/**
 * Create a sub-issue context (has parent issue)
 */
function createSubIssueContext(
  overrides: Partial<MachineContext> = {},
): MachineContext {
  const issue = ParentIssueSchema.parse({
    number: 100,
    title: "[Phase 1]: Implementation",
    state: "OPEN",
    bodyAst: parseMarkdown("## Todo\n\n- [ ] implement feature"),
    projectStatus: null,
    iteration: 0,
    failures: 0,
    assignees: [],
    labels: ["triaged", "groomed"],
    subIssues: [],
    hasSubIssues: false,
    comments: [],
    branch: null,
    pr: null,
    parentIssueNumber: 99,
  });

  const parentIssue = ParentIssueSchema.parse({
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
  });

  return createMachineContext({
    trigger: "issue-edited",
    owner: "test-owner",
    repo: "test-repo",
    issue,
    parentIssue,
    ...overrides,
  });
}

// ============================================================================
// Terminal State Guards
// ============================================================================

describe("Terminal State Guards", () => {
  describe("isAlreadyDone", () => {
    it("returns true when status is Done AND PR is merged", () => {
      const context = createTriageContext({
        issue: ParentIssueSchema.parse({
          ...createTriageContext().issue,
          projectStatus: "Done",
        }),
        pr: {
          state: "MERGED",
          isDraft: false,
          number: 1,
          title: "Test PR",
          headRef: "test-branch",
          baseRef: "main",
          labels: [],
          reviews: [],
        },
      });
      expect(guards.isAlreadyDone({ context })).toBe(true);
    });

    it("returns false when status is Done but PR is not merged", () => {
      const context = createTriageContext({
        issue: ParentIssueSchema.parse({
          ...createTriageContext().issue,
          projectStatus: "Done",
        }),
        pr: {
          state: "OPEN",
          isDraft: false,
          number: 1,
          title: "Test PR",
          headRef: "test-branch",
          baseRef: "main",
          labels: [],
          reviews: [],
        },
      });
      expect(guards.isAlreadyDone({ context })).toBe(false);
    });

    it("returns false when PR is merged but status is not Done", () => {
      const context = createTriageContext({
        issue: ParentIssueSchema.parse({
          ...createTriageContext().issue,
          projectStatus: "In progress",
        }),
        pr: {
          state: "MERGED",
          isDraft: false,
          number: 1,
          title: "Test PR",
          headRef: "test-branch",
          baseRef: "main",
          labels: [],
          reviews: [],
        },
      });
      expect(guards.isAlreadyDone({ context })).toBe(false);
    });

    it("returns false when no PR exists", () => {
      const context = createTriageContext({
        issue: ParentIssueSchema.parse({
          ...createTriageContext().issue,
          projectStatus: "Done",
        }),
        pr: null,
      });
      expect(guards.isAlreadyDone({ context })).toBe(false);
    });
  });

  describe("isBlocked", () => {
    it("returns true when status is Blocked", () => {
      const context = createTriageContext({
        issue: ParentIssueSchema.parse({
          ...createTriageContext().issue,
          projectStatus: "Blocked",
        }),
      });
      expect(guards.isBlocked({ context })).toBe(true);
    });

    it("returns false when status is not Blocked", () => {
      const context = createTriageContext();
      expect(guards.isBlocked({ context })).toBe(false);
    });
  });

  describe("isError", () => {
    it("returns true when status is Error", () => {
      const context = createTriageContext({
        issue: ParentIssueSchema.parse({
          ...createTriageContext().issue,
          projectStatus: "Error",
        }),
      });
      expect(guards.isError({ context })).toBe(true);
    });

    it("returns false when status is not Error", () => {
      const context = createTriageContext();
      expect(guards.isError({ context })).toBe(false);
    });
  });

  describe("isTerminal", () => {
    it("returns true for Done status", () => {
      const context = createTriageContext({
        issue: ParentIssueSchema.parse({
          ...createTriageContext().issue,
          projectStatus: "Done",
        }),
      });
      expect(guards.isTerminal({ context })).toBe(true);
    });

    it("returns true for Blocked status", () => {
      const context = createTriageContext({
        issue: ParentIssueSchema.parse({
          ...createTriageContext().issue,
          projectStatus: "Blocked",
        }),
      });
      expect(guards.isTerminal({ context })).toBe(true);
    });

    it("returns true for Error status", () => {
      const context = createTriageContext({
        issue: ParentIssueSchema.parse({
          ...createTriageContext().issue,
          projectStatus: "Error",
        }),
      });
      expect(guards.isTerminal({ context })).toBe(true);
    });

    it("returns false for non-terminal statuses", () => {
      const context = createTriageContext({
        issue: ParentIssueSchema.parse({
          ...createTriageContext().issue,
          projectStatus: "In progress",
        }),
      });
      expect(guards.isTerminal({ context })).toBe(false);
    });

    it("returns false when status is null", () => {
      const context = createTriageContext({
        issue: ParentIssueSchema.parse({
          ...createTriageContext().issue,
          projectStatus: null,
        }),
      });
      expect(guards.isTerminal({ context })).toBe(false);
    });
  });
});

// ============================================================================
// Sub-Issue Guards
// ============================================================================

describe("Sub-Issue Guards", () => {
  describe("hasSubIssues", () => {
    it("returns true when issue has sub-issues", () => {
      const context = createTriageContext({
        issue: ParentIssueSchema.parse({
          ...createTriageContext().issue,
          hasSubIssues: true,
        }),
      });
      expect(guards.hasSubIssues({ context })).toBe(true);
    });

    it("returns false when issue has no sub-issues", () => {
      const context = createTriageContext();
      expect(guards.hasSubIssues({ context })).toBe(false);
    });
  });

  describe("isSubIssue", () => {
    it("returns true when issue has a parent", () => {
      const context = createSubIssueContext();
      expect(guards.isSubIssue({ context })).toBe(true);
    });

    it("returns false when issue has no parent", () => {
      const context = createTriageContext();
      expect(guards.isSubIssue({ context })).toBe(false);
    });
  });

  describe("subIssueCanIterate", () => {
    it("returns true when bot is assigned to both sub-issue and parent", () => {
      const context = createSubIssueContext({
        issue: ParentIssueSchema.parse({
          ...createSubIssueContext().issue,
          assignees: ["nopo-bot"],
        }),
      });
      expect(guards.subIssueCanIterate({ context })).toBe(true);
    });

    it("returns false when bot is not assigned to sub-issue", () => {
      const context = createSubIssueContext();
      expect(guards.subIssueCanIterate({ context })).toBe(false);
    });

    it("returns false when bot is not assigned to parent", () => {
      const context = createSubIssueContext({
        issue: ParentIssueSchema.parse({
          ...createSubIssueContext().issue,
          assignees: ["nopo-bot"],
        }),
        parentIssue: ParentIssueSchema.parse({
          ...createSubIssueContext().parentIssue!,
          assignees: [],
        }),
      });
      expect(guards.subIssueCanIterate({ context })).toBe(false);
    });

    it("returns false when there is no parent issue", () => {
      const context = createTriageContext();
      expect(guards.subIssueCanIterate({ context })).toBe(false);
    });
  });

  describe("needsSubIssues", () => {
    it("returns false (placeholder implementation)", () => {
      const context = createTriageContext();
      expect(guards.needsSubIssues({ context })).toBe(false);
    });
  });

  describe("allPhasesDone", () => {
    it("returns true when groomed and all sub-issues are Done", () => {
      const context = createTriageContext({
        issue: ParentIssueSchema.parse({
          ...createTriageContext().issue,
          labels: ["groomed"],
          subIssues: [
            {
              number: 1,
              title: "Phase 1",
              projectStatus: "Done",
              state: "OPEN",
              bodyAst: parseMarkdown("# Phase 1"),
              assignees: [],
              labels: [],
              branch: null,
              pr: null,
            },
            {
              number: 2,
              title: "Phase 2",
              projectStatus: "Done",
              state: "OPEN",
              bodyAst: parseMarkdown("# Phase 2"),
              assignees: [],
              labels: [],
              branch: null,
              pr: null,
            },
          ],
        }),
      });
      expect(guards.allPhasesDone({ context })).toBe(true);
    });

    it("returns true when groomed and all sub-issues are CLOSED", () => {
      const context = createTriageContext({
        issue: ParentIssueSchema.parse({
          ...createTriageContext().issue,
          labels: ["groomed"],
          subIssues: [
            {
              number: 1,
              title: "Phase 1",
              projectStatus: null,
              state: "CLOSED",
              bodyAst: parseMarkdown("# Phase 1"),
              assignees: [],
              labels: [],
              branch: null,
              pr: null,
            },
            {
              number: 2,
              title: "Phase 2",
              projectStatus: null,
              state: "CLOSED",
              bodyAst: parseMarkdown("# Phase 2"),
              assignees: [],
              labels: [],
              branch: null,
              pr: null,
            },
          ],
        }),
      });
      expect(guards.allPhasesDone({ context })).toBe(true);
    });

    it("returns false when not groomed", () => {
      const context = createTriageContext({
        issue: ParentIssueSchema.parse({
          ...createTriageContext().issue,
          subIssues: [
            {
              number: 1,
              title: "Phase 1",
              projectStatus: "Done",
              state: "OPEN",
              bodyAst: parseMarkdown("# Phase 1"),
              assignees: [],
              labels: [],
              branch: null,
              pr: null,
            },
          ],
        }),
      });
      expect(guards.allPhasesDone({ context })).toBe(false);
    });

    it("returns false when no sub-issues exist", () => {
      const context = createTriageContext({
        issue: ParentIssueSchema.parse({
          ...createTriageContext().issue,
          labels: ["groomed"],
          subIssues: [],
        }),
      });
      expect(guards.allPhasesDone({ context })).toBe(false);
    });

    it("returns false when some sub-issues are not done", () => {
      const context = createTriageContext({
        issue: ParentIssueSchema.parse({
          ...createTriageContext().issue,
          labels: ["groomed"],
          subIssues: [
            {
              number: 1,
              title: "Phase 1",
              projectStatus: "Done",
              state: "OPEN",
              bodyAst: parseMarkdown("# Phase 1"),
              assignees: [],
              labels: [],
              branch: null,
              pr: null,
            },
            {
              number: 2,
              title: "Phase 2",
              projectStatus: "In progress",
              state: "OPEN",
              bodyAst: parseMarkdown("# Phase 2"),
              assignees: [],
              labels: [],
              branch: null,
              pr: null,
            },
          ],
        }),
      });
      expect(guards.allPhasesDone({ context })).toBe(false);
    });
  });
});

// ============================================================================
// CI Guards
// ============================================================================

describe("CI Guards", () => {
  describe("ciPassed", () => {
    it("returns true when ciResult is success", () => {
      const context = createTriageContext({ ciResult: "success" });
      expect(guards.ciPassed({ context })).toBe(true);
    });

    it("returns false when ciResult is not success", () => {
      const context = createTriageContext({ ciResult: "failure" });
      expect(guards.ciPassed({ context })).toBe(false);
    });

    it("returns false when ciResult is skipped", () => {
      const context = createTriageContext({ ciResult: "skipped" });
      expect(guards.ciPassed({ context })).toBe(false);
    });
  });

  describe("ciFailed", () => {
    it("returns true when ciResult is failure", () => {
      const context = createTriageContext({ ciResult: "failure" });
      expect(guards.ciFailed({ context })).toBe(true);
    });

    it("returns false when ciResult is not failure", () => {
      const context = createTriageContext({ ciResult: "success" });
      expect(guards.ciFailed({ context })).toBe(false);
    });
  });

  describe("ciCancelled", () => {
    it("returns true when ciResult is cancelled", () => {
      const context = createTriageContext({ ciResult: "cancelled" });
      expect(guards.ciCancelled({ context })).toBe(true);
    });

    it("returns false when ciResult is not cancelled", () => {
      const context = createTriageContext({ ciResult: "success" });
      expect(guards.ciCancelled({ context })).toBe(false);
    });
  });
});

// ============================================================================
// Assignment Guards
// ============================================================================

describe("Assignment Guards", () => {
  describe("botIsAssigned", () => {
    it("returns true when bot is in assignees", () => {
      const context = createTriageContext({
        issue: ParentIssueSchema.parse({
          ...createTriageContext().issue,
          assignees: ["nopo-bot", "other-user"],
        }),
      });
      expect(guards.botIsAssigned({ context })).toBe(true);
    });

    it("returns false when bot is not in assignees", () => {
      const context = createTriageContext();
      expect(guards.botIsAssigned({ context })).toBe(false);
    });
  });

  describe("isFirstIteration", () => {
    it("returns true when iteration is 0", () => {
      const context = createTriageContext();
      expect(guards.isFirstIteration({ context })).toBe(true);
    });

    it("returns false when iteration is > 0", () => {
      const context = createTriageContext({
        issue: ParentIssueSchema.parse({
          ...createTriageContext().issue,
          iteration: 5,
        }),
      });
      expect(guards.isFirstIteration({ context })).toBe(false);
    });
  });
});

// ============================================================================
// Orchestration Guards
// ============================================================================

describe("Orchestration Guards", () => {
  describe("needsParentInit", () => {
    it("returns true when issue has sub-issues and status is Backlog", () => {
      const context = createTriageContext({
        issue: ParentIssueSchema.parse({
          ...createTriageContext().issue,
          hasSubIssues: true,
          projectStatus: "Backlog",
        }),
      });
      expect(guards.needsParentInit({ context })).toBe(true);
    });

    it("returns true when issue has sub-issues and status is null", () => {
      const context = createTriageContext({
        issue: ParentIssueSchema.parse({
          ...createTriageContext().issue,
          hasSubIssues: true,
          projectStatus: null,
        }),
      });
      expect(guards.needsParentInit({ context })).toBe(true);
    });

    it("returns false when issue has no sub-issues", () => {
      const context = createTriageContext();
      expect(guards.needsParentInit({ context })).toBe(false);
    });

    it("returns false when status is not Backlog or null", () => {
      const context = createTriageContext({
        issue: ParentIssueSchema.parse({
          ...createTriageContext().issue,
          hasSubIssues: true,
          projectStatus: "In progress",
        }),
      });
      expect(guards.needsParentInit({ context })).toBe(false);
    });
  });

  describe("currentPhaseComplete", () => {
    it("returns true when current sub-issue has no unchecked non-manual todos", () => {
      const context = createSubIssueContext({
        currentSubIssue: ParentIssueSchema.parse({
          ...createSubIssueContext().issue,
          bodyAst: parseMarkdown(
            "## Todo\n\n- [x] done item\n- [ ] [Manual] test",
          ),
        }),
      });
      expect(guards.currentPhaseComplete({ context })).toBe(true);
    });

    it("returns false when current sub-issue has unchecked non-manual todos", () => {
      const context = createSubIssueContext({
        currentSubIssue: ParentIssueSchema.parse({
          ...createSubIssueContext().issue,
          bodyAst: parseMarkdown("## Todo\n\n- [ ] todo item"),
        }),
      });
      expect(guards.currentPhaseComplete({ context })).toBe(false);
    });

    it("returns false when no current sub-issue", () => {
      const context = createTriageContext();
      expect(guards.currentPhaseComplete({ context })).toBe(false);
    });
  });

  describe("hasNextPhase", () => {
    it("returns true when current phase is less than total phases", () => {
      const context = createTriageContext({
        issue: ParentIssueSchema.parse({
          ...createTriageContext().issue,
          hasSubIssues: true,
        }),
        currentPhase: 1,
        totalPhases: 3,
      });
      expect(guards.hasNextPhase({ context })).toBe(true);
    });

    it("returns false when current phase equals total phases", () => {
      const context = createTriageContext({
        issue: ParentIssueSchema.parse({
          ...createTriageContext().issue,
          hasSubIssues: true,
        }),
        currentPhase: 3,
        totalPhases: 3,
      });
      expect(guards.hasNextPhase({ context })).toBe(false);
    });

    it("returns false when no sub-issues", () => {
      const context = createTriageContext({
        currentPhase: 1,
        totalPhases: 3,
      });
      expect(guards.hasNextPhase({ context })).toBe(false);
    });

    it("returns false when current phase is null", () => {
      const context = createTriageContext({
        issue: ParentIssueSchema.parse({
          ...createTriageContext().issue,
          hasSubIssues: true,
        }),
        currentPhase: null,
        totalPhases: 3,
      });
      expect(guards.hasNextPhase({ context })).toBe(false);
    });
  });

  describe("subIssueNeedsAssignment", () => {
    it("returns true when current sub-issue exists", () => {
      const context = createSubIssueContext({
        currentSubIssue: ParentIssueSchema.parse({
          ...createSubIssueContext().issue,
        }),
      });
      expect(guards.subIssueNeedsAssignment({ context })).toBe(true);
    });

    it("returns false when no current sub-issue", () => {
      const context = createTriageContext();
      expect(guards.subIssueNeedsAssignment({ context })).toBe(false);
    });
  });
});

// ============================================================================
// Phase State Guards
// ============================================================================

describe("Phase State Guards", () => {
  describe("isInReview", () => {
    it("returns true when current sub-issue status is 'In review'", () => {
      const context = createSubIssueContext({
        currentSubIssue: ParentIssueSchema.parse({
          ...createSubIssueContext().issue,
          projectStatus: "In review",
        }),
      });
      expect(guards.isInReview({ context })).toBe(true);
    });

    it("returns true when issue status is 'In review' (no sub-issue)", () => {
      const context = createTriageContext({
        issue: ParentIssueSchema.parse({
          ...createTriageContext().issue,
          projectStatus: "In review",
        }),
      });
      expect(guards.isInReview({ context })).toBe(true);
    });

    it("returns false when status is not 'In review'", () => {
      const context = createTriageContext({
        issue: ParentIssueSchema.parse({
          ...createTriageContext().issue,
          projectStatus: "In progress",
        }),
      });
      expect(guards.isInReview({ context })).toBe(false);
    });
  });

  describe("currentPhaseNeedsWork", () => {
    it("returns true when current sub-issue status is 'In progress'", () => {
      const context = createSubIssueContext({
        currentSubIssue: ParentIssueSchema.parse({
          ...createSubIssueContext().issue,
          projectStatus: "In progress",
        }),
      });
      expect(guards.currentPhaseNeedsWork({ context })).toBe(true);
    });

    it("returns true when current sub-issue status is null", () => {
      const context = createSubIssueContext({
        currentSubIssue: ParentIssueSchema.parse({
          ...createSubIssueContext().issue,
          projectStatus: null,
        }),
      });
      expect(guards.currentPhaseNeedsWork({ context })).toBe(true);
    });

    it("returns false when current sub-issue status is Done", () => {
      const context = createSubIssueContext({
        currentSubIssue: ParentIssueSchema.parse({
          ...createSubIssueContext().issue,
          projectStatus: "Done",
        }),
      });
      expect(guards.currentPhaseNeedsWork({ context })).toBe(false);
    });

    it("returns true when issue status is 'In progress' (no sub-issue)", () => {
      const context = createTriageContext({
        issue: ParentIssueSchema.parse({
          ...createTriageContext().issue,
          projectStatus: "In progress",
        }),
      });
      expect(guards.currentPhaseNeedsWork({ context })).toBe(true);
    });
  });

  describe("currentPhaseInReview", () => {
    it("delegates to isInReview", () => {
      const context = createSubIssueContext({
        currentSubIssue: ParentIssueSchema.parse({
          ...createSubIssueContext().issue,
          projectStatus: "In review",
        }),
      });
      expect(guards.currentPhaseInReview({ context })).toBe(true);
      expect(guards.currentPhaseInReview({ context })).toBe(
        guards.isInReview({ context }),
      );
    });
  });
});

// ============================================================================
// Todo Guards
// ============================================================================

describe("Todo Guards", () => {
  describe("todosDone", () => {
    it("returns true when all non-manual todos are checked in current sub-issue", () => {
      const context = createSubIssueContext({
        currentSubIssue: ParentIssueSchema.parse({
          ...createSubIssueContext().issue,
          bodyAst: parseMarkdown(
            "## Todo\n\n- [x] done\n- [ ] [Manual] manual task",
          ),
        }),
      });
      expect(guards.todosDone({ context })).toBe(true);
    });

    it("returns false when there are unchecked non-manual todos in current sub-issue", () => {
      const context = createSubIssueContext({
        currentSubIssue: ParentIssueSchema.parse({
          ...createSubIssueContext().issue,
          bodyAst: parseMarkdown("## Todo\n\n- [ ] todo item"),
        }),
      });
      expect(guards.todosDone({ context })).toBe(false);
    });

    it("returns true when all non-manual todos are checked in issue (no sub-issue)", () => {
      const context = createTriageContext({
        issue: ParentIssueSchema.parse({
          ...createTriageContext().issue,
          bodyAst: parseMarkdown(
            "## Todo\n\n- [x] done\n- [ ] [Manual] manual task",
          ),
        }),
      });
      expect(guards.todosDone({ context })).toBe(true);
    });

    it("returns false when there are unchecked non-manual todos in issue (no sub-issue)", () => {
      const context = createTriageContext({
        issue: ParentIssueSchema.parse({
          ...createTriageContext().issue,
          bodyAst: parseMarkdown("## Todo\n\n- [ ] todo item"),
        }),
      });
      expect(guards.todosDone({ context })).toBe(false);
    });
  });

  describe("hasPendingTodos", () => {
    it("returns true when there are unchecked non-manual todos", () => {
      const context = createTriageContext({
        issue: ParentIssueSchema.parse({
          ...createTriageContext().issue,
          bodyAst: parseMarkdown("## Todo\n\n- [ ] todo item"),
        }),
      });
      expect(guards.hasPendingTodos({ context })).toBe(true);
    });

    it("returns false when all non-manual todos are done", () => {
      const context = createTriageContext({
        issue: ParentIssueSchema.parse({
          ...createTriageContext().issue,
          bodyAst: parseMarkdown("## Todo\n\n- [x] done"),
        }),
      });
      expect(guards.hasPendingTodos({ context })).toBe(false);
    });
  });
});

// ============================================================================
// Failure Guards
// ============================================================================

describe("Failure Guards", () => {
  describe("maxFailuresReached", () => {
    it("returns true when failures equals maxRetries", () => {
      const context = createTriageContext({
        issue: ParentIssueSchema.parse({
          ...createTriageContext().issue,
          failures: 5,
        }),
        maxRetries: 5,
      });
      expect(guards.maxFailuresReached({ context })).toBe(true);
    });

    it("returns true when failures exceeds maxRetries", () => {
      const context = createTriageContext({
        issue: ParentIssueSchema.parse({
          ...createTriageContext().issue,
          failures: 10,
        }),
        maxRetries: 5,
      });
      expect(guards.maxFailuresReached({ context })).toBe(true);
    });

    it("returns false when failures is below maxRetries", () => {
      const context = createTriageContext({
        issue: ParentIssueSchema.parse({
          ...createTriageContext().issue,
          failures: 3,
        }),
        maxRetries: 5,
      });
      expect(guards.maxFailuresReached({ context })).toBe(false);
    });

    it("returns false when failures is 0", () => {
      const context = createTriageContext({
        maxRetries: 5,
      });
      expect(guards.maxFailuresReached({ context })).toBe(false);
    });
  });

  describe("hasFailures", () => {
    it("returns true when failures > 0", () => {
      const context = createTriageContext({
        issue: ParentIssueSchema.parse({
          ...createTriageContext().issue,
          failures: 1,
        }),
      });
      expect(guards.hasFailures({ context })).toBe(true);
    });

    it("returns false when failures is 0", () => {
      const context = createTriageContext();
      expect(guards.hasFailures({ context })).toBe(false);
    });
  });
});

// ============================================================================
// Review Guards
// ============================================================================

describe("Review Guards", () => {
  describe("reviewApproved", () => {
    it("returns true when reviewDecision is APPROVED", () => {
      const context = createTriageContext({ reviewDecision: "APPROVED" });
      expect(guards.reviewApproved({ context })).toBe(true);
    });

    it("returns false when reviewDecision is not APPROVED", () => {
      const context = createTriageContext({
        reviewDecision: "CHANGES_REQUESTED",
      });
      expect(guards.reviewApproved({ context })).toBe(false);
    });
  });

  describe("reviewRequestedChanges", () => {
    it("returns true when reviewDecision is CHANGES_REQUESTED", () => {
      const context = createTriageContext({
        reviewDecision: "CHANGES_REQUESTED",
      });
      expect(guards.reviewRequestedChanges({ context })).toBe(true);
    });

    it("returns false when reviewDecision is not CHANGES_REQUESTED", () => {
      const context = createTriageContext({ reviewDecision: "APPROVED" });
      expect(guards.reviewRequestedChanges({ context })).toBe(false);
    });
  });

  describe("reviewCommented", () => {
    it("returns true when reviewDecision is COMMENTED", () => {
      const context = createTriageContext({ reviewDecision: "COMMENTED" });
      expect(guards.reviewCommented({ context })).toBe(true);
    });

    it("returns false when reviewDecision is not COMMENTED", () => {
      const context = createTriageContext({ reviewDecision: "APPROVED" });
      expect(guards.reviewCommented({ context })).toBe(false);
    });
  });
});

// ============================================================================
// PR Guards
// ============================================================================

describe("PR Guards", () => {
  describe("hasPR", () => {
    it("returns true when hasPR is true and pr is not null", () => {
      const context = createTriageContext({
        hasPR: true,
        pr: {
          state: "OPEN",
          isDraft: false,
          number: 1,
          title: "Test PR",
          headRef: "test-branch",
          baseRef: "main",
          labels: [],
          reviews: [],
        },
      });
      expect(guards.hasPR({ context })).toBe(true);
    });

    it("returns false when hasPR is false", () => {
      const context = createTriageContext({ hasPR: false, pr: null });
      expect(guards.hasPR({ context })).toBe(false);
    });

    it("returns false when pr is null", () => {
      const context = createTriageContext({ hasPR: true, pr: null });
      expect(guards.hasPR({ context })).toBe(false);
    });
  });

  describe("prIsDraft", () => {
    it("returns true when PR is draft", () => {
      const context = createTriageContext({
        pr: {
          state: "OPEN",
          isDraft: true,
          number: 1,
          title: "Test PR",
          headRef: "test-branch",
          baseRef: "main",
          labels: [],
          reviews: [],
        },
      });
      expect(guards.prIsDraft({ context })).toBe(true);
    });

    it("returns false when PR is not draft", () => {
      const context = createTriageContext({
        pr: {
          state: "OPEN",
          isDraft: false,
          number: 1,
          title: "Test PR",
          headRef: "test-branch",
          baseRef: "main",
          labels: [],
          reviews: [],
        },
      });
      expect(guards.prIsDraft({ context })).toBe(false);
    });

    it("returns false when PR is null", () => {
      const context = createTriageContext({ pr: null });
      expect(guards.prIsDraft({ context })).toBe(false);
    });
  });

  describe("prIsReady", () => {
    it("returns true when PR exists and is not draft", () => {
      const context = createTriageContext({
        pr: {
          state: "OPEN",
          isDraft: false,
          number: 1,
          title: "Test PR",
          headRef: "test-branch",
          baseRef: "main",
          labels: [],
          reviews: [],
        },
      });
      expect(guards.prIsReady({ context })).toBe(true);
    });

    it("returns false when PR is draft", () => {
      const context = createTriageContext({
        pr: {
          state: "OPEN",
          isDraft: true,
          number: 1,
          title: "Test PR",
          headRef: "test-branch",
          baseRef: "main",
          labels: [],
          reviews: [],
        },
      });
      expect(guards.prIsReady({ context })).toBe(false);
    });

    it("returns false when PR is null", () => {
      const context = createTriageContext({ pr: null });
      expect(guards.prIsReady({ context })).toBe(false);
    });
  });

  describe("prIsMerged", () => {
    it("returns true when PR state is MERGED", () => {
      const context = createTriageContext({
        pr: {
          state: "MERGED",
          isDraft: false,
          number: 1,
          title: "Test PR",
          headRef: "test-branch",
          baseRef: "main",
          labels: [],
          reviews: [],
        },
      });
      expect(guards.prIsMerged({ context })).toBe(true);
    });

    it("returns false when PR state is not MERGED", () => {
      const context = createTriageContext({
        pr: {
          state: "OPEN",
          isDraft: false,
          number: 1,
          title: "Test PR",
          headRef: "test-branch",
          baseRef: "main",
          labels: [],
          reviews: [],
        },
      });
      expect(guards.prIsMerged({ context })).toBe(false);
    });

    it("returns false when PR is null", () => {
      const context = createTriageContext({ pr: null });
      expect(guards.prIsMerged({ context })).toBe(false);
    });
  });
});

// ============================================================================
// Branch Guards
// ============================================================================

describe("Branch Guards", () => {
  describe("hasBranch", () => {
    it("returns true when hasBranch is true", () => {
      const context = createTriageContext({ hasBranch: true });
      expect(guards.hasBranch({ context })).toBe(true);
    });

    it("returns false when hasBranch is false", () => {
      const context = createTriageContext({ hasBranch: false });
      expect(guards.hasBranch({ context })).toBe(false);
    });
  });

  describe("needsBranch", () => {
    it("returns true when hasBranch is false and branch name exists", () => {
      const context = createTriageContext({
        hasBranch: false,
        branch: "feature-branch",
      });
      expect(guards.needsBranch({ context })).toBe(true);
    });

    it("returns false when hasBranch is true", () => {
      const context = createTriageContext({
        hasBranch: true,
        branch: "feature-branch",
      });
      expect(guards.needsBranch({ context })).toBe(false);
    });

    it("returns false when branch is null", () => {
      const context = createTriageContext({ hasBranch: false, branch: null });
      expect(guards.needsBranch({ context })).toBe(false);
    });
  });
});

// ============================================================================
// Trigger Guards
// ============================================================================

describe("Trigger Guards", () => {
  describe("triggeredByAssignment", () => {
    it("returns true when trigger is issue-assigned", () => {
      const context = createTriageContext({ trigger: "issue-assigned" });
      expect(guards.triggeredByAssignment({ context })).toBe(true);
    });

    it("returns false for other triggers", () => {
      const context = createTriageContext({ trigger: "issue-edited" });
      expect(guards.triggeredByAssignment({ context })).toBe(false);
    });
  });

  describe("triggeredByEdit", () => {
    it("returns true when trigger is issue-edited", () => {
      const context = createTriageContext({ trigger: "issue-edited" });
      expect(guards.triggeredByEdit({ context })).toBe(true);
    });

    it("returns false for other triggers", () => {
      const context = createTriageContext({ trigger: "issue-assigned" });
      expect(guards.triggeredByEdit({ context })).toBe(false);
    });
  });

  describe("triggeredByCI", () => {
    it("returns true when trigger is workflow-run-completed", () => {
      const context = createTriageContext({
        trigger: "workflow-run-completed",
      });
      expect(guards.triggeredByCI({ context })).toBe(true);
    });

    it("returns false for other triggers", () => {
      const context = createTriageContext({ trigger: "issue-edited" });
      expect(guards.triggeredByCI({ context })).toBe(false);
    });
  });

  describe("triggeredByReview", () => {
    it("returns true when trigger is pr-review-submitted", () => {
      const context = createTriageContext({ trigger: "pr-review-submitted" });
      expect(guards.triggeredByReview({ context })).toBe(true);
    });

    it("returns false for other triggers", () => {
      const context = createTriageContext({ trigger: "issue-edited" });
      expect(guards.triggeredByReview({ context })).toBe(false);
    });
  });

  describe("triggeredByReviewRequest", () => {
    it("returns true when trigger is pr-review-requested", () => {
      const context = createTriageContext({ trigger: "pr-review-requested" });
      expect(guards.triggeredByReviewRequest({ context })).toBe(true);
    });

    it("returns false for other triggers", () => {
      const context = createTriageContext({ trigger: "issue-edited" });
      expect(guards.triggeredByReviewRequest({ context })).toBe(false);
    });
  });

  describe("triggeredByTriage", () => {
    it("returns true when trigger is issue-triage", () => {
      const context = createTriageContext({ trigger: "issue-triage" });
      expect(guards.triggeredByTriage({ context })).toBe(true);
    });

    it("returns false for other triggers", () => {
      const context = createTriageContext({ trigger: "issue-edited" });
      expect(guards.triggeredByTriage({ context })).toBe(false);
    });
  });

  describe("triggeredByComment", () => {
    it("returns true when trigger is issue-comment", () => {
      const context = createTriageContext({ trigger: "issue-comment" });
      expect(guards.triggeredByComment({ context })).toBe(true);
    });

    it("returns false for other triggers", () => {
      const context = createTriageContext({ trigger: "issue-edited" });
      expect(guards.triggeredByComment({ context })).toBe(false);
    });
  });

  describe("triggeredByOrchestrate", () => {
    it("returns true when trigger is issue-orchestrate", () => {
      const context = createTriageContext({ trigger: "issue-orchestrate" });
      expect(guards.triggeredByOrchestrate({ context })).toBe(true);
    });

    it("returns false for other triggers", () => {
      const context = createTriageContext({ trigger: "issue-edited" });
      expect(guards.triggeredByOrchestrate({ context })).toBe(false);
    });
  });

  describe("triggeredByPRReview", () => {
    it("returns true when trigger is pr-review-requested", () => {
      const context = createTriageContext({ trigger: "pr-review-requested" });
      expect(guards.triggeredByPRReview({ context })).toBe(true);
    });

    it("returns true when trigger is pr-review (legacy)", () => {
      const context = createTriageContext({ trigger: "pr-review" });
      expect(guards.triggeredByPRReview({ context })).toBe(true);
    });

    it("returns false for other triggers", () => {
      const context = createTriageContext({ trigger: "issue-edited" });
      expect(guards.triggeredByPRReview({ context })).toBe(false);
    });
  });

  describe("triggeredByPRResponse", () => {
    it("returns true when trigger is pr-response", () => {
      const context = createTriageContext({ trigger: "pr-response" });
      expect(guards.triggeredByPRResponse({ context })).toBe(true);
    });

    it("returns false for other triggers", () => {
      const context = createTriageContext({ trigger: "issue-edited" });
      expect(guards.triggeredByPRResponse({ context })).toBe(false);
    });
  });

  describe("triggeredByPRHumanResponse", () => {
    it("returns true when trigger is pr-human-response", () => {
      const context = createTriageContext({ trigger: "pr-human-response" });
      expect(guards.triggeredByPRHumanResponse({ context })).toBe(true);
    });

    it("returns false for other triggers", () => {
      const context = createTriageContext({ trigger: "issue-edited" });
      expect(guards.triggeredByPRHumanResponse({ context })).toBe(false);
    });
  });

  describe("triggeredByPRReviewApproved", () => {
    it("returns true when trigger is pr-review-approved", () => {
      const context = createTriageContext({ trigger: "pr-review-approved" });
      expect(guards.triggeredByPRReviewApproved({ context })).toBe(true);
    });

    it("returns false for other triggers", () => {
      const context = createTriageContext({ trigger: "issue-edited" });
      expect(guards.triggeredByPRReviewApproved({ context })).toBe(false);
    });
  });

  describe("triggeredByPRPush", () => {
    it("returns true when trigger is pr-push", () => {
      const context = createTriageContext({ trigger: "pr-push" });
      expect(guards.triggeredByPRPush({ context })).toBe(true);
    });

    it("returns false for other triggers", () => {
      const context = createTriageContext({ trigger: "issue-edited" });
      expect(guards.triggeredByPRPush({ context })).toBe(false);
    });
  });

  describe("triggeredByReset", () => {
    it("returns true when trigger is issue-reset", () => {
      const context = createTriageContext({ trigger: "issue-reset" });
      expect(guards.triggeredByReset({ context })).toBe(true);
    });

    it("returns false for other triggers", () => {
      const context = createTriageContext({ trigger: "issue-edited" });
      expect(guards.triggeredByReset({ context })).toBe(false);
    });
  });

  describe("triggeredByPivot", () => {
    it("returns true when trigger is issue-pivot", () => {
      const context = createTriageContext({ trigger: "issue-pivot" });
      expect(guards.triggeredByPivot({ context })).toBe(true);
    });

    it("returns false for other triggers", () => {
      const context = createTriageContext({ trigger: "issue-edited" });
      expect(guards.triggeredByPivot({ context })).toBe(false);
    });
  });

  describe("triggeredByMergeQueueEntry", () => {
    it("returns true when trigger is merge-queue-entered", () => {
      const context = createTriageContext({ trigger: "merge-queue-entered" });
      expect(guards.triggeredByMergeQueueEntry({ context })).toBe(true);
    });

    it("returns false for other triggers", () => {
      const context = createTriageContext({ trigger: "issue-edited" });
      expect(guards.triggeredByMergeQueueEntry({ context })).toBe(false);
    });
  });

  describe("triggeredByMergeQueueFailure", () => {
    it("returns true when trigger is merge-queue-failed", () => {
      const context = createTriageContext({ trigger: "merge-queue-failed" });
      expect(guards.triggeredByMergeQueueFailure({ context })).toBe(true);
    });

    it("returns false for other triggers", () => {
      const context = createTriageContext({ trigger: "issue-edited" });
      expect(guards.triggeredByMergeQueueFailure({ context })).toBe(false);
    });
  });

  describe("triggeredByPRMerged", () => {
    it("returns true when trigger is pr-merged", () => {
      const context = createTriageContext({ trigger: "pr-merged" });
      expect(guards.triggeredByPRMerged({ context })).toBe(true);
    });

    it("returns false for other triggers", () => {
      const context = createTriageContext({ trigger: "issue-edited" });
      expect(guards.triggeredByPRMerged({ context })).toBe(false);
    });
  });

  describe("triggeredByDeployedStage", () => {
    it("returns true when trigger is deployed-stage", () => {
      const context = createTriageContext({ trigger: "deployed-stage" });
      expect(guards.triggeredByDeployedStage({ context })).toBe(true);
    });

    it("returns false for other triggers", () => {
      const context = createTriageContext({ trigger: "issue-edited" });
      expect(guards.triggeredByDeployedStage({ context })).toBe(false);
    });
  });

  describe("triggeredByDeployedProd", () => {
    it("returns true when trigger is deployed-prod", () => {
      const context = createTriageContext({ trigger: "deployed-prod" });
      expect(guards.triggeredByDeployedProd({ context })).toBe(true);
    });

    it("returns false for other triggers", () => {
      const context = createTriageContext({ trigger: "issue-edited" });
      expect(guards.triggeredByDeployedProd({ context })).toBe(false);
    });
  });
});

// ============================================================================
// Triage/Grooming Guards
// ============================================================================

describe("Triage/Grooming Guards", () => {
  describe("needsTriage", () => {
    it("returns true when issue has no triaged label", () => {
      const context = createTriageContext({
        issue: ParentIssueSchema.parse({
          ...createTriageContext().issue,
          labels: [],
        }),
      });
      expect(guards.needsTriage({ context })).toBe(true);
    });

    it("returns false when issue has triaged label", () => {
      const context = createTriageContext({
        issue: ParentIssueSchema.parse({
          ...createTriageContext().issue,
          labels: ["triaged"],
        }),
      });
      expect(guards.needsTriage({ context })).toBe(false);
    });

    it("returns false for sub-issues (never triaged)", () => {
      const context = createSubIssueContext({
        issue: ParentIssueSchema.parse({
          ...createSubIssueContext().issue,
          labels: [],
        }),
      });
      expect(guards.needsTriage({ context })).toBe(false);
    });
  });

  describe("isTriaged", () => {
    it("returns true when issue has triaged label", () => {
      const context = createTriageContext({
        issue: ParentIssueSchema.parse({
          ...createTriageContext().issue,
          labels: ["triaged"],
        }),
      });
      expect(guards.isTriaged({ context })).toBe(true);
    });

    it("returns false when issue does not have triaged label", () => {
      const context = createTriageContext();
      expect(guards.isTriaged({ context })).toBe(false);
    });
  });

  describe("triggeredByGroom", () => {
    it("returns true when trigger is issue-groom", () => {
      const context = createTriageContext({ trigger: "issue-groom" });
      expect(guards.triggeredByGroom({ context })).toBe(true);
    });

    it("returns false for other triggers", () => {
      const context = createTriageContext({ trigger: "issue-edited" });
      expect(guards.triggeredByGroom({ context })).toBe(false);
    });
  });

  describe("triggeredByGroomSummary", () => {
    it("returns true when trigger is issue-groom-summary", () => {
      const context = createTriageContext({ trigger: "issue-groom-summary" });
      expect(guards.triggeredByGroomSummary({ context })).toBe(true);
    });

    it("returns false for other triggers", () => {
      const context = createTriageContext({ trigger: "issue-edited" });
      expect(guards.triggeredByGroomSummary({ context })).toBe(false);
    });
  });

  describe("needsGrooming", () => {
    it("returns true when triaged but not groomed", () => {
      const context = createTriageContext({
        issue: ParentIssueSchema.parse({
          ...createTriageContext().issue,
          labels: ["triaged"],
        }),
      });
      expect(guards.needsGrooming({ context })).toBe(true);
    });

    it("returns false when not triaged", () => {
      const context = createTriageContext({
        issue: ParentIssueSchema.parse({
          ...createTriageContext().issue,
          labels: [],
        }),
      });
      expect(guards.needsGrooming({ context })).toBe(false);
    });

    it("returns false when already groomed", () => {
      const context = createTriageContext({
        issue: ParentIssueSchema.parse({
          ...createTriageContext().issue,
          labels: ["triaged", "groomed"],
        }),
      });
      expect(guards.needsGrooming({ context })).toBe(false);
    });

    it("returns true even with needs-info label (grooming can re-evaluate)", () => {
      const context = createTriageContext({
        issue: ParentIssueSchema.parse({
          ...createTriageContext().issue,
          labels: ["triaged", "needs-info"],
        }),
      });
      expect(guards.needsGrooming({ context })).toBe(true);
    });
  });

  describe("isGroomed", () => {
    it("returns true when issue has groomed label", () => {
      const context = createTriageContext({
        issue: ParentIssueSchema.parse({
          ...createTriageContext().issue,
          labels: ["groomed"],
        }),
      });
      expect(guards.isGroomed({ context })).toBe(true);
    });

    it("returns false when issue does not have groomed label", () => {
      const context = createTriageContext();
      expect(guards.isGroomed({ context })).toBe(false);
    });
  });

  describe("needsInfo", () => {
    it("returns true when issue has needs-info label", () => {
      const context = createTriageContext({
        issue: ParentIssueSchema.parse({
          ...createTriageContext().issue,
          labels: ["needs-info"],
        }),
      });
      expect(guards.needsInfo({ context })).toBe(true);
    });

    it("returns false when issue does not have needs-info label", () => {
      const context = createTriageContext();
      expect(guards.needsInfo({ context })).toBe(false);
    });
  });
});

// ============================================================================
// Composite Guards
// ============================================================================

describe("Composite Guards", () => {
  describe("readyForReview", () => {
    it("returns true when CI passed and todos done", () => {
      const context = createTriageContext({
        ciResult: "success",
        issue: ParentIssueSchema.parse({
          ...createTriageContext().issue,
          bodyAst: parseMarkdown("## Todo\n\n- [x] done"),
        }),
      });
      expect(guards.readyForReview({ context })).toBe(true);
    });

    it("returns false when CI passed but todos not done", () => {
      const context = createTriageContext({
        ciResult: "success",
        issue: ParentIssueSchema.parse({
          ...createTriageContext().issue,
          bodyAst: parseMarkdown("## Todo\n\n- [ ] todo"),
        }),
      });
      expect(guards.readyForReview({ context })).toBe(false);
    });

    it("returns false when todos done but CI failed", () => {
      const context = createTriageContext({
        ciResult: "failure",
        issue: ParentIssueSchema.parse({
          ...createTriageContext().issue,
          bodyAst: parseMarkdown("## Todo\n\n- [x] done"),
        }),
      });
      expect(guards.readyForReview({ context })).toBe(false);
    });

    it("returns false when both CI failed and todos not done", () => {
      const context = createTriageContext({
        ciResult: "failure",
        issue: ParentIssueSchema.parse({
          ...createTriageContext().issue,
          bodyAst: parseMarkdown("## Todo\n\n- [ ] todo"),
        }),
      });
      expect(guards.readyForReview({ context })).toBe(false);
    });
  });

  describe("shouldContinueIterating", () => {
    it("returns true when CI failed but max failures not reached", () => {
      const context = createTriageContext({
        ciResult: "failure",
        issue: ParentIssueSchema.parse({
          ...createTriageContext().issue,
          failures: 2,
        }),
        maxRetries: 5,
      });
      expect(guards.shouldContinueIterating({ context })).toBe(true);
    });

    it("returns false when CI passed", () => {
      const context = createTriageContext({
        ciResult: "success",
        issue: ParentIssueSchema.parse({
          ...createTriageContext().issue,
          failures: 2,
        }),
        maxRetries: 5,
      });
      expect(guards.shouldContinueIterating({ context })).toBe(false);
    });

    it("returns false when max failures reached", () => {
      const context = createTriageContext({
        ciResult: "failure",
        issue: ParentIssueSchema.parse({
          ...createTriageContext().issue,
          failures: 5,
        }),
        maxRetries: 5,
      });
      expect(guards.shouldContinueIterating({ context })).toBe(false);
    });
  });

  describe("shouldBlock", () => {
    it("returns true when CI failed and max failures reached", () => {
      const context = createTriageContext({
        ciResult: "failure",
        issue: ParentIssueSchema.parse({
          ...createTriageContext().issue,
          failures: 5,
        }),
        maxRetries: 5,
      });
      expect(guards.shouldBlock({ context })).toBe(true);
    });

    it("returns false when CI failed but max failures not reached", () => {
      const context = createTriageContext({
        ciResult: "failure",
        issue: ParentIssueSchema.parse({
          ...createTriageContext().issue,
          failures: 3,
        }),
        maxRetries: 5,
      });
      expect(guards.shouldBlock({ context })).toBe(false);
    });

    it("returns false when CI passed", () => {
      const context = createTriageContext({
        ciResult: "success",
        issue: ParentIssueSchema.parse({
          ...createTriageContext().issue,
          failures: 5,
        }),
        maxRetries: 5,
      });
      expect(guards.shouldBlock({ context })).toBe(false);
    });
  });
});
