/**
 * Executor Index
 *
 * Re-exports all action executors for easy importing.
 */

// Project field executors
export {
  executeUpdateProjectStatus,
  executeIncrementIteration,
  executeRecordFailure,
  executeClearFailures,
  executeBlock,
} from "./project.js";

// GitHub executors
export {
  executeCloseIssue,
  executeAppendHistory,
  executeUpdateHistory,
  executeUpdateIssueBody,
  executeAddComment,
  executeUnassignUser,
  executeAssignUser,
  executeCreateSubIssues,
  executeCreatePR,
  executeConvertPRToDraft,
  executeMarkPRReady,
  executeRequestReview,
  executeMergePR,
  executeSubmitReview,
  executeRemoveReviewer,
  executeResetIssue,
  executeAddLabel,
  executeRemoveLabel,
} from "./github.js";

// Git executors
export {
  executeCreateBranch,
  executeGitPush,
  checkoutBranch,
  createOrCheckoutBranch,
  getCurrentBranch,
  getCurrentSha,
  hasUncommittedChanges,
  stageAllChanges,
  commit,
  fetch,
  rebase,
} from "./git.js";

// Claude executors
export { executeRunClaude, resolvePrompt } from "./claude.js";

// Triage executors
export { executeApplyTriageOutput } from "./triage.js";

// Iterate executors
export { executeApplyIterateOutput } from "./iterate.js";

// Review executors
export { executeApplyReviewOutput } from "./review.js";

// PR response executors
export { executeApplyPRResponseOutput } from "./pr-response.js";

// Agent notes executors
export { executeAppendAgentNotes } from "./agent-notes.js";

// Discussion executors
export {
  executeAddDiscussionComment,
  executeUpdateDiscussionBody,
  executeAddDiscussionReaction,
  executeCreateIssuesFromDiscussion,
} from "./discussions.js";

// Discussion apply executors
export {
  executeApplyDiscussionResearchOutput,
  executeApplyDiscussionRespondOutput,
  executeApplyDiscussionSummarizeOutput,
  executeApplyDiscussionPlanOutput,
} from "./discussion-apply.js";

// Discussion research executors
export {
  executeInvestigateResearchThreads,
  executeUpdateDiscussionSummary,
} from "./discussion-research.js";

// Grooming executors
export {
  executeRunClaudeGrooming,
  executeApplyGroomingOutput,
} from "./grooming.js";

// Pivot executors
export { executeApplyPivotOutput } from "./pivot.js";
