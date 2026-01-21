import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as fs from "fs";
import * as path from "path";
import type { RunClaudeAction } from "../../schemas/index.js";
import type { RunnerContext } from "../runner.js";

// ============================================================================
// Claude Code Executor
// ============================================================================

/**
 * Result of running Claude
 */
interface ClaudeRunResult {
  success: boolean;
  exitCode: number;
  output: string;
  error?: string;
}

/**
 * Options for running Claude
 */
interface ClaudeOptions {
  prompt: string;
  worktree?: string;
  timeout?: number; // in milliseconds
  maxTurns?: number;
  allowedTools?: string[];
}

/**
 * Substitute template variables in a string
 * Replaces {{VAR_NAME}} with the corresponding value from vars
 */
function substituteVars(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (match, varName) => {
    const trimmedName = varName.trim();
    return vars[trimmedName] ?? match; // Keep original if not found
  });
}

/**
 * Get the prompt string from action (either directly or from file)
 */
function getPromptFromAction(action: RunClaudeAction): string {
  if (action.prompt) {
    // Direct prompt provided
    let prompt = action.prompt;
    if (action.promptVars) {
      prompt = substituteVars(prompt, action.promptVars);
    }
    return prompt;
  }

  if (action.promptFile) {
    // Read from file
    const promptPath = path.resolve(process.cwd(), action.promptFile);
    if (!fs.existsSync(promptPath)) {
      throw new Error(`Prompt file not found: ${action.promptFile}`);
    }
    let prompt = fs.readFileSync(promptPath, "utf-8");
    if (action.promptVars) {
      prompt = substituteVars(prompt, action.promptVars);
    }
    return prompt;
  }

  throw new Error("Either prompt or promptFile must be provided");
}

/**
 * Run Claude Code CLI
 *
 * This invokes the Claude Code CLI (claude) with the specified prompt.
 * The CLI is expected to be available in PATH.
 */
export async function executeRunClaude(
  action: RunClaudeAction,
  ctx: RunnerContext,
): Promise<ClaudeRunResult> {
  const args: string[] = [
    "--print", // Print output to stdout
    "-y", // Auto-accept prompts (skip permission confirmations)
  ];

  // Get the prompt (from direct string or file)
  const prompt = getPromptFromAction(action);
  args.push("--prompt", prompt);

  // Add allowed tools if specified
  if (action.allowedTools && action.allowedTools.length > 0) {
    for (const tool of action.allowedTools) {
      args.push("--allowedTools", tool);
    }
  }

  let stdout = "";
  let stderr = "";

  // Set up working directory
  const cwd = action.worktree || process.cwd();

  core.info(`Running Claude for issue #${action.issueNumber}`);
  core.info(`Working directory: ${cwd}`);
  core.debug(`Prompt: ${action.prompt.slice(0, 200)}...`);

  try {
    const exitCode = await exec.exec("claude", args, {
      cwd,
      ignoreReturnCode: true,
      env: {
        ...process.env,
        // Pass through GitHub context
        GITHUB_REPOSITORY: `${ctx.owner}/${ctx.repo}`,
        GITHUB_SERVER_URL: ctx.serverUrl,
        // Ensure non-interactive mode
        CI: "true",
      },
      listeners: {
        stdout: (data) => {
          stdout += data.toString();
        },
        stderr: (data) => {
          stderr += data.toString();
        },
      },
    });

    if (exitCode !== 0) {
      core.warning(`Claude exited with code ${exitCode}`);
      return {
        success: false,
        exitCode,
        output: stdout,
        error: stderr || `Exit code: ${exitCode}`,
      };
    }

    core.info(`Claude completed successfully for issue #${action.issueNumber}`);
    return {
      success: true,
      exitCode: 0,
      output: stdout,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    core.error(`Failed to run Claude: ${errorMessage}`);
    return {
      success: false,
      exitCode: 1,
      output: stdout,
      error: errorMessage,
    };
  }
}

/**
 * Check if Claude CLI is available
 */
export async function isClaudeAvailable(): Promise<boolean> {
  try {
    const exitCode = await exec.exec("which", ["claude"], {
      ignoreReturnCode: true,
      silent: true,
    });
    return exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Get Claude version
 */
export async function getClaudeVersion(): Promise<string | null> {
  let stdout = "";

  try {
    const exitCode = await exec.exec("claude", ["--version"], {
      ignoreReturnCode: true,
      silent: true,
      listeners: {
        stdout: (data) => {
          stdout += data.toString();
        },
      },
    });

    if (exitCode !== 0) {
      return null;
    }

    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Build a prompt for implementing an issue
 */
export function buildImplementationPrompt(
  issueNumber: number,
  issueTitle: string,
  issueBody: string,
  branch: string,
): string {
  return `You are implementing GitHub issue #${issueNumber}: ${issueTitle}

## Issue Description

${issueBody}

## Instructions

1. Work on branch: ${branch}
2. Implement the requirements described in the issue
3. Ensure all tests pass
4. Commit your changes with clear commit messages
5. Push when ready

Focus on completing all the TODO items in the issue description.
If you encounter any blockers, document them clearly.`;
}

/**
 * Build a prompt for fixing CI failures
 */
export function buildCIFixPrompt(
  issueNumber: number,
  ciRunUrl: string | null,
  commitSha: string | null,
): string {
  return `You are fixing CI failures for issue #${issueNumber}.

## CI Information

- CI Run: ${ciRunUrl || "N/A"}
- Commit: ${commitSha || "N/A"}

## Instructions

1. Check the CI logs at the URL above
2. Identify the failing tests or build errors
3. Fix the issues in your code
4. Ensure all tests pass locally before pushing
5. Push your fixes

Common issues to check:
- Type errors
- Lint violations
- Failing tests
- Build errors`;
}

/**
 * Build a prompt for addressing review feedback
 */
export function buildReviewResponsePrompt(
  issueNumber: number,
  reviewDecision: string | null,
  reviewer: string | null,
): string {
  return `You are addressing review feedback for issue #${issueNumber}.

## Review Information

- Decision: ${reviewDecision || "N/A"}
- Reviewer: ${reviewer || "N/A"}

## Instructions

1. Review the feedback provided in the PR comments
2. Address each piece of feedback
3. Make the necessary code changes
4. Ensure all tests still pass
5. Push your updates

If you disagree with any feedback, document your reasoning in a comment.`;
}
