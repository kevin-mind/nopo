import type {
  MachineContext,
  Action,
  ProjectStatus,
  IssueComment,
} from "../schemas/index.js";
import { deriveBranchName } from "../parser/index.js";

/**
 * Format issue comments for inclusion in prompts
 */
export function formatCommentsForPrompt(comments: IssueComment[]): string {
  if (comments.length === 0) {
    return "No comments yet.";
  }
  return comments
    .map((c) => `### ${c.author} (${c.createdAt})\n${c.body}`)
    .join("\n\n---\n\n");
}

/**
 * Action context type for XState actions
 */
interface ActionContext {
  context: MachineContext;
}

/**
 * Action result - actions to execute
 */
type ActionResult = Action[];

// ============================================================================
// Project Status Actions
// ============================================================================

/**
 * Emit action to set status to In progress (for sub-issues being worked on)
 */
export function emitSetWorking({ context }: ActionContext): ActionResult {
  const issueNumber = context.currentSubIssue?.number ?? context.issue.number;
  return [
    {
      type: "updateProjectStatus",
      token: "code",
      issueNumber,
      status: "In progress" as ProjectStatus,
    },
  ];
}

/**
 * Emit action to set status to Review
 */
export function emitSetReview({ context }: ActionContext): ActionResult {
  const issueNumber = context.currentSubIssue?.number ?? context.issue.number;
  return [
    {
      type: "updateProjectStatus",
      token: "code",
      issueNumber,
      status: "In review" as ProjectStatus,
    },
  ];
}

/**
 * Emit action to set parent status to In Progress
 */
export function emitSetInProgress({ context }: ActionContext): ActionResult {
  return [
    {
      type: "updateProjectStatus",
      token: "code",
      issueNumber: context.issue.number,
      status: "In progress" as ProjectStatus,
    },
  ];
}

/**
 * Emit action to set status to Done
 */
export function emitSetDone({ context }: ActionContext): ActionResult {
  return [
    {
      type: "updateProjectStatus",
      token: "code",
      issueNumber: context.issue.number,
      status: "Done" as ProjectStatus,
    },
  ];
}

/**
 * Emit action to set status to Blocked
 */
export function emitSetBlocked({ context }: ActionContext): ActionResult {
  return [
    {
      type: "updateProjectStatus",
      token: "code",
      issueNumber: context.issue.number,
      status: "Blocked" as ProjectStatus,
    },
  ];
}

// ============================================================================
// Iteration/Failure Actions
// ============================================================================

/**
 * Emit action to increment iteration counter
 */
export function emitIncrementIteration({
  context,
}: ActionContext): ActionResult {
  return [
    {
      type: "incrementIteration",
      token: "code",
      issueNumber: context.issue.number,
    },
  ];
}

/**
 * Emit action to record a failure
 */
export function emitRecordFailure({ context }: ActionContext): ActionResult {
  return [
    {
      type: "recordFailure",
      token: "code",
      issueNumber: context.issue.number,
      failureType: "ci" as const,
    },
  ];
}

/**
 * Emit action to clear failures
 */
export function emitClearFailures({ context }: ActionContext): ActionResult {
  return [
    {
      type: "clearFailures",
      token: "code",
      issueNumber: context.issue.number,
    },
  ];
}

// ============================================================================
// Issue Actions
// ============================================================================

/**
 * Emit action to close the issue
 */
export function emitCloseIssue({ context }: ActionContext): ActionResult {
  return [
    {
      type: "closeIssue",
      token: "code",
      issueNumber: context.issue.number,
      reason: "completed" as const,
    },
  ];
}

/**
 * Emit action to unassign bot from issue
 */
export function emitUnassign({ context }: ActionContext): ActionResult {
  return [
    {
      type: "unassignUser",
      token: "code",
      issueNumber: context.issue.number,
      username: context.botUsername,
    },
  ];
}

/**
 * Emit action to block the issue
 */
function emitBlock({ context }: ActionContext): ActionResult {
  return [
    {
      type: "block",
      token: "code",
      issueNumber: context.issue.number,
      reason: `Max failures (${context.maxRetries}) reached`,
    },
  ];
}

/**
 * Emit actions to reset the issue (and sub-issues) to initial state
 * This is triggered by /reset command
 *
 * Resets:
 * - Reopens closed issues
 * - Unassigns bot
 * - Sets status to Backlog
 * - Clears failure counter
 *
 * Note: Iteration counter is not reset (no setIteration action exists yet)
 */
export function emitResetIssue({ context }: ActionContext): ActionResult {
  const actions: ActionResult = [
    {
      type: "resetIssue",
      token: "code",
      issueNumber: context.issue.number,
      subIssueNumbers: context.issue.subIssues.map((s) => s.number),
      botUsername: context.botUsername,
    },
    {
      type: "updateProjectStatus",
      token: "code",
      issueNumber: context.issue.number,
      status: "Backlog",
    },
    {
      type: "clearFailures",
      token: "code",
      issueNumber: context.issue.number,
    },
  ];

  // Also reset sub-issues to Ready status
  for (const subIssue of context.issue.subIssues) {
    actions.push({
      type: "updateProjectStatus",
      token: "code",
      issueNumber: subIssue.number,
      status: "Ready",
    });
    actions.push({
      type: "clearFailures",
      token: "code",
      issueNumber: subIssue.number,
    });
  }

  return actions;
}

