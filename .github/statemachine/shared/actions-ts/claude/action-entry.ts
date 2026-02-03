/**
 * Claude Code - GitHub Action Entry Point
 *
 * This file is the entry point when running as a GitHub Action.
 * It gets inputs, executes Claude, and sets outputs.
 */

import * as core from "@actions/core";
import * as fs from "node:fs";
import { executeClaudeSDK, resolvePrompt } from "./index.js";

async function run(): Promise<void> {
  try {
    // Get inputs
    const prompt = core.getInput("prompt");
    const promptDir = core.getInput("prompt_dir");
    const promptFile = core.getInput("prompt_file");
    const promptVarsJson = core.getInput("prompt_vars") || "{}";
    const workingDirectory = core.getInput("working_directory") || process.cwd();
    const allowedToolsStr = core.getInput("allowed_tools");
    const mockOutput = core.getInput("mock_output");

    // Parse prompt vars
    let promptVars: Record<string, string> | undefined;
    try {
      promptVars = JSON.parse(promptVarsJson);
    } catch (e) {
      core.warning(`Failed to parse prompt_vars as JSON: ${e}`);
      promptVars = undefined;
    }

    // Handle mock mode for testing
    if (mockOutput) {
      core.info("Mock mode enabled - returning mock output");
      try {
        const parsed = JSON.parse(mockOutput);
        core.setOutput("success", "true");
        core.setOutput("output", JSON.stringify(parsed));
        core.setOutput("structured_output", JSON.stringify(parsed));

        // Write structured output file if schema expects it
        fs.writeFileSync("claude-structured-output.json", JSON.stringify(parsed, null, 2));
        core.info("Mock output written to claude-structured-output.json");
        return;
      } catch (e) {
        core.setFailed(`Invalid mock_output JSON: ${e}`);
        return;
      }
    }

    // Resolve the prompt
    const basePath = process.cwd();
    const promptsDir = ".github/statemachine/issue/prompts";

    let resolvedPrompt: string;
    let outputSchema: unknown;

    try {
      const resolved = resolvePrompt({
        prompt,
        promptDir,
        promptFile,
        promptVars,
        basePath,
        promptsDir,
      });
      resolvedPrompt = resolved.prompt;
      outputSchema = resolved.outputSchema;
    } catch (e) {
      core.setFailed(`Failed to resolve prompt: ${e}`);
      return;
    }

    core.info(`Resolved prompt (${resolvedPrompt.length} chars)`);
    core.debug(`Prompt: ${resolvedPrompt.slice(0, 500)}...`);

    // Parse allowed tools
    const allowedTools = allowedToolsStr
      ? allowedToolsStr.split(",").map((t) => t.trim())
      : undefined;

    // Execute Claude
    const result = await executeClaudeSDK({
      prompt: resolvedPrompt,
      cwd: workingDirectory,
      allowedTools,
      outputSchema,
    });

    // Set outputs
    core.setOutput("success", result.success.toString());
    core.setOutput("output", result.output);

    if (result.structuredOutput) {
      const structuredJson = JSON.stringify(result.structuredOutput);
      core.setOutput("structured_output", structuredJson);

      // Write structured output to file for artifact upload
      fs.writeFileSync("claude-structured-output.json", JSON.stringify(result.structuredOutput, null, 2));
      core.info("Structured output written to claude-structured-output.json");
    }

    if (result.numTurns !== undefined) {
      core.setOutput("num_turns", result.numTurns.toString());
    }
    if (result.costUsd !== undefined) {
      core.setOutput("cost_usd", result.costUsd.toString());
    }

    if (result.error) {
      core.setOutput("error", result.error);
      core.setFailed(result.error);
    } else if (!result.success) {
      core.setFailed("Claude execution failed");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.setOutput("success", "false");
    core.setOutput("error", message);
    core.setFailed(message);
  }
}

// Run the action
run();
