/**
 * Example action definitions — builder for the factory.
 *
 * Exports atomic action builders plus getExampleActionDefs(createAction).
 * No imports from machines/issues or machines/discussions.
 */

import type {
  TCreateActionForDomain,
  TActionRegistryFromDefs,
  ActionFromRegistry,
} from "../../core/pev/action-registry.js";
import type { ExampleContext } from "./context.js";
import { checkOffTodoInBody } from "@more/issue-state";
import {
  applyGrooming,
  applyTriage,
  persistIssueState,
  reconcileSubIssues,
  repositoryFor,
  setIssueStatus,
} from "./commands.js";
import { type ExampleGroomingOutput, type TriagePromptVars } from "./services.js";

type RecommendedPhase = NonNullable<
  ExampleGroomingOutput["recommendedPhases"]
>[number];

function formatPhaseBody(phase: RecommendedPhase): string {
  const lines: string[] = [`## Description\n\n${phase.description}`];
  if (phase.affected_areas && phase.affected_areas.length > 0) {
    lines.push("\n## Affected Areas\n");
    for (const area of phase.affected_areas) {
      const parts = [`- \`${area.path}\``];
      if (area.change_type) parts[0] += ` (${area.change_type})`;
      if (area.description) parts.push(`  ${area.description}`);
      lines.push(parts.join("\n"));
    }
  }
  if (phase.todos && phase.todos.length > 0) {
    lines.push("\n## Todos\n");
    for (const todo of phase.todos) {
      const suffix = todo.manual ? " *(manual)*" : "";
      lines.push(`- [ ] ${todo.task}${suffix}`);
    }
  }
  if (phase.depends_on && phase.depends_on.length > 0) {
    lines.push(
      `\n## Dependencies\n\nDepends on phases: ${phase.depends_on.join(", ")}`,
    );
  }
  return lines.join("\n");
}

interface GroomingPromptVars extends TriagePromptVars {
  ISSUE_LABELS: string;
}

interface IterationPromptVars extends TriagePromptVars {
  ISSUE_LABELS: string;
  CI_RESULT: string;
  REVIEW_DECISION: string;
}

interface ReviewPromptVars extends TriagePromptVars {
  REVIEW_DECISION: string;
  REVIEWER: string;
}

/** Build full example action defs object from atomic action builders. */
type ExampleCreateAction = TCreateActionForDomain<ExampleContext>;
type ExampleProjectStatus = Exclude<
  ExampleContext["issue"]["projectStatus"],
  null
>;

function isOkResult(value: unknown): value is { ok: true } {
  if (value == null || typeof value !== "object") return false;
  return Reflect.get(value, "ok") === true;
}

export function updateStatusAction(createAction: ExampleCreateAction) {
  return createAction<{ issueNumber: number; status: ExampleProjectStatus }>({
    description: (action) =>
      `Set issue #${action.payload.issueNumber} status to "${action.payload.status}"`,
    predict: (action) => ({
      checks: [
        {
          comparator: "eq",
          description: "Issue project status should match requested status",
          field: "issue.projectStatus",
          expected: action.payload.status,
        },
      ],
    }),
    execute: async (action, ctx) => {
      setIssueStatus(ctx, action.payload.status);
      return { ok: true };
    },
  });
}

export function appendHistoryAction(createAction: ExampleCreateAction) {
  return createAction<{
    issueNumber: number;
    message: string;
    phase?: "triage" | "groom" | "iterate" | "review";
  }>({
    description: (action) =>
      `Append ${action.payload.phase ?? "generic"} history: "${action.payload.message}"`,
    execute: async () => ({ ok: true }),
  });
}

export function runClaudeTriageAction(createAction: ExampleCreateAction) {
  return createAction<{
    issueNumber: number;
    promptVars: TriagePromptVars;
  }>({
    description: (action) =>
      `Invoke triage analysis for #${action.payload.issueNumber}`,
    execute: async (action, ctx) => {
      const triageService = ctx.services?.triage;
      if (!triageService) {
        throw new Error("No triage service configured");
      }
      const output = await triageService.triageIssue({
        issueNumber: action.payload.issueNumber,
        promptVars: action.payload.promptVars,
      });
      ctx.triageOutput = output;
      return {
        ok: true,
        output,
      };
    },
  });
}

