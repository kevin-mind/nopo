// Issue prompts
export { default as Iterate } from "./prompts/iterate.js";
export { default as Triage } from "./prompts/triage.js";
export { default as Review } from "./prompts/review.js";
export { default as ReviewResponse } from "./prompts/review-response.js";
export { default as Comment } from "./prompts/comment.js";
export { default as Pivot } from "./prompts/pivot.js";
export { default as HumanReviewResponse } from "./prompts/human-review-response.js";
export { default as TestAnalysis } from "./prompts/test-analysis.js";
export { default as LiveIssueScout } from "./prompts/live-issue-scout.js";
export { default as Doctor } from "./prompts/doctor.js";

// Grooming prompts
export * as Grooming from "./prompts/grooming/index.js";

// Discussion prompts
export * as Discussion from "./prompts/discussion/index.js";

// Registry
export { PROMPTS, getPrompt, hasPrompt, getPromptNames } from "./registry.js";
export type { PromptName } from "./registry.js";
