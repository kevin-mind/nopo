#!/usr/bin/env tsx
/**
 * CLI tool for inspecting state machine transitions
 *
 * Usage:
 *   pnpm tsx scripts/inspect-state.ts
 *   pnpm tsx scripts/inspect-state.ts --scenario ci-success
 *   pnpm tsx scripts/inspect-state.ts '{"trigger":"workflow_run_completed","ciResult":"success"}'
 *   pnpm tsx scripts/inspect-state.ts --list-scenarios
 *   pnpm tsx scripts/inspect-state.ts --list-guards
 */

import { createActor } from "xstate";
import { claudeMachine, getTriggerEvent } from "../machine/machine.js";
import type { MachineContext } from "../schemas/index.js";

// ============================================================================
// Predefined Scenarios
// ============================================================================

const scenarios: Record<string, Partial<MachineContext>> = {
  // Initial assignment scenarios
  "issue-assigned": {
    trigger: "issue_assigned",
    issue: {
      number: 123,
      title: "Test Issue",
      state: "OPEN",
      body: "## Todos\n- [ ] Task 1",
      projectStatus: "In progress",
      iteration: 0,
      failures: 0,
      assignees: ["nopo-bot"],
      labels: [],
      subIssues: [],
      hasSubIssues: false,
      history: [],
    },
  },

  "issue-with-subissues": {
    trigger: "issue_assigned",
    issue: {
      number: 100,
      title: "Parent Issue",
      state: "OPEN",
      body: "",
      projectStatus: "In progress",
      iteration: 0,
      failures: 0,
      assignees: ["nopo-bot"],
      labels: [],
      subIssues: [
        {
          number: 101,
          title: "Phase 1",
          state: "OPEN",
          body: "## Todos\n- [ ] Task",
          projectStatus: "In progress",
          branch: null,
          pr: null,
          todos: { total: 1, completed: 0, uncheckedNonManual: 1 },
        },
      ],
      hasSubIssues: true,
      history: [],
    },
  },

  // CI scenarios
  "ci-success": {
    trigger: "workflow_run_completed",
    ciResult: "success",
    issue: {
      number: 123,
      title: "Test",
      state: "OPEN",
      body: "## Todos\n- [ ] Task",
      projectStatus: "In progress",
      iteration: 1,
      failures: 0,
      assignees: ["nopo-bot"],
      labels: [],
      subIssues: [],
      hasSubIssues: false,
      history: [],
    },
    currentSubIssue: {
      number: 123,
      title: "Test",
      state: "OPEN",
      body: "## Todos\n- [ ] Task",
      projectStatus: "In progress",
      branch: "claude/issue/123",
      pr: null,
      todos: { total: 1, completed: 0, uncheckedNonManual: 1 },
    },
  },

  "ci-success-todos-done": {
    trigger: "workflow_run_completed",
    ciResult: "success",
    issue: {
      number: 123,
      title: "Test",
      state: "OPEN",
      body: "## Todos\n- [x] Task",
      projectStatus: "In progress",
      iteration: 1,
      failures: 0,
      assignees: ["nopo-bot"],
      labels: [],
      subIssues: [],
      hasSubIssues: false,
      history: [],
    },
    currentSubIssue: {
      number: 123,
      title: "Test",
      state: "OPEN",
      body: "## Todos\n- [x] Task",
      projectStatus: "In progress",
      branch: "claude/issue/123",
      pr: {
        number: 42,
        state: "OPEN",
        isDraft: true,
        title: "PR",
        headRef: "feature",
        baseRef: "main",
      },
      todos: { total: 1, completed: 1, uncheckedNonManual: 0 },
    },
    hasPR: true,
    pr: {
      number: 42,
      state: "OPEN",
      isDraft: true,
      title: "PR",
      headRef: "feature",
      baseRef: "main",
    },
  },

  "ci-failure": {
    trigger: "workflow_run_completed",
    ciResult: "failure",
    ciRunUrl: "https://github.com/runs/123",
    ciCommitSha: "abc123",
    issue: {
      number: 123,
      title: "Test",
      state: "OPEN",
      body: "",
      projectStatus: "In progress",
      iteration: 1,
      failures: 2,
      assignees: ["nopo-bot"],
      labels: [],
      subIssues: [],
      hasSubIssues: false,
      history: [],
    },
    currentSubIssue: {
      number: 123,
      title: "Test",
      state: "OPEN",
      body: "",
      projectStatus: "In progress",
      branch: "claude/issue/123",
      pr: null,
      todos: { total: 1, completed: 0, uncheckedNonManual: 1 },
    },
  },

  "ci-failure-max-retries": {
    trigger: "workflow_run_completed",
    ciResult: "failure",
    issue: {
      number: 123,
      title: "Test",
      state: "OPEN",
      body: "",
      projectStatus: "In progress",
      iteration: 5,
      failures: 5,
      assignees: ["nopo-bot"],
      labels: [],
      subIssues: [],
      hasSubIssues: false,
      history: [],
    },
    currentSubIssue: {
      number: 123,
      title: "Test",
      state: "OPEN",
      body: "",
      projectStatus: "In progress",
      branch: null,
      pr: null,
      todos: { total: 1, completed: 0, uncheckedNonManual: 1 },
    },
    maxRetries: 5,
  },

  // Review scenarios
  "review-approved": {
    trigger: "pr_review_submitted",
    reviewDecision: "APPROVED",
    reviewerId: "reviewer",
    issue: {
      number: 123,
      title: "Test",
      state: "OPEN",
      body: "",
      projectStatus: "In review",
      iteration: 2,
      failures: 0,
      assignees: ["nopo-bot"],
      labels: [],
      subIssues: [],
      hasSubIssues: false,
      history: [],
    },
  },

  "review-changes-requested": {
    trigger: "pr_review_submitted",
    reviewDecision: "CHANGES_REQUESTED",
    reviewerId: "reviewer",
    issue: {
      number: 123,
      title: "Test",
      state: "OPEN",
      body: "",
      projectStatus: "In review",
      iteration: 2,
      failures: 0,
      assignees: ["nopo-bot"],
      labels: [],
      subIssues: [],
      hasSubIssues: false,
      history: [],
    },
    pr: {
      number: 42,
      state: "OPEN",
      isDraft: false,
      title: "PR",
      headRef: "feature",
      baseRef: "main",
    },
    hasPR: true,
  },

  // Terminal states
  "already-done": {
    trigger: "issue_assigned",
    issue: {
      number: 123,
      title: "Test",
      state: "OPEN",
      body: "",
      projectStatus: "Done",
      iteration: 3,
      failures: 0,
      assignees: [],
      labels: [],
      subIssues: [],
      hasSubIssues: false,
      history: [],
    },
  },

  "already-blocked": {
    trigger: "issue_assigned",
    issue: {
      number: 123,
      title: "Test",
      state: "OPEN",
      body: "",
      projectStatus: "Blocked",
      iteration: 5,
      failures: 5,
      assignees: [],
      labels: [],
      subIssues: [],
      hasSubIssues: false,
      history: [],
    },
  },
};

