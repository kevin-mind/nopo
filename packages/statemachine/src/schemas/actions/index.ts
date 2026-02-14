/**
 * Actions Barrel
 *
 * Collects all domain action objects into a single `actions` export.
 * Derives ActionSchema, per-action types, and helper utilities.
 */

import { z } from "zod";
import type { RunnerContext, ActionChainContext } from "../../runner/types.js";

// Re-export shared infrastructure
export {
  type PredictDiff,
  type PredictContext,
  type TokenType,
  type ResearchThread,
  type GroomingAgentType,
  GroomingAgentTypeSchema,
} from "./_shared.js";

// Re-export grooming helpers for tests
export {
  buildPhaseIssueBody,
  extractExistingTodos,
  normalizeTodoText,
  mergeTodos,
  buildFallbackSummary,
  buildQuestionsContent,
} from "./grooming.js";

// Import domain action objects
import { controlActions } from "./control.js";
import { projectActions } from "./project.js";
import { githubActions } from "./github.js";
import { claudeActions } from "./claude.js";
import { applyActions } from "./apply.js";
import { groomingActions } from "./grooming.js";
import { discussionActions } from "./discussions.js";

// ============================================================================
// Unified Actions Object
// ============================================================================

export const actions = {
  ...projectActions,
  ...githubActions,
  ...claudeActions,
  ...applyActions,
  ...groomingActions,
  ...discussionActions,
  ...controlActions,
};

// ============================================================================
// Discriminated Union of All Actions
// ============================================================================

type ActionSchemaUnion = (typeof actions)[keyof typeof actions]["schema"];
const allSchemas: ActionSchemaUnion[] = Object.values(actions).map(
  (def) => def.schema,
);

/**
 * All possible action types as a discriminated union
 */
export const ActionSchema = z.discriminatedUnion(
  "type",
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- Zod requires a non-empty tuple type for discriminatedUnion
  allSchemas as [ActionSchemaUnion, ...ActionSchemaUnion[]],
);

export type Action = z.infer<typeof ActionSchema>;

// ============================================================================
// Per-Action Type Aliases
// ============================================================================

export type UpdateProjectStatusAction = z.infer<
  typeof actions.updateProjectStatus.schema
>;
export type IncrementIterationAction = z.infer<
  typeof actions.incrementIteration.schema
>;
export type RecordFailureAction = z.infer<typeof actions.recordFailure.schema>;
export type ClearFailuresAction = z.infer<typeof actions.clearFailures.schema>;
export type RemoveFromProjectAction = z.infer<
  typeof actions.removeFromProject.schema
>;
export type CreateSubIssuesAction = z.infer<
  typeof actions.createSubIssues.schema
>;
export type CloseIssueAction = z.infer<typeof actions.closeIssue.schema>;
export type ReopenIssueAction = z.infer<typeof actions.reopenIssue.schema>;
export type ResetIssueAction = z.infer<typeof actions.resetIssue.schema>;
export type AppendHistoryAction = z.infer<typeof actions.appendHistory.schema>;
export type UpdateHistoryAction = z.infer<typeof actions.updateHistory.schema>;
export type UpdateIssueBodyAction = z.infer<
  typeof actions.updateIssueBody.schema
>;
export type AddCommentAction = z.infer<typeof actions.addComment.schema>;
export type UnassignUserAction = z.infer<typeof actions.unassignUser.schema>;
export type AssignUserAction = z.infer<typeof actions.assignUser.schema>;
export type AddLabelAction = z.infer<typeof actions.addLabel.schema>;
export type RemoveLabelAction = z.infer<typeof actions.removeLabel.schema>;
export type CreateBranchAction = z.infer<typeof actions.createBranch.schema>;
export type GitPushAction = z.infer<typeof actions.gitPush.schema>;
export type CreatePRAction = z.infer<typeof actions.createPR.schema>;
export type ConvertPRToDraftAction = z.infer<
  typeof actions.convertPRToDraft.schema
>;
export type MarkPRReadyAction = z.infer<typeof actions.markPRReady.schema>;
export type RequestReviewAction = z.infer<typeof actions.requestReview.schema>;
export type MergePRAction = z.infer<typeof actions.mergePR.schema>;
export type SubmitReviewAction = z.infer<typeof actions.submitReview.schema>;
export type RemoveReviewerAction = z.infer<
  typeof actions.removeReviewer.schema
>;
export type RunClaudeAction = z.infer<typeof actions.runClaude.schema>;
export type BlockAction = z.infer<typeof actions.block.schema>;
export type ApplyTriageOutputAction = z.infer<
  typeof actions.applyTriageOutput.schema
>;
export type ApplyIterateOutputAction = z.infer<
  typeof actions.applyIterateOutput.schema
>;
export type AppendAgentNotesAction = z.infer<
  typeof actions.appendAgentNotes.schema
>;
export type ApplyReviewOutputAction = z.infer<
  typeof actions.applyReviewOutput.schema
>;
export type ApplyPRResponseOutputAction = z.infer<
  typeof actions.applyPRResponseOutput.schema
>;
export type RunClaudeGroomingAction = z.infer<
  typeof actions.runClaudeGrooming.schema
>;
export type ApplyGroomingOutputAction = z.infer<
  typeof actions.applyGroomingOutput.schema
>;
export type ReconcileSubIssuesAction = z.infer<
  typeof actions.reconcileSubIssues.schema
>;
export type ApplyPivotOutputAction = z.infer<
  typeof actions.applyPivotOutput.schema
