import { describe, it, expect } from "vitest";
import { parseMarkdown } from "@more/issue-state";
import type { MachineContext } from "../../src/schemas/state.js";
import { extractPredictableTree } from "../../src/verify/predictable-state.js";
import { getMutator } from "../../src/verify/mutators/index.js";
import { HISTORY_ICONS, HISTORY_MESSAGES } from "../../src/constants.js";

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

    // Both outcomes should have triaged label and correct body structure
    for (const outcome of outcomes) {
      expect(outcome.issue.labels).toContain("triaged");
      expect(outcome.issue.body.hasDescription).toBe(false);
      expect(outcome.issue.body.hasRequirements).toBe(true);
      expect(outcome.issue.body.hasApproach).toBe(true);
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
  });
});