// ============================================================================
// Helper Functions
// ============================================================================

function createBaseContext(): MachineContext {
  return {
    trigger: "issue_assigned",
    owner: "test-owner",
    repo: "test-repo",
    issue: {
      number: 1,
      title: "Test Issue",
      state: "OPEN",
      body: "",
      projectStatus: "In progress",
      iteration: 0,
      failures: 0,
      assignees: ["nopo-bot"],
      labels: [],
      subIssues: [],
      hasSubIssues: false,
      history: [],
    },
    parentIssue: null,
    currentPhase: null,
    totalPhases: 0,
    currentSubIssue: null,
    ciResult: null,
    ciRunUrl: null,
    ciCommitSha: null,
    reviewDecision: null,
    reviewerId: null,
    branch: null,
    hasBranch: false,
    pr: null,
    hasPR: false,
    maxRetries: 5,
    botUsername: "nopo-bot",
  };
}

function mergeContext(
  base: MachineContext,
  overrides: Partial<MachineContext>,
): MachineContext {
  return {
    ...base,
    ...overrides,
    issue: {
      ...base.issue,
      ...(overrides.issue as Record<string, unknown>),
    },
  } as MachineContext;
}

function runMachine(context: MachineContext) {
  const actor = createActor(claudeMachine, { input: context });
  actor.start();
  const snapshot = actor.getSnapshot();
  actor.stop();

  return {
    state: String(snapshot.value),
    actions: snapshot.context.pendingActions,
    context: snapshot.context,
  };
}

