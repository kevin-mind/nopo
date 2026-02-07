/**
 * Claude SDK Executor
 *
 * Core execution logic for running Claude Code via the Agent SDK.
 * Provides real-time streaming output for GitHub Actions logs.
 */

import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as fs from "fs";
import {
  query,
  type Options,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { ClaudeExecutorOptions, ClaudeResult } from "./types.js";

// ANSI color codes for GitHub Actions logs
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",

  // Text colors
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",

  // Bright colors
  brightRed: "\x1b[91m",
  brightGreen: "\x1b[92m",
  brightYellow: "\x1b[93m",
  brightBlue: "\x1b[94m",
  brightMagenta: "\x1b[95m",
  brightCyan: "\x1b[96m",

  // Background colors
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
  bgBlue: "\x1b[44m",
};

/**
 * Format a tool input for logging
 */
function formatToolInput(
  toolName: string,
  input: Record<string, unknown>,
): string {
  const lines: string[] = [];

  switch (toolName) {
    case "Bash":
      if (input.command) {
        lines.push(`${colors.dim}Command:${colors.reset} ${input.command}`);
      }
      if (input.description) {
        lines.push(
          `${colors.dim}Description:${colors.reset} ${input.description}`,
        );
      }
      break;

    case "Read":
      if (input.file_path) {
        lines.push(`${colors.dim}File:${colors.reset} ${input.file_path}`);
      }
      if (input.offset || input.limit) {
        lines.push(
          `${colors.dim}Range:${colors.reset} offset=${input.offset || 0}, limit=${input.limit || "all"}`,
        );
      }
      break;

    case "Edit":
      if (input.file_path) {
        lines.push(`${colors.dim}File:${colors.reset} ${input.file_path}`);
      }
      if (input.old_string) {
        const preview = String(input.old_string).slice(0, 100);
        lines.push(
          `${colors.dim}Replacing:${colors.reset} ${preview}${String(input.old_string).length > 100 ? "..." : ""}`,
        );
      }
      break;

    case "Write":
      if (input.file_path) {
        lines.push(`${colors.dim}File:${colors.reset} ${input.file_path}`);
      }
      if (input.content) {
        const preview = String(input.content).slice(0, 100);
        lines.push(
          `${colors.dim}Content:${colors.reset} ${preview}${String(input.content).length > 100 ? "..." : ""}`,
        );
      }
      break;

    case "Glob":
      if (input.pattern) {
        lines.push(`${colors.dim}Pattern:${colors.reset} ${input.pattern}`);
      }
      if (input.path) {
        lines.push(`${colors.dim}Path:${colors.reset} ${input.path}`);
      }
      break;

    case "Grep":
      if (input.pattern) {
        lines.push(`${colors.dim}Pattern:${colors.reset} ${input.pattern}`);
      }
      if (input.path) {
        lines.push(`${colors.dim}Path:${colors.reset} ${input.path}`);
      }
      break;

    case "Task":
      if (input.description) {
        lines.push(
          `${colors.dim}Description:${colors.reset} ${input.description}`,
        );
      }
      if (input.subagent_type) {
        lines.push(
          `${colors.dim}Subagent:${colors.reset} ${input.subagent_type}`,
        );
      }
      if (input.prompt) {
        const preview = String(input.prompt).slice(0, 200);
        lines.push(
          `${colors.dim}Prompt:${colors.reset} ${preview}${String(input.prompt).length > 200 ? "..." : ""}`,
        );
      }
      break;

    default:
      // For unknown tools, show all input keys
      for (const [key, value] of Object.entries(input)) {
        const strValue = typeof value === "string" ? value : JSON.stringify(value);
        const preview = strValue.slice(0, 100);
        lines.push(
          `${colors.dim}${key}:${colors.reset} ${preview}${strValue.length > 100 ? "..." : ""}`,
        );
      }
  }

  return lines.join("\n    ");
}

/**
 * Extract text content from an SDK assistant message
 */
