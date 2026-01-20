import { describe, it, expect } from "vitest";
import type {
  TestFixture,
  ParentIssueConfig,
  SubIssueConfig,
  BranchConfig,
  ExpectedOutcome,
  ProjectStatus,
} from "./types.js";

describe("claude-test-helper types", () => {
  describe("TestFixture", () => {
    it("should accept valid minimal fixture", () => {
      const fixture: TestFixture = {
        name: "minimal-test",
        description: "A minimal test fixture",
        parent_issue: {
          title: "Test Issue",
          body: "Test body content",
        },
      };

      expect(fixture.name).toBe("minimal-test");
      expect(fixture.parent_issue.title).toBe("Test Issue");
    });

    it("should accept fixture with all fields", () => {
      const fixture: TestFixture = {
        name: "full-test",
        description: "A full test fixture",
        parent_issue: {
          title: "Parent Issue",
          body: "Parent body",
          labels: ["enhancement", "priority:high"],
          project_fields: {
            Status: "In Progress",
            Iteration: 0,
            Failures: 0,
          },
        },
        sub_issues: [
          {
            title: "Phase 1",
            body: "## Todos\n- [ ] Task 1",
            project_fields: {
              Status: "Ready",
            },
          },
          {
            title: "Phase 2",
            body: "## Todos\n- [ ] Task 2",
            project_fields: {
              Status: "Ready",
            },
          },
        ],
        branch: {
          name: "feature-123",
          from: "main",
          commits: [
            {
              message: "feat: add new feature",
              files: {
                "src/feature.ts": "export const feature = true;",
              },
            },
          ],
        },
        pr: {
          title: "Add new feature",
          body: "Fixes #{ISSUE_NUMBER}",
          draft: true,
        },
        expected: {
          parent_status: "Done",
          sub_issue_statuses: ["Done", "Done"],
          pr_state: "merged",
          issue_state: "closed",
          min_iteration: 1,
          failures: 0,
        },
        timeout: 600,
        poll_interval: 15,
      };

      expect(fixture.sub_issues).toHaveLength(2);
      expect(fixture.branch?.commits).toHaveLength(1);
      expect(fixture.expected?.parent_status).toBe("Done");
    });
  });

  describe("ProjectStatus", () => {
    it("should accept all valid status values", () => {
      const parentStatuses: ProjectStatus[] = [
        "Backlog",
        "In Progress",
        "Done",
        "Blocked",
        "Error",
      ];

      const subIssueStatuses: ProjectStatus[] = [
        "Ready",
        "Working",
        "Review",
        "Done",
      ];

      // Type checking - these should all be valid
      for (const status of [...parentStatuses, ...subIssueStatuses]) {
        expect(typeof status).toBe("string");
      }
    });
  });

  describe("ParentIssueConfig", () => {
    it("should require title and body", () => {
      const config: ParentIssueConfig = {
        title: "Required title",
        body: "Required body",
      };

      expect(config.title).toBeDefined();
      expect(config.body).toBeDefined();
    });

    it("should allow optional labels and project_fields", () => {
      const config: ParentIssueConfig = {
        title: "Test",
        body: "Body",
        labels: ["bug"],
        project_fields: {
          Status: "Working",
          Iteration: 5,
          Failures: 2,
        },
      };

      expect(config.labels).toHaveLength(1);
      expect(config.project_fields?.Status).toBe("Working");
    });
  });

  describe("SubIssueConfig", () => {
    it("should require title and body", () => {
      const config: SubIssueConfig = {
        title: "Phase 1",
        body: "Phase content",
      };

      expect(config.title).toBeDefined();
      expect(config.body).toBeDefined();
    });

    it("should allow optional project_fields with Status only", () => {
      const config: SubIssueConfig = {
        title: "Phase 1",
        body: "Content",
        project_fields: {
          Status: "Working",
        },
      };

      expect(config.project_fields?.Status).toBe("Working");
    });
  });

  describe("BranchConfig", () => {
    it("should require name and from", () => {
      const config: BranchConfig = {
        name: "feature-branch",
        from: "main",
      };

      expect(config.name).toBe("feature-branch");
      expect(config.from).toBe("main");
    });

    it("should allow optional commits", () => {
      const config: BranchConfig = {
        name: "feature",
        from: "main",
        commits: [
          {
            message: "Initial commit",
            files: {
              "README.md": "# Hello",
              "src/index.ts": "console.log('hello');",
            },
          },
        ],
      };

      expect(config.commits).toHaveLength(1);
      expect(Object.keys(config.commits![0]!.files)).toHaveLength(2);
    });
  });

  describe("ExpectedOutcome", () => {
    it("should allow all fields to be optional", () => {
      const outcome: ExpectedOutcome = {};

      expect(outcome.parent_status).toBeUndefined();
      expect(outcome.pr_state).toBeUndefined();
    });

    it("should accept all valid pr_state values", () => {
      const states: ExpectedOutcome["pr_state"][] = [
        "open",
        "closed",
        "merged",
        "draft",
      ];

      for (const state of states) {
        const outcome: ExpectedOutcome = { pr_state: state };
        expect(outcome.pr_state).toBe(state);
      }
    });

    it("should accept all valid issue_state values", () => {
      const states: ExpectedOutcome["issue_state"][] = ["open", "closed"];

      for (const state of states) {
        const outcome: ExpectedOutcome = { issue_state: state };
        expect(outcome.issue_state).toBe(state);
      }
    });
  });
});

