/**
 * Zod schemas for GitHub webhook payloads and gh CLI output.
 *
 * GitHub's @actions/github types payload as { [key: string]: any },
 * so every field access requires a type assertion. These schemas
 * parse the payload once at each handler entry point, giving us
 * typed access to all fields without inline assertions.
 */

import { z } from "zod";

// ============================================================================
// Shared field schemas
// ============================================================================

export const LabelSchema = z.object({ name: z.string() });

const UserSchema = z.object({
  login: z.string(),
  type: z.string().optional(),
});

export const UserLoginSchema = z.object({ login: z.string() });

// ============================================================================
// Issue event payload
// ============================================================================

export const IssuePayloadSchema = z.object({
  number: z.number(),
  title: z.string(),
  body: z.string().nullable().default(""),
  labels: z.array(LabelSchema),
  assignees: z.array(z.object({ login: z.string() })).optional(),
});

// ============================================================================
// Issue comment event payload
// ============================================================================

export const IssueCommentPayloadSchema = z.object({
  id: z.number(),
  node_id: z.string(),
  body: z.string(),
  user: UserSchema,
});

export const IssueForCommentPayloadSchema = z.object({
  number: z.number(),
  title: z.string(),
  body: z.string().nullable().default(""),
  labels: z.array(LabelSchema),
  pull_request: z.unknown().optional(),
});

// ============================================================================
// Pull request event payload
// ============================================================================

export const PullRequestPayloadSchema = z.object({
  number: z.number(),
  title: z.string(),
  draft: z.boolean(),
  head: z.object({ ref: z.string() }),
  body: z.string().nullable().default(""),
  labels: z.array(LabelSchema),
  author: z.object({ login: z.string() }).optional(),
  user: z.object({ login: z.string() }).optional(),
});

// ============================================================================
// Pull request review event payload
// ============================================================================

export const ReviewPayloadSchema = z.object({
  id: z.number(),
  state: z.string(),
  body: z.string().nullable().default(""),
  user: z.object({ login: z.string() }).optional(),
});

// ============================================================================
// Pull request review comment payload
// ============================================================================

export const ReviewCommentPayloadSchema = z.object({
  id: z.number(),
  body: z.string(),
  user: UserSchema,
});

export const PullRequestForReviewCommentPayloadSchema = z.object({
  number: z.number(),
  title: z.string(),
  head: z.object({ ref: z.string() }),
  labels: z.array(LabelSchema),
});

// ============================================================================
// Workflow run event payload
// ============================================================================

export const WorkflowRunPayloadSchema = z.object({
  conclusion: z.string().nullable(),
  head_branch: z.string(),
  head_sha: z.string(),
  id: z.number(),
});

// ============================================================================
// Merge group event payload
// ============================================================================

export const MergeGroupPayloadSchema = z.object({
  head_ref: z.string(),
  head_sha: z.string(),
});

// ============================================================================
// Discussion event payloads
// ============================================================================

export const DiscussionPayloadSchema = z.object({
  number: z.number(),
  title: z.string(),
  body: z.string().nullable().default(""),
});

export const DiscussionCommentPayloadSchema = z.object({
  id: z.number(),
  node_id: z.string(),
  body: z.string(),
  parent_id: z.number().nullable().optional(),
  user: z.object({ login: z.string() }),
});

// ============================================================================
// gh CLI output schemas
// ============================================================================

export const GhPrListOutputSchema = z.object({
  number: z.number(),
  isDraft: z.boolean(),
  author: z.object({ login: z.string() }),
  body: z.string().nullable().default(""),
  title: z.string(),
  labels: z.array(LabelSchema),
});

export const GhPrViewOutputSchema = z.object({
  headRefName: z.string(),
  reviewDecision: z.string().nullable().optional(),
  reviews: z
    .array(
      z.object({
        author: z.object({ login: z.string() }),
        state: z.string(),
        body: z.string().nullable().default(""),
      }),
    )
    .optional(),
  body: z.string().nullable().default(""),
  isDraft: z.boolean().optional(),
});

export const GhPrBranchBodyOutputSchema = z.object({
  headRefName: z.string(),
  body: z.string().nullable().default(""),
});
