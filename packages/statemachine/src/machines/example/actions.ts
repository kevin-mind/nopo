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
  markPRReady,
  reconcileSubIssues,
  removeIssueLabels,
  repositoryFor,
  requestReviewer,
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

/** Logging wrapper around execAsync — logs cwd, command, stdout, stderr. */
async function execLog(
  cmd: string,
  opts?: { cwd?: string },
): Promise<{ stdout: string; stderr: string }> {
  const cwd = opts?.cwd ?? process.cwd();
  console.info(`[exec] $ ${cmd} (cwd: ${cwd})`);
  try {
    const result = await execAsync(cmd, opts);
    const stdout = String(result.stdout);
    const stderr = String(result.stderr);
    if (stdout.trim()) console.info(`[exec] stdout: ${stdout.trim()}`);
    if (stderr.trim()) console.warn(`[exec] stderr: ${stderr.trim()}`);
    return { stdout, stderr };
  } catch (err: unknown) {
    if (err != null && typeof err === "object") {
      const stdout = Reflect.get(err, "stdout");
      const stderr = Reflect.get(err, "stderr");
      if (typeof stdout === "string" && stdout.trim())
        console.info(`[exec] stdout: ${stdout.trim()}`);
      if (typeof stderr === "string" && stderr.trim())
        console.warn(`[exec] stderr: ${stderr.trim()}`);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[exec] FAILED: ${message}`);
    throw err;
  }
}

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
      return { ok: true, message: `Status → ${action.payload.status}` };
    },
  });
}

export function removeLabelsAction(createAction: ExampleCreateAction) {
  return createAction<{ issueNumber: number; labels: string[] }>({
    description: (action) =>
      `Remove labels [${action.payload.labels.join(", ")}] from #${action.payload.issueNumber}`,
    // No predict: "not_includes" comparator not yet available in prediction checks
    execute: async ({ action, ctx }) => {
      removeIssueLabels(ctx, action.payload.labels);
      return {
        ok: true,
        message: `Removed labels: ${action.payload.labels.join(", ")}`,
      };
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
        message: "Triage analysis complete",
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
    predict: (action, ctx) => {
      const labelsToAdd =
        action.payload.labelsToAdd ?? ctx.triageOutput?.labelsToAdd ?? [];
      if (labelsToAdd.length === 0) return { checks: [] };
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

      const output = ctx.triageOutput;

      // Build structured body sections
      const sections: string[] = [];

      // ## Requirements
      if (output?.requirements && output.requirements.length > 0) {
        sections.push(
          [
            "## Requirements",
            "",
            ...output.requirements.map((r) => `- ${r}`),
          ].join("\n"),
        );
      }

      // ## Approach
      if (output?.summary) {
        sections.push(["## Approach", "", output.summary].join("\n"));
      }

      // ## Questions
      if (output?.initialQuestions && output.initialQuestions.length > 0) {
        sections.push(
          [
            "## Questions",
            "",
            ...output.initialQuestions.map((q) => `- ${q}`),
          ].join("\n"),
        );
      }

      // ## Related Issues
      if (output?.relatedIssues && output.relatedIssues.length > 0) {
        sections.push(
          [
            "## Related Issues",
            "",
            ...output.relatedIssues.map((n) => `- #${n}`),
          ].join("\n"),
        );
      }

      // ## Agent Notes
      if (output?.agentNotes && output.agentNotes.length > 0) {
        sections.push(
          [
            "## Agent Notes",
            "",
            ...output.agentNotes.map((n) => `- ${n}`),
          ].join("\n"),
        );
      }

      const triageContent = sections.join("\n\n");

      const repo = repositoryFor(ctx);
      const body = ctx.issue.body;
      const historyIdx = body.indexOf("## Iteration History");
      const newBody =
        historyIdx >= 0
          ? body.slice(0, historyIdx) +
            triageContent +
            "\n\n" +
            body.slice(historyIdx)
          : body + "\n\n" + triageContent;
      if (repo.updateBody) {
        repo.updateBody(newBody);
      } else {
        ctx.issue.body = newBody;
      }

      // Set project metadata (priority, size, estimate) if available
      if (
        repo.setProjectMetadata &&
        (output?.priority || output?.size || output?.estimate)
      ) {
        const metadata: {
          priority?: string;
          size?: string;
          estimate?: number;
        } = {};
        if (output.priority && output.priority !== "none") {
          metadata.priority = output.priority;
        }
        if (output.size) {
          metadata.size = output.size.toUpperCase();
        }
        if (output.estimate) {
          metadata.estimate = output.estimate;
        }
        await repo.setProjectMetadata(metadata);
      }

      ctx.triageOutput = null;
      return { ok: true, message: "Applied triage labels and body sections" };
    },
    verify: (args) => {
      const { action, executeResult, predictionEval, predictionDiffs } = args;
      const executeSucceeded = isOkResult(executeResult);
      if (!executeSucceeded) {
        return {
          message: "Triage output execute step did not return ok=true",
        };
      }
      if (predictionEval.pass) return;
      const labelsToAdd = action.payload.labelsToAdd ?? [];
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
        message: "Grooming analysis complete",
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
    execute: async ({ ctx }) => {
      const output = ctx.groomingOutput;
      if (!output) {
        throw new Error("No grooming output available to apply");
      }
      if (output.labelsToAdd.length > 0) {
        applyGrooming(ctx, output.labelsToAdd);
      }
      return {
        ok: true,
        message: "Applied grooming labels",
        decision: output.decision,
      };
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
      ctx.groomingOutput = null;
      return {
        ok: true,
        message: "Sub-issues reconciled",
        decision: output.decision,
      };
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
        message: `${action.payload.mode === "retry" ? "Retry" : "Iteration"} complete`,
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
    execute: async ({ action, ctx }) => {
      const output = ctx.iterationOutput;
      const labelsToAdd = action.payload.labelsToAdd ?? output?.labelsToAdd;
      if (labelsToAdd && labelsToAdd.length > 0) {
        applyTriage(ctx, labelsToAdd);
      }

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
        // Use the repository's updateBody to update both the string
        // and the underlying AST (bodyAst). Direct issue.body mutation
        // doesn't update bodyAst, so save() would not persist the change.
        const repo = repositoryFor(ctx);
        if (repo.updateBody) {
          repo.updateBody(body);
        } else {
          issue.body = body;
        }
      }

      ctx.iterationOutput = null;
      return { ok: true, message: "Applied iteration output" };
    },
    verify: ({ executeResult }) => {
      const executeSucceeded = isOkResult(executeResult);
      if (!executeSucceeded) {
        return {
          message: "Iteration output execute step did not return ok=true",
        };
      }
      return undefined;
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
      return { ok: true, message: "Review analysis complete", output };
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
    execute: async ({ action, ctx }) => {
      const labelsToAdd =
        action.payload.labelsToAdd ?? ctx.reviewOutput?.labelsToAdd;
      if (labelsToAdd && labelsToAdd.length > 0) {
        applyTriage(ctx, labelsToAdd);
      }
      ctx.reviewOutput = null;
      return { ok: true, message: "Applied review output" };
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
      return { ok: true, message: "PR response analysis complete", output };
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
    execute: async ({ action, ctx }) => {
      const labelsToAdd =
        action.payload.labelsToAdd ?? ctx.prResponseOutput?.labelsToAdd;
      if (labelsToAdd && labelsToAdd.length > 0) {
        applyTriage(ctx, labelsToAdd);
      }
      ctx.prResponseOutput = null;
      return { ok: true, message: "Applied PR response output" };
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
    // No predict: failures are in-memory only (not persisted to GitHub project fields
    // via save()). Verify refreshes from GitHub where the value is still 0.
    execute: async ({ action, ctx }) => {
      const issue =
        ctx.issue.number === action.payload.issueNumber
          ? ctx.issue
          : (ctx.currentSubIssue ?? ctx.issue);
      const current = issue.failures ?? 0;
      Object.assign(issue, { failures: current + 1 });
      return { ok: true, message: `Failure #${current + 1} recorded` };
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
      // Assign bot to the first non-Done sub-issue to start iteration
      const firstSub = ctx.issue.subIssues.find(
        (s) => s.projectStatus !== "Done" && s.state === "OPEN",
      );
      const repo = repositoryFor(ctx);
      if (!firstSub)
        return {
          ok: true,
          message: "Orchestration complete (no active sub-issues)",
        };

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
      return {
        ok: true,
        message: `Orchestration: advancing to sub-issue #${firstSub.number}`,
      };
    },
  });
}

export function setupGitAction(createAction: ExampleCreateAction) {
  return createAction<{ token: string }>({
    description: () => "Configure git credentials for PAT-based push",
    execute: async ({ action }) => {
      if (!isGitEnvironment()) {
        return {
          ok: true,
          skipped: true,
          message: "Git setup skipped (not in CI)",
        };
      }
      const { token } = action.payload;
      await execLog('git config user.name "nopo-bot"');
      await execLog(
        'git config user.email "nopo-bot@users.noreply.github.com"',
      );
      await execLog(
        `git config url."https://x-access-token:${token}@github.com/".insteadOf "https://github.com/"`,
      );
      // Verify by reading back
      const { stdout: userName } = await execLog("git config user.name");
      const { stdout: userEmail } = await execLog("git config user.email");
      return {
        ok: true,
        message: "Git credentials configured",
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
        return {
          ok: true,
          skipped: true,
          message: "Branch prep skipped (not in CI)",
          branch: action.payload.branchName,
        };
      }
      const { branchName, baseBranch = "main" } = action.payload;

      // Fetch all refs
      await execLog("git fetch origin");

      // Check if remote branch exists
      let remoteBranchExists = false;
      try {
        await execLog(`git rev-parse --verify origin/${branchName}`);
        remoteBranchExists = true;
      } catch {
        // Branch doesn't exist remotely
      }

      if (remoteBranchExists) {
        // Checkout existing branch
        try {
          await execLog(`git checkout ${branchName}`);
        } catch {
          // Local branch doesn't exist, create from remote
          await execLog(`git checkout -b ${branchName} origin/${branchName}`);
        }
      } else {
        // Create new branch from base
        try {
          await execLog(`git checkout -b ${branchName} origin/${baseBranch}`);
        } catch {
          // Branch might already exist locally
          await execLog(`git checkout ${branchName}`);
          await execLog(`git reset --hard origin/${baseBranch}`);
        }
      }

      // Check if behind main and rebase if needed
      const { stdout: behindCount } = await execLog(
        `git rev-list --count HEAD..origin/${baseBranch}`,
      );
      const behind = parseInt(behindCount.trim(), 10);

      if (behind > 0) {
        try {
          await execLog(`git rebase origin/${baseBranch}`);
        } catch {
          // Abort rebase on conflict
          await execLog("git rebase --abort");
          ctx.branchPrepResult = "conflicts";
          return {
            ok: true,
            message: "Branch has conflicts",
            branch: branchName,
            result: "conflicts" as const,
          };
        }

        // Rebase succeeded — force push the rebased branch
        await execLog(`git push --force-with-lease origin HEAD:${branchName}`);
        ctx.branchPrepResult = "rebased";

        // Read back current branch
        const { stdout: currentBranch } = await execLog(
          "git branch --show-current",
        );
        return {
          ok: true,
          message: "Branch rebased",
          branch: currentBranch.trim(),
          result: "rebased" as const,
        };
      }

      ctx.branchPrepResult = "clean";

      // Read back current branch
      const { stdout: currentBranch } = await execLog(
        "git branch --show-current",
      );

      return {
        ok: true,
        message: "Branch ready",
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
        return { ok: true, skipped: true, message: "Push skipped (not in CI)" };
      }
      const { branchName, forceWithLease = true } = action.payload;
      const forceFlag = forceWithLease ? " --force-with-lease" : "";
      await execLog(`git push${forceFlag} origin HEAD:${branchName}`);

      // Read back local HEAD sha
      const { stdout: localSha } = await execLog("git rev-parse HEAD");

      return {
        ok: true,
        message: `Pushed to ${branchName}`,
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

export function markPRReadyAction(createAction: ExampleCreateAction) {
  return createAction<{ prNumber: number }>({
    description: (action) =>
      `Mark PR #${action.payload.prNumber} as ready for review`,
    execute: async ({ action, ctx }) => {
      await markPRReady(ctx, action.payload.prNumber);
      return {
        ok: true,
        message: `PR #${action.payload.prNumber} marked ready`,
      };
    },
    predict: (action) => ({
      description: `Mark PR #${action.payload.prNumber} as ready for review`,
      checks: [
        {
          field: "pr.isDraft",
          comparator: "eq" as const,
          expected: false,
          description: "PR is no longer a draft",
        },
      ],
    }),
    verify: ({ executeResult }) => {
      if (!isOkResult(executeResult)) {
        return { message: "markPRReady execute did not return ok=true" };
      }
      return undefined;
    },
  });
}

export function requestReviewerAction(createAction: ExampleCreateAction) {
  return createAction<{ prNumber: number; reviewer: string }>({
    description: (action) =>
      `Request review from ${action.payload.reviewer} on PR #${action.payload.prNumber}`,
    execute: async ({ action, ctx }) => {
      try {
        await requestReviewer(
          ctx,
          action.payload.prNumber,
          action.payload.reviewer,
        );
        return {
          ok: true,
          message: `Requested review from ${action.payload.reviewer}`,
        };
      } catch (error) {
        // Non-fatal: reviewer might be the PR author or unavailable.
        // Don't abort the queue — updateStatus must still run.
        const msg = error instanceof Error ? error.message : String(error);
        return {
          ok: true,
          skipped: true,
          message: `Review request skipped: ${msg}`,
          reason: msg,
        };
      }
    },
    verify: ({ executeResult }) => {
      if (!isOkResult(executeResult)) {
        return {
          message: "requestReviewer execute did not return ok=true",
        };
      }
      return undefined;
    },
  });
}

export function stopAction(createAction: ExampleCreateAction) {
  return createAction<{ message: string }>({
    description: (action) => `Stop: ${action.payload.message}`,
    execute: async ({ action }) => ({
      ok: true,
      message: action.payload.message,
    }),
  });
}

export type ExampleRegistry = TActionRegistryFromDefs<{
  updateStatus: ReturnType<typeof updateStatusAction>;
  removeLabels: ReturnType<typeof removeLabelsAction>;
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
  setupGit: ReturnType<typeof setupGitAction>;
  prepareBranch: ReturnType<typeof prepareBranchAction>;
  gitPush: ReturnType<typeof gitPushAction>;
  markPRReady: ReturnType<typeof markPRReadyAction>;
  requestReviewer: ReturnType<typeof requestReviewerAction>;
  stop: ReturnType<typeof stopAction>;
}>;
export type ExampleAction = ActionFromRegistry<ExampleRegistry>;
