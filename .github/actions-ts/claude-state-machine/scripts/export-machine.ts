#!/usr/bin/env tsx
/**
 * Export the Claude automation state machine for Stately Studio
 *
 * Usage:
 *   pnpm tsx scripts/export-machine.ts
 *   pnpm tsx scripts/export-machine.ts > machine.json
 *
 * Then import the JSON into Stately Studio: https://stately.ai/studio
 */

import { claudeMachine } from "../machine/machine.js";

interface ExportedState {
  type?: string;
  entry?: string[];
  always?: Array<{
    target?: string;
    guard?: string;
    actions?: string[];
  }>;
  on?: Record<string, unknown>;
}

interface ExportedMachine {
  id: string;
  initial: string;
  states: Record<string, ExportedState>;
  guards: string[];
  actions: string[];
}

function exportMachine(): ExportedMachine {
  const config = claudeMachine.config;

  // Extract guard names from the setup
  const guardNames = Object.keys(claudeMachine.implementations?.guards || {});

  // Extract action names from the setup
  const actionNames = Object.keys(claudeMachine.implementations?.actions || {});

  // Process states for export
  const states: Record<string, ExportedState> = {};

  const statesConfig = (config.states as Record<string, unknown>) || {};

  for (const [stateName, stateConfig] of Object.entries(statesConfig)) {
    const state = stateConfig as {
      type?: string;
      entry?: string | string[];
      always?: Array<{
        target?: string;
        guard?: string;
        actions?: string | string[];
      }>;
      on?: Record<string, unknown>;
    };

    const exportedState: ExportedState = {};

    if (state.type) {
      exportedState.type = state.type;
    }

    if (state.entry) {
      exportedState.entry = Array.isArray(state.entry)
        ? state.entry
        : [state.entry];
    }

    if (state.always) {
      // Handle always as array or single transition
      const alwaysArray = Array.isArray(state.always)
        ? state.always
        : [state.always];
      exportedState.always = alwaysArray.map((t) => {
        // Handle string shorthand (just a target state)
        if (typeof t === "string") {
          return { target: t };
        }
        return {
          target: t.target,
          guard: t.guard,
          actions: t.actions
            ? Array.isArray(t.actions)
              ? t.actions
              : [t.actions]
            : undefined,
        };
      });
    }

    if (state.on) {
      exportedState.on = state.on;
    }

    states[stateName] = exportedState;
  }

  return {
    id: (config.id as string) || "claude-automation",
    initial: (config.initial as string) || "detecting",
    states,
    guards: guardNames,
    actions: actionNames,
  };
}

function formatForStatelyStudio(): object {
  const machine = exportMachine();

  // Stately Studio format
  return {
    name: "Claude Automation State Machine",
    description:
      "State machine for managing Claude automation workflow on GitHub issues",
    machine: {
      id: machine.id,
      initial: machine.initial,
      states: machine.states,
    },
    meta: {
      guards: machine.guards.map((name) => ({
        name,
        description: getGuardDescription(name),
      })),
      actions: machine.actions.map((name) => ({
        name,
        description: getActionDescription(name),
      })),
    },
  };
}

function getGuardDescription(name: string): string {
  const descriptions: Record<string, string> = {
    isAlreadyDone: "Check if issue Project Status is Done",
    isBlocked: "Check if issue Project Status is Blocked",
    isError: "Check if issue Project Status is Error",
    needsSubIssues: "Check if issue needs sub-issues but has none",
    hasSubIssues: "Check if issue has sub-issues",
    isInReview: "Check if current context is in review state",
    allPhasesDone: "Check if all sub-issues have Status = Done",
    currentPhaseNeedsWork: "Check if current sub-issue needs work",
    currentPhaseInReview: "Check if current sub-issue is in review",
    todosDone: "Check if all non-manual todos are completed",
    maxFailuresReached: "Check if failures >= maxRetries",
    ciPassed: "Check if CI result is success",
    ciFailed: "Check if CI result is failure",
    reviewApproved: "Check if review decision is APPROVED",
    reviewRequestedChanges: "Check if review decision is CHANGES_REQUESTED",
    readyForReview: "Check if CI passed, todos done, and has PR",
    shouldContinueIterating: "Check if should continue iterating",
    shouldBlock: "Check if should trigger circuit breaker",
    hasPR: "Check if PR exists for current issue",
    prIsDraft: "Check if PR is in draft state",
    hasBranch: "Check if branch exists for current issue",
    triggeredByCI: "Check if event triggered by workflow_run_completed",
    triggeredByReview: "Check if event triggered by pr_review_submitted",
  };

  return descriptions[name] || `Guard: ${name}`;
}

function getActionDescription(name: string): string {
  const descriptions: Record<string, string> = {
    logDetecting: "Log that machine is detecting initial state",
    logIterating: "Log that machine is starting iteration",
    logReviewing: "Log that PR is under review",
    setWorking: "Set Project Status to Working",
    setReview: "Set Project Status to Review",
    setInProgress: "Set Project Status to In Progress",
    setDone: "Set Project Status to Done",
    setBlocked: "Set Project Status to Blocked",
    incrementIteration: "Increment Iteration counter",
    recordFailure: "Increment Failures counter",
    clearFailures: "Reset Failures to 0",
    closeIssue: "Close the issue as completed",
    unassign: "Unassign the bot from the issue",
    runClaude: "Run Claude CLI for implementation",
    runClaudeFixCI: "Run Claude CLI to fix CI failures",
    markPRReady: "Mark PR as ready for review",
    requestReview: "Request reviewer on PR",
    convertToDraft: "Convert PR to draft state",
    transitionToReview:
      "Transition to review state (mark ready, request review)",
    handleCIFailure: "Handle CI failure (record failure, run fix)",
    blockIssue: "Block issue (set blocked, unassign)",
    stopWithReason: "Stop execution with reason",
  };

  return descriptions[name] || `Action: ${name}`;
}

// Main execution
const args = process.argv.slice(2);

if (args.includes("--raw")) {
  // Export raw machine config
  console.log(JSON.stringify(exportMachine(), null, 2));
} else {
  // Export for Stately Studio
  console.log(JSON.stringify(formatForStatelyStudio(), null, 2));
}
