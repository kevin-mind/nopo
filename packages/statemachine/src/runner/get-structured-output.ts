/**
 * Get structured output from chain context or file
 *
 * For matrix job execution where actions run in separate jobs,
 * the structured output is passed through artifacts. This function
 * reads from the file if chain context doesn't have the output.
 */

import * as core from "@actions/core";
import * as fs from "fs";
import type { Action } from "../schemas/actions.js";
import type { ActionChainContext } from "./types.js";

export function getStructuredOutput(
  action: Action,
  chainCtx?: ActionChainContext,
): unknown | undefined {
  // First try chain context (same-job execution)
  if (chainCtx?.lastClaudeStructuredOutput) {
    core.info("Using structured output from chain context");
    return chainCtx.lastClaudeStructuredOutput;
  }

  // Check if action has a filePath for artifact-based execution
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- Action union may have filePath on some variants; casting to access it
  const actionWithFile = action as Action & { filePath?: string };
  if (actionWithFile.filePath) {
    core.info(
      `Checking for structured output file: ${actionWithFile.filePath}`,
    );
    core.info(`Current working directory: ${process.cwd()}`);

    // List files in current directory for debugging
    try {
      const files = fs.readdirSync(".");
      core.info(`Files in cwd: ${files.slice(0, 20).join(", ")}`);
    } catch (e) {
      core.warning(`Failed to list files: ${e}`);
    }

    if (fs.existsSync(actionWithFile.filePath)) {
      try {
        const content = fs.readFileSync(actionWithFile.filePath, "utf-8");
        const parsed = JSON.parse(content);
        core.info(
          `Loaded structured output from file: ${actionWithFile.filePath}`,
        );
        return parsed;
      } catch (e) {
        core.warning(
          `Failed to read structured output from ${actionWithFile.filePath}: ${e}`,
        );
      }
    } else {
      core.warning(`File not found: ${actionWithFile.filePath}`);
    }
  }

  return undefined;
}