// ============================================================================
// History Actions
// ============================================================================

/**
 * Emit action to append to iteration history
 */
function emitAppendHistory(
  { context }: ActionContext,
  message: string,
  phase?: string | number,
): ActionResult {
  const phaseStr = phase ?? context.currentPhase ?? "-";
  return [
    {
      type: "appendHistory",
      token: "code",
      issueNumber: context.issue.number,
      iteration: context.issue.iteration,
      phase: String(phaseStr),
      message,
      timestamp: context.workflowStartedAt ?? undefined,
      commitSha: context.ciCommitSha ?? undefined,
      runLink: context.ciRunUrl ?? undefined,
    },
  ];
}

/**
 * Emit action to log CI failure
 */
function emitLogCIFailure({ context }: ActionContext): ActionResult {
  return [
    {
      type: "updateHistory",
      token: "code",
      issueNumber: context.issue.number,
      matchIteration: context.issue.iteration,
      matchPhase: String(context.currentPhase ?? "-"),
      matchPattern: "⏳",
      newMessage: "❌ CI Failed",
      timestamp: context.workflowStartedAt ?? undefined,
      commitSha: context.ciCommitSha ?? undefined,
      runLink: context.ciRunUrl ?? undefined,
    },
  ];
}

// ============================================================================
// Git/Branch Actions
// ============================================================================

/**
 * Emit action to create/prepare branch (idempotent with rebase)
 */
export function emitCreateBranch({ context }: ActionContext): ActionResult {
  const branchName =
    context.branch ??
    deriveBranchName(context.issue.number, context.currentPhase ?? undefined);
  return [
    {
      type: "createBranch",
      token: "code",
      branchName,
      baseBranch: "main",
      // createBranch needs to run from main to create the new branch
      worktree: "main",
    },
  ];
}

// ============================================================================
// PR Actions
// ============================================================================

/**
 * Emit action to create PR (as draft)
 * Only emits if no PR already exists for this branch
 */
export function emitCreatePR({ context }: ActionContext): ActionResult {
  // Don't create PR if one already exists
  if (context.pr) {
    return [];
  }

  const branchName =
    context.branch ??
    deriveBranchName(context.issue.number, context.currentPhase ?? undefined);
  const issueNumber = context.currentSubIssue?.number ?? context.issue.number;

  return [
    {
      type: "createPR",
      token: "code",
      title: context.currentSubIssue?.title ?? context.issue.title,
      body: `Fixes #${issueNumber}`,
      branchName,
      baseBranch: "main",
      draft: true,
      issueNumber,
    },
  ];
}

/**
 * Emit action to mark PR as ready for review
 */
export function emitMarkReady({ context }: ActionContext): ActionResult {
  if (!context.pr) {
    return [];
  }
  return [
    {
      type: "markPRReady",
      token: "code",
      prNumber: context.pr.number,
    },
  ];
}

/**
 * Emit action to convert PR to draft
 */
export function emitConvertToDraft({ context }: ActionContext): ActionResult {
  if (!context.pr) {
    return [];
  }
  return [
    {
      type: "convertPRToDraft",
      token: "code",
      prNumber: context.pr.number,
    },
  ];
}

/**
 * Emit action to request review
 * Note: Uses nopo-reviewer account, not botUsername (nopo-bot),
 * because GitHub doesn't allow PR authors to request themselves as reviewers.
 */
export function emitRequestReview({ context }: ActionContext): ActionResult {
  if (!context.pr) {
    return [];
  }
  return [
    {
      type: "requestReview",
      token: "code",
      prNumber: context.pr.number,
      reviewer: "nopo-reviewer",
    },
  ];
}

/**
 * Emit action to mark PR as ready for merge
 * Called when review is approved - adds label and history entry
 * Actual merge is a human action (or test runner simulation)
 */
export function emitMergePR({ context }: ActionContext): ActionResult {
  if (!context.pr) {
    return [];
  }
  const issueNumber = context.currentSubIssue?.number ?? context.issue.number;
  return [
    {
      type: "mergePR",
      token: "code",
      prNumber: context.pr.number,
      issueNumber,
      mergeMethod: "squash",
    },
  ];
}

// ============================================================================
// Claude Actions
// ============================================================================

/**
 * Build prompt variables for the iterate.txt template
 */