>;
export type AddDiscussionCommentAction = z.infer<
  typeof actions.addDiscussionComment.schema
>;
export type UpdateDiscussionBodyAction = z.infer<
  typeof actions.updateDiscussionBody.schema
>;
export type AddDiscussionReactionAction = z.infer<
  typeof actions.addDiscussionReaction.schema
>;
export type CreateIssuesFromDiscussionAction = z.infer<
  typeof actions.createIssuesFromDiscussion.schema
>;
export type ApplyDiscussionResearchOutputAction = z.infer<
  typeof actions.applyDiscussionResearchOutput.schema
>;
export type ApplyDiscussionRespondOutputAction = z.infer<
  typeof actions.applyDiscussionRespondOutput.schema
>;
export type ApplyDiscussionSummarizeOutputAction = z.infer<
  typeof actions.applyDiscussionSummarizeOutput.schema
>;
export type ApplyDiscussionPlanOutputAction = z.infer<
  typeof actions.applyDiscussionPlanOutput.schema
>;
export type InvestigateResearchThreadsAction = z.infer<
  typeof actions.investigateResearchThreads.schema
>;
export type UpdateDiscussionSummaryAction = z.infer<
  typeof actions.updateDiscussionSummary.schema
>;

// ============================================================================
// Hydrated Action Type
// ============================================================================

/**
 * An action instance with `execute` attached (non-enumerable).
 * Produced by `actions.foo.create()`.
 */
export type HydratedAction = Action & {
  execute(ctx: RunnerContext, chainCtx?: ActionChainContext): Promise<unknown>;
};

/**
 * Reattach execute methods to JSON-deserialized actions.
 * Used at the sm-plan → sm-run boundary where actions are serialized between jobs.
 */
export function hydrateActions(raw: Action[]): HydratedAction[] {
  return raw.map((a) => {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- Action.type is a string union; narrowing to keyof is safe at runtime
    const def = actions[a.type as keyof typeof actions];
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- create() returns plain object; casting to HydratedAction after execute is attached
    return def.create(a) as HydratedAction;
  });
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Actions that should stop further execution
 */
export function isTerminalAction(action: Action): boolean {
  return action.type === "stop" || action.type === "block";
}

/**
 * Actions that should stop on error
 */
export function shouldStopOnError(actionType: Action["type"]): boolean {
  const criticalActions: Action["type"][] = [
    "runClaude",
    "createPR",
    "mergePR",
    "createSubIssues",
    "block",
  ];
  return criticalActions.includes(actionType);
}

// ============================================================================
// Action Type Constants
// ============================================================================

/**
 * All action types as a const array for runtime use
 */
// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- Object.keys returns string[]; narrowing to Action["type"][] is safe since actions keys match the union
export const ACTION_TYPES = Object.keys(actions) as Action["type"][];

// ============================================================================
// Action Type Guards for Domain Discrimination
// ============================================================================

export const ISSUE_ACTION_TYPES = [
  "updateProjectStatus",
  "incrementIteration",
  "recordFailure",
  "clearFailures",
  "removeFromProject",
  "createSubIssues",
  "closeIssue",
  "reopenIssue",
  "resetIssue",
  "appendHistory",
  "updateHistory",
  "updateIssueBody",
  "addComment",
  "unassignUser",
  "assignUser",
  "addLabel",
  "removeLabel",
  "createBranch",
  "gitPush",
  "createPR",
  "convertPRToDraft",
  "markPRReady",
  "requestReview",
  "mergePR",
  "submitReview",
  "removeReviewer",
  "runClaude",
  "runClaudeGrooming",
  "applyGroomingOutput",
  "reconcileSubIssues",
  "applyPivotOutput",
  "applyTriageOutput",
  "applyIterateOutput",
  "appendAgentNotes",
  "applyReviewOutput",
  "applyPRResponseOutput",
  "block",
] as const;

export const DISCUSSION_ACTION_TYPES = [
  "addDiscussionComment",
  "updateDiscussionBody",
  "addDiscussionReaction",
  "createIssuesFromDiscussion",
  "applyDiscussionResearchOutput",
  "applyDiscussionRespondOutput",
  "applyDiscussionSummarizeOutput",
  "applyDiscussionPlanOutput",
] as const;

export const SHARED_ACTION_TYPES = [
  "stop",
  "log",
  "noop",
  "runClaude",
] as const;

export type IssueActionType = (typeof ISSUE_ACTION_TYPES)[number];
export type DiscussionActionType = (typeof DISCUSSION_ACTION_TYPES)[number];
export type SharedActionType = (typeof SHARED_ACTION_TYPES)[number];

export type IssueAction = Extract<Action, { type: IssueActionType }>;
export type DiscussionAction = Extract<Action, { type: DiscussionActionType }>;
export type SharedAction = Extract<Action, { type: SharedActionType }>;

const ISSUE_ACTION_SET = new Set<string>(ISSUE_ACTION_TYPES);
const DISCUSSION_ACTION_SET = new Set<string>(DISCUSSION_ACTION_TYPES);
const SHARED_ACTION_SET = new Set<string>(SHARED_ACTION_TYPES);

export function isIssueAction(action: Action): action is IssueAction {
  return ISSUE_ACTION_SET.has(action.type);
}

export function isDiscussionAction(action: Action): action is DiscussionAction {
  return DISCUSSION_ACTION_SET.has(action.type);
}

export function isSharedAction(action: Action): action is SharedAction {
  return SHARED_ACTION_SET.has(action.type);
}
