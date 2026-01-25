/**
 * Phase verification for E2E tests
 *
 * Waits for all phase conditions to be met:
 * - Branch exists (claude/issue-{N})
 * - PR opened (links to sub-issue)
 * - CI passed (PR checks green)
 * - Review approved (by claude[bot])
 * - PR merged
 * - Sub-issue closed with Done status
 */

import * as core from "@actions/core";
import type { PhaseWaitResult, PhaseExpectation } from "./types.js";
import { pollUntil, DEFAULT_POLLER_CONFIG } from "./poller.js";

interface OctokitType {
  graphql: <T>(
    query: string,
    variables?: Record<string, unknown>,
  ) => Promise<T>;
  rest: {
    repos: {
      getBranch: (params: {
        owner: string;
        repo: string;
        branch: string;
      }) => Promise<{ data: { name: string; commit: { sha: string } } }>;
    };
    pulls: {
      list: (params: {
        owner: string;
        repo: string;
        state: "open" | "closed" | "all";
        head?: string;
        per_page?: number;
      }) => Promise<{ data: PullRequest[] }>;
    };
    checks: {
      listForRef: (params: {
        owner: string;
        repo: string;
        ref: string;
        per_page?: number;
      }) => Promise<{ data: { check_runs: CheckRun[] } }>;
    };
    issues: {
      get: (params: {
        owner: string;
        repo: string;
        issue_number: number;
      }) => Promise<{ data: IssueData }>;
    };
  };
}

interface PullRequest {
  number: number;
  title: string;
  body?: string;
  state: "open" | "closed";
  draft?: boolean;
  merged_at?: string | null;
  head: {
    ref: string;
    sha: string;
  };
  base: {
    ref: string;
  };
}

interface CheckRun {
  name: string;
  status: "queued" | "in_progress" | "completed";
  conclusion:
    | "success"
    | "failure"
    | "neutral"
    | "cancelled"
    | "skipped"
    | "timed_out"
    | "action_required"
    | null;
}

interface IssueData {
  state: string;
  labels: Array<string | { name?: string }>;
  body?: string;
  node_id: string;
}

interface PhaseConditions {
  branchExists: boolean;
  prOpened: boolean;
  prState: "draft" | "open" | "merged" | "closed" | null;
  ciPassed: boolean;
  ciStatus: "pending" | "success" | "failure" | null;
  reviewApproved: boolean;
  reviewStatus: "pending" | "approved" | "changes_requested" | null;
  prMerged: boolean;
  issueClosed: boolean;
  issueStatus: string | null;
  branchName: string | null;
  prNumber: number | null;
}

const GET_ISSUE_PROJECT_STATUS_QUERY = `
query GetIssueProjectStatus($owner: String!, $repo: String!, $number: Int!, $projectNumber: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      id
      state
      projectItems(first: 10) {
        nodes {
          project {
            number
          }
          fieldValues(first: 10) {
            nodes {
              ... on ProjectV2ItemFieldSingleSelectValue {
                name
                field {
                  ... on ProjectV2SingleSelectField {
                    name
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
`;

const GET_PR_REVIEWS_QUERY = `
query GetPRReviews($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviews(last: 20) {
        nodes {
          state
          author {
            login
          }
        }
      }
    }
  }
}
`;

interface ProjectFieldValue {
  name?: string;
  field?: {
    name?: string;
  };
}

interface ProjectItem {
  project?: {
    number?: number;
  };
  fieldValues?: {
    nodes?: ProjectFieldValue[];
  };
}

interface IssueProjectResponse {
  repository?: {
    issue?: {
      id?: string;
      state?: string;
      projectItems?: {
        nodes?: ProjectItem[];
      };
    };
  };
}

interface ReviewNode {
  state?: string;
  author?: {
    login?: string;
  };
}

interface PRReviewsResponse {
  repository?: {
    pullRequest?: {
      reviews?: {
        nodes?: ReviewNode[];
      };
    };
  };
}

/**
 * Fetch current phase conditions from GitHub
 */