function buildIteratePromptVars(
  context: MachineContext,
  ciResultOverride?: string,
): Record<string, string> {
  const issueNumber = context.currentSubIssue?.number ?? context.issue.number;
  const issueTitle = context.currentSubIssue?.title ?? context.issue.title;
  const branchName =
    context.branch ??
    deriveBranchName(context.issue.number, context.currentPhase ?? undefined);
  const iteration = context.issue.iteration;
  const failures = context.issue.failures;
  const ciResult = ciResultOverride ?? context.ciResult ?? "first";

  const isSubIssue =
    context.parentIssue !== null && context.currentPhase !== null;
  const parentIssueNumber = context.parentIssue?.number;
  const phaseNumber = context.currentPhase;

  // Generate conditional sections as complete strings
  const parentContext = isSubIssue
    ? `- **Parent Issue**: #${parentIssueNumber}
- **Phase**: ${phaseNumber}

> This is a sub-issue. Focus only on todos here. PR must reference both this issue and parent.`
    : "";

  const prCreateCommand = isSubIssue
    ? `\`\`\`bash
gh pr create --draft --reviewer nopo-bot \\
  --title "${issueTitle}" \\
  --body "Fixes #${issueNumber}
Related to #${parentIssueNumber}

Phase ${phaseNumber} of parent issue."
\`\`\``
    : `\`\`\`bash
gh pr create --draft --reviewer nopo-bot \\
  --title "${issueTitle}" \\
  --body "Fixes #${issueNumber}"
\`\`\``;

  // Note: ISSUE_BODY and ISSUE_COMMENTS are NOT included here to avoid
  // "may contain secret" masking when passing through actions_json output.
  // The workflow fetches these at runtime before passing to Claude.
  // For test runner: issue context is provided via RunnerContext.issueContext
  return {
    ISSUE_NUMBER: String(issueNumber),
    ISSUE_TITLE: issueTitle,
    ITERATION: String(iteration),
    LAST_CI_RESULT: ciResult,
    CONSECUTIVE_FAILURES: String(failures),
    BRANCH_NAME: branchName,
    PARENT_CONTEXT: parentContext,
    PR_CREATE_COMMAND: prCreateCommand,
    EXISTING_BRANCH_SECTION: "",
  };
}

/**
 * Emit action to run Claude for implementation
 *
 * Uses the iterate.txt prompt file with template variables substituted.
 * Claude will implement the issue requirements, update todos, and push changes.
 */
export function emitRunClaude({ context }: ActionContext): ActionResult {
  const issueNumber = context.currentSubIssue?.number ?? context.issue.number;
  const promptVars = buildIteratePromptVars(context);

  const iterateArtifact = {
    name: "claude-iterate-output",
    path: "claude-structured-output.json",
  };

  return [
    {
      type: "runClaude",
      token: "code",
      promptDir: "iterate",
      promptVars,
      issueNumber,
      // Structured output is saved to claude-structured-output.json by run-claude action
      producesArtifact: iterateArtifact,
    },
    // Apply iterate output: check off completed todos, store agent notes
    // Downloads the artifact before execution
    {
      type: "applyIterateOutput",
      token: "code",
      issueNumber,
      filePath: "claude-structured-output.json",
      consumesArtifact: iterateArtifact,
    },
  ];
}

/**
 * Emit action to run Claude for CI fix
 *
 * Uses the same iterate.txt prompt with ciResult set to "failure".
 * The prompt already handles CI fix logic based on LAST_CI_RESULT.
 */
export function emitRunClaudeFixCI({ context }: ActionContext): ActionResult {
  const issueNumber = context.currentSubIssue?.number ?? context.issue.number;
  const promptVars = buildIteratePromptVars(context, "failure");

  // Add CI-specific info to the existing branch section
  promptVars.EXISTING_BRANCH_SECTION = `## CI Failure Context
CI Run: ${context.ciRunUrl ?? "N/A"}
Commit: ${context.ciCommitSha ?? "N/A"}

Review the CI logs at the link above and fix the failing tests or build errors.`;

  const iterateArtifact = {
    name: "claude-iterate-output",
    path: "claude-structured-output.json",
  };

  return [
    {
      type: "runClaude",
      token: "code",
      promptDir: "iterate",
      promptVars,
      issueNumber,
      // Structured output is saved to claude-structured-output.json by run-claude action
      producesArtifact: iterateArtifact,
    },
    // Apply iterate output: check off completed todos, store agent notes
    // Downloads the artifact before execution
    {
      type: "applyIterateOutput",
      token: "code",
      issueNumber,
      filePath: "claude-structured-output.json",
      consumesArtifact: iterateArtifact,
    },
  ];
}

/**
 * Emit action to run Claude for issue triage
 *
 * Uses the triage prompt directory with structured output.
 * Claude returns structured JSON which the applyTriageOutput action
 * uses to apply labels and project fields.
 */
export function emitRunClaudeTriage({ context }: ActionContext): ActionResult {
  const issueNumber = context.issue.number;

  // The triage prompt uses these template variables
  // Note: ISSUE_BODY and ISSUE_COMMENTS are fetched at runtime by workflow.
  // For test runner: issue context is provided via RunnerContext.issueContext
  const promptVars: Record<string, string> = {
    ISSUE_NUMBER: String(issueNumber),
    ISSUE_TITLE: context.issue.title,
    AGENT_NOTES: "", // Injected by workflow from previous runs
  };

  const triageArtifact = {
    name: "claude-triage-output",
    path: "claude-structured-output.json",
  };

  return [
    {
      type: "runClaude",
      token: "code",
      // Uses structured output from prompts/triage/
      promptDir: "triage",
      promptVars,
      issueNumber,
      // No worktree - runs from current directory (main checkout)
      // Structured output is saved to claude-structured-output.json by run-claude action
      producesArtifact: triageArtifact,
    },
    // Apply labels and project fields from structured output
    // Downloads the artifact before execution
    {
      type: "applyTriageOutput",
      token: "code",
      issueNumber,
      filePath: "claude-structured-output.json",
      consumesArtifact: triageArtifact,
    },
    // Note: History entry is handled by workflow bookend logging
  ];
}

