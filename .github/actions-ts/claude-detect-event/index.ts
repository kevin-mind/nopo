import * as core from "@actions/core";
import * as github from "@actions/github";
import { execCommand, getRequiredInput, setOutputs } from "../lib/index.js";

type Job =
  | "issue-triage"
  | "issue-iterate"
  | "issue-orchestrate"
  | "issue-comment"
  | "push-to-draft"
  | "pr-review"
  | "pr-response"
  | "pr-human-response"
  | "discussion-research"
  | "discussion-respond"
  | "discussion-summarize"
  | "discussion-plan"
  | "discussion-complete"
  | "";

type ResourceType = "issue" | "pr" | "discussion" | "";

interface DetectionResult {
  job: Job;
  resourceType: ResourceType;
  resourceNumber: string;
  commentId: string;
  contextJson: string;
  skip: boolean;
  skipReason: string;
}

function emptyResult(skip = false, skipReason = ""): DetectionResult {
  return {
    job: "",
    resourceType: "",
    resourceNumber: "",
    commentId: "",
    contextJson: "{}",
    skip,
    skipReason,
  };
}

/**
 * Project state from GitHub Project custom fields
 */
interface ProjectState {
  status: string | null;
  iteration: number;
  failures: number;
}

/**
 * Fetch the project state for an issue (Status, Iteration, Failures)
 * Returns null if issue is not in a project
 */