async function fetchPhaseConditions(
  octokit: OctokitType,
  owner: string,
  repo: string,
  issueNumber: number,
  projectNumber: number,
): Promise<PhaseConditions> {
  const conditions: PhaseConditions = {
    branchExists: false,
    prOpened: false,
    prState: null,
    ciPassed: false,
    ciStatus: null,
    reviewApproved: false,
    reviewStatus: null,
    prMerged: false,
    issueClosed: false,
    issueStatus: null,
    branchName: null,
    prNumber: null,
  };

  // Check branch existence - try common patterns
  const branchPatterns = [
    `claude/issue-${issueNumber}`,
    `claude/issue/${issueNumber}`,
    `issue-${issueNumber}`,
  ];

  for (const branchName of branchPatterns) {
    try {
      await octokit.rest.repos.getBranch({
        owner,
        repo,
        branch: branchName,
      });
      conditions.branchExists = true;
      conditions.branchName = branchName;
      break;
    } catch {
      // Branch doesn't exist, try next pattern
    }
  }

  // Find PR linked to this issue
  try {
    const { data: prs } = await octokit.rest.pulls.list({
      owner,
      repo,
      state: "all",
      per_page: 100,
    });

    // Find PR that references this issue
    const linkedPr = prs.find(
      (pr) =>
        pr.body?.includes(`Fixes #${issueNumber}`) ||
        pr.body?.includes(`Closes #${issueNumber}`) ||
        pr.body?.includes(`Resolves #${issueNumber}`) ||
        (conditions.branchName && pr.head.ref === conditions.branchName),
    );

    if (linkedPr) {
      conditions.prOpened = true;
      conditions.prNumber = linkedPr.number;

      if (linkedPr.merged_at) {
        conditions.prState = "merged";
        conditions.prMerged = true;
      } else if (linkedPr.draft) {
        conditions.prState = "draft";
      } else if (linkedPr.state === "open") {
        conditions.prState = "open";
      } else {
        conditions.prState = "closed";
      }

      // Check CI status
      if (linkedPr.head.sha) {
        try {
          const { data: checks } = await octokit.rest.checks.listForRef({
            owner,
            repo,
            ref: linkedPr.head.sha,
            per_page: 100,
          });

          if (checks.check_runs.length === 0) {
            conditions.ciStatus = "pending";
          } else {
            // Exclude the current workflow and test-related checks
            const relevantChecks = checks.check_runs.filter(
              (c) =>
                !c.name.includes("Test State Machine") &&
                !c.name.includes("E2E") &&
                c.name !== "summary",
            );

            if (relevantChecks.length === 0) {
              conditions.ciStatus = "pending";
            } else {
              const allCompleted = relevantChecks.every(
                (c) => c.status === "completed",
              );
              if (!allCompleted) {
                conditions.ciStatus = "pending";
              } else {
                const allPassed = relevantChecks.every(
                  (c) =>
                    c.conclusion === "success" ||
                    c.conclusion === "skipped" ||
                    c.conclusion === "neutral",
                );
                conditions.ciStatus = allPassed ? "success" : "failure";
                conditions.ciPassed = allPassed;
              }
            }
          }
        } catch (error) {
          core.debug(`Failed to fetch checks: ${error}`);
          conditions.ciStatus = "pending";
        }
      }

      // Check review status
      try {
        const reviewResponse = await octokit.graphql<PRReviewsResponse>(
          GET_PR_REVIEWS_QUERY,
          {
            owner,
            repo,
            number: linkedPr.number,
          },
        );

        const reviews =
          reviewResponse.repository?.pullRequest?.reviews?.nodes || [];

        // Find most recent review from claude[bot] or any approving review
        let hasApproval = false;
        let hasChangesRequested = false;

        for (const review of reviews) {
          if (review.state === "APPROVED") {
            hasApproval = true;
          } else if (review.state === "CHANGES_REQUESTED") {
            hasChangesRequested = true;
          }
        }

        if (hasApproval && !hasChangesRequested) {
          conditions.reviewApproved = true;
          conditions.reviewStatus = "approved";
        } else if (hasChangesRequested) {
          conditions.reviewStatus = "changes_requested";
        } else {
          conditions.reviewStatus = "pending";
        }
      } catch (error) {
        core.debug(`Failed to fetch reviews: ${error}`);
        conditions.reviewStatus = "pending";
      }
    }
  } catch (error) {
    core.debug(`Failed to fetch PRs: ${error}`);
  }

  // Check issue state and project status
  try {
    const issueResponse = await octokit.graphql<IssueProjectResponse>(
      GET_ISSUE_PROJECT_STATUS_QUERY,
      {
        owner,
        repo,
        number: issueNumber,
        projectNumber,
      },
    );

    const issue = issueResponse.repository?.issue;
    if (issue) {
      conditions.issueClosed = issue.state === "CLOSED";

      // Get project status
      const projectItem = issue.projectItems?.nodes?.find(
        (item) => item.project?.number === projectNumber,
      );
      if (projectItem?.fieldValues?.nodes) {
        for (const fieldValue of projectItem.fieldValues.nodes) {
          if (fieldValue.field?.name === "Status" && fieldValue.name) {
            conditions.issueStatus = fieldValue.name;
            break;
          }
        }
      }
    }
  } catch (error) {
    core.debug(`Failed to fetch issue: ${error}`);
  }

  return conditions;
}