/**
 * Emit action to run Claude for issue/PR comment response
 *
 * Uses the comment prompt file with template variables substituted.
 * Claude will respond to the @claude mention and optionally make code changes.
 */
export function emitRunClaudeComment({ context }: ActionContext): ActionResult {
  const issueNumber = context.issue.number;

  // The comment prompt uses these template variables
  // Note: ISSUE_COMMENTS fetched at runtime by workflow
  const promptVars: Record<string, string> = {
    ISSUE_NUMBER: String(issueNumber),
    CONTEXT_TYPE: context.commentContextType ?? "issue",
    CONTEXT_DESCRIPTION:
      context.commentContextDescription ?? `This is issue #${issueNumber}.`,
  };

  return [
    {
      type: "runClaude",
      token: "code",
      promptDir: "comment",
      promptVars,
      issueNumber,
      // worktree intentionally omitted - checkout happens at repo root to the correct branch
    },
  ];
}

// ============================================================================
// PR Review Actions
// ============================================================================

/**
 * Emit action to run Claude to review a PR
 *
 * Uses the review prompt directory with structured output schema.
 * Claude will review the code and return structured output which is then
 * submitted as a PR review via applyReviewOutput.
 */
export function emitRunClaudePRReview({
  context,
}: ActionContext): ActionResult {
  const issueNumber = context.currentSubIssue?.number ?? context.issue.number;
  const prNumber = context.pr?.number;

  if (!prNumber) {
    return [
      {
        type: "log",
        token: "code",
        level: "warning",
        message: "No PR found for review",
        worktree: "main",
      },
    ];
  }

  // The review prompt uses these template variables
  const promptVars: Record<string, string> = {
    PR_NUMBER: String(prNumber),
    ISSUE_NUMBER: String(issueNumber),
    PR_TITLE: context.pr?.title ?? "",
    HEAD_REF: context.pr?.headRef ?? context.branch ?? "",
    BASE_REF: context.pr?.baseRef ?? "main",
    REPO_OWNER: context.owner,
    REPO_NAME: context.repo,
  };

  // Artifact configuration for passing structured output from runClaude to applyReviewOutput
  const reviewArtifact = {
    name: "claude-review-output",
    path: "claude-structured-output.json",
  };

  return [
    {
      type: "runClaude",
      token: "code", // runClaude uses code token for checkout/execution
      promptDir: "review",
      promptVars,
      issueNumber,
      // worktree intentionally omitted - checkout happens at repo root to the correct branch
      // Structured output is saved to claude-structured-output.json by run-claude action
      producesArtifact: reviewArtifact,
    },
    // Apply review output: submit the PR review using structured output
    // Downloads the artifact before execution
    // worktree: "main" ensures we checkout main where the executor code is,
    // not the PR branch being reviewed
    {
      type: "applyReviewOutput",
      token: "review", // submitReview uses review token for different user
      prNumber,
      filePath: "claude-structured-output.json",
      consumesArtifact: reviewArtifact,
      worktree: "main",
    },
  ];
}

/**
 * Emit action to run Claude to respond to (bot's) review feedback
 *
 * Uses the review-response prompt directory with structured output schema.
 * Claude will address the review comments and return structured output which is then
 * processed via applyPRResponseOutput to post comments and re-request review.
 */
export function emitRunClaudePRResponse({
  context,
}: ActionContext): ActionResult {
  const issueNumber = context.currentSubIssue?.number ?? context.issue.number;
  const prNumber = context.pr?.number;

  if (!prNumber) {
    return [
      {
        type: "log",
        token: "code",
        level: "warning",
        message: "No PR found for response",
        worktree: "main",
      },
    ];
  }

  // The review-response prompt uses these template variables
  const promptVars: Record<string, string> = {
    PR_NUMBER: String(prNumber),
    ISSUE_NUMBER: String(issueNumber),
    HEAD_REF: context.pr?.headRef ?? context.branch ?? "",
    BASE_REF: context.pr?.baseRef ?? "main",
    REPO_OWNER: context.owner,
    REPO_NAME: context.repo,
    REVIEW_DECISION: context.reviewDecision ?? "N/A",
    REVIEWER: context.reviewerId ?? "N/A",
    AGENT_NOTES: "", // Will be injected by workflow from previous runs
  };

  // Artifact configuration for passing structured output from runClaude to applyPRResponseOutput
  const responseArtifact = {
    name: "claude-pr-response-output",
    path: "claude-structured-output.json",
  };

  return [
    {
      type: "runClaude",
      token: "code",
      promptDir: "review-response",
      promptVars,
      issueNumber,
      // worktree intentionally omitted - checkout happens at repo root to the correct branch
      // Structured output is saved to claude-structured-output.json by run-claude action
      producesArtifact: responseArtifact,
    },
    // Apply PR response output: post comment, re-request review if no commits
    // Downloads the artifact before execution
    // worktree: "main" ensures we checkout main where the executor code is,
    // not the PR branch being reviewed
    {
      type: "applyPRResponseOutput",
      token: "code",
      prNumber,
      issueNumber,
      filePath: "claude-structured-output.json",
      consumesArtifact: responseArtifact,
      reviewer: "nopo-reviewer",
      worktree: "main",
    },
  ];
}

