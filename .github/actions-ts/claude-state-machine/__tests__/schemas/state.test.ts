import { describe, test, expect } from "vitest";
import {
  ProjectStatusSchema,
  IssueStateSchema,
  PRStateSchema,
  TodoItemSchema,
  TodoStatsSchema,
  HistoryEntrySchema,
  LinkedPRSchema,
  SubIssueSchema,
  ParentIssueSchema,
  TriggerTypeSchema,
  CIResultSchema,
  ReviewDecisionSchema,
  MachineContextSchema,
  createMachineContext,
  isTerminalStatus,
  isParentStatus,
  isSubIssueStatus,
} from "../../schemas/state.js";

describe("ProjectStatusSchema", () => {
  test("accepts valid parent statuses", () => {
    const parentStatuses = [
      "Backlog",
      "In progress",
      "Done",
      "Blocked",
      "Error",
    ];
    for (const status of parentStatuses) {
      expect(ProjectStatusSchema.parse(status)).toBe(status);
    }
  });

  test("accepts valid sub-issue statuses", () => {
    const subIssueStatuses = ["Ready", "In progress", "In review", "Done"];
    for (const status of subIssueStatuses) {
      expect(ProjectStatusSchema.parse(status)).toBe(status);
    }
  });

  test("rejects invalid statuses", () => {
    expect(() => ProjectStatusSchema.parse("Invalid")).toThrow();
    expect(() => ProjectStatusSchema.parse("")).toThrow();
    expect(() => ProjectStatusSchema.parse(123)).toThrow();
  });
});

describe("IssueStateSchema", () => {
  test("accepts OPEN and CLOSED", () => {
    expect(IssueStateSchema.parse("OPEN")).toBe("OPEN");
    expect(IssueStateSchema.parse("CLOSED")).toBe("CLOSED");
  });

  test("rejects invalid states", () => {
    expect(() => IssueStateSchema.parse("open")).toThrow();
    expect(() => IssueStateSchema.parse("MERGED")).toThrow();
  });
});

describe("PRStateSchema", () => {
  test("accepts OPEN, CLOSED, and MERGED", () => {
    expect(PRStateSchema.parse("OPEN")).toBe("OPEN");
    expect(PRStateSchema.parse("CLOSED")).toBe("CLOSED");
    expect(PRStateSchema.parse("MERGED")).toBe("MERGED");
  });

  test("rejects invalid states", () => {
    expect(() => PRStateSchema.parse("DRAFT")).toThrow();
  });
});

describe("TodoItemSchema", () => {
  test("parses valid todo item", () => {
    const item = { text: "Do something", checked: false, isManual: false };
    expect(TodoItemSchema.parse(item)).toEqual(item);
  });

  test("parses manual todo item", () => {
    const item = { text: "Manual task", checked: false, isManual: true };
    expect(TodoItemSchema.parse(item)).toEqual(item);
  });

  test("rejects missing fields", () => {
    expect(() => TodoItemSchema.parse({ text: "Missing fields" })).toThrow();
  });
});

describe("TodoStatsSchema", () => {
  test("parses valid stats", () => {
    const stats = { total: 5, completed: 2, uncheckedNonManual: 2 };
    expect(TodoStatsSchema.parse(stats)).toEqual(stats);
  });

  test("accepts zero values", () => {
    const stats = { total: 0, completed: 0, uncheckedNonManual: 0 };
    expect(TodoStatsSchema.parse(stats)).toEqual(stats);
  });

  test("rejects negative values", () => {
    expect(() =>
      TodoStatsSchema.parse({ total: -1, completed: 0, uncheckedNonManual: 0 }),
    ).toThrow();
  });

  test("rejects non-integer values", () => {
    expect(() =>
      TodoStatsSchema.parse({
        total: 1.5,
        completed: 0,
        uncheckedNonManual: 0,
      }),
    ).toThrow();
  });
});

