/**
 * Issue machine action helpers.
 *
 * Contains compound actions (combining multiple creates) and complex builders
 * (significant context-derived logic). Simple one-liner actions are inlined
 * directly in the machine definition.
 *
 * Rule of thumb: if it's just `actions.xxx.create({ contextDerivedParams })`,
 * inline it in machine.ts. If it combines 3+ creates or has non-trivial logic,
 * put it here.
 */

import type { MachineContext, Action } from "../../core/schemas.js";
import { actions } from "../../core/schemas.js";
import { serializeMarkdown } from "@more/issue-state";
import { deriveBranchName, extractTodosFromAst } from "../../core/parser.js";
import { HISTORY_ICONS, HISTORY_MESSAGES } from "../../core/constants.js";
import { formatCommentsForPrompt } from "../../core/utils.js";
import type { ActionContext } from "../../core/types.js";

/**
 * Action result - actions to execute
 */
type ActionResult = Action[];

// ============================================================================
// History & Status Helpers
// ============================================================================

/**
 * Emit action to set a project status on an issue
 */
export function emitStatus(
  { context }: ActionContext,
  status: string,
  issueNumber?: number,
): ActionResult {
  return [
    actions.updateProjectStatus.create({
      issueNumber:
        issueNumber ?? context.currentSubIssue?.number ?? context.issue.number,
      status,
    }),
  ];
}

/**
 * Emit action to update (replace) an existing history entry
 */
export function emitUpdateHistory(
  { context }: ActionContext,
  matchPattern: string,
  newMessage: string,
): ActionResult {
  return [
    actions.updateHistory.create({
      issueNumber: context.issue.number,
      matchIteration: context.issue.iteration,
      matchPhase: String(context.currentPhase ?? "-"),
      matchPattern,
      newMessage,
      timestamp: context.workflowStartedAt ?? undefined,
      commitSha: context.ciCommitSha ?? undefined,
      runLink: context.ciRunUrl ?? undefined,
    }),
  ];
}

/**
 * Emit action to append to iteration history
 */
export function emitAppendHistory(
  { context }: ActionContext,
  message: string,
  phase?: string | number,
): ActionResult {
  const phaseStr = phase ?? context.currentPhase ?? "-";
  return [
    actions.appendHistory.create({
      issueNumber: context.issue.number,
      iteration: context.issue.iteration,
      phase: String(phaseStr),
      message,
      timestamp: context.workflowStartedAt ?? undefined,
      commitSha: context.ciCommitSha ?? undefined,
      runLink: context.ciRunUrl ?? undefined,
    }),
  ];
}

// ============================================================================
// Compound: Transition to Review
// ============================================================================

/**
 * Emit actions for transitioning to review state
 */
export function transitionToReview({ context }: ActionContext): ActionResult {
  const result: Action[] = [];

  // Clear failures on success
  if (context.issue.failures > 0) {
    result.push(
      actions.clearFailures.create({
        issueNumber: context.issue.number,
      }),
    );
  }

  // Mark PR ready
  if (context.pr?.isDraft) {
    result.push(...emitMarkReady({ context }));
  }

  // Set status to Review
  const issueNumber = context.currentSubIssue?.number ?? context.issue.number;
  result.push(
    actions.updateProjectStatus.create({
      issueNumber,
      status: "In review",
    }),
  );

  // Request review
  result.push(...emitRequestReview({ context }));

  return result;
}

// ============================================================================
// Compound: CI Failure Handling
// ============================================================================

/**
 * Emit actions for handling CI failure
 */
export function handleCIFailure({ context }: ActionContext): ActionResult {
  return [
    actions.recordFailure.create({
      issueNumber: context.issue.number,
      failureType: "ci" as const,
    }),
    actions.updateHistory.create({
      issueNumber: context.issue.number,
      matchIteration: context.issue.iteration,
      matchPhase: String(context.currentPhase ?? "-"),
      matchPattern: HISTORY_ICONS.ITERATING,
      newMessage: HISTORY_MESSAGES.CI_FAILED,
      timestamp: context.workflowStartedAt ?? undefined,
      commitSha: context.ciCommitSha ?? undefined,
      runLink: context.ciRunUrl ?? undefined,
    }),
  ];
}

// ============================================================================
// Compound: Block Issue
// ============================================================================

