import type { GitHub } from "@actions/github/lib/utils.js";
import {
  GET_PR_FOR_BRANCH_QUERY,
  CHECK_BRANCH_EXISTS_QUERY,
  GET_DISCUSSION_QUERY,
  GET_ISSUE_WITH_PROJECT_QUERY,
  parseMarkdown,
  type ProjectItemNode,
  type SubIssueNode,
  type IssueCommentNode,
  type IssueResponse,
} from "@more/issue-state";
import type { IssueState as IssueStateValue } from "@more/issue-state";
import type {
  MachineContext,
  ParentIssue,
  SubIssue,
  ProjectStatus,
  PRState,
  LinkedPR,
  TriggerType,
  GitHubEvent,
  DiscussionContext,
  CIStatus,
  IssueComment,
} from "../schemas/index.js";
import {
  createMachineContext,
  eventToTrigger,
  createDiscussionContext,
  CIStatusSchema,
} from "../schemas/index.js";
import type { DiscussionTriggerType } from "../schemas/discussion-triggers.js";

type Octokit = InstanceType<typeof GitHub>;

// ============================================================================
// Response Type Definitions (for PR/Branch queries only)
// ============================================================================

interface PRResponse {
  repository?: {
    pullRequests?: {
      nodes?: Array<{
        number?: number;
        title?: string;
        state?: string;
        isDraft?: boolean;
        headRefName?: string;
        baseRefName?: string;
        commits?: {
          nodes?: Array<{
            commit?: {
              statusCheckRollup?: {
                state?: string; // SUCCESS, FAILURE, PENDING, ERROR, EXPECTED
              };
            };
          }>;
        };
      }>;
    };
  };
}

interface BranchResponse {
  repository?: {
    ref?: { name?: string } | null;
  };
}

// ============================================================================
// Parser Functions
// ============================================================================

/**
 * Parse project state from GraphQL response
 */
function parseProjectState(
  projectItems: ProjectItemNode[],
  projectNumber: number,
): { status: ProjectStatus | null; iteration: number; failures: number } {
  const projectItem = projectItems.find(
    (item) => item.project?.number === projectNumber,
  );

  if (!projectItem) {
    return { status: null, iteration: 0, failures: 0 };
  }

  let status: ProjectStatus | null = null;
  let iteration = 0;
  let failures = 0;

  const fieldValues = projectItem.fieldValues?.nodes || [];
  for (const fieldValue of fieldValues) {
    const fieldName = fieldValue.field?.name;
    if (fieldName === "Status" && fieldValue.name) {
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- GitHub project field value matches ProjectStatus union
      status = fieldValue.name as ProjectStatus;
    } else if (
      fieldName === "Iteration" &&
      typeof fieldValue.number === "number"
    ) {
      iteration = fieldValue.number;
    } else if (
      fieldName === "Failures" &&
      typeof fieldValue.number === "number"
    ) {
      failures = fieldValue.number;
    }
  }

  return { status, iteration, failures };
}

/**
 * Parse sub-issue status from project items
 */
function parseSubIssueStatus(
  projectItems: ProjectItemNode[],
  projectNumber: number,
): ProjectStatus | null {
  const projectItem = projectItems.find(
    (item) => item.project?.number === projectNumber,
  );

  if (!projectItem?.fieldValues?.nodes) {
    return null;
  }

  for (const fieldValue of projectItem.fieldValues.nodes) {
    if (fieldValue.field?.name === "Status" && fieldValue.name) {
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- GitHub project field value matches ProjectStatus union
      return fieldValue.name as ProjectStatus;
    }
  }

  return null;
}

/**
 * Derive branch name from issue number and phase
 * Note: This is a local copy - the canonical version is in issue-adapter.ts
 */
function deriveBranchName(
  parentIssueNumber: number,
  phaseNumber?: number,
): string {
  if (phaseNumber !== undefined && phaseNumber > 0) {
    return `claude/issue/${parentIssueNumber}/phase-${phaseNumber}`;
  }
  return `claude/issue/${parentIssueNumber}`;
}

/**
 * Parse a sub-issue into our schema format
 */
function parseSubIssue(
  node: SubIssueNode,
  projectNumber: number,
  phaseNumber: number,
  parentIssueNumber: number,
): SubIssue {
  const status = parseSubIssueStatus(
    node.projectItems?.nodes || [],
    projectNumber,
  );
  const body = node.body || "";
  const bodyAst = parseMarkdown(body);

  return {
    number: node.number || 0,
    title: node.title || "",
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- GitHub API returns lowercase state, .toUpperCase() produces valid IssueStateValue
    state: (node.state?.toUpperCase() || "OPEN") as IssueStateValue,
    bodyAst,
    projectStatus: status,
    branch: deriveBranchName(parentIssueNumber, phaseNumber),
    pr: null, // Will be populated separately
  };
}

