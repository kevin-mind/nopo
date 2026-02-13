/**
 * Claude State Machine Entry Point
 *
 * Unified action that handles both event detection and state machine routing.
 * Replaces the previous sm-detect-event + sm-router two-action architecture.
 *
 * Modes:
 * - "detect": Detect event, compute skip/concurrency, output context_json
 * - "derive": Full state machine (detect + route + derive actions)
 * - "context": Fetch context only (iteration, phase) without running state machine
 */

import * as core from "@actions/core";
import * as github from "@actions/github";
import { createActor } from "xstate";
import {
  // Action utilities
  execCommand,
  getRequiredInput,
  getOptionalInput,
  setOutputs,
  JobType,
  WorkflowResourceType as ResourceType,
  WorkflowContext as RunnerContext,
  // Workflow context
  parseWorkflowContext,
  isDiscussionTrigger as checkDiscussionTrigger,
  type WorkflowContext,
  // Issue machine
  claudeMachine,
  buildMachineContext,
  formatAgentNotesForPrompt,
  agentNotesExtractor,
  type TriggerType,
  // Discussion machine
  discussionMachine,
  buildDiscussionContext,
  type DiscussionTriggerType,
  type DiscussionCommand,
} from "@more/statemachine";
import { TriggerTypeSchema } from "@more/statemachine/schemas";
import {
  parseIssue,
  issueNumberFromPR,
  issueNumberFromBranch,
} from "@more/issue-state";
import type { IssueStateData } from "@more/issue-state";
import {
  LabelSchema,
  UserLoginSchema,
  IssuePayloadSchema,
  IssueCommentPayloadSchema,
  IssueForCommentPayloadSchema,
  PullRequestPayloadSchema,
  ReviewPayloadSchema,
  ReviewCommentPayloadSchema,
  PullRequestForReviewCommentPayloadSchema,
  WorkflowRunPayloadSchema,
  MergeGroupPayloadSchema,
  DiscussionPayloadSchema,
  DiscussionCommentPayloadSchema,
} from "./payload-schemas.js";

// ============================================================================
// Types
// ============================================================================

type Job = JobType;

interface DetectionResult {
  job: Job;
  resourceType: ResourceType;
  resourceNumber: string;
  commentId: string;
  contextJson: Record<string, unknown>;
  skip: boolean;
  skipReason: string;
  concurrencyGroup: string;
  cancelInProgress: boolean;
}

// ============================================================================
// Detection Helpers
// ============================================================================

function emptyResult(skip = false, skipReason = ""): DetectionResult {
  return {
    job: "",
    resourceType: "",
    resourceNumber: "",
    commentId: "",
    contextJson: {},
    skip,
    skipReason,
    concurrencyGroup: "",
    cancelInProgress: false,
  };
}

/**
 * Add an emoji reaction to an issue comment to acknowledge slash commands
 */
async function addReactionToComment(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  commentId: number,
  reaction:
    | "+1"
    | "-1"
    | "laugh"
    | "confused"
    | "heart"
    | "hooray"
    | "rocket"
    | "eyes",
): Promise<void> {
  try {
    await octokit.rest.reactions.createForIssueComment({
      owner,
      repo,
      comment_id: commentId,
      content: reaction,
    });
    core.info(`Added ${reaction} reaction to comment ${commentId}`);
  } catch (error) {
    // Don't fail the workflow if reaction fails - it's just feedback
    core.warning(`Failed to add reaction to comment: ${error}`);
  }
}

/**
 * Add an emoji reaction to a discussion comment via GraphQL
 */
async function addReactionToDiscussionComment(
  octokit: ReturnType<typeof github.getOctokit>,
  nodeId: string,
  reaction:
    | "THUMBS_UP"
    | "THUMBS_DOWN"
    | "LAUGH"
    | "CONFUSED"
    | "HEART"
    | "HOORAY"
    | "ROCKET"
    | "EYES",
): Promise<void> {
  try {
    await octokit.graphql(
      `
      mutation($subjectId: ID!, $content: ReactionContent!) {
        addReaction(input: {subjectId: $subjectId, content: $content}) {
          reaction {
            content
          }
        }
      }
      `,
      { subjectId: nodeId, content: reaction },
    );
    core.info(`Added ${reaction} reaction to discussion comment ${nodeId}`);
  } catch (error) {
    // Don't fail the workflow if reaction fails - it's just feedback
    core.warning(`Failed to add reaction to discussion comment: ${error}`);
  }
}

/**
 * Get trigger type for the state machine
 * Most jobs map directly to triggers (same name), but some have overrides
 */
function jobToTrigger(job: Job, contextJson: string): string {
  // First check if trigger_type is already in context (e.g., workflow-run-completed)
  try {
    const ctx = JSON.parse(contextJson);
    if (ctx.trigger_type) {
      return ctx.trigger_type;
    }
  } catch {
    // Ignore parse errors
  }

  // Special cases where job name differs from trigger
  const jobTriggerOverrides: Partial<Record<Job, string>> = {
    "issue-iterate": "issue-assigned",
    "merge-queue-logging": "merge-queue-entered",
    "discussion-research": "discussion-created",
    "discussion-respond": "discussion-comment",
    "discussion-summarize": "discussion-command",
    "discussion-plan": "discussion-command",
    "discussion-complete": "discussion-command",
  };

  return jobTriggerOverrides[job] || job || "issue-assigned";
}

/**
 * Compute concurrency group and cancel-in-progress based on job type
 */
function computeConcurrency(
  job: Job,
  resourceNumber: string,
  parentIssue: string,
  branch?: string,
): { group: string; cancelInProgress: boolean } {
  // PR review jobs share a group - pr-push cancels in-flight reviews
  const reviewJobs: Job[] = [
    "pr-push",
    "pr-review",
    "pr-review-approved",
    "pr-response",
    "pr-human-response",
  ];

  if (reviewJobs.includes(job)) {
    return {
      group: `claude-job-review-${resourceNumber}`,
      // pr-push should cancel in-flight reviews
      cancelInProgress: job === "pr-push",
    };
  }

  // Discussion jobs use their own group - all jobs for same discussion
  // share a single concurrency group to prevent race conditions on body updates
  const discussionJobs: Job[] = [
    "discussion-research",
    "discussion-respond",
    "discussion-summarize",
    "discussion-plan",
    "discussion-complete",
  ];

  if (discussionJobs.includes(job)) {
    return {
      group: `claude-job-discussion-${resourceNumber}`,
      cancelInProgress: false,
    };
  }

  // CI completion uses branch-based group
  if (branch && job === "issue-iterate") {
    // Check if this looks like a CI trigger (has branch but context suggests CI)
    // The actual CI trigger detection happens in the workflow, but we can use branch
    return {
      group: `claude-job-issue-${parentIssue !== "0" ? parentIssue : resourceNumber}`,
      cancelInProgress: false,
    };
  }

  // All other issue jobs use parent issue (or self) for grouping
  return {
    group: `claude-job-issue-${parentIssue !== "0" ? parentIssue : resourceNumber}`,
    cancelInProgress: false,
  };
}

/**
 * Derive branch name from parent issue and phase number
 */
function deriveBranch(parentIssueNumber: number, phaseNumber: number): string {
  return `claude/issue/${parentIssueNumber}/phase-${phaseNumber}`;
}

interface ResolvedEvent {
  handler: string;
  issueNumber: number | null;
  prNumber?: number; // For merge_group (parsed from branch name)
}

/**
 * Resolve the GitHub event to a handler name, issue number, and optional PR number.
 * Uses GraphQL-based resolvers for PR/branch → issue mapping.
 */
async function resolveEvent(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  resourceNumber: string,
): Promise<ResolvedEvent> {
  const eventName = github.context.eventName;
  const payload = github.context.payload;

  switch (eventName) {
    case "issues":
      return {
        handler: "issues",
        issueNumber: payload.issue?.number ?? null,
      };

    case "issue_comment": {
      const issuePayload = payload.issue;
      const isPr = !!issuePayload?.pull_request;
      if (isPr && issuePayload?.number) {
        // Comment is on a PR — resolve to the issue the PR closes
        const resolved = await issueNumberFromPR(
          octokit,
          owner,
          repo,
          issuePayload.number,
        );
        return {
          handler: "issue_comment",
          // Fall back to payload issue number if no closing issue found
          issueNumber: resolved ?? issuePayload.number,
        };
      }
      return {
        handler: "issue_comment",
        issueNumber: issuePayload?.number ?? null,
      };
    }

    case "workflow_dispatch": {
      const num = parseInt(resourceNumber, 10);
      return {
        handler: "workflow_dispatch",
        issueNumber: isNaN(num) ? null : num,
      };
    }

    case "push": {
      const branch = github.context.ref.replace("refs/heads/", "");
      const resolved = await issueNumberFromBranch(
        octokit,
        owner,
        repo,
        branch,
      );
      return {
        handler: "push",
        issueNumber: resolved,
      };
    }

    case "pull_request": {
      const prNum = payload.pull_request?.number;
      if (prNum) {
        const resolved = await issueNumberFromPR(octokit, owner, repo, prNum);
        return {
          handler: "pull_request",
          issueNumber: resolved,
        };
      }
      return { handler: "pull_request", issueNumber: null };
    }

    case "pull_request_review": {
      const prNum = payload.pull_request?.number;
      if (prNum) {
        const resolved = await issueNumberFromPR(octokit, owner, repo, prNum);
        return {
          handler: "pull_request_review",
          issueNumber: resolved,
        };
      }
      return { handler: "pull_request_review", issueNumber: null };
    }

    case "pull_request_review_comment": {
      const prNum = payload.pull_request?.number;
      if (prNum) {
        const resolved = await issueNumberFromPR(octokit, owner, repo, prNum);
        return {
          handler: "pull_request_review_comment",
          issueNumber: resolved,
        };
      }
      return { handler: "pull_request_review_comment", issueNumber: null };
    }

    case "workflow_run": {
      const workflowRun =
        "workflow_run" in payload ? payload.workflow_run : null;
      const branch =
        workflowRun &&
        typeof workflowRun === "object" &&
        workflowRun !== null &&
        "head_branch" in workflowRun &&
        typeof workflowRun.head_branch === "string"
          ? workflowRun.head_branch
          : "";
      if (branch) {
        const resolved = await issueNumberFromBranch(
          octokit,
          owner,
          repo,
          branch,
        );
        return {
          handler: "workflow_run",
          issueNumber: resolved,
        };
      }
      return { handler: "workflow_run", issueNumber: null };
    }

    case "merge_group": {
      const mergeGroup = "merge_group" in payload ? payload.merge_group : null;
      const headRef =
        mergeGroup &&
        typeof mergeGroup === "object" &&
        mergeGroup !== null &&
        "head_ref" in mergeGroup &&
        typeof mergeGroup.head_ref === "string"
          ? mergeGroup.head_ref
          : "";
      // Parse PR number from merge queue branch: gh-readonly-queue/main/pr-123-abc123
      const prMatch = headRef.match(/pr-(\d+)/);
      if (prMatch?.[1]) {
        const prNum = parseInt(prMatch[1], 10);
        const resolved = await issueNumberFromPR(octokit, owner, repo, prNum);
        return {
          handler: "merge_group",
          issueNumber: resolved,
          prNumber: prNum,
        };
      }
      return { handler: "merge_group", issueNumber: null };
    }

    case "discussion":
      return { handler: "discussion", issueNumber: null };
    case "discussion_comment":
      return { handler: "discussion_comment", issueNumber: null };
    default:
      return { handler: eventName, issueNumber: null };
  }
}

