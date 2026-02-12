import { describe, it, expect } from "vitest";
import { parseMarkdown } from "@more/issue-state";
import type { MachineContext } from "../../src/schemas/state.js";
import { extractPredictableTree } from "../../src/verify/predictable-state.js";
import { getMutator } from "../../src/verify/mutators/index.js";
import { HISTORY_ICONS, HISTORY_MESSAGES } from "../../src/constants.js";
import {
  successEntry,
  ITER_OPENED_PR,
  ITER_UPDATED_PR,
  ITER_FIXED_CI,
  ITER_REBASED,
} from "../../src/verify/mutators/helpers.js";

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

describe("getMutator", () => {
  it("returns mutator for known states", () => {
    expect(getMutator("done")).toBeDefined();
    expect(getMutator("blocked")).toBeDefined();
    expect(getMutator("iterating")).toBeDefined();
    expect(getMutator("triaging")).toBeDefined();
  });

  it("returns undefined for unknown states", () => {
    expect(getMutator("nonexistent")).toBeUndefined();
  });
});

describe("terminal mutators", () => {
  it("done: sets Done + CLOSED", () => {
    const context = makeContext();
    const tree = extractPredictableTree(context);
    const mutator = getMutator("done")!;
    const outcomes = mutator(tree, context);

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.issue.projectStatus).toBe("Done");
    expect(outcomes[0]!.issue.state).toBe("CLOSED");
  });

  it("blocked: sets Blocked and removes bot", () => {
    const context = makeContext({
      issue: {
        number: 100,
        title: "Test",
        state: "OPEN" as const,
        bodyAst: parseMarkdown("## Description\n\nTest."),
        projectStatus: "In progress" as const,
        iteration: 3,
        failures: 5,
        assignees: ["nopo-bot"],
        labels: [],
        subIssues: [],
        hasSubIssues: false,
        comments: [],
        branch: null,
        pr: null,
        parentIssueNumber: null,
      },
    });
    const tree = extractPredictableTree(context);
    const mutator = getMutator("blocked")!;
    const outcomes = mutator(tree, context);

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.issue.projectStatus).toBe("Blocked");
    expect(outcomes[0]!.issue.assignees).not.toContain("nopo-bot");

    // Check history entry uses HISTORY_ICONS
    const lastEntry =
      outcomes[0]!.issue.body.historyEntries[
        outcomes[0]!.issue.body.historyEntries.length - 1
      ];
    expect(lastEntry?.action).toContain(HISTORY_ICONS.BLOCKED);
  });

  it("error: sets Error status", () => {
    const context = makeContext();
    const tree = extractPredictableTree(context);
    const mutator = getMutator("error")!;
    const outcomes = mutator(tree, context);

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.issue.projectStatus).toBe("Error");
  });
});

describe("logging mutators", () => {
  it("mergeQueueLogging: adds queue entry history", () => {
    const context = makeContext();
    const tree = extractPredictableTree(context);
    const mutator = getMutator("mergeQueueLogging")!;
    const outcomes = mutator(tree, context);

    expect(outcomes).toHaveLength(1);
    const lastEntry =
      outcomes[0]!.issue.body.historyEntries[
        outcomes[0]!.issue.body.historyEntries.length - 1
      ];
    expect(lastEntry?.action).toBe(HISTORY_MESSAGES.ENTERED_QUEUE);
  });

  it("deployedStageLogging: adds deploy history", () => {
    const context = makeContext();
    const tree = extractPredictableTree(context);
    const mutator = getMutator("deployedStageLogging")!;
    const outcomes = mutator(tree, context);

    const lastEntry =
      outcomes[0]!.issue.body.historyEntries[
        outcomes[0]!.issue.body.historyEntries.length - 1
      ];
    expect(lastEntry?.action).toBe(HISTORY_MESSAGES.DEPLOYED_STAGE);
  });
});

