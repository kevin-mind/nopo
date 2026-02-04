import * as core from "@actions/core";
import type {
  ApplyDiscussionResearchOutputAction,
  ApplyDiscussionRespondOutputAction,
  ApplyDiscussionSummarizeOutputAction,
  ApplyDiscussionPlanOutputAction,
} from "../../schemas/index.js";
import type { RunnerContext } from "../runner.js";
import { executeRunClaude } from "./claude.js";

// ============================================================================
// Investigation Types (for parallel thread investigation)
// ============================================================================

/**
 * Output from a single thread investigation
 */
interface ThreadInvestigationOutput {
  findings: string;
  key_points: string[];
  open_questions?: string[];
  recommendations?: string[];
  agent_notes?: string[];
}

// ============================================================================
// Discussion History Types and Helpers
// ============================================================================

const DISCUSSION_HISTORY_SECTION = "## Workflow History";

/**
 * Format a timestamp for display in history table
 */
function formatHistoryTimestamp(isoTimestamp?: string): string {
  if (!isoTimestamp) {
    // Use current time if not provided
    isoTimestamp = new Date().toISOString();
  }

  try {
    const date = new Date(isoTimestamp);
    if (isNaN(date.getTime())) return "-";

    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const month = months[date.getUTCMonth()];
    const day = date.getUTCDate();
    const hours = String(date.getUTCHours()).padStart(2, "0");
    const minutes = String(date.getUTCMinutes()).padStart(2, "0");

    return `${month} ${day} ${hours}:${minutes}`;
  } catch {
    return "-";
  }
}

/**
 * Extract run ID from a GitHub Actions run URL
 */
function extractRunIdFromUrl(url: string): string | null {
  const match = url.match(/\/actions\/runs\/(\d+)/);
  return match?.[1] ?? null;
}

/**
 * Create a history row for discussions
 * Format: | Time | Job | Result | Run |
 */
function createDiscussionHistoryRow(
  job: string,
  result: "success" | "failure" | "running",
  runUrl?: string,
  timestamp?: string,
): string {
  const time = formatHistoryTimestamp(timestamp);

  // Format result with emoji
  const resultDisplay = result === "success" ? "✅ Success"
    : result === "failure" ? "❌ Failure"
    : "🔄 Running";

  // Format run link
  let runCell = "-";
  if (runUrl) {
    const runId = extractRunIdFromUrl(runUrl);
    runCell = runId ? `[${runId}](${runUrl})` : `[Run](${runUrl})`;
  }

  return `| ${time} | ${job} | ${resultDisplay} | ${runCell} |`;
}

/**
 * Add a history entry to a discussion body
 * Creates the history section if it doesn't exist
 */
function addDiscussionHistoryEntry(
  body: string,
  job: string,
  result: "success" | "failure" | "running",
  runUrl?: string,
  timestamp?: string,
): string {
  const newRow = createDiscussionHistoryRow(job, result, runUrl, timestamp);

  const historyIdx = body.indexOf(DISCUSSION_HISTORY_SECTION);

  if (historyIdx === -1) {
    // No history section - create new one at the end
    return `${body}

${DISCUSSION_HISTORY_SECTION}

| Time | Job | Result | Run |
|------|-----|--------|-----|
${newRow}`;
  }

  // Find the end of the history table
  const lines = body.split("\n");
  const historyLineIdx = lines.findIndex((l) => l.includes(DISCUSSION_HISTORY_SECTION));

  // Find the last table row
  let lastTableRowIdx = historyLineIdx;
  for (let i = historyLineIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line?.startsWith("|")) {
      lastTableRowIdx = i;
    } else if (line?.trim() !== "" && !line?.startsWith("|")) {
      // Hit non-table content
      break;
    }
  }

  // Insert new row after the last table row
  const beforeRows = lines.slice(0, lastTableRowIdx + 1);
  const afterRows = lines.slice(lastTableRowIdx + 1);

  return [...beforeRows, newRow, ...afterRows].join("\n");
}

// ============================================================================
// GraphQL Mutations
// ============================================================================