/**
 * Extract phase number from sub-issue title
 * Expected format: "[Phase N] Title (parent #XXX)"
 */
function extractPhaseNumber(title: string): number {
  const match = title.match(/^\[Phase\s*(\d+)\]/i);
  return match?.[1] ? parseInt(match[1], 10) : 0;
}

function hasSkipLabel(labels: string[]): boolean {
  return labels.some((l) => l === "skip-dispatch" || l === "test:automation");
}

function hasTestAutomationLabel(
  labels: Array<{ name: string }> | string[],
): boolean {
  return labels.some((l) =>
    typeof l === "string"
      ? l === "test:automation"
      : l.name === "test:automation",
  );
}

function isTestResource(title: string): boolean {
  return title.startsWith("[TEST]");
}

function shouldSkipTestResource(
  title: string,
  labels: Array<{ name: string }> | string[],
): boolean {
  // Allow [TEST] resources through when test:automation label is present
  if (hasTestAutomationLabel(labels)) {
    return false;
  }
  return isTestResource(title);
}

async function ensureBranchExists(branch: string): Promise<boolean> {
  // Check if branch exists remotely
  const { exitCode } = await execCommand(
    "git",
    ["ls-remote", "--heads", "origin", branch],
    { ignoreReturnCode: true },
  );

  if (exitCode === 0) {
    // Check if output contains the branch (ls-remote returns 0 even if no match)
    const { stdout } = await execCommand("git", [
      "ls-remote",
      "--heads",
      "origin",
      branch,
    ]);
    if (stdout.includes(branch)) {
      core.info(`Branch ${branch} exists`);
      return true;
    }
  }

  // Branch doesn't exist - create it
  core.info(`Creating branch ${branch}`);
  await execCommand("git", ["checkout", "-b", branch]);
  const { exitCode: pushCode } = await execCommand(
    "git",
    ["push", "-u", "origin", branch],
    { ignoreReturnCode: true },
  );

  if (pushCode !== 0) {
    core.warning(`Failed to push branch ${branch}`);
    return false;
  }

  core.info(`Created and pushed branch ${branch}`);
  return true;
}

async function checkBranchExists(branch: string): Promise<boolean> {
  const { stdout } = await execCommand(
    "git",
    ["ls-remote", "--heads", "origin", branch],
    { ignoreReturnCode: true },
  );
  return stdout.includes(branch);
}

/**
 * Check if project status indicates the issue should be skipped.
 * Uses issueState.issue.projectStatus from parseIssue instead of a separate query.
 */
function shouldSkipProjectStatus(issueState: IssueStateData | null): boolean {
  const status = issueState?.issue.projectStatus;
  if (!status) return false;
  const skipStatuses = ["Done", "Blocked", "Error"];
  return skipStatuses.includes(status);
}

/**
 * Derive isClaudePr from issueState PR data
 */
function isClaudePr(issueState: IssueStateData | null): boolean {
  const pr = issueState?.issue.pr;
  if (!pr) return false;
  const claudeAuthors = ["nopo-bot", "claude[bot]"];
  return (
    claudeAuthors.includes(pr.author ?? "") || pr.headRef.startsWith("claude/")
  );
}

// ── Helpers for reading IssueStateData in place of old IssueDetails ──

function isSubIssue(issueState: IssueStateData | null): boolean {
  return !!issueState?.issue.parentIssueNumber;
}

function parentIssueNumber(issueState: IssueStateData | null): number {
  return issueState?.issue.parentIssueNumber ?? 0;
}

function subIssueNumbers(issueState: IssueStateData | null): number[] {
  return issueState?.issue.subIssues.map((s) => s.number) ?? [];
}

function issueLabels(issueState: IssueStateData | null): string[] {
  return issueState?.issue.labels ?? [];
}

function issueTitle(issueState: IssueStateData | null): string {
  return issueState?.issue.title ?? "";
}

// ============================================================================
// Event Handlers
// ============================================================================

async function handleIssueEvent(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  issueState: IssueStateData,
): Promise<DetectionResult> {
  const { context } = github;
  const payload = context.payload;
  const action = payload.action ?? "";
  const issue = IssuePayloadSchema.parse(payload.issue);

  // ALWAYS skip issues with test:automation label
  // These are created by sm-test.yml and should not be processed by normal automation
  // sm-test.yml uses sm-test-runner directly, not this detect-event workflow
  const hasTestLabel = issue.labels.some((l) => l.name === "test:automation");
  if (hasTestLabel) {
    return emptyResult(
      true,
      "Issue has test:automation label - skipping from normal automation",
    );
  }

  // Check for [TEST] in title (circuit breaker for test automation)
  if (isTestResource(issue.title)) {
    // Double-check using pre-fetched issue details from API
    // This handles race condition where webhook payload has stale label data
    // when an issue is created with labels (GitHub eventual consistency)
    if (issueLabels(issueState).includes("test:automation")) {
      return emptyResult(
        true,
        "Issue has test:automation label (verified via API) - skipping from normal automation",
      );
    }
    return emptyResult(true, "Issue title starts with [TEST]");
  }

  // Check for skip-dispatch label
  const hasSkipLabelOnIssue = issue.labels.some(
    (l) => l.name === "skip-dispatch",
  );
  if (hasSkipLabelOnIssue) {
    return emptyResult(true, "Issue has skip-dispatch label");
  }

  const hasTriagedLabel = issue.labels.some((l) => l.name === "triaged");

  // Handle triage: opened, edited (without triaged label), or unlabeled (removing triaged)
  // BUT only if nopo-bot is NOT assigned (if assigned, edited triggers iteration instead)
  const assignees = issue.assignees;
  const isNopoBotAssigned = assignees?.some((a) => a.login === "nopo-bot");

  if (
    action === "opened" ||
    (action === "unlabeled" &&
      LabelSchema.safeParse(payload.label).data?.name === "triaged")
  ) {
    if (hasTriagedLabel && action !== "unlabeled") {
      return emptyResult(true, "Issue already triaged");
    }

    // Check if sub-issue - either by parent relationship OR by title pattern
    // Title pattern check handles race condition when parent relationship isn't set yet
    const hasPhaseTitle = /^\[Phase \d+\]/.test(issue.title);
    if (isSubIssue(issueState) || hasPhaseTitle) {
      return emptyResult(
        true,
        isSubIssue(issueState)
          ? "Issue is a sub-issue"
          : "Issue has phase title pattern",
      );
    }

    return {
      job: "issue-triage",
      resourceType: "issue",
      resourceNumber: String(issue.number),
      commentId: "",
      contextJson: {
        issue_number: String(issue.number),
        // Note: issue_title fetched by parseIssue
      },
      skip: false,
      skipReason: "",
    };
  }

  // Handle edited: triggers iteration if nopo-bot is assigned, otherwise triage
  if (action === "edited") {
    // Skip if the edit was made by a bot or automated account
    // This prevents the workflow from re-triggering when the state machine updates the issue
    // Use explicit workflow dispatch (e.g., from CI completion) to continue iteration
    const sender = UserLoginSchema.safeParse(payload.sender).data?.login ?? "";
    const botAccounts = [
      "nopo-bot",
      "nopo-reviewer",
      "claude[bot]",
      "github-actions[bot]",
    ];
    if (botAccounts.includes(sender)) {
      return emptyResult(
        true,
        `Edit made by bot/automated account (${sender}) - use workflow dispatch to continue`,
      );
    }

    // Check for grooming trigger: triaged but not groomed and not needs-info
    // This allows grooming to run automatically after triage completes
    const hasGroomedLabel = issue.labels.some((l) => l.name === "groomed");
    const hasNeedsInfoLabel = issue.labels.some((l) => l.name === "needs-info");

    if (
      hasTriagedLabel &&
      !hasGroomedLabel &&
      !hasNeedsInfoLabel &&
      !isNopoBotAssigned
    ) {
      // Check if sub-issue - sub-issues don't go through grooming
      const hasPhaseTitle = /^\[Phase \d+\]/.test(issue.title);
      if (!isSubIssue(issueState) && !hasPhaseTitle) {
        return {
          job: "issue-groom",
          resourceType: "issue",
          resourceNumber: String(issue.number),
          commentId: "",
          contextJson: {
            issue_number: String(issue.number),
            trigger_type: "issue-groom",
            // Note: issue_title fetched by parseIssue
          },
          skip: false,
          skipReason: "",
        };
      }
    }

    // If nopo-bot is assigned, edited triggers iteration (issue-edit-based loop)
    if (isNopoBotAssigned) {
      // Check project status - skip if in terminal/blocked state
      if (shouldSkipProjectStatus(issueState)) {
        return emptyResult(
          true,
          `Issue project status is '${issueState.issue.projectStatus}' - skipping iteration`,
        );
      }

      // Check if this is a sub-issue (has parent) - route to iterate with parent context
      if (isSubIssue(issueState)) {
        return {
          job: "issue-iterate",
          resourceType: "issue",
          resourceNumber: String(issue.number),
          commentId: "",
          contextJson: {
            issue_number: String(issue.number),
            trigger_type: "issue-edited",
            parent_issue: String(parentIssueNumber(issueState)),
            // Note: branch_name, project_* fields removed - fetched by parseIssue
          },
          skip: false,
          skipReason: "",
        };
      }

      // Check if this is a main issue with sub-issues - route to orchestrate
      const subs = subIssueNumbers(issueState);
      if (subs.length > 0) {
        return {
          job: "issue-orchestrate",
          resourceType: "issue",
          resourceNumber: String(issue.number),
          commentId: "",
          contextJson: {
            issue_number: String(issue.number),
            sub_issues: subs.join(","),
            trigger_type: "issue-edited",
            // Note: project_* fields removed - fetched by parseIssue
          },
          skip: false,
          skipReason: "",
        };
      }

      // Regular issue without sub-issues
      return {
        job: "issue-iterate",
        resourceType: "issue",
        resourceNumber: String(issue.number),
        commentId: "",
        contextJson: {
          issue_number: String(issue.number),
          trigger_type: "issue-edited",
          // Note: branch_name, project_* fields removed - fetched by parseIssue
        },
        skip: false,
        skipReason: "",
      };
    }

    // Not assigned to nopo-bot - check if needs triage
    if (!hasTriagedLabel) {
      // Check for sub-issue or phase title pattern
      const hasPhaseTitle = /^\[Phase \d+\]/.test(issue.title);
      if (isSubIssue(issueState) || hasPhaseTitle) {
        return emptyResult(
          true,
          isSubIssue(issueState)
            ? "Issue is a sub-issue"
            : "Issue has phase title pattern",
        );
      }

      return {
        job: "issue-triage",
        resourceType: "issue",
        resourceNumber: String(issue.number),
        commentId: "",
        contextJson: {
          issue_number: String(issue.number),
          // Note: issue_title fetched by parseIssue
        },
        skip: false,
        skipReason: "",
      };
    }

    return emptyResult(
      true,
      "Issue edited but already triaged and not assigned to nopo-bot",
    );
  }

  // Handle closed: if sub-issue is closed, trigger parent orchestration
  if (action === "closed") {
    // Only handle sub-issues being closed
    if (!isSubIssue(issueState)) {
      return emptyResult(true, "Closed issue is not a sub-issue");
    }

    // Route to orchestrate so it can check if all sub-issues are done
    // Note: Parent issue details fetched by parseIssue in state machine
    return {
      job: "issue-orchestrate",
      resourceType: "issue",
      resourceNumber: String(parentIssueNumber(issueState)),
      commentId: "",
      contextJson: {
        issue_number: String(parentIssueNumber(issueState)),
        trigger_type: "issue-orchestrate",
        closed_sub_issue: String(issue.number),
        // Note: project_* fields removed - fetched by parseIssue
      },
      skip: false,
      skipReason: "",
    };
  }

  // Handle implement: assigned to nopo-bot
  if (action === "assigned") {
    const assignee = UserLoginSchema.parse(payload.assignee);
    if (assignee.login !== "nopo-bot") {
      return emptyResult(true, "Not assigned to nopo-bot");
    }

    // Check project status - skip if in terminal/blocked state
    // Note: "Backlog" is allowed for assigned events (it's the initial state before state machine starts)
    const terminalStatuses = ["Done", "Blocked", "Error"];
    if (
      issueState.issue.projectStatus &&
      terminalStatuses.includes(issueState.issue.projectStatus)
    ) {
      return emptyResult(
        true,
        `Issue project status is '${issueState.issue.projectStatus}' - skipping iteration`,
      );
    }

    // Check if this is a sub-issue (has parent) - route to iterate with parent context
    // Sub-issues don't need triaged label - they're created by triage
    if (isSubIssue(issueState)) {
      const phaseNumber = extractPhaseNumber(issueTitle(issueState));
      const branchName = deriveBranch(
        parentIssueNumber(issueState),
        phaseNumber || issue.number,
      );

      // Ensure the branch exists (create if not)
      await ensureBranchExists(branchName);

      return {
        job: "issue-iterate",
        resourceType: "issue",
        resourceNumber: String(issue.number),
        commentId: "",
        contextJson: {
          issue_number: String(issue.number),
          branch_name: branchName,
          trigger_type: "issue-assigned",
          parent_issue: String(parentIssueNumber(issueState)),
          // Note: project_* fields removed - fetched by parseIssue
        },
        skip: false,
        skipReason: "",
      };
    }

    // For parent issues: require triaged label OR sub-issues before work can start
    // This prevents iterate from running before triage completes
    const subs = subIssueNumbers(issueState);
    if (!hasTriagedLabel && subs.length === 0) {
      return emptyResult(
        true,
        "Issue not triaged yet - waiting for triage to complete and create sub-issues",
      );
    }

    // Check if this is a main issue with sub-issues - route to orchestrate
    if (subs.length > 0) {
      return {
        job: "issue-orchestrate",
        resourceType: "issue",
        resourceNumber: String(issue.number),
        commentId: "",
        contextJson: {
          issue_number: String(issue.number),
          sub_issues: subs.join(","),
          trigger_type: "issue-assigned",
          // Note: project_* fields removed - fetched by parseIssue
        },
        skip: false,
        skipReason: "",
      };
    }

    // Regular issue without sub-issues - use the unified iteration model
    const branchName = `claude/issue/${issue.number}`;

    // Ensure the branch exists (create if not)
    await ensureBranchExists(branchName);

    return {
      job: "issue-iterate",
      resourceType: "issue",
      resourceNumber: String(issue.number),
      commentId: "",
      contextJson: {
        issue_number: String(issue.number),
        branch_name: branchName,
        trigger_type: "issue-assigned",
        // Note: project_* fields removed - fetched by parseIssue
      },
      skip: false,
      skipReason: "",
    };
  }

  return emptyResult(true, `Unhandled issue action: ${action}`);
}

