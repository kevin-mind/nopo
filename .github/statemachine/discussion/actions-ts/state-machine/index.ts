/**
 * Discussion State Machine
 *
 * A standalone state machine for handling GitHub Discussion automation.
 * This module provides research, response, and command handling for discussions.
 *
 * Usage:
 *   import { discussionMachine, buildDiscussionContext } from './index.js';
 *   import { createActor } from 'xstate';
 *
 *   const context = await buildDiscussionContext(octokit, owner, repo, discussionNumber, trigger, options);
 *   const actor = createActor(discussionMachine, { input: context });
 *   actor.start();
 *   const snapshot = actor.getSnapshot();
 *   const actions = snapshot.context.pendingActions;
 */

// Schema exports
export {
  // Triggers
  DiscussionTriggerTypeSchema,
  type DiscussionTriggerType,
  DISCUSSION_TRIGGER_TYPES,
  // Context
  DiscussionCommandSchema,
  type DiscussionCommand,
  DiscussionSchema,
  type Discussion,
  DiscussionContextSchema,
  type DiscussionContext,
  DISCUSSION_CONTEXT_DEFAULTS,
  type PartialDiscussionContext,
  createDiscussionContext,
  // Actions
  TokenTypeSchema,
  type TokenType,
  DiscussionActionSchema,
  type DiscussionAction,
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
  DISCUSSION_ACTION_TYPES,
  type DiscussionActionType,
} from "./schemas/index.js";

// Machine exports
export {
  discussionMachine,
  type DiscussionMachineContext,
  discussionGuards,
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
} from "./machine/index.js";

// Runner exports
export {
  executeAction,
  executeActions,
  type RunnerContext,
  executeAddDiscussionComment,
  executeUpdateDiscussionBody,
  executeAddDiscussionReaction,
  executeCreateIssuesFromDiscussion,
  executeApplyDiscussionResearchOutput,
  executeApplyDiscussionRespondOutput,
  executeApplyDiscussionSummarizeOutput,
  executeApplyDiscussionPlanOutput,
} from "./runner/index.js";

// Context builder
export { buildDiscussionContext } from "./context-builder.js";
