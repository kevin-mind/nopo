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
  return labels.some(
    (l) => l.name === "skip-dispatch" || l.name === "test:automation",
  );
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
  removedLabel?: string,
): DetectionResult {
  // Check for [TEST] in title (circuit breaker)
  if (isTestResource(issue.title)) {
    return {
      job: "",
      resourceType: "",
      skip: true,
      skipReason: "Issue title starts with [TEST]",
    };
  }

  // Check for skip labels
  if (hasSkipLabel(issue.labels)) {
    return {
      job: "",
      resourceType: "",
      skip: true,
      skipReason: "Issue has skip-dispatch or test:automation label",
    };
  }

  const hasTriaged = hasTriagedLabel(issue.labels);
  const nopoBotAssigned = isNopoBotAssigned(issue.assignees);

  // Handle opened - always triage
  if (action === "opened") {
    if (hasTriaged) {
      return {
        job: "",
        resourceType: "",
        skip: true,
        skipReason: "Issue already triaged",
      };
    }
    return {
      job: "issue-triage",
      resourceType: "issue",
      skip: false,
      skipReason: "",
    };
  }

  // Handle unlabeled - re-triage if triaged label was removed
  if (action === "unlabeled" && removedLabel === "triaged") {
    return {
      job: "issue-triage",
      resourceType: "issue",
      skip: false,
      skipReason: "",
    };
  }

  // Handle edited - iteration if nopo-bot assigned, otherwise triage
  if (action === "edited") {
    if (nopoBotAssigned) {
      return {
        job: "issue-iterate",
        resourceType: "issue",
        skip: false,
        skipReason: "",
      };
    }
    if (!hasTriaged) {
      return {
        job: "issue-triage",
        resourceType: "issue",
        skip: false,
        skipReason: "",
      };
    }
    return {
      job: "",
      resourceType: "",
      skip: true,
      skipReason:
        "Issue edited but already triaged and not assigned to nopo-bot",
    };
  }

  // Handle assigned - iterate if assigned to nopo-bot
  if (action === "assigned") {
    if (assignee?.login !== "nopo-bot") {
      return {
        job: "",
        resourceType: "",
        skip: true,
        skipReason: "Not assigned to nopo-bot",
      };
    }
    return {
      job: "issue-iterate",
      resourceType: "issue",
      skip: false,
      skipReason: "",
    };
  }

  return {
    job: "",
    resourceType: "",
    skip: true,
    skipReason: `Unhandled issue action: ${action}`,
  };
}

describe("hasSkipLabel", () => {
  it("returns true for skip-dispatch label", () => {
    expect(hasSkipLabel([{ name: "skip-dispatch" }])).toBe(true);
  });

  it("returns true for test:automation label", () => {
    expect(hasSkipLabel([{ name: "test:automation" }])).toBe(true);
  });

  it("returns false for other labels", () => {
    expect(hasSkipLabel([{ name: "bug" }, { name: "enhancement" }])).toBe(
      false,
    );
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
    expect(isNopoBotAssigned([{ login: "user1" }, { login: "nopo-bot" }])).toBe(
      true,
    );
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
      { login: "nopo-bot" },
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
      { login: "human-user" },
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
      "triaged",
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
      "bug",
    );
    expect(result.skip).toBe(true);
  });
});

// ============================================================================
// Slash Command Detection Tests
// ============================================================================

interface SlashCommandResult {
  command: string | null;
  job: string;
  triggerType: string;
}

/**
 * Detect slash commands from issue comment body
 * Mirrors the logic in index.ts
 */
function detectSlashCommand(
  commentBody: string,
  isPR: boolean,
): SlashCommandResult {
  const commandLines = commentBody.split("\n").map((line) => line.trim());

  // Issue-only commands (not on PRs)
  if (!isPR) {
    if (commandLines.some((line) => line === "/reset")) {
      return {
        command: "/reset",
        job: "issue-reset",
        triggerType: "issue-reset",
      };
    }
    if (
      commandLines.some((line) => line === "/implement") ||
      commandLines.some((line) => line === "/continue") ||
      commandLines.some((line) => line === "/lfg")
    ) {
      const cmd = commandLines.find(
        (line) =>
          line === "/implement" || line === "/continue" || line === "/lfg",
      );
      return {
        command: cmd || null,
        job: "issue-iterate", // or issue-orchestrate depending on context
        triggerType: "issue_comment",
      };
    }
  }

  return {
    command: null,
    job: "",
    triggerType: "",
  };
}