function extractTextFromMessage(msg: SDKMessage): string {
  if (msg.type !== "assistant") return "";
  return (msg.message.content as Array<{ type: string; text?: string }>)
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

  // Verify Claude Code binary exists before calling SDK
  if (!fs.existsSync(claudePath)) {
    const errorMsg =
      `Claude Code not found at ${claudePath}. ` +
      `Ensure Claude Code is installed (curl -fsSL https://claude.ai/install.sh | bash) ` +
      `or set CLAUDE_CODE_PATH environment variable.`;
    core.error(errorMsg);
    return {
      success: false,
      exitCode: 1,
      output: "",
      error: errorMsg,
    };
  }

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
      schema: outputSchema as Record<string, unknown>,
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
        core.info(
          `${colors.cyan}${colors.bold}[SDK Init]${colors.reset} Session: ${msg.session_id}`,
        );
        core.info(
          `${colors.cyan}[SDK]${colors.reset} Model: ${colors.bold}${msg.model}${colors.reset}`,
        );
        core.info(
          `${colors.cyan}[SDK]${colors.reset} Permission mode: ${msg.permissionMode}`,
        );
        if (msg.tools && msg.tools.length > 0) {
          core.info(
            `${colors.cyan}[SDK]${colors.reset} Tools: ${msg.tools.join(", ")}`,
          );
        }
      }

      // Subagent notifications
      if (msg.type === "system" && msg.subtype === "task_notification") {
        const statusColor =
          msg.status === "completed"
            ? colors.green
            : msg.status === "failed"
              ? colors.red
              : colors.yellow;
        core.info(
          `\n${colors.magenta}${colors.bold}[Subagent ${msg.task_id}]${colors.reset} ${statusColor}${msg.status}${colors.reset}`,
        );
        if (msg.summary) {
          core.info(`${colors.dim}Summary:${colors.reset} ${msg.summary}`);
        }
      }

      // Tool progress - shows elapsed time for long-running tools
      if (msg.type === "tool_progress") {
        core.info(
          `${colors.dim}[${msg.tool_name}] Running... ${msg.elapsed_time_seconds.toFixed(1)}s${colors.reset}`,
        );
      }

      // Tool use summary
      if (msg.type === "tool_use_summary") {
        core.info(`${colors.dim}[Tool Summary] ${msg.summary}${colors.reset}`);
      }

      // Hook messages
      if (msg.type === "system" && msg.subtype === "hook_started") {
        core.info(
          `${colors.blue}[Hook]${colors.reset} ${msg.hook_event}: ${msg.hook_name}`,
        );
      }
      if (msg.type === "system" && msg.subtype === "hook_response") {
        const outcomeColor =
          msg.outcome === "success"
            ? colors.green
            : msg.outcome === "error"
              ? colors.red
              : colors.yellow;
        core.info(
          `${colors.blue}[Hook]${colors.reset} ${msg.hook_name}: ${outcomeColor}${msg.outcome}${colors.reset}`,
        );
        if (msg.output) {
          core.info(`${colors.dim}${msg.output}${colors.reset}`);
        }
        if (msg.stderr) {
          core.warning(`${colors.yellow}${msg.stderr}${colors.reset}`);
        }
      }

      // Assistant messages - stream to stdout for real-time logs
      if (msg.type === "assistant") {
        const text = extractTextFromMessage(msg);
        if (text) {
          process.stdout.write(text);
          output += text;
        }

        // Log tool uses with detailed input
        for (const block of msg.message.content) {
          if (block.type === "tool_use") {
            const toolBlock = block as {
              type: "tool_use";
              name: string;
              id: string;
              input: Record<string, unknown>;
            };
            const toolColor =
              toolBlock.name === "Bash"
                ? colors.brightYellow
                : toolBlock.name === "Task"
                  ? colors.brightMagenta
                  : toolBlock.name === "Read" ||
                      toolBlock.name === "Glob" ||
                      toolBlock.name === "Grep"
                    ? colors.brightCyan
                    : toolBlock.name === "Edit" || toolBlock.name === "Write"
                      ? colors.brightGreen
                      : colors.white;

            core.info(
              `\n${toolColor}${colors.bold}[Tool: ${toolBlock.name}]${colors.reset}`,
            );

            // Log tool input details
            if (toolBlock.input && Object.keys(toolBlock.input).length > 0) {
              const formatted = formatToolInput(toolBlock.name, toolBlock.input);
              if (formatted) {
                core.info(`    ${formatted}`);
              }
            }
          }
        }
      }

      // User messages (tool results)
      if (msg.type === "user" && msg.tool_use_result !== undefined) {
        const result = msg.tool_use_result;
        if (typeof result === "object" && result !== null) {
          const resultObj = result as Record<string, unknown>;
          // Check for error in result
          if (resultObj.error || resultObj.is_error) {
            const errorMsg = resultObj.error || resultObj.message || "Unknown error";
            core.error(
              `${colors.red}${colors.bold}[Tool Error]${colors.reset} ${errorMsg}`,
            );
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
            `\n${colors.green}${colors.bold}[SDK]${colors.reset} Completed successfully (${numTurns} turns, $${costUsd.toFixed(4)})`,
          );
        } else {
          // Handle various error subtypes
          const errorSubtype = msg.subtype;
          const errors =
            "errors" in msg
              ? (msg.errors as string[])?.join("\n")
              : errorSubtype;

          core.error(
            `${colors.red}${colors.bold}[SDK Failed]${colors.reset} ${errors}`,
          );

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