async function handleIssueCommentEvent(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  resolvedIssueNumber: number,
  issueState: IssueStateData,
): Promise<DetectionResult> {
  const { context } = github;
  const payload = context.payload;
  const comment = IssueCommentPayloadSchema.parse(payload.comment);
  const issue = IssueForCommentPayloadSchema.parse(payload.issue);

  // ALWAYS skip issues with test:automation label
  const hasTestLabel = issue.labels.some((l) => l.name === "test:automation");
  if (hasTestLabel) {
    return emptyResult(
      true,
      "Issue has test:automation label - skipping from normal automation",
    );
  }

  // Check for [TEST] in title (circuit breaker for test automation)
  if (isTestResource(issue.title)) {
    return emptyResult(true, "Issue/PR title starts with [TEST]");
  }

  // Check for skip-dispatch label
  const hasSkipLabelOnIssue = issue.labels.some(
    (l) => l.name === "skip-dispatch",
  );
  if (hasSkipLabelOnIssue) {
    return emptyResult(true, "Issue has skip-dispatch label");
  }

  // Skip bot comments
  if (comment.user.type === "Bot") {
    return emptyResult(true, "Comment is from a bot");
  }

  // Check for /implement, /continue, /lfg, /reset, or /pivot command (issues only, not PRs)
  const isPr = !!issue.pull_request;
  const commandLines = comment.body.split("\n").map((line) => line.trim());
  const hasImplementCommand = commandLines.some(
    (line) => line === "/implement",
  );
  const hasContinueCommand = commandLines.some((line) => line === "/continue");
  const hasLfgCommand = commandLines.some((line) => line === "/lfg");
  const hasResetCommand = commandLines.some((line) => line === "/reset");
  const hasRetryCommand = commandLines.some((line) => line === "/retry");
  const hasPivotCommand = commandLines.some((line) =>
    line.startsWith("/pivot"),
  );

  // Handle /reset command - resets issue to Backlog/Ready state
  if (hasResetCommand && !isPr) {
    // Add reaction to acknowledge the command
    await addReactionToComment(octokit, owner, repo, comment.id, "eyes");

    return {
      job: "issue-reset",
      resourceType: "issue",
      resourceNumber: String(issue.number),
      commentId: String(comment.id),
      contextJson: {
        issue_number: String(issue.number),
        trigger_type: "issue-reset",
        // Note: sub_issues fetched by parseIssue
      },
      skip: false,
      skipReason: "",
    };
  }

  // Handle /pivot command - modifies issue specifications mid-flight
  if (hasPivotCommand && !isPr) {
    // Add reaction to acknowledge the command
    await addReactionToComment(octokit, owner, repo, comment.id, "eyes");

    // Extract pivot description (everything after /pivot on the same line)
    const pivotLine = comment.body
      .split("\n")
      .find((l) => l.trim().startsWith("/pivot"));
    const pivotDescription = pivotLine?.replace(/^\/pivot\s*/, "").trim() || "";

    // If triggered on sub-issue, redirect to parent
    const targetIssue = isSubIssue(issueState)
      ? parentIssueNumber(issueState)
      : issue.number;

    return {
      job: "issue-pivot",
      resourceType: "issue",
      resourceNumber: String(targetIssue),
      commentId: String(comment.id),
      contextJson: {
        issue_number: String(targetIssue),
        pivot_description: pivotDescription,
        triggered_from: String(issue.number),
        trigger_type: "issue-pivot",
        // Note: sub_issues fetched by parseIssue
      },
      skip: false,
      skipReason: "",
    };
  }

  // Handle /retry command - clears failures and resumes work (circuit breaker recovery)
  if (hasRetryCommand && !isPr) {
    // Add rocket reaction to acknowledge the command (resuming work, like /lfg)
    await addReactionToComment(octokit, owner, repo, comment.id, "rocket");

    const hasTriagedLabel = issue.labels.some((l) => l.name === "triaged");
    const hasGroomedLabel = issue.labels.some((l) => l.name === "groomed");

    // /retry on untriaged issue -> skip, triage first
    if (!hasTriagedLabel) {
      return emptyResult(
        true,
        "Cannot retry untriaged issue - run triage first",
      );
    }

    // /retry on ungroomed issue -> skip, groom first
    if (!hasGroomedLabel) {
      return emptyResult(
        true,
        "Cannot retry ungroomed issue - run grooming first",
      );
    }

    // Check if this is a sub-issue
    if (isSubIssue(issueState)) {
      const phaseNumber = extractPhaseNumber(issueTitle(issueState));
      const branchName = deriveBranch(
        parentIssueNumber(issueState),
        phaseNumber || issue.number,
      );
      const branchExists = await checkBranchExists(branchName);

      if (!branchExists) {
        await ensureBranchExists(branchName);
      }

      // /retry on sub-issue -> iterate with issue-retry trigger
      return {
        job: "issue-iterate",
        resourceType: "issue",
        resourceNumber: String(issue.number),
        commentId: String(comment.id),
        contextJson: {
          issue_number: String(issue.number),
          branch_name: branchName,
          trigger_type: "issue-retry",
          parent_issue: String(parentIssueNumber(issueState)),
        },
        skip: false,
        skipReason: "",
      };
    }

    // Check if this is a parent issue with sub-issues -> orchestrate
    const subs = subIssueNumbers(issueState);
    if (subs.length > 0) {
      return {
        job: "issue-orchestrate",
        resourceType: "issue",
        resourceNumber: String(issue.number),
        commentId: String(comment.id),
        contextJson: {
          issue_number: String(issue.number),
          sub_issues: subs.join(","),
          trigger_type: "issue-retry",
        },
        skip: false,
        skipReason: "",
      };
    }

    // /retry on simple issue -> iterate
    const branchName = `claude/issue/${issue.number}`;
    await ensureBranchExists(branchName);

    return {
      job: "issue-iterate",
      resourceType: "issue",
      resourceNumber: String(issue.number),
      commentId: String(comment.id),
      contextJson: {
        issue_number: String(issue.number),
        branch_name: branchName,
        trigger_type: "issue-retry",
      },
      skip: false,
      skipReason: "",
    };
  }

  // Handle /lfg on PRs - triggers PR response flow based on current review state
  if ((hasImplementCommand || hasContinueCommand || hasLfgCommand) && isPr) {
    // Add rocket reaction to acknowledge the command
    await addReactionToComment(octokit, owner, repo, comment.id, "rocket");

    const pr = issueState.issue.pr;

    // Skip if PR is a draft
    if (pr?.isDraft) {
      return emptyResult(
        true,
        "PR is a draft - convert to ready for review first",
      );
    }

    // Find the most recent non-dismissed review with changes requested
    const pendingReview = pr?.reviews
      ?.filter((r) => r.state === "CHANGES_REQUESTED")
      .pop();

    if (!pendingReview) {
      // No pending changes requested - check if there's any review decision
      if (pr?.reviewDecision === "APPROVED") {
        return emptyResult(true, "PR is already approved");
      }
      return emptyResult(true, "No pending changes requested on this PR");
    }

    // Determine if reviewer is Claude or human
    const claudeReviewers = ["nopo-reviewer", "claude[bot]"];
    const isClaudeReviewer = claudeReviewers.includes(pendingReview.author);
    const job = isClaudeReviewer ? "pr-response" : "pr-human-response";
    // Use the job name as trigger type to match schema expectations
    const triggerType = job;

    return {
      job,
      resourceType: "pr",
      resourceNumber: String(issue.number),
      commentId: String(comment.id),
      contextJson: {
        pr_number: String(issue.number),
        branch_name: pr?.headRef ?? "main",
        review_state: "changes_requested",
        review_decision: "CHANGES_REQUESTED",
        review_body: pendingReview.body ?? "",
        reviewer: pendingReview.author,
        reviewer_login: pendingReview.author,
        issue_number: String(resolvedIssueNumber),
        trigger_type: triggerType,
      },
      skip: false,
      skipReason: "",
    };
  }

  if ((hasImplementCommand || hasContinueCommand || hasLfgCommand) && !isPr) {
    // Add rocket reaction to acknowledge the command
    await addReactionToComment(octokit, owner, repo, comment.id, "rocket");

    // Check if this is a sub-issue
    if (isSubIssue(issueState)) {
      const phaseNumber = extractPhaseNumber(issueTitle(issueState));
      const branchName = deriveBranch(
        parentIssueNumber(issueState),
        phaseNumber || issue.number,
      );
      const branchExists = await checkBranchExists(branchName);

      if (!branchExists) {
        await ensureBranchExists(branchName);
      }

      // /lfg on sub-issue -> iterate (trigger_type must route to iterating, not commenting)
      return {
        job: "issue-iterate",
        resourceType: "issue",
        resourceNumber: String(issue.number),
        commentId: String(comment.id),
        contextJson: {
          issue_number: String(issue.number),
          branch_name: branchName,
          trigger_type: "issue-assigned", // Routes to iterating state, not commenting
          parent_issue: String(parentIssueNumber(issueState)),
        },
        skip: false,
        skipReason: "",
      };
    }

    // Check if issue needs grooming first (triaged but not groomed)
    // This check happens before sub-issues check because parent issues also need grooming
    const hasGroomedLabel = issue.labels.some((l) => l.name === "groomed");
    const hasNeedsInfoLabel = issue.labels.some((l) => l.name === "needs-info");
    const hasTriagedLabel = issue.labels.some((l) => l.name === "triaged");

    if (!hasTriagedLabel) {
      // /lfg on untriaged issue -> triage first
      return {
        job: "issue-triage",
        resourceType: "issue",
        resourceNumber: String(issue.number),
        commentId: String(comment.id),
        contextJson: {
          issue_number: String(issue.number),
        },
        skip: false,
        skipReason: "",
      };
    }

    if (!hasGroomedLabel && !hasNeedsInfoLabel) {
      // /lfg on ungroomed issue -> groom first
      return {
        job: "issue-groom",
        resourceType: "issue",
        resourceNumber: String(issue.number),
        commentId: String(comment.id),
        contextJson: {
          issue_number: String(issue.number),
          trigger_type: "issue-groom",
        },
        skip: false,
        skipReason: "",
      };
    }

    // Check if this is a parent issue with sub-issues - route to orchestrate
    const subs = subIssueNumbers(issueState);
    if (subs.length > 0) {
      // /lfg on parent with sub-issues -> orchestrate
      return {
        job: "issue-orchestrate",
        resourceType: "issue",
        resourceNumber: String(issue.number),
        commentId: String(comment.id),
        contextJson: {
          issue_number: String(issue.number),
          sub_issues: subs.join(","),
          trigger_type: "issue-orchestrate", // Routes to orchestrating state
        },
        skip: false,
        skipReason: "",
      };
    }

    const branchName = `claude/issue/${issue.number}`;

    // Ensure the branch exists (create if not)
    await ensureBranchExists(branchName);

    // /lfg on simple issue -> iterate
    return {
      job: "issue-iterate",
      resourceType: "issue",
      resourceNumber: String(issue.number),
      commentId: String(comment.id),
      contextJson: {
        issue_number: String(issue.number),
        branch_name: branchName,
        trigger_type: "issue-assigned", // Routes to iterating state, not commenting
      },
      skip: false,
      skipReason: "",
    };
  }

  // Must contain @claude for other comment handling
  if (!comment.body.includes("@claude")) {
    return emptyResult(true, "Comment does not mention @claude");
  }

  let contextType = "issue";
  let branchName = "main";
  let linkedIssueNumber = String(resolvedIssueNumber);
  let prNumber = "";

  if (isPr) {
    const pr = issueState.issue.pr;
    branchName = pr?.headRef ?? "main";
    contextType = "pr";
    prNumber = String(issue.number);
    linkedIssueNumber = String(resolvedIssueNumber);
  } else {
    // Check if issue has a branch
    const issueBranch = `claude/issue/${issue.number}`;
    if (await checkBranchExists(issueBranch)) {
      branchName = issueBranch;
    }
  }

  const contextDescription =
    branchName === "main"
      ? `This is ${contextType.toLowerCase()} #${issue.number}. You are checked out on main.`
      : `This is ${contextType} #${issue.number} on branch \`${branchName}\`. You are checked out on the ${isPr ? "PR" : "issue"} branch.`;

  return {
    job: "issue-comment",
    resourceType: isPr ? "pr" : "issue",
    resourceNumber: String(issue.number),
    commentId: String(comment.id),
    contextJson: {
      issue_number: linkedIssueNumber,
      pr_number: prNumber,
      context_type: contextType,
      context_description: contextDescription,
      branch_name: branchName,
    },
    skip: false,
    skipReason: "",
  };
}

