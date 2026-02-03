/**
 * Claude Code Executor for State Machine
 *
 * Wraps the standalone Claude action with state-machine specific functionality:
 * - Mock mode for testing (returns fixture outputs, creates placeholder commits)
 * - Integration with RunClaudeAction schema
 * - Branch derivation for commit targeting
 */

import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as fs from "fs";
import {
  executeClaudeSDK,
  resolvePrompt,
  isClaudeAvailable,
  getClaudeVersion,
  buildImplementationPrompt,
  buildCIFixPrompt,
  buildReviewResponsePrompt,
} from "../../../claude/index.js";
import type { RunClaudeAction } from "../../schemas/index.js";
import type { RunnerContext } from "../runner.js";
import { deriveBranchName } from "../../parser/index.js";

// Re-export utilities for backwards compatibility
export {
  isClaudeAvailable,
  getClaudeVersion,
  buildImplementationPrompt,
  buildCIFixPrompt,
  buildReviewResponsePrompt,
};

// ============================================================================
// Types
// ============================================================================

/**
 * Result of running Claude
 */
interface ClaudeRunResult {
  success: boolean;
  exitCode: number;
  output: string;
  error?: string;
  structuredOutput?: unknown;
}

// ============================================================================
// Mock Mode Support
// ============================================================================

/**
 * Create a mock commit for test mode
 *
 * When Claude runs in real mode, it creates commits as a side effect.
 * In mock mode, we need to create a placeholder commit so that PR creation
 * can succeed (GitHub requires at least one commit difference from base branch).
 */
async function createMockCommit(
  action: RunClaudeAction,
  _ctx: RunnerContext,
): Promise<void> {
  const branchName = deriveBranchName(action.issueNumber);

  core.info(`[MOCK MODE] Creating placeholder commit on branch ${branchName}`);

  try {
    // Configure git user identity (required for commits in GitHub Actions)
    await exec.exec("git", ["config", "user.name", "nopo-bot"]);
    await exec.exec("git", [
      "config",
      "user.email",
      "nopo-bot@users.noreply.github.com",
    ]);

    // Checkout the branch (it should already exist from createBranch action)
    const checkoutCode = await exec.exec("git", ["checkout", branchName], {
      ignoreReturnCode: true,
    });

    if (checkoutCode !== 0) {
      // Branch might not exist locally, try to fetch and checkout
      await exec.exec("git", ["fetch", "origin", branchName], {
        ignoreReturnCode: true,
      });
      await exec.exec(
        "git",
        ["checkout", "-b", branchName, `origin/${branchName}`],
        { ignoreReturnCode: true },
      );
    }

    // Create a placeholder file
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

    // Stage the file
    await exec.exec("git", ["add", mockFilePath]);

    // Commit
    const commitMessage = `test: mock commit for issue #${action.issueNumber}

This is a placeholder commit created by the test runner.
It simulates Claude's code changes in mock mode.`;

    const commitExitCode = await exec.exec(
      "git",
      ["commit", "--no-verify", "-m", commitMessage],
      {
        ignoreReturnCode: true,
      },
    );

    if (commitExitCode !== 0) {
      core.warning(
        `[MOCK MODE] Git commit failed with exit code ${commitExitCode}`,
      );
      return;
    }

    // Push to remote
    const pushExitCode = await exec.exec(
      "git",
      ["push", "origin", branchName],
      {
        ignoreReturnCode: true,
      },
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
    // Continue anyway - the test might still work depending on what actions follow
  }
}

// ============================================================================
// Main Executor
// ============================================================================

/**
 * Run Claude Code SDK for a state machine action
 *
 * This wraps the standalone executor with:
 * - Mock mode support (returns fixture outputs, creates placeholder commits)
 * - RunClaudeAction schema integration
 * - Prompt resolution from action fields
 */
export async function executeRunClaude(
  action: RunClaudeAction,
  ctx: RunnerContext,
): Promise<ClaudeRunResult> {
  // Check for mock mode - skip real Claude and return mock output
  if (ctx.mockOutputs && action.promptDir) {
    const mockOutput = ctx.mockOutputs[action.promptDir];
    if (mockOutput) {
      core.info(
        `[MOCK MODE] Using mock output for '${action.promptDir}' prompt`,
      );
      core.startGroup("Mock Structured Output");
      core.info(JSON.stringify(mockOutput, null, 2));
      core.endGroup();

      // In mock mode, create a placeholder commit to simulate Claude's side effects
      // This ensures PR creation can succeed (requires at least one commit)
      await createMockCommit(action, ctx);

      return {
        success: true,
        exitCode: 0,
        output: JSON.stringify({ structured_output: mockOutput }),
        structuredOutput: mockOutput,
      };
    }
    core.warning(
      `[MOCK MODE] No mock output for '${action.promptDir}' prompt, running real Claude`,
    );
  }

  // Resolve prompt from action
  const resolved = resolvePrompt({
    prompt: action.prompt,
    promptDir: action.promptDir,
    promptFile: action.promptFile,
    promptVars: action.promptVars,
  });

  core.info(`Running Claude SDK for issue #${action.issueNumber}`);

  // Execute using the standalone executor
  const result = await executeClaudeSDK({
    prompt: resolved.prompt,
    cwd: action.worktree || process.cwd(),
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
}