describe("HistoryEntrySchema", () => {
  test("parses valid history entry", () => {
    const entry = {
      iteration: 1,
      phase: "Phase 1",
      action: "Initial implementation",
      timestamp: "Jan 22 19:04",
      sha: "abc123",
      runLink: "https://github.com/run/1",
    };
    expect(HistoryEntrySchema.parse(entry)).toEqual(entry);
  });

  test("accepts null sha and runLink", () => {
    const entry = {
      iteration: 0,
      phase: "Init",
      action: "Started",
      timestamp: null,
      sha: null,
      runLink: null,
    };
    expect(HistoryEntrySchema.parse(entry)).toEqual(entry);
  });

  test("rejects negative iteration", () => {
    expect(() =>
      HistoryEntrySchema.parse({
        iteration: -1,
        phase: "Phase 1",
        action: "Test",
        timestamp: null,
        sha: null,
        runLink: null,
      }),
    ).toThrow();
  });
});

describe("LinkedPRSchema", () => {
  test("parses valid linked PR", () => {
    const pr = {
      number: 42,
      state: "OPEN",
      isDraft: false,
      title: "Fix bug",
      headRef: "fix-bug",
      baseRef: "main",
    };
    expect(LinkedPRSchema.parse(pr)).toEqual(pr);
  });

  test("accepts draft PR", () => {
    const pr = {
      number: 1,
      state: "OPEN",
      isDraft: true,
      title: "WIP",
      headRef: "feature",
      baseRef: "develop",
    };
    expect(LinkedPRSchema.parse(pr)).toEqual(pr);
  });

  test("rejects non-positive PR number", () => {
    expect(() =>
      LinkedPRSchema.parse({
        number: 0,
        state: "OPEN",
        isDraft: false,
        title: "Test",
        headRef: "test",
        baseRef: "main",
      }),
    ).toThrow();
  });
});

describe("SubIssueSchema", () => {
  const validSubIssue = {
    number: 123,
    title: "[Phase 1]: Initial setup",
    state: "OPEN",
    body: "## Todos\n- [ ] Task 1",
    projectStatus: "In progress",
    branch: "claude/issue/100/phase-1",
    pr: null,
    todos: { total: 1, completed: 0, uncheckedNonManual: 1 },
  };

  test("parses valid sub-issue", () => {
    expect(SubIssueSchema.parse(validSubIssue)).toEqual(validSubIssue);
  });

  test("accepts null projectStatus", () => {
    const subIssue = { ...validSubIssue, projectStatus: null };
    expect(SubIssueSchema.parse(subIssue).projectStatus).toBeNull();
  });

  test("accepts linked PR", () => {
    const pr = {
      number: 456,
      state: "OPEN",
      isDraft: true,
      title: "Phase 1 PR",
      headRef: "claude/issue/100/phase-1",
      baseRef: "main",
    };
    const subIssue = { ...validSubIssue, pr };
    expect(SubIssueSchema.parse(subIssue).pr).toEqual(pr);
  });
});

describe("ParentIssueSchema", () => {
  const validParentIssue = {
    number: 100,
    title: "Implement feature X",
    state: "OPEN",
    body: "## Description\n\nFeature description",
    projectStatus: "In progress",
    iteration: 3,
    failures: 0,
    assignees: ["nopo-bot"],
    labels: ["enhancement"],
    subIssues: [],
    hasSubIssues: false,
    history: [],
    todos: { total: 0, completed: 0, uncheckedNonManual: 0 },
  };

  test("parses valid parent issue", () => {
    expect(ParentIssueSchema.parse(validParentIssue)).toEqual(validParentIssue);
  });

  test("accepts sub-issues array", () => {
    const subIssue = {
      number: 101,
      title: "[Phase 1]: Setup",
      state: "OPEN",
      body: "## Todos\n- [ ] Task",
      projectStatus: "In progress",
      branch: "claude/issue/100/phase-1",
      pr: null,
      todos: { total: 1, completed: 0, uncheckedNonManual: 1 },
    };
    const parent = {
      ...validParentIssue,
      subIssues: [subIssue],
      hasSubIssues: true,
    };
    expect(ParentIssueSchema.parse(parent).subIssues).toHaveLength(1);
  });

  test("accepts history entries", () => {
    const history = [
      {
        iteration: 1,
        phase: "Phase 1",
        action: "Started",
        timestamp: null,
        sha: null,
        runLink: null,
      },
      {
        iteration: 2,
        phase: "Phase 1",
        action: "Pushed",
        timestamp: "Jan 22 19:04",
        sha: "abc123",
        runLink: "https://example.com",
      },
    ];
    const parent = { ...validParentIssue, history };
    expect(ParentIssueSchema.parse(parent).history).toHaveLength(2);
  });
});