async function handlePullRequestReviewCommentEvent(
  _issueState: IssueStateData | null,
): Promise<DetectionResult> {
  const { context } = github;
  const payload = context.payload;
  const comment = ReviewCommentPayloadSchema.parse(payload.comment);
  const pr = PullRequestForReviewCommentPayloadSchema.parse(
    payload.pull_request,
  );

  // ALWAYS skip PRs with test:automation label
  const hasTestLabel = pr.labels.some((l) => l.name === "test:automation");
  if (hasTestLabel) {
    return emptyResult(
      true,
      "PR has test:automation label - skipping from normal automation",
    );
  }

  // Check for [TEST] in title (circuit breaker for test automation)
  if (isTestResource(pr.title)) {
    return emptyResult(true, "PR title starts with [TEST]");
  }

  // Check for skip-dispatch label
  const hasSkipLabelOnPr = pr.labels.some((l) => l.name === "skip-dispatch");
  if (hasSkipLabelOnPr) {
    return emptyResult(true, "PR has skip-dispatch label");
  }

  // Skip test branches (circuit breaker for test automation)
  if (pr.head.ref.startsWith("test/")) {
    return emptyResult(true, "PR is on a test branch");
  }

  // Skip bot comments
  if (comment.user.type === "Bot") {
    return emptyResult(true, "Comment is from a bot");
  }

  // Must contain @claude
  if (!comment.body.includes("@claude")) {
    return emptyResult(true, "Comment does not mention @claude");
  }

  return {
    job: "issue-comment",
    resourceType: "pr",
    resourceNumber: String(pr.number),
    commentId: String(comment.id),
    contextJson: {
      issue_number: String(pr.number),
      context_type: "pr",
      context_description: `This is PR #${pr.number} on branch \`${pr.head.ref}\`. You are checked out on the PR branch with the code changes.`,
      branch_name: pr.head.ref,
    },
    skip: false,
    skipReason: "",
  };
}

async function handlePushEvent(
  issueState: IssueStateData | null,
): Promise<DetectionResult> {
  const { context } = github;
  const ref = context.ref;
  const branch = ref.replace("refs/heads/", "");

  // Skip main branch
  if (branch === "main") {
    return emptyResult(true, "Push to main branch");
  }

  // Skip merge queue branches
  if (branch.startsWith("gh-readonly-queue/")) {
    return emptyResult(true, "Push to merge queue branch");
  }

  // Skip test branches (circuit breaker for test automation)
  if (branch.startsWith("test/")) {
    return emptyResult(true, "Push to test branch");
  }

  const pr = issueState?.issue.pr;

  if (!pr) {
    return emptyResult(true, "No PR found for branch");
  }

  // Check for skip labels on PR (circuit breaker for test automation)
  if (hasSkipLabel(pr.labels)) {
    return emptyResult(true, "PR has skip-dispatch or test:automation label");
  }

  // Check for [TEST] in PR title (circuit breaker for test automation)
  // Skip unless test:automation label is present
  if (shouldSkipTestResource(pr.title, pr.labels)) {
    return emptyResult(true, "PR title starts with [TEST]");
  }

  // Check if the linked issue has test:automation label
  if (issueLabels(issueState).includes("test:automation")) {
    return emptyResult(
      true,
      "Linked issue has test:automation label - skipping from normal automation",
    );
  }

  // Skip push events when PR is already draft — we're in the iteration loop
  // and CI completion will trigger the next state machine run.
  // pr-push is only meaningful when PR is ready for review (not draft),
  // to interrupt in-flight reviews and convert back to draft.
  if (pr.isDraft) {
    return emptyResult(true, "PR is already draft - waiting for CI");
  }

  const owner = context.repo.owner;
  const repo = context.repo.repo;

  // Construct run URL for history entry
  const serverUrl = process.env.GITHUB_SERVER_URL || "https://github.com";
  const runId = process.env.GITHUB_RUN_ID || "";
  const commitSha = github.context.sha;
  const runUrl = `${serverUrl}/${owner}/${repo}/actions/runs/${runId}`;

  // Extract issue number from branch name for context
  const branchMatch = branch.match(/^claude\/issue\/(\d+)/);
  const issueNumber = branchMatch?.[1] ?? "";

  // PR push converts PR to draft and logs history
  return {
    job: "pr-push",
    resourceType: "pr",
    resourceNumber: String(pr.number),
    commentId: "",
    contextJson: {
      pr_number: String(pr.number),
      branch_name: branch,
      is_draft: pr.isDraft,
      issue_number: issueNumber,
      // Include commit SHA and run URL for history entry
      ci_commit_sha: commitSha,
      ci_run_url: runUrl,
    },
    skip: false,
    skipReason: "",
  };
}

async function handleWorkflowRunEvent(
  issueState: IssueStateData | null,
  resolvedIssueNumber: number | null,
): Promise<DetectionResult> {
  const { context } = github;
  const payload = context.payload;
  const workflowRun = WorkflowRunPayloadSchema.parse(payload.workflow_run);

  const conclusion = workflowRun.conclusion;
  const branch = workflowRun.head_branch;
  const headSha = workflowRun.head_sha;
  const runId = String(workflowRun.id);

  // Skip test branches (circuit breaker for test automation)
  if (branch.startsWith("test/")) {
    return emptyResult(true, "Workflow run on test branch");
  }

  const pr = issueState?.issue.pr;

  if (!pr) {
    return emptyResult(true, "No PR found for workflow run branch");
  }

  // Check for skip labels on PR (circuit breaker for test automation)
  if (hasSkipLabel(pr.labels)) {
    return emptyResult(true, "PR has skip-dispatch or test:automation label");
  }

  // Check for [TEST] in PR title (circuit breaker for test automation)
  // Skip unless test:automation label is present
  if (shouldSkipTestResource(pr.title, pr.labels)) {
    return emptyResult(true, "PR title starts with [TEST]");
  }

  if (!isClaudePr(issueState))
    return emptyResult(true, "PR is not a Claude PR");

  if (!resolvedIssueNumber) core.setFailed("PR has no issue number");

  const issueNumber = String(resolvedIssueNumber ?? "");

  // Check if the linked issue has test:automation label
  // This catches test issues even when the PR doesn't have the label
  if (issueLabels(issueState).includes("test:automation")) {
    return emptyResult(
      true,
      "Linked issue has test:automation label - skipping from normal automation",
    );
  }

  const owner = context.repo.owner;
  const repo = context.repo.repo;

  // Construct CI run URL
  const serverUrl = process.env.GITHUB_SERVER_URL || "https://github.com";
  const ciRunUrl = `${serverUrl}/${owner}/${repo}/actions/runs/${runId}`;

  return {
    job: "issue-iterate",
    resourceType: "issue",
    resourceNumber: issueNumber,
    commentId: "",
    contextJson: {
      issue_number: issueNumber,
      pr_number: String(pr.number),
      branch_name: branch,
      ci_run_url: ciRunUrl,
      ci_result: conclusion,
      ci_commit_sha: headSha,
      trigger_type: "workflow-run-completed",
      parent_issue: String(parentIssueNumber(issueState)),
    },
    skip: false,
    skipReason: "",
  };
}

