/**
 * Example action definitions — builder for the factory.
 *
 * Exports atomic action builders plus getExampleActionDefs(createAction).
 * No imports from machines/issues or machines/discussions.
 */

import { exec as execCb } from "child_process";
import { promisify } from "util";
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
import type {
  ExampleGroomingOutput,
  ExampleServices,
  TriagePromptVars,
} from "./services.js";

type ExampleCreateAction = TCreateActionForDomain<
  ExampleContext,
  ExampleServices
>;

const execAsync = promisify(execCb);

/** Returns true when running inside GitHub Actions (git ops only make sense there). */
function isGitEnvironment(): boolean {
  return process.env.GITHUB_ACTIONS === "true";
}

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
  ITERATION: string;
  LAST_CI_RESULT: string;
  CONSECUTIVE_FAILURES: string;
  BRANCH_NAME: string;
  PR_CREATE_COMMAND: string;
  AGENT_NOTES: string;
}

interface ReviewPromptVars extends TriagePromptVars {
  REVIEW_DECISION: string;
  REVIEWER: string;
}

/** Build full example action defs object from atomic action builders. */
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
    execute: async ({ action, ctx }) => {
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
    execute: async ({ action, ctx }) => {
      const repo = repositoryFor(ctx);
      if (repo.appendHistoryEntry) {
        repo.appendHistoryEntry({
          phase: action.payload.phase ?? "generic",
          message: action.payload.message,
          timestamp: ctx.workflowStartedAt ?? new Date().toISOString(),
          sha: ctx.ciCommitSha ?? undefined,
          runLink: ctx.workflowRunUrl ?? undefined,
        });
      }
      return { ok: true };
    },
  });
}