export function applyTriageOutputAction(createAction: ExampleCreateAction) {
  return createAction<{
    issueNumber: number;
    labelsToAdd?: string[];
  }>({
    description: (action) =>
      `Apply triage output to #${action.payload.issueNumber}`,
    predict: (action) => {
      const labelsToAdd = action.payload.labelsToAdd ?? ["triaged"];
      return {
        checks: [
          {
            comparator: "all",
            description:
              "All triage labels from apply payload should exist on issue.labels",
            checks: labelsToAdd.map((label) => ({
              comparator: "includes" as const,
              description: `Issue labels should include "${label}"`,
              field: "issue.labels",
              expected: label,
            })),
          },
        ],
      };
    },
    execute: async (action, ctx) => {
      const labelsToAdd =
        action.payload.labelsToAdd ?? ctx.triageOutput?.labelsToAdd;
      if (!labelsToAdd || labelsToAdd.length === 0) {
        throw new Error("No triage labels available to apply");
      }
      applyTriage(ctx, labelsToAdd);
      const persisted = await persistIssueState(ctx);
      if (!persisted) {
        throw new Error("Failed to persist triage output");
      }
      ctx.triageOutput = null;
      return { ok: true };
    },
    verify: (args) => {
      const { action, executeResult, predictionEval, predictionDiffs } = args;
      const labelsToAdd = action.payload.labelsToAdd ?? ["triaged"];
      const executeSucceeded = isOkResult(executeResult);
      if (!executeSucceeded) {
        return {
          message: "Triage output execute step did not return ok=true",
        };
      }
      if (predictionEval.pass) return;
      return {
        message: `Missing triage labels after apply: ${labelsToAdd.join(", ")}`,
        diffs: predictionDiffs,
      };
    },
  });
}

export function runClaudeGroomingAction(createAction: ExampleCreateAction) {
  return createAction<{
    issueNumber: number;
    promptVars: GroomingPromptVars;
  }>({
    description: (action) =>
      `Invoke grooming analysis for #${action.payload.issueNumber}`,
    execute: async (action, ctx) => {
      const groomingService = ctx.services?.grooming;
      if (!groomingService) {
        throw new Error("No grooming service configured");
      }
      const output = await groomingService.groomIssue({
        issueNumber: action.payload.issueNumber,
        promptVars: action.payload.promptVars,
      });
      ctx.groomingOutput = output;
      return {
        ok: true,
        output,
      };
    },
  });
}

export function applyGroomingOutputAction(createAction: ExampleCreateAction) {
  return createAction<{
    issueNumber: number;
  }>({
    description: (action) =>
      `Apply grooming output to #${action.payload.issueNumber}`,
    execute: async (_action, ctx) => {
      const output = ctx.groomingOutput;
      if (!output) {
        throw new Error("No grooming output available to apply");
      }
      applyGrooming(ctx, output.labelsToAdd);
      return { ok: true, decision: output.decision };
    },
  });
}

export function reconcileSubIssuesAction(createAction: ExampleCreateAction) {
  return createAction<{
    issueNumber: number;
  }>({
    description: (action) =>
      `Reconcile sub-issues for #${action.payload.issueNumber}`,
    predict: () => ({
      checks: [
        {
          comparator: "eq" as const,
          description: "Issue should have sub-issues after grooming",
          field: "issue.hasSubIssues",
          expected: true,
        },
      ],
    }),
    execute: async (_action, ctx) => {
      const output = ctx.groomingOutput;
      if (!output) {
        throw new Error("No grooming output to reconcile");
      }
      // Only reconcile sub-issues when the decision is "ready"
      if (output.decision === "ready" && output.recommendedPhases) {
        const repo = repositoryFor(ctx);
        const existingNumbers = ctx.issue.subIssues.map((s) => s.number);
        if (existingNumbers.length === 0 && repo.createSubIssue) {
          // No sub-issues yet — create them from recommended phases
          for (const phase of output.recommendedPhases) {
            const body = formatPhaseBody(phase);
            await repo.createSubIssue({
              title: `[Phase ${phase.phase_number}]: ${phase.title}`,
              body,
            });
          }
        } else if (existingNumbers.length > 0) {
          reconcileSubIssues(ctx, existingNumbers);
        }
      }
      const persisted = await persistIssueState(ctx);
      if (!persisted) {
        throw new Error("Failed to persist grooming output");
      }
      ctx.groomingOutput = null;
      return { ok: true, decision: output.decision };
    },
    verify: ({ executeResult, newCtx }) => {
      if (!isOkResult(executeResult)) {
        return { message: "Reconcile sub-issues execute did not return ok=true" };
      }
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- runtime output check
      const decision = (executeResult as { decision?: string }).decision;
      if (decision === "ready" && !newCtx.issue.hasSubIssues) {
        return {
          message:
            "Grooming decision was 'ready' but issue has no sub-issues after reconciliation",
        };
      }
      return undefined;
    },
  });
}

export function runClaudeIterationAction(createAction: ExampleCreateAction) {
  return createAction<{
    issueNumber: number;
    mode: "iterate" | "retry";
    promptVars: IterationPromptVars;
  }>({
    description: (action) =>
      `Invoke ${action.payload.mode} analysis for #${action.payload.issueNumber}`,
    execute: async (action, ctx) => {
      const iterationService = ctx.services?.iteration;
      if (!iterationService) {
        throw new Error("No iteration service configured");
      }
      const output = await iterationService.iterateIssue({
        issueNumber: action.payload.issueNumber,
        mode: action.payload.mode,
        promptVars: action.payload.promptVars,
      });
      ctx.iterationOutput = output;
      return {
        ok: true,
        output,
      };
    },
  });
}