const ADD_DISCUSSION_COMMENT_MUTATION = `
mutation AddDiscussionComment($discussionId: ID!, $body: String!) {
  addDiscussionComment(input: {
    discussionId: $discussionId
    body: $body
  }) {
    comment {
      id
      body
    }
  }
}
`;

const ADD_DISCUSSION_REPLY_MUTATION = `
mutation AddDiscussionReply($discussionId: ID!, $replyToId: ID!, $body: String!) {
  addDiscussionComment(input: {
    discussionId: $discussionId
    replyToId: $replyToId
    body: $body
  }) {
    comment {
      id
      body
    }
  }
}
`;

const UPDATE_DISCUSSION_MUTATION = `
mutation UpdateDiscussion($discussionId: ID!, $body: String!) {
  updateDiscussion(input: {
    discussionId: $discussionId
    body: $body
  }) {
    discussion {
      id
      body
    }
  }
}
`;

const GET_REPO_ID_QUERY = `
query GetRepoId($owner: String!, $repo: String!) {
  repository(owner: $owner, name: $repo) {
    id
  }
}
`;

const CREATE_ISSUE_MUTATION = `
mutation CreateIssue($repositoryId: ID!, $title: String!, $body: String!) {
  createIssue(input: { repositoryId: $repositoryId, title: $title, body: $body }) {
    issue {
      id
      number
    }
  }
}
`;

const GET_LABEL_IDS_QUERY = `
query GetLabelIds($owner: String!, $repo: String!) {
  repository(owner: $owner, name: $repo) {
    labels(first: 100) {
      nodes {
        id
        name
      }
    }
  }
}
`;

const ADD_LABELS_MUTATION = `
mutation AddLabelsToLabelable($labelableId: ID!, $labelIds: [ID!]!) {
  addLabelsToLabelable(input: { labelableId: $labelableId, labelIds: $labelIds }) {
    labelable {
      __typename
    }
  }
}
`;

// ============================================================================
// Types
// ============================================================================

interface AddCommentResponse {
  addDiscussionComment?: {
    comment?: {
      id?: string;
      body?: string;
    };
  };
}

interface UpdateDiscussionResponse {
  updateDiscussion?: {
    discussion?: {
      id?: string;
      body?: string;
    };
  };
}

interface RepoIdResponse {
  repository?: {
    id?: string;
  };
}

interface CreateIssueResponse {
  createIssue?: {
    issue?: {
      id?: string;
      number?: number;
    };
  };
}

interface LabelsResponse {
  repository?: {
    labels?: {
      nodes?: Array<{
        id?: string;
        name?: string;
      }>;
    };
  };
}

/**
 * Research thread from structured output
 * Note: Field names must match outputs.json schema
 */
interface ResearchThread {
  title: string;
  question: string;
  investigation_areas: string[];
  expected_deliverables: string[];
}

/**
 * Research output structured schema
 * Note: Field names must match outputs.json schema
 */
interface DiscussionResearchOutput {
  threads: ResearchThread[];
  updated_body?: string;
  agent_notes?: string[];
}

/**
 * Respond output structured schema
 * Note: Field names must match outputs.json schema
 */
interface DiscussionRespondOutput {
  response_body: string;
  updated_body?: string;
  agent_notes?: string[];
}

/**
 * Summarize output structured schema
 * Note: Field names must match outputs.json schema
 */
interface DiscussionSummarizeOutput {
  summary_comment: string;
  updated_body: string;
  agent_notes?: string[];
}

/**
 * Issue definition for plan output
 */
interface PlannedIssue {
  title: string;
  body: string;
  labels?: string[];
}

/**
 * Plan output structured schema
 * Note: Field names must match outputs.json schema
 */
interface DiscussionPlanOutput {
  issues: PlannedIssue[];
  updated_body: string;
  summary_comment: string;
  agent_notes?: string[];
}

// ============================================================================
// Executors
// ============================================================================

/**
 * Apply discussion research output
 *
 * Creates research thread comments from Claude's analysis, then immediately
 * investigates all threads in parallel (like grooming), posts findings as
 * replies, and updates the discussion body with a summary at the end.
 *
 * Flow:
 * 1. Create research thread comments
 * 2. Investigate all threads in parallel (Promise.all)
 * 3. Post findings as replies to each thread
 * 4. Update discussion body with comprehensive summary
 */