describe("AI-dependent mutators", () => {
  it("triaging: two outcomes (with/without questions), correct body structure", () => {
    const context = makeContext({
      issue: {
        number: 100,
        title: "Test",
        state: "OPEN" as const,
        bodyAst: parseMarkdown("## Description\n\nNew issue."),
        projectStatus: null,
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
      },
    });
    const tree = extractPredictableTree(context);
    const mutator = getMutator("triaging")!;
    const outcomes = mutator(tree, context);

    expect(outcomes).toHaveLength(2);

    // Both outcomes should have triaged label, correct body structure, and history entry
    for (const outcome of outcomes) {
      expect(outcome.issue.labels).toContain("triaged");
      expect(outcome.issue.body.hasDescription).toBe(false);
      expect(outcome.issue.body.hasRequirements).toBe(true);
      expect(outcome.issue.body.hasApproach).toBe(true);

      const lastEntry =
        outcome.issue.body.historyEntries[
          outcome.issue.body.historyEntries.length - 1
        ];
      expect(lastEntry?.action).toBe(successEntry("triaging"));
    }

    // Outcome 0: with questions
    expect(outcomes[0]!.issue.body.hasQuestions).toBe(true);
    // Outcome 1: without questions
    expect(outcomes[1]!.issue.body.hasQuestions).toBe(false);
  });

  it("grooming: three possible outcomes, status unchanged for ready", () => {
    // Grooming typically runs on Backlog parent issues
    const context = makeContext({
      issue: {
        number: 100,
        title: "Test",
        state: "OPEN" as const,
        bodyAst: parseMarkdown("## Description\n\nTest."),
        projectStatus: "Backlog" as const,
        iteration: 0,
        failures: 0,
        assignees: ["nopo-bot"],
        labels: ["triaged"],
        subIssues: [],
        hasSubIssues: false,
        comments: [],
        branch: null,
        pr: null,
        parentIssueNumber: null,
      },
    });
    const tree = extractPredictableTree(context);
    const mutator = getMutator("grooming")!;
    const outcomes = mutator(tree, context);

    expect(outcomes).toHaveLength(3);
    // Outcome 1: groomed — label added, projectStatus stays Backlog
    expect(outcomes[0]!.issue.labels).toContain("groomed");
    expect(outcomes[0]!.issue.projectStatus).toBe("Backlog");
    // Outcome 2: needs-info
    expect(outcomes[1]!.issue.labels).toContain("needs-info");
    expect(outcomes[1]!.issue.projectStatus).toBe("Backlog");
    // Outcome 3: blocked
    expect(outcomes[2]!.issue.projectStatus).toBe("Blocked");

    // All outcomes should have a grooming history entry
    for (const outcome of outcomes) {
      const lastEntry =
        outcome.issue.body.historyEntries[
          outcome.issue.body.historyEntries.length - 1
        ];
      expect(lastEntry?.action).toBe(successEntry("grooming"));
    }
  });
});

describe("iteration mutators", () => {
  it("iterating: three outcomes (opened PR, updated PR, rebased)", () => {
    const sub = {
      number: 101,
      title: "[Phase 1]: Sub",
      state: "OPEN" as const,
      bodyAst: parseMarkdown("## Description\n\nSub."),
      projectStatus: "In progress" as const,
      assignees: new Array<string>(),
      labels: new Array<string>(),
      branch: null,
      pr: null,
    };
    const context = makeContext({
      currentPhase: 1,
      currentSubIssue: sub,
      issue: {
        number: 100,
        title: "Test",
        state: "OPEN" as const,
        bodyAst: parseMarkdown("## Description\n\nTest."),
        projectStatus: "In progress" as const,
        iteration: 1,
        failures: 0,
        assignees: ["nopo-bot"],
        labels: ["triaged"],
        subIssues: [
          {
            number: 101,
            title: "[Phase 1]: Sub",
            state: "OPEN" as const,
            bodyAst: parseMarkdown("## Description\n\nSub."),
            projectStatus: "In progress" as const,
            assignees: [],
            labels: [],
            branch: null,
            pr: null,
          },
        ],
        hasSubIssues: true,
        comments: [],
        branch: null,
        pr: null,
        parentIssueNumber: null,
      },
    });
    const tree = extractPredictableTree(context);
    const mutator = getMutator("iterating")!;
    const outcomes = mutator(tree, context);

    expect(outcomes).toHaveLength(3);

    // Outcome 0: Opened PR
    const openedEntry =
      outcomes[0]!.issue.body.historyEntries[
        outcomes[0]!.issue.body.historyEntries.length - 1
      ];
    expect(openedEntry?.action).toBe(ITER_OPENED_PR);
    expect(outcomes[0]!.subIssues[0]?.hasPR).toBe(true);
    expect(outcomes[0]!.subIssues[0]?.hasBranch).toBe(true);

    // Outcome 1: Updated PR
    const updatedEntry =
      outcomes[1]!.issue.body.historyEntries[
        outcomes[1]!.issue.body.historyEntries.length - 1
      ];
    expect(updatedEntry?.action).toBe(ITER_UPDATED_PR);
    expect(outcomes[1]!.subIssues[0]?.hasPR).toBe(true);

    // Outcome 2: Rebased (no structural changes to sub-issue)
    const rebasedEntry =
      outcomes[2]!.issue.body.historyEntries[
        outcomes[2]!.issue.body.historyEntries.length - 1
      ];
    expect(rebasedEntry?.action).toBe(ITER_REBASED);
    // Rebase doesn't change sub-issue PR/status state
    expect(outcomes[2]!.subIssues[0]?.projectStatus).toBe("In progress");
  });

  it("iteratingFix: two outcomes (fixed CI, rebased)", () => {
    const sub = {
      number: 101,
      title: "[Phase 1]: Sub",
      state: "OPEN" as const,
      bodyAst: parseMarkdown("## Description\n\nSub."),
      projectStatus: "In progress" as const,
      assignees: new Array<string>(),
      labels: new Array<string>(),
      branch: null,
      pr: null,
    };
    const context = makeContext({
      currentPhase: 1,
      currentSubIssue: sub,
      issue: {
        number: 100,
        title: "Test",
        state: "OPEN" as const,
        bodyAst: parseMarkdown("## Description\n\nTest."),
        projectStatus: "In progress" as const,
        iteration: 2,
        failures: 1,
        assignees: ["nopo-bot"],
        labels: ["triaged"],
        subIssues: [
          {
            number: 101,
            title: "[Phase 1]: Sub",
            state: "OPEN" as const,
            bodyAst: parseMarkdown("## Description\n\nSub."),
            projectStatus: "In progress" as const,
            assignees: [],
            labels: [],
            branch: null,
            pr: null,
          },
        ],
        hasSubIssues: true,
        comments: [],
        branch: null,
        pr: null,
        parentIssueNumber: null,
      },
    });
    const tree = extractPredictableTree(context);
    const mutator = getMutator("iteratingFix")!;
    const outcomes = mutator(tree, context);

    expect(outcomes).toHaveLength(2);

    // Outcome 0: Fixed CI
    const fixedEntry =
      outcomes[0]!.issue.body.historyEntries[
        outcomes[0]!.issue.body.historyEntries.length - 1
      ];
    expect(fixedEntry?.action).toBe(ITER_FIXED_CI);
    expect(outcomes[0]!.subIssues[0]?.hasPR).toBe(true);

    // Outcome 1: Rebased
    const rebasedEntry =
      outcomes[1]!.issue.body.historyEntries[
        outcomes[1]!.issue.body.historyEntries.length - 1
      ];
    expect(rebasedEntry?.action).toBe(ITER_REBASED);
  });
});