describe("TriggerTypeSchema", () => {
  test("accepts all valid trigger types", () => {
    const triggers = [
      "issue_assigned",
      "issue_edited",
      "issue_closed",
      "pr_review_requested",
      "pr_review_submitted",
      "pr_push",
      "workflow_run_completed",
      "issue_comment",
    ];
    for (const trigger of triggers) {
      expect(TriggerTypeSchema.parse(trigger)).toBe(trigger);
    }
  });

  test("rejects invalid trigger", () => {
    expect(() => TriggerTypeSchema.parse("unknown_trigger")).toThrow();
  });
});

describe("CIResultSchema", () => {
  test("accepts all CI results", () => {
    const results = ["success", "failure", "cancelled", "skipped"];
    for (const result of results) {
      expect(CIResultSchema.parse(result)).toBe(result);
    }
  });
});

describe("ReviewDecisionSchema", () => {
  test("accepts all review decisions", () => {
    const decisions = [
      "APPROVED",
      "CHANGES_REQUESTED",
      "COMMENTED",
      "DISMISSED",
    ];
    for (const decision of decisions) {
      expect(ReviewDecisionSchema.parse(decision)).toBe(decision);
    }
  });
});

describe("MachineContextSchema", () => {
  const minimalContext = {
    trigger: "issue_assigned",
    owner: "test-owner",
    repo: "test-repo",
    issue: {
      number: 1,
      title: "Test Issue",
      state: "OPEN",
      body: "Test body",
      projectStatus: "In progress",
      iteration: 0,
      failures: 0,
      assignees: [],
      labels: [],
      subIssues: [],
      hasSubIssues: false,
      history: [],
      todos: { total: 0, completed: 0, uncheckedNonManual: 0 },
    },
    parentIssue: null,
    currentPhase: null,
    totalPhases: 0,
    currentSubIssue: null,
    ciResult: null,
    ciRunUrl: null,
    ciCommitSha: null,
    workflowStartedAt: null,
    reviewDecision: null,
    reviewerId: null,
    branch: null,
    hasBranch: false,
    pr: null,
    hasPR: false,
    commentContextType: null,
    commentContextDescription: null,
    releaseEvent: null,
    discussion: null,
    maxRetries: 5,
    botUsername: "nopo-bot",
  };

  test("parses full valid context", () => {
    expect(MachineContextSchema.parse(minimalContext)).toEqual(minimalContext);
  });

  test("applies default values", () => {
    const partial = {
      trigger: "issue_assigned",
      owner: "test",
      repo: "repo",
      issue: minimalContext.issue,
    };
    const result = MachineContextSchema.parse({
      ...partial,
      parentIssue: null,
      currentPhase: null,
      totalPhases: 0,
      currentSubIssue: null,
      ciResult: null,
      ciRunUrl: null,
      ciCommitSha: null,
      workflowStartedAt: null,
      reviewDecision: null,
      reviewerId: null,
      branch: null,
      hasBranch: false,
      pr: null,
      hasPR: false,
    });
    expect(result.maxRetries).toBe(5);
    expect(result.botUsername).toBe("nopo-bot");
  });

  test("accepts CI context", () => {
    const ciContext = {
      ...minimalContext,
      trigger: "workflow_run_completed",
      ciResult: "success",
      ciRunUrl: "https://github.com/run/123",
      ciCommitSha: "abc123def",
    };
    expect(MachineContextSchema.parse(ciContext).ciResult).toBe("success");
  });

  test("accepts review context", () => {
    const reviewContext = {
      ...minimalContext,
      trigger: "pr_review_submitted",
      reviewDecision: "APPROVED",
      reviewerId: "reviewer-user",
    };
    expect(MachineContextSchema.parse(reviewContext).reviewDecision).toBe(
      "APPROVED",
    );
  });

  test("rejects empty owner", () => {
    expect(() =>
      MachineContextSchema.parse({
        ...minimalContext,
        owner: "",
      }),
    ).toThrow();
  });

  test("rejects empty repo", () => {
    expect(() =>
      MachineContextSchema.parse({
        ...minimalContext,
        repo: "",
      }),
    ).toThrow();
  });
});

