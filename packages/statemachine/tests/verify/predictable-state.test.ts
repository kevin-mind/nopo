import { describe, it, expect } from "vitest";
import { parseMarkdown } from "@more/issue-state";
import type { MachineContext } from "../../src/schemas/state.js";
import {
  extractPredictableTree,
  buildExpectedState,
} from "../../src/verify/predictable-state.js";

/**
 * Create a minimal MachineContext for testing.
 */
function makeContext(overrides: Partial<MachineContext> = {}): MachineContext {
  const defaultIssue = {
    number: 100,
    title: "Test Issue",
    state: "OPEN" as const,
    bodyAst: parseMarkdown(
      "## Description\n\nTest body.\n\n## Todos\n\n- [ ] Task 1\n- [x] Task 2",
    ),
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

describe("extractPredictableTree", () => {
  it("extracts tree from issue without parent", () => {
    const context = makeContext();
    const tree = extractPredictableTree(context);

    expect(tree.issue.number).toBe(100);
    expect(tree.issue.state).toBe("OPEN");
    expect(tree.issue.projectStatus).toBe("In progress");
    expect(tree.issue.iteration).toBe(1);
    expect(tree.issue.labels).toContain("triaged");
    expect(tree.issue.assignees).toContain("nopo-bot");
    expect(tree.issue.body.hasDescription).toBe(true);
    expect(tree.issue.body.hasTodos).toBe(true);
    expect(tree.issue.body.todoStats?.total).toBe(2);
    expect(tree.issue.body.todoStats?.completed).toBe(1);
    expect(tree.subIssues).toHaveLength(0);
  });

  it("extracts tree from sub-issue with parent", () => {
    const parentIssue = {
      number: 100,
      title: "Parent Issue",
      state: "OPEN" as const,
      bodyAst: parseMarkdown("## Description\n\nParent body."),
      projectStatus: "In progress" as const,
      iteration: 1,
      failures: 0,
      assignees: ["nopo-bot"],
      labels: ["triaged"],
      subIssues: [
        {
          number: 101,
          title: "[Phase 1]: Sub issue",
          state: "OPEN" as const,
          bodyAst: parseMarkdown(
            "## Description\n\nSub body.\n\n## Todos\n\n- [ ] Sub task",
          ),
          projectStatus: "In progress" as const,
          labels: ["triaged"],
          branch: "claude/issue/101/1",
          pr: null,
        },
      ],
      hasSubIssues: true,
      comments: [],
      branch: null,
      pr: null,
      parentIssueNumber: null,
    };

    const context = makeContext({
      parentIssue,
      issue: {
        ...parentIssue.subIssues[0]!,
        iteration: 1,
        failures: 0,
        assignees: ["nopo-bot"],
        subIssues: [],
        hasSubIssues: false,
        comments: [],
        parentIssueNumber: 100,
      },
      currentPhase: 1,
      totalPhases: 1,
      currentSubIssue: parentIssue.subIssues[0]!,
    });

    const tree = extractPredictableTree(context);

    // Root should be the parent
    expect(tree.issue.number).toBe(100);
    expect(tree.issue.body.hasDescription).toBe(true);

    // Sub-issues should include the sub-issue
    expect(tree.subIssues).toHaveLength(1);
    expect(tree.subIssues[0]?.number).toBe(101);
    expect(tree.subIssues[0]?.body.hasTodos).toBe(true);
    expect(tree.subIssues[0]?.hasBranch).toBe(true);
  });

  it("extracts PR state", () => {
    const context = makeContext({
      issue: {
        number: 100,
        title: "Test",
        state: "OPEN" as const,
        bodyAst: parseMarkdown("## Description\n\nBody."),
        projectStatus: "In review" as const,
        iteration: 2,
        failures: 0,
        assignees: ["nopo-bot"],
        labels: ["triaged"],
        subIssues: [],
        hasSubIssues: false,
        comments: [],
        branch: "claude/issue/100",
        pr: {
          number: 50,
          state: "OPEN" as const,
          isDraft: false,
          title: "Fix: something",
          headRef: "claude/issue/100",
          baseRef: "main",
          labels: [],
          reviews: [],
        },
        parentIssueNumber: null,
      },
    });

    const tree = extractPredictableTree(context);
    expect(tree.issue.hasPR).toBe(true);
    expect(tree.issue.pr?.isDraft).toBe(false);
    expect(tree.issue.pr?.state).toBe("OPEN");
  });
});

describe("buildExpectedState", () => {
  it("builds expected state with metadata", () => {
    const context = makeContext();
    const tree = extractPredictableTree(context);

    const expected = buildExpectedState({
      finalState: "iterating",
      outcomes: [tree],
      trigger: "issue-assigned",
      issueNumber: 100,
      parentIssueNumber: null,
    });

    expect(expected.finalState).toBe("iterating");
    expect(expected.outcomes).toHaveLength(1);
    expect(expected.trigger).toBe("issue-assigned");
    expect(expected.issueNumber).toBe(100);
    expect(expected.parentIssueNumber).toBeNull();
    expect(expected.timestamp).toBeDefined();
  });
});
