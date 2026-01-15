import { expressions } from "@github-actions-workflow-ts/lib";
import { ExtendedStep } from "./enhanced-step";

/**
 * Options for the Claude Code Action step.
 */
export interface ClaudeActionOptions {
  /** The prompt to send to Claude */
  prompt: string;
  /** The Claude model to use */
  model?: "claude-opus-4-5-20251101" | "claude-sonnet-4-20250514";
  /** Maximum number of turns (API round-trips) */
  maxTurns?: number;
  /** Path to settings file */
  settings?: string;
  /** Whether to show full output */
  showFullOutput?: boolean;
  /** Trigger phrase for @-mentions (e.g., "@claude") */
  triggerPhrase?: string;
  /** Assignee that triggers action (e.g., "nopo-bot") */
  assigneeTrigger?: string;
  /** Optional step name */
  name?: string;
}

/**
 * Creates a Claude Code Action step.
 */
export const claudeActionStep = <const Id extends string>(
  id: Id,
  opts: ClaudeActionOptions
): ExtendedStep<Id> => {
  const args = [
    `--model ${opts.model ?? "claude-opus-4-5-20251101"}`,
    `--max-turns ${opts.maxTurns ?? 50}`,
  ].join(" ");

  return new ExtendedStep({
    ...(opts.name && { name: opts.name }),
    id,
    uses: "anthropics/claude-code-action@v1",
    with: {
      claude_code_oauth_token: expressions.secret("CLAUDE_CODE_OAUTH_TOKEN"),
      settings: opts.settings ?? ".claude/settings.json",
      prompt: opts.prompt,
      claude_args: args,
      ...(opts.showFullOutput && { show_full_output: "true" }),
      ...(opts.triggerPhrase && { trigger_phrase: opts.triggerPhrase }),
      ...(opts.assigneeTrigger && { assignee_trigger: opts.assigneeTrigger }),
    },
    env: {
      GITHUB_TOKEN: expressions.secret("GITHUB_TOKEN"),
    },
  });
};

/**
 * Common Claude action configurations.
 */
export const claudeActions = {
  /**
   * Triage action with default configuration.
   */
  triage: (prompt: string): ExtendedStep<"claude_triage"> =>
    claudeActionStep("claude_triage", {
      prompt,
      maxTurns: 50,
    }),

  /**
   * Implementation action with default configuration.
   */
  implement: (prompt: string): ExtendedStep<"claude_implement"> =>
    claudeActionStep("claude_implement", {
      prompt,
      maxTurns: 100,
    }),

  /**
   * Comment response action.
   */
  comment: (prompt: string): ExtendedStep<"claude_comment"> =>
    claudeActionStep("claude_comment", {
      prompt,
      triggerPhrase: "@claude",
      maxTurns: 50,
    }),

  /**
   * Code review action.
   */
  review: (prompt: string): ExtendedStep<"claude_review"> =>
    claudeActionStep("claude_review", {
      prompt,
      maxTurns: 30,
    }),

  /**
   * CI fix action.
   */
  ciFix: (prompt: string): ExtendedStep<"claude_ci_fix"> =>
    claudeActionStep("claude_ci_fix", {
      prompt,
      maxTurns: 50,
    }),

  /**
   * Discussion research action.
   */
  discussionResearch: (prompt: string): ExtendedStep<"claude_discussion"> =>
    claudeActionStep("claude_discussion", {
      prompt,
      maxTurns: 30,
    }),
};