async function handlePullRequestEvent(
  resolvedIssueNumber: number | null,
): Promise<DetectionResult> {
  const { context } = github;
  const payload = context.payload;
  const action = payload.action ?? "";
  const pr = PullRequestPayloadSchema.parse(payload.pull_request);

  // Check for [TEST] in title (circuit breaker for test automation)
  // Skip unless test:automation label is present
  if (shouldSkipTestResource(pr.title, pr.labels)) {
    return emptyResult(true, "PR title starts with [TEST]");
  }

  // Check for skip-dispatch label
  const hasSkipLabelOnPr = pr.labels.some(
    (l) => l.name === "skip-dispatch" || l.name === "test:automation",
  );
  if (hasSkipLabelOnPr) {
    return emptyResult(true, "PR has skip-dispatch or test:automation label");
  }

  // Skip test branches (circuit breaker for test automation)
  if (pr.head.ref.startsWith("test/")) {
    return emptyResult(true, "PR is on a test branch");
  }

  if (action === "review_requested") {
    const requestedReviewer = UserLoginSchema.parse(payload.requested_reviewer);
    const validReviewers = ["nopo-bot", "nopo-reviewer"];
    if (!validReviewers.includes(requestedReviewer.login)) {
      return emptyResult(true, "Reviewer is not nopo-bot or nopo-reviewer");
    }

    if (pr.draft) {
      return emptyResult(true, "PR is a draft");
    }

    return {
      job: "pr-review-requested",
      resourceType: "pr",
      resourceNumber: String(pr.number),
      commentId: "",
      contextJson: {
        pr_number: String(pr.number),
        branch_name: pr.head.ref,
        issue_number: String(resolvedIssueNumber ?? ""),
      },
      skip: false,
      skipReason: "",
    };
  }

  return emptyResult(true, `Unhandled PR action: ${action}`);
}

async function handlePullRequestReviewEvent(
  resolvedIssueNumber: number | null,
  issueState: IssueStateData | null,
): Promise<DetectionResult> {
  const { context } = github;
  const payload = context.payload;
  const review = ReviewPayloadSchema.parse(payload.review);
  const pr = PullRequestPayloadSchema.parse(payload.pull_request);

  // Early return if review has no user (shouldn't happen, but be defensive)
  if (!review?.user?.login) {
    return emptyResult(true, "Review has no user information");
  }

  const reviewerLogin = review.user.login;

  // Check for [TEST] in title (circuit breaker for test automation)
  // Skip unless test:automation label is present
  if (shouldSkipTestResource(pr.title, pr.labels)) {
    return emptyResult(true, "PR title starts with [TEST]");
  }

  // Check for skip-dispatch label
  const hasSkipLabelOnPr = pr.labels.some(
    (l) => l.name === "skip-dispatch" || l.name === "test:automation",
  );
  if (hasSkipLabelOnPr) {
    return emptyResult(true, "PR has skip-dispatch or test:automation label");
  }

  // Skip test branches (circuit breaker for test automation)
  // This handles the case where label hasn't propagated to webhook payload yet
  if (pr.head.ref.startsWith("test/")) {
    return emptyResult(true, "PR is on a test branch");
  }

  // Skip if PR is draft
  if (pr.draft) {
    return emptyResult(true, "PR is a draft");
  }

  // Check if the linked issue has test:automation label
  // This catches test issues even when the PR doesn't have the label
  if (issueLabels(issueState).includes("test:automation")) {
    return emptyResult(
      true,
      "Linked issue has test:automation label - skipping from normal automation",
    );
  }

  const state = review.state.toLowerCase();
  const issueNumber = String(resolvedIssueNumber ?? "");

  // Handle approved state from nopo-reviewer (Claude's review account)
  // This triggers orchestration to merge the PR
  if (state === "approved" && reviewerLogin === "nopo-reviewer") {
    // Use parentIssueNumber from issueState instead of branch regex
    const parentIssueStr = String(parentIssueNumber(issueState));

    return {
      job: "pr-review-approved",
      resourceType: "pr",
      resourceNumber: String(pr.number),
      commentId: "",
      contextJson: {
        pr_number: String(pr.number),
        branch_name: pr.head.ref,
        review_state: state,
        review_decision: "APPROVED", // Uppercase for state machine
        review_id: String(review.id),
        issue_number: issueNumber,
        parent_issue: parentIssueStr,
      },
      skip: false,
      skipReason: "",
    };
  }

  // Only handle changes_requested or commented states for other reviews
  if (state !== "changes_requested" && state !== "commented") {
    return emptyResult(true, `Review state is ${state}`);
  }

  // Check if review is from Claude reviewer (pr-response) or human (pr-human-response)
  // nopo-reviewer is Claude's review account, claude[bot] is the direct API account
  const claudeReviewers = ["nopo-reviewer", "claude[bot]"];
  if (claudeReviewers.includes(reviewerLogin)) {
    // Convert state to uppercase for review_decision (e.g., "changes_requested" -> "CHANGES_REQUESTED")
    const reviewDecision = state.toUpperCase();

    return {
      job: "pr-response",
      resourceType: "pr",
      resourceNumber: String(pr.number),
      commentId: "",
      contextJson: {
        pr_number: String(pr.number),
        branch_name: pr.head.ref,
        review_state: state,
        review_decision: reviewDecision,
        review_body: review.body ?? "",
        review_id: String(review.id),
        reviewer: reviewerLogin,
        issue_number: issueNumber,
      },
      skip: false,
      skipReason: "",
    };
  }

  // Human review - check if this is a Claude PR
  // nopo-bot is Claude's code account, claude[bot] is the direct API account
  const claudeAuthors = ["nopo-bot", "claude[bot]"];
  // PR author can be in 'author' or 'user' field depending on event type
  const prAuthorLogin = pr.author?.login ?? pr.user?.login ?? "";
  const isClaudePrForReview =
    claudeAuthors.includes(prAuthorLogin) || pr.head.ref.startsWith("claude/");
  if (!isClaudePrForReview) {
    return emptyResult(true, "Human review on non-Claude PR");
  }

  // Convert state to uppercase for review_decision (e.g., "changes_requested" -> "CHANGES_REQUESTED")
  const reviewDecision = state.toUpperCase();

  return {
    job: "pr-human-response",
    resourceType: "pr",
    resourceNumber: String(pr.number),
    commentId: "",
    contextJson: {
      pr_number: String(pr.number),
      branch_name: pr.head.ref,
      reviewer_login: reviewerLogin,
      reviewer: reviewerLogin,
      review_state: state,
      review_decision: reviewDecision,
      review_body: review.body ?? "",
      review_id: String(review.id),
      issue_number: issueNumber,
    },
    skip: false,
    skipReason: "",
  };
}

async function handleDiscussionEvent(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
): Promise<DetectionResult> {
  const { context } = github;
  const payload = context.payload;
  const action = payload.action ?? "";
  const discussion = DiscussionPayloadSchema.parse(payload.discussion);

  // Fetch discussion labels via GraphQL
  let discussionLabels: string[] = [];
  try {
    const result = await octokit.graphql<{
      repository: {
        discussion: {
          labels: {
            nodes: Array<{ name: string }>;
          } | null;
        } | null;
      };
    }>(
      `
      query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          discussion(number: $number) {
            labels(first: 20) {
              nodes { name }
            }
          }
        }
      }
    `,
      { owner, repo, number: discussion.number },
    );
    discussionLabels =
      result.repository.discussion?.labels?.nodes?.map((l) => l.name) ?? [];
  } catch (error) {
    core.warning(`Failed to fetch discussion labels: ${error}`);
  }

  // Check for e2e test mode
  const isTestAutomation = discussionLabels.includes("test:automation");

  // Check for [TEST] in title (circuit breaker for test automation)
  // Skip unless in testing mode (test:automation label present)
  if (discussion.title.startsWith("[TEST]") && !isTestAutomation) {
    return emptyResult(true, "Discussion title starts with [TEST]");
  }

  if (action === "created") {
    return {
      job: "discussion-research",
      resourceType: "discussion",
      resourceNumber: String(discussion.number),
      commentId: "",
      contextJson: {
        discussion_number: String(discussion.number),
        discussion_title: discussion.title,
        discussion_body: discussion.body ?? "",
        trigger_type: "discussion-created",
        is_test_automation: isTestAutomation,
      },
      skip: false,
      skipReason: "",
    };
  }

  return emptyResult(true, `Unhandled discussion action: ${action}`);
}

async function handleMergeGroupEvent(
  resolvedIssueNumber: number | null,
  prNumber: number | undefined,
  issueState: IssueStateData | null,
): Promise<DetectionResult> {
  const { context } = github;
  const payload = context.payload;
  const mergeGroup = MergeGroupPayloadSchema.parse(payload.merge_group);
  const headRef = mergeGroup.head_ref;
  const owner = context.repo.owner;
  const repo = context.repo.repo;

  if (!prNumber) {
    return emptyResult(true, "No PR found in merge queue branch");
  }

  if (!resolvedIssueNumber) {
    return emptyResult(true, "Could not find linked issue for merge queue PR");
  }

  const issueNumber = String(resolvedIssueNumber);
  const parentIssueStr = isSubIssue(issueState)
    ? String(parentIssueNumber(issueState))
    : issueNumber;

  // Construct run URL
  const serverUrl = process.env.GITHUB_SERVER_URL || "https://github.com";
  const runId = process.env.GITHUB_RUN_ID || "";
  const ciRunUrl = `${serverUrl}/${owner}/${repo}/actions/runs/${runId}`;

  return {
    job: "merge-queue-logging",
    resourceType: "issue",
    resourceNumber: issueNumber,
    commentId: "",
    contextJson: {
      issue_number: issueNumber,
      parent_issue: parentIssueStr,
      pr_number: String(prNumber),
      trigger_type: "merge-queue-entered",
      ci_run_url: ciRunUrl,
      head_ref: headRef,
      head_sha: mergeGroup.head_sha,
    },
    skip: false,
    skipReason: "",
  };
}

