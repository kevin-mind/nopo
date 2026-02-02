/**
 * Claude SDK Executor
 *
 * Core execution logic for running Claude Code via the Agent SDK.
 * Provides real-time streaming output for GitHub Actions logs.
 */

import * as core from "@actions/core";
import * as exec from "@actions/exec";
import {
  query,
  type Options,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { ClaudeExecutorOptions, ClaudeResult } from "./types.js";

/**
 * Extract text content from an SDK assistant message
 */
function extractTextFromMessage(msg: SDKMessage): string {
  if (msg.type !== "assistant") return "";
  return msg.message.content
    .filter(
      (block): block is { type: "text"; text: string } => block.type === "text",
    )
    .map((block) => block.text)
    .join("");
}

/**
 * Execute Claude Code SDK
 *
 * Runs Claude with the specified prompt and options, streaming output
 * in real-time to GitHub Actions logs.
 *
 * @param options - Execution options
 * @returns Result with output and optional structured data
 */
export async function executeClaudeSDK(
  options: ClaudeExecutorOptions,
): Promise<ClaudeResult> {
  const {
    prompt,
    cwd = process.cwd(),
    claudePath = process.env.CLAUDE_CODE_PATH ||
      `${process.env.HOME}/.local/bin/claude`,
    allowedTools,
    outputSchema,
    permissionMode = "acceptEdits",
  } = options;

  core.info(`Running Claude SDK`);
  core.info(`Working directory: ${cwd}`);
  core.info(`Claude Code path: ${claudePath}`);
  core.debug(`Prompt: ${prompt.slice(0, 200)}...`);

  // Build SDK options
  const sdkOptions: Options = {
    cwd,
    pathToClaudeCodeExecutable: claudePath,
    permissionMode,
    // Load CLAUDE.md and project settings
    settingSources: ["project"],
    // Use Claude Code's system prompt
    systemPrompt: { type: "preset", preset: "claude_code" },
  };

  // Add allowed tools if specified
  if (allowedTools && allowedTools.length > 0) {
    sdkOptions.allowedTools = allowedTools;
  }

  // Add structured output format if schema provided
  if (outputSchema) {
    sdkOptions.outputFormat = {
      type: "json_schema",
      schema: outputSchema,
    };
    core.info("Using structured output mode with JSON schema");
  }

  let output = "";
  let structuredOutput: unknown;
  let numTurns: number | undefined;
  let costUsd: number | undefined;

  try {
    const q = query({ prompt, options: sdkOptions });

    for await (const msg of q) {
      // System init - log session info
      if (msg.type === "system" && msg.subtype === "init") {
        core.info(`[SDK] Session: ${msg.session_id}`);
        core.info(`[SDK] Model: ${msg.model}`);
        core.info(`[SDK] Permission mode: ${msg.permissionMode}`);
      }

      // Assistant messages - stream to stdout for real-time logs
      if (msg.type === "assistant") {
        const text = extractTextFromMessage(msg);
        if (text) {
          process.stdout.write(text);
          output += text;
        }

        // Log tool uses
        for (const block of msg.message.content) {
          if (block.type === "tool_use") {
            core.info(`\n[Tool: ${block.name}]`);
          }
        }
      }

      // Final result
      if (msg.type === "result") {
        if (msg.subtype === "success") {
          structuredOutput = msg.structured_output;
          numTurns = msg.num_turns;
          costUsd = msg.total_cost_usd;

          if (structuredOutput) {
            core.startGroup("Structured Output");
            core.info(JSON.stringify(structuredOutput, null, 2));
            core.endGroup();
          }

          core.info(
            `\n[SDK] Completed successfully (${numTurns} turns, $${costUsd.toFixed(4)})`,
          );
        } else {
          // Handle various error subtypes
          const errorSubtype = msg.subtype;
          const errors =
            "errors" in msg
              ? (msg.errors as string[])?.join("\n")
              : errorSubtype;

          core.error(`[SDK] Failed: ${errors}`);

          return {
            success: false,
            exitCode: 1,
            output,
            error: errors,
          };
        }
      }
    }

    return {
      success: true,
      exitCode: 0,
      output,
      structuredOutput,
      numTurns,
      costUsd,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    core.error(`Failed to run Claude: ${errorMessage}`);
    return {
      success: false,
      exitCode: 1,
      output,
      error: errorMessage,
    };
  }
}

/**
 * Check if Claude CLI is available
 * Note: SDK requires Claude CLI to be installed
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