export function applyIterationOutputAction(createAction: ExampleCreateAction) {
  return createAction<{
    issueNumber: number;
    labelsToAdd?: string[];
  }>({
    description: (action) =>
      `Apply iteration output to #${action.payload.issueNumber}`,
    predict: (action) => ({
      checks: [
        {
          comparator: "all",
          description:
            "All iteration labels from apply payload should exist on issue.labels",
          checks: (action.payload.labelsToAdd ?? ["iteration:ready"]).map(
            (label) => ({
              comparator: "includes" as const,
              description: `Issue labels should include "${label}"`,
              field: "issue.labels",
              expected: label,
            }),
          ),
        },
      ],
    }),
    execute: async (action, ctx) => {
      const output = ctx.iterationOutput;
      const labelsToAdd = action.payload.labelsToAdd ?? output?.labelsToAdd;
      if (!labelsToAdd || labelsToAdd.length === 0) {
        throw new Error("No iteration labels available to apply");
      }
      applyTriage(ctx, labelsToAdd);

      const todosCompleted = output?.todosCompleted;
      const shouldCheckTodos =
        (output?.status === "completed_todo" ||
          output?.status === "all_done") &&
        todosCompleted &&
        todosCompleted.length > 0;
      if (shouldCheckTodos) {
        const issue = ctx.currentSubIssue ?? ctx.issue;
        let body = issue.body;
        for (const todoText of todosCompleted) {
          const updated = checkOffTodoInBody(body, todoText);
          if (updated) body = updated;
        }
        issue.body = body;
      }

      const persisted = await persistIssueState(ctx);
      if (!persisted) {
        throw new Error("Failed to persist iteration output");
      }
      ctx.iterationOutput = null;
      return { ok: true };
    },
    verify: ({ action, executeResult, predictionEval, predictionDiffs }) => {
      const labelsToAdd = action.payload.labelsToAdd ?? ["iteration:ready"];
      const executeSucceeded = isOkResult(executeResult);
      if (!executeSucceeded) {
        return {
          message: "Iteration output execute step did not return ok=true",
        };
      }
      if (predictionEval.pass) return;
      return {
        message: `Missing iteration labels after apply: ${labelsToAdd.join(", ")}`,
        diffs: predictionDiffs,
      };
    },
  });
}

export function runClaudeReviewAction(createAction: ExampleCreateAction) {
  return createAction<{
    issueNumber: number;
    promptVars: ReviewPromptVars;
  }>({
    description: (action) =>
      `Invoke review analysis for #${action.payload.issueNumber}`,
    execute: async (action, ctx) => {
      const reviewService = ctx.services?.review;
      if (!reviewService) {
        throw new Error("No review service configured");
      }
      const output = await reviewService.reviewIssue({
        issueNumber: action.payload.issueNumber,
        promptVars: action.payload.promptVars,
      });
      ctx.reviewOutput = output;
      return { ok: true, output };
    },
  });
}

export function applyReviewOutputAction(createAction: ExampleCreateAction) {
  return createAction<{
    issueNumber: number;
    labelsToAdd?: string[];
  }>({
    description: (action) =>
      `Apply review output to #${action.payload.issueNumber}`,
    predict: (action) => ({
      checks: [
        {
          comparator: "all",
          description:
            "All review labels from apply payload should exist on issue.labels",
          checks: (action.payload.labelsToAdd ?? ["reviewed"]).map((label) => ({
            comparator: "includes" as const,
            description: `Issue labels should include "${label}"`,
            field: "issue.labels",
            expected: label,
          })),
        },
      ],
    }),
    execute: async (action, ctx) => {
      const labelsToAdd =
        action.payload.labelsToAdd ?? ctx.reviewOutput?.labelsToAdd;
      if (!labelsToAdd || labelsToAdd.length === 0) {
        throw new Error("No review labels available to apply");
      }
      applyTriage(ctx, labelsToAdd);
      const persisted = await persistIssueState(ctx);
      if (!persisted) {
        throw new Error("Failed to persist review output");
      }
      ctx.reviewOutput = null;
      return { ok: true };
    },
  });
}

export function runClaudePrResponseAction(createAction: ExampleCreateAction) {
  return createAction<{
    issueNumber: number;
    promptVars: ReviewPromptVars;
  }>({
    description: (action) =>
      `Invoke PR response analysis for #${action.payload.issueNumber}`,
    execute: async (action, ctx) => {
      const responseService = ctx.services?.prResponse;
      if (!responseService) {
        throw new Error("No PR response service configured");
      }
      const output = await responseService.respondToPr({
        issueNumber: action.payload.issueNumber,
        promptVars: action.payload.promptVars,
      });
      ctx.prResponseOutput = output;
      return { ok: true, output };
    },
  });
}

