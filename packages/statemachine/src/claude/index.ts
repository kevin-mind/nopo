/**
 * Claude Code - Library Exports
 *
 * This file exports the Claude SDK utilities for use as a library.
 */

export {
  executeClaudeSDK,
  isClaudeAvailable,
  getClaudeVersion,
} from "./executor.js";
export {
  resolvePrompt,
  buildImplementationPrompt,
  buildCIFixPrompt,
  buildReviewResponsePrompt,
} from "./prompts.js";
export type {
  ClaudeExecutorOptions,
  ClaudeResult,
  PromptResolutionOptions,
  ResolvedPrompt,
} from "./types.js";