/**
 * Emit actions for blocking the issue
 */
export function blockIssue({ context }: ActionContext): ActionResult {
  return [
    actions.updateProjectStatus.create({
      issueNumber: context.issue.number,
      status: "Blocked",
    }),
    actions.unassignUser.create({
      issueNumber: context.issue.number,
      username: context.botUsername,
    }),
    ...emitAppendHistory(
      { context },
      HISTORY_MESSAGES.blocked(context.issue.failures),
    ),
    actions.block.create({
      issueNumber: context.issue.number,
      message: `Max failures (${context.maxRetries}) reached`,
    }),
  ];
}

// ============================================================================
// Complex: Claude Iteration
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

  // Format issue body and comments from context
  const issueBodyAst =
    context.currentSubIssue?.bodyAst ?? context.issue.bodyAst;
  const issueComments = formatCommentsForPrompt(context.issue.comments ?? []);

  return {
    ISSUE_NUMBER: String(issueNumber),
    ISSUE_TITLE: issueTitle,
    ISSUE_BODY: serializeMarkdown(issueBodyAst),
    ISSUE_COMMENTS: issueComments,
    ITERATION: String(iteration),
    LAST_CI_RESULT: ciResult,
    CONSECUTIVE_FAILURES: String(failures),
    BRANCH_NAME: branchName,
    PARENT_CONTEXT: parentContext,
    PR_CREATE_COMMAND: prCreateCommand,
    EXISTING_BRANCH_SECTION: "",
    AGENT_NOTES: "", // Injected by workflow from previous runs
  };
}

/**
 * Emit action to run Claude for implementation
 */
export function runClaude({ context }: ActionContext): ActionResult {
  const issueNumber = context.currentSubIssue?.number ?? context.issue.number;
  const promptVars = buildIteratePromptVars(context);

  const iterateArtifact = {
    name: "claude-iterate-output",
    path: "claude-structured-output.json",
  };

  return [
    actions.runClaude.create({
      promptDir: "iterate",
      promptVars,
      issueNumber,
      producesArtifact: iterateArtifact,
    }),
    actions.applyIterateOutput.create({
      issueNumber,
      filePath: "claude-structured-output.json",
      consumesArtifact: iterateArtifact,
      prNumber: context.pr?.number,
      reviewer: "nopo-reviewer",
      lastCIResult: context.ciResult ?? undefined,
    }),
  ];
}

/**
 * Emit action to run Claude for CI fix
 */
export function runClaudeFixCI({ context }: ActionContext): ActionResult {
  const issueNumber = context.currentSubIssue?.number ?? context.issue.number;
  const promptVars = buildIteratePromptVars(context, "failure");

  promptVars.EXISTING_BRANCH_SECTION = `## CI Failure Context
CI Run: ${context.ciRunUrl ?? "N/A"}
Commit: ${context.ciCommitSha ?? "N/A"}

Review the CI logs at the link above and fix the failing tests or build errors.`;

  const iterateArtifact = {
    name: "claude-iterate-output",
    path: "claude-structured-output.json",
  };

  return [
    actions.runClaude.create({
      promptDir: "iterate",
      promptVars,
      issueNumber,
      producesArtifact: iterateArtifact,
    }),
    actions.applyIterateOutput.create({
      issueNumber,
      filePath: "claude-structured-output.json",
      consumesArtifact: iterateArtifact,
      prNumber: context.pr?.number,
      reviewer: "nopo-reviewer",
      lastCIResult: context.ciResult ?? undefined,
    }),
  ];
}

/**
 * Emit action to run Claude for issue triage
 */
export function runClaudeTriage({ context }: ActionContext): ActionResult {
  const issueNumber = context.issue.number;
  const issueComments = formatCommentsForPrompt(context.issue.comments ?? []);

  const promptVars: Record<string, string> = {
    ISSUE_NUMBER: String(issueNumber),
    ISSUE_TITLE: context.issue.title,
    ISSUE_BODY: serializeMarkdown(context.issue.bodyAst),
    ISSUE_COMMENTS: issueComments,
    AGENT_NOTES: "",
  };

  const triageArtifact = {
    name: "claude-triage-output",
    path: "claude-structured-output.json",
  };

  return [
    actions.runClaude.create({
      promptDir: "triage",
      promptVars,
      issueNumber,
      producesArtifact: triageArtifact,
    }),
    actions.applyTriageOutput.create({
      issueNumber,
      filePath: "claude-structured-output.json",
      consumesArtifact: triageArtifact,
    }),
  ];
}