/**
 * Check if all phase conditions are met for completion
 */
function isPhaseComplete(
  conditions: PhaseConditions,
  expectations: PhaseExpectation | undefined,
): boolean {
  // Minimum requirements for phase completion:
  // 1. PR merged
  // 2. Issue closed
  // 3. Issue status is "Done"

  if (!conditions.prMerged) return false;
  if (!conditions.issueClosed) return false;
  if (conditions.issueStatus !== "Done") return false;

  // Optional requirements based on expectations
  if (expectations) {
    if (expectations.ci_required && !conditions.ciPassed) return false;
    if (expectations.review_required && !conditions.reviewApproved)
      return false;
  }

  return true;
}

/**
 * Verify phase results against expectations
 */
function verifyPhaseExpectations(
  conditions: PhaseConditions,
  expectations: PhaseExpectation | undefined,
): string[] {
  const errors: string[] = [];

  // Check basic completion requirements
  if (!conditions.prMerged) {
    errors.push(`PR not merged (state: ${conditions.prState || "no PR"})`);
  }

  if (!conditions.issueClosed) {
    errors.push("Issue not closed");
  }

  if (conditions.issueStatus !== "Done") {
    errors.push(
      `Issue status not "Done" (status: ${conditions.issueStatus || "unknown"})`,
    );
  }

  // Check expectations
  if (expectations) {
    if (expectations.ci_required && !conditions.ciPassed) {
      errors.push(
        `CI not passed (status: ${conditions.ciStatus || "unknown"})`,
      );
    }

    if (expectations.review_required && !conditions.reviewApproved) {
      errors.push(
        `Review not approved (status: ${conditions.reviewStatus || "unknown"})`,
      );
    }

    if (expectations.branch_pattern) {
      const pattern = expectations.branch_pattern.replace("{N}", "\\d+");
      const regex = new RegExp(pattern);
      if (conditions.branchName && !regex.test(conditions.branchName)) {
        errors.push(
          `Branch name "${conditions.branchName}" doesn't match pattern "${expectations.branch_pattern}"`,
        );
      }
    }
  }

  return errors;
}

interface WaitForPhaseOptions {
  octokit: OctokitType;
  owner: string;
  repo: string;
  issueNumber: number;
  phaseNumber: number;
  projectNumber: number;
  timeoutMs?: number;
  pollIntervalMs?: number;
  expectations?: PhaseExpectation;
}

/**
 * Wait for phase to complete and verify results
 */