describe("orchestration mutators", () => {
  it("orchestrationComplete: sets Done + CLOSED with history", () => {
    const context = makeContext();
    const tree = extractPredictableTree(context);
    const mutator = getMutator("orchestrationComplete")!;
    const outcomes = mutator(tree, context);

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.issue.projectStatus).toBe("Done");
    expect(outcomes[0]!.issue.state).toBe("CLOSED");
    const lastEntry =
      outcomes[0]!.issue.body.historyEntries[
        outcomes[0]!.issue.body.historyEntries.length - 1
      ];
    expect(lastEntry?.action).toBe(HISTORY_MESSAGES.ALL_PHASES_COMPLETE);
  });
});

describe("control mutators", () => {
  it("resetting: resets to Backlog, clears failures", () => {
    const context = makeContext({
      issue: {
        number: 100,
        title: "Test",
        state: "OPEN" as const,
        bodyAst: parseMarkdown("## Description\n\nTest."),
        projectStatus: "Blocked" as const,
        iteration: 5,
        failures: 5,
        assignees: ["nopo-bot"],
        labels: [],
        subIssues: [
          {
            number: 101,
            title: "[Phase 1]: Sub",
            state: "OPEN" as const,
            bodyAst: parseMarkdown("## Description\n\nSub."),
            projectStatus: "In progress" as const,
            assignees: [],
            labels: [],
            branch: null,
            pr: null,
          },
        ],
        hasSubIssues: true,
        comments: [],
        branch: null,
        pr: null,
        parentIssueNumber: null,
      },
    });
    const tree = extractPredictableTree(context);
    const mutator = getMutator("resetting")!;
    const outcomes = mutator(tree, context);

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.issue.projectStatus).toBe("Backlog");
    expect(outcomes[0]!.issue.failures).toBe(0);
    expect(outcomes[0]!.issue.assignees).not.toContain("nopo-bot");
    expect(outcomes[0]!.subIssues[0]?.projectStatus).toBeNull();

    const lastEntry =
      outcomes[0]!.issue.body.historyEntries[
        outcomes[0]!.issue.body.historyEntries.length - 1
      ];
    expect(lastEntry?.action).toBe(successEntry("resetting"));
  });
});