async function handleDiscussionCommentEvent(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
): Promise<DetectionResult> {
  const { context } = github;
  const payload = context.payload;
  const discussion = DiscussionPayloadSchema.parse(payload.discussion);
  const comment = DiscussionCommentPayloadSchema.parse(payload.comment);

  // Fetch discussion labels via GraphQL
  let discussionLabels: string[] = [];
  try {
    const result = await octokit.graphql<{
      repository: {
        discussion: {
          labels: {
            nodes: Array<{ name: string }>;
          } | null;
        } | null;
      };
    }>(
      `
      query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          discussion(number: $number) {
            labels(first: 20) {
              nodes { name }
            }
          }
        }
      }
    `,
      { owner, repo, number: discussion.number },
    );
    discussionLabels =
      result.repository.discussion?.labels?.nodes?.map((l) => l.name) ?? [];
  } catch (error) {
    core.warning(`Failed to fetch discussion labels: ${error}`);
  }

  // Check for e2e test mode
  const isTestAutomation = discussionLabels.includes("test:automation");

  // Check for [TEST] in title (circuit breaker for test automation)
  // Skip unless in testing mode (test:automation label present)
  if (discussion.title.startsWith("[TEST]") && !isTestAutomation) {
    return emptyResult(true, "Discussion title starts with [TEST]");
  }

  const body = comment.body.trim();
  const author = comment.user.login;
  const isTopLevel = !comment.parent_id;

  // Check for commands first (any author can use commands)
  if (body === "/summarize") {
    await addReactionToDiscussionComment(octokit, comment.node_id, "EYES");
    return {
      job: "discussion-summarize",
      resourceType: "discussion",
      resourceNumber: String(discussion.number),
      commentId: comment.node_id,
      contextJson: {
        discussion_number: String(discussion.number),
        trigger_type: "discussion-command",
        command: "summarize",
        is_test_automation: isTestAutomation,
      },
      skip: false,
      skipReason: "",
    };
  }

  if (body === "/plan") {
    await addReactionToDiscussionComment(octokit, comment.node_id, "ROCKET");
    return {
      job: "discussion-plan",
      resourceType: "discussion",
      resourceNumber: String(discussion.number),
      commentId: comment.node_id,
      contextJson: {
        discussion_number: String(discussion.number),
        trigger_type: "discussion-command",
        command: "plan",
        is_test_automation: isTestAutomation,
      },
      skip: false,
      skipReason: "",
    };
  }

  if (body === "/complete") {
    await addReactionToDiscussionComment(octokit, comment.node_id, "THUMBS_UP");
    return {
      job: "discussion-complete",
      resourceType: "discussion",
      resourceNumber: String(discussion.number),
      commentId: comment.node_id,
      contextJson: {
        discussion_number: String(discussion.number),
        trigger_type: "discussion-command",
        command: "complete",
        is_test_automation: isTestAutomation,
      },
      skip: false,
      skipReason: "",
    };
  }

  // /lfg or /research - triggers research phase (spawns research threads)
  // Useful for kicking off research on existing discussions
  if (body === "/lfg" || body === "/research") {
    await addReactionToDiscussionComment(octokit, comment.node_id, "ROCKET");
    return {
      job: "discussion-research",
      resourceType: "discussion",
      resourceNumber: String(discussion.number),
      commentId: comment.node_id,
      contextJson: {
        discussion_number: String(discussion.number),
        discussion_title: discussion.title,
        discussion_body: discussion.body ?? "",
        trigger_type: "discussion-created",
        is_test_automation: isTestAutomation,
      },
      skip: false,
      skipReason: "",
    };
  }

  // Human comments - always respond
  if (author !== "claude[bot]" && author !== "nopo-bot") {
    return {
      job: "discussion-respond",
      resourceType: "discussion",
      resourceNumber: String(discussion.number),
      commentId: comment.node_id,
      contextJson: {
        discussion_number: String(discussion.number),
        comment_body: comment.body,
        comment_author: author,
        trigger_type: "discussion-comment",
        is_test_automation: isTestAutomation,
      },
      skip: false,
      skipReason: "",
    };
  }

  // Bot's research thread comments - skip, investigation happens in same workflow
  // that created the threads (no separate trigger needed)
  if (isTopLevel && comment.body.includes("## 🔍 Research:")) {
    return emptyResult(
      true,
      "Bot research thread - investigation handled in same workflow",
    );
  }

  // Bot's investigation findings - skip for now
  // Future: could trigger follow-up research if questions remain
  if (comment.body.includes("## 📊 Findings:")) {
    return emptyResult(true, "Bot investigation findings - no action needed");
  }

  // Skip all other bot comments to prevent infinite loops
  return emptyResult(true, "Bot comment - preventing infinite loop");
}

async function handleWorkflowDispatchEvent(
  resourceNumber: string,
  issueState: IssueStateData,
): Promise<DetectionResult> {
  if (!resourceNumber) {
    return emptyResult(
      true,
      "No resource_number provided for workflow_dispatch",
    );
  }

  const issueNum = parseInt(resourceNumber, 10);
  if (isNaN(issueNum)) {
    return emptyResult(true, `Invalid resource_number: ${resourceNumber}`);
  }

  core.info(`Workflow dispatch for issue #${issueNum}`);

  // Check project status - skip if in terminal/blocked state
  if (shouldSkipProjectStatus(issueState)) {
    return emptyResult(
      true,
      `Issue project status is '${issueState.issue.projectStatus}' - skipping iteration`,
    );
  }

  // Determine parent issue
  let parentIssueStr = "0";
  if (isSubIssue(issueState) && parentIssueNumber(issueState) > 0) {
    parentIssueStr = String(parentIssueNumber(issueState));
    core.info(`Issue #${issueNum} is a sub-issue of parent #${parentIssueStr}`);
  }

  // Check if grooming is needed BEFORE orchestration
  // Grooming needed: has "triaged" label but NOT "groomed" label
  const labels = issueLabels(issueState);
  const hasTriaged = labels.includes("triaged");
  const hasGroomed = labels.includes("groomed");

  if (hasTriaged && !hasGroomed) {
    core.info(
      `Issue #${issueNum} needs grooming (triaged=${hasTriaged}, groomed=${hasGroomed})`,
    );
    return {
      job: "issue-groom",
      resourceType: "issue",
      resourceNumber: String(issueNum),
      commentId: "",
      contextJson: {
        issue_number: String(issueNum),
        trigger_type: "issue-groom",
        parent_issue: parentIssueStr,
        // Note: project_* fields removed - fetched by parseIssue
      },
      skip: false,
      skipReason: "",
    };
  }

  // Check if this is a parent issue with sub-issues
  const subs = subIssueNumbers(issueState);
  if (subs.length > 0) {
    // Smart routing: check if a sub-issue is assigned to bot and needs iteration
    const assignedSubIssue = issueState.issue.subIssues.find(
      (sub) =>
        sub.state === "OPEN" &&
        sub.projectStatus !== "Done" &&
        sub.projectStatus !== "In review" &&
        sub.assignees.includes("nopo-bot"),
    );

    if (assignedSubIssue) {
      // Sub-issue is assigned and needs work — route to iterate on it
      const phaseNumber = extractPhaseNumber(assignedSubIssue.title);
      const branchName = deriveBranch(
        issueNum,
        phaseNumber || assignedSubIssue.number,
      );
      core.info(
        `Sub-issue #${assignedSubIssue.number} is assigned and needs work — routing to iterate`,
      );

      return {
        job: "issue-iterate",
        resourceType: "issue",
        resourceNumber: String(assignedSubIssue.number),
        commentId: "",
        contextJson: {
          issue_number: String(assignedSubIssue.number),
          branch_name: branchName,
          trigger_type: "issue-assigned",
          parent_issue: String(issueNum),
        },
        skip: false,
        skipReason: "",
      };
    }

    // Check for sub-issue in review — route to PR review
    const reviewSubIssue = issueState.issue.subIssues.find(
      (sub) =>
        sub.state === "OPEN" &&
        sub.projectStatus === "In review" &&
        sub.pr != null &&
        !sub.pr.isDraft,
    );

    if (reviewSubIssue && reviewSubIssue.pr) {
      const branchName = reviewSubIssue.pr.headRef;
      core.info(
        `Sub-issue #${reviewSubIssue.number} is in review with PR #${reviewSubIssue.pr.number} — routing to review`,
      );

      return {
        job: "pr-review-requested",
        resourceType: "pr",
        resourceNumber: String(reviewSubIssue.pr.number),
        commentId: "",
        contextJson: {
          pr_number: String(reviewSubIssue.pr.number),
          branch_name: branchName,
          issue_number: String(reviewSubIssue.number),
        },
        skip: false,
        skipReason: "",
      };
    }

    // No sub-issue ready for iteration — orchestrate (will assign one)
    return {
      job: "issue-orchestrate",
      resourceType: "issue",
      resourceNumber: String(issueNum),
      commentId: "",
      contextJson: {
        issue_number: String(issueNum),
        sub_issues: subs.join(","),
        trigger_type: "issue-assigned",
        parent_issue: parentIssueStr,
      },
      skip: false,
      skipReason: "",
    };
  }

  // Check if this is a sub-issue in review with a ready PR — route to review
  // This handles the prReviewAssigned retrigger case where resource_number
  // is the sub-issue (not the parent).
  if (
    isSubIssue(issueState) &&
    issueState.issue.projectStatus === "In review" &&
    issueState.issue.pr &&
    !issueState.issue.pr.isDraft
  ) {
    const pr = issueState.issue.pr;
    core.info(
      `Sub-issue #${issueNum} is in review with PR #${pr.number} — routing to review`,
    );

    return {
      job: "pr-review-requested",
      resourceType: "pr",
      resourceNumber: String(pr.number),
      commentId: "",
      contextJson: {
        pr_number: String(pr.number),
        branch_name: pr.headRef,
        issue_number: String(issueNum),
      },
      skip: false,
      skipReason: "",
    };
  }

  // Check if this is a sub-issue - determine branch from parent and phase
  if (isSubIssue(issueState)) {
    const phaseNumber = extractPhaseNumber(issueTitle(issueState));
    const branchName = deriveBranch(
      parentIssueNumber(issueState),
      phaseNumber || issueNum,
    );

    return {
      job: "issue-iterate",
      resourceType: "issue",
      resourceNumber: String(issueNum),
      commentId: "",
      contextJson: {
        issue_number: String(issueNum),
        branch_name: branchName,
        trigger_type: "issue-assigned",
        parent_issue: parentIssueStr,
        // Note: project_* fields removed - fetched by parseIssue
      },
      skip: false,
      skipReason: "",
    };
  }

  // Regular issue without sub-issues
  const branchName = `claude/issue/${issueNum}`;

  return {
    job: "issue-iterate",
    resourceType: "issue",
    resourceNumber: String(issueNum),
    commentId: "",
    contextJson: {
      issue_number: String(issueNum),
      branch_name: branchName,
      trigger_type: "issue-assigned",
      parent_issue: parentIssueStr,
      // Note: project_* fields removed - fetched by parseIssue
    },
    skip: false,
    skipReason: "",
  };
}

// ============================================================================
// Event Detection (replaces sm-detect-event)
// ============================================================================

/** Map trigger_type override (from release.yml dispatch) to job name */
const TRIGGER_TYPE_TO_JOB: Record<string, Job> = {
  "deployed-stage": "deployed-stage-logging",
  "deployed-prod": "deployed-prod-logging",
  "pr-merged": "merged-logging",
  "merge-queue-failed": "merge-queue-failure-logging",
  "deployed-stage-failed": "deployed-stage-failure-logging",
  "deployed-prod-failed": "deployed-prod-failure-logging",
};

/**
 * Detect the GitHub event and build the unified context_json.
 * Returns the RunnerContext with all routing info embedded.
 * When triggerTypeOverride is set (workflow_dispatch from release.yml), builds context from it without resolving the event.
 */
