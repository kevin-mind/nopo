import { Step } from "@github-actions-workflow-ts/lib";

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
  /** Optional step ID */
  id?: string;
  /** Optional step name */
  name?: string;
}

/**
 * Creates a Claude Code Action step.
 */
export const claudeActionStep = (opts: ClaudeActionOptions): Step => {
  const args = [
    `--model ${opts.model ?? "claude-opus-4-5-20251101"}`,
    `--max-turns ${opts.maxTurns ?? 50}`,
  ].join(" ");

  return new Step({
    ...(opts.name && { name: opts.name }),
    ...(opts.id && { id: opts.id }),
    uses: "anthropics/claude-code-action@v1",
    with: {
      claude_code_oauth_token: "${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}",
      settings: opts.settings ?? ".claude/settings.json",
      prompt: opts.prompt,
      claude_args: args,
      ...(opts.showFullOutput && { show_full_output: "true" }),
      ...(opts.triggerPhrase && { trigger_phrase: opts.triggerPhrase }),
      ...(opts.assigneeTrigger && { assignee_trigger: opts.assigneeTrigger }),
    },
    env: {
      GITHUB_TOKEN: "${{ secrets.GITHUB_TOKEN }}",
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
  triage: (prompt: string): Step =>
    claudeActionStep({
      id: "claude_triage",
      prompt,
      maxTurns: 50,
    }),

  /**
   * Implementation action with default configuration.
   */
  implement: (prompt: string): Step =>
    claudeActionStep({
      id: "claude_implement",
      prompt,
      maxTurns: 100,
    }),

  /**
   * Comment response action.
   */
  comment: (prompt: string): Step =>
    claudeActionStep({
      id: "claude_comment",
      prompt,
      triggerPhrase: "@claude",
      maxTurns: 50,
    }),

  /**
   * Code review action.
   */
  review: (prompt: string): Step =>
    claudeActionStep({
      id: "claude_review",
      prompt,
      maxTurns: 30,
    }),

  /**
   * CI fix action.
   */
  ciFix: (prompt: string): Step =>
    claudeActionStep({
      id: "claude_ci_fix",
      prompt,
      maxTurns: 50,
    }),

  /**
   * Discussion research action.
   */
  discussionResearch: (prompt: string): Step =>
    claudeActionStep({
      id: "claude_discussion",
      prompt,
      maxTurns: 30,
    }),
};
