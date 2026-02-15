/**
 * Shared utility functions used across machines.
 */

import type { IssueComment } from "./schemas/index.js";

/**
 * Format issue comments for inclusion in prompts
 */
export function formatCommentsForPrompt(comments: IssueComment[]): string {
  if (comments.length === 0) {
    return "No comments yet.";
  }
  return comments
    .map((c) => `### ${c.author} (${c.createdAt})\n${c.body}`)
    .join("\n\n---\n\n");
}