async function detectEvent(
  token: string,
  resourceNumber: string,
  triggerTypeOverride?: string,
): Promise<RunnerContext> {
  const octokit = github.getOctokit(token);
  const owner = github.context.repo.owner;
  const repo = github.context.repo.repo;

  // Set GH_TOKEN for CLI commands
  process.env.GH_TOKEN = token;

  // When trigger_type is provided (e.g. from release.yml), build context directly
  if (triggerTypeOverride && github.context.eventName === "workflow_dispatch") {
    const issueNumber = resourceNumber || "";
    if (!issueNumber) {
      const ctx: RunnerContext = {
        job: "",
        trigger: TriggerTypeSchema.parse("issue-assigned"),
        resource_type: "issue",
        resource_number: "",
        parent_issue: "0",
        comment_id: "",
        concurrency_group: "",
        cancel_in_progress: false,
        skip: true,
        skip_reason: "trigger_type override requires resource_number",
      };
      return ctx;
    }
    const job = TRIGGER_TYPE_TO_JOB[triggerTypeOverride] ?? "";
    if (!job) {
      const ctx: RunnerContext = {
        job: "",
        trigger: TriggerTypeSchema.parse("issue-assigned"),
        resource_type: "issue",
        resource_number: issueNumber,
        parent_issue: issueNumber,
        comment_id: "",
        concurrency_group: "",
        cancel_in_progress: false,
        skip: true,
        skip_reason: `Unknown trigger_type: ${triggerTypeOverride}`,
      };
      return ctx;
    }
    const trigger = TriggerTypeSchema.parse(triggerTypeOverride);
    const concurrency = computeConcurrency(job, issueNumber, issueNumber, "");
    const serverUrl = process.env.GITHUB_SERVER_URL || "https://github.com";
    const runId = process.env.GITHUB_RUN_ID || "";
    const ciRunUrl = runId
      ? `${serverUrl}/${owner}/${repo}/actions/runs/${runId}`
      : undefined;
    const unifiedContext: RunnerContext = {
      job,
      trigger,
      resource_type: "issue",
      resource_number: issueNumber,
      parent_issue: issueNumber,
      comment_id: "",
      concurrency_group: concurrency.group,
      cancel_in_progress: concurrency.cancelInProgress,
      skip: false,
      skip_reason: "",
      issue_number: issueNumber,
      ci_run_url: ciRunUrl,
    };
    core.info(
      `Trigger override: ${triggerTypeOverride} -> job=${job}, issue #${issueNumber}`,
    );
    return unifiedContext;
  }

  // Step 1: Resolve event → handler + issue number (async, uses GraphQL resolvers)
  const resolved = await resolveEvent(octokit, owner, repo, resourceNumber);
  core.info(
    `Processing event: ${github.context.eventName} (handler=${resolved.handler}, issueNumber=${resolved.issueNumber ?? "none"})`,
  );

  // Step 2: If we have an issue number, call parseIssue once to get all state
  let issueState: IssueStateData | null = null;
  if (resolved.issueNumber) {
    try {
      const { data } = await parseIssue(owner, repo, resolved.issueNumber, {
        octokit,
        fetchPRs: true,
        fetchParent: false, // Handlers use parentIssueNumber from issue data
      });
      issueState = data;
    } catch (error) {
      core.warning(`Failed to parse issue #${resolved.issueNumber}: ${error}`);
      // issueState remains null — handlers must handle this
    }
  }

  let result: DetectionResult;

  // Step 3: Route to handler
  switch (resolved.handler) {
    // ── Discussion events (no issue resolution needed) ──
    case "discussion":
      result = await handleDiscussionEvent(octokit, owner, repo);
      break;
    case "discussion_comment":
      result = await handleDiscussionCommentEvent(octokit, owner, repo);
      break;

    // ── Issue events (guaranteed issue number + non-null issueState) ──
    case "issues":
      if (!resolved.issueNumber || !issueState) {
        result = emptyResult(
          true,
          `No issue number resolved for ${resolved.handler}`,
        );
      } else {
        result = await handleIssueEvent(octokit, owner, repo, issueState);
      }
      break;
    case "issue_comment":
      if (!resolved.issueNumber || !issueState) {
        result = emptyResult(
          true,
          `No issue number resolved for ${resolved.handler}`,
        );
      } else {
        result = await handleIssueCommentEvent(
          octokit,
          owner,
          repo,
          resolved.issueNumber,
          issueState,
        );
      }
      break;
    case "workflow_dispatch":
      if (!resolved.issueNumber || !issueState) {
        result = emptyResult(
          true,
          `No issue number resolved for ${resolved.handler}`,
        );
      } else {
        result = await handleWorkflowDispatchEvent(resourceNumber, issueState);
      }
      break;

    // ── Events with optional issue number ──
    case "push":
      result = await handlePushEvent(issueState);
      break;
    case "pull_request":
      result = await handlePullRequestEvent(resolved.issueNumber);
      break;
    case "pull_request_review":
      result = await handlePullRequestReviewEvent(
        resolved.issueNumber,
        issueState,
      );
      break;
    case "pull_request_review_comment":
      result = await handlePullRequestReviewCommentEvent(issueState);
      break;
    case "workflow_run":
      result = await handleWorkflowRunEvent(issueState, resolved.issueNumber);
      break;
    case "merge_group":
      result = await handleMergeGroupEvent(
        resolved.issueNumber,
        resolved.prNumber,
        issueState,
      );
      break;

    default:
      result = emptyResult(true, `Unhandled event: ${resolved.handler}`);
  }

  // Log result
  if (result.skip) {
    core.info(`Skipping: ${result.skipReason}`);
  } else {
    core.info(`Detected job: ${result.job}`);
    core.info(`Resource: ${result.resourceType} #${result.resourceNumber}`);
  }

  // Extract parent_issue and branch from context for concurrency groups
  const ctx = result.contextJson;
  const ctxParentIssue = String(ctx.parent_issue ?? "0");
  const branch = String(ctx.branch_name ?? "");

  // Compute trigger type from job
  const trigger = jobToTrigger(result.job, JSON.stringify(ctx));
  core.info(`Trigger: ${trigger}`);

  // Compute concurrency group and cancel-in-progress
  const concurrency = computeConcurrency(
    result.job,
    result.resourceNumber,
    ctxParentIssue,
    branch,
  );
  core.info(`Concurrency group: ${concurrency.group}`);
  core.info(`Cancel in progress: ${concurrency.cancelInProgress}`);

  // Build unified context_json with all routing info embedded
  const unifiedContext: RunnerContext = {
    // Routing & control
    job: result.job,
    trigger: TriggerTypeSchema.parse(trigger),
    resource_type: result.resourceType,
    resource_number: result.resourceNumber,
    parent_issue: ctxParentIssue,
    comment_id: result.commentId,
    concurrency_group: concurrency.group,
    cancel_in_progress: concurrency.cancelInProgress,
    skip: result.skip,
    skip_reason: result.skipReason,
    // Spread in all the context-specific fields
    ...ctx,
  };

  return unifiedContext;
}

// ============================================================================
// Routing Helpers (from original sm-router)
// ============================================================================

/**
 * Parse discussion command from comment body
 */
function parseDiscussionCommand(body: string): DiscussionCommand | undefined {
  const trimmed = body.trim();
  if (trimmed === "/summarize") return "summarize";
  if (trimmed === "/plan") return "plan";
  if (trimmed === "/complete") return "complete";
  return undefined;
}

/**
 * Map final state to a human-readable transition name.
 */
function getTransitionName(finalState: string): string {
  const stateNames: Record<string, string> = {
    // Issue states - Triage flow
    triaging: "Triage",

    // Issue states - Reset flow
    resetting: "Reset",

    // Issue states - Comment flow
    commenting: "Comment",

    // Issue states - PR review flows
    prReviewing: "PR Review",
    prResponding: "PR Response",
    prRespondingHuman: "PR Human Response",
    prPush: "PR Push",

    // Issue states - Orchestration flows
    orchestrationRunning: "Orchestrate",
    orchestrationWaiting: "Wait (Review)",
    orchestrationComplete: "Complete Phases",

    // Issue states - Iteration flows
    iterating: "Iterate",
    iteratingFix: "Fix CI",

    // Issue states - Review/transition flows
    reviewing: "In Review",
    transitioningToReview: "Request Review",

    // Issue states - Terminal states
    blocked: "Blocked",
    error: "Error",
    done: "Done",

    // Issue states - Merge queue logging states
    mergeQueueLogging: "Log Queue Entry",
    mergeQueueFailureLogging: "Log Queue Failure",
    mergedLogging: "Log Merged",
    deployedStageLogging: "Log Stage Deploy",
    deployedProdLogging: "Log Prod Deploy",

    // Issue states - Early detection states
    alreadyDone: "Already Done",
    alreadyBlocked: "Already Blocked",

    // Issue states - Grooming flow
    grooming: "Grooming",

    // Discussion states
    detecting: "Detecting",
    researching: "Research",
    responding: "Respond",
    commanding: "Command",
    summarizing: "Summarize",
    planning: "Plan",
    completing: "Complete",
    skipped: "Skipped",
    noContext: "No Context",
  };

  return stateNames[finalState] || finalState;
}

// ============================================================================
// Discussion Machine Runner
// ============================================================================

interface DiscussionMachineOptions {
  mode: string;
  trigger: DiscussionTriggerType;
  ctx: WorkflowContext;
  octokit: ReturnType<typeof github.getOctokit>;
  owner: string;
  repo: string;
  maxRetries: number;
  botUsername: string;
}

async function runDiscussionMachine(
  options: DiscussionMachineOptions,
): Promise<void> {
  const { mode, trigger, ctx, octokit, owner, repo, maxRetries, botUsername } =
    options;

  // Extract discussion-specific fields from context
  const discussionNumber = parseInt(ctx.discussion_number || "0", 10);
  const commentId = ctx.comment_id || undefined;
  const commentBody = ctx.comment_body || undefined;
  const commentAuthor = ctx.comment_author || undefined;

  core.info(`Claude Discussion Machine starting...`);
  core.info(`Mode: ${mode}`);
  core.info(`Discussion: #${discussionNumber}`);
  core.info(`Trigger: ${trigger}`);

  // Get command from context (already parsed by detect-event)
  let command: DiscussionCommand | undefined = ctx.command;
  // Fallback: parse from comment body if not in context
  if (!command && commentBody) {
    command = parseDiscussionCommand(commentBody);
  }

  // Build discussion context
  const context = await buildDiscussionContext(
    octokit,
    owner,
    repo,
    discussionNumber,
    trigger,
    {
      commentId,
      commentBody,
      commentAuthor,
      command,
      maxRetries,
      botUsername,
    },
  );

  if (!context) {
    core.setFailed(
      `Failed to build discussion context for discussion #${discussionNumber}`,
    );
    return;
  }

  core.info(`Discussion context built successfully`);
  core.info(`Discussion title: ${context.discussion.title}`);
  core.info(`Comment count: ${context.discussion.commentCount}`);

  // Context-only mode: return context without running state machine
  if (mode === "context") {
    core.info("Context-only mode - skipping state machine");

    core.startGroup("Context JSON");
    core.info(JSON.stringify(context, null, 2));
    core.endGroup();

    setOutputs({
      actions_json: "[]",
      final_state: "context_only",
      transition_name: "Context Only",
      context_json: JSON.stringify(context),
      action_count: "0",
      discussion_number: String(discussionNumber),
    });
    return;
  }

  // Create and run the discussion state machine
  const actor = createActor(discussionMachine, { input: context });
  actor.start();

  const snapshot = actor.getSnapshot();
  const finalState = String(snapshot.value);
  const pendingActions = snapshot.context.pendingActions;
  const transitionName = getTransitionName(finalState);

  core.info(`Machine final state: ${finalState}`);
  core.info(`Transition: ${transitionName}`);
  core.info(`Derived actions: ${pendingActions.length}`);

  if (pendingActions.length > 0) {
    const actionTypes = pendingActions.map((a) => a.type);
    core.info(`Action types: ${actionTypes.join(", ")}`);
  }

  setOutputs({
    actions_json: JSON.stringify(pendingActions),
    final_state: finalState,
    transition_name: transitionName,
    context_json: JSON.stringify(context),
    action_count: String(pendingActions.length),
    discussion_number: String(discussionNumber),
  });

  actor.stop();
}

