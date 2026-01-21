/**
 * Tests to ensure fixtures are valid against zod schemas
 */
import { describe, test, expect } from "vitest";
import {
  MachineContextSchema,
  ParentIssueSchema,
  SubIssueSchema,
  LinkedPRSchema,
  TodoStatsSchema,
  HistoryEntrySchema,
} from "../../schemas/state.js";
import {
  createContext,
  createParentIssue,
  createSubIssue,
  createLinkedPR,
  createTodoStats,
  createHistoryEntry,
  createNewIssueContext,
  createCISuccessContext,
  createCIFailureContext,
  createReviewContext,
  createMultiPhaseContext,
  createTodosContext,
  createMaxFailuresContext,
  DEFAULT_TODO_STATS,
  DEFAULT_SUB_ISSUE,
  DEFAULT_PARENT_ISSUE,
  DEFAULT_PR,
} from "./index.js";

describe("Default fixtures validate against schemas", () => {
  test("DEFAULT_TODO_STATS is valid", () => {
    const result = TodoStatsSchema.safeParse(DEFAULT_TODO_STATS);
    expect(result.success).toBe(true);
  });

  test("DEFAULT_SUB_ISSUE is valid", () => {
    const result = SubIssueSchema.safeParse(DEFAULT_SUB_ISSUE);
    expect(result.success).toBe(true);
  });

  test("DEFAULT_PARENT_ISSUE is valid", () => {
    const result = ParentIssueSchema.safeParse(DEFAULT_PARENT_ISSUE);
    expect(result.success).toBe(true);
  });

  test("DEFAULT_PR is valid", () => {
    const result = LinkedPRSchema.safeParse(DEFAULT_PR);
    expect(result.success).toBe(true);
  });
});

describe("Factory functions produce valid schemas", () => {
  describe("createTodoStats", () => {
    test("default is valid", () => {
      const result = TodoStatsSchema.safeParse(createTodoStats());
      expect(result.success).toBe(true);
    });

    test("with overrides is valid", () => {
      const result = TodoStatsSchema.safeParse(
        createTodoStats({ total: 5, completed: 3, uncheckedNonManual: 2 }),
      );
      expect(result.success).toBe(true);
    });
  });

  describe("createLinkedPR", () => {
    test("default is valid", () => {
      const result = LinkedPRSchema.safeParse(createLinkedPR());
      expect(result.success).toBe(true);
    });

    test("with overrides is valid", () => {
      const result = LinkedPRSchema.safeParse(
        createLinkedPR({ number: 42, isDraft: false, state: "MERGED" }),
      );
      expect(result.success).toBe(true);
    });
  });

  describe("createSubIssue", () => {
    test("default is valid", () => {
      const result = SubIssueSchema.safeParse(createSubIssue());
      expect(result.success).toBe(true);
    });

    test("with custom number is valid", () => {
      const result = SubIssueSchema.safeParse(createSubIssue({ number: 42 }));
      expect(result.success).toBe(true);
      expect(result.data?.number).toBe(42);
    });

    test("with custom todos is valid", () => {
      const result = SubIssueSchema.safeParse(
        createSubIssue({
          todos: { total: 5, completed: 3, uncheckedNonManual: 2 },
        }),
      );
      expect(result.success).toBe(true);
    });

    test("with PR is valid", () => {
      const result = SubIssueSchema.safeParse(
        createSubIssue({ pr: createLinkedPR({ number: 100 }) }),
      );
      expect(result.success).toBe(true);
    });
  });

  describe("createParentIssue", () => {
    test("default is valid", () => {
      const result = ParentIssueSchema.safeParse(createParentIssue());
      expect(result.success).toBe(true);
    });

    test("with sub-issues is valid", () => {
      const result = ParentIssueSchema.safeParse(
        createParentIssue({
          subIssues: [
            createSubIssue({ number: 1 }),
            createSubIssue({ number: 2 }),
          ],
        }),
      );
      expect(result.success).toBe(true);
      expect(result.data?.hasSubIssues).toBe(true);
      expect(result.data?.subIssues.length).toBe(2);
    });

    test("with partial sub-issue overrides is valid", () => {
      const result = ParentIssueSchema.safeParse(
        createParentIssue({
          subIssues: [
            { title: "Phase 1", projectStatus: "Working" },
            { title: "Phase 2", projectStatus: "Ready" },
          ],
        }),
      );
      expect(result.success).toBe(true);
      expect(result.data?.subIssues[0].title).toBe("Phase 1");
    });
  });

  describe("createHistoryEntry", () => {
    test("default is valid", () => {
      const result = HistoryEntrySchema.safeParse(createHistoryEntry());
      expect(result.success).toBe(true);
    });

    test("with all fields is valid", () => {
      const result = HistoryEntrySchema.safeParse(
        createHistoryEntry({
          iteration: 5,
          phase: "2",
          action: "CI passed",
          sha: "abc123",
          runLink: "https://github.com/run/1",
        }),
      );
      expect(result.success).toBe(true);
    });
  });

  describe("createContext", () => {
    test("default is valid", () => {
      const result = MachineContextSchema.safeParse(createContext());
      expect(result.success).toBe(true);
    });

    test("with all fields is valid", () => {
      const result = MachineContextSchema.safeParse(
        createContext({
          trigger: "workflow_run_completed",
          owner: "my-org",
          repo: "my-repo",
          issue: { number: 123, title: "My Issue" },
          ciResult: "success",
          ciRunUrl: "https://github.com/run/1",
          ciCommitSha: "abc123",
          branch: "feature/test",
          hasBranch: true,
          pr: { number: 42 },
          hasPR: true,
          maxRetries: 10,
          botUsername: "my-bot",
        }),
      );
      expect(result.success).toBe(true);
    });

    test("with multi-phase issue is valid", () => {
      const result = MachineContextSchema.safeParse(
        createContext({
          issue: {
            subIssues: [
              { number: 1, projectStatus: "Done", state: "CLOSED" },
              { number: 2, projectStatus: "Working", state: "OPEN" },
              { number: 3, projectStatus: "Ready", state: "OPEN" },
            ],
          },
          currentPhase: 2,
          currentSubIssue: { number: 2, projectStatus: "Working" },
        }),
      );
      expect(result.success).toBe(true);
    });
  });
});