describe("slash command detection", () => {
  describe("/reset command", () => {
    it("detects /reset on its own line", () => {
      const result = detectSlashCommand("/reset", false);
      expect(result.command).toBe("/reset");
      expect(result.job).toBe("issue-reset");
      expect(result.triggerType).toBe("issue-reset");
    });

    it("detects /reset with surrounding whitespace", () => {
      const result = detectSlashCommand("  /reset  ", false);
      expect(result.command).toBe("/reset");
    });

    it("detects /reset in multiline comment", () => {
      const result = detectSlashCommand(
        "Some text\n/reset\nMore text",
        false,
      );
      expect(result.command).toBe("/reset");
    });

    it("does not detect /reset on PRs", () => {
      const result = detectSlashCommand("/reset", true);
      expect(result.command).toBeNull();
    });

    it("does not detect /reset as part of another word", () => {
      const result = detectSlashCommand("/resetall", false);
      expect(result.command).toBeNull();
    });
  });

  describe("/lfg command", () => {
    it("detects /lfg", () => {
      const result = detectSlashCommand("/lfg", false);
      expect(result.command).toBe("/lfg");
      expect(result.job).toBe("issue-iterate");
    });

    it("does not detect /lfg on PRs", () => {
      const result = detectSlashCommand("/lfg", true);
      expect(result.command).toBeNull();
    });
  });

  describe("/implement command", () => {
    it("detects /implement", () => {
      const result = detectSlashCommand("/implement", false);
      expect(result.command).toBe("/implement");
      expect(result.job).toBe("issue-iterate");
    });

    it("does not detect /implement on PRs", () => {
      const result = detectSlashCommand("/implement", true);
      expect(result.command).toBeNull();
    });
  });

  describe("/continue command", () => {
    it("detects /continue", () => {
      const result = detectSlashCommand("/continue", false);
      expect(result.command).toBe("/continue");
      expect(result.job).toBe("issue-iterate");
    });

    it("does not detect /continue on PRs", () => {
      const result = detectSlashCommand("/continue", true);
      expect(result.command).toBeNull();
    });
  });

  describe("no command", () => {
    it("returns null for regular comments", () => {
      const result = detectSlashCommand("This is a normal comment", false);
      expect(result.command).toBeNull();
    });

    it("returns null for @claude mentions", () => {
      const result = detectSlashCommand("@claude please help", false);
      expect(result.command).toBeNull();
    });
  });
});

// ============================================================================
// Discussion Slash Command Detection Tests
// ============================================================================

interface DiscussionCommandResult {
  command: string | null;
  job: string;
}

/**
 * Detect discussion slash commands
 * Mirrors the logic in index.ts
 */
function detectDiscussionCommand(commentBody: string): DiscussionCommandResult {
  const trimmed = commentBody.trim();

  if (trimmed === "/summarize") {
    return { command: "/summarize", job: "discussion-summarize" };
  }
  if (trimmed === "/plan") {
    return { command: "/plan", job: "discussion-plan" };
  }
  if (trimmed === "/complete") {
    return { command: "/complete", job: "discussion-complete" };
  }
  // /lfg or /research triggers research phase on existing discussions
  if (trimmed === "/lfg" || trimmed === "/research") {
    return { command: trimmed, job: "discussion-research" };
  }

  return { command: null, job: "" };
}

