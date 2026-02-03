/**
 * Prompt resolution utilities
 */

import * as fs from "fs";
import * as path from "path";
import type { PromptResolutionOptions, ResolvedPrompt } from "./types.js";

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
 * Resolve a prompt directory to file paths
 *
 * Prompt directories are located at .github/prompts/{name}/ and contain:
 * - prompt.txt (required) - The prompt template
 * - outputs.json (optional) - JSON schema for structured output
 */
function resolvePromptDir(
  promptDir: string,
  basePath: string = process.cwd(),
): {
  promptPath: string;
  schemaPath?: string;
} {
  const dirPath = path.resolve(basePath, ".github/prompts", promptDir);
  const promptPath = path.join(dirPath, "prompt.txt");
  const schemaPath = path.join(dirPath, "outputs.json");

  return {
    promptPath,
    schemaPath: fs.existsSync(schemaPath) ? schemaPath : undefined,
  };
}

/**
 * Resolve prompt from various sources
 *
 * Supports three modes:
 * 1. Direct prompt text via `prompt`
 * 2. Prompt file via `promptFile`
 * 3. Prompt directory via `promptDir` (recommended - supports structured output)
 *
 * @param options - Prompt resolution options
 * @param basePath - Base path for resolving relative paths (defaults to cwd)
 * @returns Resolved prompt with optional output schema
 */
export function resolvePrompt(
  options: PromptResolutionOptions,
  basePath: string = process.cwd(),
): ResolvedPrompt {
  const { prompt, promptFile, promptDir, promptVars } = options;

  // Mode 1: Direct prompt
  if (prompt) {
    let resolvedPrompt = prompt;
    if (promptVars) {
      resolvedPrompt = substituteVars(resolvedPrompt, promptVars);
    }
    return { prompt: resolvedPrompt };
  }

  // Mode 2: Prompt directory (recommended)
  if (promptDir) {
    const { promptPath, schemaPath } = resolvePromptDir(promptDir, basePath);

    if (!fs.existsSync(promptPath)) {
      throw new Error(
        `Prompt file not found: ${promptPath} (from promptDir: ${promptDir})`,
      );
    }

    let resolvedPrompt = fs.readFileSync(promptPath, "utf-8");
    if (promptVars) {
      resolvedPrompt = substituteVars(resolvedPrompt, promptVars);
    }

    let outputSchema: object | undefined;
    if (schemaPath) {
      const schemaContent = fs.readFileSync(schemaPath, "utf-8");
      outputSchema = JSON.parse(schemaContent);
    }

    return { prompt: resolvedPrompt, outputSchema };
  }

  // Mode 3: Prompt file (legacy)
  if (promptFile) {
    const promptPath = path.resolve(basePath, promptFile);
    if (!fs.existsSync(promptPath)) {
      throw new Error(`Prompt file not found: ${promptFile}`);
    }

    let resolvedPrompt = fs.readFileSync(promptPath, "utf-8");
    if (promptVars) {
      resolvedPrompt = substituteVars(resolvedPrompt, promptVars);
    }
    return { prompt: resolvedPrompt };
  }

  throw new Error("Either prompt, promptFile, or promptDir must be provided");
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