describe("fixture validation", () => {
  it("should validate a single-phase-green scenario", () => {
    const fixture: TestFixture = {
      name: "single-phase-green",
      description: "Single sub-issue, CI passes first time",
      parent_issue: {
        title: "Implement simple feature",
        body: "## Description\n\nAdd a simple feature.",
        project_fields: {
          Status: "In Progress",
          Iteration: 0,
          Failures: 0,
        },
      },
      sub_issues: [
        {
          title: "Implement feature",
          body: "## Todos\n\n- [ ] Add feature code\n- [ ] Add tests",
          project_fields: {
            Status: "Working",
          },
        },
      ],
      expected: {
        parent_status: "Done",
        sub_issue_statuses: ["Done"],
        issue_state: "closed",
      },
    };

    expect(fixture.name).toBe("single-phase-green");
    expect(fixture.sub_issues).toHaveLength(1);
    expect(fixture.expected?.parent_status).toBe("Done");
  });

  it("should validate a circuit-breaker scenario", () => {
    const fixture: TestFixture = {
      name: "circuit-breaker",
      description: "CI fails MAX_RETRIES times, triggers circuit breaker",
      parent_issue: {
        title: "Feature with failing tests",
        body: "## Description\n\nA feature that will fail CI.",
        project_fields: {
          Status: "In Progress",
          Iteration: 0,
          Failures: 0,
        },
      },
      sub_issues: [
        {
          title: "Implement failing feature",
          body: "## Todos\n\n- [ ] Add broken code",
          project_fields: {
            Status: "Working",
          },
        },
      ],
      expected: {
        parent_status: "Blocked",
        failures: 5,
        issue_state: "open",
      },
    };

    expect(fixture.name).toBe("circuit-breaker");
    expect(fixture.expected?.parent_status).toBe("Blocked");
    expect(fixture.expected?.failures).toBe(5);
  });

  it("should validate a multi-phase scenario", () => {
    const fixture: TestFixture = {
      name: "multi-phase-sequential",
      description: "Three phases executed sequentially",
      parent_issue: {
        title: "Multi-phase feature",
        body: "## Description\n\nA complex feature in three phases.",
        project_fields: {
          Status: "In Progress",
          Iteration: 0,
          Failures: 0,
        },
      },
      sub_issues: [
        {
          title: "Phase 1: Setup",
          body: "## Todos\n\n- [ ] Setup infrastructure",
          project_fields: { Status: "Working" },
        },
        {
          title: "Phase 2: Core",
          body: "## Todos\n\n- [ ] Implement core logic",
          project_fields: { Status: "Ready" },
        },
        {
          title: "Phase 3: Polish",
          body: "## Todos\n\n- [ ] Add polish",
          project_fields: { Status: "Ready" },
        },
      ],
      expected: {
        parent_status: "Done",
        sub_issue_statuses: ["Done", "Done", "Done"],
        issue_state: "closed",
        min_iteration: 3,
      },
    };

    expect(fixture.name).toBe("multi-phase-sequential");
    expect(fixture.sub_issues).toHaveLength(3);
    expect(fixture.expected?.sub_issue_statuses).toHaveLength(3);
  });
});