describe("discussion slash command detection", () => {
  describe("/summarize command", () => {
    it("detects /summarize", () => {
      const result = detectDiscussionCommand("/summarize");
      expect(result.command).toBe("/summarize");
      expect(result.job).toBe("discussion-summarize");
    });

    it("does not detect /summarize with extra text", () => {
      const result = detectDiscussionCommand("/summarize please");
      expect(result.command).toBeNull();
    });
  });

  describe("/plan command", () => {
    it("detects /plan", () => {
      const result = detectDiscussionCommand("/plan");
      expect(result.command).toBe("/plan");
      expect(result.job).toBe("discussion-plan");
    });
  });

  describe("/complete command", () => {
    it("detects /complete", () => {
      const result = detectDiscussionCommand("/complete");
      expect(result.command).toBe("/complete");
      expect(result.job).toBe("discussion-complete");
    });
  });

  describe("/lfg command", () => {
    it("detects /lfg and routes to discussion-research", () => {
      const result = detectDiscussionCommand("/lfg");
      expect(result.command).toBe("/lfg");
      expect(result.job).toBe("discussion-research");
    });

    it("does not detect /lfg with extra text", () => {
      const result = detectDiscussionCommand("/lfg now");
      expect(result.command).toBeNull();
    });
  });

  describe("/research command", () => {
    it("detects /research and routes to discussion-research", () => {
      const result = detectDiscussionCommand("/research");
      expect(result.command).toBe("/research");
      expect(result.job).toBe("discussion-research");
    });

    it("does not detect /research with extra text", () => {
      const result = detectDiscussionCommand("/research this topic");
      expect(result.command).toBeNull();
    });
  });

  describe("no command", () => {
    it("returns null for regular discussion comments", () => {
      const result = detectDiscussionCommand("This is a normal comment");
      expect(result.command).toBeNull();
    });
  });
});

// ============================================================================
// Bug Fix Tests - Tests for specific bugs found in production
// ============================================================================

// Bug 1 & 2: PR Review Event Null Safety Tests
// These test the null-safety handling for review.user and pr.author fields

interface ReviewPayload {
  id: number;
  state: string;
  body: string;
  user?: { login: string };
}

interface PRPayload {
  number: number;
  title: string;
  draft: boolean;
  body: string | null;
  head: { ref: string };
  author?: { login: string };
  user?: { login: string };
  labels: Array<{ name: string }>;
}

interface PRReviewResult {
  skip: boolean;
  skipReason: string;
  job: string;
  reviewerLogin: string;
  prAuthorLogin: string;
}

/**
 * Safely extract reviewer login from review payload
 * Bug 1 fix: review.user can be undefined
 */
function extractReviewerLogin(review: ReviewPayload): string | null {
  return review?.user?.login ?? null;
}

/**
 * Safely extract PR author login from PR payload
 * Bug 2 fix: GitHub uses pr.user in some events, pr.author in others
 */
function extractPRAuthorLogin(pr: PRPayload): string {
  return pr.author?.login ?? pr.user?.login ?? "";
}

/**
 * Determine if a review event should be processed
 * Returns job type and context for PR review events
 */
function detectPRReviewJob(
  review: ReviewPayload,
  pr: PRPayload,
): PRReviewResult {
  // Bug 1: Check for missing review.user
  const reviewerLogin = extractReviewerLogin(review);
  if (!reviewerLogin) {
    return {
      skip: true,
      skipReason: "Review has no user information",
      job: "",
      reviewerLogin: "",
      prAuthorLogin: "",
    };
  }

  // Bug 2: Handle pr.author vs pr.user
  const prAuthorLogin = extractPRAuthorLogin(pr);

  // Skip if reviewer is the PR author (self-review)
  if (reviewerLogin === prAuthorLogin) {
    return {
      skip: true,
      skipReason: "Self-review",
      job: "",
      reviewerLogin,
      prAuthorLogin,
    };
  }

  // Skip if PR is draft
  if (pr.draft) {
    return {
      skip: true,
      skipReason: "PR is draft",
      job: "",
      reviewerLogin,
      prAuthorLogin,
    };
  }

  // Determine job based on review state and reviewer
  const claudeReviewers = ["nopo-reviewer", "claude[bot]"];
  const isClaudeReview = claudeReviewers.includes(reviewerLogin);

  if (review.state === "CHANGES_REQUESTED") {
    return {
      skip: false,
      skipReason: "",
      job: isClaudeReview ? "pr-response" : "pr-human-response",
      reviewerLogin,
      prAuthorLogin,
    };
  }

  if (review.state === "APPROVED") {
    return {
      skip: false,
      skipReason: "",
      job: "pr-approved",
      reviewerLogin,
      prAuthorLogin,
    };
  }

  return {
    skip: true,
    skipReason: `Unhandled review state: ${review.state}`,
    job: "",
    reviewerLogin,
    prAuthorLogin,
  };
}

