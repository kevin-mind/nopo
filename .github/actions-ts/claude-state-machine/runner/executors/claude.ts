import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as fs from "fs";
import * as path from "path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type {
  SDKMessage,
  SDKResultMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { RunClaudeAction } from "../../schemas/index.js";
import type { RunnerContext } from "../runner.js";
import { deriveBranchName } from "../../parser/index.js";

// ============================================================================
// Claude Code Executor (SDK-based)
// ============================================================================

/**
 * Result of running Claude
 */
interface ClaudeRunResult {
  success: boolean;
  exitCode: number;
  output: string;
  error?: string;
  /** Parsed structured output if --json-schema was used */
  structuredOutput?: unknown;
}

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
 * Result of resolving a prompt from an action
 */
interface ResolvedPrompt {
  prompt: string;
  outputSchema?: string; // JSON schema content if outputs.json exists
}

/**
 * Resolve prompt directory to paths
 * Returns the prompt file path and optional schema path
 */
function resolvePromptDir(promptDir: string): {
  promptPath: string;
  schemaPath?: string;
} {
  const dirPath = path.resolve(process.cwd(), ".github/prompts", promptDir);
  const promptPath = path.join(dirPath, "prompt.txt");
  const schemaPath = path.join(dirPath, "outputs.json");

  return {
    promptPath,
    schemaPath: fs.existsSync(schemaPath) ? schemaPath : undefined,
  };
}

/**
 * Get the prompt string and optional schema from action
 * Supports: direct prompt, promptFile, or promptDir
 */
function getPromptFromAction(action: RunClaudeAction): ResolvedPrompt {
  if (action.prompt) {
    // Direct prompt provided
    let prompt = action.prompt;
    if (action.promptVars) {
      prompt = substituteVars(prompt, action.promptVars);
    }
    return { prompt };
  }

  if (action.promptDir) {
    // Prompt directory (new style: .github/prompts/{name}/)
    const { promptPath, schemaPath } = resolvePromptDir(action.promptDir);

    if (!fs.existsSync(promptPath)) {
      throw new Error(
        `Prompt file not found: ${promptPath} (from promptDir: ${action.promptDir})`,
      );
    }

    let prompt = fs.readFileSync(promptPath, "utf-8");
    if (action.promptVars) {
      prompt = substituteVars(prompt, action.promptVars);
    }

    const outputSchema = schemaPath
      ? fs.readFileSync(schemaPath, "utf-8")
      : undefined;

    return { prompt, outputSchema };
  }

  if (action.promptFile) {
    // Read from file (legacy style)
    const promptPath = path.resolve(process.cwd(), action.promptFile);
    if (!fs.existsSync(promptPath)) {
      throw new Error(`Prompt file not found: ${action.promptFile}`);
    }
    let prompt = fs.readFileSync(promptPath, "utf-8");
    if (action.promptVars) {
      prompt = substituteVars(prompt, action.promptVars);
    }
    return { prompt };
  }

  throw new Error("Either prompt, promptFile, or promptDir must be provided");
}

/**
 * Log SDK messages for real-time visibility in GitHub Actions
 */
function logSdkMessage(message: SDKMessage): void {
  // Log based on message type for real-time visibility
  switch (message.type) {
    case "system":
      if ("subtype" in message && message.subtype === "init") {
        core.info(
          `Claude initialized (model: ${"model" in message ? message.model : "unknown"})`,
        );
      }
      break;
    case "assistant":
      if ("message" in message && message.message) {
        const content = message.message.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "text") {
              // Log text content - truncate if too long
              const text = block.text;
              if (text.length > 500) {
                core.info(`[Assistant] ${text.slice(0, 500)}...`);
              } else {
                core.info(`[Assistant] ${text}`);
              }
            } else if (block.type === "tool_use") {
              core.info(`[Tool] Using: ${block.name}`);
            }
          }
        }
      }
      break;
    case "user":
      // Tool results - just log that we received them
      core.debug("[Tool] Received tool result");
      break;
    case "result":
      // Final result - logged separately
      break;
    default:
      core.debug(`[SDK] Message type: ${message.type}`);
  }
}