describe("createMachineContext", () => {
  test("creates context with defaults", () => {
    const partial = {
      trigger: "issue_assigned" as const,
      owner: "test",
      repo: "repo",
      issue: {
        number: 1,
        title: "Test",
        state: "OPEN" as const,
        body: "Body",
        projectStatus: "In progress" as const,
        iteration: 0,
        failures: 0,
        assignees: [],
        labels: [],
        subIssues: [],
        hasSubIssues: false,
        history: [],
        todos: { total: 0, completed: 0, uncheckedNonManual: 0 },
      },
    };
    const context = createMachineContext(partial);
    expect(context.maxRetries).toBe(5);
    expect(context.botUsername).toBe("nopo-bot");
    expect(context.parentIssue).toBeNull();
    expect(context.ciResult).toBeNull();
  });

  test("preserves provided values", () => {
    const partial = {
      trigger: "workflow_run_completed" as const,
      owner: "my-org",
      repo: "my-repo",
      issue: {
        number: 42,
        title: "Test Issue",
        state: "OPEN" as const,
        body: "Body",
        projectStatus: "In progress" as const,
        iteration: 5,
        failures: 2,
        assignees: ["nopo-bot"],
        labels: ["bug"],
        subIssues: [],
        hasSubIssues: false,
        history: [],
        todos: { total: 2, completed: 1, uncheckedNonManual: 1 },
      },
      ciResult: "failure" as const,
      maxRetries: 10,
    };
    const context = createMachineContext(partial);
    expect(context.ciResult).toBe("failure");
    expect(context.maxRetries).toBe(10);
  });
});

describe("isTerminalStatus", () => {
  test("returns true for terminal statuses", () => {
    expect(isTerminalStatus("Done")).toBe(true);
    expect(isTerminalStatus("Blocked")).toBe(true);
    expect(isTerminalStatus("Error")).toBe(true);
  });

  test("returns false for non-terminal statuses", () => {
    expect(isTerminalStatus("Backlog")).toBe(false);
    expect(isTerminalStatus("In progress")).toBe(false);
    expect(isTerminalStatus("Ready")).toBe(false);
    expect(isTerminalStatus("In progress")).toBe(false);
    expect(isTerminalStatus("In review")).toBe(false);
  });
});

describe("isParentStatus", () => {
  test("returns true for parent issue statuses", () => {
    expect(isParentStatus("Backlog")).toBe(true);
    expect(isParentStatus("In progress")).toBe(true);
    expect(isParentStatus("Done")).toBe(true);
    expect(isParentStatus("Blocked")).toBe(true);
    expect(isParentStatus("Error")).toBe(true);
  });

  test("returns false for sub-issue only statuses", () => {
    expect(isParentStatus("Ready")).toBe(false);
    // Note: "In progress" is true for BOTH parent and sub-issue (shared status)
    expect(isParentStatus("In review")).toBe(false);
  });
});

describe("isSubIssueStatus", () => {
  test("returns true for sub-issue statuses", () => {
    expect(isSubIssueStatus("Ready")).toBe(true);
    expect(isSubIssueStatus("In progress")).toBe(true);
    expect(isSubIssueStatus("In review")).toBe(true);
    expect(isSubIssueStatus("Done")).toBe(true);
  });

  test("returns false for parent-only statuses", () => {
    expect(isSubIssueStatus("Backlog")).toBe(false);
    // Note: "In progress" is true for BOTH parent and sub-issue (shared status)
    expect(isSubIssueStatus("Blocked")).toBe(false);
    expect(isSubIssueStatus("Error")).toBe(false);
  });
});