describe("Bug 1: review.user null safety", () => {
  it("handles missing review.user gracefully", () => {
    const review: ReviewPayload = {
      id: 1,
      state: "APPROVED",
      body: "LGTM",
      // user is missing
    };
    const pr: PRPayload = {
      number: 123,
      title: "Test PR",
      draft: false,
      body: "Fixes #100",
      head: { ref: "feature-branch" },
      user: { login: "author" },
      labels: [],
    };

    const result = detectPRReviewJob(review, pr);
    expect(result.skip).toBe(true);
    expect(result.skipReason).toBe("Review has no user information");
  });

  it("handles review.user being null", () => {
    const review = {
      id: 1,
      state: "APPROVED",
      body: "LGTM",
      user: null,
    } as unknown as ReviewPayload;

    const result = extractReviewerLogin(review);
    expect(result).toBeNull();
  });

  it("handles review.user.login being undefined", () => {
    const review = {
      id: 1,
      state: "APPROVED",
      body: "LGTM",
      user: {},
    } as unknown as ReviewPayload;

    const result = extractReviewerLogin(review);
    expect(result).toBeNull();
  });

  it("extracts reviewer login when present", () => {
    const review: ReviewPayload = {
      id: 1,
      state: "APPROVED",
      body: "LGTM",
      user: { login: "reviewer" },
    };

    const result = extractReviewerLogin(review);
    expect(result).toBe("reviewer");
  });
});

describe("Bug 2: pr.author vs pr.user field mismatch", () => {
  it("uses pr.author.login when available", () => {
    const pr: PRPayload = {
      number: 123,
      title: "Test PR",
      draft: false,
      body: "Fixes #100",
      head: { ref: "feature-branch" },
      author: { login: "author-from-author" },
      user: { login: "author-from-user" },
      labels: [],
    };

    const result = extractPRAuthorLogin(pr);
    expect(result).toBe("author-from-author");
  });

  it("falls back to pr.user.login when pr.author is missing", () => {
    const pr: PRPayload = {
      number: 123,
      title: "Test PR",
      draft: false,
      body: "Fixes #100",
      head: { ref: "feature-branch" },
      // author is missing - common in pull_request_review events
      user: { login: "author-from-user" },
      labels: [],
    };

    const result = extractPRAuthorLogin(pr);
    expect(result).toBe("author-from-user");
  });

  it("returns empty string when both author and user are missing", () => {
    const pr: PRPayload = {
      number: 123,
      title: "Test PR",
      draft: false,
      body: "Fixes #100",
      head: { ref: "feature-branch" },
      // Both author and user missing
      labels: [],
    };

    const result = extractPRAuthorLogin(pr);
    expect(result).toBe("");
  });

  it("handles null author field", () => {
    const pr = {
      number: 123,
      title: "Test PR",
      draft: false,
      body: "Fixes #100",
      head: { ref: "feature-branch" },
      author: null,
      user: { login: "fallback-user" },
      labels: [],
    } as unknown as PRPayload;

    const result = extractPRAuthorLogin(pr);
    expect(result).toBe("fallback-user");
  });
});

describe("PR review job detection with null safety", () => {
  it("routes Claude reviewer changes_requested to pr-response", () => {
    const review: ReviewPayload = {
      id: 1,
      state: "CHANGES_REQUESTED",
      body: "Please fix the tests",
      user: { login: "nopo-reviewer" },
    };
    const pr: PRPayload = {
      number: 123,
      title: "Test PR",
      draft: false,
      body: "Fixes #100",
      head: { ref: "feature-branch" },
      user: { login: "author" },
      labels: [],
    };

    const result = detectPRReviewJob(review, pr);
    expect(result.skip).toBe(false);
    expect(result.job).toBe("pr-response");
    expect(result.reviewerLogin).toBe("nopo-reviewer");
  });

  it("routes human reviewer changes_requested to pr-human-response", () => {
    const review: ReviewPayload = {
      id: 1,
      state: "CHANGES_REQUESTED",
      body: "Please fix the tests",
      user: { login: "human-reviewer" },
    };
    const pr: PRPayload = {
      number: 123,
      title: "Test PR",
      draft: false,
      body: "Fixes #100",
      head: { ref: "feature-branch" },
      user: { login: "author" },
      labels: [],
    };

    const result = detectPRReviewJob(review, pr);
    expect(result.skip).toBe(false);
    expect(result.job).toBe("pr-human-response");
    expect(result.reviewerLogin).toBe("human-reviewer");
  });

  it("skips self-reviews", () => {
    const review: ReviewPayload = {
      id: 1,
      state: "APPROVED",
      body: "LGTM",
      user: { login: "author" },
    };
    const pr: PRPayload = {
      number: 123,
      title: "Test PR",
      draft: false,
      body: "Fixes #100",
      head: { ref: "feature-branch" },
      user: { login: "author" }, // Same as reviewer
      labels: [],
    };

    const result = detectPRReviewJob(review, pr);
    expect(result.skip).toBe(true);
    expect(result.skipReason).toBe("Self-review");
  });

  it("skips draft PRs", () => {
    const review: ReviewPayload = {
      id: 1,
      state: "APPROVED",
      body: "LGTM",
      user: { login: "reviewer" },
    };
    const pr: PRPayload = {
      number: 123,
      title: "Test PR",
      draft: true, // Draft PR
      body: "Fixes #100",
      head: { ref: "feature-branch" },
      user: { login: "author" },
      labels: [],
    };

    const result = detectPRReviewJob(review, pr);
    expect(result.skip).toBe(true);
    expect(result.skipReason).toBe("PR is draft");
  });
});