/**
 * Emit action to run Claude for issue/PR comment response
 */
export function runClaudeComment({ context }: ActionContext): ActionResult {
  const issueNumber = context.issue.number;

  const promptVars: Record<string, string> = {
    ISSUE_NUMBER: String(issueNumber),
    CONTEXT_TYPE: context.commentContextType ?? "issue",
    CONTEXT_DESCRIPTION:
      context.commentContextDescription ?? `This is issue #${issueNumber}.`,
  };

  return [
    actions.runClaude.create({
      promptDir: "comment",
      promptVars,
      issueNumber,
    }),
  ];
}

/**
 * Emit action to run Claude to review a PR
 */
export function runClaudePRReview({ context }: ActionContext): ActionResult {
  const issueNumber = context.currentSubIssue?.number ?? context.issue.number;
  const prNumber = context.pr?.number;

  if (!prNumber) {
    return [
      actions.log.create({
        level: "warning",
        message: "No PR found for review",
        worktree: "main",
      }),
    ];
  }

  const promptVars: Record<string, string> = {
    PR_NUMBER: String(prNumber),
    ISSUE_NUMBER: String(issueNumber),
    PR_TITLE: context.pr?.title ?? "",
    HEAD_REF: context.pr?.headRef ?? context.branch ?? "",
    BASE_REF: context.pr?.baseRef ?? "main",
    REPO_OWNER: context.owner,
    REPO_NAME: context.repo,
  };

  const reviewArtifact = {
    name: "claude-review-output",
    path: "claude-structured-output.json",
  };

  return [
    actions.runClaude.create({
      promptDir: "review",
      promptVars,
      issueNumber,
      producesArtifact: reviewArtifact,
    }),
    actions.applyReviewOutput.create({
      token: "review",
      prNumber,
      filePath: "claude-structured-output.json",
      consumesArtifact: reviewArtifact,
      worktree: "main",
    }),
  ];
}

/**
 * Emit action to run Claude to respond to (bot's) review feedback
 */
export function runClaudePRResponse({ context }: ActionContext): ActionResult {
  const issueNumber = context.currentSubIssue?.number ?? context.issue.number;
  const prNumber = context.pr?.number;

  if (!prNumber) {
    return [
      actions.log.create({
        level: "warning",
        message: "No PR found for response",
        worktree: "main",
      }),
    ];
  }

  const promptVars: Record<string, string> = {
    PR_NUMBER: String(prNumber),
    ISSUE_NUMBER: String(issueNumber),
    HEAD_REF: context.pr?.headRef ?? context.branch ?? "",
    BASE_REF: context.pr?.baseRef ?? "main",
    REPO_OWNER: context.owner,
    REPO_NAME: context.repo,
    REVIEW_DECISION: context.reviewDecision ?? "N/A",
    REVIEWER: context.reviewerId ?? "N/A",
    AGENT_NOTES: "",
  };

  const responseArtifact = {
    name: "claude-pr-response-output",
    path: "claude-structured-output.json",
  };

  return [
    actions.runClaude.create({
      promptDir: "review-response",
      promptVars,
      issueNumber,
      producesArtifact: responseArtifact,
    }),
    actions.applyPRResponseOutput.create({
      prNumber,
      issueNumber,
      filePath: "claude-structured-output.json",
      consumesArtifact: responseArtifact,
      reviewer: "nopo-reviewer",
      worktree: "main",
    }),
  ];
}

/**
 * Emit action to run Claude to respond to human's review feedback
 */