/**
 * Emit action to run Claude to respond to human's review feedback
 *
 * Uses the human-review-response prompt directory with structured output schema.
 * Claude will address the human reviewer's comments and return structured output
 * which is then processed via applyPRResponseOutput to post comments and re-request review.
 */
export function emitRunClaudePRHumanResponse({
  context,
}: ActionContext): ActionResult {
  const issueNumber = context.currentSubIssue?.number ?? context.issue.number;
  const prNumber = context.pr?.number;

  if (!prNumber) {
    return [
      {
        type: "log",
        token: "code",
        level: "warning",
        message: "No PR found for human response",
        worktree: "main",
      },
    ];
  }

  // The human-review-response prompt uses these template variables
  const promptVars: Record<string, string> = {
    PR_NUMBER: String(prNumber),
    ISSUE_NUMBER: String(issueNumber),
    HEAD_REF: context.pr?.headRef ?? context.branch ?? "",
    BASE_REF: context.pr?.baseRef ?? "main",
    REPO_OWNER: context.owner,
    REPO_NAME: context.repo,
    REVIEW_DECISION: context.reviewDecision ?? "N/A",
    REVIEWER: context.reviewerId ?? "N/A",
    AGENT_NOTES: "", // Will be injected by workflow from previous runs
  };

  // Artifact configuration for passing structured output from runClaude to applyPRResponseOutput
  const responseArtifact = {
    name: "claude-pr-human-response-output",
    path: "claude-structured-output.json",
  };

  return [
    {
      type: "runClaude",
      token: "code",
      promptDir: "human-review-response",
      promptVars,
      issueNumber,
      // worktree intentionally omitted - checkout happens at repo root to the correct branch
      // Structured output is saved to claude-structured-output.json by run-claude action
      producesArtifact: responseArtifact,
    },
    // Apply PR response output: post comment, re-request review if no commits
    // Downloads the artifact before execution
    // worktree: "main" ensures we checkout main where the executor code is,
    // not the PR branch being reviewed
    {
      type: "applyPRResponseOutput",
      token: "code",
      prNumber,
      issueNumber,
      filePath: "claude-structured-output.json",
      consumesArtifact: responseArtifact,
      reviewer: context.reviewerId ?? "nopo-reviewer",
      worktree: "main",
    },
  ];
}

// ============================================================================
// Orchestration Actions
// ============================================================================

/**
 * Emit action to assign nopo-bot to current sub-issue
 * This triggers the iteration workflow on the sub-issue
 */
export function emitAssignToSubIssue({ context }: ActionContext): ActionResult {
  if (!context.currentSubIssue) {
    return [];
  }
  return [
    {
      type: "assignUser",
      token: "code",
      issueNumber: context.currentSubIssue.number,
      username: context.botUsername,
    },
  ];
}

/**
 * Emit actions to initialize parent issue for orchestration
 * Sets parent to "In progress" and first sub-issue to "In progress"
 */
export function emitInitializeParent({ context }: ActionContext): ActionResult {
  const actions: Action[] = [];

  // Set parent to "In progress"
  actions.push({
    type: "updateProjectStatus",
    token: "code",
    issueNumber: context.issue.number,
    status: "In progress" as ProjectStatus,
  });

  // Set first sub-issue to "In progress"
  const firstSubIssue = context.issue.subIssues[0];
  if (firstSubIssue) {
    actions.push({
      type: "updateProjectStatus",
      token: "code",
      issueNumber: firstSubIssue.number,
      status: "In progress" as ProjectStatus,
    });
  }

  // Log initialization
  actions.push({
    type: "appendHistory",
    token: "code",
    issueNumber: context.issue.number,
    iteration: context.issue.iteration,
    phase: "1",
    message: `🚀 Initialized with ${context.issue.subIssues.length} phase(s)`,
    timestamp: context.workflowStartedAt ?? undefined,
  });

  return actions;
}

/**
 * Emit actions to advance to next phase
 * Marks current phase Done, sets next phase to In progress
 */
export function emitAdvancePhase({ context }: ActionContext): ActionResult {
  const actions: Action[] = [];

  if (!context.currentSubIssue || context.currentPhase === null) {
    return actions;
  }

  // Mark current sub-issue as Done
  actions.push({
    type: "updateProjectStatus",
    token: "code",
    issueNumber: context.currentSubIssue.number,
    status: "Done" as ProjectStatus,
  });

  // Close current sub-issue
  actions.push({
    type: "closeIssue",
    token: "code",
    issueNumber: context.currentSubIssue.number,
    reason: "completed" as const,
  });

  // Find next sub-issue
  const nextPhase = context.currentPhase + 1;
  const nextSubIssue = context.issue.subIssues[nextPhase - 1]; // 0-indexed

  if (nextSubIssue) {
    // Set next sub-issue to In progress
    actions.push({
      type: "updateProjectStatus",
      token: "code",
      issueNumber: nextSubIssue.number,
      status: "In progress" as ProjectStatus,
    });

    // Log phase advancement
    actions.push({
      type: "appendHistory",
      token: "code",
      issueNumber: context.issue.number,
      iteration: context.issue.iteration,
      phase: String(nextPhase),
      message: `⏭️ Phase ${nextPhase} started`,
      timestamp: context.workflowStartedAt ?? undefined,
    });
  }

  return actions;
}

