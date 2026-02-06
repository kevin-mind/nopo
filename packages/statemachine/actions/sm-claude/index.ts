/**
 * Claude Code - GitHub Action Entry Point
 *
 * This file is the entry point when running as a GitHub Action.
 * It gets inputs, executes Claude, and sets outputs.
 */

import * as core from "@actions/core";
import * as fs from "node:fs";
import { executeClaudeSDK, resolvePrompt } from "@more/statemachine";

/**
 * Fetch issue body and comments from GitHub API
 */
async function fetchIssueContent(
  token: string,
  issueNumber: string,
): Promise<{ body: string; comments: string }> {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) {
    throw new Error("GITHUB_REPOSITORY not set");
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  // Fetch issue
  const issueUrl = `https://api.github.com/repos/${repo}/issues/${issueNumber}`;
  const issueResp = await fetch(issueUrl, { headers });
  if (!issueResp.ok) {
    throw new Error(
      `Failed to fetch issue: ${issueResp.status} ${issueResp.statusText}`,
    );
  }
  const issue = (await issueResp.json()) as { body: string | null };
  const body = issue.body || "";

  // Fetch comments
  const commentsUrl = `https://api.github.com/repos/${repo}/issues/${issueNumber}/comments?per_page=100`;
  const commentsResp = await fetch(commentsUrl, { headers });
  if (!commentsResp.ok) {
    throw new Error(
      `Failed to fetch comments: ${commentsResp.status} ${commentsResp.statusText}`,
    );
  }
  const commentsData = (await commentsResp.json()) as Array<{
    user: { login: string } | null;
    body: string;
  }>;

  const comments =
    commentsData.length > 0
      ? commentsData
          .map((c) => `${c.user?.login || "unknown"}: ${c.body}`)
          .join("\n\n---\n\n")
      : "No comments yet.";

  return { body, comments };
}

async function run(): Promise<void> {
  try {
    // Get inputs
    const prompt = core.getInput("prompt");
    const promptDir = core.getInput("prompt_dir");
    const promptsBase = core.getInput("prompts_base") || ".github/prompts";
    const promptFile = core.getInput("prompt_file");
    const promptVarsJson = core.getInput("prompt_vars") || "{}";
    const workingDirectory =
      core.getInput("working_directory") || process.cwd();
    const allowedToolsStr = core.getInput("allowed_tools");
    const mockOutput = core.getInput("mock_output");
    const githubToken = core.getInput("github_token");
    const issueNumber = core.getInput("issue_number");
    const agentNotes = core.getInput("agent_notes");

    // Parse prompt vars
    let promptVars: Record<string, string> | undefined;
    try {
      promptVars = JSON.parse(promptVarsJson);
    } catch (e) {
      core.warning(`Failed to parse prompt_vars as JSON: ${e}`);
      promptVars = undefined;
    }

    // Inject agent notes if provided
    if (agentNotes && promptVars) {
      promptVars.AGENT_NOTES = agentNotes;
    }

    // Fetch issue content if issue_number and github_token are provided
    if (issueNumber && githubToken) {
      core.info(`Fetching issue #${issueNumber} content...`);
      try {
        const { body, comments } = await fetchIssueContent(
          githubToken,
          issueNumber,
        );
        if (!promptVars) {
          promptVars = {};
        }
        promptVars.ISSUE_BODY = body;
        promptVars.ISSUE_COMMENTS = comments;
        core.info(
          `Fetched issue body (${body.length} chars) and ${comments === "No comments yet." ? 0 : comments.split("---").length} comments`,
        );
      } catch (e) {
        core.warning(`Failed to fetch issue content: ${e}`);
      }
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
        fs.writeFileSync(
          "claude-structured-output.json",
          JSON.stringify(parsed, null, 2),
        );
        core.info("Mock output written to claude-structured-output.json");
        return;
      } catch (e) {
        core.setFailed(`Invalid mock_output JSON: ${e}`);
        return;
      }
    }

    // Resolve the prompt
    const basePath = process.cwd();

    let resolvedPrompt: string;
    let outputSchema: unknown;

    try {
      const resolved = resolvePrompt({
        prompt,
        promptDir,
        promptFile,
        promptVars,
        basePath,
        promptsDir: promptsBase,
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
      fs.writeFileSync(
        "claude-structured-output.json",
        JSON.stringify(result.structuredOutput, null, 2),
      );
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