// ============================================================================
// Bug 3: /lfg command on PRs
// ============================================================================

interface PRCommandResult {
  command: string | null;
  job: string;
  triggerType: string;
  skip: boolean;
  skipReason: string;
}

interface PRState {
  isDraft: boolean;
  reviewDecision: string | null;
  reviews: Array<{ author: { login: string }; state: string; body: string }>;
}

/**
 * Detect /lfg, /implement, /continue commands on PRs
 * Bug 3 fix: These commands now work on PRs to trigger review response flow
 */
function detectPRSlashCommand(
  commentBody: string,
  prState: PRState,
): PRCommandResult {
  const commandLines = commentBody.split("\n").map((line) => line.trim());

  const hasImplementCommand = commandLines.some(
    (line) => line === "/implement",
  );
  const hasContinueCommand = commandLines.some((line) => line === "/continue");
  const hasLfgCommand = commandLines.some((line) => line === "/lfg");

  if (!hasImplementCommand && !hasContinueCommand && !hasLfgCommand) {
    return {
      command: null,
      job: "",
      triggerType: "",
      skip: true,
      skipReason: "No recognized command",
    };
  }

  const command = hasLfgCommand
    ? "/lfg"
    : hasImplementCommand
      ? "/implement"
      : "/continue";

  // Skip if PR is draft
  if (prState.isDraft) {
    return {
      command,
      job: "",
      triggerType: "",
      skip: true,
      skipReason: "PR is a draft - convert to ready for review first",
    };
  }

  // Find pending review with changes requested
  const pendingReview = prState.reviews
    ?.filter((r) => r.state === "CHANGES_REQUESTED")
    .pop();

  if (!pendingReview) {
    if (prState.reviewDecision === "APPROVED") {
      return {
        command,
        job: "",
        triggerType: "",
        skip: true,
        skipReason: "PR is already approved",
      };
    }
    return {
      command,
      job: "",
      triggerType: "",
      skip: true,
      skipReason: "No pending changes requested on this PR",
    };
  }

  // Determine job based on reviewer
  const claudeReviewers = ["nopo-reviewer", "claude[bot]"];
  const isClaudeReviewer = claudeReviewers.includes(pendingReview.author.login);
  const job = isClaudeReviewer ? "pr-response" : "pr-human-response";

  // Bug 4 fix: Use job name as trigger type to match schema
  const triggerType = job;

  return {
    command,
    job,
    triggerType,
    skip: false,
    skipReason: "",
  };
}

