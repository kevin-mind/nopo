/**
 * Discussion State Machine
 *
 * Exports for the discussion automation state machine.
 */

// Action schemas
export {
  TokenTypeSchema,
  type TokenType,
  DiscussionActionSchema,
  type DiscussionAction,
  type DiscussionActionType,
  type AddDiscussionCommentAction,
  type UpdateDiscussionBodyAction,
  type AddDiscussionReactionAction,
  type CreateIssuesFromDiscussionAction,
  type ApplyDiscussionResearchOutputAction,
  type ApplyDiscussionRespondOutputAction,
  type ApplyDiscussionSummarizeOutputAction,
  type ApplyDiscussionPlanOutputAction,
  type RunClaudeAction,
  type LogAction,
  type Artifact,
  DISCUSSION_ACTION_TYPES,
} from "./actions.js";

// Guards
export { discussionGuards } from "./guards.js";

// Action emitters
export {
  emitRunClaudeResearch,
  emitRunClaudeRespond,
  emitRunClaudeSummarize,
  emitRunClaudePlan,
  emitComplete,
  emitLogResearching,
  emitLogResponding,
  emitLogSummarizing,
  emitLogPlanning,
  emitLogCompleting,
} from "./action-emitters.js";

// Machine
export {
  discussionMachine,
  getDiscussionActions,
  type DiscussionMachineContext,
} from "./machine.js";

// Context builder
export {
  buildDiscussionContext,
  type BuildDiscussionContextOptions,
} from "./context-builder.js";
