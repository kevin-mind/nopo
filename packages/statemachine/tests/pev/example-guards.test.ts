import { describe, expect, it } from "vitest";
import type { RunnerMachineContext } from "../../src/core/pev/types.js";
import type { ExampleContext } from "../../src/machines/example/context.js";
import {
  needsTriage,
  canIterate,
  isAlreadyDone,
  isBlocked,
  isError,
  isInReview,
  triggeredByGroom,
  triggeredByGroomSummary,
  triggeredByReviewRequest,
  ciPassed,
  ciFailed,
  reviewApproved,
  reviewRequestedChanges,
  reviewCommented,
  needsGrooming,
  hasSubIssues,
  currentPhaseInReview,
  allPhasesDone,
  maxFailuresReached,
  todosDone,
  readyForReview,
  branchPrepCleanAndReadyForReview,
} from "../../src/machines/example/guards.js";
import {
  mockExampleContext,
  mockExampleIssue,
  mockExamplePR,
} from "./mock-factories.js";
import { checkOffTodoInBody } from "@more/issue-state";

function withRunnerContext(
  domain: ExampleContext,
): RunnerMachineContext<ExampleContext, { type: string }> {
  return {
    domain,
    services: null,
    actionQueue: [],
    currentAction: null,
    prediction: null,
    preActionSnapshot: null,
    executeResult: null,
    verifyResult: null,
    completedActions: [],
    cycleCount: 0,
    maxCycles: 10,
    error: null,
    runnerCtx: { token: "token", owner: "owner", repo: "repo" },
  };
}