export async function executeApplyDiscussionResearchOutput(
  action: ApplyDiscussionResearchOutputAction,
  ctx: RunnerContext,
  structuredOutput?: unknown,
): Promise<{ applied: boolean; threadIds: string[]; replyIds: string[] }> {
  const { discussionNumber, discussionNodeId, promptVars } = action;

  if (!structuredOutput) {
    core.warning(
      "No structured output provided for applyDiscussionResearchOutput",
    );
    return { applied: false, threadIds: [], replyIds: [] };
  }

  const output = structuredOutput as DiscussionResearchOutput;

  core.info(`Processing research output for discussion #${discussionNumber}`);
  core.startGroup("Research Output");
  core.info(JSON.stringify(output, null, 2));
  core.endGroup();

  if (ctx.dryRun) {
    core.info(
      `[DRY RUN] Would create ${output.threads?.length ?? 0} research threads and investigate them`,
    );
    return { applied: true, threadIds: [], replyIds: [] };
  }

  const threadIds: string[] = [];

  // =========================================================================
  // Step 1: Create research thread comments
  // =========================================================================
  core.info("Step 1: Creating research thread comments");

  interface CreatedThread {
    commentNodeId: string;
    title: string;
    question: string;
    investigationAreas: string[];
    expectedDeliverables: string[];
  }
  const createdThreads: CreatedThread[] = [];

  for (const thread of output.threads || []) {
    // Format the thread body from the schema fields
    const areas = thread.investigation_areas?.map((a) => `- ${a}`).join("\n") || "";
    const deliverables = thread.expected_deliverables?.map((d) => `- ${d}`).join("\n") || "";

    const body = `## 🔍 Research: ${thread.title}

**Question:** ${thread.question}

### Investigation Areas
${areas}

### Expected Deliverables
${deliverables}`;

    const response = await ctx.octokit.graphql<AddCommentResponse>(
      ADD_DISCUSSION_COMMENT_MUTATION,
      {
        discussionId: discussionNodeId,
        body,
      },
    );

    const commentId = response.addDiscussionComment?.comment?.id;
    if (commentId) {
      threadIds.push(commentId);
      createdThreads.push({
        commentNodeId: commentId,
        title: thread.title,
        question: thread.question,
        investigationAreas: thread.investigation_areas || [],
        expectedDeliverables: thread.expected_deliverables || [],
      });
      core.info(`Created research thread: ${thread.title}`);
    }
  }

  // =========================================================================
  // Step 2: Investigate all threads in parallel (like grooming)
  // =========================================================================
  core.info(`Step 2: Investigating ${createdThreads.length} threads in parallel`);

  const replyIds: string[] = [];

  const investigationResults = await Promise.all(
    createdThreads.map(async (thread) => {
      core.info(`Starting investigation: ${thread.title}`);
      try {
        // Build prompt variables for this specific thread
        const threadPromptVars: Record<string, string> = {
          ...promptVars,
          DISCUSSION_NUMBER: String(discussionNumber),
          THREAD_TITLE: thread.title,
          THREAD_QUESTION: thread.question,
          INVESTIGATION_AREAS: thread.investigationAreas.join("\n- "),
          EXPECTED_DELIVERABLES: thread.expectedDeliverables.join("\n- "),
        };

        // Run Claude investigation
        const result = await executeRunClaude(
          {
            type: "runClaude",
            token: "code",
            promptDir: "investigate",
            promptsDir: ".github/statemachine/discussion/prompts",
            promptVars: threadPromptVars,
            issueNumber: discussionNumber,
            worktree: "main",
          },
          ctx,
        );

        const investigationOutput = result.structuredOutput as ThreadInvestigationOutput | undefined;

        if (!investigationOutput || !investigationOutput.findings) {
          throw new Error("Investigation did not return findings");
        }

        core.info(`Investigation completed: ${thread.title}`);
        return { thread, output: investigationOutput, success: true };
      } catch (error) {
        core.warning(`Investigation failed for "${thread.title}": ${error}`);
        return {
          thread,
          output: null,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );

  // =========================================================================
  // Step 3: Post findings as replies to each thread
  // =========================================================================
  core.info("Step 3: Posting investigation findings as replies");

  for (const result of investigationResults) {
    let replyBody: string;

    if (result.success && result.output) {
      // Format successful findings
      replyBody = formatInvestigationFindings(result.thread.title, result.output);
    } else {
      // Format error message
      replyBody = `## ⚠️ Investigation Error: ${result.thread.title}

Unable to complete investigation for this research thread.

**Error:** ${result.error || "Unknown error"}

Please retry or investigate manually.`;
    }

    try {
      const response = await ctx.octokit.graphql<AddCommentResponse>(
        ADD_DISCUSSION_REPLY_MUTATION,
        {
          discussionId: discussionNodeId,
          replyToId: result.thread.commentNodeId,
          body: replyBody,
        },
      );

      const replyId = response.addDiscussionComment?.comment?.id;
      if (replyId) {
        replyIds.push(replyId);
        core.info(`Posted findings for: ${result.thread.title}`);
      }
    } catch (error) {
      core.warning(`Failed to post findings for "${result.thread.title}": ${error}`);
    }
  }

  // =========================================================================
  // Step 4: Update discussion body with comprehensive summary + history
  // =========================================================================
  core.info("Step 4: Updating discussion body with summary");

  // Fetch current discussion body to preserve history
  const currentBodyResponse = await ctx.octokit.graphql<{ repository?: { discussion?: { body?: string } } }>(
    `query GetDiscussionBody($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        discussion(number: $number) {
          body
        }
      }
    }`,
    {
      owner: ctx.owner,
      repo: ctx.repo,
      number: discussionNumber,
    },
  );
  const currentBody = currentBodyResponse.repository?.discussion?.body || "";

  // Build summary content
  const summaryContent = buildDiscussionSummary(output, investigationResults);

  // Extract existing history section if present
  const historyIdx = currentBody.indexOf(DISCUSSION_HISTORY_SECTION);
  let historySection = "";
  if (historyIdx !== -1) {
    // Extract from history section to end
    historySection = currentBody.slice(historyIdx);
  }

  // Build new body: summary content + preserved history + new history entry
  let newBody = summaryContent;
  if (historySection) {
    // Append preserved history
    newBody += "\n\n" + historySection;
  }

  // Add new history entry for this job
  const successCount = investigationResults.filter((r) => r.success).length;
  const failCount = investigationResults.filter((r) => !r.success).length;
  const result: "success" | "failure" = failCount === 0 ? "success" : "failure";
  const jobDescription = `Research: ${successCount}/${investigationResults.length} threads investigated`;

  newBody = addDiscussionHistoryEntry(newBody, jobDescription, result, ctx.runUrl);

  await ctx.octokit.graphql<UpdateDiscussionResponse>(
    UPDATE_DISCUSSION_MUTATION,
    {
      discussionId: discussionNodeId,
      body: newBody,
    },
  );
  core.info("Updated discussion body with summary and history");

  return { applied: true, threadIds, replyIds };
}

/**
 * Format investigation findings for posting as a reply
 */
function formatInvestigationFindings(
  title: string,
  output: ThreadInvestigationOutput,
): string {
  let body = `## 📊 Findings: ${title}

${output.findings}

### Key Points
${output.key_points.map((p) => `- ${p}`).join("\n")}`;

  if (output.recommendations && output.recommendations.length > 0) {
    body += `

### Recommendations
${output.recommendations.map((r) => `- ${r}`).join("\n")}`;
  }

  if (output.open_questions && output.open_questions.length > 0) {
    body += `

### Open Questions
${output.open_questions.map((q) => `- ${q}`).join("\n")}`;
  }

  return body;
}

/**
 * Build a comprehensive summary for the discussion body
 */
function buildDiscussionSummary(
  researchOutput: DiscussionResearchOutput,
  investigationResults: Array<{
    thread: { title: string };
    output: ThreadInvestigationOutput | null;
    success: boolean;
  }>,
): string {
  const successfulInvestigations = investigationResults.filter((r) => r.success && r.output);
  const failedInvestigations = investigationResults.filter((r) => !r.success);

  // Collect all key points from successful investigations
  const allKeyPoints = successfulInvestigations.flatMap(
    (r) => r.output?.key_points.map((p) => `- **${r.thread.title}:** ${p}`) || [],
  );

  // Collect all open questions
  const allOpenQuestions = successfulInvestigations.flatMap(
    (r) => r.output?.open_questions?.map((q) => `- **${r.thread.title}:** ${q}`) || [],
  );

  // Collect all recommendations
  const allRecommendations = successfulInvestigations.flatMap(
    (r) => r.output?.recommendations?.map((rec) => `- **${r.thread.title}:** ${rec}`) || [],
  );

  let summary = `## Research Summary

*Last updated: ${new Date().toISOString()}*

### Research Threads (${researchOutput.threads?.length || 0})

${researchOutput.threads?.map((t) => `- 🔍 **${t.title}**: ${t.question}`).join("\n") || "No threads"}

### Investigation Status

- ✅ Completed: ${successfulInvestigations.length}
- ❌ Failed: ${failedInvestigations.length}

### Key Findings

${allKeyPoints.length > 0 ? allKeyPoints.join("\n") : "No key findings yet."}`;

  if (allRecommendations.length > 0) {
    summary += `

### Recommendations

${allRecommendations.join("\n")}`;
  }

  if (allOpenQuestions.length > 0) {
    summary += `

### Open Questions

${allOpenQuestions.join("\n")}`;
  }

  // Add original discussion context if available
  if (researchOutput.agent_notes && researchOutput.agent_notes.length > 0) {
    summary += `

### Agent Notes

${researchOutput.agent_notes.map((n) => `- ${n}`).join("\n")}`;
  }

  return summary;
}

/**
 * Apply discussion respond output
 *
 * Posts a response comment, optionally as a reply to a thread.
 */
export async function executeApplyDiscussionRespondOutput(
  action: ApplyDiscussionRespondOutputAction,
  ctx: RunnerContext,
  structuredOutput?: unknown,
): Promise<{ applied: boolean; commentId?: string }> {
  const { discussionNumber, discussionNodeId, replyToNodeId } = action;

  if (!structuredOutput) {
    core.warning(
      "No structured output provided for applyDiscussionRespondOutput",
    );
    return { applied: false };
  }

  const output = structuredOutput as DiscussionRespondOutput;

  core.info(`Processing respond output for discussion`);
  core.startGroup("Respond Output");
  core.info(JSON.stringify(output, null, 2));
  core.endGroup();

  if (ctx.dryRun) {
    core.info("[DRY RUN] Would post response comment");
    return { applied: true };
  }

  let response: AddCommentResponse;

  if (replyToNodeId) {
    // Reply to existing comment (thread)
    response = await ctx.octokit.graphql<AddCommentResponse>(
      ADD_DISCUSSION_REPLY_MUTATION,
      {
        discussionId: discussionNodeId,
        replyToId: replyToNodeId,
        body: output.response_body,
      },
    );
  } else {
    // Top-level comment
    response = await ctx.octokit.graphql<AddCommentResponse>(
      ADD_DISCUSSION_COMMENT_MUTATION,
      {
        discussionId: discussionNodeId,
        body: output.response_body,
      },
    );
  }

  const commentId = response.addDiscussionComment?.comment?.id;
  core.info(`Posted ${replyToNodeId ? "reply" : "comment"} to discussion`);

  // Fetch current discussion body to preserve history
  const currentBodyResponse = await ctx.octokit.graphql<{ repository?: { discussion?: { body?: string } } }>(
    `query GetDiscussionBody($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        discussion(number: $number) {
          body
        }
      }
    }`,
    {
      owner: ctx.owner,
      repo: ctx.repo,
      number: discussionNumber,
    },
  );
  let currentBody = currentBodyResponse.repository?.discussion?.body || "";

  // Update discussion body if provided, preserving history
  if (output.updated_body) {
    // Extract existing history section if present
    const historyIdx = currentBody.indexOf(DISCUSSION_HISTORY_SECTION);
    let historySection = "";
    if (historyIdx !== -1) {
      historySection = currentBody.slice(historyIdx);
    }

    // Build new body with preserved history
    let newBody = output.updated_body;
    if (historySection) {
      newBody += "\n\n" + historySection;
    }

    // Add history entry
    newBody = addDiscussionHistoryEntry(newBody, "Respond: Posted reply", "success", ctx.runUrl);

    await ctx.octokit.graphql<UpdateDiscussionResponse>(
      UPDATE_DISCUSSION_MUTATION,
      {
        discussionId: discussionNodeId,
        body: newBody,
      },
    );
    core.info("Updated discussion body with history");
  } else {
    // Just add history entry to existing body
    currentBody = addDiscussionHistoryEntry(currentBody, "Respond: Posted reply", "success", ctx.runUrl);
    await ctx.octokit.graphql<UpdateDiscussionResponse>(
      UPDATE_DISCUSSION_MUTATION,
      {
        discussionId: discussionNodeId,
        body: currentBody,
      },
    );
    core.info("Added history entry to discussion body");
  }

  return { applied: true, commentId };
}

/**
 * Apply discussion summarize output
 *
 * Updates the discussion body with a comprehensive summary.
 */
export async function executeApplyDiscussionSummarizeOutput(
  action: ApplyDiscussionSummarizeOutputAction,
  ctx: RunnerContext,
  structuredOutput?: unknown,
): Promise<{ applied: boolean }> {
  const { discussionNumber, discussionNodeId } = action;

  if (!structuredOutput) {
    core.warning(
      "No structured output provided for applyDiscussionSummarizeOutput",
    );
    return { applied: false };
  }

  const output = structuredOutput as DiscussionSummarizeOutput;

  core.info(`Processing summarize output for discussion #${discussionNumber}`);
  core.startGroup("Summarize Output");
  core.info(JSON.stringify(output, null, 2));
  core.endGroup();

  if (ctx.dryRun) {
    core.info("[DRY RUN] Would update discussion body with summary");
    return { applied: true };
  }

  // Fetch current discussion body to preserve history
  const currentBodyResponse = await ctx.octokit.graphql<{ repository?: { discussion?: { body?: string } } }>(
    `query GetDiscussionBody($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        discussion(number: $number) {
          body
        }
      }
    }`,
    {
      owner: ctx.owner,
      repo: ctx.repo,
      number: discussionNumber,
    },
  );
  const currentBody = currentBodyResponse.repository?.discussion?.body || "";

  // Extract existing history section if present
  const historyIdx = currentBody.indexOf(DISCUSSION_HISTORY_SECTION);
  let historySection = "";
  if (historyIdx !== -1) {
    historySection = currentBody.slice(historyIdx);
  }

  // Build new body with preserved history
  let newBody = output.updated_body;
  if (historySection) {
    newBody += "\n\n" + historySection;
  }

  // Add history entry
  newBody = addDiscussionHistoryEntry(newBody, "Summarize: Updated body", "success", ctx.runUrl);

  // Update discussion body with summary + history
  await ctx.octokit.graphql<UpdateDiscussionResponse>(
    UPDATE_DISCUSSION_MUTATION,
    {
      discussionId: discussionNodeId,
      body: newBody,
    },
  );

  core.info("Updated discussion body with summary and history");

  // Post summary as a comment as well
  await ctx.octokit.graphql<AddCommentResponse>(
    ADD_DISCUSSION_COMMENT_MUTATION,
    {
      discussionId: discussionNodeId,
      body: `## Summary

${output.summary_comment}`,
    },
  );

  core.info("Posted summary comment");

  return { applied: true };
}

/**
 * Apply discussion plan output
 *
 * Creates issues from the plan and posts a summary comment.
 */
export async function executeApplyDiscussionPlanOutput(
  action: ApplyDiscussionPlanOutputAction,
  ctx: RunnerContext,
  structuredOutput?: unknown,
): Promise<{ applied: boolean; issueNumbers: number[] }> {
  const { discussionNumber, discussionNodeId } = action;

  if (!structuredOutput) {
    core.warning("No structured output provided for applyDiscussionPlanOutput");
    return { applied: false, issueNumbers: [] };
  }

  const output = structuredOutput as DiscussionPlanOutput;

  core.info(`Processing plan output for discussion #${discussionNumber}`);
  core.startGroup("Plan Output");
  core.info(JSON.stringify(output, null, 2));
  core.endGroup();

  if (ctx.dryRun) {
    core.info(`[DRY RUN] Would create ${output.issues?.length ?? 0} issues`);
    return { applied: true, issueNumbers: [] };
  }

  // Get repository ID
  const repoResponse = await ctx.octokit.graphql<RepoIdResponse>(
    GET_REPO_ID_QUERY,
    {
      owner: ctx.owner,
      repo: ctx.repo,
    },
  );

  const repoId = repoResponse.repository?.id;
  if (!repoId) {
    throw new Error("Repository not found");
  }

  // Get label map
  const labelsResponse = await ctx.octokit.graphql<LabelsResponse>(
    GET_LABEL_IDS_QUERY,
    {
      owner: ctx.owner,
      repo: ctx.repo,
    },
  );

  const labelMap = new Map<string, string>();
  for (const label of labelsResponse.repository?.labels?.nodes || []) {
    if (label.id && label.name) {
      labelMap.set(label.name.toLowerCase(), label.id);
    }
  }

  const issueNumbers: number[] = [];

  // Create issues
  for (const issue of output.issues || []) {
    const bodyWithRef = `${issue.body}

---
*Created from discussion #${discussionNumber}*`;

    const createResponse = await ctx.octokit.graphql<CreateIssueResponse>(
      CREATE_ISSUE_MUTATION,
      {
        repositoryId: repoId,
        title: issue.title,
        body: bodyWithRef,
      },
    );

    const issueId = createResponse.createIssue?.issue?.id;
    const issueNum = createResponse.createIssue?.issue?.number;

    if (!issueId || !issueNum) {
      core.warning(`Failed to create issue: ${issue.title}`);
      continue;
    }

    // Add labels if specified
    if (issue.labels && issue.labels.length > 0) {
      const labelIds = issue.labels
        .map((name) => labelMap.get(name.toLowerCase()))
        .filter((id): id is string => id !== undefined);

      if (labelIds.length > 0) {
        await ctx.octokit.graphql(ADD_LABELS_MUTATION, {
          labelableId: issueId,
          labelIds,
        });
      }
    }

    issueNumbers.push(issueNum);
    core.info(`Created issue #${issueNum}: ${issue.title}`);
  }

  // Post summary comment with links to created issues
  const issueLinks = issueNumbers.map((n) => `- #${n}`).join("\n");
  const summaryBody = `## Implementation Plan

${output.summary_comment}

### Created Issues

${issueLinks}`;

  await ctx.octokit.graphql<AddCommentResponse>(
    ADD_DISCUSSION_COMMENT_MUTATION,
    {
      discussionId: discussionNodeId,
      body: summaryBody,
    },
  );

  core.info(`Posted plan summary with ${issueNumbers.length} issue links`);

  // Update discussion body with history entry
  const currentBodyResponse = await ctx.octokit.graphql<{ repository?: { discussion?: { body?: string } } }>(
    `query GetDiscussionBody($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        discussion(number: $number) {
          body
        }
      }
    }`,
    {
      owner: ctx.owner,
      repo: ctx.repo,
      number: discussionNumber,
    },
  );
  let currentBody = currentBodyResponse.repository?.discussion?.body || "";

  // Extract existing history section if present
  const historyIdx = currentBody.indexOf(DISCUSSION_HISTORY_SECTION);
  let historySection = "";
  if (historyIdx !== -1) {
    historySection = currentBody.slice(historyIdx);
  }

  // Build new body with preserved history + updated_body if provided
  let newBody = output.updated_body || currentBody.slice(0, historyIdx !== -1 ? historyIdx : undefined).trim();
  if (historySection) {
    newBody += "\n\n" + historySection;
  }

  // Add history entry
  const jobDescription = `Plan: Created ${issueNumbers.length} issues (${issueNumbers.map(n => `#${n}`).join(", ")})`;
  newBody = addDiscussionHistoryEntry(newBody, jobDescription, "success", ctx.runUrl);

  await ctx.octokit.graphql<UpdateDiscussionResponse>(
    UPDATE_DISCUSSION_MUTATION,
    {
      discussionId: discussionNodeId,
      body: newBody,
    },
  );

  core.info("Updated discussion body with history");

  return { applied: true, issueNumbers };
}