/**
 * Check if a branch exists
 */
async function checkBranchExists(
  octokit: Octokit,
  owner: string,
  repo: string,
  branchName: string,
): Promise<boolean> {
  try {
    const response = await octokit.graphql<BranchResponse>(
      CHECK_BRANCH_EXISTS_QUERY,
      {
        owner,
        repo,
        branchName: `refs/heads/${branchName}`,
      },
    );
    return response.repository?.ref !== null;
  } catch {
    return false;
  }
}

/**
 * Get PR for a branch
 */
async function getPRForBranch(
  octokit: Octokit,
  owner: string,
  repo: string,
  headRef: string,
): Promise<LinkedPR | null> {
  try {
    const response = await octokit.graphql<PRResponse>(
      GET_PR_FOR_BRANCH_QUERY,
      {
        owner,
        repo,
        headRef,
      },
    );

    const pr = response.repository?.pullRequests?.nodes?.[0];
    if (!pr || !pr.number) {
      return null;
    }

    // Extract CI status from the last commit's statusCheckRollup
    const rawCiStatus =
      pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? null;

    // Validate and parse the CI status
    let ciStatus: CIStatus | null = null;
    if (rawCiStatus) {
      const parsed = CIStatusSchema.safeParse(rawCiStatus);
      if (parsed.success) {
        ciStatus = parsed.data;
      }
    }

    return {
      number: pr.number,
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- GitHub API returns lowercase state, .toUpperCase() produces valid PRState
      state: (pr.state?.toUpperCase() || "OPEN") as PRState,
      isDraft: pr.isDraft || false,
      title: pr.title || "",
      headRef: pr.headRefName || headRef,
      baseRef: pr.baseRefName || "main",
      ciStatus,
    };
  } catch {
    return null;
  }
}

/**
 * Result from fetching issue state, includes parent issue number if this is a sub-issue
 */
interface FetchIssueResult {
  issue: ParentIssue;
  parentIssueNumber: number | null;
}

/**
 * Parse issue comments from GraphQL response
 */
function parseIssueComments(
  commentNodes: IssueCommentNode[],
  botUsername: string,
): IssueComment[] {
  return commentNodes.map((c) => {
    const author = c.author?.login ?? "unknown";
    return {
      id: c.id ?? "",
      author,
      body: c.body ?? "",
      createdAt: c.createdAt ?? "",
      isBot: author.includes("[bot]") || author === botUsername,
    };
  });
}

/**
 * Fetch full issue state from GitHub
 */
