import { describe, test, expect } from "vitest";
import {
  isAlreadyDone,
  isBlocked,
  isError,
  isTerminal,
  hasSubIssues,
  needsSubIssues,
  allPhasesDone,
  isInReview,
  currentPhaseNeedsWork,
  todosDone,
  ciPassed,
  ciFailed,
  ciCancelled,
  maxFailuresReached,
  hasFailures,
  reviewApproved,
  reviewRequestedChanges,
  reviewCommented,
  hasPR,
  prIsDraft,
  prIsReady,
  prIsMerged,
  hasBranch,
  needsBranch,
  botIsAssigned,
  isFirstIteration,
  triggeredByAssignment,
  triggeredByEdit,
  triggeredByCI,
  triggeredByReview,
  triggeredByTriage,
  readyForReview,
  shouldContinueIterating,
  shouldBlock,
} from "../../machine/guards.js";
import { createContext } from "../fixtures/index.js";

describe("Terminal State Guards", () => {
  describe("isAlreadyDone", () => {
    test("returns true when status is Done", () => {
      const context = createContext({
        issue: { projectStatus: "Done" },
      });
      expect(isAlreadyDone({ context })).toBe(true);
    });

    test("returns false for other statuses", () => {
      const context = createContext({
        issue: { projectStatus: "In progress" },
      });
      expect(isAlreadyDone({ context })).toBe(false);
    });
  });

  describe("isBlocked", () => {
    test("returns true when status is Blocked", () => {
      const context = createContext({
        issue: { projectStatus: "Blocked" },
      });
      expect(isBlocked({ context })).toBe(true);
    });

    test("returns false for other statuses", () => {
      const context = createContext({
        issue: { projectStatus: "In progress" },
      });
      expect(isBlocked({ context })).toBe(false);
    });
  });

  describe("isError", () => {
    test("returns true when status is Error", () => {
      const context = createContext({
        issue: { projectStatus: "Error" },
      });
      expect(isError({ context })).toBe(true);
    });
  });

  describe("isTerminal", () => {
    test("returns true for Done", () => {
      const context = createContext({
        issue: { projectStatus: "Done" },
      });
      expect(isTerminal({ context })).toBe(true);
    });

    test("returns true for Blocked", () => {
      const context = createContext({
        issue: { projectStatus: "Blocked" },
      });
      expect(isTerminal({ context })).toBe(true);
    });

    test("returns true for Error", () => {
      const context = createContext({
        issue: { projectStatus: "Error" },
      });
      expect(isTerminal({ context })).toBe(true);
    });

    test("returns false for non-terminal statuses", () => {
      const context = createContext({
        issue: { projectStatus: "In progress" },
      });
      expect(isTerminal({ context })).toBe(false);
    });
  });
});