/**
 * Emit actions for complete orchestration flow
 * Handles initialization, phase advancement, and sub-issue assignment
 */
export function emitOrchestrate({ context }: ActionContext): ActionResult {
  const actions: Action[] = [];

  // Log that we're orchestrating
  actions.push({
    type: "log",
    token: "code",
    level: "info",
    message: `Orchestrating issue #${context.issue.number} with ${context.issue.subIssues.length} phases`,
    worktree: "main",
  });

  // Check if parent needs initialization
  const needsInit =
    context.issue.projectStatus === null ||
    context.issue.projectStatus === "Backlog";

  if (needsInit) {
    actions.push(...emitInitializeParent({ context }));
  }

  // Check if current phase is complete and needs advancement
  // Phase is complete when the sub-issue is CLOSED (happens when PR is merged)
  const phaseComplete =
    context.currentSubIssue && context.currentSubIssue.state === "CLOSED";

  if (phaseComplete && context.currentPhase !== null) {
    const hasNext = context.currentPhase < context.totalPhases;
    if (hasNext) {
      actions.push(...emitAdvancePhase({ context }));
    }
  }

  // Determine which sub-issue to assign
  // After advancement, we need to find the new current sub-issue
  let subIssueToAssign = context.currentSubIssue;

  if (phaseComplete && context.currentPhase !== null) {
    const nextPhase = context.currentPhase + 1;
    if (nextPhase <= context.totalPhases) {
      subIssueToAssign = context.issue.subIssues[nextPhase - 1] ?? null;
    } else {
      subIssueToAssign = null; // All phases done
    }
  }

  // Assign nopo-bot to the sub-issue to trigger iteration
  if (subIssueToAssign) {
    actions.push({
      type: "assignUser",
      token: "code",
      issueNumber: subIssueToAssign.number,
      username: context.botUsername,
    });
  }

  return actions;
}

/**
 * Emit actions when all phases are done
 */
export function emitAllPhasesDone({ context }: ActionContext): ActionResult {
  const actions: Action[] = [];

  // Log completion
  actions.push({
    type: "log",
    token: "code",
    level: "info",
    message: `All phases complete for issue #${context.issue.number}`,
    worktree: "main",
  });

  // Set parent to Done
  actions.push({
    type: "updateProjectStatus",
    token: "code",
    issueNumber: context.issue.number,
    status: "Done" as ProjectStatus,
  });

  // Close parent issue
  actions.push({
    type: "closeIssue",
    token: "code",
    issueNumber: context.issue.number,
    reason: "completed" as const,
  });

  // Append final history entry
  actions.push({
    type: "appendHistory",
    token: "code",
    issueNumber: context.issue.number,
    iteration: context.issue.iteration,
    phase: "-",
    message: "✅ All phases complete",
    timestamp: context.workflowStartedAt ?? undefined,
  });

  return actions;
}

// ============================================================================
// Control Flow Actions
// ============================================================================

/**
 * Emit stop action
 */
export function emitStop(_ctx: ActionContext, reason: string): ActionResult {
  return [
    {
      type: "stop",
      token: "code",
      reason,
    },
  ];
}

/**
 * Emit log action
 */
export function emitLog(
  _ctx: ActionContext,
  message: string,
  level: "debug" | "info" | "warning" | "error" = "info",
): ActionResult {
  return [
    {
      type: "log",
      token: "code",
      level,
      message,
      // Log actions don't need the code branch - run from main
      worktree: "main",
    },
  ];
}

// ============================================================================
// Compound Actions
// ============================================================================

/**
 * Emit actions for transitioning to review state
 */
export function emitTransitionToReview({
  context,
}: ActionContext): ActionResult {
  const actions: Action[] = [];

  // Clear failures on success
  if (context.issue.failures > 0) {
    actions.push(...emitClearFailures({ context }));
  }

  // Mark PR ready
  if (context.pr?.isDraft) {
    actions.push(...emitMarkReady({ context }));
  }

  // Set status to Review
  actions.push(...emitSetReview({ context }));

  // Request review
  actions.push(...emitRequestReview({ context }));

  return actions;
}

/**
 * Emit actions for handling CI failure
 */
export function emitHandleCIFailure({ context }: ActionContext): ActionResult {
  const actions: Action[] = [];

  // Record the failure
  actions.push(...emitRecordFailure({ context }));

  // Log the failure
  actions.push(...emitLogCIFailure({ context }));

  return actions;
}

/**
 * Emit actions for blocking the issue
 */
export function emitBlockIssue({ context }: ActionContext): ActionResult {
  const actions: Action[] = [];

  // Set status to Blocked
  actions.push(...emitSetBlocked({ context }));

  // Unassign bot
  actions.push(...emitUnassign({ context }));

  // Log
  actions.push(
    ...emitAppendHistory(
      { context },
      `🚫 Blocked: Max failures reached (${context.issue.failures})`,
    ),
  );

  // Block action
  actions.push(...emitBlock({ context }));

  return actions;
}

