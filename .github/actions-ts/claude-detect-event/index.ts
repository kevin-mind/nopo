import * as core from "@actions/core";
import * as github from "@actions/github";
import { execCommand, getRequiredInput, setOutputs } from "../lib/index.js";

type Job =
  | "issue-triage"
  | "issue-implement"
  | "issue-comment"
  | "push-to-draft"
  | "ci-fix"
  | "ci-suggest"
  | "ci-success"
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

async function fetchIssueDetails(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<{ title: string; body: string; isSubIssue: boolean }> {
  // Use GraphQL to check for parent (sub-issue detection)
  const result = await octokit.graphql<{
    repository: {
      issue: {
        title: string;
        body: string;
        parent?: { number: number };
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
    return { title: "", body: "", isSubIssue: false };
  }

  return {
    title: issue.title,
    body: issue.body ?? "",
    isSubIssue: !!issue.parent,
  };
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

function isTestResource(title: string): boolean {
  return title.startsWith("[TEST]");
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

  // Check for [TEST] in title (circuit breaker for test automation)
  if (isTestResource(issue.title)) {
    return emptyResult(true, "Issue title starts with [TEST]");
  }

  // Check for test:automation label
  const hasTestLabel = issue.labels.some((l) => l.name === "test:automation");
  if (hasTestLabel) {
    return emptyResult(true, "Issue has test:automation label");
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
  if (
    action === "opened" ||
    action === "edited" ||
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

  // Handle implement: assigned to nopo-bot
  if (action === "assigned") {
    const assignee = payload.assignee as { login: string };
    if (assignee.login !== "nopo-bot") {
      return emptyResult(true, "Not assigned to nopo-bot");
    }

    const details = await fetchIssueDetails(octokit, owner, repo, issue.number);
    const branchName = `claude/issue/${issue.number}`;

    // Ensure the branch exists (create if not)
    await ensureBranchExists(branchName);

    return {
      job: "issue-implement",
      resourceType: "issue",
      resourceNumber: String(issue.number),
      commentId: "",
      contextJson: JSON.stringify({
        issue_number: String(issue.number),
        issue_title: details.title || issue.title,
        issue_body: details.body || issue.body,
        branch_name: branchName,
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

  // Check for [TEST] in title (circuit breaker for test automation)
  if (isTestResource(issue.title)) {
    return emptyResult(true, "Issue/PR title starts with [TEST]");
  }

  // Check for test:automation label
  const hasTestLabel = issue.labels.some((l) => l.name === "test:automation");
  if (hasTestLabel) {
    return emptyResult(true, "Issue has test:automation label");
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

    return {
      job: "issue-implement",
      resourceType: "issue",
      resourceNumber: String(issue.number),
      commentId: String(comment.id),
      contextJson: JSON.stringify({
        issue_number: String(issue.number),
        issue_title: details.title || issue.title,
        issue_body: details.body || issue.body,
        branch_name: branchName,
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

  // Check for [TEST] in title (circuit breaker for test automation)
  if (isTestResource(pr.title)) {
    return emptyResult(true, "PR title starts with [TEST]");
  }

  // Check for test:automation label
  const hasTestLabel = pr.labels.some((l) => l.name === "test:automation");
  if (hasTestLabel) {
    return emptyResult(true, "PR has test:automation label");
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
  if (isTestResource(prInfo.title)) {
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
  };

  const conclusion = workflowRun.conclusion;
  const branch = workflowRun.head_branch;

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
  if (isTestResource(prInfo.title)) {
    return emptyResult(true, "PR title starts with [TEST]");
  }

  if (conclusion === "failure") {
    const job: Job = prInfo.isClaudePr ? "ci-fix" : "ci-suggest";
    return {
      job,
      resourceType: "pr",
      resourceNumber: prInfo.prNumber,
      commentId: "",
      contextJson: JSON.stringify({
        pr_number: prInfo.prNumber,
        branch_name: branch,
      }),
      skip: false,
      skipReason: "",
    };
  }

  if (conclusion === "success") {
    return {
      job: "ci-success",
      resourceType: "pr",
      resourceNumber: prInfo.prNumber,
      commentId: "",
      contextJson: JSON.stringify({
        pr_number: prInfo.prNumber,
        branch_name: branch,
        is_claude_pr: prInfo.isClaudePr,
        issue_number: await extractIssueNumber(prInfo.body),
      }),
      skip: false,
      skipReason: "",
    };
  }

  return emptyResult(true, `Workflow run conclusion: ${conclusion}`);
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
  if (isTestResource(pr.title)) {
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

    return {
      job: "pr-review",
      resourceType: "pr",
      resourceNumber: String(pr.number),
      commentId: "",
      contextJson: JSON.stringify({
        pr_number: String(pr.number),
        branch_name: pr.head.ref,
        issue_section: issueSection,
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
  if (isTestResource(pr.title)) {
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

    setOutputs({
      job: result.job,
      resource_type: result.resourceType,
      resource_number: result.resourceNumber,
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