async function fetchProjectState(
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
                  number?: number;
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
                fieldValues(first: 20) {
                  nodes {
                    ... on ProjectV2ItemFieldSingleSelectValue {
                      name
                      field {
                        ... on ProjectV2SingleSelectField {
                          name
                        }
                      }
                    }
                    ... on ProjectV2ItemFieldNumberValue {
                      number
                      field {
                        ... on ProjectV2Field {
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

    // Parse fields from the first project item
    const state: ProjectState = {
      status: null,
      iteration: 0,
      failures: 0,
    };

    const fieldValues = items[0]?.fieldValues?.nodes ?? [];
    for (const fieldValue of fieldValues) {
      const fieldName = fieldValue.field?.name;
      if (fieldName === "Status" && fieldValue.name) {
        state.status = fieldValue.name;
      } else if (
        fieldName === "Iteration" &&
        typeof fieldValue.number === "number"
      ) {
        state.iteration = fieldValue.number;
      } else if (
        fieldName === "Failures" &&
        typeof fieldValue.number === "number"
      ) {
        state.failures = fieldValue.number;
      }
    }

    return state;
  } catch (error) {
    core.warning(`Failed to fetch project state: ${error}`);
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
    };
  }

  const subIssues =
    issue.subIssues?.nodes?.map((n) => n.number).filter((n) => n > 0) ?? [];

  return {
    title: issue.title,
    body: issue.body ?? "",
    isSubIssue: !!issue.parent,
    parentIssue: issue.parent?.number ?? 0,
    subIssues,
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
    const pr = JSON.parse(stdout) as {
      number: number;
      isDraft: boolean;
      author: { login: string };
      body: string;
      title: string;
      labels: Array<{ name: string }>;
    };
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

function hasStepwiseTestLabel(
  labels: Array<{ name: string }> | string[],
): boolean {
  return labels.some((l) =>
    typeof l === "string" ? l === "_test" : l.name === "_test",
  );
}

function hasE2ETestLabel(labels: Array<{ name: string }> | string[]): boolean {
  return labels.some((l) =>
    typeof l === "string" ? l === "_e2e" : l.name === "_e2e",
  );
}

function isInTestingMode(labels: Array<{ name: string }> | string[]): boolean {
  // Either stepwise (_test) or E2E (_e2e) testing mode
  return hasStepwiseTestLabel(labels) || hasE2ETestLabel(labels);
}

function isTestResource(title: string): boolean {
  return title.startsWith("[TEST]");
}

function shouldSkipTestResource(
  title: string,
  labels: Array<{ name: string }> | string[],
): boolean {
  // Allow [TEST] resources through when _test or _e2e label is present
  // _test = stepwise testing (detection only, no execution)
  // _e2e = end-to-end testing (full execution)
  if (hasStepwiseTestLabel(labels) || hasE2ETestLabel(labels)) {
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

async function buildIssueSection(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  prBody: string,
): Promise<string> {
  const issueNumber = await extractIssueNumber(prBody);
  if (!issueNumber) {
    return "## No Linked Issue\nPerforming standard code review.\n";
  }

  try {
    const { data: issue } = await octokit.rest.issues.get({
      owner,
      repo,
      issue_number: parseInt(issueNumber, 10),
    });

    return `## Linked Issue #${issueNumber}

${issue.body ?? ""}

## Validation
- CHECK ALL TODO ITEMS in the issue are addressed
- VERIFY code follows CLAUDE.md guidelines
- ENSURE tests cover the requirements
`;
  } catch {
    return "## No Linked Issue\nPerforming standard code review.\n";
  }
}

async function handleIssueEvent(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
): Promise<DetectionResult> {
  const { context } = github;
  const payload = context.payload;
  const action = payload.action as string;
  const issue = payload.issue as {
    number: number;
    title: string;
    body: string;
    labels: Array<{ name: string }>;
  };

  // Check for testing mode (_test for stepwise, _e2e for E2E) - allows bypassing circuit breakers
  const inTestingMode = isInTestingMode(issue.labels);

  // Check for [TEST] in title (circuit breaker for test automation)
  // Skip unless in testing mode (_test or _e2e label present)
  if (shouldSkipTestResource(issue.title, issue.labels)) {
    return emptyResult(true, "Issue title starts with [TEST]");
  }

  // Check for test:automation label (skip unless in testing mode)
  if (!inTestingMode) {
    const hasTestLabel = issue.labels.some((l) => l.name === "test:automation");
    if (hasTestLabel) {
      return emptyResult(true, "Issue has test:automation label");
    }
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
  const assignees = (payload.issue as { assignees?: Array<{ login: string }> })
    .assignees;
  const isNopoBotAssigned = assignees?.some((a) => a.login === "nopo-bot");

  if (
    action === "opened" ||
    (action === "unlabeled" &&
      (payload.label as { name: string })?.name === "triaged")
  ) {
    if (hasTriagedLabel && action !== "unlabeled") {
      return emptyResult(true, "Issue already triaged");
    }

    // Check if sub-issue
    const details = await fetchIssueDetails(octokit, owner, repo, issue.number);
    if (details.isSubIssue) {
      return emptyResult(true, "Issue is a sub-issue");
    }

    return {
      job: "issue-triage",
      resourceType: "issue",
      resourceNumber: String(issue.number),
      commentId: "",
      contextJson: JSON.stringify({
        issue_number: String(issue.number),
        issue_title: details.title || issue.title,
        issue_body: details.body || issue.body,
      }),
      skip: false,
      skipReason: "",
    };
  }

  // Handle edited: triggers iteration if nopo-bot is assigned, otherwise triage
  if (action === "edited") {
    // If nopo-bot is assigned, edited triggers iteration (issue-edit-based loop)
    if (isNopoBotAssigned) {
      // Check project state - skip if in terminal/blocked state
      const projectState = await fetchProjectState(
        octokit,
        owner,
        repo,
        issue.number,
      );
      if (shouldSkipProjectState(projectState)) {
        return emptyResult(
          true,
          `Issue project status is '${projectState?.status}' - skipping iteration`,
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
        const phaseNumber = extractPhaseNumber(details.title);
        const branchName = deriveBranch(
          details.parentIssue,
          phaseNumber || issue.number,
        );
        const branchExists = await checkBranchExists(branchName);

        return {
          job: "issue-iterate",
          resourceType: "issue",
          resourceNumber: String(issue.number),
          commentId: "",
          contextJson: JSON.stringify({
            issue_number: String(issue.number),
            issue_title: details.title || issue.title,
            issue_body: details.body || issue.body,
            branch_name: branchName,
            existing_branch: branchExists ? "true" : "false",
            trigger_type: "issue_edited",
            parent_issue: String(details.parentIssue),
            phase_number: String(phaseNumber),
            project_status: projectState?.status || "",
            project_iteration: String(projectState?.iteration || 0),
            project_failures: String(projectState?.failures || 0),
          }),
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
        if (match) {
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
          contextJson: JSON.stringify({
            issue_number: String(issue.number),
            issue_title: details.title || issue.title,
            issue_body: details.body || issue.body,
            sub_issues: subIssueNumbers.join(","),
            trigger_type: "issue_edited",
            project_status: projectState?.status || "",
            project_iteration: String(projectState?.iteration || 0),
            project_failures: String(projectState?.failures || 0),
          }),
          skip: false,
          skipReason: "",
        };
      }

      // Regular issue without sub-issues
      const branchName = `claude/issue/${issue.number}`;

      // Check if branch exists (don't create, iteration will handle that)
      const branchExists = await checkBranchExists(branchName);

      return {
        job: "issue-iterate",
        resourceType: "issue",
        resourceNumber: String(issue.number),
        commentId: "",
        contextJson: JSON.stringify({
          issue_number: String(issue.number),
          issue_title: details.title || issue.title,
          issue_body: details.body || issue.body,
          branch_name: branchName,
          existing_branch: branchExists ? "true" : "false",
          trigger_type: "issue_edited",
          project_status: projectState?.status || "",
          project_iteration: String(projectState?.iteration || 0),
          project_failures: String(projectState?.failures || 0),
        }),
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
      if (details.isSubIssue) {
        return emptyResult(true, "Issue is a sub-issue");
      }

      return {
        job: "issue-triage",
        resourceType: "issue",
        resourceNumber: String(issue.number),
        commentId: "",
        contextJson: JSON.stringify({
          issue_number: String(issue.number),
          issue_title: details.title || issue.title,
          issue_body: details.body || issue.body,
        }),
        skip: false,
        skipReason: "",
      };
    }

    return emptyResult(
      true,
      "Issue edited but already triaged and not assigned to nopo-bot",
    );
  }

  // Handle implement: assigned to nopo-bot
  if (action === "assigned") {
    const assignee = payload.assignee as { login: string };
    if (assignee.login !== "nopo-bot") {
      return emptyResult(true, "Not assigned to nopo-bot");
    }

    // Check project state - skip if in terminal/blocked state
    // Note: "Backlog" is allowed for assigned events (it's the initial state before state machine starts)
    const projectState = await fetchProjectState(
      octokit,
      owner,
      repo,
      issue.number,
    );
    const terminalStatuses = ["Done", "Blocked", "Error"];
    if (
      projectState?.status &&
      terminalStatuses.includes(projectState.status)
    ) {
      return emptyResult(
        true,
        `Issue project status is '${projectState?.status}' - skipping iteration`,
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
        contextJson: JSON.stringify({
          issue_number: String(issue.number),
          issue_title: details.title || issue.title,
          issue_body: details.body || issue.body,
          branch_name: branchName,
          trigger_type: "issue_assigned",
          parent_issue: String(details.parentIssue),
          phase_number: String(phaseNumber),
          project_status: projectState?.status || "",
          project_iteration: String(projectState?.iteration || 0),
          project_failures: String(projectState?.failures || 0),
        }),
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
      if (match) {
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
        contextJson: JSON.stringify({
          issue_number: String(issue.number),
          issue_title: details.title || issue.title,
          issue_body: details.body || issue.body,
          sub_issues: subIssueNumbers.join(","),
          trigger_type: "issue_assigned",
          project_status: projectState?.status || "",
          project_iteration: String(projectState?.iteration || 0),
          project_failures: String(projectState?.failures || 0),
        }),
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
      contextJson: JSON.stringify({
        issue_number: String(issue.number),
        issue_title: details.title || issue.title,
        issue_body: details.body || issue.body,
        branch_name: branchName,
        trigger_type: "issue_assigned",
        project_status: projectState?.status || "",
        project_iteration: String(projectState?.iteration || 0),
        project_failures: String(projectState?.failures || 0),
      }),
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
  const comment = payload.comment as {
    id: number;
    node_id: string;
    body: string;
    user: { login: string; type: string };
  };
  const issue = payload.issue as {
    number: number;
    title: string;
    body: string;
    labels: Array<{ name: string }>;
    pull_request?: unknown;
  };

  // Check for testing mode (_test for stepwise, _e2e for E2E) - allows bypassing circuit breakers
  const inTestingMode = isInTestingMode(issue.labels);

  // Check for [TEST] in title (circuit breaker for test automation)
  // Skip unless in testing mode (_test or _e2e label present)
  if (shouldSkipTestResource(issue.title, issue.labels)) {
    return emptyResult(true, "Issue/PR title starts with [TEST]");
  }

  // Check for test:automation label (skip unless in testing mode)
  if (!inTestingMode) {
    const hasTestLabel = issue.labels.some((l) => l.name === "test:automation");
    if (hasTestLabel) {
      return emptyResult(true, "Issue has test:automation label");
    }
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

  // Check for /implement command (issues only, not PRs)
  const isPr = !!issue.pull_request;
  const hasImplementCommand = comment.body
    .split("\n")
    .some((line) => line.trim() === "/implement");

  if (hasImplementCommand && !isPr) {
    const details = await fetchIssueDetails(octokit, owner, repo, issue.number);
    const branchName = `claude/issue/${issue.number}`;

    // Ensure the branch exists (create if not)
    await ensureBranchExists(branchName);

    // Use the unified iteration model
    return {
      job: "issue-iterate",
      resourceType: "issue",
      resourceNumber: String(issue.number),
      commentId: String(comment.id),
      contextJson: JSON.stringify({
        issue_number: String(issue.number),
        issue_title: details.title || issue.title,
        issue_body: details.body || issue.body,
        branch_name: branchName,
        trigger_type: "issue_comment",
      }),
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

  if (isPr) {
    // Fetch PR branch
    const { stdout } = await execCommand("gh", [
      "pr",
      "view",
      String(issue.number),
      "--repo",
      process.env.GITHUB_REPOSITORY ?? "",
      "--json",
      "headRefName",
      "--jq",
      ".headRefName",
    ]);
    branchName = stdout.trim() || "main";
    contextType = "PR";
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
    contextJson: JSON.stringify({
      issue_number: String(issue.number),
      context_type: contextType,
      context_description: contextDescription,
      branch_name: branchName,
    }),
    skip: false,
    skipReason: "",
  };
}

async function handlePullRequestReviewCommentEvent(): Promise<DetectionResult> {
  const { context } = github;
  const payload = context.payload;
  const comment = payload.comment as {
    id: number;
    body: string;
    user: { login: string; type: string };
  };
  const pr = payload.pull_request as {
    number: number;
    title: string;
    head: { ref: string };
    labels: Array<{ name: string }>;
  };

  // Check for testing mode (_test for stepwise, _e2e for E2E) - allows bypassing circuit breakers
  const inTestingMode = isInTestingMode(pr.labels);

  // Check for [TEST] in title (circuit breaker for test automation)
  // Skip unless in testing mode (_test or _e2e label present)
  if (shouldSkipTestResource(pr.title, pr.labels)) {
    return emptyResult(true, "PR title starts with [TEST]");
  }

  // Check for test:automation label (skip unless in testing mode)
  if (!inTestingMode) {
    const hasTestLabel = pr.labels.some((l) => l.name === "test:automation");
    if (hasTestLabel) {
      return emptyResult(true, "PR has test:automation label");
    }
  }

  // Check for skip-dispatch label
  const hasSkipLabelOnPr = pr.labels.some((l) => l.name === "skip-dispatch");
  if (hasSkipLabelOnPr) {
    return emptyResult(true, "PR has skip-dispatch label");
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
    contextJson: JSON.stringify({
      issue_number: String(pr.number),
      context_type: "PR",
      context_description: `This is PR #${pr.number} on branch \`${pr.head.ref}\`. You are checked out on the PR branch with the code changes.`,
      branch_name: pr.head.ref,
    }),
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
  // Skip unless _test label is present (stepwise testing mode)
  if (shouldSkipTestResource(prInfo.title, prInfo.labels)) {
    return emptyResult(true, "PR title starts with [TEST]");
  }

  // Push-to-draft doesn't call Claude, but we still signal
  return {
    job: "push-to-draft",
    resourceType: "pr",
    resourceNumber: prInfo.prNumber,
    commentId: "",
    contextJson: JSON.stringify({
      pr_number: prInfo.prNumber,
      branch_name: branch,
      is_draft: prInfo.isDraft,
    }),
    skip: false,
    skipReason: "",
  };
}

async function handleWorkflowRunEvent(): Promise<DetectionResult> {
  const { context } = github;
  const payload = context.payload;
  const workflowRun = payload.workflow_run as {
    conclusion: string;
    head_branch: string;
    id: number;
  };

  const conclusion = workflowRun.conclusion;
  const branch = workflowRun.head_branch;
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
  // Skip unless _test label is present (stepwise testing mode)
  if (shouldSkipTestResource(prInfo.title, prInfo.labels)) {
    return emptyResult(true, "PR title starts with [TEST]");
  }

  const issueNumber = await extractIssueNumber(prInfo.body);

  if (!prInfo.isClaudePr) return emptyResult(true, "PR is not a Claude PR");

  if (!issueNumber) core.setFailed("PR has no issue number");

  // Construct CI run URL
  const serverUrl = process.env.GITHUB_SERVER_URL || "https://github.com";
  const ciRunUrl = `${serverUrl}/${owner}/${repo}/actions/runs/${runId}`;

  return {
    job: "issue-iterate",
    resourceType: "issue",
    resourceNumber: issueNumber,
    commentId: "",
    contextJson: JSON.stringify({
      issue_number: issueNumber,
      pr_number: prInfo.prNumber,
      branch_name: branch,
      ci_run_url: ciRunUrl,
      ci_result: conclusion,
      trigger_type: "workflow_run_completed",
    }),
    skip: false,
    skipReason: "",
  };
}

async function handlePullRequestEvent(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
): Promise<DetectionResult> {
  const { context } = github;
  const payload = context.payload;
  const action = payload.action as string;
  const pr = payload.pull_request as {
    number: number;
    title: string;
    draft: boolean;
    head: { ref: string };
    body: string;
    labels: Array<{ name: string }>;
  };

  // Check for [TEST] in title (circuit breaker for test automation)
  // Skip unless _test label is present (stepwise testing mode)
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

  if (action === "review_requested") {
    const requestedReviewer = payload.requested_reviewer as { login: string };
    if (requestedReviewer.login !== "nopo-bot") {
      return emptyResult(true, "Reviewer is not nopo-bot");
    }

    if (pr.draft) {
      return emptyResult(true, "PR is a draft");
    }

    const issueSection = await buildIssueSection(
      octokit,
      owner,
      repo,
      pr.body ?? "",
    );

    // Extract issue number for logging review events to iteration history
    const issueNumber = await extractIssueNumber(pr.body ?? "");

    return {
      job: "pr-review",
      resourceType: "pr",
      resourceNumber: String(pr.number),
      commentId: "",
      contextJson: JSON.stringify({
        pr_number: String(pr.number),
        branch_name: pr.head.ref,
        issue_section: issueSection,
        issue_number: issueNumber,
      }),
      skip: false,
      skipReason: "",
    };
  }

  return emptyResult(true, `Unhandled PR action: ${action}`);
}

async function handlePullRequestReviewEvent(): Promise<DetectionResult> {
  const { context } = github;
  const payload = context.payload;
  const review = payload.review as {
    id: number;
    state: string;
    body: string;
    user: { login: string };
  };
  const pr = payload.pull_request as {
    number: number;
    title: string;
    draft: boolean;
    head: { ref: string };
    author: { login: string };
    labels: Array<{ name: string }>;
  };

  // Check for [TEST] in title (circuit breaker for test automation)
  // Skip unless _test label is present (stepwise testing mode)
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

  // Skip if PR is draft
  if (pr.draft) {
    return emptyResult(true, "PR is a draft");
  }

  const state = review.state.toLowerCase();

  // Only handle changes_requested or commented states
  if (state !== "changes_requested" && state !== "commented") {
    return emptyResult(true, `Review state is ${state}`);
  }

  // Extract issue number from branch name (claude/issue/XXX)
  const branchMatch = pr.head.ref.match(/^claude\/issue\/(\d+)$/);
  const issueNumber = branchMatch?.[1] ?? "";

  // Check if review is from Claude (pr-response) or human (pr-human-response)
  if (review.user.login === "claude[bot]") {
    return {
      job: "pr-response",
      resourceType: "pr",
      resourceNumber: String(pr.number),
      commentId: "",
      contextJson: JSON.stringify({
        pr_number: String(pr.number),
        branch_name: pr.head.ref,
        review_state: state,
        review_body: review.body ?? "",
        review_id: String(review.id),
        issue_number: issueNumber,
      }),
      skip: false,
      skipReason: "",
    };
  }

  // Human review - check if this is a Claude PR
  const isClaudePr =
    pr.author.login === "claude[bot]" || pr.head.ref.startsWith("claude/");
  if (!isClaudePr) {
    return emptyResult(true, "Human review on non-Claude PR");
  }

  return {
    job: "pr-human-response",
    resourceType: "pr",
    resourceNumber: String(pr.number),
    commentId: "",
    contextJson: JSON.stringify({
      pr_number: String(pr.number),
      branch_name: pr.head.ref,
      reviewer_login: review.user.login,
      review_state: state,
      review_body: review.body ?? "",
      review_id: String(review.id),
      issue_number: issueNumber,
    }),
    skip: false,
    skipReason: "",
  };
}

async function handleDiscussionEvent(): Promise<DetectionResult> {
  const { context } = github;
  const payload = context.payload;
  const action = payload.action as string;
  const discussion = payload.discussion as {
    number: number;
    title: string;
    body: string;
  };

  if (action === "created") {
    return {
      job: "discussion-research",
      resourceType: "discussion",
      resourceNumber: String(discussion.number),
      commentId: "",
      contextJson: JSON.stringify({
        discussion_number: String(discussion.number),
        discussion_title: discussion.title,
        discussion_body: discussion.body ?? "",
      }),
      skip: false,
      skipReason: "",
    };
  }

  return emptyResult(true, `Unhandled discussion action: ${action}`);
}

async function handleDiscussionCommentEvent(): Promise<DetectionResult> {
  const { context } = github;
  const payload = context.payload;
  const discussion = payload.discussion as {
    number: number;
    title: string;
    body: string;
  };
  const comment = payload.comment as {
    id: number;
    node_id: string;
    body: string;
    parent_id?: number;
    user: { login: string };
  };

  const body = comment.body.trim();
  const author = comment.user.login;
  const isTopLevel = !comment.parent_id;

  // Check for commands first (any author can use commands)
  if (body === "/summarize") {
    return {
      job: "discussion-summarize",
      resourceType: "discussion",
      resourceNumber: String(discussion.number),
      commentId: comment.node_id,
      contextJson: JSON.stringify({
        discussion_number: String(discussion.number),
      }),
      skip: false,
      skipReason: "",
    };
  }

  if (body === "/plan") {
    return {
      job: "discussion-plan",
      resourceType: "discussion",
      resourceNumber: String(discussion.number),
      commentId: comment.node_id,
      contextJson: JSON.stringify({
        discussion_number: String(discussion.number),
      }),
      skip: false,
      skipReason: "",
    };
  }

  if (body === "/complete") {
    return {
      job: "discussion-complete",
      resourceType: "discussion",
      resourceNumber: String(discussion.number),
      commentId: comment.node_id,
      contextJson: JSON.stringify({
        discussion_number: String(discussion.number),
      }),
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
      contextJson: JSON.stringify({
        discussion_number: String(discussion.number),
        comment_body: comment.body,
        comment_author: author,
      }),
      skip: false,
      skipReason: "",
    };
  }

  // Bot's top-level research thread - trigger investigation
  if (isTopLevel && comment.body.includes("## 🔍 Research:")) {
    return {
      job: "discussion-respond",
      resourceType: "discussion",
      resourceNumber: String(discussion.number),
      commentId: comment.node_id,
      contextJson: JSON.stringify({
        discussion_number: String(discussion.number),
        comment_body: comment.body,
        comment_author: author,
      }),
      skip: false,
      skipReason: "",
    };
  }

  // Skip bot's reply comments to prevent infinite loop
  return emptyResult(true, "Bot reply comment - preventing infinite loop");
}

async function run(): Promise<void> {
  try {
    const token = getRequiredInput("github_token");
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
        result = await handleDiscussionEvent();
        break;
      case "discussion_comment":
        result = await handleDiscussionCommentEvent();
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

    // Extract parent_issue from context_json for concurrency groups
    let parentIssue = "0";
    try {
      const ctx = JSON.parse(result.contextJson);
      if (ctx.parent_issue && ctx.parent_issue !== "0") {
        parentIssue = ctx.parent_issue;
      }
    } catch {
      // Ignore parse errors
    }

    setOutputs({
      job: result.job,
      resource_type: result.resourceType,
      resource_number: result.resourceNumber,
      parent_issue: parentIssue,
      comment_id: result.commentId,
      context_json: result.contextJson,
      skip: result.skip ? "true" : "false",
      skip_reason: result.skipReason,
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