describe("Sub-Issue Guards", () => {
  describe("hasSubIssues", () => {
    test("returns true when hasSubIssues flag is true", () => {
      const context = createContext({ issue: { hasSubIssues: true } });
      expect(hasSubIssues({ context })).toBe(true);
    });

    test("returns false when hasSubIssues flag is false", () => {
      const context = createContext({ issue: { hasSubIssues: false } });
      expect(hasSubIssues({ context })).toBe(false);
    });
  });

  describe("needsSubIssues", () => {
    test("returns false by default (placeholder implementation)", () => {
      const context = createContext();
      expect(needsSubIssues({ context })).toBe(false);
    });
  });

  describe("allPhasesDone", () => {
    test("returns true when all sub-issues are Done", () => {
      const context = createContext({
        issue: {
          hasSubIssues: true,
          subIssues: [
            {
              number: 1,
              title: "Phase 1",
              state: "CLOSED",
              body: "",
              projectStatus: "Done",
              branch: null,
              pr: null,
              todos: { total: 1, completed: 1, uncheckedNonManual: 0 },
            },
            {
              number: 2,
              title: "Phase 2",
              state: "OPEN",
              body: "",
              projectStatus: "Done",
              branch: null,
              pr: null,
              todos: { total: 1, completed: 1, uncheckedNonManual: 0 },
            },
          ],
        },
      });
      expect(allPhasesDone({ context })).toBe(true);
    });

    test("returns false when some sub-issues are not Done", () => {
      const context = createContext({
        issue: {
          hasSubIssues: true,
          subIssues: [
            {
              number: 1,
              title: "Phase 1",
              state: "CLOSED",
              body: "",
              projectStatus: "Done",
              branch: null,
              pr: null,
              todos: { total: 1, completed: 1, uncheckedNonManual: 0 },
            },
            {
              number: 2,
              title: "Phase 2",
              state: "OPEN",
              body: "",
              projectStatus: "In progress",
              branch: null,
              pr: null,
              todos: { total: 1, completed: 0, uncheckedNonManual: 1 },
            },
          ],
        },
      });
      expect(allPhasesDone({ context })).toBe(false);
    });

    test("returns true for closed sub-issues even without Done status", () => {
      const context = createContext({
        issue: {
          hasSubIssues: true,
          subIssues: [
            {
              number: 1,
              title: "Phase 1",
              state: "CLOSED",
              body: "",
              projectStatus: "In progress",
              branch: null,
              pr: null,
              todos: { total: 1, completed: 1, uncheckedNonManual: 0 },
            },
          ],
        },
      });
      expect(allPhasesDone({ context })).toBe(true);
    });
  });
});

describe("Phase State Guards", () => {
  describe("isInReview", () => {
    test("returns true when currentSubIssue status is Review", () => {
      const context = createContext({
        currentSubIssue: {
          number: 1,
          title: "Phase 1",
          state: "OPEN",
          body: "",
          projectStatus: "In review",
          branch: null,
          pr: null,
          todos: { total: 0, completed: 0, uncheckedNonManual: 0 },
        },
      });
      expect(isInReview({ context })).toBe(true);
    });

    test("returns true when issue status is Review (no sub-issue)", () => {
      const context = createContext({
        issue: { projectStatus: "In review" },
        currentSubIssue: null,
      });
      expect(isInReview({ context })).toBe(true);
    });

    test("returns false when not in review", () => {
      const context = createContext({
        issue: { projectStatus: "In progress" },
        currentSubIssue: null,
      });
      expect(isInReview({ context })).toBe(false);
    });
  });

  describe("currentPhaseNeedsWork", () => {
    test("returns true when currentSubIssue status is In progress", () => {
      const context = createContext({
        currentSubIssue: {
          number: 1,
          title: "Phase 1",
          state: "OPEN",
          body: "",
          projectStatus: "In progress",
          branch: null,
          pr: null,
          todos: { total: 1, completed: 0, uncheckedNonManual: 1 },
        },
      });
      expect(currentPhaseNeedsWork({ context })).toBe(true);
    });

    test("returns true when currentSubIssue status is Ready", () => {
      const context = createContext({
        currentSubIssue: {
          number: 1,
          title: "Phase 1",
          state: "OPEN",
          body: "",
          projectStatus: "Ready",
          branch: null,
          pr: null,
          todos: { total: 1, completed: 0, uncheckedNonManual: 1 },
        },
      });
      expect(currentPhaseNeedsWork({ context })).toBe(true);
    });

    test("returns true when issue status is In progress (no sub-issue)", () => {
      const context = createContext({
        issue: { projectStatus: "In progress" },
        currentSubIssue: null,
      });
      expect(currentPhaseNeedsWork({ context })).toBe(true);
    });
  });
});

