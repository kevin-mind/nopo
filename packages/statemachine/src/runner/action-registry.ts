/**
 * Action Registry
 *
 * Maps each action type to an executor. Ensures exhaustiveness: adding a new
 * action type to the Action union will require adding an executor here.
 *
 * Direct executor assignments work because ActionExecutorMap preserves the
 * per-key action type. Inline handlers get the narrowed type via contextual
 * typing from the mapped type.
 */

import * as core from "@actions/core";
import type { ActionExecutorMap } from "./create-action.js";
import { getStructuredOutput } from "./get-structured-output.js";
import * as executors from "./executors/index.js";

export const ACTION_REGISTRY: ActionExecutorMap = {
  // Project field actions
  updateProjectStatus: executors.executeUpdateProjectStatus,
  incrementIteration: executors.executeIncrementIteration,
  recordFailure: executors.executeRecordFailure,
  clearFailures: executors.executeClearFailures,
  removeFromProject: executors.executeRemoveFromProject,
  block: executors.executeBlock,

  // Issue actions
  closeIssue: executors.executeCloseIssue,
  reopenIssue: (action) => {
    core.info(`Reopen issue #${action.issueNumber} - handled by resetIssue`);
    return Promise.resolve({ reopened: true });
  },
  resetIssue: executors.executeResetIssue,
  appendHistory: executors.executeAppendHistory,
  updateHistory: executors.executeUpdateHistory,
  updateIssueBody: executors.executeUpdateIssueBody,
  addComment: executors.executeAddComment,
  unassignUser: executors.executeUnassignUser,
  assignUser: executors.executeAssignUser,
  createSubIssues: executors.executeCreateSubIssues,
  addLabel: executors.executeAddLabel,
  removeLabel: executors.executeRemoveLabel,

  // Git actions
  createBranch: executors.executeCreateBranch,
  gitPush: executors.executeGitPush,

  // PR actions
  createPR: executors.executeCreatePR,
  convertPRToDraft: executors.executeConvertPRToDraft,
  markPRReady: executors.executeMarkPRReady,
  requestReview: executors.executeRequestReview,
  mergePR: executors.executeMergePR,
  submitReview: executors.executeSubmitReview,
  removeReviewer: executors.executeRemoveReviewer,

  // Claude actions
  runClaude: executors.executeRunClaude,

  // Discussion actions
  addDiscussionComment: executors.executeAddDiscussionComment,
  updateDiscussionBody: executors.executeUpdateDiscussionBody,
  addDiscussionReaction: executors.executeAddDiscussionReaction,
  createIssuesFromDiscussion: executors.executeCreateIssuesFromDiscussion,

  // Triage / iterate / apply actions (need structured output)
  applyTriageOutput: (action, ctx, chainCtx) =>
    executors.executeApplyTriageOutput(
      action,
      ctx,
      getStructuredOutput(action, chainCtx),
    ),
  applyIterateOutput: (action, ctx, chainCtx) =>
    executors.executeApplyIterateOutput(
      action,
      ctx,
      getStructuredOutput(action, chainCtx),
    ),

  // Grooming actions
  runClaudeGrooming: executors.executeRunClaudeGrooming,
  applyGroomingOutput: (action, ctx, chainCtx) =>
    executors.executeApplyGroomingOutput(
      action,
      ctx,
      getStructuredOutput(action, chainCtx),
    ),
  reconcileSubIssues: (action, ctx, chainCtx) =>
    executors.executeReconcileSubIssues(
      action,
      ctx,
      getStructuredOutput(action, chainCtx),
    ),

  // Pivot actions
  applyPivotOutput: (action, ctx, chainCtx) =>
    executors.executeApplyPivotOutput(
      action,
      ctx,
      getStructuredOutput(action, chainCtx),
    ),

  // Agent notes actions
  appendAgentNotes: executors.executeAppendAgentNotes,

  // Review actions
  applyReviewOutput: (action, ctx, chainCtx) =>
    executors.executeApplyReviewOutput(
      action,
      ctx,
      getStructuredOutput(action, chainCtx),
    ),

  // PR response actions
  applyPRResponseOutput: (action, ctx, chainCtx) =>
    executors.executeApplyPRResponseOutput(
      action,
      ctx,
      getStructuredOutput(action, chainCtx),
    ),

  // Discussion apply actions
  applyDiscussionResearchOutput: (action, ctx, chainCtx) =>
    executors.executeApplyDiscussionResearchOutput(
      action,
      ctx,
      getStructuredOutput(action, chainCtx),
    ),
  applyDiscussionRespondOutput: (action, ctx, chainCtx) =>
    executors.executeApplyDiscussionRespondOutput(
      action,
      ctx,
      getStructuredOutput(action, chainCtx),
    ),
  applyDiscussionSummarizeOutput: (action, ctx, chainCtx) =>
    executors.executeApplyDiscussionSummarizeOutput(
      action,
      ctx,
      getStructuredOutput(action, chainCtx),
    ),
  applyDiscussionPlanOutput: (action, ctx, chainCtx) =>
    executors.executeApplyDiscussionPlanOutput(
      action,
      ctx,
      getStructuredOutput(action, chainCtx),
    ),
  investigateResearchThreads: executors.executeInvestigateResearchThreads,
  updateDiscussionSummary: executors.executeUpdateDiscussionSummary,

  // Control flow actions (inlined)
  stop: (action) => {
    core.info(`Stopping: ${action.reason}`);
    return Promise.resolve({ stopped: true, reason: action.reason });
  },
  log: (action) => {
    switch (action.level) {
      case "debug":
        core.debug(action.message);
        break;
      case "warning":
        core.warning(action.message);
        break;
      case "error":
        core.error(action.message);
        break;
      default:
        core.info(action.message);
    }
    return Promise.resolve({ logged: true });
  },
  noop: (action) => {
    core.debug(`No-op: ${action.reason || "no reason given"}`);
    return Promise.resolve({ noop: true });
  },
};
