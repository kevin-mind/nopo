/**
 * Discussion Actions
 *
 * Actions for GitHub Discussion operations, research threads,
 * and applying Claude's structured output from discussion workflows.
 */

import { z } from "zod";
import * as core from "@actions/core";
import * as fs from "node:fs";
import {
  GET_DISCUSSION_ID_QUERY,
  GET_REPO_ID_QUERY,
  GET_LABEL_IDS_QUERY,
  ADD_DISCUSSION_COMMENT_MUTATION,
  ADD_DISCUSSION_REPLY_MUTATION,
  UPDATE_DISCUSSION_MUTATION,
  ADD_REACTION_MUTATION,
  CREATE_ISSUE_MUTATION,
  ADD_LABELS_MUTATION,
} from "@more/issue-state";
import {
  ResearchOutputSchema,
  RespondOutputSchema,
  SummarizeOutputSchema,
  PlanOutputSchema,
  parseOutput,
  type ResearchOutput,
  type RespondOutput,
  type SummarizeOutput,
  type PlanOutput,
} from "../../runner/helpers/output-schemas.js";
import type { RunnerContext } from "../../runner/types.js";
import {
  mkSchema,
  defAction,
  ArtifactSchema,
  ResearchThreadSchema,
  getStructuredOutput,
} from "./_shared.js";

// ============================================================================
// Types
// ============================================================================

interface AddCommentResponse {
  addDiscussionComment?: {
    comment?: {
      id?: string;
      body?: string;
    };
  };
}

interface UpdateDiscussionResponse {
  updateDiscussion?: {
    discussion?: {
      id?: string;
      body?: string;
    };
  };
}

interface AddReactionResponse {
  addReaction?: {
    reaction?: {
      id?: string;
      content?: string;
    };
  };
}

interface DiscussionIdResponse {
  repository?: {
    discussion?: {
      id?: string;
    };
  };
}

interface RepoIdResponse {
  repository?: {
    id?: string;
  };
}

interface CreateIssueResponse {
  createIssue?: {
    issue?: {
      id?: string;
      number?: number;
    };
  };
}

interface LabelsResponse {
  repository?: {
    labels?: {
      nodes?: Array<{
        id?: string;
        name?: string;
      }>;
    };
  };
}

// ============================================================================
// Internal Executor Functions
// ============================================================================

async function executeAddDiscussionComment(
  action: { discussionNodeId: string; replyToNodeId?: string; body: string },
  ctx: RunnerContext,
): Promise<{ commentId: string }> {
  let response: AddCommentResponse;

  if (action.replyToNodeId) {
    response = await ctx.octokit.graphql<AddCommentResponse>(
      ADD_DISCUSSION_REPLY_MUTATION,
      {
        discussionId: action.discussionNodeId,
        replyToId: action.replyToNodeId,
        body: action.body,
      },
    );
  } else {
    response = await ctx.octokit.graphql<AddCommentResponse>(
      ADD_DISCUSSION_COMMENT_MUTATION,
      {
        discussionId: action.discussionNodeId,
        body: action.body,
      },
    );
  }

  const commentId = response.addDiscussionComment?.comment?.id;
  if (!commentId) {
    throw new Error("Failed to add discussion comment");
  }

  core.info(
    `Added ${action.replyToNodeId ? "reply" : "comment"} to discussion`,
  );
  return { commentId };
}

