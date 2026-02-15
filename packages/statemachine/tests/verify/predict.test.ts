import { describe, it, expect } from "vitest";
import { parseMarkdown } from "@more/issue-state";
import {
  enrichedSuccessEntry,
  predictFromActions,
} from "../../src/machines/issues/verify/predict.js";
import type { MachineContext } from "../../src/core/schemas/state.js";
import type { Action } from "../../src/core/schemas/actions/index.js";
import { extractPredictableTree } from "../../src/machines/issues/verify/predictable-state.js";

function makeContext(overrides: Partial<MachineContext> = {}): MachineContext {
  const defaultIssue = {
    number: 100,
    title: "Test Issue",
    state: "OPEN" as const,
    bodyAst: parseMarkdown("## Description\n\nTest."),
    projectStatus: "In progress" as const,
    iteration: 1,
    failures: 0,
    assignees: ["nopo-bot"],
    labels: ["triaged"],
    subIssues: [],
    hasSubIssues: false,
    comments: [],
    branch: null,
    pr: null,
    parentIssueNumber: null,
  };

  return {
    trigger: "issue-assigned",
    owner: "test-owner",
    repo: "test-repo",
    issue: defaultIssue,
    parentIssue: null,
    currentPhase: null,
    totalPhases: 0,
    currentSubIssue: null,
    ciResult: null,
    ciRunUrl: null,
    ciCommitSha: null,
    workflowStartedAt: null,
    workflowRunUrl: null,
    reviewDecision: null,
    reviewerId: null,
    branch: null,
    hasBranch: false,
    pr: null,
    hasPR: false,
    commentContextType: null,
    commentContextDescription: null,
    pivotDescription: null,
    releaseEvent: null,
    discussion: null,
    maxRetries: 5,
    botUsername: "nopo-bot",
    ...overrides,
  };
}

describe("enrichedSuccessEntry", () => {
  it("returns plain transition name for non-iterate states", () => {
    const actions: Action[] = [];
    const result = enrichedSuccessEntry("triaging", actions);
    expect(result).toBe("✅ Triage");
  });

  it("returns 'Opened PR' for iterate with createPR and no existing PR", () => {
    const actions: Action[] = [
      {
        type: "createPR",
        issueNumber: 100,
        title: "Test PR",
        body: "Test",
        branchName: "test-branch",
        token: "code",
      },
    ];
    const result = enrichedSuccessEntry("iterating", actions);
    expect(result).toBe("✅ Opened PR");
  });

  it("returns 'Updated PR' for iterate with existing PR", () => {
    const actions: Action[] = [
      {
        type: "applyIterateOutput",
        issueNumber: 100,
        prNumber: 42,
        token: "code",
      },
    ];
    const result = enrichedSuccessEntry("iterating", actions);
    expect(result).toBe("✅ Updated PR");
  });

  it("returns 'Fixed CI' for iteratingFix state", () => {
    const actions: Action[] = [
      {
        type: "applyIterateOutput",
        issueNumber: 100,
        prNumber: 42,
        token: "code",
      },
    ];
    const result = enrichedSuccessEntry("iteratingFix", actions);
    expect(result).toBe("🔧 Fixed CI");
  });

  it("returns fallback transition name for iterate with no createPR and no existing PR", () => {
    const actions: Action[] = [
      { type: "incrementIteration", issueNumber: 100, token: "code" },
    ];
    const result = enrichedSuccessEntry("iterating", actions);
    expect(result).toBe("✅ Iterate");
  });

  it("prefers existing PR over createPR when both present", () => {
    const actions: Action[] = [
      {
        type: "createPR",
        issueNumber: 100,
        title: "Test PR",
        body: "Test",
        branchName: "test-branch",
        token: "code",
      },
      {
        type: "applyIterateOutput",
        issueNumber: 100,
        prNumber: 42,
        token: "code",
      },
    ];
    const result = enrichedSuccessEntry("iterating", actions);
    expect(result).toBe("✅ Updated PR");
  });
});

describe("predictFromActions", () => {
  it("appends enriched success entry to predicted history", () => {
    const context = makeContext();
    const currentTree = extractPredictableTree(context);
    const actions: Action[] = [
      {
        type: "createPR",
        issueNumber: 100,
        title: "Test PR",
        body: "Test",
        branchName: "test-branch",
        token: "code",
      },
    ];

    const outcomes = predictFromActions(actions, currentTree, context, {
      finalState: "iterating",
    });

    expect(outcomes).toHaveLength(1);

    // First outcome should have enriched history entry
    const firstOutcome = outcomes[0];
    expect(firstOutcome?.issue.body.historyEntries).toHaveLength(1);
    expect(firstOutcome?.issue.body.historyEntries[0]?.action).toBe(
      "✅ Opened PR",
    );
    expect(firstOutcome?.issue.body.historyEntries[0]?.iteration).toBe(1);
  });

  it("uses plain transition name for non-iterate states", () => {
    const context = makeContext();
    const currentTree = extractPredictableTree(context);
    const actions: Action[] = [];

    const outcomes = predictFromActions(actions, currentTree, context, {
      finalState: "triaging",
    });

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.issue.body.historyEntries).toHaveLength(1);
    expect(outcomes[0]?.issue.body.historyEntries[0]?.action).toBe("✅ Triage");
  });

  it("includes phase in history entry for sub-issues", () => {
    const subIssue = {
      number: 101,
      title: "[Phase 1]: Test Sub",
      state: "OPEN" as const,
      bodyAst: parseMarkdown("## Description\n\nSub."),
      projectStatus: "In progress" as const,
      assignees: ["nopo-bot"],
      labels: [],
      branch: null,
      pr: null,
    };

    const context = makeContext({
      issue: {
        number: 100,
        title: "Parent Issue",
        state: "OPEN" as const,
        bodyAst: parseMarkdown("## Description\n\nParent."),
        projectStatus: "In progress" as const,
        iteration: 1,
        failures: 0,
        assignees: [],
        labels: [],
        subIssues: [subIssue],
        hasSubIssues: true,
        comments: [],
        branch: null,
        pr: null,
        parentIssueNumber: null,
      },
      currentPhase: 1,
      currentSubIssue: subIssue,
    });

    const currentTree = extractPredictableTree(context);
    const actions: Action[] = [
      {
        type: "createPR",
        issueNumber: 101,
        title: "Test PR",
        body: "Test",
        branchName: "test-branch",
        token: "code",
      },
    ];

    const outcomes = predictFromActions(actions, currentTree, context, {
      finalState: "iterating",
    });

    expect(outcomes[0]?.issue.body.historyEntries[0]?.phase).toBe("1");
  });
});
