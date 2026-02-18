/**
 * Types for Claude Action
 */

/**
 * Options for running Claude SDK
 */
export interface ClaudeExecutorOptions {
  /** The prompt to send to Claude */
  prompt: string;

  /** Working directory for Claude to operate in */
  cwd?: string;

  /** Path to Claude Code executable (defaults to ~/.local/bin/claude) */
  claudePath?: string;

  /** Allowed tools for Claude to use */
  allowedTools?: string[];

  /** JSON schema for structured output */
  outputSchema?: object;

  /** Permission mode: "acceptEdits" (default) or "bypassPermissions" */
  permissionMode?: "acceptEdits" | "bypassPermissions";

  /** Env vars to merge/override when running Claude (e.g. GH_TOKEN for review vs code token) */
  envOverrides?: Record<string, string>;
}

/**
 * Result of running Claude
 */
export interface ClaudeResult {
  /** Whether execution succeeded */
  success: boolean;

  /** Exit code (0 for success) */
  exitCode: number;

  /** Raw text output from Claude */
  output: string;

  /** Error message if failed */
  error?: string;

  /** Parsed structured output if outputSchema was provided */
  structuredOutput?: unknown;

  /** Number of turns (API round-trips) */
  numTurns?: number;

  /** Total cost in USD */
  costUsd?: number;
}

/**
 * Options for resolving prompts from files/directories
 */
export interface PromptResolutionOptions {
  /** Direct prompt text */
  prompt?: string;

  /** Path to prompt file */
  promptFile?: string;

  /** Directory name containing prompt.txt and optional outputs.json */
  promptDir?: string;

  /** Base directory for prompts (defaults to .github/prompts/) */
  promptsDir?: string;

  /** Base path for resolving relative paths (defaults to cwd) */
  basePath?: string;

  /** Variables to substitute in the prompt (replaces {{VAR_NAME}}) */
  promptVars?: Record<string, string>;
}

/**
 * Resolved prompt ready for execution
 */
export interface ResolvedPrompt {
  /** The prompt text with variables substituted */
  prompt: string;

  /** JSON schema for structured output (if outputs.json exists in promptDir) */
  outputSchema?: object;
}