async function executeCreateIssuesFromDiscussion(
  action: {
    discussionNumber: number;
    issues: Array<{ title: string; body: string; labels: string[] }>;
  },
  ctx: RunnerContext,
): Promise<{ issueNumbers: number[] }> {
  const repoResponse = await ctx.octokit.graphql<RepoIdResponse>(
    GET_REPO_ID_QUERY,
    { owner: ctx.owner, repo: ctx.repo },
  );

  const repoId = repoResponse.repository?.id;
  if (!repoId) {
    throw new Error("Repository not found");
  }

  const discussionResponse = await ctx.octokit.graphql<DiscussionIdResponse>(
    GET_DISCUSSION_ID_QUERY,
    { owner: ctx.owner, repo: ctx.repo, number: action.discussionNumber },
  );

  const discussionId = discussionResponse.repository?.discussion?.id;

  const labelsResponse = await ctx.octokit.graphql<LabelsResponse>(
    GET_LABEL_IDS_QUERY,
    { owner: ctx.owner, repo: ctx.repo },
  );

  const labelMap = new Map<string, string>();
  for (const label of labelsResponse.repository?.labels?.nodes || []) {
    if (label.id && label.name) {
      labelMap.set(label.name.toLowerCase(), label.id);
    }
  }

  const issueNumbers: number[] = [];

  for (const issueDef of action.issues) {
    const bodyWithRef = discussionId
      ? `${issueDef.body}\n\n---\n*Created from discussion #${action.discussionNumber}*`
      : issueDef.body;

    const createResponse = await ctx.octokit.graphql<CreateIssueResponse>(
      CREATE_ISSUE_MUTATION,
      { repositoryId: repoId, title: issueDef.title, body: bodyWithRef },
    );

    const issueId = createResponse.createIssue?.issue?.id;
    const issueNumber = createResponse.createIssue?.issue?.number;

    if (!issueId || !issueNumber) {
      throw new Error(`Failed to create issue: ${issueDef.title}`);
    }

    if (issueDef.labels.length > 0) {
      const labelIds = issueDef.labels
        .map((name) => labelMap.get(name.toLowerCase()))
        .filter((id): id is string => id !== undefined);

      if (labelIds.length > 0) {
        await ctx.octokit.graphql(ADD_LABELS_MUTATION, {
          labelableId: issueId,
          labelIds,
        });
      }
    }

    issueNumbers.push(issueNumber);
    core.info(`Created issue #${issueNumber}: ${issueDef.title}`);
  }

  return { issueNumbers };
}

// ============================================================================
// Discussion Actions
// ============================================================================