export function applyPrResponseOutputAction(createAction: ExampleCreateAction) {
  return createAction<{
    issueNumber: number;
    labelsToAdd?: string[];
  }>({
    description: (action) =>
      `Apply PR response output to #${action.payload.issueNumber}`,
    execute: async (action, ctx) => {
      const labelsToAdd =
        action.payload.labelsToAdd ?? ctx.prResponseOutput?.labelsToAdd;
      if (!labelsToAdd || labelsToAdd.length === 0) {
        throw new Error("No PR response labels available to apply");
      }
      applyTriage(ctx, labelsToAdd);
      const persisted = await persistIssueState(ctx);
      if (!persisted) {
        throw new Error("Failed to persist PR response output");
      }
      ctx.prResponseOutput = null;
      return { ok: true };
    },
  });
}

export function recordFailureAction(createAction: ExampleCreateAction) {
  return createAction<{
    issueNumber: number;
    failureType: "ci" | "review";
  }>({
    description: (action) =>
      `Record ${action.payload.failureType} failure for #${action.payload.issueNumber}`,
    predict: (action, ctx) => {
      const issue =
        ctx.issue.number === action.payload.issueNumber
          ? ctx.issue
          : ctx.currentSubIssue;
      const current = issue?.failures ?? 0;
      return {
        checks: [
          {
            comparator: "eq",
            description: "Issue failures should be incremented",
            field: "issue.failures",
            expected: current + 1,
          },
        ],
      };
    },
    execute: async (action, ctx) => {
      const issue =
        ctx.issue.number === action.payload.issueNumber
          ? ctx.issue
          : (ctx.currentSubIssue ?? ctx.issue);
      const current = issue.failures ?? 0;
      Object.assign(issue, { failures: current + 1 });
      return { ok: true };
    },
  });
}

export function persistStateAction(createAction: ExampleCreateAction) {
  return createAction<{
    issueNumber: number;
    reason: string;
  }>({
    description: (action) =>
      `Persist issue #${action.payload.issueNumber} state (${action.payload.reason})`,
    execute: async (_action, ctx) => {
      const persisted = await persistIssueState(ctx);
      if (!persisted) {
        throw new Error("Failed to persist state");
      }
      return { ok: true };
    },
  });
}

export function runOrchestrationAction(createAction: ExampleCreateAction) {
  return createAction<{
    issueNumber: number;
    initParentIfNeeded: boolean;
  }>({
    description: (action) =>
      `Run orchestration step for #${action.payload.issueNumber}`,
    execute: async (action, ctx) => {
      if (action.payload.initParentIfNeeded) {
        setIssueStatus(ctx, "In progress");
      }
      const persisted = await persistIssueState(ctx);
      if (!persisted) {
        throw new Error("Failed to persist orchestration step");
      }
      return { ok: true };
    },
  });
}

export function stopAction(createAction: ExampleCreateAction) {
  return createAction<{ message: string }>({
    description: (action) => `Stop: ${action.payload.message}`,
    execute: async () => ({ ok: true }),
  });
}

export type ExampleRegistry = TActionRegistryFromDefs<{
  updateStatus: ReturnType<typeof updateStatusAction>;
  appendHistory: ReturnType<typeof appendHistoryAction>;
  runClaudeTriage: ReturnType<typeof runClaudeTriageAction>;
  applyTriageOutput: ReturnType<typeof applyTriageOutputAction>;
  runClaudeGrooming: ReturnType<typeof runClaudeGroomingAction>;
  applyGroomingOutput: ReturnType<typeof applyGroomingOutputAction>;
  reconcileSubIssues: ReturnType<typeof reconcileSubIssuesAction>;
  runClaudeIteration: ReturnType<typeof runClaudeIterationAction>;
  applyIterationOutput: ReturnType<typeof applyIterationOutputAction>;
  runClaudeReview: ReturnType<typeof runClaudeReviewAction>;
  applyReviewOutput: ReturnType<typeof applyReviewOutputAction>;
  runClaudePrResponse: ReturnType<typeof runClaudePrResponseAction>;
  applyPrResponseOutput: ReturnType<typeof applyPrResponseOutputAction>;
  runOrchestration: ReturnType<typeof runOrchestrationAction>;
  recordFailure: ReturnType<typeof recordFailureAction>;
  persistState: ReturnType<typeof persistStateAction>;
  stop: ReturnType<typeof stopAction>;
}>;
export type ExampleAction = ActionFromRegistry<ExampleRegistry>;
