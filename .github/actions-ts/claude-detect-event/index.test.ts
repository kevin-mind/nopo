import { describe, it, expect } from "vitest";

// Test the detection logic by extracting pure functions
// These mirror the logic in index.ts for testability

interface IssuePayload {
  number: number;
  title: string;
  body: string;
  labels: Array<{ name: string }>;
  assignees?: Array<{ login: string }>;
}

interface DetectionResult {
  job: string;
  resourceType: string;
  skip: boolean;
  skipReason: string;
}

function hasSkipLabel(labels: Array<{ name: string }>): boolean {
  return labels.some((l) => l.name === "skip-dispatch" || l.name === "test:automation");
}

function isTestResource(title: string): boolean {
  return title.startsWith("[TEST]");
}

function isNopoBotAssigned(assignees?: Array<{ login: string }>): boolean {
  return assignees?.some((a) => a.login === "nopo-bot") ?? false;
}

function hasTriagedLabel(labels: Array<{ name: string }>): boolean {
  return labels.some((l) => l.name === "triaged");
}

/**
 * Determine the job for an issue event based on action and state
 */
function detectIssueJob(
  action: string,
  issue: IssuePayload,
  assignee?: { login: string },
  removedLabel?: string
): DetectionResult {
  // Check for [TEST] in title (circuit breaker)
  if (isTestResource(issue.title)) {
    return { job: "", resourceType: "", skip: true, skipReason: "Issue title starts with [TEST]" };
  }

  // Check for skip labels
  if (hasSkipLabel(issue.labels)) {
    return { job: "", resourceType: "", skip: true, skipReason: "Issue has skip-dispatch or test:automation label" };
  }

  const hasTriaged = hasTriagedLabel(issue.labels);
  const nopoBotAssigned = isNopoBotAssigned(issue.assignees);

  // Handle opened - always triage
  if (action === "opened") {
    if (hasTriaged) {
      return { job: "", resourceType: "", skip: true, skipReason: "Issue already triaged" };
    }
    return { job: "issue-triage", resourceType: "issue", skip: false, skipReason: "" };
  }

  // Handle unlabeled - re-triage if triaged label was removed
  if (action === "unlabeled" && removedLabel === "triaged") {
    return { job: "issue-triage", resourceType: "issue", skip: false, skipReason: "" };
  }

  // Handle edited - iteration if nopo-bot assigned, otherwise triage
  if (action === "edited") {
    if (nopoBotAssigned) {
      return { job: "issue-iterate", resourceType: "issue", skip: false, skipReason: "" };
    }
    if (!hasTriaged) {
      return { job: "issue-triage", resourceType: "issue", skip: false, skipReason: "" };
    }
    return { job: "", resourceType: "", skip: true, skipReason: "Issue edited but already triaged and not assigned to nopo-bot" };
  }

  // Handle assigned - iterate if assigned to nopo-bot
  if (action === "assigned") {
    if (assignee?.login !== "nopo-bot") {
      return { job: "", resourceType: "", skip: true, skipReason: "Not assigned to nopo-bot" };
    }
    return { job: "issue-iterate", resourceType: "issue", skip: false, skipReason: "" };
  }

  return { job: "", resourceType: "", skip: true, skipReason: `Unhandled issue action: ${action}` };
}

describe("hasSkipLabel", () => {
  it("returns true for skip-dispatch label", () => {
    expect(hasSkipLabel([{ name: "skip-dispatch" }])).toBe(true);
  });

  it("returns true for test:automation label", () => {
    expect(hasSkipLabel([{ name: "test:automation" }])).toBe(true);
  });

  it("returns false for other labels", () => {
    expect(hasSkipLabel([{ name: "bug" }, { name: "enhancement" }])).toBe(false);
  });

  it("returns false for empty labels", () => {
    expect(hasSkipLabel([])).toBe(false);
  });
});

describe("isTestResource", () => {
  it("returns true for [TEST] prefix", () => {
    expect(isTestResource("[TEST] My issue")).toBe(true);
  });

  it("returns false for normal titles", () => {
    expect(isTestResource("My issue")).toBe(false);
  });

  it("returns false for TEST without brackets", () => {
    expect(isTestResource("TEST My issue")).toBe(false);
  });
});