describe("Bug 3 & 4: /lfg command on PRs", () => {
  it("detects /lfg command and routes to pr-response for Claude reviewer", () => {
    const prState: PRState = {
      isDraft: false,
      reviewDecision: "CHANGES_REQUESTED",
      reviews: [
        {
          author: { login: "nopo-reviewer" },
          state: "CHANGES_REQUESTED",
          body: "Please fix",
        },
      ],
    };

    const result = detectPRSlashCommand("/lfg", prState);
    expect(result.command).toBe("/lfg");
    expect(result.job).toBe("pr-response");
    expect(result.triggerType).toBe("pr-response"); // Bug 4: matches schema
    expect(result.skip).toBe(false);
  });

  it("detects /lfg command and routes to pr-human-response for human reviewer", () => {
    const prState: PRState = {
      isDraft: false,
      reviewDecision: "CHANGES_REQUESTED",
      reviews: [
        {
          author: { login: "human-reviewer" },
          state: "CHANGES_REQUESTED",
          body: "Please fix",
        },
      ],
    };

    const result = detectPRSlashCommand("/lfg", prState);
    expect(result.command).toBe("/lfg");
    expect(result.job).toBe("pr-human-response");
    expect(result.triggerType).toBe("pr-human-response");
    expect(result.skip).toBe(false);
  });

  it("skips if PR is draft", () => {
    const prState: PRState = {
      isDraft: true,
      reviewDecision: "CHANGES_REQUESTED",
      reviews: [
        {
          author: { login: "nopo-reviewer" },
          state: "CHANGES_REQUESTED",
          body: "Please fix",
        },
      ],
    };

    const result = detectPRSlashCommand("/lfg", prState);
    expect(result.skip).toBe(true);
    expect(result.skipReason).toContain("draft");
  });

  it("skips if PR is already approved", () => {
    const prState: PRState = {
      isDraft: false,
      reviewDecision: "APPROVED",
      reviews: [
        {
          author: { login: "nopo-reviewer" },
          state: "APPROVED",
          body: "LGTM",
        },
      ],
    };

    const result = detectPRSlashCommand("/lfg", prState);
    expect(result.skip).toBe(true);
    expect(result.skipReason).toContain("already approved");
  });

  it("skips if no pending changes requested", () => {
    const prState: PRState = {
      isDraft: false,
      reviewDecision: null,
      reviews: [],
    };

    const result = detectPRSlashCommand("/lfg", prState);
    expect(result.skip).toBe(true);
    expect(result.skipReason).toContain("No pending changes requested");
  });

  it("uses most recent CHANGES_REQUESTED review", () => {
    const prState: PRState = {
      isDraft: false,
      reviewDecision: "CHANGES_REQUESTED",
      reviews: [
        {
          author: { login: "first-reviewer" },
          state: "CHANGES_REQUESTED",
          body: "First review",
        },
        {
          author: { login: "second-reviewer" },
          state: "APPROVED",
          body: "LGTM",
        },
        {
          author: { login: "nopo-reviewer" },
          state: "CHANGES_REQUESTED",
          body: "Latest review",
        },
      ],
    };

    const result = detectPRSlashCommand("/lfg", prState);
    expect(result.job).toBe("pr-response"); // nopo-reviewer is last CHANGES_REQUESTED
  });

  it("also accepts /implement command on PRs", () => {
    const prState: PRState = {
      isDraft: false,
      reviewDecision: "CHANGES_REQUESTED",
      reviews: [
        {
          author: { login: "nopo-reviewer" },
          state: "CHANGES_REQUESTED",
          body: "Please fix",
        },
      ],
    };

    const result = detectPRSlashCommand("/implement", prState);
    expect(result.command).toBe("/implement");
    expect(result.job).toBe("pr-response");
  });

  it("also accepts /continue command on PRs", () => {
    const prState: PRState = {
      isDraft: false,
      reviewDecision: "CHANGES_REQUESTED",
      reviews: [
        {
          author: { login: "nopo-reviewer" },
          state: "CHANGES_REQUESTED",
          body: "Please fix",
        },
      ],
    };

    const result = detectPRSlashCommand("/continue", prState);
    expect(result.command).toBe("/continue");
    expect(result.job).toBe("pr-response");
  });
});

// ============================================================================
// Bug 4: Trigger type schema validation
// ============================================================================

// List of valid trigger types from the schema
const VALID_TRIGGER_TYPES = [
  "issue-assigned",
  "issue-opened",
  "issue-edited",
  "issue_comment",
  "issue-reset",
  "pr-push",
  "pr-review-requested",
  "pr-response",
  "pr-human-response",
  "pr-approved",
  "ci-completed",
  "discussion-created",
  "discussion-comment",
  "workflow_dispatch",
] as const;

type TriggerType = (typeof VALID_TRIGGER_TYPES)[number];