/**
 * Run Claude Code using the Agent SDK
 *
 * This uses the official Claude Agent SDK for more reliable execution
 * compared to spawning the CLI subprocess.
 *
 * If an output schema is provided (via promptDir with outputs.json),
 * the --json-schema flag is added to request structured output.
 *
 * If mockOutputs are provided in the context and there's a matching mock
 * for the prompt directory, the mock output is returned instead of running Claude.
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

  // Get prompt and optional schema
  const { prompt, outputSchema } = getPromptFromAction(action);

  // Set up working directory
  const cwd = action.worktree || process.cwd();

  core.info(`Running Claude via SDK for issue #${action.issueNumber}`);
  core.info(`Working directory: ${cwd}`);
  core.debug(`Prompt: ${prompt.slice(0, 200)}...`);

  // Build SDK options
  const extraArgs: Record<string, string | null> = {};

  // Add JSON schema if outputs.json exists (structured output mode)
  if (outputSchema) {
    extraArgs["json-schema"] = outputSchema;
    core.info("Using structured output mode with JSON schema");
  }

  // Build environment for SDK
  const env: Record<string, string | undefined> = {
    ...process.env,
    // Pass through GitHub context
    GITHUB_REPOSITORY: `${ctx.owner}/${ctx.repo}`,
    GITHUB_SERVER_URL: ctx.serverUrl,
    // Ensure non-interactive mode
    CI: "true",
  };

  // Build allowed/disallowed tools
  const allowedTools = action.allowedTools || undefined;

  // Filter out undefined values from env (SDK doesn't handle them well)
  const cleanEnv = Object.fromEntries(
    Object.entries(env).filter(([, v]) => v !== undefined),
  ) as Record<string, string>;

  // Set entrypoint for Claude to identify as GitHub Action
  cleanEnv.CLAUDE_CODE_ENTRYPOINT = "nopo-state-machine";

  const sdkOptions = {
    cwd,
    env: cleanEnv,
    allowedTools,
    extraArgs,
    // Use all settings sources
    settingSources: ["user", "project", "local"] as (
      | "user"
      | "project"
      | "local"
    )[],
    // Skip permission prompts for CI
    permissionMode: "acceptEdits" as const,
    // Default to claude_code preset for system prompt
    systemPrompt: {
      type: "preset" as const,
      preset: "claude_code" as const,
    },
  };

  core.startGroup("SDK Options");
  core.info(JSON.stringify({ ...sdkOptions, env: "[env hidden]" }, null, 2));
  core.endGroup();

  const messages: SDKMessage[] = [];
  let resultMessage: SDKResultMessage | undefined;

  try {
    core.info("Starting Claude SDK query...");

    for await (const message of query({ prompt, options: sdkOptions })) {
      messages.push(message);
      logSdkMessage(message);

      if (message.type === "result") {
        resultMessage = message as SDKResultMessage;
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    core.error(`SDK execution error: ${errorMessage}`);
    return {
      success: false,
      exitCode: 1,
      output: JSON.stringify(messages, null, 2),
      error: errorMessage,
    };
  }

  // Check for result
  if (!resultMessage) {
    core.error("No result message received from Claude");
    return {
      success: false,
      exitCode: 1,
      output: JSON.stringify(messages, null, 2),
      error: "No result message received from Claude",
    };
  }

  const isSuccess = resultMessage.subtype === "success";
  core.info(`Claude completed with result: ${resultMessage.subtype}`);

  // Log result summary
  core.startGroup("Result Summary");
  core.info(`Duration: ${resultMessage.duration_ms}ms`);
  core.info(`Turns: ${resultMessage.num_turns}`);
  core.info(`Cost: $${resultMessage.total_cost_usd?.toFixed(4) || "N/A"}`);
  core.endGroup();

  // Extract structured output if schema was used
  let structuredOutput: unknown;
  if (outputSchema && "structured_output" in resultMessage) {
    structuredOutput = resultMessage.structured_output;
    if (structuredOutput) {
      core.info("Parsed structured output successfully");
      core.startGroup("Structured Output");
      core.info(JSON.stringify(structuredOutput, null, 2));
      core.endGroup();
    }
  }

  if (!isSuccess) {
    return {
      success: false,
      exitCode: 1,
      output: JSON.stringify(messages, null, 2),
      structuredOutput,
      error: resultMessage.is_error
        ? "Claude execution failed"
        : "Claude did not complete successfully",
    };
  }

  core.info(`Claude completed successfully for issue #${action.issueNumber}`);

  return {
    success: true,
    exitCode: 0,
    output: JSON.stringify(messages, null, 2),
    structuredOutput,
  };
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