export function runClaudePRHumanResponse({
  context,
}: ActionContext): ActionResult {
  const issueNumber = context.currentSubIssue?.number ?? context.issue.number;
  const prNumber = context.pr?.number;

  if (!prNumber) {
    return [
      actions.log.create({
        level: "warning",
        message: "No PR found for human response",
        worktree: "main",
      }),
    ];
  }

  const promptVars: Record<string, string> = {
    PR_NUMBER: String(prNumber),
    ISSUE_NUMBER: String(issueNumber),
    HEAD_REF: context.pr?.headRef ?? context.branch ?? "",
    BASE_REF: context.pr?.baseRef ?? "main",
    REPO_OWNER: context.owner,
    REPO_NAME: context.repo,
    REVIEW_DECISION: context.reviewDecision ?? "N/A",
    REVIEWER: context.reviewerId ?? "N/A",
    AGENT_NOTES: "",
  };

  const responseArtifact = {
    name: "claude-pr-human-response-output",
    path: "claude-structured-output.json",
  };

  return [
    actions.runClaude.create({
      promptDir: "human-review-response",
      promptVars,
      issueNumber,
      producesArtifact: responseArtifact,
    }),
    actions.applyPRResponseOutput.create({
      prNumber,
      issueNumber,
      filePath: "claude-structured-output.json",
      consumesArtifact: responseArtifact,
      reviewer: context.reviewerId ?? "nopo-reviewer",
      worktree: "main",
    }),
  ];
}

// ============================================================================
// Compound: Orchestration
// ============================================================================

/**
 * Emit actions for complete orchestration flow
 */
export function orchestrate({ context }: ActionContext): ActionResult {
  const result: Action[] = [];

  result.push(
    actions.log.create({
      level: "info",
      message: `Orchestrating issue #${context.issue.number} with ${context.issue.subIssues.length} phases`,
      worktree: "main",
    }),
  );

  // Check if parent needs initialization
  const needsInit =
    context.issue.projectStatus === null ||
    context.issue.projectStatus === "Backlog";

  if (needsInit) {
    result.push(
      actions.appendHistory.create({
        issueNumber: context.issue.number,
        iteration: context.issue.iteration,
        phase: "1",
        message: HISTORY_MESSAGES.initialized(context.issue.subIssues.length),
        timestamp: context.workflowStartedAt ?? undefined,
      }),
    );
  }

  // Check if current phase is complete and needs advancement
  const phaseComplete =
    context.currentSubIssue && context.currentSubIssue.state === "CLOSED";

  if (phaseComplete && context.currentPhase !== null) {
    const hasNext = context.currentPhase < context.totalPhases;
    if (hasNext) {
      result.push(...emitAdvancePhase({ context }));
    }
  }

  // Determine which sub-issue to assign
  let subIssueToAssign = context.currentSubIssue;

  if (phaseComplete && context.currentPhase !== null) {
    const nextPhase = context.currentPhase + 1;
    if (nextPhase <= context.totalPhases) {
      subIssueToAssign = context.issue.subIssues[nextPhase - 1] ?? null;
    } else {
      subIssueToAssign = null;
    }
  }

  // Assign nopo-bot to the parent issue for visibility
  if (!context.issue.assignees.includes(context.botUsername)) {
    result.push(
      actions.assignUser.create({
        issueNumber: context.issue.number,
        username: context.botUsername,
      }),
    );
  }

  // Assign nopo-bot to the sub-issue to trigger iteration.
  if (
    subIssueToAssign &&
    !subIssueToAssign.assignees.includes(context.botUsername)
  ) {
    result.push(
      actions.assignUser.create({
        issueNumber: subIssueToAssign.number,
        username: context.botUsername,
      }),
    );
  }

  return result;
}

/**
 * Emit actions when all phases are done
 */
export function allPhasesDone({ context }: ActionContext): ActionResult {
  return [
    actions.log.create({
      level: "info",
      message: `All phases complete for issue #${context.issue.number}`,
      worktree: "main",
    }),
    actions.updateProjectStatus.create({
      issueNumber: context.issue.number,
      status: "Done",
    }),
    actions.closeIssue.create({
      issueNumber: context.issue.number,
      reason: "completed" as const,
    }),
    actions.appendHistory.create({
      issueNumber: context.issue.number,
      iteration: context.issue.iteration,
      phase: "-",
      message: HISTORY_MESSAGES.ALL_PHASES_COMPLETE,
      timestamp: context.workflowStartedAt ?? undefined,
    }),
  ];
}

// ============================================================================
// Compound: Reset Issue
// ============================================================================

/**
 * Emit actions to reset the issue (and sub-issues) to initial state
 */