describe("example guards", () => {
  it("needsTriage is false for sub-issues", () => {
    const domain = mockExampleContext({
      trigger: "issue-edited",
      owner: "owner",
      repo: "repo",
      parentIssue: mockExampleIssue({ number: 1 }),
      issue: mockExampleIssue({ labels: [] }),
    });
    expect(needsTriage({ context: withRunnerContext(domain) })).toBe(false);
  });

  it("needsTriage is false for [Phase] title prefix (race condition guard)", () => {
    const domain = mockExampleContext({
      trigger: "issue-edited",
      parentIssue: null,
      issue: mockExampleIssue({
        title: "[Phase 1]: Add unit tests",
        labels: [],
        projectStatus: null,
      }),
    });
    expect(needsTriage({ context: withRunnerContext(domain) })).toBe(false);
  });

  it("needsTriage is false when status is Triaged", () => {
    const domain = mockExampleContext({
      trigger: "issue-edited",
      issue: mockExampleIssue({ projectStatus: "Triaged" }),
    });
    expect(needsTriage({ context: withRunnerContext(domain) })).toBe(false);
  });

  it("canIterate requires bot assigned to both parent and issue", () => {
    const domain = mockExampleContext({
      trigger: "issue-edited",
      botUsername: "nopo-bot",
      parentIssue: mockExampleIssue({ assignees: ["nopo-bot"] }),
      issue: mockExampleIssue({ assignees: ["nopo-bot"] }),
    });
    expect(canIterate({ context: withRunnerContext(domain) })).toBe(true);
  });

  it("canIterate is false if parent is missing bot assignment", () => {
    const domain = mockExampleContext({
      trigger: "issue-edited",
      botUsername: "nopo-bot",
      parentIssue: mockExampleIssue({ assignees: ["someone-else"] }),
      issue: mockExampleIssue({ assignees: ["nopo-bot"] }),
    });
    expect(canIterate({ context: withRunnerContext(domain) })).toBe(false);
  });

  it("isAlreadyDone requires done status and merged PR", () => {
    const doneAndMerged = {
      ...mockExampleContext({
        trigger: "issue-edited",
        issue: mockExampleIssue({ projectStatus: "Done" }),
      }),
      pr: mockExamplePR({ state: "MERGED", title: "PR" }),
      hasPR: true,
    };
    const doneNotMerged = {
      ...mockExampleContext({
        trigger: "issue-edited",
        issue: mockExampleIssue({ projectStatus: "Done" }),
      }),
      pr: mockExamplePR({ state: "OPEN", title: "PR" }),
      hasPR: true,
    };
    expect(isAlreadyDone({ context: withRunnerContext(doneAndMerged) })).toBe(
      true,
    );
    expect(isAlreadyDone({ context: withRunnerContext(doneNotMerged) })).toBe(
      false,
    );
  });

  it("triggeredByGroom matches issue-groom, triggeredByGroomSummary matches issue-groom-summary", () => {
    const groom = mockExampleContext({ trigger: "issue-groom" });
    const groomSummary = mockExampleContext({ trigger: "issue-groom-summary" });
    expect(triggeredByGroom({ context: withRunnerContext(groom) })).toBe(true);
    expect(triggeredByGroom({ context: withRunnerContext(groomSummary) })).toBe(
      false,
    );
    expect(
      triggeredByGroomSummary({ context: withRunnerContext(groomSummary) }),
    ).toBe(true);
    expect(triggeredByGroomSummary({ context: withRunnerContext(groom) })).toBe(
      false,
    );
  });

  it("triggeredByReviewRequest is strict to review-request trigger", () => {
    const reviewReq = mockExampleContext({ trigger: "pr-review-requested" });
    const reviewSubmitted = mockExampleContext({
      trigger: "pr-review-submitted",
    });
    expect(
      triggeredByReviewRequest({
        context: withRunnerContext(reviewReq),
      }),
    ).toBe(true);
    expect(
      triggeredByReviewRequest({
        context: withRunnerContext(reviewSubmitted),
      }),
    ).toBe(false);
  });

  it("ci/review decision guards map expected values", () => {
    const ciSuccess = mockExampleContext({ ciResult: "success" });
    const ciFailure = mockExampleContext({ ciResult: "failure" });
    const reviewOk = mockExampleContext({ reviewDecision: "APPROVED" });
    const reviewChanges = mockExampleContext({
      reviewDecision: "CHANGES_REQUESTED",
    });
    const reviewComment = mockExampleContext({ reviewDecision: "COMMENTED" });
    expect(ciPassed({ context: withRunnerContext(ciSuccess) })).toBe(true);
    expect(ciFailed({ context: withRunnerContext(ciFailure) })).toBe(true);
    expect(reviewApproved({ context: withRunnerContext(reviewOk) })).toBe(true);
    expect(
      reviewRequestedChanges({
        context: withRunnerContext(reviewChanges),
      }),
    ).toBe(true);
    expect(
      reviewCommented({
        context: withRunnerContext(reviewComment),
      }),
    ).toBe(true);
  });

  it("needsGrooming is true when status is Triaged and no sub-issues", () => {
    const yes = mockExampleContext({
      issue: mockExampleIssue({ projectStatus: "Triaged" }),
    });
    const noAlready = mockExampleContext({
      issue: mockExampleIssue({
        projectStatus: "Groomed",
        hasSubIssues: true,
      }),
    });
    const noTriaged = mockExampleContext({
      issue: mockExampleIssue({ projectStatus: "Backlog" }),
    });
    expect(needsGrooming({ context: withRunnerContext(yes) })).toBe(true);
    expect(needsGrooming({ context: withRunnerContext(noAlready) })).toBe(
      false,
    );
    expect(needsGrooming({ context: withRunnerContext(noTriaged) })).toBe(
      false,
    );
  });

  it("isBlocked returns true when status is Blocked", () => {
    const domain = mockExampleContext({
      issue: mockExampleIssue({ projectStatus: "Blocked" }),
    });
    expect(isBlocked({ context: withRunnerContext(domain) })).toBe(true);
  });

  it("isBlocked returns false when status is not Blocked", () => {
    const domain = mockExampleContext({
      issue: mockExampleIssue({ projectStatus: "In progress" }),
    });
    expect(isBlocked({ context: withRunnerContext(domain) })).toBe(false);
  });

  it("isError returns true when status is Error", () => {
    const domain = mockExampleContext({
      issue: mockExampleIssue({ projectStatus: "Error" }),
    });
    expect(isError({ context: withRunnerContext(domain) })).toBe(true);
  });

  it("isError returns false when status is not Error", () => {
    const domain = mockExampleContext({
      issue: mockExampleIssue({ projectStatus: "In progress" }),
    });
    expect(isError({ context: withRunnerContext(domain) })).toBe(false);
  });

  it("isInReview returns true when status is In review", () => {
    const domain = mockExampleContext({
      issue: mockExampleIssue({ projectStatus: "In review" }),
    });
    expect(isInReview({ context: withRunnerContext(domain) })).toBe(true);
  });

  it("isInReview returns false when status is not In review", () => {
    const domain = mockExampleContext({
      issue: mockExampleIssue({ projectStatus: "In progress" }),
    });
    expect(isInReview({ context: withRunnerContext(domain) })).toBe(false);
  });

  it("hasSubIssues returns true when parent is null and issue has sub-issues", () => {
    const domain = mockExampleContext({
      parentIssue: null,
      issue: mockExampleIssue({
        hasSubIssues: true,
        subIssues: [
          { number: 100, projectStatus: "In progress", state: "OPEN" },
        ],
      }),
    });
    expect(hasSubIssues({ context: withRunnerContext(domain) })).toBe(true);
  });

  it("hasSubIssues returns false when parent exists (sub-issue context)", () => {
    const domain = mockExampleContext({
      parentIssue: mockExampleIssue({ number: 99 }),
      issue: mockExampleIssue({ hasSubIssues: false }),
    });
    expect(hasSubIssues({ context: withRunnerContext(domain) })).toBe(false);
  });

  it("hasSubIssues returns false when no sub-issues", () => {
    const domain = mockExampleContext({
      parentIssue: null,
      issue: mockExampleIssue({ hasSubIssues: false, subIssues: [] }),
    });
    expect(hasSubIssues({ context: withRunnerContext(domain) })).toBe(false);
  });

  it("currentPhaseInReview returns true when current sub-issue is In review", () => {
    const domain = mockExampleContext({
      parentIssue: null,
      issue: mockExampleIssue({
        hasSubIssues: true,
        subIssues: [
          { number: 100, projectStatus: "In review", state: "OPEN" },
          { number: 101, projectStatus: "Backlog", state: "OPEN" },
        ],
      }),
      currentSubIssue: mockExampleIssue({
        number: 100,
        projectStatus: "In review",
        hasSubIssues: false,
      }),
    });
    expect(currentPhaseInReview({ context: withRunnerContext(domain) })).toBe(
      true,
    );
  });

  it("currentPhaseInReview returns false when no sub-issues", () => {
    const domain = mockExampleContext({
      parentIssue: null,
      issue: mockExampleIssue({ hasSubIssues: false }),
    });
    expect(currentPhaseInReview({ context: withRunnerContext(domain) })).toBe(
      false,
    );
  });

  it("allPhasesDone returns true when groomed and all sub-issues Done or CLOSED", () => {
    const domain = mockExampleContext({
      parentIssue: null,
      issue: mockExampleIssue({
        labels: ["triaged", "groomed"],
        hasSubIssues: true,
        subIssues: [
          { number: 100, projectStatus: "Done", state: "CLOSED" },
          { number: 101, projectStatus: "Done", state: "CLOSED" },
        ],
      }),
    });
    expect(allPhasesDone({ context: withRunnerContext(domain) })).toBe(true);
  });

  it("allPhasesDone returns false when no sub-issues", () => {
    const domain = mockExampleContext({
      parentIssue: null,
      issue: mockExampleIssue({
        labels: ["groomed"],
        hasSubIssues: false,
        subIssues: [],
      }),
    });
    expect(allPhasesDone({ context: withRunnerContext(domain) })).toBe(false);
  });

  it("maxFailuresReached returns true when failures >= maxRetries", () => {
    const domain = mockExampleContext({
      issue: mockExampleIssue({ failures: 3 }),
      maxRetries: 3,
    });
    expect(maxFailuresReached({ context: withRunnerContext(domain) })).toBe(
      true,
    );
  });

  it("maxFailuresReached returns false when failures < maxRetries", () => {
    const domain = mockExampleContext({
      issue: mockExampleIssue({ failures: 2 }),
      maxRetries: 3,
    });
    expect(maxFailuresReached({ context: withRunnerContext(domain) })).toBe(
      false,
    );
  });

  it("todosDone returns true when Todos section has all checkboxes checked", () => {
    const domain = mockExampleContext({
      issue: mockExampleIssue({
        body: "## Todos\n- [x] Task 1\n- [x] Task 2",
      }),
    });
    expect(todosDone({ context: withRunnerContext(domain) })).toBe(true);
  });

  it("todosDone works after checkOffTodoInBody with markdown-escaped text", () => {
    // Issue body has markdown-escaped underscores (CI\_SUCCESS), but
    // Claude's todosCompleted has plain text (CI_SUCCESS)
    const body =
      "## Todos\n- [ ] Test CI\\_SUCCESS and CI\\_FAILURE\n- [x] Other task";
    const updated = checkOffTodoInBody(body, "Test CI_SUCCESS and CI_FAILURE");
    expect(updated).not.toBeNull();
    const domain = mockExampleContext({
      issue: mockExampleIssue({ body: updated! }),
    });
    expect(todosDone({ context: withRunnerContext(domain) })).toBe(true);
  });

  it("todosDone returns false when Todos section has unchecked items", () => {
    const domain = mockExampleContext({
      issue: mockExampleIssue({
        body: "## Todos\n- [x] Task 1\n- [ ] Task 2",
      }),
    });
    expect(todosDone({ context: withRunnerContext(domain) })).toBe(false);
  });

  it("readyForReview requires ciPassed and todosDone", () => {
    const yes = mockExampleContext({
      ciResult: "success",
      issue: mockExampleIssue({
        body: "## Todos\n- [x] Done",
      }),
    });
    const noCi = mockExampleContext({
      ciResult: "failure",
      issue: mockExampleIssue({
        body: "## Todos\n- [x] Done",
      }),
    });
    const noTodos = mockExampleContext({
      ciResult: "success",
      issue: mockExampleIssue({
        body: "## Todos\n- [ ] Pending",
      }),
    });
    expect(readyForReview({ context: withRunnerContext(yes) })).toBe(true);
    expect(readyForReview({ context: withRunnerContext(noCi) })).toBe(false);
    expect(readyForReview({ context: withRunnerContext(noTodos) })).toBe(false);
  });

  it("branchPrepCleanAndReadyForReview requires both conditions", () => {
    const both = mockExampleContext({
      ciResult: "success",
      branchPrepResult: "clean",
      issue: mockExampleIssue({ body: "## Todos\n- [x] Done" }),
    });
    const noPrep = mockExampleContext({
      ciResult: "success",
      branchPrepResult: null,
      issue: mockExampleIssue({ body: "## Todos\n- [x] Done" }),
    });
    const rebased = mockExampleContext({
      ciResult: "success",
      branchPrepResult: "rebased",
      issue: mockExampleIssue({ body: "## Todos\n- [x] Done" }),
    });
    const notReady = mockExampleContext({
      ciResult: "success",
      branchPrepResult: "clean",
      issue: mockExampleIssue({ body: "## Todos\n- [ ] Pending" }),
    });
    expect(
      branchPrepCleanAndReadyForReview({ context: withRunnerContext(both) }),
    ).toBe(true);
    expect(
      branchPrepCleanAndReadyForReview({ context: withRunnerContext(noPrep) }),
    ).toBe(false);
    expect(
      branchPrepCleanAndReadyForReview({ context: withRunnerContext(rebased) }),
    ).toBe(false);
    expect(
      branchPrepCleanAndReadyForReview({
        context: withRunnerContext(notReady),
      }),
    ).toBe(false);
  });

  it("allPhasesDone returns false when some sub-issues not done", () => {
    const domain = mockExampleContext({
      parentIssue: null,
      issue: mockExampleIssue({
        labels: ["groomed"],
        hasSubIssues: true,
        subIssues: [
          { number: 100, projectStatus: "Done", state: "CLOSED" },
          { number: 101, projectStatus: "In progress", state: "OPEN" },
        ],
      }),
    });
    expect(allPhasesDone({ context: withRunnerContext(domain) })).toBe(false);
  });
});
