/**
 * Claude Code - Library Exports
 *
 * This file exports the Claude SDK utilities for use as a library.
 * For the GitHub Action entry point, see action-entry.ts.
 */

export {
  executeClaudeSDK,
  isClaudeAvailable,
  getClaudeVersion,
} from "./src/executor.js";
export {
  resolvePrompt,
  resolvePromptDir,
  substituteVars,
  buildImplementationPrompt,
  buildCIFixPrompt,
  buildReviewResponsePrompt,
} from "./src/prompts.js";
export type {
  ClaudeExecutorOptions,
  ClaudeResult,
  PromptResolutionOptions,
  ResolvedPrompt,
} from "./src/types.js";