export function resetIssue({ context }: ActionContext): ActionResult {
  const result: ActionResult = [
    actions.resetIssue.create({
      issueNumber: context.issue.number,
      subIssueNumbers: context.issue.subIssues.map((s) => s.number),
      botUsername: context.botUsername,
    }),
    actions.updateProjectStatus.create({
      issueNumber: context.issue.number,
      status: "Backlog",
    }),
    actions.clearFailures.create({
      issueNumber: context.issue.number,
    }),
  ];

  for (const subIssue of context.issue.subIssues) {
    result.push(
      actions.removeFromProject.create({
        issueNumber: subIssue.number,
      }),
    );
    result.push(
      actions.clearFailures.create({
        issueNumber: subIssue.number,
      }),
    );
  }

  return result;
}

// ============================================================================
// Compound: Retry Issue
// ============================================================================

/**
 * Emit actions to retry the issue (circuit breaker recovery)
 */
export function retryIssue({ context }: ActionContext): ActionResult {
  const result: ActionResult = [];

  result.push(
    actions.clearFailures.create({
      issueNumber: context.issue.number,
    }),
  );

  if (context.currentSubIssue) {
    result.push(
      actions.clearFailures.create({
        issueNumber: context.currentSubIssue.number,
      }),
    );
    result.push(
      actions.updateProjectStatus.create({
        issueNumber: context.currentSubIssue.number,
        status: null,
      }),
    );
  }

  result.push(
    actions.updateProjectStatus.create({
      issueNumber: context.issue.number,
      status: "In progress",
    }),
  );

  if (!context.issue.assignees.includes(context.botUsername)) {
    result.push(
      actions.assignUser.create({
        issueNumber: context.issue.number,
        username: context.botUsername,
      }),
    );
  }

  return result;
}

// ============================================================================
// Compound: Push to Draft
// ============================================================================

/**
 * Emit actions for push-to-draft flow
 */
export function pushToDraft({ context }: ActionContext): ActionResult {
  const result: Action[] = [];

  if (context.pr) {
    result.push(
      actions.convertPRToDraft.create({
        prNumber: context.pr.number,
      }),
    );
    result.push(
      actions.removeReviewer.create({
        prNumber: context.pr.number,
        reviewer: "nopo-bot",
      }),
    );
  }

  const issueNumber = context.currentSubIssue?.number ?? context.issue.number;
  const phase = String(context.currentPhase ?? "-");

  result.push(
    actions.appendHistory.create({
      issueNumber,
      iteration: 0,
      phase,
      message: HISTORY_MESSAGES.CODE_PUSHED,
      commitSha: context.ciCommitSha ?? undefined,
      runLink: context.ciRunUrl ?? undefined,
    }),
  );

  return result;
}

// ============================================================================
// Complex: Grooming
// ============================================================================

/**
 * Emit action to run Claude grooming agents in parallel
 */
export function runClaudeGrooming({ context }: ActionContext): ActionResult {
  const issueNumber = context.issue.number;
  const issueComments = formatCommentsForPrompt(context.issue.comments ?? []);

  const promptVars: Record<string, string> = {
    ISSUE_NUMBER: String(context.issue.number),
    ISSUE_TITLE: context.issue.title,
    ISSUE_BODY: serializeMarkdown(context.issue.bodyAst),
    ISSUE_COMMENTS: issueComments,
    ISSUE_LABELS: context.issue.labels.join(", "),
  };

  const groomingArtifact = {
    name: "claude-grooming-output",
    path: "grooming-output.json",
  };

  return [
    actions.appendHistory.create({
      issueNumber,
      iteration: 0,
      phase: "groom",
      message: HISTORY_MESSAGES.GROOMING,
      timestamp: context.workflowStartedAt ?? undefined,
      runLink: context.workflowRunUrl ?? context.ciRunUrl ?? undefined,
    }),
    actions.runClaudeGrooming.create({
      issueNumber,
      promptVars,
      producesArtifact: groomingArtifact,
    }),
    actions.applyGroomingOutput.create({
      issueNumber,
      filePath: "grooming-output.json",
      consumesArtifact: groomingArtifact,
    }),
    actions.reconcileSubIssues.create({
      issueNumber,
    }),
  ];
}

// ============================================================================
// Complex: Pivot
// ============================================================================

/**
 * Emit action to run Claude for issue pivot analysis
 */
