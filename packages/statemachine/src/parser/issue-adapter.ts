/**
 * Issue Adapter
 *
 * Bridges @more/issue-state's parseIssue() with the statemachine's MachineContext.
 * This adapter transforms the ORM-style IssueStateData into the state machine's
 * context format, parsing todos, history, and agent notes from the body.
 */

import {
  parseIssue,
  serializeMarkdown,
  type IssueData,
  type SubIssueData,
  type OctokitLike,
  type CIStatus,
} from "@more/issue-state";
import type {
  MachineContext,
  ParentIssue,
  SubIssue,
  TriggerType,
  CIResult,
  ReviewDecision,
  LinkedPR,
} from "../schemas/index.js";
import { createMachineContext } from "../schemas/index.js";
import { parseTodoStats } from "./todo-parser.js";
import { parseHistory } from "./history-parser.js";
import { parseAgentNotes } from "./agent-notes-parser.js";

// ============================================================================
// Types
// ============================================================================

export interface BuildContextOptions {
  /** GitHub octokit instance */
  octokit: OctokitLike;
  /** GitHub Project number for project fields */
  projectNumber?: number;
  /** Bot username for identifying bot comments */
  botUsername?: string;
  /** Trigger type - required for machine context */
  trigger: TriggerType;
  /** Override branch name (e.g., from CI completion event) */
  branch?: string | null;
  /** CI result (if triggered by workflow_run) */
  ciResult?: CIResult | null;
  /** CI run URL */
  ciRunUrl?: string | null;
  /** CI commit SHA */
  ciCommitSha?: string | null;
  /** ISO 8601 timestamp of when the workflow started */
  workflowStartedAt?: string | null;
  /** URL to the current workflow run */
  workflowRunUrl?: string | null;
  /** Review decision (if triggered by pr_review_submitted) */
  reviewDecision?: ReviewDecision | null;
  /** Reviewer ID */
  reviewerId?: string | null;
  /** Comment context type */
  commentContextType?: "issue" | "pr" | null;
  /** Comment context description */
  commentContextDescription?: string | null;
  /** Pivot description */
  pivotDescription?: string | null;
  /** Max retries for circuit breaker */
  maxRetries?: number;
  /** Fetch PRs for sub-issues */
  fetchPRs?: boolean;
  /** Fetch parent issue if this is a sub-issue */
  fetchParent?: boolean;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Convert IssueData from @more/issue-state to ParentIssue for statemachine
 */
function issueDataToParentIssue(issueData: IssueData): ParentIssue {
  const body = serializeMarkdown(issueData.bodyAst);

  return {
    number: issueData.number,
    title: issueData.title,
    state: issueData.state,
    body,
    projectStatus: issueData.projectStatus,
    iteration: issueData.iteration,
    failures: issueData.failures,
    assignees: issueData.assignees,
    labels: issueData.labels,
    subIssues: issueData.subIssues.map(subIssueDataToSubIssue),
    hasSubIssues: issueData.hasSubIssues,
    history: parseHistory(body),
    todos: parseTodoStats(body),
    agentNotes: parseAgentNotes(body),
    comments: issueData.comments,
  };
}

/**
 * Convert SubIssueData from @more/issue-state to SubIssue for statemachine
 */
function subIssueDataToSubIssue(subIssueData: SubIssueData): SubIssue {
  const body = serializeMarkdown(subIssueData.bodyAst);

  return {
    number: subIssueData.number,
    title: subIssueData.title,
    state: subIssueData.state,
    body,
    projectStatus: subIssueData.projectStatus,
    branch: subIssueData.branch,
    pr: subIssueData.pr,
    todos: parseTodoStats(body),
  };
}

/**
 * Find current phase from sub-issues
 */
function findCurrentPhase(
  subIssues: SubIssue[],
): { phase: number; subIssue: SubIssue } | null {
  for (let i = 0; i < subIssues.length; i++) {
    const subIssue = subIssues[i];
    if (!subIssue) continue;
    if (subIssue.projectStatus !== "Done" && subIssue.state === "OPEN") {
      return { phase: i + 1, subIssue };
    }
  }
  return null;
}

/**
 * Derive branch name from issue number and phase
 */
export function deriveBranchName(
  parentIssueNumber: number,
  phaseNumber?: number,
): string {
  if (phaseNumber !== undefined && phaseNumber > 0) {
    return `claude/issue/${parentIssueNumber}/phase-${phaseNumber}`;
  }
  return `claude/issue/${parentIssueNumber}`;
}

/**
 * Derive CI result from PR's statusCheckRollup
 */
function deriveCIResultFromPR(
  ciStatus: CIStatus | null | undefined,
): CIResult | null {
  if (!ciStatus) return null;
  switch (ciStatus) {
    case "SUCCESS":
      return "success";
    case "FAILURE":
    case "ERROR":
      return "failure";
    default:
      // PENDING or EXPECTED means checks are still running
      return null;
  }
}

// ============================================================================
// Main
// ============================================================================

/**
 * Build MachineContext from a GitHub issue using @more/issue-state
 *
 * This is the main adapter function that bridges the ORM-style issue parsing
 * with the state machine context format.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param issueNumber - Issue number to parse
 * @param options - Build options including trigger type and optional overrides
 * @returns MachineContext ready for the state machine
 *
 * @example
 * ```typescript
 * const context = await buildMachineContextFromIssue(
 *   "owner",
 *   "repo",
 *   123,
 *   {
 *     octokit,
 *     projectNumber: 1,
 *     trigger: "issue-edited",
 *   }
 * );
 * ```
 */
export async function buildMachineContextFromIssue(
  owner: string,
  repo: string,
  issueNumber: number,
  options: BuildContextOptions,
): Promise<MachineContext | null> {
  const {
    octokit,
    projectNumber = 0,
    botUsername = "nopo-bot",
    trigger,
    fetchPRs = true,
    fetchParent = true,
  } = options;

  // Parse issue using @more/issue-state
  let issueResult;
  try {
    issueResult = await parseIssue(owner, repo, issueNumber, {
      octokit,
      projectNumber,
      botUsername,
      fetchPRs,
      fetchParent,
    });
  } catch {
    return null;
  }

  const { data } = issueResult;

  // Transform to statemachine format
  const issue = issueDataToParentIssue(data.issue);
  const parentIssue = data.parentIssue
    ? issueDataToParentIssue(data.parentIssue)
    : null;

  // Find current phase
  const currentPhaseInfo = findCurrentPhase(issue.subIssues);
  const currentPhase = currentPhaseInfo?.phase ?? null;
  const currentSubIssue = currentPhaseInfo?.subIssue ?? null;

  // Determine branch - use provided branch if available
  const derivedBranch = currentPhase
    ? deriveBranchName(issueNumber, currentPhase)
    : deriveBranchName(issueNumber);
  const branch = options.branch || derivedBranch;

  // Get PR info - either from current sub-issue or from the issue itself
  let pr: LinkedPR | null = null;
  let hasBranch = false;
  let hasPR = false;

  if (currentSubIssue?.pr) {
    pr = currentSubIssue.pr;
    hasBranch = true;
    hasPR = true;
  } else if (data.issue.pr) {
    pr = data.issue.pr;
    hasBranch = true;
    hasPR = true;
  }

  // Derive CI result from PR if not explicitly provided
  let ciResult = options.ciResult ?? null;
  if (!ciResult && pr?.ciStatus) {
    ciResult = deriveCIResultFromPR(pr.ciStatus);
  }

  return createMachineContext({
    trigger,
    owner,
    repo,
    issue,
    parentIssue,
    currentPhase,
    totalPhases: issue.subIssues.length || 1,
    currentSubIssue,
    ciResult,
    ciRunUrl: options.ciRunUrl ?? null,
    ciCommitSha: options.ciCommitSha ?? null,
    workflowStartedAt: options.workflowStartedAt ?? null,
    workflowRunUrl: options.workflowRunUrl ?? null,
    reviewDecision: options.reviewDecision ?? null,
    reviewerId: options.reviewerId ?? null,
    branch,
    hasBranch,
    pr,
    hasPR,
    commentContextType: options.commentContextType ?? null,
    commentContextDescription: options.commentContextDescription ?? null,
    pivotDescription: options.pivotDescription ?? null,
    maxRetries: options.maxRetries,
    botUsername,
  });
}