describe("isNopoBotAssigned", () => {
  it("returns true when nopo-bot is assigned", () => {
    expect(isNopoBotAssigned([{ login: "nopo-bot" }])).toBe(true);
  });

  it("returns true when nopo-bot is among multiple assignees", () => {
    expect(isNopoBotAssigned([{ login: "user1" }, { login: "nopo-bot" }])).toBe(true);
  });

  it("returns false when nopo-bot is not assigned", () => {
    expect(isNopoBotAssigned([{ login: "user1" }])).toBe(false);
  });

  it("returns false for empty assignees", () => {
    expect(isNopoBotAssigned([])).toBe(false);
  });

  it("returns false for undefined assignees", () => {
    expect(isNopoBotAssigned(undefined)).toBe(false);
  });
});

describe("detectIssueJob - opened action", () => {
  it("triggers triage for new issue without triaged label", () => {
    const result = detectIssueJob("opened", {
      number: 1,
      title: "New bug",
      body: "Description",
      labels: [],
    });
    expect(result.job).toBe("issue-triage");
    expect(result.skip).toBe(false);
  });

  it("skips if issue already has triaged label", () => {
    const result = detectIssueJob("opened", {
      number: 1,
      title: "New bug",
      body: "Description",
      labels: [{ name: "triaged" }],
    });
    expect(result.skip).toBe(true);
    expect(result.skipReason).toContain("already triaged");
  });

  it("skips if issue has skip-dispatch label", () => {
    const result = detectIssueJob("opened", {
      number: 1,
      title: "New bug",
      body: "Description",
      labels: [{ name: "skip-dispatch" }],
    });
    expect(result.skip).toBe(true);
    expect(result.skipReason).toContain("skip-dispatch");
  });

  it("skips if issue title starts with [TEST]", () => {
    const result = detectIssueJob("opened", {
      number: 1,
      title: "[TEST] Test issue",
      body: "Description",
      labels: [],
    });
    expect(result.skip).toBe(true);
    expect(result.skipReason).toContain("[TEST]");
  });
});

describe("detectIssueJob - edited action", () => {
  it("triggers iteration when nopo-bot is assigned", () => {
    const result = detectIssueJob("edited", {
      number: 1,
      title: "Issue",
      body: "Description",
      labels: [{ name: "triaged" }],
      assignees: [{ login: "nopo-bot" }],
    });
    expect(result.job).toBe("issue-iterate");
    expect(result.skip).toBe(false);
  });

  it("triggers triage when not assigned and not triaged", () => {
    const result = detectIssueJob("edited", {
      number: 1,
      title: "Issue",
      body: "Description",
      labels: [],
      assignees: [],
    });
    expect(result.job).toBe("issue-triage");
    expect(result.skip).toBe(false);
  });

  it("skips when not assigned but already triaged", () => {
    const result = detectIssueJob("edited", {
      number: 1,
      title: "Issue",
      body: "Description",
      labels: [{ name: "triaged" }],
      assignees: [],
    });
    expect(result.skip).toBe(true);
    expect(result.skipReason).toContain("already triaged and not assigned");
  });

  it("triggers iteration even if already triaged when nopo-bot assigned", () => {
    const result = detectIssueJob("edited", {
      number: 1,
      title: "Issue",
      body: "Description",
      labels: [{ name: "triaged" }],
      assignees: [{ login: "nopo-bot" }],
    });
    expect(result.job).toBe("issue-iterate");
    expect(result.skip).toBe(false);
  });
});

describe("detectIssueJob - assigned action", () => {
  it("triggers iteration when assigned to nopo-bot", () => {
    const result = detectIssueJob(
      "assigned",
      {
        number: 1,
        title: "Issue",
        body: "Description",
        labels: [{ name: "triaged" }],
      },
      { login: "nopo-bot" }
    );
    expect(result.job).toBe("issue-iterate");
    expect(result.skip).toBe(false);
  });

  it("skips when assigned to other user", () => {
    const result = detectIssueJob(
      "assigned",
      {
        number: 1,
        title: "Issue",
        body: "Description",
        labels: [{ name: "triaged" }],
      },
      { login: "human-user" }
    );
    expect(result.skip).toBe(true);
    expect(result.skipReason).toContain("Not assigned to nopo-bot");
  });
});

describe("detectIssueJob - unlabeled action", () => {
  it("triggers triage when triaged label is removed", () => {
    const result = detectIssueJob(
      "unlabeled",
      {
        number: 1,
        title: "Issue",
        body: "Description",
        labels: [], // triaged label was removed
      },
      undefined,
      "triaged"
    );
    expect(result.job).toBe("issue-triage");
    expect(result.skip).toBe(false);
  });

  it("skips when other label is removed", () => {
    const result = detectIssueJob(
      "unlabeled",
      {
        number: 1,
        title: "Issue",
        body: "Description",
        labels: [{ name: "triaged" }],
      },
      undefined,
      "bug"
    );
    expect(result.skip).toBe(true);
  });
});