describe("Todo Guards", () => {
  describe("todosDone", () => {
    test("returns true when no unchecked non-manual todos", () => {
      const context = createContext({
        currentSubIssue: {
          number: 1,
          title: "Phase 1",
          state: "OPEN",
          body: "",
          projectStatus: "In progress",
          branch: null,
          pr: null,
          todos: { total: 3, completed: 2, uncheckedNonManual: 0 },
        },
      });
      expect(todosDone({ context })).toBe(true);
    });

    test("returns false when there are unchecked non-manual todos", () => {
      const context = createContext({
        currentSubIssue: {
          number: 1,
          title: "Phase 1",
          state: "OPEN",
          body: "",
          projectStatus: "In progress",
          branch: null,
          pr: null,
          todos: { total: 3, completed: 1, uncheckedNonManual: 2 },
        },
      });
      expect(todosDone({ context })).toBe(false);
    });

    test("falls back to issue.todos when no currentSubIssue", () => {
      // When triggered directly on a sub-issue (e.g., CI completion),
      // currentSubIssue is null but the issue itself has todos
      const contextWithTodos = createContext({
        currentSubIssue: null,
        issue: {
          todos: { total: 2, completed: 1, uncheckedNonManual: 1 },
        },
      });
      expect(todosDone({ context: contextWithTodos })).toBe(false);

      // If issue's todos are all done, returns true
      const contextDone = createContext({
        currentSubIssue: null,
        issue: {
          todos: { total: 2, completed: 2, uncheckedNonManual: 0 },
        },
      });
      expect(todosDone({ context: contextDone })).toBe(true);
    });
  });
});

describe("CI Guards", () => {
  describe("ciPassed", () => {
    test("returns true when ciResult is success", () => {
      const context = createContext({ ciResult: "success" });
      expect(ciPassed({ context })).toBe(true);
    });

    test("returns false for other results", () => {
      const context = createContext({ ciResult: "failure" });
      expect(ciPassed({ context })).toBe(false);
    });
  });

  describe("ciFailed", () => {
    test("returns true when ciResult is failure", () => {
      const context = createContext({ ciResult: "failure" });
      expect(ciFailed({ context })).toBe(true);
    });

    test("returns false for other results", () => {
      const context = createContext({ ciResult: "success" });
      expect(ciFailed({ context })).toBe(false);
    });
  });

  describe("ciCancelled", () => {
    test("returns true when ciResult is cancelled", () => {
      const context = createContext({ ciResult: "cancelled" });
      expect(ciCancelled({ context })).toBe(true);
    });
  });
});

describe("Failure Guards", () => {
  describe("maxFailuresReached", () => {
    test("returns true when failures >= maxRetries", () => {
      const context = createContext({
        issue: { failures: 5 },
        maxRetries: 5,
      });
      expect(maxFailuresReached({ context })).toBe(true);
    });

    test("returns true when failures > maxRetries", () => {
      const context = createContext({
        issue: { failures: 10 },
        maxRetries: 5,
      });
      expect(maxFailuresReached({ context })).toBe(true);
    });

    test("returns false when failures < maxRetries", () => {
      const context = createContext({
        issue: { failures: 3 },
        maxRetries: 5,
      });
      expect(maxFailuresReached({ context })).toBe(false);
    });
  });

  describe("hasFailures", () => {
    test("returns true when failures > 0", () => {
      const context = createContext({ issue: { failures: 1 } });
      expect(hasFailures({ context })).toBe(true);
    });

    test("returns false when failures is 0", () => {
      const context = createContext({ issue: { failures: 0 } });
      expect(hasFailures({ context })).toBe(false);
    });
  });
});

describe("Review Guards", () => {
  describe("reviewApproved", () => {
    test("returns true when reviewDecision is APPROVED", () => {
      const context = createContext({ reviewDecision: "APPROVED" });
      expect(reviewApproved({ context })).toBe(true);
    });

    test("returns false for other decisions", () => {
      const context = createContext({ reviewDecision: "CHANGES_REQUESTED" });
      expect(reviewApproved({ context })).toBe(false);
    });
  });

  describe("reviewRequestedChanges", () => {
    test("returns true when reviewDecision is CHANGES_REQUESTED", () => {
      const context = createContext({ reviewDecision: "CHANGES_REQUESTED" });
      expect(reviewRequestedChanges({ context })).toBe(true);
    });
  });

  describe("reviewCommented", () => {
    test("returns true when reviewDecision is COMMENTED", () => {
      const context = createContext({ reviewDecision: "COMMENTED" });
      expect(reviewCommented({ context })).toBe(true);
    });
  });
});