function isValidTriggerType(trigger: string): trigger is TriggerType {
  return VALID_TRIGGER_TYPES.includes(trigger as TriggerType);
}

describe("Bug 4: Trigger type validation", () => {
  it("validates all known trigger types", () => {
    VALID_TRIGGER_TYPES.forEach((trigger) => {
      expect(isValidTriggerType(trigger)).toBe(true);
    });
  });

  it("rejects invalid trigger types", () => {
    expect(isValidTriggerType("pr-comment-lfg")).toBe(false); // The original bug
    expect(isValidTriggerType("invalid-trigger")).toBe(false);
    expect(isValidTriggerType("")).toBe(false);
  });

  it("pr-response is a valid trigger type", () => {
    // This was the fix for Bug 4 - use job name as trigger
    expect(isValidTriggerType("pr-response")).toBe(true);
    expect(isValidTriggerType("pr-human-response")).toBe(true);
  });
});

// ============================================================================
// Push event detection tests
// ============================================================================

interface PushEventResult {
  skip: boolean;
  skipReason: string;
  job: string;
  branch: string;
}

/**
 * Detect push events to Claude branches
 * Bug 3 fix: Push trigger was missing from workflow
 */
function detectPushEvent(
  branch: string,
  hasPR: boolean,
  prLabels: Array<{ name: string }> = [],
): PushEventResult {
  // Skip main branch
  if (branch === "main") {
    return {
      skip: true,
      skipReason: "Push to main branch",
      job: "",
      branch,
    };
  }

  // Skip merge queue branches
  if (branch.startsWith("gh-readonly-queue/")) {
    return {
      skip: true,
      skipReason: "Push to merge queue branch",
      job: "",
      branch,
    };
  }

  // Skip test branches
  if (branch.startsWith("test/")) {
    return {
      skip: true,
      skipReason: "Push to test branch",
      job: "",
      branch,
    };
  }

  // Skip if no PR for this branch
  if (!hasPR) {
    return {
      skip: true,
      skipReason: "No PR found for branch",
      job: "",
      branch,
    };
  }

  // Skip if PR has skip labels
  if (
    prLabels.some(
      (l) => l.name === "skip-dispatch" || l.name === "test:automation",
    )
  ) {
    return {
      skip: true,
      skipReason: "PR has skip-dispatch or test:automation label",
      job: "",
      branch,
    };
  }

  return {
    skip: false,
    skipReason: "",
    job: "pr-push",
    branch,
  };
}

describe("Push event detection", () => {
  it("triggers pr-push for claude branches with PR", () => {
    const result = detectPushEvent("claude/issue/123", true);
    expect(result.skip).toBe(false);
    expect(result.job).toBe("pr-push");
  });

  it("triggers pr-push for claude phase branches with PR", () => {
    const result = detectPushEvent("claude/issue/123/phase-456", true);
    expect(result.skip).toBe(false);
    expect(result.job).toBe("pr-push");
  });

  it("skips main branch", () => {
    const result = detectPushEvent("main", true);
    expect(result.skip).toBe(true);
    expect(result.skipReason).toBe("Push to main branch");
  });

  it("skips merge queue branches", () => {
    const result = detectPushEvent(
      "gh-readonly-queue/main/pr-123-abc123",
      true,
    );
    expect(result.skip).toBe(true);
    expect(result.skipReason).toBe("Push to merge queue branch");
  });

  it("skips test branches", () => {
    const result = detectPushEvent("test/my-test", true);
    expect(result.skip).toBe(true);
    expect(result.skipReason).toBe("Push to test branch");
  });

  it("skips branches without PR", () => {
    const result = detectPushEvent("claude/issue/123", false);
    expect(result.skip).toBe(true);
    expect(result.skipReason).toBe("No PR found for branch");
  });

  it("skips PRs with skip-dispatch label", () => {
    const result = detectPushEvent("claude/issue/123", true, [
      { name: "skip-dispatch" },
    ]);
    expect(result.skip).toBe(true);
    expect(result.skipReason).toContain("skip-dispatch");
  });

  it("skips PRs with test:automation label", () => {
    const result = detectPushEvent("claude/issue/123", true, [
      { name: "test:automation" },
    ]);
    expect(result.skip).toBe(true);
    expect(result.skipReason).toContain("test:automation");
  });
});
