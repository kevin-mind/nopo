/**
 * Claude Code - GitHub Action Entry Point
 *
 * Pass a prompt (text) or prompt_file (path to .txt built from @more/prompts). Runs Claude.
 */

import * as core from "@actions/core";
import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import { executeClaudeSDK } from "@more/claude";

const outputSchemaSchema = z.record(z.string(), z.unknown()).optional();

function substituteVars(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_, name) => {
    const key = name.trim();
    return key in vars ? vars[key] : `{{${name}}}`;
  });
}

async function run(): Promise<void> {
  try {
    const promptInput = core.getInput("prompt");
    const promptFilePath = core.getInput("prompt_file");
    const promptVarsJson = core.getInput("prompt_vars") || "{}";

    let prompt: string;
    if (promptFilePath) {
      const cwd = core.getInput("working_directory") || process.cwd();
      const absPath = path.isAbsolute(promptFilePath)
        ? promptFilePath
        : path.resolve(cwd, promptFilePath);
      prompt = fs.readFileSync(absPath, "utf8");
      const vars: Record<string, string> = {};
      try {
        const parsed = JSON.parse(promptVarsJson);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          for (const [k, v] of Object.entries(parsed)) {
            vars[k] = String(v);
          }
        }
      } catch {
        // ignore invalid prompt_vars
      }
      if (Object.keys(vars).length > 0) {
        prompt = substituteVars(prompt, vars);
      }
    } else {
      prompt = promptInput;
    }
    if (!prompt?.trim()) {
      core.setFailed("Provide either 'prompt' or 'prompt_file'.");
      return;
    }

    const workingDirectory =
      core.getInput("working_directory") || process.cwd();
    const allowedToolsStr = core.getInput("allowed_tools");
    const allowedTools = allowedToolsStr
      ? allowedToolsStr.split(",").map((t) => t.trim())
      : undefined;

    let outputSchema: z.infer<typeof outputSchemaSchema>;
    const outputSchemaJson = core.getInput("output_schema");
    try {
      outputSchema = outputSchemaJson
        ? outputSchemaSchema.parse(JSON.parse(outputSchemaJson))
        : undefined;
    } catch {
      outputSchema = undefined;
    }

    core.info(`Running Claude (${prompt.length} chars)`);

    const result = await executeClaudeSDK({
      prompt,
      cwd: workingDirectory,
      allowedTools,
      outputSchema,
    });

    core.setOutput("success", result.success.toString());
    core.setOutput("output", result.output);

    if (result.structuredOutput) {
      core.setOutput(
        "structured_output",
        JSON.stringify(result.structuredOutput),
      );
      fs.writeFileSync(
        "claude-structured-output.json",
        JSON.stringify(result.structuredOutput, null, 2),
      );
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

run();