// ============================================================================
// Issue Machine Runner
// ============================================================================

interface IssueMachineOptions {
  mode: string;
  trigger: TriggerType;
  ctx: WorkflowContext;
  octokit: ReturnType<typeof github.getOctokit>;
  owner: string;
  repo: string;
  projectNumber: number;
  maxRetries: number;
  botUsername: string;
}

async function runIssueMachine(options: IssueMachineOptions): Promise<void> {
  const {
    mode,
    trigger,
    ctx,
    octokit,
    owner,
    repo,
    projectNumber,
    maxRetries,
    botUsername,
  } = options;

  // Extract issue-specific fields from context
  const issueNumber = parseInt(ctx.issue_number || "0", 10);
  const ciResult = ctx.ci_result || null;
  const ciRunUrl = ctx.ci_run_url || null;
  const ciCommitSha = ctx.ci_commit_sha || null;
  const reviewDecision = ctx.review_decision || null;
  const reviewer = ctx.reviewer || ctx.reviewer_login || null;
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- context_type is a known string enum from the detect-event action
  const commentContextType = (ctx.context_type?.toLowerCase() || null) as
    | "issue"
    | "pr"
    | null;
  const commentContextDescription = ctx.context_description || null;
  const inputBranch = ctx.branch_name || null;
  const workflowStartedAt = new Date().toISOString();

  // Build workflow run URL from environment variables
  const serverUrl = process.env.GITHUB_SERVER_URL || "https://github.com";
  const repository = process.env.GITHUB_REPOSITORY || `${owner}/${repo}`;
  const runId = process.env.GITHUB_RUN_ID;
  const workflowRunUrl = runId
    ? `${serverUrl}/${repository}/actions/runs/${runId}`
    : null;

  core.info(`Claude Issue State Machine starting...`);
  core.info(`Mode: ${mode}`);
  core.info(`Issue: #${issueNumber}`);
  core.info(`Project: ${projectNumber}`);
  core.info(`Trigger: ${trigger}`);

  // Map trigger types to their underlying GitHub event types
  // Some triggers (like issue-reset, issue-triage) are derived from other events
  const triggerToEventType: Record<string, string> = {
    "issue-assigned": "issue_assigned",
    "issue-edited": "issue_edited",
    "issue-closed": "issue_closed",
    "issue-triage": "issue_assigned",
    "issue-orchestrate": "issue_assigned",
    "issue-comment": "issue_comment",
    "issue-reset": "issue_comment",
    "pr-review-requested": "pr_review_requested",
    "pr-review-submitted": "pr_review_submitted",
    "pr-review": "pr_review_submitted",
    "pr-review-approved": "pr_review_submitted",
    "pr-response": "pr_review_submitted",
    "pr-human-response": "pr_review_submitted",
    "pr-push": "pr_push",
    "workflow-run-completed": "workflow_run_completed",
    "merge-queue-entered": "merge_queue_entered",
    "merge-queue-failed": "merge_queue_failed",
    "pr-merged": "pr_merged",
    "deployed-stage": "deployed_stage",
    "deployed-prod": "deployed_prod",
  };

  const eventType = triggerToEventType[trigger] || trigger;

  // Build a GitHubEvent object for the state machine
  const event = {
    type: eventType,
    owner,
    repo,
    issueNumber,
    timestamp: workflowStartedAt,
    // Add CI-specific fields for workflow-run-completed triggers
    ...(ciResult && { result: ciResult }),
    ...(ciRunUrl && { runUrl: ciRunUrl }),
    ...(ciCommitSha && { headSha: ciCommitSha }),
    // Add review-specific fields for pr-review-submitted triggers
    ...(reviewDecision && { decision: reviewDecision }),
    ...(reviewer && { reviewer }),
  };

  // Build machine context
  const context = await buildMachineContext(
    octokit,
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- event object built above matches buildMachineContext parameter type
    event as Parameters<typeof buildMachineContext>[1],
    projectNumber,
    {
      maxRetries,
      botUsername,
      commentContextType,
      commentContextDescription,
      branch: inputBranch,
      triggerOverride: trigger,
      ciRunUrl,
      workflowStartedAt,
      workflowRunUrl,
    },
  );

  if (!context) {
    core.setFailed(`Failed to build machine context for issue #${issueNumber}`);
    return;
  }

  core.info(`Context built successfully`);
  core.info(`Issue status: ${context.issue.projectStatus}`);
  core.info(
    `Sub-issues: ${context.issue.hasSubIssues ? context.issue.subIssues.length : 0}`,
  );
  core.info(`Current phase: ${context.currentPhase || "N/A"}`);
  core.info(`Iteration: ${context.issue.iteration}`);

  // Extract commonly needed context values
  const iteration = String(context.issue.iteration ?? 0);
  const phase =
    context.currentPhase !== null ? String(context.currentPhase) : "-";
  const parentIssueNum = String(
    context.parentIssue?.number || context.issue.number,
  );
  const subIssueNum = context.currentSubIssue?.number
    ? String(context.currentSubIssue.number)
    : "";

  // Format agent notes for prompt injection
  const agentNotesEntries = agentNotesExtractor({
    owner,
    repo,
    issue: context.issue,
    parentIssue: context.parentIssue ?? null,
  });
  const agentNotes = formatAgentNotesForPrompt(agentNotesEntries);

  // Context-only mode: return context without running state machine
  if (mode === "context") {
    core.info("Context-only mode - skipping state machine");

    core.startGroup("Context JSON");
    core.info(JSON.stringify(context, null, 2));
    core.endGroup();

    setOutputs({
      actions_json: "[]",
      final_state: "context_only",
      transition_name: "Context Only",
      context_json: JSON.stringify(context),
      action_count: "0",
      iteration,
      phase,
      parent_issue_number: parentIssueNum,
      pr_number: context.pr?.number ? String(context.pr.number) : "",
      commit_sha: context.ciCommitSha || "",
      sub_issue_number: subIssueNum,
      agent_notes: agentNotes,
    });
    return;
  }

  // Create and run the state machine
  // Send DETECT event to trigger ONE state transition (event-based, not `always`)
  const actor = createActor(claudeMachine, { input: context });
  actor.start();
  actor.send({ type: "DETECT" });

  const snapshot = actor.getSnapshot();
  const finalState = String(snapshot.value);
  const pendingActions = snapshot.context.pendingActions;
  const transitionName = getTransitionName(finalState);

  core.info(`Machine final state: ${finalState}`);
  core.info(`Transition: ${transitionName}`);
  core.info(`Derived actions: ${pendingActions.length}`);

  if (pendingActions.length > 0) {
    const actionTypes = pendingActions.map((a) => a.type);
    core.info(`Action types: ${actionTypes.join(", ")}`);
  }

  // Extract PR and commit info for history linking
  const prNumber = context.pr?.number ? String(context.pr.number) : "";
  const commitSha = context.ciCommitSha || "";

  setOutputs({
    actions_json: JSON.stringify(pendingActions),
    final_state: finalState,
    transition_name: transitionName,
    context_json: JSON.stringify(context),
    action_count: String(pendingActions.length),
    iteration,
    phase,
    parent_issue_number: parentIssueNum,
    pr_number: prNumber,
    commit_sha: commitSha,
    sub_issue_number: subIssueNum,
    agent_notes: agentNotes,
  });

  actor.stop();
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function _run(overrideMode?: string): Promise<void> {
  try {
    const mode = overrideMode ?? getOptionalInput("mode") ?? "derive";
    const token = getRequiredInput("github_token");
    const resourceNumber = getOptionalInput("resource_number") || "";
    const contextJsonInput = getOptionalInput("context_json") || "";

    // ======================================================================
    // MODE: "detect" - Event detection only (replaces sm-detect-event)
    // ======================================================================
    if (mode === "detect") {
      const unifiedContext = await detectEvent(token, resourceNumber);

      setOutputs({
        context_json: JSON.stringify(unifiedContext),
        contexts_json: JSON.stringify([unifiedContext]),
        context_count: "1",
        primary_context_json: JSON.stringify(unifiedContext),
        skip: String(unifiedContext.skip),
        skip_reason: unifiedContext.skip_reason,
        concurrency_group: unifiedContext.concurrency_group,
        cancel_in_progress: String(unifiedContext.cancel_in_progress),
      });
      return;
    }

    // ======================================================================
    // MODE: "derive" or "context" - State machine routing
    // ======================================================================

    // If context_json not provided, run detection first
    let ctx: WorkflowContext;
    if (contextJsonInput) {
      ctx = parseWorkflowContext(contextJsonInput);
    } else {
      // Auto-detect from GitHub event context
      core.info("No context_json provided, running event detection...");
      const detected = await detectEvent(token, resourceNumber);

      if (detected.skip) {
        core.info(`Skipping: ${detected.skip_reason}`);
        setOutputs({
          context_json: JSON.stringify(detected),
          skip: "true",
          skip_reason: detected.skip_reason,
          actions_json: "[]",
          final_state: "skipped",
          transition_name: "Skipped",
          action_count: "0",
        });
        return;
      }

      ctx = parseWorkflowContext(JSON.stringify(detected));
    }

    // Parse remaining inputs
    const projectNumber = parseInt(
      getOptionalInput("project_number") || "1",
      10,
    );
    const maxRetries = parseInt(getOptionalInput("max_retries") || "5", 10);
    const botUsername = getOptionalInput("bot_username") || "nopo-bot";

    // Get trigger from context (already validated by schema)
    const trigger = ctx.trigger;

    core.info(`Router received context with trigger: ${trigger}`);
    core.info(
      `Job: ${ctx.job}, Resource: ${ctx.resource_type} #${ctx.resource_number}`,
    );

    // Create octokit
    const octokit = github.getOctokit(token);
    const { owner, repo } = github.context.repo;

    // ====================================================================
    // ROUTE: Discussion Triggers
    // ====================================================================
    if (checkDiscussionTrigger(trigger)) {
      await runDiscussionMachine({
        mode,
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- checkDiscussionTrigger guard confirms this is a DiscussionTriggerType
        trigger: trigger as DiscussionTriggerType,
        ctx,
        octokit,
        owner,
        repo,
        maxRetries,
        botUsername,
      });
      return;
    }

    // ====================================================================
    // ROUTE: Issue/PR Triggers
    // ====================================================================
    await runIssueMachine({
      mode,
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- trigger confirmed as non-discussion type, safe to cast to TriggerType
      trigger: trigger as TriggerType,
      ctx,
      octokit,
      owner,
      repo,
      projectNumber,
      maxRetries,
      botUsername,
    });
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed("An unexpected error occurred");
    }
  }
}

export { detectEvent };