export function runClaudePivot({ context }: ActionContext): ActionResult {
  const issueNumber = context.issue.number;

  const subIssuesInfo = context.issue.subIssues.map((s) => ({
    number: s.number,
    title: s.title,
    state: s.state,
    body: serializeMarkdown(s.bodyAst),
    projectStatus: s.projectStatus,
    todos: extractTodosFromAst(s.bodyAst),
  }));

  const issueComments = formatCommentsForPrompt(context.issue.comments ?? []);

  const promptVars: Record<string, string> = {
    ISSUE_NUMBER: String(issueNumber),
    ISSUE_TITLE: context.issue.title,
    ISSUE_BODY: serializeMarkdown(context.issue.bodyAst),
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
    actions.appendHistory.create({
      issueNumber,
      iteration: context.issue.iteration,
      phase: "pivot",
      message: HISTORY_MESSAGES.ANALYZING_PIVOT,
      timestamp: context.workflowStartedAt ?? undefined,
      runLink: context.workflowRunUrl ?? context.ciRunUrl ?? undefined,
    }),
    actions.runClaude.create({
      promptDir: "pivot",
      promptVars,
      issueNumber,
      producesArtifact: pivotArtifact,
    }),
    actions.applyPivotOutput.create({
      issueNumber,
      filePath: "claude-structured-output.json",
      consumesArtifact: pivotArtifact,
    }),
  ];
}

// ============================================================================
// Compound: Invalid Iteration
// ============================================================================

/**
 * Emit action to log invalid iteration attempt
 */
export function logInvalidIteration({ context }: ActionContext): ActionResult {
  const message = HISTORY_MESSAGES.INVALID_ITERATION;

  return [
    actions.appendHistory.create({
      issueNumber: context.issue.number,
      iteration: context.issue.iteration,
      phase: String(context.currentPhase ?? "-"),
      message,
      timestamp: context.workflowStartedAt ?? undefined,
      commitSha: context.ciCommitSha ?? undefined,
      runLink: context.ciRunUrl ?? undefined,
    }),
    actions.addComment.create({
      issueNumber: context.issue.number,
      body:
        `## ❌ Invalid Iteration Attempt\n\n` +
        `This issue cannot be iterated on directly because it has no parent issue.\n\n` +
        `**Only sub-issues can be iterated on.** Parent issues must go through ` +
        `orchestration which manages their sub-issues.\n\n` +
        `### To Fix\n\n` +
        `1. Run grooming on this issue to create sub-issues\n` +
        `2. Then trigger orchestration on the parent issue\n\n` +
        `Issue #${context.issue.number} has been set to Error status.`,
    }),
  ];
}

// ============================================================================
// Merge Queue / Deployment Logging
// ============================================================================

/**
 * Emit action to log merge queue entry
 */
export function mergeQueueEntry({ context }: ActionContext): ActionResult {
  const issueNumber = context.currentSubIssue?.number ?? context.issue.number;
  const phase = String(context.currentPhase ?? "-");
  const iteration = context.issue.iteration ?? 0;

  return [
    actions.appendHistory.create({
      issueNumber,
      iteration,
      phase,
      message: HISTORY_MESSAGES.ENTERED_QUEUE,
      timestamp: context.workflowStartedAt ?? undefined,
      runLink: context.ciRunUrl ?? undefined,
    }),
  ];
}

/**
 * Emit action to log queue exit due to failure
 */
export function mergeQueueFailure({ context }: ActionContext): ActionResult {
  const issueNumber = context.currentSubIssue?.number ?? context.issue.number;
  const phase = String(context.currentPhase ?? "-");
  const iteration = context.issue.iteration ?? 0;

  return [
    actions.appendHistory.create({
      issueNumber,
      iteration,
      phase,
      message: HISTORY_MESSAGES.REMOVED_FROM_QUEUE,
      timestamp: context.workflowStartedAt ?? undefined,
      runLink: context.ciRunUrl ?? undefined,
    }),
  ];
}

/**
 * Emit action to log PR merged
 */
export function merged({ context }: ActionContext): ActionResult {
  const issueNumber = context.currentSubIssue?.number ?? context.issue.number;
  const phase = String(context.currentPhase ?? "-");
  const iteration = context.issue.iteration ?? 0;

  return [
    actions.appendHistory.create({
      issueNumber,
      iteration,
      phase,
      message: HISTORY_MESSAGES.MERGED,
      timestamp: context.workflowStartedAt ?? undefined,
      commitSha: context.ciCommitSha ?? undefined,
      runLink: context.ciRunUrl ?? undefined,
    }),
  ];
}