describe("PR Guards", () => {
  const mockPR = {
    number: 42,
    state: "OPEN" as const,
    isDraft: false,
    title: "Test PR",
    headRef: "feature",
    baseRef: "main",
  };

  describe("hasPR", () => {
    test("returns true when hasPR flag and pr object exist", () => {
      const context = createContext({ hasPR: true, pr: mockPR });
      expect(hasPR({ context })).toBe(true);
    });

    test("returns false when no PR", () => {
      const context = createContext({ hasPR: false, pr: null });
      expect(hasPR({ context })).toBe(false);
    });
  });

  describe("prIsDraft", () => {
    test("returns true when PR is draft", () => {
      const context = createContext({ pr: { ...mockPR, isDraft: true } });
      expect(prIsDraft({ context })).toBe(true);
    });

    test("returns false when PR is not draft", () => {
      const context = createContext({ pr: { ...mockPR, isDraft: false } });
      expect(prIsDraft({ context })).toBe(false);
    });
  });

  describe("prIsReady", () => {
    test("returns true when PR is not draft", () => {
      const context = createContext({ pr: { ...mockPR, isDraft: false } });
      expect(prIsReady({ context })).toBe(true);
    });

    test("returns false when PR is draft", () => {
      const context = createContext({ pr: { ...mockPR, isDraft: true } });
      expect(prIsReady({ context })).toBe(false);
    });
  });

  describe("prIsMerged", () => {
    test("returns true when PR state is MERGED", () => {
      const context = createContext({ pr: { ...mockPR, state: "MERGED" } });
      expect(prIsMerged({ context })).toBe(true);
    });

    test("returns false when PR is not merged", () => {
      const context = createContext({ pr: { ...mockPR, state: "OPEN" } });
      expect(prIsMerged({ context })).toBe(false);
    });
  });
});

describe("Branch Guards", () => {
  describe("hasBranch", () => {
    test("returns true when hasBranch is true", () => {
      const context = createContext({ hasBranch: true });
      expect(hasBranch({ context })).toBe(true);
    });

    test("returns false when hasBranch is false", () => {
      const context = createContext({ hasBranch: false });
      expect(hasBranch({ context })).toBe(false);
    });
  });

  describe("needsBranch", () => {
    test("returns true when no branch but branch name provided", () => {
      const context = createContext({
        hasBranch: false,
        branch: "feature/test",
      });
      expect(needsBranch({ context })).toBe(true);
    });

    test("returns false when branch already exists", () => {
      const context = createContext({
        hasBranch: true,
        branch: "feature/test",
      });
      expect(needsBranch({ context })).toBe(false);
    });

    test("returns false when no branch name", () => {
      const context = createContext({ hasBranch: false, branch: null });
      expect(needsBranch({ context })).toBe(false);
    });
  });
});

describe("Assignment Guards", () => {
  describe("botIsAssigned", () => {
    test("returns true when bot is in assignees", () => {
      const context = createContext({
        issue: { assignees: ["nopo-bot", "other-user"] },
        botUsername: "nopo-bot",
      });
      expect(botIsAssigned({ context })).toBe(true);
    });

    test("returns false when bot is not assigned", () => {
      const context = createContext({
        issue: { assignees: ["other-user"] },
        botUsername: "nopo-bot",
      });
      expect(botIsAssigned({ context })).toBe(false);
    });
  });

  describe("isFirstIteration", () => {
    test("returns true when iteration is 0", () => {
      const context = createContext({ issue: { iteration: 0 } });
      expect(isFirstIteration({ context })).toBe(true);
    });

    test("returns false when iteration > 0", () => {
      const context = createContext({ issue: { iteration: 1 } });
      expect(isFirstIteration({ context })).toBe(false);
    });
  });
});