export const discussionActions = {
  /** Add a comment to a GitHub Discussion */
  addDiscussionComment: defAction(
    mkSchema("addDiscussionComment", {
      discussionNodeId: z.string().min(1),
      replyToNodeId: z.string().optional(),
      body: z.string().min(1),
    }),
    {
      execute: async (action, ctx) => {
        return executeAddDiscussionComment(action, ctx);
      },
    },
  ),

  /** Update the body of a GitHub Discussion */
  updateDiscussionBody: defAction(
    mkSchema("updateDiscussionBody", {
      discussionNodeId: z.string().min(1),
      newBody: z.string().min(1),
    }),
    {
      execute: async (action, ctx) => {
        const response = await ctx.octokit.graphql<UpdateDiscussionResponse>(
          UPDATE_DISCUSSION_MUTATION,
          {
            discussionId: action.discussionNodeId,
            body: action.newBody,
          },
        );

        if (!response.updateDiscussion?.discussion?.id) {
          throw new Error("Failed to update discussion body");
        }

        core.info("Updated discussion body");
        return { updated: true };
      },
    },
  ),

  /** Add a reaction to a discussion or comment */
  addDiscussionReaction: defAction(
    mkSchema("addDiscussionReaction", {
      subjectId: z.string().min(1),
      content: z.enum([
        "THUMBS_UP",
        "THUMBS_DOWN",
        "LAUGH",
        "HOORAY",
        "CONFUSED",
        "HEART",
        "ROCKET",
        "EYES",
      ]),
    }),
    {
      execute: async (action, ctx) => {
        const response = await ctx.octokit.graphql<AddReactionResponse>(
          ADD_REACTION_MUTATION,
          {
            subjectId: action.subjectId,
            content: action.content,
          },
        );

        const reactionId = response.addReaction?.reaction?.id;
        if (!reactionId) {
          throw new Error("Failed to add reaction");
        }

        core.info(`Added ${action.content} reaction`);
        return { reactionId };
      },
    },
  ),

  /** Create issues from a discussion (for /plan command) */
  createIssuesFromDiscussion: defAction(
    mkSchema("createIssuesFromDiscussion", {
      discussionNumber: z.number().int().positive(),
      issues: z.array(
        z.object({
          title: z.string().min(1),
          body: z.string(),
          labels: z.array(z.string()).default([]),
        }),
      ),
    }),
    {
      execute: async (action, ctx) => {
        return executeCreateIssuesFromDiscussion(action, ctx);
      },
    },
  ),

  // --------------------------------------------------------------------------
  // Discussion Apply Actions
  // --------------------------------------------------------------------------

  /** Apply discussion research output from Claude's structured output */
  applyDiscussionResearchOutput: defAction(
    mkSchema("applyDiscussionResearchOutput", {
      discussionNumber: z.number().int().positive(),
      discussionNodeId: z.string().min(1),
      promptVars: z.record(z.string()).optional(),
      filePath: z.string().optional(),
      consumesArtifact: ArtifactSchema.optional(),
    }),
    {
      execute: async (
        action,
        ctx,
        chainCtx,
      ): Promise<{ applied: boolean; threadCount: number }> => {
        let output: ResearchOutput;
        const structuredOutput = getStructuredOutput(action, chainCtx);

        if (structuredOutput) {
          output = parseOutput(
            ResearchOutputSchema,
            structuredOutput,
            "research",
          );
          core.info("Using structured output from in-process chain");
        } else if (action.filePath && fs.existsSync(action.filePath)) {
          const content = fs.readFileSync(action.filePath, "utf-8");
          output = parseOutput(
            ResearchOutputSchema,
            JSON.parse(content),
            "research file",
          );
          core.info(`Research output from file: ${action.filePath}`);
        } else {
          throw new Error("No structured output provided and file not found");
        }

        if (ctx.dryRun) {
          core.info(
            `[DRY RUN] Would create ${output.research_threads.length} research threads`,
          );
          return { applied: true, threadCount: output.research_threads.length };
        }

        for (const thread of output.research_threads) {
          const body = `## 🔍 ${thread.title}\n\n**Question:** ${thread.question}\n\n**Areas to investigate:**\n${thread.investigation_areas.map((a: string) => `- ${a}`).join("\n")}`;

          await executeAddDiscussionComment(
            {
              discussionNodeId: action.discussionNodeId,
              body,
            },
            ctx,
          );
        }

        if (output.updated_description) {
          await ctx.octokit.graphql<UpdateDiscussionResponse>(
            UPDATE_DISCUSSION_MUTATION,
            {
              discussionId: action.discussionNodeId,
              body: output.updated_description,
            },
          );
        }

        core.info(
          `Created ${output.research_threads.length} research threads for discussion #${action.discussionNumber}`,
        );
        return { applied: true, threadCount: output.research_threads.length };
      },
    },
  ),

  /** Apply discussion respond output from Claude's structured output */
  applyDiscussionRespondOutput: defAction(
    mkSchema("applyDiscussionRespondOutput", {
      discussionNumber: z.number().int().positive(),
      discussionNodeId: z.string().min(1),
      replyToNodeId: z.string().optional(),
      filePath: z.string().optional(),
      consumesArtifact: ArtifactSchema.optional(),
    }),
    {
      execute: async (
        action,
        ctx,
        chainCtx,
      ): Promise<{ applied: boolean; shouldContinue: boolean }> => {
        let output: RespondOutput;
        const structuredOutput = getStructuredOutput(action, chainCtx);

        if (structuredOutput) {
          output = parseOutput(
            RespondOutputSchema,
            structuredOutput,
            "respond",
          );
          core.info("Using structured output from in-process chain");
        } else if (action.filePath && fs.existsSync(action.filePath)) {
          const content = fs.readFileSync(action.filePath, "utf-8");
          output = parseOutput(
            RespondOutputSchema,
            JSON.parse(content),
            "respond file",
          );
          core.info(`Respond output from file: ${action.filePath}`);
        } else {
          throw new Error("No structured output provided and file not found");
        }

        if (ctx.dryRun) {
          core.info(`[DRY RUN] Would post response to discussion`);
          return { applied: true, shouldContinue: output.should_continue };
        }

        await executeAddDiscussionComment(
          {
            discussionNodeId: action.discussionNodeId,
            body: output.response,
            replyToNodeId: action.replyToNodeId,
          },
          ctx,
        );

        core.info(`Posted response to discussion #${action.discussionNumber}`);
        return { applied: true, shouldContinue: output.should_continue };
      },
    },
  ),

  /** Apply discussion summarize output from Claude's structured output */
  applyDiscussionSummarizeOutput: defAction(
    mkSchema("applyDiscussionSummarizeOutput", {
      discussionNumber: z.number().int().positive(),
      discussionNodeId: z.string().min(1),
      filePath: z.string().optional(),
      consumesArtifact: ArtifactSchema.optional(),
    }),
    {
      execute: async (action, ctx, chainCtx): Promise<{ applied: boolean }> => {
        let output: SummarizeOutput;
        const structuredOutput = getStructuredOutput(action, chainCtx);

        if (structuredOutput) {
          output = parseOutput(
            SummarizeOutputSchema,
            structuredOutput,
            "summarize",
          );
          core.info("Using structured output from in-process chain");
        } else if (action.filePath && fs.existsSync(action.filePath)) {
          const content = fs.readFileSync(action.filePath, "utf-8");
          output = parseOutput(
            SummarizeOutputSchema,
            JSON.parse(content),
            "summarize file",
          );
          core.info(`Summarize output from file: ${action.filePath}`);
        } else {
          throw new Error("No structured output provided and file not found");
        }

        if (ctx.dryRun) {
          core.info(`[DRY RUN] Would update discussion body with summary`);
          return { applied: true };
        }

        await ctx.octokit.graphql<UpdateDiscussionResponse>(
          UPDATE_DISCUSSION_MUTATION,
          {
            discussionId: action.discussionNodeId,
            body: output.summary,
          },
        );

        core.info(
          `Updated discussion #${action.discussionNumber} with summary`,
        );
        return { applied: true };
      },
    },
  ),

  /** Apply discussion plan output from Claude's structured output */
  applyDiscussionPlanOutput: defAction(
    mkSchema("applyDiscussionPlanOutput", {
      discussionNumber: z.number().int().positive(),
      discussionNodeId: z.string().min(1),
      filePath: z.string().optional(),
      consumesArtifact: ArtifactSchema.optional(),
    }),
    {
      execute: async (
        action,
        ctx,
        chainCtx,
      ): Promise<{ applied: boolean; issueNumbers: number[] }> => {
        let output: PlanOutput;
        const structuredOutput = getStructuredOutput(action, chainCtx);

        if (structuredOutput) {
          output = parseOutput(PlanOutputSchema, structuredOutput, "plan");
          core.info("Using structured output from in-process chain");
        } else if (action.filePath && fs.existsSync(action.filePath)) {
          const content = fs.readFileSync(action.filePath, "utf-8");
          output = parseOutput(
            PlanOutputSchema,
            JSON.parse(content),
            "plan file",
          );
          core.info(`Plan output from file: ${action.filePath}`);
        } else {
          throw new Error("No structured output provided and file not found");
        }

        if (ctx.dryRun) {
          core.info(
            `[DRY RUN] Would create ${output.issues.length} issues from plan`,
          );
          return { applied: true, issueNumbers: [] };
        }

        const result = await executeCreateIssuesFromDiscussion(
          {
            discussionNumber: action.discussionNumber,
            issues: output.issues,
          },
          ctx,
        );

        await executeAddDiscussionComment(
          {
            discussionNodeId: action.discussionNodeId,
            body: output.summary_comment,
          },
          ctx,
        );

        core.info(
          `Created ${result.issueNumbers.length} issues from discussion #${action.discussionNumber}`,
        );
        return { applied: true, issueNumbers: result.issueNumbers };
      },
    },
  ),

  /** Investigate research threads in parallel */
  investigateResearchThreads: defAction(
    mkSchema("investigateResearchThreads", {
      discussionNumber: z.number().int().positive(),
      discussionNodeId: z.string().min(1),
      promptVars: z.record(z.string()).optional(),
      threads: z.array(ResearchThreadSchema),
    }),
    {
      execute: async (action, ctx): Promise<{ investigated: number }> => {
        core.info(
          `Investigating ${action.threads.length} research threads for discussion #${action.discussionNumber}`,
        );

        if (ctx.dryRun) {
          core.info(
            `[DRY RUN] Would investigate ${action.threads.length} research threads`,
          );
          return { investigated: action.threads.length };
        }

        let investigated = 0;

        for (const thread of action.threads) {
          try {
            const responseBody = `## Investigation: ${thread.title}

**Question:** ${thread.question}

*Investigation in progress...*`;

            await executeAddDiscussionComment(
              {
                discussionNodeId: action.discussionNodeId,
                body: responseBody,
                replyToNodeId: thread.commentNodeId,
              },
              ctx,
            );

            investigated++;
            core.info(`Investigated thread: ${thread.title}`);
          } catch (error) {
            core.warning(
              `Failed to investigate thread "${thread.title}": ${error}`,
            );
          }
        }

        return { investigated };
      },
    },
  ),

  /** Update discussion body with current state summary */
  updateDiscussionSummary: defAction(
    mkSchema("updateDiscussionSummary", {
      discussionNumber: z.number().int().positive(),
      discussionNodeId: z.string().min(1),
      promptVars: z.record(z.string()).optional(),
    }),
    {
      execute: async (action, ctx): Promise<{ updated: boolean }> => {
        core.info(
          `Updating summary for discussion #${action.discussionNumber}`,
        );

        if (ctx.dryRun) {
          core.info(`[DRY RUN] Would update discussion summary`);
          return { updated: true };
        }

        core.info(
          `Discussion summary update for #${action.discussionNumber} (implementation pending)`,
        );
        return { updated: true };
      },
    },
  ),
};