function printResult(
  result: ReturnType<typeof runMachine>,
  context: MachineContext,
) {
  console.log("\n" + "=".repeat(60));
  console.log("STATE MACHINE INSPECTION");
  console.log("=".repeat(60));

  console.log("\n📥 INPUT CONTEXT:");
  console.log(`   Trigger: ${context.trigger}`);
  console.log(`   Issue #${context.issue.number}: ${context.issue.title}`);
  console.log(`   Project Status: ${context.issue.projectStatus}`);
  console.log(`   Iteration: ${context.issue.iteration}`);
  console.log(`   Failures: ${context.issue.failures}`);

  if (context.ciResult) {
    console.log(`   CI Result: ${context.ciResult}`);
  }
  if (context.reviewDecision) {
    console.log(`   Review Decision: ${context.reviewDecision}`);
  }
  if (context.currentSubIssue) {
    console.log(`   Current Sub-Issue: #${context.currentSubIssue.number}`);
    console.log(
      `   Sub-Issue Todos: ${context.currentSubIssue.todos.completed}/${context.currentSubIssue.todos.total}`,
    );
  }

  console.log("\n📤 RESULT:");
  console.log(`   Final State: ${result.state}`);

  const triggerEvent = getTriggerEvent(context);
  console.log(`   Trigger Event: ${triggerEvent.type}`);

  console.log("\n📋 ACTIONS TO EXECUTE:");
  if (result.actions.length === 0) {
    console.log("   (no actions)");
  } else {
    for (const action of result.actions) {
      console.log(`   • ${action.type}`);
      // Print relevant action details
      if ("issueNumber" in action) {
        console.log(`     → issueNumber: ${action.issueNumber}`);
      }
      if ("status" in action) {
        console.log(`     → status: ${action.status}`);
      }
      if ("message" in action) {
        console.log(
          `     → message: ${(action.message as string).slice(0, 50)}...`,
        );
      }
      if ("reason" in action) {
        console.log(`     → reason: ${action.reason}`);
      }
    }
  }

  console.log("\n" + "=".repeat(60));
}

function listScenarios() {
  console.log("\nAvailable scenarios:");
  console.log("=".repeat(40));
  for (const [name, config] of Object.entries(scenarios)) {
    const trigger = config.trigger || "issue_assigned";
    const status =
      (config.issue as Record<string, unknown>)?.projectStatus || "In progress";
    console.log(`  ${name.padEnd(25)} trigger=${trigger}, status=${status}`);
  }
  console.log("\nUsage: pnpm tsx scripts/inspect-state.ts --scenario <name>");
}

function listGuards() {
  console.log("\nAvailable guards:");
  console.log("=".repeat(40));

  const guards = claudeMachine.implementations?.guards || {};
  for (const name of Object.keys(guards)) {
    console.log(`  ${name}`);
  }
}

// ============================================================================
// Main
// ============================================================================

const args = process.argv.slice(2);

if (args.includes("--list-scenarios")) {
  listScenarios();
  process.exit(0);
}

if (args.includes("--list-guards")) {
  listGuards();
  process.exit(0);
}

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
State Machine Inspector

Usage:
  pnpm tsx scripts/inspect-state.ts                     # Run with default context
  pnpm tsx scripts/inspect-state.ts --scenario <name>   # Run predefined scenario
  pnpm tsx scripts/inspect-state.ts '<json>'            # Run with custom context JSON
  pnpm tsx scripts/inspect-state.ts --list-scenarios    # List available scenarios
  pnpm tsx scripts/inspect-state.ts --list-guards       # List available guards

Examples:
  pnpm tsx scripts/inspect-state.ts --scenario ci-success-todos-done
  pnpm tsx scripts/inspect-state.ts '{"trigger":"workflow_run_completed","ciResult":"failure"}'
`);
  process.exit(0);
}

let context: MachineContext;

const scenarioIdx = args.indexOf("--scenario");
if (scenarioIdx !== -1 && args[scenarioIdx + 1]) {
  const scenarioName = args[scenarioIdx + 1];
  const scenario = scenarios[scenarioName];
  if (!scenario) {
    console.error(`Unknown scenario: ${scenarioName}`);
    listScenarios();
    process.exit(1);
  }
  context = mergeContext(createBaseContext(), scenario);
} else if (args[0] && args[0].startsWith("{")) {
  // Parse JSON context
  try {
    const overrides = JSON.parse(args[0]) as Partial<MachineContext>;
    context = mergeContext(createBaseContext(), overrides);
  } catch (e) {
    console.error("Failed to parse JSON context:", e);
    process.exit(1);
  }
} else {
  // Use default context
  context = createBaseContext();
}

const result = runMachine(context);
printResult(result, context);
