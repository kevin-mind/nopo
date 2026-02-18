import { describe, expect, it, vi } from "vitest";
import {
  applyGrooming,
  applyTriage,
  reconcileSubIssues,
  setIssueStatus,
} from "../../src/machines/example/commands.js";
import type {
  ExampleContext,
  IssueStateRepository,
} from "../../src/machines/example/context.js";
import { mockExampleContext, mockExampleIssue } from "./mock-factories.js";

describe("example commands", () => {
  it("uses injected repository when present", () => {
    const repository: IssueStateRepository = {
      setIssueStatus: vi.fn(),
      addIssueLabels: vi.fn(),
      reconcileSubIssues: vi.fn(),
    };
    const context = mockExampleContext({ repository });

    setIssueStatus(context, "Blocked");
    applyTriage(context, ["triaged"]);
    applyGrooming(context, ["groomed"]);
    reconcileSubIssues(context, [101, 102]);

    expect(repository.setIssueStatus).toHaveBeenCalledWith("Blocked");
    expect(repository.addIssueLabels).toHaveBeenCalledWith(["triaged"]);
    expect(repository.addIssueLabels).toHaveBeenCalledWith(["groomed"]);
    expect(repository.reconcileSubIssues).toHaveBeenCalledWith([101, 102]);
  });

  it("falls back to in-memory mutation without repository", () => {
    const context: ExampleContext = mockExampleContext({
      issue: mockExampleIssue({
        labels: ["existing"],
        subIssues: [
          { number: 100, projectStatus: "In progress", state: "OPEN" },
          { number: 200, projectStatus: "Done", state: "CLOSED" },
        ],
        hasSubIssues: true,
      }),
      repository: undefined,
    });

    setIssueStatus(context, "In review");
    applyTriage(context, ["triaged", "existing"]);
    applyGrooming(context, ["groomed"]);
    reconcileSubIssues(context, [200, 300]);

    expect(context.issue.projectStatus).toBe("In review");
    expect(context.issue.labels).toEqual(["existing", "triaged", "groomed"]);
    expect(context.issue.hasSubIssues).toBe(true);
    expect(context.issue.subIssues).toEqual([
      { number: 200, projectStatus: "Done", state: "CLOSED" },
      { number: 300, projectStatus: "Backlog", state: "OPEN" },
    ]);
  });
});
