/**
 * Discussion Automation State Machine
 *
 * A simpler state machine for GitHub Discussions automation.
 * Unlike the issue machine, this handles:
 * - Research (spawning investigation threads)
 * - Responding to comments
 * - Commands (/summarize, /plan, /complete)
 *
 * No CI loop, no PR flow, no project fields.
 */

import { setup, assign } from "xstate";
import type { DiscussionContext } from "../schemas/discussion-context.js";
import type { DiscussionAction } from "./actions.js";
import { discussionGuards } from "./guards.js";
import {
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

/**
 * Extended context that includes accumulated actions
 */
export interface DiscussionMachineContext extends DiscussionContext {
  pendingActions: DiscussionAction[];
}

/**
 * Machine events - discussions determine state from context, not events
 */
type DiscussionMachineEvent = { type: "START" };

/**
 * Helper to accumulate actions into context
 */
function accumulateActions(
  existingActions: DiscussionAction[],
  newActions: DiscussionAction[],
): DiscussionAction[] {
  return [...existingActions, ...newActions];
}

/**
 * The Discussion automation state machine
 *
 * State diagram:
 *
 *                          detecting
 *                              │
 *         ┌────────────────────┼────────────────────┐
 *         │                    │                    │
 *         ▼                    ▼                    ▼
 *    researching          responding           commanding
 *    (new discussion)   (human comment)            │
 *         │                    │          ┌────────┼────────┐
 *         ▼                    ▼          ▼        ▼        ▼
 *       done                 done    summarizing planning completing
 *                                        │        │        │
 *                                        ▼        ▼        ▼
 *                                      done     done     done
 */
export const discussionMachine = setup({
  types: {
    context: {} as DiscussionMachineContext,
    events: {} as DiscussionMachineEvent,
    input: {} as DiscussionContext,
  },
  guards: {
    // Trigger guards
    triggeredByDiscussionCreated: ({ context }) =>
      discussionGuards.triggeredByDiscussionCreated({ context }),
    triggeredByDiscussionComment: ({ context }) =>
      discussionGuards.triggeredByDiscussionComment({ context }),
    triggeredByDiscussionCommand: ({ context }) =>
      discussionGuards.triggeredByDiscussionCommand({ context }),
    // Command guards
    commandIsSummarize: ({ context }) =>
      discussionGuards.commandIsSummarize({ context }),
    commandIsPlan: ({ context }) => discussionGuards.commandIsPlan({ context }),
    commandIsComplete: ({ context }) =>
      discussionGuards.commandIsComplete({ context }),
    // Author guards
    isHumanComment: ({ context }) =>
      discussionGuards.isHumanComment({ context }),
    isBotResearchThread: ({ context }) =>
      discussionGuards.isBotResearchThread({ context }),
    // State guards
    hasDiscussionContext: ({ context }) =>
      discussionGuards.hasDiscussionContext({ context }),
    noDiscussionContext: ({ context }) =>
      !discussionGuards.hasDiscussionContext({ context }),
    isHumanDiscussionComment: ({ context }) =>
      discussionGuards.triggeredByDiscussionComment({ context }) &&
      discussionGuards.isHumanComment({ context }),
  },
  actions: {
    // Logging actions
    logDetecting: assign({
      pendingActions: ({ context }) =>
        accumulateActions(context.pendingActions, [
          {
            type: "log",
            token: "code",
            level: "info",
            message: "Detecting discussion trigger type",
          },
        ]),
    }),
    logResearching: assign({
      pendingActions: ({ context }) =>
        accumulateActions(
          context.pendingActions,
          emitLogResearching({ context }),
        ),
    }),
    logResponding: assign({
      pendingActions: ({ context }) =>
        accumulateActions(
          context.pendingActions,
          emitLogResponding({ context }),
        ),
    }),
    logSummarizing: assign({
      pendingActions: ({ context }) =>
        accumulateActions(
          context.pendingActions,
          emitLogSummarizing({ context }),
        ),
    }),
    logPlanning: assign({
      pendingActions: ({ context }) =>
        accumulateActions(context.pendingActions, emitLogPlanning({ context })),
    }),
    logCompleting: assign({
      pendingActions: ({ context }) =>
        accumulateActions(
          context.pendingActions,
          emitLogCompleting({ context }),
        ),
    }),
    logSkipped: assign({
      pendingActions: ({ context }) =>
        accumulateActions(context.pendingActions, [
          {
            type: "log",
            token: "code",
            level: "info",
            message: `Skipping - bot comment or no action needed for discussion #${context.discussion.number}`,
          },
        ]),
    }),
    logNoContext: assign({
      pendingActions: ({ context }) =>
        accumulateActions(context.pendingActions, [
          {
            type: "log",
            token: "code",
            level: "warning",
            message: "No discussion context available",
          },
        ]),
    }),

    // Research actions
    runClaudeResearch: assign({
      pendingActions: ({ context }) =>
        accumulateActions(
          context.pendingActions,
          emitRunClaudeResearch({ context }),
        ),
    }),

    // Respond actions
    runClaudeRespond: assign({
      pendingActions: ({ context }) =>
        accumulateActions(
          context.pendingActions,
          emitRunClaudeRespond({ context }),
        ),
    }),

    // Summarize actions
    runClaudeSummarize: assign({
      pendingActions: ({ context }) =>
        accumulateActions(
          context.pendingActions,
          emitRunClaudeSummarize({ context }),
        ),
    }),

    // Plan actions
    runClaudePlan: assign({
      pendingActions: ({ context }) =>
        accumulateActions(
          context.pendingActions,
          emitRunClaudePlan({ context }),
        ),
    }),

    // Complete actions
    complete: assign({
      pendingActions: ({ context }) =>
        accumulateActions(context.pendingActions, emitComplete({ context })),
    }),
  },
}).createMachine({
  id: "discussion-automation",
  initial: "detecting",
  context: ({ input }) => ({
    ...input,
    pendingActions: [],
  }),

  states: {
    /**
     * Initial state - determine what to do based on trigger type
     */
    detecting: {
      entry: "logDetecting",
      always: [
        // No discussion context - error
        {
          target: "noContext",
          guard: "noDiscussionContext",
        },
        // New discussion created - spawn research threads
        {
          target: "researching",
          guard: "triggeredByDiscussionCreated",
        },
        // Command triggered - route to appropriate handler
        {
          target: "commanding",
          guard: "triggeredByDiscussionCommand",
        },
        // Discussion comment - respond
        {
          target: "responding",
          guard: "triggeredByDiscussionComment",
        },
        // Default - skip (unknown trigger)
        { target: "skipped" },
      ],
    },

    /**
     * No discussion context available
     */
    noContext: {
      entry: "logNoContext",
      type: "final",
    },

    /**
     * Skipped - no action needed
     */
    skipped: {
      entry: "logSkipped",
      type: "final",
    },

    /**
     * Research a new discussion
     * Spawns research threads to investigate the topic
     */
    researching: {
      entry: ["logResearching", "runClaudeResearch"],
      type: "final",
    },

    /**
     * Respond to a human comment
     */
    responding: {
      entry: ["logResponding", "runClaudeRespond"],
      type: "final",
    },

    /**
     * Handle a slash command - route to specific handler
     */
    commanding: {
      always: [
        { target: "summarizing", guard: "commandIsSummarize" },
        { target: "planning", guard: "commandIsPlan" },
        { target: "completing", guard: "commandIsComplete" },
        // Unknown command - skip
        { target: "skipped" },
      ],
    },

    /**
     * Summarize the discussion (/summarize command)
     */
    summarizing: {
      entry: ["logSummarizing", "runClaudeSummarize"],
      type: "final",
    },

    /**
     * Create issues from discussion (/plan command)
     */
    planning: {
      entry: ["logPlanning", "runClaudePlan"],
      type: "final",
    },

    /**
     * Mark discussion as complete (/complete command)
     */
    completing: {
      entry: ["logCompleting", "complete"],
      type: "final",
    },
  },
});

/**
 * Get pending actions from the machine's final context
 */
export function getDiscussionActions(
  context: DiscussionMachineContext,
): DiscussionAction[] {
  return context.pendingActions;
}