async function fetchIssueState(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  projectNumber: number,
  botUsername: string = "nopo-bot",
): Promise<FetchIssueResult | null> {
  const response = await octokit.graphql<IssueResponse>(
    GET_ISSUE_WITH_PROJECT_QUERY,
    {
      owner,
      repo,
      issueNumber,
    },
  );

  const issue = response.repository?.issue;
  if (!issue) {
    return null;
  }

  const projectItems = issue.projectItems?.nodes || [];
  const { status, iteration, failures } = parseProjectState(
    projectItems,
    projectNumber,
  );

  const subIssueNodes = issue.subIssues?.nodes || [];
  const subIssues: SubIssue[] = [];

  // Sort sub-issues by number to maintain phase order
  const sortedSubIssues = [...subIssueNodes].sort(
    (a, b) => (a.number || 0) - (b.number || 0),
  );

  for (let i = 0; i < sortedSubIssues.length; i++) {
    const node = sortedSubIssues[i];
    if (!node) continue;
    subIssues.push(parseSubIssue(node, projectNumber, i + 1, issueNumber));
  }

  const body = issue.body || "";
  const bodyAst = parseMarkdown(body);
  const comments = parseIssueComments(issue.comments?.nodes || [], botUsername);

  // Check if this issue is a sub-issue (has a parent)
  const parentIssueNumber = issue.parent?.number ?? null;

  return {
    issue: {
      number: issue.number || issueNumber,
      title: issue.title || "",
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- GitHub API returns lowercase state, .toUpperCase() produces valid IssueStateValue
      state: (issue.state?.toUpperCase() || "OPEN") as IssueStateValue,
      bodyAst,
      projectStatus: status,
      iteration,
      failures,
      assignees:
        issue.assignees?.nodes?.map((a) => a.login || "").filter(Boolean) || [],
      labels:
        issue.labels?.nodes?.map((l) => l.name || "").filter(Boolean) || [],
      subIssues,
      hasSubIssues: subIssues.length > 0,
      comments,
      branch: null, // Will be populated separately
      pr: null, // Will be populated separately
      parentIssueNumber,
    },
    parentIssueNumber,
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
 * Enrich sub-issues with PR information
 */
async function enrichSubIssuesWithPRs(
  octokit: Octokit,
  owner: string,
  repo: string,
  parentIssueNumber: number,
  subIssues: SubIssue[],
): Promise<SubIssue[]> {
  const enriched: SubIssue[] = [];

  for (let i = 0; i < subIssues.length; i++) {
    const subIssue = subIssues[i];
    if (!subIssue) continue;

    const branchName = deriveBranchName(parentIssueNumber, i + 1);
    const pr = await getPRForBranch(octokit, owner, repo, branchName);

    enriched.push({
      ...subIssue,
      branch: branchName,
      pr,
    });
  }

  return enriched;
}

/**
 * Build full machine context from an event and fetched state
 */
export async function buildMachineContext(
  octokit: Octokit,
  event: GitHubEvent,
  projectNumber: number,
  options: {
    maxRetries?: number;
    botUsername?: string;
    commentContextType?: "issue" | "pr" | null;
    commentContextDescription?: string | null;
    branch?: string | null;
    // Override trigger - use this instead of deriving from event
    // This is needed because some triggers (issue_triage, issue_orchestrate)
    // use a different event type internally but need to preserve their trigger
    triggerOverride?: TriggerType | null;
    // CI run URL - can be passed through for workflow_dispatch triggers
    ciRunUrl?: string | null;
    // ISO 8601 timestamp of when the workflow started
    workflowStartedAt?: string | null;
    // URL to the current workflow run
    workflowRunUrl?: string | null;
  } = {},
): Promise<MachineContext | null> {
  const { owner, repo } = event;
  // Use trigger override if provided, otherwise derive from event
  const trigger = options.triggerOverride ?? eventToTrigger(event);

  // Determine the issue number from the event
  let issueNumber: number | undefined;
  if ("issueNumber" in event) {
    issueNumber = event.issueNumber;
  } else if ("prNumber" in event && event.issueNumber) {
    issueNumber = event.issueNumber;
  }

  if (!issueNumber) {
    return null;
  }

  const botUsername = options.botUsername ?? "nopo-bot";

  // Fetch the main issue
  const issueResult = await fetchIssueState(
    octokit,
    owner,
    repo,
    issueNumber,
    projectNumber,
    botUsername,
  );

  if (!issueResult) {
    return null;
  }

  const { issue, parentIssueNumber } = issueResult;

  // If this issue has a parent (it's a sub-issue), fetch the parent issue too
  let parentIssue: ParentIssue | null = null;
  if (parentIssueNumber) {
    const parentResult = await fetchIssueState(
      octokit,
      owner,
      repo,
      parentIssueNumber,
      projectNumber,
      botUsername,
    );
    if (parentResult) {
      parentIssue = parentResult.issue;
    }
  }

  // Enrich sub-issues with PR information
  if (issue.hasSubIssues) {
    issue.subIssues = await enrichSubIssuesWithPRs(
      octokit,
      owner,
      repo,
      issueNumber,
      issue.subIssues,
    );
  }

  // Find current phase
  const currentPhaseInfo = findCurrentPhase(issue.subIssues);
  const currentPhase = currentPhaseInfo?.phase ?? null;
  const currentSubIssue = currentPhaseInfo?.subIssue ?? null;

  // Determine branch - use provided branch if available (e.g., from CI completion event)
  // Otherwise derive from issue number and phase
  const derivedBranch = currentPhase
    ? deriveBranchName(issueNumber, currentPhase)
    : deriveBranchName(issueNumber);
  const branch = options.branch || derivedBranch;

  const hasBranch = await checkBranchExists(octokit, owner, repo, branch);

  // Get PR for current branch
  const pr = hasBranch
    ? await getPRForBranch(octokit, owner, repo, branch)
    : null;

  // Extract CI result if this is a workflow run event
  // Also accept ciRunUrl from options (for workflow_dispatch triggers)
  let ciResult: "success" | "failure" | "cancelled" | "skipped" | null = null;
  let ciRunUrl = options.ciRunUrl ?? null;
  let ciCommitSha: string | null = null;
  if (event.type === "workflow_run_completed") {
    ciResult = event.result;
    ciRunUrl = event.runUrl;
    ciCommitSha = event.headSha;
  } else if (pr?.ciStatus) {
    // Derive CI result from PR's statusCheckRollup when not triggered by CI completion
    // This allows the state machine to know CI status from any trigger type
    switch (pr.ciStatus) {
      case "SUCCESS":
        ciResult = "success";
        break;
      case "FAILURE":
      case "ERROR":
        ciResult = "failure";
        break;
      // PENDING or EXPECTED means checks are still running or haven't started
      // Leave ciResult as null in these cases
    }
  }

  // Extract review decision if this is a review event
  let reviewDecision = null;
  let reviewerId = null;
  if (event.type === "pr_review_submitted") {
    reviewDecision = event.decision;
    reviewerId = event.reviewer;
  }

  // Extract release/merge queue event data
  let releaseEvent = null;
  if (event.type === "merge_queue_entered") {
    releaseEvent = { type: "queue_entry" as const };
  } else if (event.type === "merge_queue_failed") {
    releaseEvent = {
      type: "queue_failure" as const,
      failureReason: event.failureReason,
    };
  } else if (event.type === "pr_merged") {
    releaseEvent = {
      type: "merged" as const,
      commitSha: event.commitSha,
    };
    ciCommitSha = event.commitSha;
  } else if (event.type === "deployed_stage") {
    releaseEvent = {
      type: "deployed" as const,
      commitSha: event.commitSha,
    };
    ciCommitSha = event.commitSha;
  } else if (event.type === "deployed_prod") {
    releaseEvent = {
      type: "deployed" as const,
      commitSha: event.commitSha,
    };
    ciCommitSha = event.commitSha;
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
    ciRunUrl,
    ciCommitSha,
    workflowStartedAt: options.workflowStartedAt ?? null,
    workflowRunUrl: options.workflowRunUrl ?? null,
    reviewDecision,
    reviewerId,
    branch,
    hasBranch,
    pr,
    hasPR: pr !== null,
    commentContextType: options.commentContextType ?? null,
    commentContextDescription: options.commentContextDescription ?? null,
    releaseEvent,
    maxRetries: options.maxRetries,
    botUsername: options.botUsername,
  });
}

// ============================================================================
// Discussion Context Builder
// ============================================================================

interface DiscussionResponse {
  repository?: {
    discussion?: {
      id?: string;
      number?: number;
      title?: string;
      body?: string;
      comments?: {
        totalCount?: number;
        nodes?: Array<{
          id?: string;
          body?: string;
          author?: { login?: string };
          replies?: { totalCount?: number };
        }>;
      };
    };
  };
}

/**
 * Options for building discussion context
 */
interface BuildDiscussionContextOptions {
  /** Comment ID (node_id) that triggered this event */
  commentId?: string;
  /** Comment body */
  commentBody?: string;
  /** Comment author */
  commentAuthor?: string;
  /** Slash command if this is a command trigger */
  command?: "summarize" | "plan" | "complete";
  /** Max retries for circuit breaker */
  maxRetries?: number;
  /** Bot username */
  botUsername?: string;
}

/**
 * Build discussion context from API data
 *
 * Fetches the discussion and builds a DiscussionContext for the discussion
 * state machine to process.
 */
export async function buildDiscussionContext(
  octokit: Octokit,
  owner: string,
  repo: string,
  discussionNumber: number,
  trigger: DiscussionTriggerType,
  options: BuildDiscussionContextOptions = {},
): Promise<DiscussionContext | null> {
  // Fetch discussion from API
  const response = await octokit.graphql<DiscussionResponse>(
    GET_DISCUSSION_QUERY,
    {
      owner,
      repo,
      number: discussionNumber,
    },
  );

  const discussion = response.repository?.discussion;
  if (!discussion || !discussion.id || !discussion.number) {
    return null;
  }

  // Build research threads from existing bot comments
  const researchThreads: Array<{
    nodeId: string;
    topic: string;
    replyCount: number;
  }> = [];

  const comments = discussion.comments?.nodes ?? [];
  for (const comment of comments) {
    // Research threads are top-level bot comments with "## Research:" header
    if (
      comment?.author?.login === "nopo-bot" ||
      comment?.author?.login === "claude[bot]"
    ) {
      if (comment.body?.includes("## ")) {
        // Extract topic from header
        const topicMatch = comment.body.match(/## ([^\n]+)/);
        const topic = topicMatch?.[1];
        if (topic && comment.id) {
          researchThreads.push({
            nodeId: comment.id,
            topic,
            replyCount: comment.replies?.totalCount ?? 0,
          });
        }
      }
    }
  }

  return createDiscussionContext({
    trigger,
    owner,
    repo,
    discussion: {
      number: discussion.number,
      nodeId: discussion.id,
      title: discussion.title ?? "",
      body: discussion.body ?? "",
      commentCount: discussion.comments?.totalCount ?? 0,
      researchThreads,
      command: options.command,
      commentId: options.commentId,
      commentBody: options.commentBody,
      commentAuthor: options.commentAuthor,
    },
    maxRetries: options.maxRetries,
    botUsername: options.botUsername,
  });
}
