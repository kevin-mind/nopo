import * as core from "@actions/core";
import * as github from "@actions/github";
import {
  // Action utilities
  execCommand,
  getRequiredInput,
  getOptionalInput,
  setOutputs,
  JobType,
  WorkflowResourceType as ResourceType,
  WorkflowContext as RunnerContext,
} from "@more/statemachine";
import { TriggerTypeSchema } from "@more/statemachine/schemas";
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
  GhPrListOutputSchema,
  GhPrViewOutputSchema,
  GhPrBranchBodyOutputSchema,
} from "./payload-schemas.js";

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
 * Project state from GitHub Project custom fields
 * Note: Project state is now fetched by parseIssue in the state machine.
 * This minimal interface is kept for skip logic checks only.
 */
interface ProjectState {
  status: string | null;
}

/**
 * Fetch ONLY the project status for skip logic
 * Note: Full project state (iteration, failures) is fetched by parseIssue
 */
async function fetchProjectStatusForSkipCheck(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<ProjectState | null> {
  try {
    const result = await octokit.graphql<{
      repository: {
        issue: {
          projectItems: {
            nodes: Array<{
              fieldValues: {
                nodes: Array<{
                  name?: string;
                  field?: { name?: string };
                }>;
              };
            }>;
          };
        } | null;
      };
    }>(
      `
      query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          issue(number: $number) {
            projectItems(first: 10) {
              nodes {
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
    `,
      { owner, repo, number: issueNumber },
    );

    const items = result.repository.issue?.projectItems.nodes ?? [];
    if (items.length === 0) {
      return null;
    }

    // Only parse Status field for skip check
    const fieldValues = items[0]?.fieldValues?.nodes ?? [];
    for (const fieldValue of fieldValues) {
      if (fieldValue.field?.name === "Status" && fieldValue.name) {
        return { status: fieldValue.name };
      }
    }

    return { status: null };
  } catch (error) {
    core.warning(`Failed to fetch project status: ${error}`);
    return null;
  }
}

/**
 * Check if project state indicates the issue should be skipped
 * Note: "Backlog" is NOT a skip status - it's a valid initial state
 * that allows the state machine to start
 */
function shouldSkipProjectState(state: ProjectState | null): boolean {
  if (!state || !state.status) return false;
  // Only skip for terminal/blocked states
  // "Backlog" is allowed as it's the initial state before state machine starts
  const skipStatuses = ["Done", "Blocked", "Error"];
  return skipStatuses.includes(state.status);
}

/**
 * Derive branch name from parent issue and phase number
 */
function deriveBranch(parentIssueNumber: number, phaseNumber: number): string {
  return `claude/issue/${parentIssueNumber}/phase-${phaseNumber}`;
}

interface IssueDetails {
  title: string;
  body: string;
  isSubIssue: boolean;
  parentIssue: number; // 0 if not a sub-issue
  subIssues: number[]; // Empty array if no sub-issues
  labels: string[]; // Label names
}

async function fetchIssueDetails(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<IssueDetails> {
  // Use GraphQL to check for parent and sub-issues
  const result = await octokit.graphql<{
    repository: {
      issue: {
        title: string;
        body: string;
        parent?: { number: number };
        subIssues?: {
          nodes: Array<{ number: number }>;
        };
        labels?: {
          nodes: Array<{ name: string }>;
        };
      } | null;
    };
  }>(
    `
    query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        issue(number: $number) {
          title
          body
          parent { number }
          subIssues(first: 50) {
            nodes { number }
          }
          labels(first: 50) {
            nodes { name }
          }
        }
      }
    }
  `,
    {
      owner,
      repo,
      number: issueNumber,
      headers: {
        "GraphQL-Features": "sub_issues",
      },
    },
  );

  const issue = result.repository.issue;
  if (!issue) {
    return {
      title: "",
      body: "",
      isSubIssue: false,
      parentIssue: 0,
      subIssues: [],
      labels: [],
    };
  }

  const subIssues =
    issue.subIssues?.nodes?.map((n) => n.number).filter((n) => n > 0) ?? [];
  const labels = issue.labels?.nodes?.map((l) => l.name) ?? [];

  return {
    title: issue.title,
    body: issue.body ?? "",
    isSubIssue: !!issue.parent,
    parentIssue: issue.parent?.number ?? 0,
    subIssues,
    labels,
  };
}

/**
 * Extract phase number from sub-issue title
 * Expected format: "[Phase N] Title (parent #XXX)"
 */
function extractPhaseNumber(title: string): number {
  const match = title.match(/^\[Phase\s*(\d+)\]/i);
  return match?.[1] ? parseInt(match[1], 10) : 0;
}

async function fetchPrByBranch(
  owner: string,
  repo: string,
  branch: string,
): Promise<{
  hasPr: boolean;
  prNumber: string;
  isDraft: boolean;
  isClaudePr: boolean;
  author: string;
  body: string;
  title: string;
  labels: string[];
}> {
  const { stdout, exitCode } = await execCommand(
    "gh",
    [
      "pr",
      "list",
      "--repo",
      `${owner}/${repo}`,
      "--head",
      branch,
      "--json",
      "number,isDraft,author,body,title,labels",
      "--jq",
      ".[0]",
    ],
    { ignoreReturnCode: true },
  );

  if (exitCode !== 0 || !stdout || stdout === "null") {
    return {
      hasPr: false,
      prNumber: "",
      isDraft: false,
      isClaudePr: false,
      author: "",
      body: "",
      title: "",
      labels: [],
    };
  }

  try {
    const pr = GhPrListOutputSchema.parse(JSON.parse(stdout));
    const author = pr.author.login;
    const isClaudePr = author === "claude[bot]" || branch.startsWith("claude/");
    return {
      hasPr: true,
      prNumber: String(pr.number),
      isDraft: pr.isDraft,
      isClaudePr,
      author,
      body: pr.body ?? "",
      title: pr.title ?? "",
      labels: (pr.labels ?? []).map((l) => l.name),
    };
  } catch {
    return {
      hasPr: false,
      prNumber: "",
      isDraft: false,
      isClaudePr: false,
      author: "",
      body: "",
      title: "",
      labels: [],
    };
  }
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

async function extractIssueNumber(body: string): Promise<string> {
  const match = body.match(/(?:Fixes|Closes|Resolves)\s+#(\d+)/i);
  return match?.[1] ?? "";
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

async function handleIssueEvent(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
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
    // Double-check by fetching fresh labels from API
    // This handles race condition where webhook payload has stale label data
    // when an issue is created with labels (GitHub eventual consistency)
    const freshDetails = await fetchIssueDetails(
      octokit,
      owner,
      repo,
      issue.number,
    );
    if (freshDetails.labels.includes("test:automation")) {
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
    const details = await fetchIssueDetails(octokit, owner, repo, issue.number);
    const hasPhaseTitle = /^\[Phase \d+\]/.test(issue.title);
    if (details.isSubIssue || hasPhaseTitle) {
      return emptyResult(
        true,
        details.isSubIssue
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
      const details = await fetchIssueDetails(
        octokit,
        owner,
        repo,
        issue.number,
      );
      const hasPhaseTitle = /^\[Phase \d+\]/.test(issue.title);
      if (!details.isSubIssue && !hasPhaseTitle) {
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
      // Note: Full project state is fetched by parseIssue in the state machine
      const projectStatus = await fetchProjectStatusForSkipCheck(
        octokit,
        owner,
        repo,
        issue.number,
      );
      if (shouldSkipProjectState(projectStatus)) {
        return emptyResult(
          true,
          `Issue project status is '${projectStatus?.status}' - skipping iteration`,
        );
      }

      const details = await fetchIssueDetails(
        octokit,
        owner,
        repo,
        issue.number,
      );

      // Check if this is a sub-issue (has parent) - route to iterate with parent context
      if (details.isSubIssue) {
        return {
          job: "issue-iterate",
          resourceType: "issue",
          resourceNumber: String(issue.number),
          commentId: "",
          contextJson: {
            issue_number: String(issue.number),
            trigger_type: "issue-edited",
            parent_issue: String(details.parentIssue),
            // Note: branch_name, project_* fields removed - fetched by parseIssue
          },
          skip: false,
          skipReason: "",
        };
      }

      // Check if this is a main issue with sub-issues - route to orchestrate
      // First try GraphQL sub-issues, then fall back to parsing CLAUDE_MAIN_STATE
      // (GraphQL may not have propagated sub-issues yet after triage creates them)
      const hasMainState = details.body.includes("<!-- CLAUDE_MAIN_STATE");
      let subIssueNumbers = details.subIssues;
      if (subIssueNumbers.length === 0 && hasMainState) {
        // Parse sub_issues from CLAUDE_MAIN_STATE: sub_issues: [123, 456]
        const match = details.body.match(/sub_issues:\s*\[([^\]]+)\]/);
        if (match?.[1]) {
          subIssueNumbers = match[1]
            .split(",")
            .map((s) => parseInt(s.trim(), 10))
            .filter((n) => !isNaN(n) && n > 0);
          core.info(
            `Parsed sub-issues from CLAUDE_MAIN_STATE: ${subIssueNumbers.join(",")}`,
          );
        }
      }

      if (subIssueNumbers.length > 0) {
        return {
          job: "issue-orchestrate",
          resourceType: "issue",
          resourceNumber: String(issue.number),
          commentId: "",
          contextJson: {
            issue_number: String(issue.number),
            sub_issues: subIssueNumbers.join(","),
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
      const details = await fetchIssueDetails(
        octokit,
        owner,
        repo,
        issue.number,
      );
      // Check for sub-issue or phase title pattern
      const hasPhaseTitle = /^\[Phase \d+\]/.test(issue.title);
      if (details.isSubIssue || hasPhaseTitle) {
        return emptyResult(
          true,
          details.isSubIssue
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
    const details = await fetchIssueDetails(octokit, owner, repo, issue.number);

    // Only handle sub-issues being closed
    if (!details.isSubIssue) {
      return emptyResult(true, "Closed issue is not a sub-issue");
    }

    // Route to orchestrate so it can check if all sub-issues are done
    // Note: Parent issue details fetched by parseIssue in state machine
    return {
      job: "issue-orchestrate",
      resourceType: "issue",
      resourceNumber: String(details.parentIssue),
      commentId: "",
      contextJson: {
        issue_number: String(details.parentIssue),
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
    const projectStatus = await fetchProjectStatusForSkipCheck(
      octokit,
      owner,
      repo,
      issue.number,
    );
    const terminalStatuses = ["Done", "Blocked", "Error"];
    if (
      projectStatus?.status &&
      terminalStatuses.includes(projectStatus.status)
    ) {
      return emptyResult(
        true,
        `Issue project status is '${projectStatus?.status}' - skipping iteration`,
      );
    }

    const details = await fetchIssueDetails(octokit, owner, repo, issue.number);

    // Check if this is a sub-issue (has parent) - route to iterate with parent context
    // Sub-issues don't need triaged label - they're created by triage
    if (details.isSubIssue) {
      const phaseNumber = extractPhaseNumber(details.title);
      const branchName = deriveBranch(
        details.parentIssue,
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
          parent_issue: String(details.parentIssue),
          // Note: project_* fields removed - fetched by parseIssue
        },
        skip: false,
        skipReason: "",
      };
    }

    // For parent issues: require triaged label OR sub-issues OR CLAUDE_MAIN_STATE before work can start
    // CLAUDE_MAIN_STATE indicates triage has written the body (sub-issues may still be propagating via GraphQL)
    // This prevents iterate from running before triage completes
    const hasMainState = details.body.includes("<!-- CLAUDE_MAIN_STATE");
    if (!hasTriagedLabel && details.subIssues.length === 0 && !hasMainState) {
      return emptyResult(
        true,
        "Issue not triaged yet - waiting for triage to complete and create sub-issues",
      );
    }

    // Check if this is a main issue with sub-issues - route to orchestrate
    // First try GraphQL sub-issues, then fall back to parsing CLAUDE_MAIN_STATE
    let subIssueNumbers = details.subIssues;
    if (subIssueNumbers.length === 0 && hasMainState) {
      // Parse sub_issues from CLAUDE_MAIN_STATE: sub_issues: [123, 456]
      const match = details.body.match(/sub_issues:\s*\[([^\]]+)\]/);
      if (match?.[1]) {
        subIssueNumbers = match[1]
          .split(",")
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => !isNaN(n) && n > 0);
      }
    }

    if (subIssueNumbers.length > 0) {
      return {
        job: "issue-orchestrate",
        resourceType: "issue",
        resourceNumber: String(issue.number),
        commentId: "",
        contextJson: {
          issue_number: String(issue.number),
          sub_issues: subIssueNumbers.join(","),
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

    const details = await fetchIssueDetails(octokit, owner, repo, issue.number);

    // If triggered on sub-issue, redirect to parent
    const targetIssue = details.isSubIssue ? details.parentIssue : issue.number;

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

  // Handle /lfg on PRs - triggers PR response flow based on current review state
  if ((hasImplementCommand || hasContinueCommand || hasLfgCommand) && isPr) {
    // Add rocket reaction to acknowledge the command
    await addReactionToComment(octokit, owner, repo, comment.id, "rocket");

    // Fetch PR details including review decision
    const { stdout: prJson } = await execCommand("gh", [
      "pr",
      "view",
      String(issue.number),
      "--repo",
      `${owner}/${repo}`,
      "--json",
      "headRefName,reviewDecision,reviews,body,isDraft",
    ]);

    const prData = GhPrViewOutputSchema.parse(JSON.parse(prJson));

    // Skip if PR is a draft
    if (prData.isDraft) {
      return emptyResult(
        true,
        "PR is a draft - convert to ready for review first",
      );
    }

    // Extract issue number from PR body
    const issueNumber = await extractIssueNumber(prData.body ?? "");

    // Find the most recent non-dismissed review with changes requested
    const pendingReview = prData.reviews
      ?.filter((r) => r.state === "CHANGES_REQUESTED")
      .pop();

    if (!pendingReview) {
      // No pending changes requested - check if there's any review decision
      if (prData.reviewDecision === "APPROVED") {
        return emptyResult(true, "PR is already approved");
      }
      return emptyResult(true, "No pending changes requested on this PR");
    }

    // Determine if reviewer is Claude or human
    const claudeReviewers = ["nopo-reviewer", "claude[bot]"];
    const isClaudeReviewer = claudeReviewers.includes(
      pendingReview.author.login,
    );
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
        branch_name: prData.headRefName,
        review_state: "changes_requested",
        review_decision: "CHANGES_REQUESTED",
        review_body: pendingReview.body ?? "",
        reviewer: pendingReview.author.login,
        reviewer_login: pendingReview.author.login,
        issue_number: issueNumber,
        trigger_type: triggerType,
      },
      skip: false,
      skipReason: "",
    };
  }

  if ((hasImplementCommand || hasContinueCommand || hasLfgCommand) && !isPr) {
    // Add rocket reaction to acknowledge the command
    await addReactionToComment(octokit, owner, repo, comment.id, "rocket");

    const details = await fetchIssueDetails(octokit, owner, repo, issue.number);

    // Check if this is a sub-issue
    if (details.isSubIssue) {
      const phaseNumber = extractPhaseNumber(details.title);
      const branchName = deriveBranch(
        details.parentIssue,
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
          parent_issue: String(details.parentIssue),
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

    if (hasTriagedLabel && !hasGroomedLabel && !hasNeedsInfoLabel) {
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
    if (details.subIssues.length > 0) {
      // /lfg on parent with sub-issues -> orchestrate
      return {
        job: "issue-orchestrate",
        resourceType: "issue",
        resourceNumber: String(issue.number),
        commentId: String(comment.id),
        contextJson: {
          issue_number: String(issue.number),
          sub_issues: details.subIssues.join(","),
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
  let linkedIssueNumber = String(issue.number);
  let prNumber = "";

  if (isPr) {
    // Fetch PR branch and body to get linked issue
    const { stdout } = await execCommand("gh", [
      "pr",
      "view",
      String(issue.number),
      "--repo",
      process.env.GITHUB_REPOSITORY ?? "",
      "--json",
      "headRefName,body",
    ]);
    try {
      const prData = GhPrBranchBodyOutputSchema.parse(JSON.parse(stdout));
      branchName = prData.headRefName || "main";
      const prBody = prData.body || "";
      contextType = "pr";
      prNumber = String(issue.number);

      // Extract linked issue from PR body (e.g., "Fixes #4603")
      const linkedIssue = await extractIssueNumber(prBody);
      if (linkedIssue) {
        linkedIssueNumber = linkedIssue;
      }
    } catch {
      // If parsing fails, use defaults
      branchName = "main";
      contextType = "pr";
      prNumber = String(issue.number);
    }
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

async function handlePullRequestReviewCommentEvent(): Promise<DetectionResult> {
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

async function handlePushEvent(): Promise<DetectionResult> {
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

  const owner = context.repo.owner;
  const repo = context.repo.repo;
  const prInfo = await fetchPrByBranch(owner, repo, branch);

  if (!prInfo.hasPr) {
    return emptyResult(true, "No PR found for branch");
  }

  // Check for skip labels on PR (circuit breaker for test automation)
  if (hasSkipLabel(prInfo.labels)) {
    return emptyResult(true, "PR has skip-dispatch or test:automation label");
  }

  // Check for [TEST] in PR title (circuit breaker for test automation)
  // Skip unless test:automation label is present
  if (shouldSkipTestResource(prInfo.title, prInfo.labels)) {
    return emptyResult(true, "PR title starts with [TEST]");
  }

  // Extract issue number from branch name (claude/issue/N or claude/issue/N/phase-M)
  const branchMatch = branch.match(/^claude\/issue\/(\d+)/);
  const issueNumber = branchMatch?.[1] ?? "";

  // Check if the linked issue has test:automation label
  if (issueNumber) {
    const octokit = github.getOctokit(getRequiredInput("github_token"));
    const details = await fetchIssueDetails(
      octokit,
      owner,
      repo,
      Number(issueNumber),
    );
    if (details.labels.includes("test:automation")) {
      return emptyResult(
        true,
        "Linked issue has test:automation label - skipping from normal automation",
      );
    }
  }

  // Construct run URL for history entry
  const serverUrl = process.env.GITHUB_SERVER_URL || "https://github.com";
  const runId = process.env.GITHUB_RUN_ID || "";
  const commitSha = github.context.sha;
  const runUrl = `${serverUrl}/${owner}/${repo}/actions/runs/${runId}`;

  // PR push converts PR to draft and logs history
  return {
    job: "pr-push",
    resourceType: "pr",
    resourceNumber: prInfo.prNumber,
    commentId: "",
    contextJson: {
      pr_number: prInfo.prNumber,
      branch_name: branch,
      is_draft: prInfo.isDraft,
      issue_number: issueNumber,
      // Include commit SHA and run URL for history entry
      ci_commit_sha: commitSha,
      ci_run_url: runUrl,
    },
    skip: false,
    skipReason: "",
  };
}

async function handleWorkflowRunEvent(): Promise<DetectionResult> {
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

  const owner = context.repo.owner;
  const repo = context.repo.repo;
  const prInfo = await fetchPrByBranch(owner, repo, branch);

  if (!prInfo.hasPr) {
    return emptyResult(true, "No PR found for workflow run branch");
  }

  // Check for skip labels on PR (circuit breaker for test automation)
  if (hasSkipLabel(prInfo.labels)) {
    return emptyResult(true, "PR has skip-dispatch or test:automation label");
  }

  // Check for [TEST] in PR title (circuit breaker for test automation)
  // Skip unless test:automation label is present
  if (shouldSkipTestResource(prInfo.title, prInfo.labels)) {
    return emptyResult(true, "PR title starts with [TEST]");
  }

  const issueNumber = await extractIssueNumber(prInfo.body);

  if (!prInfo.isClaudePr) return emptyResult(true, "PR is not a Claude PR");

  if (!issueNumber) core.setFailed("PR has no issue number");

  // Fetch issue details to check if it's a sub-issue
  const octokit = github.getOctokit(getRequiredInput("github_token"));
  const details = await fetchIssueDetails(
    octokit,
    owner,
    repo,
    Number(issueNumber),
  );

  // Check if the linked issue has test:automation label
  // This catches test issues even when the PR doesn't have the label
  if (details.labels.includes("test:automation")) {
    return emptyResult(
      true,
      "Linked issue has test:automation label - skipping from normal automation",
    );
  }

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
      pr_number: prInfo.prNumber,
      branch_name: branch,
      ci_run_url: ciRunUrl,
      ci_result: conclusion,
      ci_commit_sha: headSha,
      trigger_type: "workflow-run-completed",
      parent_issue: String(details.parentIssue),
    },
    skip: false,
    skipReason: "",
  };
}

async function handlePullRequestEvent(
  _octokit: ReturnType<typeof github.getOctokit>,
  _owner: string,
  _repo: string,
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

    // Extract issue number for logging review events to iteration history
    // Note: We don't include issue_section here to avoid GitHub's secret masking
    // when issue body contains patterns like ${VAR_NAME}. The review prompt
    // can fetch issue content at runtime if needed via the issue_number.
    const issueNumber = await extractIssueNumber(pr.body ?? "");

    // Use pr-review-requested (not pr-review) since this is a review REQUEST,
    // not a review SUBMISSION. pr-review expects reviewDecision/reviewer fields.
    return {
      job: "pr-review-requested",
      resourceType: "pr",
      resourceNumber: String(pr.number),
      commentId: "",
      contextJson: {
        pr_number: String(pr.number),
        branch_name: pr.head.ref,
        issue_number: issueNumber,
      },
      skip: false,
      skipReason: "",
    };
  }

  return emptyResult(true, `Unhandled PR action: ${action}`);
}

async function handlePullRequestReviewEvent(): Promise<DetectionResult> {
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
  const linkedIssueNumber = await extractIssueNumber(pr.body ?? "");
  if (linkedIssueNumber) {
    const octokit = github.getOctokit(getRequiredInput("github_token"));
    const { owner, repo } = github.context.repo;
    const details = await fetchIssueDetails(
      octokit,
      owner,
      repo,
      Number(linkedIssueNumber),
    );
    if (details.labels.includes("test:automation")) {
      return emptyResult(
        true,
        "Linked issue has test:automation label - skipping from normal automation",
      );
    }
  }

  const state = review.state.toLowerCase();

  // Handle approved state from nopo-reviewer (Claude's review account)
  // This triggers orchestration to merge the PR
  if (state === "approved" && reviewerLogin === "nopo-reviewer") {
    // Extract linked issue number from PR body (Fixes #N, Closes #N, Resolves #N)
    // This is more reliable than branch name for sub-issues
    const prBody = pr.body ?? "";
    const linkedIssueMatch = prBody.match(
      /(?:fixes|closes|resolves)\s+#(\d+)/i,
    );
    const issueNumber = linkedIssueMatch?.[1] ?? "";

    // Also extract parent issue from branch name for context
    const branchMatch = pr.head.ref.match(/^claude\/issue\/(\d+)/);
    const parentIssue = branchMatch?.[1] ?? "";

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
        parent_issue: parentIssue,
      },
      skip: false,
      skipReason: "",
    };
  }

  // Only handle changes_requested or commented states for other reviews
  if (state !== "changes_requested" && state !== "commented") {
    return emptyResult(true, `Review state is ${state}`);
  }

  // Extract issue number from PR body (e.g., "Fixes #4603")
  // This is more reliable than branch parsing since sub-issue branches use
  // phase numbers (claude/issue/4545/phase-1) not sub-issue numbers
  const issueNumber = await extractIssueNumber(pr.body ?? "");

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
  const isClaudePr =
    claudeAuthors.includes(prAuthorLogin) || pr.head.ref.startsWith("claude/");
  if (!isClaudePr) {
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
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
): Promise<DetectionResult> {
  const { context } = github;
  const payload = context.payload;
  const mergeGroup = MergeGroupPayloadSchema.parse(payload.merge_group);

  const headRef = mergeGroup.head_ref;

  // Parse PR numbers from branch: gh-readonly-queue/main/pr-123-abc123
  // Can also be batched: pr-123-abc123-pr-456-def456
  const prMatches = headRef.match(/pr-(\d+)/g);
  if (!prMatches || prMatches.length === 0) {
    return emptyResult(true, "No PR found in merge queue branch");
  }

  // Get the first PR number (for non-batched, this is the only one)
  const prMatch = prMatches[0].match(/pr-(\d+)/);
  if (!prMatch || !prMatch[1]) {
    return emptyResult(
      true,
      "Could not parse PR number from merge queue branch",
    );
  }

  const prNumber = parseInt(prMatch[1], 10);

  // Fetch PR directly by number to find linked issue and branch
  let issueNumber = "";
  let prBranch = "";
  const { stdout, exitCode } = await execCommand(
    "gh",
    [
      "pr",
      "view",
      String(prNumber),
      "--repo",
      `${owner}/${repo}`,
      "--json",
      "body,headRefName",
      "--jq",
      ".",
    ],
    { ignoreReturnCode: true },
  );

  if (exitCode === 0 && stdout) {
    try {
      const prData = GhPrBranchBodyOutputSchema.parse(JSON.parse(stdout));
      prBranch = prData.headRefName || "";

      // Try to extract issue from PR body via "Fixes #N" pattern
      issueNumber = await extractIssueNumber(prData.body || "");

      // If no issue found from PR body, try the branch pattern
      if (!issueNumber && prBranch) {
        // Check for claude/issue/N or claude/issue/N/phase-M
        const match = prBranch.match(/^claude\/issue\/(\d+)/);
        if (match?.[1]) {
          issueNumber = match[1];
        }
      }
    } catch {
      // Ignore parse errors
    }
  }

  if (!issueNumber) {
    return emptyResult(true, "Could not find linked issue for merge queue PR");
  }

  // Check if this is a sub-issue
  const details = await fetchIssueDetails(
    octokit,
    owner,
    repo,
    parseInt(issueNumber, 10),
  );

  const parentIssue = details.isSubIssue
    ? String(details.parentIssue)
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
      parent_issue: parentIssue,
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
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  resourceNumber: string,
): Promise<DetectionResult> {
  if (!resourceNumber) {
    return emptyResult(
      true,
      "No resource_number provided for workflow_dispatch",
    );
  }

  const issueNumber = parseInt(resourceNumber, 10);
  if (isNaN(issueNumber)) {
    return emptyResult(true, `Invalid resource_number: ${resourceNumber}`);
  }

  core.info(`Workflow dispatch for issue #${issueNumber}`);

  // Fetch issue details
  const details = await fetchIssueDetails(octokit, owner, repo, issueNumber);

  // Check project status - skip if in terminal/blocked state
  // Note: Full project state is fetched by parseIssue in the state machine
  const projectStatus = await fetchProjectStatusForSkipCheck(
    octokit,
    owner,
    repo,
    issueNumber,
  );
  if (shouldSkipProjectState(projectStatus)) {
    return emptyResult(
      true,
      `Issue project status is '${projectStatus?.status}' - skipping iteration`,
    );
  }

  // Determine parent issue
  let parentIssue = "0";
  if (details.isSubIssue && details.parentIssue > 0) {
    parentIssue = String(details.parentIssue);
    core.info(`Issue #${issueNumber} is a sub-issue of parent #${parentIssue}`);
  }

  // Check if grooming is needed BEFORE orchestration
  // Grooming needed: has "triaged" label but NOT "groomed" label
  const hasTriaged = details.labels.includes("triaged");
  const hasGroomed = details.labels.includes("groomed");

  if (hasTriaged && !hasGroomed) {
    core.info(
      `Issue #${issueNumber} needs grooming (triaged=${hasTriaged}, groomed=${hasGroomed})`,
    );
    return {
      job: "issue-groom",
      resourceType: "issue",
      resourceNumber: String(issueNumber),
      commentId: "",
      contextJson: {
        issue_number: String(issueNumber),
        trigger_type: "issue-groom",
        parent_issue: parentIssue,
        // Note: project_* fields removed - fetched by parseIssue
      },
      skip: false,
      skipReason: "",
    };
  }

  // Check if this is a parent issue with sub-issues - route to orchestrate
  if (details.subIssues.length > 0) {
    return {
      job: "issue-orchestrate",
      resourceType: "issue",
      resourceNumber: String(issueNumber),
      commentId: "",
      contextJson: {
        issue_number: String(issueNumber),
        sub_issues: details.subIssues.join(","),
        trigger_type: "issue-assigned",
        parent_issue: parentIssue,
        // Note: project_* fields removed - fetched by parseIssue
      },
      skip: false,
      skipReason: "",
    };
  }

  // Check if this is a sub-issue - determine branch from parent and phase
  if (details.isSubIssue) {
    const phaseNumber = extractPhaseNumber(details.title);
    const branchName = deriveBranch(
      details.parentIssue,
      phaseNumber || issueNumber,
    );

    return {
      job: "issue-iterate",
      resourceType: "issue",
      resourceNumber: String(issueNumber),
      commentId: "",
      contextJson: {
        issue_number: String(issueNumber),
        branch_name: branchName,
        trigger_type: "issue-assigned",
        parent_issue: parentIssue,
        // Note: project_* fields removed - fetched by parseIssue
      },
      skip: false,
      skipReason: "",
    };
  }

  // Regular issue without sub-issues
  const branchName = `claude/issue/${issueNumber}`;

  return {
    job: "issue-iterate",
    resourceType: "issue",
    resourceNumber: String(issueNumber),
    commentId: "",
    contextJson: {
      issue_number: String(issueNumber),
      branch_name: branchName,
      trigger_type: "issue-assigned",
      parent_issue: parentIssue,
      // Note: project_* fields removed - fetched by parseIssue
    },
    skip: false,
    skipReason: "",
  };
}

async function run(): Promise<void> {
  try {
    const token = getRequiredInput("github_token");
    const resourceNumber = getOptionalInput("resource_number") || "";
    const octokit = github.getOctokit(token);
    const { context } = github;
    const eventName = context.eventName;
    const owner = context.repo.owner;
    const repo = context.repo.repo;

    // Set GH_TOKEN for CLI commands
    process.env.GH_TOKEN = token;

    core.info(`Processing event: ${eventName}`);

    let result: DetectionResult;

    switch (eventName) {
      case "issues":
        result = await handleIssueEvent(octokit, owner, repo);
        break;
      case "issue_comment":
        result = await handleIssueCommentEvent(octokit, owner, repo);
        break;
      case "pull_request_review_comment":
        result = await handlePullRequestReviewCommentEvent();
        break;
      case "push":
        result = await handlePushEvent();
        break;
      case "workflow_run":
        result = await handleWorkflowRunEvent();
        break;
      case "pull_request":
        result = await handlePullRequestEvent(octokit, owner, repo);
        break;
      case "pull_request_review":
        result = await handlePullRequestReviewEvent();
        break;
      case "discussion":
        result = await handleDiscussionEvent(octokit, owner, repo);
        break;
      case "discussion_comment":
        result = await handleDiscussionCommentEvent(octokit, owner, repo);
        break;
      case "merge_group":
        result = await handleMergeGroupEvent(octokit, owner, repo);
        break;
      case "workflow_dispatch":
        result = await handleWorkflowDispatchEvent(
          octokit,
          owner,
          repo,
          resourceNumber,
        );
        break;
      default:
        result = emptyResult(true, `Unhandled event: ${eventName}`);
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
    const parentIssue = String(ctx.parent_issue ?? "0");
    const branch = String(ctx.branch_name ?? "");

    // Compute trigger type from job
    const trigger = jobToTrigger(result.job, JSON.stringify(ctx));
    core.info(`Trigger: ${trigger}`);

    // Compute concurrency group and cancel-in-progress
    const concurrency = computeConcurrency(
      result.job,
      result.resourceNumber,
      parentIssue,
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
      parent_issue: parentIssue,
      comment_id: result.commentId,
      concurrency_group: concurrency.group,
      cancel_in_progress: concurrency.cancelInProgress,
      skip: result.skip,
      skip_reason: result.skipReason,
      // Spread in all the context-specific fields
      ...ctx,
    };

    // Output only context_json (single source of truth)
    setOutputs({
      context_json: JSON.stringify(unifiedContext),
    });
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed("An unexpected error occurred");
    }
  }
}

run();