describe("Scenario fixtures validate against schemas", () => {
  test("createNewIssueContext is valid", () => {
    const result = MachineContextSchema.safeParse(createNewIssueContext());
    expect(result.success).toBe(true);
    expect(result.data?.trigger).toBe("issue_assigned");
    expect(result.data?.issue.projectStatus).toBe("Working");
  });

  test("createCISuccessContext is valid", () => {
    const result = MachineContextSchema.safeParse(createCISuccessContext());
    expect(result.success).toBe(true);
    expect(result.data?.trigger).toBe("workflow_run_completed");
    expect(result.data?.ciResult).toBe("success");
  });

  test("createCIFailureContext is valid", () => {
    const result = MachineContextSchema.safeParse(createCIFailureContext());
    expect(result.success).toBe(true);
    expect(result.data?.trigger).toBe("workflow_run_completed");
    expect(result.data?.ciResult).toBe("failure");
  });

  test("createReviewContext with APPROVED is valid", () => {
    const result = MachineContextSchema.safeParse(
      createReviewContext("APPROVED"),
    );
    expect(result.success).toBe(true);
    expect(result.data?.trigger).toBe("pr_review_submitted");
    expect(result.data?.reviewDecision).toBe("APPROVED");
  });

  test("createReviewContext with CHANGES_REQUESTED is valid", () => {
    const result = MachineContextSchema.safeParse(
      createReviewContext("CHANGES_REQUESTED"),
    );
    expect(result.success).toBe(true);
    expect(result.data?.reviewDecision).toBe("CHANGES_REQUESTED");
  });

  test("createMultiPhaseContext is valid", () => {
    const result = MachineContextSchema.safeParse(
      createMultiPhaseContext([
        { projectStatus: "Done", state: "CLOSED" },
        { projectStatus: "Working", state: "OPEN" },
        { projectStatus: "Ready", state: "OPEN" },
      ]),
    );
    expect(result.success).toBe(true);
    expect(result.data?.issue.subIssues.length).toBe(3);
    expect(result.data?.currentPhase).toBe(2);
    expect(result.data?.currentSubIssue?.number).toBe(2);
  });

  test("createTodosContext is valid", () => {
    const result = MachineContextSchema.safeParse(createTodosContext(5, 3));
    expect(result.success).toBe(true);
    expect(result.data?.currentSubIssue?.todos.total).toBe(5);
    expect(result.data?.currentSubIssue?.todos.completed).toBe(3);
    expect(result.data?.currentSubIssue?.todos.uncheckedNonManual).toBe(2);
  });

  test("createMaxFailuresContext is valid", () => {
    const result = MachineContextSchema.safeParse(createMaxFailuresContext());
    expect(result.success).toBe(true);
    expect(result.data?.issue.failures).toBe(result.data?.maxRetries);
  });

  test("createMaxFailuresContext with custom maxRetries is valid", () => {
    const result = MachineContextSchema.safeParse(
      createMaxFailuresContext({ maxRetries: 3 }),
    );
    expect(result.success).toBe(true);
    expect(result.data?.issue.failures).toBe(3);
    expect(result.data?.maxRetries).toBe(3);
  });
});
