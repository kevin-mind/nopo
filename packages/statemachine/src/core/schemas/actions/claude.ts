/**
 * Claude Actions
 *
 * Actions for running Claude Code SDK (iterate, review, etc.) and
 * parallel grooming agents.
 */

import { z } from "zod";
import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as fs from "fs";
import { executeClaudeSDK, resolvePrompt } from "@more/claude";
import { deriveBranchName } from "../../parser/index.js";
import type { RunnerContext } from "../../executor.js";
import {
  CombinedGroomingOutputSchema,
  parseOutput,
  type CombinedGroomingOutput,
} from "../../helpers/output-schemas.js";
import { mkSchema, defAction } from "./_shared.js";

// ============================================================================
// Types
// ============================================================================

interface ClaudeRunResult {
  success: boolean;
  exitCode: number;
  output: string;
  error?: string;
  structuredOutput?: unknown;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a mock commit for test mode
 */
async function createMockCommit(
  action: { issueNumber: number; promptDir?: string; promptFile?: string },
  _ctx: RunnerContext,
): Promise<void> {
  const branchName = deriveBranchName(action.issueNumber);

  core.info(`[MOCK MODE] Creating placeholder commit on branch ${branchName}`);

  try {
    await exec.exec("git", ["config", "user.name", "nopo-bot"]);
    await exec.exec("git", [
      "config",
      "user.email",
      "nopo-bot@users.noreply.github.com",
    ]);

    const checkoutCode = await exec.exec("git", ["checkout", branchName], {
      ignoreReturnCode: true,
    });

    if (checkoutCode !== 0) {
      await exec.exec("git", ["fetch", "origin", branchName], {
        ignoreReturnCode: true,
      });
      await exec.exec(
        "git",
        ["checkout", "-b", branchName, `origin/${branchName}`],
        { ignoreReturnCode: true },
      );
    }

    const mockFilePath = ".mock-commit-placeholder";
    const timestamp = new Date().toISOString();
    const content = `# Mock Commit Placeholder
# This file was created by the test runner in mock mode.
# It simulates Claude's code changes without running the actual Claude CLI.

Timestamp: ${timestamp}
Issue: #${action.issueNumber}
Prompt: ${action.promptDir || action.promptFile || "inline"}
`;

    fs.writeFileSync(mockFilePath, content);
    await exec.exec("git", ["add", mockFilePath]);

    const commitMessage = `test: mock commit for issue #${action.issueNumber}

This is a placeholder commit created by the test runner.
It simulates Claude's code changes in mock mode.`;

    const commitExitCode = await exec.exec(
      "git",
      ["commit", "--no-verify", "-m", commitMessage],
      { ignoreReturnCode: true },
    );

    if (commitExitCode !== 0) {
      core.warning(
        `[MOCK MODE] Git commit failed with exit code ${commitExitCode}`,
      );
      return;
    }

    const pushExitCode = await exec.exec(
      "git",
      ["push", "origin", branchName],
      { ignoreReturnCode: true },
    );

    if (pushExitCode !== 0) {
      core.warning(
        `[MOCK MODE] Git push failed with exit code ${pushExitCode}`,
      );
      return;
    }

    core.info(`[MOCK MODE] Created and pushed placeholder commit`);
  } catch (error) {
    core.warning(
      `[MOCK MODE] Failed to create mock commit: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Run a single grooming agent via Claude SDK
 */
async function runGroomingAgent(
  agentName: string,
  promptVars: Record<string, string>,
): Promise<unknown> {
  core.info(`Starting grooming agent: ${agentName}`);

  const resolved = resolvePrompt({
    promptDir: `grooming/${agentName}`,
    promptVars,
  });

  core.startGroup(`Grooming Agent: ${agentName}`);
  const result = await executeClaudeSDK({
    prompt: resolved.prompt,
    cwd: process.cwd(),
    outputSchema: resolved.outputSchema,
  });
  core.endGroup();

  if (!result.success || !result.structuredOutput) {
    core.warning(
      `Grooming agent ${agentName} failed: ${result.error || "no structured output"}`,
    );
    return {
      ready: false,
      questions: [`Agent ${agentName} failed to complete analysis`],
    };
  }

  core.info(
    `Grooming agent ${agentName} completed (${result.numTurns} turns, $${result.costUsd?.toFixed(4) ?? "?"})`,
  );
  return result.structuredOutput;
}

// ============================================================================
// Claude Actions
// ============================================================================

export const claudeActions = {
  /**
   * Run Claude to work on an issue.
   * One of `prompt`, `promptFile`, or `promptDir` must be provided at runtime.
   */
  runClaude: defAction(
    mkSchema("runClaude", {
      issueNumber: z.number().int().positive(),
      prompt: z.string().min(1).optional(),
      promptFile: z.string().min(1).optional(),
      promptDir: z.string().min(1).optional(),
      promptsDir: z.string().min(1).optional(),
      promptVars: z.record(z.string()).optional(),
      allowedTools: z.array(z.string()).optional(),
      worktree: z.string().optional(),
    }),
    {
      execute: async (action, ctx): Promise<ClaudeRunResult> => {
        // Check for mock mode
        if (ctx.mockOutputs) {
          let mockKey = action.promptDir;
          if (!mockKey && action.promptFile) {
            const pathParts = action.promptFile.split("/");
            const promptTxtIndex = pathParts.findIndex(
              (p: string) => p === "prompt.txt",
            );
            if (promptTxtIndex > 0) {
              mockKey = pathParts[promptTxtIndex - 1];
            }
          }

          if (mockKey) {
            const mockOutput = ctx.mockOutputs[mockKey];
            if (mockOutput) {
              core.info(
                `[MOCK MODE] Using mock output for '${mockKey}' prompt`,
              );
              core.startGroup("Mock Output");
              core.info(JSON.stringify(mockOutput, null, 2));
              core.endGroup();

              const promptsThatCreateCommits = ["iterate", "ci-fix"];
              if (mockKey && promptsThatCreateCommits.includes(mockKey)) {
                await createMockCommit(action, ctx);
              }

              return {
                success: true,
                exitCode: 0,
                output: JSON.stringify({ structured_output: mockOutput }),
                structuredOutput: mockOutput,
              };
            }
            core.warning(
              `[MOCK MODE] No mock output for '${mockKey}' prompt, running real Claude`,
            );
          }
        }

        // Augment promptVars with issue context
        let augmentedPromptVars = action.promptVars;
        if (ctx.issueContext && action.promptVars) {
          augmentedPromptVars = {
            ...action.promptVars,
            ISSUE_BODY: action.promptVars.ISSUE_BODY ?? ctx.issueContext.body,
            ISSUE_COMMENTS:
              action.promptVars.ISSUE_COMMENTS ??
              ctx.issueContext.comments ??
              "No comments yet.",
          };
        }

        const resolved = resolvePrompt({
          prompt: action.prompt,
          promptDir: action.promptDir,
          promptFile: action.promptFile,
          promptsDir: action.promptsDir,
          promptVars: augmentedPromptVars,
        });

        core.info(`Running Claude SDK for issue #${action.issueNumber}`);
        core.startGroup("Claude Prompt");
        core.info(resolved.prompt);
        core.endGroup();

        let cwd = process.cwd();
        if (
          action.worktree &&
          (action.worktree.startsWith("/") || action.worktree.startsWith("."))
        ) {
          cwd = action.worktree;
        }

        const result = await executeClaudeSDK({
          prompt: resolved.prompt,
          cwd,
          allowedTools: action.allowedTools,
          outputSchema: resolved.outputSchema,
        });

        core.info(`Claude completed for issue #${action.issueNumber}`);

        return {
          success: result.success,
          exitCode: result.exitCode,
          output: result.output,
          error: result.error,
          structuredOutput: result.structuredOutput,
        };
      },
    },
  ),

