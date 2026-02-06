import { describe, it, expect } from "vitest";
import { computeDiff } from "../src/diff.js";
import type { IssueData } from "../src/schemas/index.js";
import { parseMarkdown } from "../src/markdown/ast.js";

function makeIssue(overrides: Partial<IssueData> = {}): IssueData {
  return {
    number: 1,
    title: "Test Issue",
    state: "OPEN",
    bodyAst: parseMarkdown("Test description"),
    projectStatus: "In progress",
    iteration: 1,
    failures: 0,
    assignees: ["user1"],
    labels: ["bug"],
    subIssues: [],
    hasSubIssues: false,
    comments: [],
    branch: "claude/issue/1",
    pr: null,
    parentIssueNumber: null,
    ...overrides,
  };
}

describe("computeDiff", () => {
  it("detects no changes", () => {
    const issue = makeIssue();
    const diff = computeDiff(issue, { ...issue });
    expect(diff.bodyChanged).toBe(false);
    expect(diff.titleChanged).toBe(false);
    expect(diff.stateChanged).toBe(false);
    expect(diff.labelsAdded).toEqual([]);
    expect(diff.labelsRemoved).toEqual([]);
    expect(diff.assigneesAdded).toEqual([]);
    expect(diff.assigneesRemoved).toEqual([]);
    expect(diff.projectStatusChanged).toBe(false);
    expect(diff.iterationChanged).toBe(false);
    expect(diff.failuresChanged).toBe(false);
  });

  it("detects title change", () => {
    const original = makeIssue();
    const updated = makeIssue({ title: "Updated Title" });
    const diff = computeDiff(original, updated);
    expect(diff.titleChanged).toBe(true);
  });

  it("detects state change", () => {
    const original = makeIssue();
    const updated = makeIssue({ state: "CLOSED" });
    const diff = computeDiff(original, updated);
    expect(diff.stateChanged).toBe(true);
  });

  it("detects labels added", () => {
    const original = makeIssue({ labels: ["bug"] });
    const updated = makeIssue({ labels: ["bug", "enhancement"] });
    const diff = computeDiff(original, updated);
    expect(diff.labelsAdded).toEqual(["enhancement"]);
    expect(diff.labelsRemoved).toEqual([]);
  });

  it("detects labels removed", () => {
    const original = makeIssue({ labels: ["bug", "enhancement"] });
    const updated = makeIssue({ labels: ["bug"] });
    const diff = computeDiff(original, updated);
    expect(diff.labelsAdded).toEqual([]);
    expect(diff.labelsRemoved).toEqual(["enhancement"]);
  });

  it("detects assignees added and removed", () => {
    const original = makeIssue({ assignees: ["user1", "user2"] });
    const updated = makeIssue({ assignees: ["user1", "user3"] });
    const diff = computeDiff(original, updated);
    expect(diff.assigneesAdded).toEqual(["user3"]);
    expect(diff.assigneesRemoved).toEqual(["user2"]);
  });

  it("detects project status change", () => {
    const original = makeIssue({ projectStatus: "In progress" });
    const updated = makeIssue({ projectStatus: "Done" });
    const diff = computeDiff(original, updated);
    expect(diff.projectStatusChanged).toBe(true);
  });

  it("detects iteration change", () => {
    const original = makeIssue({ iteration: 1 });
    const updated = makeIssue({ iteration: 2 });
    const diff = computeDiff(original, updated);
    expect(diff.iterationChanged).toBe(true);
  });

  it("detects failures change", () => {
    const original = makeIssue({ failures: 0 });
    const updated = makeIssue({ failures: 1 });
    const diff = computeDiff(original, updated);
    expect(diff.failuresChanged).toBe(true);
  });

  it("detects body change via different AST", () => {
    const original = makeIssue({ bodyAst: parseMarkdown("Old content") });
    const updated = makeIssue({ bodyAst: parseMarkdown("New content") });
    const diff = computeDiff(original, updated);
    expect(diff.bodyChanged).toBe(true);
  });
});