describe("Trigger Guards", () => {
  describe("triggeredByAssignment", () => {
    test("returns true for issue_assigned trigger", () => {
      const context = createContext({ trigger: "issue_assigned" });
      expect(triggeredByAssignment({ context })).toBe(true);
    });

    test("returns false for other triggers", () => {
      const context = createContext({ trigger: "issue_edited" });
      expect(triggeredByAssignment({ context })).toBe(false);
    });
  });

  describe("triggeredByEdit", () => {
    test("returns true for issue_edited trigger", () => {
      const context = createContext({ trigger: "issue_edited" });
      expect(triggeredByEdit({ context })).toBe(true);
    });
  });

  describe("triggeredByCI", () => {
    test("returns true for workflow_run_completed trigger", () => {
      const context = createContext({ trigger: "workflow_run_completed" });
      expect(triggeredByCI({ context })).toBe(true);
    });
  });

  describe("triggeredByReview", () => {
    test("returns true for pr_review_submitted trigger", () => {
      const context = createContext({ trigger: "pr_review_submitted" });
      expect(triggeredByReview({ context })).toBe(true);
    });
  });

  describe("triggeredByTriage", () => {
    test("returns true for issue_triage trigger", () => {
      const context = createContext({ trigger: "issue_triage" });
      expect(triggeredByTriage({ context })).toBe(true);
    });

    test("returns false for other triggers", () => {
      const context = createContext({ trigger: "issue_assigned" });
      expect(triggeredByTriage({ context })).toBe(false);
    });
  });
});

describe("Composite Guards", () => {
  describe("readyForReview", () => {
    test("returns true when CI passed and todos done", () => {
      const context = createContext({
        ciResult: "success",
        currentSubIssue: {
          number: 1,
          title: "Phase 1",
          state: "OPEN",
          body: "",
          projectStatus: "In progress",
          branch: null,
          pr: null,
          todos: { total: 3, completed: 3, uncheckedNonManual: 0 },
        },
      });
      expect(readyForReview({ context })).toBe(true);
    });

    test("returns false when CI passed but todos not done", () => {
      const context = createContext({
        ciResult: "success",
        currentSubIssue: {
          number: 1,
          title: "Phase 1",
          state: "OPEN",
          body: "",
          projectStatus: "In progress",
          branch: null,
          pr: null,
          todos: { total: 3, completed: 1, uncheckedNonManual: 2 },
        },
      });
      expect(readyForReview({ context })).toBe(false);
    });

    test("returns false when todos done but CI failed", () => {
      const context = createContext({
        ciResult: "failure",
        currentSubIssue: {
          number: 1,
          title: "Phase 1",
          state: "OPEN",
          body: "",
          projectStatus: "In progress",
          branch: null,
          pr: null,
          todos: { total: 3, completed: 3, uncheckedNonManual: 0 },
        },
      });
      expect(readyForReview({ context })).toBe(false);
    });
  });

  describe("shouldContinueIterating", () => {
    test("returns true when CI failed but not max failures", () => {
      const context = createContext({
        ciResult: "failure",
        issue: { failures: 2 },
        maxRetries: 5,
      });
      expect(shouldContinueIterating({ context })).toBe(true);
    });

    test("returns false when max failures reached", () => {
      const context = createContext({
        ciResult: "failure",
        issue: { failures: 5 },
        maxRetries: 5,
      });
      expect(shouldContinueIterating({ context })).toBe(false);
    });

    test("returns false when CI passed", () => {
      const context = createContext({
        ciResult: "success",
        issue: { failures: 0 },
        maxRetries: 5,
      });
      expect(shouldContinueIterating({ context })).toBe(false);
    });
  });

  describe("shouldBlock", () => {
    test("returns true when CI failed and max failures reached", () => {
      const context = createContext({
        ciResult: "failure",
        issue: { failures: 5 },
        maxRetries: 5,
      });
      expect(shouldBlock({ context })).toBe(true);
    });

    test("returns false when not at max failures", () => {
      const context = createContext({
        ciResult: "failure",
        issue: { failures: 3 },
        maxRetries: 5,
      });
      expect(shouldBlock({ context })).toBe(false);
    });
  });
});
