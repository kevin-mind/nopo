import type { PromptResult } from "@more/prompt-factory";

/** Generic prompt function type for the registry */
type AnyPromptCallable = (inputs: Record<string, unknown>) => PromptResult;

// Issue prompts
import Iterate from "./prompts/iterate.js";
import Triage from "./prompts/triage.js";
import Review from "./prompts/review.js";
import ReviewResponse from "./prompts/review-response.js";
import Comment from "./prompts/comment.js";
import Pivot from "./prompts/pivot.js";
import HumanReviewResponse from "./prompts/human-review-response.js";
import TestAnalysis from "./prompts/test-analysis.js";

// Grooming prompts
import * as Grooming from "./prompts/grooming/index.js";

// Discussion prompts
import * as Discussion from "./prompts/discussion/index.js";

/**
 * Registry of all prompts by their identifier.
 *
 * Keys use the prompt directory path format:
 * - Issue prompts: "iterate", "triage", "review", etc.
 * - Grooming prompts: "grooming/engineer", "grooming/pm", etc.
 * - Discussion prompts: "discussion/research", "discussion/respond", etc.
 */
export const PROMPTS = {
  // Issue prompts
  iterate: Iterate,
  triage: Triage,
  review: Review,
  "review-response": ReviewResponse,
  comment: Comment,
  pivot: Pivot,
  "human-review-response": HumanReviewResponse,
  "test-analysis": TestAnalysis,

  // Grooming prompts
  "grooming/engineer": Grooming.Engineer,
  "grooming/pm": Grooming.PM,
  "grooming/qa": Grooming.QA,
  "grooming/research": Grooming.Research,
  "grooming/summary": Grooming.Summary,

  // Discussion prompts
  "discussion/research": Discussion.Research,
  "discussion/investigate": Discussion.Investigate,
  "discussion/respond": Discussion.Respond,
  "discussion/summarize": Discussion.Summarize,
  "discussion/plan": Discussion.Plan,
} as const;

export type PromptName = keyof typeof PROMPTS;

/**
 * Get a prompt by name.
 * @param name - The prompt identifier (e.g., "iterate", "grooming/engineer")
 * @returns The prompt callable or undefined if not found
 */
export function getPrompt(name: string): AnyPromptCallable | undefined {
  if (!hasPrompt(name)) return undefined;
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- dynamic dispatch requires type erasure; inputs are validated by Zod at runtime
  return PROMPTS[name] as unknown as AnyPromptCallable;
}

/**
 * Check if a prompt exists in the registry.
 * @param name - The prompt identifier to check
 */
export function hasPrompt(name: string): name is PromptName {
  return name in PROMPTS;
}

/**
 * Get all registered prompt names.
 */
export function getPromptNames(): PromptName[] {
  return Object.keys(PROMPTS).filter(
    (name): name is PromptName => name in PROMPTS,
  );
}