export async function waitForPhase(
  options: WaitForPhaseOptions,
): Promise<PhaseWaitResult> {
  const {
    octokit,
    owner,
    repo,
    issueNumber,
    phaseNumber,
    projectNumber,
    timeoutMs = 900000, // 15 minutes default
    pollIntervalMs = 15000, // 15 seconds default
    expectations,
  } = options;

  const startTime = Date.now();

  core.info(
    `Waiting for phase ${phaseNumber} to complete on issue #${issueNumber}...`,
  );
  core.info(
    `Timeout: ${timeoutMs / 1000}s, Poll interval: ${pollIntervalMs / 1000}s`,
  );

  const pollResult = await pollUntil<PhaseConditions>(
    () =>
      fetchPhaseConditions(octokit, owner, repo, issueNumber, projectNumber),
    (conditions) => isPhaseComplete(conditions, expectations),
    {
      ...DEFAULT_POLLER_CONFIG,
      initialIntervalMs: pollIntervalMs,
      maxIntervalMs: pollIntervalMs * 2,
      timeoutMs,
    },
    (conditions, attempt, elapsed) => {
      const check = (condition: boolean | null) => {
        if (condition === true) return "✅";
        if (condition === false) return "❌";
        return "⏳";
      };

      core.info(
        `\n━━━ Poll ${attempt} (${Math.round(elapsed / 1000)}s elapsed) ━━━`,
      );
      core.info(
        `  Branch: ${check(conditions.branchExists)} ${conditions.branchName || "(not created)"}`,
      );
      core.info(
        `  PR: ${check(conditions.prOpened)} ${conditions.prNumber ? `#${conditions.prNumber}` : "(not opened)"} [${conditions.prState || "none"}]`,
      );
      core.info(
        `  CI: ${check(conditions.ciPassed)} ${conditions.ciStatus || "pending"}`,
      );
      core.info(
        `  Review: ${check(conditions.reviewApproved)} ${conditions.reviewStatus || "pending"}`,
      );
      core.info(`  Merged: ${check(conditions.prMerged)}`);
      core.info(
        `  Issue: ${conditions.issueClosed ? "closed" : "open"} | Status: ${conditions.issueStatus || "(not set)"}`,
      );

      // Show what we're waiting for
      const waiting: string[] = [];
      if (!conditions.branchExists) waiting.push("branch");
      if (!conditions.prOpened) waiting.push("PR");
      if (!conditions.ciPassed && conditions.prOpened)
        waiting.push("CI to pass");
      if (!conditions.reviewApproved && conditions.ciPassed)
        waiting.push("review approval");
      if (!conditions.prMerged && conditions.reviewApproved)
        waiting.push("PR merge");
      if (!conditions.issueClosed && conditions.prMerged)
        waiting.push("issue close");
      if (conditions.issueStatus !== "Done" && conditions.issueClosed)
        waiting.push("status=Done");

      if (waiting.length > 0) {
        core.info(`  ⏳ Waiting for: ${waiting.join(", ")}`);
      }
    },
  );

  const duration = Date.now() - startTime;
  const conditions = pollResult.data;

  if (!pollResult.success || !conditions) {
    // Log detailed timeout state
    core.error(
      `\n╔══════════════════════════════════════════════════════════════╗`,
    );
    core.error(
      `║  PHASE ${phaseNumber} TIMEOUT - Final State                              ║`,
    );
    core.error(
      `╚══════════════════════════════════════════════════════════════╝`,
    );
    core.error(
      `  Duration: ${Math.round(duration / 1000)}s (timeout: ${timeoutMs / 1000}s)`,
    );
    core.error(
      `  Branch: ${conditions?.branchName || "(not created)"}`,
    );
    core.error(
      `  PR: ${conditions?.prNumber ? `#${conditions.prNumber}` : "(not opened)"} [${conditions?.prState || "none"}]`,
    );
    core.error(`  CI: ${conditions?.ciStatus || "pending"}`);
    core.error(`  Review: ${conditions?.reviewStatus || "pending"}`);
    core.error(`  Merged: ${conditions?.prMerged ? "yes" : "no"}`);
    core.error(
      `  Issue: ${conditions?.issueClosed ? "closed" : "open"} | Status: ${conditions?.issueStatus || "(not set)"}`,
    );

    return {
      success: false,
      branch_name: conditions?.branchName || null,
      pr_number: conditions?.prNumber || null,
      pr_state: conditions?.prState || null,
      ci_status: conditions?.ciStatus || null,
      review_status: conditions?.reviewStatus || null,
      issue_state: conditions?.issueClosed ? "closed" : "open",
      issue_status: conditions?.issueStatus || null,
      errors: ["Phase did not complete within timeout"],
      duration_ms: duration,
    };
  }

  // Verify expectations
  const errors = verifyPhaseExpectations(conditions, expectations);

  // Log final state summary
  core.info(
    `\n╔══════════════════════════════════════════════════════════════╗`,
  );
  core.info(
    `║  PHASE ${phaseNumber} ${errors.length === 0 ? "COMPLETE ✅" : "FAILED ❌"}                                        ║`,
  );
  core.info(`╚══════════════════════════════════════════════════════════════╝`);
  core.info(`  Duration: ${Math.round(duration / 1000)}s`);
  core.info(`  Branch: ${conditions.branchName || "(none)"}`);
  core.info(
    `  PR: ${conditions.prNumber ? `#${conditions.prNumber}` : "(none)"} [${conditions.prState || "none"}]`,
  );
  core.info(`  CI: ${conditions.ciStatus || "unknown"}`);
  core.info(`  Review: ${conditions.reviewStatus || "unknown"}`);
  core.info(`  Issue: ${conditions.issueClosed ? "closed" : "open"}`);
  core.info(`  Status: ${conditions.issueStatus || "(not set)"}`);

  if (errors.length > 0) {
    core.error(`\n  Verification errors (${errors.length}):`);
    for (const error of errors) {
      core.error(`    ❌ ${error}`);
    }
  }

  return {
    success: errors.length === 0,
    branch_name: conditions.branchName,
    pr_number: conditions.prNumber,
    pr_state: conditions.prState,
    ci_status: conditions.ciStatus,
    review_status: conditions.reviewStatus,
    issue_state: conditions.issueClosed ? "closed" : "open",
    issue_status: conditions.issueStatus,
    errors,
    duration_ms: duration,
  };
}