// ============================================================================
// Merge Queue Logging Actions
// ============================================================================
// Note: These are now called directly from release.yml via the executor.
// The state machine paths are kept for consistency but are effectively dead code.
// The executor automatically handles dual-logging to parent issues.

/**
 * Emit action to log merge queue entry
 */
export function emitMergeQueueEntry({ context }: ActionContext): ActionResult {
  const issueNumber = context.currentSubIssue?.number ?? context.issue.number;
  const phase = String(context.currentPhase ?? "-");
  const iteration = context.issue.iteration ?? 0;

  return [
    {
      type: "appendHistory",
      token: "code",
      issueNumber,
      iteration,
      phase,
      message: "🚀 Entered queue",
      timestamp: context.workflowStartedAt ?? undefined,
      runLink: context.ciRunUrl ?? undefined,
    },
  ];
}

/**
 * Emit action to log queue exit due to failure
 */
export function emitMergeQueueFailure({
  context,
}: ActionContext): ActionResult {
  const issueNumber = context.currentSubIssue?.number ?? context.issue.number;
  const phase = String(context.currentPhase ?? "-");
  const iteration = context.issue.iteration ?? 0;

  return [
    {
      type: "appendHistory",
      token: "code",
      issueNumber,
      iteration,
      phase,
      message: "❌ Removed from queue",
      timestamp: context.workflowStartedAt ?? undefined,
      runLink: context.ciRunUrl ?? undefined,
    },
  ];
}

/**
 * Emit action to log PR merged
 */
export function emitMerged({ context }: ActionContext): ActionResult {
  const issueNumber = context.currentSubIssue?.number ?? context.issue.number;
  const phase = String(context.currentPhase ?? "-");
  const iteration = context.issue.iteration ?? 0;

  return [
    {
      type: "appendHistory",
      token: "code",
      issueNumber,
      iteration,
      phase,
      message: "🚢 Merged",
      timestamp: context.workflowStartedAt ?? undefined,
      commitSha: context.ciCommitSha ?? undefined,
      runLink: context.ciRunUrl ?? undefined,
    },
  ];
}

/**
 * Emit action to log stage deployment success
 */
export function emitDeployedStage({ context }: ActionContext): ActionResult {
  const issueNumber = context.currentSubIssue?.number ?? context.issue.number;
  const phase = String(context.currentPhase ?? "-");
  const iteration = context.issue.iteration ?? 0;

  return [
    {
      type: "appendHistory",
      token: "code",
      issueNumber,
      iteration,
      phase,
      message: "✅ Deployed to stage",
      timestamp: context.workflowStartedAt ?? undefined,
      commitSha: context.ciCommitSha ?? undefined,
      runLink: context.ciRunUrl ?? undefined,
    },
  ];
}

/**
 * Emit action to log production deployment success
 */
export function emitDeployedProd({ context }: ActionContext): ActionResult {
  const issueNumber = context.currentSubIssue?.number ?? context.issue.number;
  const phase = String(context.currentPhase ?? "-");
  const iteration = context.issue.iteration ?? 0;

  return [
    {
      type: "appendHistory",
      token: "code",
      issueNumber,
      iteration,
      phase,
      message: "✅ Released to production",
      timestamp: context.workflowStartedAt ?? undefined,
      commitSha: context.ciCommitSha ?? undefined,
      runLink: context.ciRunUrl ?? undefined,
    },
  ];
}

// ============================================================================
// Push to Draft Actions
// ============================================================================

/**
 * Emit actions for push-to-draft flow
 *
 * When code is pushed to a PR branch, convert the PR to draft and remove
 * the reviewer. This cancels in-flight reviews and signals iteration will continue.
 */
export function emitPushToDraft({ context }: ActionContext): ActionResult {
  const actions: Action[] = [];

  // Convert PR to draft
  if (context.pr) {
    actions.push({
      type: "convertPRToDraft",
      token: "code",
      prNumber: context.pr.number,
    });

    // Remove reviewer
    actions.push({
      type: "removeReviewer",
      token: "code",
      prNumber: context.pr.number,
      reviewer: "nopo-bot",
    });
  }

  // Append history entry
  const issueNumber = context.currentSubIssue?.number ?? context.issue.number;
  const phase = String(context.currentPhase ?? "-");

  actions.push({
    type: "appendHistory",
    token: "code",
    issueNumber,
    iteration: 0, // Push-to-draft doesn't have iteration context
    phase,
    message: "📝 Code pushed - converting to draft",
    commitSha: context.ciCommitSha ?? undefined,
    runLink: context.ciRunUrl ?? undefined,
  });

  return actions;
}

// ============================================================================
// Grooming Actions
// ============================================================================

/**
 * Build prompt variables for grooming prompts
 * Note: ISSUE_BODY and ISSUE_COMMENTS fetched at runtime by workflow
 */
function buildGroomingPromptVars(
  context: MachineContext,
): Record<string, string> {
  return {
    ISSUE_NUMBER: String(context.issue.number),
    ISSUE_TITLE: context.issue.title,
    ISSUE_LABELS: context.issue.labels.join(", "),
  };
}

