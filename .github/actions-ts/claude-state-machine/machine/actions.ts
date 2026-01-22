import type {
  MachineContext,
  Action,
  ProjectStatus,
} from "../schemas/index.js";
import { deriveBranchName } from "../parser/index.js";

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
      issueNumber: context.issue.number,
      reason: `Max failures (${context.maxRetries}) reached`,
    },
  ];
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
      issueNumber: context.issue.number,
      phase: String(phaseStr),
      message,
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
      issueNumber: context.issue.number,
      matchIteration: context.issue.iteration,
      matchPhase: String(context.currentPhase ?? "-"),
      matchPattern: "⏳",
      newMessage: "❌ CI Failed",
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
      branchName,
      baseBranch: "main",
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
      prNumber: context.pr.number,
    },
  ];
}

/**
 * Emit action to request review
 */
export function emitRequestReview({ context }: ActionContext): ActionResult {
  if (!context.pr) {
    return [];
  }
  return [
    {
      type: "requestReview",
      prNumber: context.pr.number,
      reviewer: context.botUsername,
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
  const issueBody = context.currentSubIssue?.body ?? context.issue.body;
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

  return {
    ISSUE_NUMBER: String(issueNumber),
    ISSUE_TITLE: issueTitle,
    ITERATION: String(iteration),
    LAST_CI_RESULT: ciResult,
    CONSECUTIVE_FAILURES: String(failures),
    BRANCH_NAME: branchName,
    ISSUE_BODY: issueBody,
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

  return [
    {
      type: "runClaude",
      promptFile: ".github/prompts/iterate.txt",
      promptVars,
      issueNumber,
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

  return [
    {
      type: "runClaude",
      promptFile: ".github/prompts/iterate.txt",
      promptVars,
      issueNumber,
    },
  ];
}

/**
 * Emit action to run Claude for issue triage
 *
 * Uses the triage prompt file with template variables substituted.
 * Claude will analyze the issue, write triage-output.json, create sub-issues,
 * and update the issue body.
 */
export function emitRunClaudeTriage({ context }: ActionContext): ActionResult {
  const issueNumber = context.issue.number;

  // The triage prompt uses these template variables
  const promptVars: Record<string, string> = {
    ISSUE_NUMBER: String(issueNumber),
    ISSUE_TITLE: context.issue.title,
    ISSUE_BODY: context.issue.body,
    REPO_OWNER: context.owner,
    REPO_NAME: context.repo,
  };

  const triageArtifact = {
    name: "claude-triage-output",
    path: "triage-output.json",
  };

  return [
    {
      type: "runClaude",
      promptFile: ".github/prompts/triage.txt",
      promptVars,
      issueNumber,
      // Upload triage-output.json after Claude creates it
      producesArtifact: triageArtifact,
    },
    // Apply labels and project fields from triage-output.json
    // Downloads the artifact before execution
    {
      type: "applyTriageOutput",
      issueNumber,
      filePath: "triage-output.json",
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
  const promptVars: Record<string, string> = {
    ISSUE_NUMBER: String(issueNumber),
    CONTEXT_TYPE: context.commentContextType ?? "Issue",
    CONTEXT_DESCRIPTION:
      context.commentContextDescription ?? `This is issue #${issueNumber}.`,
  };

  return [
    {
      type: "runClaude",
      promptFile: ".github/prompts/comment.txt",
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
 * Uses the review prompt file with template variables substituted.
 * Claude will review the code and write review-output.json which is then
 * submitted as a PR review.
 */
export function emitRunClaudePRReview({
  context,
}: ActionContext): ActionResult {
  const issueNumber = context.currentSubIssue?.number ?? context.issue.number;
  const prNumber = context.pr?.number;

  if (!prNumber) {
    return [
      { type: "log", level: "warning", message: "No PR found for review" },
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

  return [
    {
      type: "runClaude",
      promptFile: ".github/prompts/review.txt",
      promptVars,
      issueNumber,
      // worktree intentionally omitted - checkout happens at repo root to the correct branch
    },
  ];
}

/**
 * Emit action to run Claude to respond to (bot's) review feedback
 *
 * Uses the review-response prompt file. Claude will address the review
 * comments and make code changes.
 */
export function emitRunClaudePRResponse({
  context,
}: ActionContext): ActionResult {
  const issueNumber = context.currentSubIssue?.number ?? context.issue.number;
  const prNumber = context.pr?.number;

  if (!prNumber) {
    return [
      { type: "log", level: "warning", message: "No PR found for response" },
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
  };

  return [
    {
      type: "runClaude",
      promptFile: ".github/prompts/review-response.txt",
      promptVars,
      issueNumber,
      // worktree intentionally omitted - checkout happens at repo root to the correct branch
    },
  ];
}

/**
 * Emit action to run Claude to respond to human's review feedback
 *
 * Uses the human-review-response prompt file. Claude will address the
 * human reviewer's comments and make code changes.
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
        level: "warning",
        message: "No PR found for human response",
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
  };

  return [
    {
      type: "runClaude",
      promptFile: ".github/prompts/human-review-response.txt",
      promptVars,
      issueNumber,
      // worktree intentionally omitted - checkout happens at repo root to the correct branch
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
    issueNumber: context.issue.number,
    status: "In progress" as ProjectStatus,
  });

  // Set first sub-issue to "In progress"
  const firstSubIssue = context.issue.subIssues[0];
  if (firstSubIssue) {
    actions.push({
      type: "updateProjectStatus",
      issueNumber: firstSubIssue.number,
      status: "In progress" as ProjectStatus,
    });
  }

  // Log initialization
  actions.push({
    type: "appendHistory",
    issueNumber: context.issue.number,
    phase: "1",
    message: `🚀 Initialized with ${context.issue.subIssues.length} phase(s)`,
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
    issueNumber: context.currentSubIssue.number,
    status: "Done" as ProjectStatus,
  });

  // Close current sub-issue
  actions.push({
    type: "closeIssue",
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
      issueNumber: nextSubIssue.number,
      status: "In progress" as ProjectStatus,
    });

    // Log phase advancement
    actions.push({
      type: "appendHistory",
      issueNumber: context.issue.number,
      phase: String(nextPhase),
      message: `⏭️ Phase ${nextPhase} started`,
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
    level: "info",
    message: `Orchestrating issue #${context.issue.number} with ${context.issue.subIssues.length} phases`,
  });

  // Check if parent needs initialization
  const needsInit =
    context.issue.projectStatus === null ||
    context.issue.projectStatus === "Backlog";

  if (needsInit) {
    actions.push(...emitInitializeParent({ context }));
  }

  // Check if current phase is complete and needs advancement
  // Phase is complete when todos are done
  const phaseComplete =
    context.currentSubIssue &&
    context.currentSubIssue.todos.uncheckedNonManual === 0;

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
      issueNumber: subIssueToAssign.number,
      username: context.botUsername,
    });
  }

  // Stop after orchestration
  actions.push({
    type: "stop",
    reason: subIssueToAssign
      ? `Assigned to sub-issue #${subIssueToAssign.number}`
      : "All phases complete",
  });

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
    level: "info",
    message: `All phases complete for issue #${context.issue.number}`,
  });

  // Set parent to Done
  actions.push({
    type: "updateProjectStatus",
    issueNumber: context.issue.number,
    status: "Done" as ProjectStatus,
  });

  // Close parent issue
  actions.push({
    type: "closeIssue",
    issueNumber: context.issue.number,
    reason: "completed" as const,
  });

  // Append final history entry
  actions.push({
    type: "appendHistory",
    issueNumber: context.issue.number,
    phase: "-",
    message: "✅ All phases complete",
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
      level,
      message,
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
