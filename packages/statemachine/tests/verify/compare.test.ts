import { describe, it, expect } from "vitest";
import { parseMarkdown } from "@more/issue-state";
import { compareStateTree } from "../../src/verify/compare.js";
import { extractPredictableTree } from "../../src/verify/predictable-state.js";
import type { MachineContext } from "../../src/schemas/state.js";

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

describe("compareStateTree", () => {
  it("passes when expected matches actual", () => {
    const context = makeContext();
    const tree = extractPredictableTree(context);
    const result = compareStateTree([tree], tree);

    expect(result.pass).toBe(true);
    expect(result.matchedOutcomeIndex).toBe(0);
    expect(result.bestMatch.diffs).toHaveLength(0);
  });

  it("passes with empty expected outcomes", () => {
    const context = makeContext();
    const tree = extractPredictableTree(context);
    const result = compareStateTree([], tree);

    expect(result.pass).toBe(true);
  });

  it("fails when projectStatus differs", () => {
    const context = makeContext();
    const tree = extractPredictableTree(context);
    const expected = structuredClone(tree);
    expected.issue.projectStatus = "Done";

    const result = compareStateTree([expected], tree);

    expect(result.pass).toBe(false);
    expect(result.bestMatch.diffs.length).toBeGreaterThan(0);
    const statusDiff = result.bestMatch.diffs.find(
      (d) => d.path === "issue.projectStatus",
    );
    expect(statusDiff).toBeDefined();
    expect(statusDiff?.expected).toBe("Done");
    expect(statusDiff?.actual).toBe("In progress");
  });

  it("passes when actual iteration >= expected", () => {
    const context = makeContext();
    const tree = extractPredictableTree(context);
    const expected = structuredClone(tree);
    expected.issue.iteration = 0; // lower

    const result = compareStateTree([expected], tree);
    expect(result.pass).toBe(true);
  });

  it("fails when actual iteration < expected", () => {
    const context = makeContext();
    const tree = extractPredictableTree(context);
    const expected = structuredClone(tree);
    expected.issue.iteration = 10; // higher than actual 1

    const result = compareStateTree([expected], tree);
    expect(result.pass).toBe(false);
    const iterDiff = result.bestMatch.diffs.find(
      (d) => d.path === "issue.iteration",
    );
    expect(iterDiff).toBeDefined();
  });

  it("passes for label superset check", () => {
    const context = makeContext({
      issue: {
        number: 100,
        title: "Test",
        state: "OPEN" as const,
        bodyAst: parseMarkdown("## Description\n\nTest."),
        projectStatus: "In progress" as const,
        iteration: 1,
        failures: 0,
        assignees: ["nopo-bot"],
        labels: ["triaged", "bug", "enhancement"],
        subIssues: [],
        hasSubIssues: false,
        comments: [],
        branch: null,
        pr: null,
        parentIssueNumber: null,
      },
    });

    const actual = extractPredictableTree(context);
    const expected = structuredClone(actual);
    expected.issue.labels = ["triaged"]; // subset

    const result = compareStateTree([expected], actual);
    expect(result.pass).toBe(true);
  });

  it("fails when expected labels missing from actual", () => {
    const context = makeContext();
    const actual = extractPredictableTree(context);
    const expected = structuredClone(actual);
    expected.issue.labels = ["triaged", "groomed"]; // groomed missing from actual

    const result = compareStateTree([expected], actual);
    expect(result.pass).toBe(false);
    const labelDiff = result.bestMatch.diffs.find(
      (d) => d.path === "issue.labels",
    );
    expect(labelDiff).toBeDefined();
  });

  it("passes when ANY outcome matches (union)", () => {
    const context = makeContext();
    const actual = extractPredictableTree(context);

    // Outcome 1: wrong status
    const outcome1 = structuredClone(actual);
    outcome1.issue.projectStatus = "Done";

    // Outcome 2: matches actual
    const outcome2 = structuredClone(actual);

    const result = compareStateTree([outcome1, outcome2], actual);
    expect(result.pass).toBe(true);
    expect(result.matchedOutcomeIndex).toBe(1);
  });

  it("fails when no outcome matches, reports best match", () => {
    const context = makeContext();
    const actual = extractPredictableTree(context);

    // Outcome 1: wrong status (1 diff)
    const outcome1 = structuredClone(actual);
    outcome1.issue.projectStatus = "Done";

    // Outcome 2: wrong status AND wrong state (2+ diffs)
    const outcome2 = structuredClone(actual);
    outcome2.issue.projectStatus = "Done";
    outcome2.issue.state = "CLOSED";

    const result = compareStateTree([outcome1, outcome2], actual);
    expect(result.pass).toBe(false);
    // Best match should be outcome 1 (fewer diffs)
    expect(result.bestMatch.outcomeIndex).toBe(0);
  });

  it("compares sub-issues by number", () => {
    const context = makeContext({
      issue: {
        number: 100,
        title: "Test",
        state: "OPEN" as const,
        bodyAst: parseMarkdown("## Description\n\nTest."),
        projectStatus: "In progress" as const,
        iteration: 1,
        failures: 0,
        assignees: [],
        labels: [],
        subIssues: [
          {
            number: 101,
            title: "Sub 1",
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

    const actual = extractPredictableTree(context);
    const expected = structuredClone(actual);
    expected.subIssues[0]!.projectStatus = "Done";

    const result = compareStateTree([expected], actual);
    expect(result.pass).toBe(false);
    const subDiff = result.bestMatch.diffs.find((d) =>
      d.path.includes("subIssues[101]"),
    );
    expect(subDiff).toBeDefined();
  });

  it("handles boolean flag comparison (only check when expected=true)", () => {
    const context = makeContext();
    const actual = extractPredictableTree(context);

    // Expected hasBranch=false, actual hasBranch=false -> pass
    const expected1 = structuredClone(actual);
    expected1.issue.hasBranch = false;
    expect(compareStateTree([expected1], actual).pass).toBe(true);

    // Expected hasBranch=true, actual hasBranch=false -> fail
    const expected2 = structuredClone(actual);
    expected2.issue.hasBranch = true;
    expect(compareStateTree([expected2], actual).pass).toBe(false);
  });

  it("compares history entries by prefix match", () => {
    const context = makeContext({
      issue: {
        number: 100,
        title: "Test",
        state: "OPEN" as const,
        bodyAst: parseMarkdown(
          [
            "## Description",
            "",
            "Test.",
            "",
            "## Iteration History",
            "",
            "| Time | # | Phase | Action | SHA | Run |",
            "| --- | --- | --- | --- | --- | --- |",
            "| Jan 1 00:00 | 1 | 1 | ⏳ Iterating... | - | - |",
            "| Jan 1 00:05 | 1 | 1 | ✅ CI Passed | - | - |",
          ].join("\n"),
        ),
        projectStatus: "In progress" as const,
        iteration: 1,
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

    const actual = extractPredictableTree(context);
    // Expect history entries that match by prefix
    const expected = structuredClone(actual);

    const result = compareStateTree([expected], actual);
    expect(result.pass).toBe(true);
  });
});