/**
 * Emit action to run Claude grooming agents in parallel
 *
 * Executes PM, Engineer, QA, and Research agents to analyze the issue
 * and determine if it's ready for implementation.
 */
export function emitRunClaudeGrooming({
  context,
}: ActionContext): ActionResult {
  const issueNumber = context.issue.number;
  const promptVars = buildGroomingPromptVars(context);

  const groomingArtifact = {
    name: "claude-grooming-output",
    path: "grooming-output.json",
  };

  return [
    // Log grooming start in history
    {
      type: "appendHistory",
      token: "code",
      issueNumber,
      iteration: 0, // Grooming is pre-iteration
      phase: "groom",
      message: "⏳ grooming...",
      timestamp: context.workflowStartedAt ?? undefined,
      runLink: context.workflowRunUrl ?? context.ciRunUrl ?? undefined,
    },
    // Run all 4 grooming agents in parallel
    {
      type: "runClaudeGrooming",
      token: "code",
      issueNumber,
      promptVars,
      producesArtifact: groomingArtifact,
    },
    // Apply grooming output: run summary and make decision
    {
      type: "applyGroomingOutput",
      token: "code",
      issueNumber,
      filePath: "grooming-output.json",
      consumesArtifact: groomingArtifact,
    },
  ];
}

/**
 * Emit action to add a label to an issue
 */
export function emitAddLabel(
  { context }: ActionContext,
  label: string,
): ActionResult {
  return [
    {
      type: "addLabel",
      token: "code",
      issueNumber: context.issue.number,
      label,
    },
  ];
}

/**
 * Emit action to remove a label from an issue
 */
export function emitRemoveLabel(
  { context }: ActionContext,
  label: string,
): ActionResult {
  return [
    {
      type: "removeLabel",
      token: "code",
      issueNumber: context.issue.number,
      label,
    },
  ];
}

/**
 * Emit action to add "groomed" label (issue is ready for work)
 */
export function emitAddGroomedLabel({ context }: ActionContext): ActionResult {
  return emitAddLabel({ context }, "groomed");
}

/**
 * Emit action to add "needs-info" label (issue needs clarification)
 */
export function emitAddNeedsInfoLabel({
  context,
}: ActionContext): ActionResult {
  return emitAddLabel({ context }, "needs-info");
}

/**
 * Emit action to remove "needs-info" label
 */
export function emitRemoveNeedsInfoLabel({
  context,
}: ActionContext): ActionResult {
  return emitRemoveLabel({ context }, "needs-info");
}

/**
 * Emit action to set status to Ready (used after grooming)
 */
export function emitSetReady({ context }: ActionContext): ActionResult {
  return [
    {
      type: "updateProjectStatus",
      token: "code",
      issueNumber: context.issue.number,
      status: "Ready" as ProjectStatus,
    },
  ];
}

// ============================================================================
// Pivot Actions
// ============================================================================

/**
 * Emit action to run Claude for issue pivot analysis
 *
 * Uses the pivot prompt directory with structured output schema.
 * Claude analyzes the pivot request and returns structured output
 * which the applyPivotOutput action uses to modify issue specs safely.
 */
export function emitRunClaudePivot({ context }: ActionContext): ActionResult {
  const issueNumber = context.issue.number;

  // Build sub-issues info for prompt (include body for full context)
  const subIssuesInfo = context.issue.subIssues.map((s) => ({
    number: s.number,
    title: s.title,
    state: s.state,
    body: s.body,
    projectStatus: s.projectStatus,
    todos: s.todos,
  }));

  // Format comments for prompt
  const issueComments = formatCommentsForPrompt(context.issue.comments ?? []);

  // The pivot prompt uses these template variables
  // All required variables are now included directly from context
  const promptVars: Record<string, string> = {
    ISSUE_NUMBER: String(issueNumber),
    ISSUE_TITLE: context.issue.title,
    ISSUE_BODY: context.issue.body,
    ISSUE_COMMENTS: issueComments,
    PIVOT_DESCRIPTION:
      context.pivotDescription ?? "(No pivot description provided)",
    SUB_ISSUES_JSON: JSON.stringify(subIssuesInfo, null, 2),
  };

  const pivotArtifact = {
    name: "claude-pivot-output",
    path: "claude-structured-output.json",
  };

  return [
    // Log pivot start in history
    {
      type: "appendHistory",
      token: "code",
      issueNumber,
      iteration: context.issue.iteration,
      phase: "pivot",
      message: "⏳ Analyzing pivot request...",
      timestamp: context.workflowStartedAt ?? undefined,
      runLink: context.workflowRunUrl ?? context.ciRunUrl ?? undefined,
    },
    // Run Claude pivot analysis
    {
      type: "runClaude",
      token: "code",
      promptDir: "pivot",
      promptVars,
      issueNumber,
      producesArtifact: pivotArtifact,
    },
    // Apply pivot output: validate safety, apply changes, post summary
    {
      type: "applyPivotOutput",
      token: "code",
      issueNumber,
      filePath: "claude-structured-output.json",
      consumesArtifact: pivotArtifact,
    },
  ];
}
