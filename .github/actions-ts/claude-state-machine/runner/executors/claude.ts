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
  /** Parsed structured output if --json-schema was used */
  structuredOutput?: unknown;
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
 * Run Claude Code CLI
 *
 * This invokes the Claude Code CLI (claude) with the specified prompt.
 * The CLI is expected to be available in PATH.
 *
 * If an output schema is provided (via promptDir with outputs.json),
 * the --json-schema flag is added to request structured output.
 */
export async function executeRunClaude(
  action: RunClaudeAction,
  ctx: RunnerContext,
): Promise<ClaudeRunResult> {
  const args: string[] = [
    "--print", // Print output to stdout (non-interactive mode)
    "--dangerously-skip-permissions", // Skip all permission prompts (for CI/automated runs)
  ];

  // Get prompt and optional schema
  const { prompt, outputSchema } = getPromptFromAction(action);

  // Add JSON schema if outputs.json exists (structured output mode)
  if (outputSchema) {
    // Compact the schema to a single line for CLI argument
    const compactSchema = JSON.stringify(JSON.parse(outputSchema));
    args.push("--json-schema", compactSchema);
    core.info("Using structured output mode with JSON schema");
  }

  // Add allowed tools if specified
  if (action.allowedTools && action.allowedTools.length > 0) {
    for (const tool of action.allowedTools) {
      args.push("--allowedTools", tool);
    }
  }

  // Add the prompt as a positional argument (must be last)
  args.push(prompt);

  let stdout = "";
  let stderr = "";

  // Set up working directory
  const cwd = action.worktree || process.cwd();

  core.info(`Running Claude for issue #${action.issueNumber}`);
  core.info(`Working directory: ${cwd}`);
  core.debug(`Prompt: ${prompt.slice(0, 200)}...`);

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

    // Parse structured output if schema was used
    let structuredOutput: unknown;
    if (outputSchema) {
      try {
        // The output should be valid JSON when using --json-schema
        structuredOutput = JSON.parse(stdout.trim());
        core.info("Parsed structured output successfully");
        core.startGroup("Structured Output");
        core.info(JSON.stringify(structuredOutput, null, 2));
        core.endGroup();
      } catch (parseError) {
        core.warning(
          `Failed to parse structured output: ${parseError}. Raw output will be available.`,
        );
      }
    }

    return {
      success: true,
      exitCode: 0,
      output: stdout,
      structuredOutput,
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