  /** Run Claude grooming agents in parallel */
  runClaudeGrooming: defAction(
    mkSchema("runClaudeGrooming", {
      issueNumber: z.number().int().positive(),
      promptVars: z.record(z.string()).optional(),
    }),
    {
      execute: async (
        action,
        ctx,
      ): Promise<{ outputs: CombinedGroomingOutput }> => {
        core.info(`Running grooming agents for issue #${action.issueNumber}`);

        if (ctx.dryRun) {
          core.info(`[DRY RUN] Would run 4 grooming agents in parallel`);
          return {
            outputs: {
              pm: { ready: true },
              engineer: { ready: true },
              qa: { ready: true },
              research: { ready: true },
            },
          };
        }

        if (ctx.mockOutputs?.grooming) {
          core.info("[MOCK MODE] Using mock grooming output");
          return {
            outputs: parseOutput(
              CombinedGroomingOutputSchema,
              ctx.mockOutputs.grooming,
              "mock grooming",
            ),
          };
        }

        const promptVars = action.promptVars ?? {};

        const [pmResult, engineerResult, qaResult, researchResult] =
          await Promise.all([
            runGroomingAgent("pm", promptVars),
            runGroomingAgent("engineer", promptVars),
            runGroomingAgent("qa", promptVars),
            runGroomingAgent("research", promptVars),
          ]);

        const outputs = parseOutput(
          CombinedGroomingOutputSchema,
          {
            pm: pmResult,
            engineer: engineerResult,
            qa: qaResult,
            research: researchResult,
          },
          "combined grooming",
        );

        core.info("All grooming agents completed");
        return { outputs };
      },
    },
  ),
};