export function runClaudeTriageAction(createAction: ExampleCreateAction) {
  return createAction<{
    issueNumber: number;
    promptVars: TriagePromptVars;
  }>({
    description: (action) =>
      `Invoke triage analysis for #${action.payload.issueNumber}`,
    execute: async ({ action, ctx, services }) => {
      const output = await services.triage.triageIssue({
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
    execute: async ({ action, ctx }) => {
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
    execute: async ({ action, ctx, services }) => {
      const output = await services.grooming.groomIssue({
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
    predict: (_action, ctx) => ({
      checks: [
        {
          comparator: "all" as const,
          description: "All grooming labels should exist on issue after apply",
          checks: (ctx.groomingOutput?.labelsToAdd ?? ["groomed"]).map(
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
    execute: async ({ ctx }) => {
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
    execute: async ({ ctx }) => {
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
        return {
          message: "Reconcile sub-issues execute did not return ok=true",
        };
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
    execute: async ({ action, ctx, services }) => {
      const output = await services.iteration.iterateIssue({
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
    execute: async ({ action, ctx }) => {
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
    execute: async ({ action, ctx, services }) => {
      const output = await services.review.reviewIssue({
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
    execute: async ({ action, ctx }) => {
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
    execute: async ({ action, ctx, services }) => {
      const output = await services.prResponse.respondToPr({
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
    predict: (action, ctx) => ({
      checks: [
        {
          comparator: "all" as const,
          description:
            "All PR response labels should exist on issue after apply",
          checks: (
            action.payload.labelsToAdd ??
            ctx.prResponseOutput?.labelsToAdd ??
            []
          ).map((label) => ({
            comparator: "includes" as const,
            description: `Issue labels should include "${label}"`,
            field: "issue.labels",
            expected: label,
          })),
        },
      ],
    }),
    execute: async ({ action, ctx }) => {
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
    // No predict: failures are updated in-memory only (not persisted until
    // a subsequent persist action), so external refresh won't see the change.
    execute: async ({ action, ctx }) => {
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
    execute: async ({ ctx }) => {
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
    predict: (action) => {
      if (!action.payload.initParentIfNeeded) return { checks: [] };
      return {
        checks: [
          {
            comparator: "eq" as const,
            description:
              "Parent issue status should be In progress after orchestration",
            field: "issue.projectStatus",
            expected: "In progress",
          },
        ],
      };
    },
    execute: async ({ action, ctx }) => {
      if (action.payload.initParentIfNeeded) {
        setIssueStatus(ctx, "In progress");
      }
      const persisted = await persistIssueState(ctx);
      if (!persisted) {
        throw new Error("Failed to persist orchestration step");
      }
      // Assign bot to the first non-Done sub-issue to start iteration
      const firstSub = ctx.issue.subIssues.find(
        (s) => s.projectStatus !== "Done" && s.state === "OPEN",
      );
      const repo = repositoryFor(ctx);
      if (!firstSub) return { ok: true };

      // Detect stale review: sub-issue is "In review" but PR is closed or missing.
      // Reset to "In progress" so the machine can re-route to iterate in the same run.
      const isStaleReview =
        firstSub.projectStatus === "In review" &&
        (!ctx.pr || ctx.pr.state !== "OPEN");
      if (isStaleReview) {
        if (repo.updateSubIssueProjectStatus) {
          await repo.updateSubIssueProjectStatus(
            firstSub.number,
            "In progress",
          );
        }
        // Update in-memory state so routing sees the change
        firstSub.projectStatus = "In progress";
        if (ctx.currentSubIssue?.number === firstSub.number) {
          ctx.currentSubIssue.projectStatus = "In progress";
        }
      }

      if (repo.assignBotToSubIssue) {
        await repo.assignBotToSubIssue(firstSub.number, ctx.botUsername);
      }
      return { ok: true };
    },
  });
}

export function setupGitAction(createAction: ExampleCreateAction) {
  return createAction<{ token: string }>({
    description: () => "Configure git credentials for PAT-based push",
    execute: async ({ action }) => {
      if (!isGitEnvironment()) {
        return { ok: true, skipped: true };
      }
      const { token } = action.payload;
      await execAsync('git config user.name "nopo-bot"');
      await execAsync(
        'git config user.email "nopo-bot@users.noreply.github.com"',
      );
      await execAsync(
        `git config url."https://x-access-token:${token}@github.com/".insteadOf "https://github.com/"`,
      );
      // Verify by reading back
      const { stdout: userName } = await execAsync("git config user.name");
      const { stdout: userEmail } = await execAsync("git config user.email");
      return {
        ok: true,
        userName: userName.trim(),
        userEmail: userEmail.trim(),
      };
    },
    verify: ({ executeResult }) => {
      if (!isOkResult(executeResult)) {
        return { message: "setupGit execute did not return ok=true" };
      }
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- runtime output check
      const result = executeResult as {
        skipped?: boolean;
        userName?: string;
      };
      if (result.skipped) return undefined;
      if (result.userName !== "nopo-bot") {
        return {
          message: `git user.name mismatch: expected "nopo-bot", got "${result.userName}"`,
        };
      }
      return undefined;
    },
  });
}

export function prepareBranchAction(createAction: ExampleCreateAction) {
  return createAction<{ branchName: string; baseBranch?: string }>({
    description: (action) =>
      `Prepare branch "${action.payload.branchName}" for iteration`,
    execute: async ({ action, ctx }) => {
      if (!isGitEnvironment()) {
        ctx.branchPrepResult = "clean";
        return { ok: true, skipped: true, branch: action.payload.branchName };
      }
      const { branchName, baseBranch = "main" } = action.payload;

      // Fetch all refs
      await execAsync("git fetch origin");

      // Check if remote branch exists
      let remoteBranchExists = false;
      try {
        await execAsync(`git rev-parse --verify origin/${branchName}`);
        remoteBranchExists = true;
      } catch {
        // Branch doesn't exist remotely
      }

      if (remoteBranchExists) {
        // Checkout existing branch
        try {
          await execAsync(`git checkout ${branchName}`);
        } catch {
          // Local branch doesn't exist, create from remote
          await execAsync(`git checkout -b ${branchName} origin/${branchName}`);
        }
      } else {
        // Create new branch from base
        try {
          await execAsync(`git checkout -b ${branchName} origin/${baseBranch}`);
        } catch {
          // Branch might already exist locally
          await execAsync(`git checkout ${branchName}`);
          await execAsync(`git reset --hard origin/${baseBranch}`);
        }
      }

      // Check if behind main and rebase if needed
      const { stdout: behindCount } = await execAsync(
        `git rev-list --count HEAD..origin/${baseBranch}`,
      );
      const behind = parseInt(behindCount.trim(), 10);

      if (behind > 0) {
        try {
          await execAsync(`git rebase origin/${baseBranch}`);
        } catch {
          // Abort rebase on conflict
          await execAsync("git rebase --abort");
          ctx.branchPrepResult = "conflicts";
          return {
            ok: true,
            branch: branchName,
            result: "conflicts" as const,
          };
        }

        // Rebase succeeded — force push the rebased branch
        await execAsync(
          `git push --force-with-lease origin HEAD:${branchName}`,
        );
        ctx.branchPrepResult = "rebased";

        // Read back current branch
        const { stdout: currentBranch } = await execAsync(
          "git branch --show-current",
        );
        return {
          ok: true,
          branch: currentBranch.trim(),
          result: "rebased" as const,
        };
      }

      ctx.branchPrepResult = "clean";

      // Read back current branch
      const { stdout: currentBranch } = await execAsync(
        "git branch --show-current",
      );

      return {
        ok: true,
        branch: currentBranch.trim(),
        result: "clean" as const,
      };
    },
    verify: ({ action, executeResult }) => {
      if (!isOkResult(executeResult)) {
        return { message: "prepareBranch execute did not return ok=true" };
      }
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- runtime output check
      const result = executeResult as { branch?: string; result?: string };
      // Conflicts are a valid outcome — the machine handles routing
      if (result.result === "conflicts") return undefined;
      if (result.branch !== action.payload.branchName) {
        return {
          message: `Branch mismatch: expected "${action.payload.branchName}", got "${result.branch}"`,
        };
      }
      return undefined;
    },
  });
}

export function gitPushAction(createAction: ExampleCreateAction) {
  return createAction<{ branchName: string; forceWithLease?: boolean }>({
    description: (action) =>
      `Push branch "${action.payload.branchName}" to origin`,
    execute: async ({ action }) => {
      if (!isGitEnvironment()) {
        return { ok: true, skipped: true };
      }
      const { branchName, forceWithLease = true } = action.payload;
      const forceFlag = forceWithLease ? " --force-with-lease" : "";
      await execAsync(`git push${forceFlag} origin HEAD:${branchName}`);

      // Read back local HEAD sha
      const { stdout: localSha } = await execAsync("git rev-parse HEAD");

      return {
        ok: true,
        sha: localSha.trim(),
      };
    },
    verify: ({ executeResult }) => {
      if (!isOkResult(executeResult)) {
        return { message: "gitPush execute did not return ok=true" };
      }
      return undefined;
    },
  });
}

export function stopAction(createAction: ExampleCreateAction) {
  return createAction<{ message: string }>({
    description: (action) => `Stop: ${action.payload.message}`,
    execute: async (_input) => ({ ok: true }),
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
  setupGit: ReturnType<typeof setupGitAction>;
  prepareBranch: ReturnType<typeof prepareBranchAction>;
  gitPush: ReturnType<typeof gitPushAction>;
  stop: ReturnType<typeof stopAction>;
}>;
export type ExampleAction = ActionFromRegistry<ExampleRegistry>;