/**
 * Emit action to log stage deployment success
 */
export function deployedStage({ context }: ActionContext): ActionResult {
  const issueNumber = context.currentSubIssue?.number ?? context.issue.number;
  const phase = String(context.currentPhase ?? "-");
  const iteration = context.issue.iteration ?? 0;

  return [
    actions.appendHistory.create({
      issueNumber,
      iteration,
      phase,
      message: HISTORY_MESSAGES.DEPLOYED_STAGE,
      timestamp: context.workflowStartedAt ?? undefined,
      commitSha: context.ciCommitSha ?? undefined,
      runLink: context.ciRunUrl ?? undefined,
    }),
  ];
}

/**
 * Emit action to log production deployment success
 */
export function deployedProd({ context }: ActionContext): ActionResult {
  const issueNumber = context.currentSubIssue?.number ?? context.issue.number;
  const phase = String(context.currentPhase ?? "-");
  const iteration = context.issue.iteration ?? 0;

  return [
    actions.appendHistory.create({
      issueNumber,
      iteration,
      phase,
      message: HISTORY_MESSAGES.RELEASED_PROD,
      timestamp: context.workflowStartedAt ?? undefined,
      commitSha: context.ciCommitSha ?? undefined,
      runLink: context.ciRunUrl ?? undefined,
    }),
  ];
}

/**
 * Emit action to log stage deployment failure
 */
export function deployedStageFailure({ context }: ActionContext): ActionResult {
  const issueNumber = context.currentSubIssue?.number ?? context.issue.number;
  const phase = String(context.currentPhase ?? "-");

  return [
    actions.appendHistory.create({
      issueNumber,
      iteration: context.issue.iteration ?? 0,
      phase,
      message: HISTORY_MESSAGES.STAGE_DEPLOY_FAILED,
      runLink: context.ciRunUrl ?? undefined,
    }),
  ];
}

/**
 * Emit action to log production deployment failure
 */
export function deployedProdFailure({ context }: ActionContext): ActionResult {
  const issueNumber = context.currentSubIssue?.number ?? context.issue.number;
  const phase = String(context.currentPhase ?? "-");

  return [
    actions.appendHistory.create({
      issueNumber,
      iteration: context.issue.iteration ?? 0,
      phase,
      message: HISTORY_MESSAGES.PROD_DEPLOY_FAILED,
      runLink: context.ciRunUrl ?? undefined,
    }),
  ];
}

// ============================================================================
// Private Helpers (used in this file only)
// ============================================================================

/**
 * Emit action to mark PR as ready for review
 */
function emitMarkReady({ context }: ActionContext): ActionResult {
  if (!context.pr) {
    return [];
  }
  return [
    actions.markPRReady.create({
      prNumber: context.pr.number,
    }),
  ];
}

/**
 * Emit action to request review
 */
function emitRequestReview({ context }: ActionContext): ActionResult {
  if (!context.pr) {
    return [];
  }
  return [
    actions.requestReview.create({
      prNumber: context.pr.number,
      reviewer: "nopo-reviewer",
    }),
  ];
}

/**
 * Emit actions to advance to next phase.
 */
function emitAdvancePhase({ context }: ActionContext): ActionResult {
  const result: Action[] = [];

  if (!context.currentSubIssue || context.currentPhase === null) {
    return result;
  }

  result.push(
    actions.updateProjectStatus.create({
      issueNumber: context.currentSubIssue.number,
      status: "Done",
    }),
  );

  result.push(
    actions.closeIssue.create({
      issueNumber: context.currentSubIssue.number,
      reason: "completed" as const,
    }),
  );

  const nextPhase = context.currentPhase + 1;
  const nextSubIssue = context.issue.subIssues[nextPhase - 1];

  if (nextSubIssue) {
    result.push(
      actions.appendHistory.create({
        issueNumber: context.issue.number,
        iteration: context.issue.iteration,
        phase: String(nextPhase),
        message: HISTORY_MESSAGES.phaseStarted(nextPhase),
        timestamp: context.workflowStartedAt ?? undefined,
      }),
    );
  }

  return result;
}
