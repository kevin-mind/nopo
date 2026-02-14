/**
 * Apply Actions
 *
 * Actions that apply Claude's structured output to issues/PRs.
 * Includes triage, iterate, review, PR response, pivot, and agent notes.
 */

import { z } from "zod";
import * as core from "@actions/core";
import * as fs from "node:fs";
import type { Root, RootContent } from "mdast";
import {
  GET_PROJECT_FIELDS_QUERY,
  UPDATE_PROJECT_FIELD_MUTATION,
  parseIssue,
  createComment,
  parseMarkdown,
  serializeMarkdown,
  addSubIssueToParent,
} from "@more/issue-state";
import {
  TriageOutputSchema,
  LegacyTriageOutputSchema,
  IterateOutputSchema,
  ReviewOutputSchema,
  PRResponseOutputSchema,
  PivotOutputSchema,
  parseOutput,
  type TriageOutput,
  type LegacyTriageOutput,
  type TriageClassification,
  type IterateOutput,
  type ReviewOutput,
  type PRResponseOutput,
  type PivotOutput,
} from "../../runner/helpers/output-schemas.js";
import {
  replaceBody,
  checkOffTodo,
  appendAgentNotes,
  upsertSection,
  applyTodoModifications,
} from "../../parser/index.js";
import { HISTORY_MESSAGES } from "../../constants.js";
import type { RunnerContext } from "../../runner/types.js";
import {
  mkSchema,
  defAction,
  asOctokitLike,
  getStructuredOutput,
} from "./_shared.js";
import { projectActions } from "./project.js";
import { githubActions } from "./github.js";

// ============================================================================
// Triage Helpers
// ============================================================================

interface ProjectInfo {
  projectId: string;
  statusFieldId: string;
  statusOptions: Record<string, string>;
  priorityFieldId: string;
  priorityOptions: Record<string, string>;
  sizeFieldId: string;
  sizeOptions: Record<string, string>;
  estimateFieldId: string;
}

async function getProjectInfo(ctx: RunnerContext): Promise<ProjectInfo | null> {
  try {
    const result = await ctx.octokit.graphql<{
      organization: {
        projectV2: {
          id: string;
          fields: {
            nodes: Array<{
              id: string;
              name: string;
              dataType?: string;
              options?: Array<{ id: string; name: string }>;
            }>;
          };
        };
      };
    }>(GET_PROJECT_FIELDS_QUERY, {
      owner: ctx.owner,
      projectNumber: ctx.projectNumber,
    });

    const project = result.organization.projectV2;
    const fields = project.fields.nodes;

    const projectInfo: ProjectInfo = {
      projectId: project.id,
      statusFieldId: "",
      statusOptions: {},
      priorityFieldId: "",
      priorityOptions: {},
      sizeFieldId: "",
      sizeOptions: {},
      estimateFieldId: "",
    };

    for (const field of fields) {
      if (!field) continue;
      if (field.name === "Status" && field.options) {
        projectInfo.statusFieldId = field.id;
        for (const option of field.options) {
          projectInfo.statusOptions[option.name] = option.id;
        }
      } else if (field.name === "Priority" && field.options) {
        projectInfo.priorityFieldId = field.id;
        for (const option of field.options) {
          projectInfo.priorityOptions[option.name.toLowerCase()] = option.id;
        }
      } else if (field.name === "Size" && field.options) {
        projectInfo.sizeFieldId = field.id;
        for (const option of field.options) {
          projectInfo.sizeOptions[option.name.toLowerCase()] = option.id;
        }
      } else if (field.name === "Estimate") {
        projectInfo.estimateFieldId = field.id;
      }
    }

    return projectInfo;
  } catch (error) {
    core.warning(`Failed to get project info: ${error}`);
    return null;
  }
}

async function applyLabels(
  ctx: RunnerContext,
  issueNumber: number,
  classification: TriageClassification,
): Promise<void> {
  const newLabels: string[] = [];

  if (classification.type && classification.type !== "null") {
    newLabels.push(classification.type);
    core.info(`Adding type label: ${classification.type}`);
  }

  if (classification.topics) {
    for (const topic of classification.topics) {
      if (topic) {
        const label = topic.startsWith("topic:") ? topic : `topic:${topic}`;
        newLabels.push(label);
        core.info(`Adding topic label: ${label}`);
      }
    }
  }

  newLabels.push("triaged");
  core.info("Adding triaged label");

  if (newLabels.length > 0) {
    try {
      const { data, update } = await parseIssue(
        ctx.owner,
        ctx.repo,
        issueNumber,
        {
          octokit: asOctokitLike(ctx),
          fetchPRs: false,
          fetchParent: false,
        },
      );
      const existingLabels = data.issue.labels;
      const mergedLabels = [...new Set([...existingLabels, ...newLabels])];
      const state = { ...data, issue: { ...data.issue, labels: mergedLabels } };
      await update(state);
      core.info(`Applied labels: ${newLabels.join(", ")}`);
    } catch (error) {
      core.warning(`Failed to apply labels: ${error}`);
    }
  }
}

async function applyProjectFields(
  ctx: RunnerContext,
  issueNumber: number,
  classification: TriageClassification,
): Promise<void> {
  try {
    const issueQuery = `
      query($owner: String!, $repo: String!, $issueNumber: Int!) {
        repository(owner: $owner, name: $repo) {
          issue(number: $issueNumber) {
            id
            projectItems(first: 10) {
              nodes {
                id
                project { number }
              }
            }
          }
        }
      }
    `;

    const issueResult = await ctx.octokit.graphql<{
      repository: {
        issue: {
          id: string;
          projectItems: {
            nodes: Array<{ id: string; project: { number: number } }>;
          };
        };
      };
    }>(issueQuery, {
      owner: ctx.owner,
      repo: ctx.repo,
      issueNumber,
    });

    const projectItem = issueResult.repository.issue.projectItems.nodes.find(
      (item) => item.project.number === ctx.projectNumber,
    );

    if (!projectItem) {
      core.info(`Issue #${issueNumber} not in project ${ctx.projectNumber}`);
      return;
    }

    const projectInfo = await getProjectInfo(ctx);
    if (!projectInfo) {
      core.warning("Could not get project info");
      return;
    }

    if (
      classification.priority &&
      classification.priority !== "null" &&
      classification.priority !== "none" &&
      projectInfo.priorityFieldId
    ) {
      const optionId =
        projectInfo.priorityOptions[classification.priority.toLowerCase()];
      if (optionId) {
        await ctx.octokit.graphql(UPDATE_PROJECT_FIELD_MUTATION, {
          projectId: projectInfo.projectId,
          itemId: projectItem.id,
          fieldId: projectInfo.priorityFieldId,
          value: { singleSelectOptionId: optionId },
        });
        core.info(`Set Priority to ${classification.priority}`);
      }
    }

    if (classification.size && projectInfo.sizeFieldId) {
      const optionId =
        projectInfo.sizeOptions[classification.size.toLowerCase()];
      if (optionId) {
        await ctx.octokit.graphql(UPDATE_PROJECT_FIELD_MUTATION, {
          projectId: projectInfo.projectId,
          itemId: projectItem.id,
          fieldId: projectInfo.sizeFieldId,
          value: { singleSelectOptionId: optionId },
        });
        core.info(`Set Size to ${classification.size}`);
      }
    }

    if (classification.estimate && projectInfo.estimateFieldId) {
      await ctx.octokit.graphql(UPDATE_PROJECT_FIELD_MUTATION, {
        projectId: projectInfo.projectId,
        itemId: projectItem.id,
        fieldId: projectInfo.estimateFieldId,
        value: { number: classification.estimate },
      });
      core.info(`Set Estimate to ${classification.estimate}`);
    }
  } catch (error) {
    core.warning(`Failed to apply project fields: ${error}`);
  }
}

function extractPreservedSections(ast: Root): RootContent[] {
  const preserved: RootContent[] = [];
  const preservedHeadings = new Set(["Iteration History", "Agent Notes"]);
  let inPreserved = false;

  for (const node of ast.children) {
    if (node.type === "heading" && node.depth === 2) {
      const firstChild = node.children[0];
      const text = firstChild?.type === "text" ? firstChild.value : "";
      inPreserved = preservedHeadings.has(text);
    }
    if (inPreserved) {
      preserved.push(node);
    }
  }

  return preserved;
}

async function updateIssueStructure(
  ctx: RunnerContext,
  issueNumber: number,
  requirements: string[],
  initialApproach: string,
  initialQuestions?: string[],
): Promise<void> {
  try {
    const { data } = await parseIssue(ctx.owner, ctx.repo, issueNumber, {
      octokit: asOctokitLike(ctx),
      fetchPRs: false,
      fetchParent: false,
    });

    const sections: string[] = [];

    if (requirements.length > 0) {
      sections.push(
        `## Requirements\n\n${requirements.map((r) => `- ${r}`).join("\n")}`,
      );
    }

    if (initialApproach) {
      sections.push(`## Approach\n\n${initialApproach}`);
    }

    if (initialQuestions && initialQuestions.length > 0) {
      const questionLines = initialQuestions
        .map((q) => `- [ ] ${q}`)
        .join("\n");
      sections.push(`## Questions\n\n${questionLines}`);
    }

    const preservedNodes = extractPreservedSections(data.issue.bodyAst);
    let preservedMarkdown = "";
    if (preservedNodes.length > 0) {
      const preservedAst: Root = { type: "root", children: preservedNodes };
      preservedMarkdown = serializeMarkdown(preservedAst);
    }

    const newBody = [sections.join("\n\n"), preservedMarkdown]
      .filter(Boolean)
      .join("\n\n");

    await ctx.octokit.rest.issues.update({
      owner: ctx.owner,
      repo: ctx.repo,
      issue_number: issueNumber,
      body: newBody,
    });
    core.info(`Updated issue #${issueNumber} with structured sections`);
  } catch (error) {
    core.warning(`Failed to update issue structure: ${error}`);
  }
}

async function updateIssueBodyLegacy(
  ctx: RunnerContext,
  issueNumber: number,
  newBody: string,
): Promise<void> {
  try {
    const { data, update } = await parseIssue(
      ctx.owner,
      ctx.repo,
      issueNumber,
      {
        octokit: asOctokitLike(ctx),
        fetchPRs: false,
        fetchParent: false,
      },
    );
    const bodyAst = parseMarkdown(newBody);
    const state = replaceBody({ bodyAst }, data);
    await update(state);
    core.info(`Updated issue body for #${issueNumber}`);
  } catch (error) {
    core.warning(`Failed to update issue body: ${error}`);
  }
}

async function linkRelatedIssues(
  ctx: RunnerContext,
  issueNumber: number,
  relatedIssues: number[],
): Promise<void> {
  if (relatedIssues.length === 0) return;

  const links = relatedIssues.map((num) => `#${num}`).join(", ");
  const body = `**Related issues:** ${links}`;

  try {
    await createComment(
      ctx.owner,
      ctx.repo,
      issueNumber,
      body,
      asOctokitLike(ctx),
    );
    core.info(`Linked related issues: ${links}`);
  } catch (error) {
    core.warning(`Failed to link related issues: ${error}`);
  }
}

// ============================================================================
// Apply Actions
// ============================================================================

export const applyActions = {
  /** Apply triage output from triage-output.json */
  applyTriageOutput: defAction(
    mkSchema("applyTriageOutput", {
      issueNumber: z.number().int().positive(),
      filePath: z.string().optional(),
    }),
    {
      predict: () => [
        { target: { labels: { add: ["triaged"] } } },
        { target: { labels: { add: ["triaged"] } } },
      ],
      execute: async (action, ctx, chainCtx) => {
        const { issueNumber, filePath } = action;
        const structuredOutput = getStructuredOutput(action, chainCtx);

        let rawData: unknown;

        if (structuredOutput) {
          rawData = structuredOutput;
          core.info("Using structured output from in-process chain");
          core.startGroup("Triage Output (Structured)");
          core.info(JSON.stringify(rawData, null, 2));
          core.endGroup();
        } else if (filePath && fs.existsSync(filePath)) {
          try {
            const content = fs.readFileSync(filePath, "utf-8");
            rawData = JSON.parse(content);
            core.info(`Triage output from file: ${filePath}`);
            core.startGroup("Triage Output (File)");
            core.info(JSON.stringify(rawData, null, 2));
            core.endGroup();
          } catch (error) {
            core.warning(`Failed to parse triage output: ${error}`);
            return { applied: false };
          }
        } else {
          throw new Error(
            `No structured output provided and triage output file not found at: ${filePath || "undefined"}. ` +
              "Ensure runClaude action wrote claude-structured-output.json and artifact was downloaded.",
          );
        }

        if (ctx.dryRun) {
          core.info(
            `[DRY RUN] Would apply triage output to issue #${issueNumber}`,
          );
          return { applied: true };
        }

        const newFormatResult = TriageOutputSchema.safeParse(rawData);
        const isNewFormat = newFormatResult.success;

        let classification: TriageClassification;
        let newFormatOutput: TriageOutput | null = null;
        let legacyOutput: LegacyTriageOutput | null = null;

        if (isNewFormat) {
          newFormatOutput = newFormatResult.data;
          classification = newFormatOutput.triage;
        } else {
          legacyOutput = parseOutput(
            LegacyTriageOutputSchema,
            rawData,
            "triage (legacy)",
          );
          classification = {
            type: legacyOutput.type || "enhancement",
            priority: legacyOutput.priority,
            size: legacyOutput.size || "m",
            estimate: legacyOutput.estimate || 5,
            topics: legacyOutput.topics || [],
            needs_info: legacyOutput.needs_info || false,
          };
        }

        await applyLabels(ctx, issueNumber, classification);
        await applyProjectFields(ctx, issueNumber, classification);

        if (newFormatOutput) {
          await updateIssueStructure(
            ctx,
            issueNumber,
            newFormatOutput.requirements,
            newFormatOutput.initial_approach,
            newFormatOutput.initial_questions,
          );
        } else if (legacyOutput?.issue_body) {
          await updateIssueBodyLegacy(
            ctx,
            issueNumber,
            legacyOutput.issue_body,
          );
        }

        const relatedIssues =
          newFormatOutput?.related_issues || legacyOutput?.related_issues;
        if (relatedIssues && relatedIssues.length > 0) {
          await linkRelatedIssues(ctx, issueNumber, relatedIssues);
        }

        return { applied: true };
      },
    },
  ),

  /** Apply iterate output from Claude's structured output */
  applyIterateOutput: defAction(
    mkSchema("applyIterateOutput", {
      issueNumber: z.number().int().positive(),
      filePath: z.string().optional(),
      prNumber: z.number().int().positive().optional(),
      reviewer: z.string().min(1).optional(),
    }),
    {
      execute: async (action, ctx, chainCtx) => {
        const { issueNumber, filePath } = action;
        const structuredOutput = getStructuredOutput(action, chainCtx);

        let iterateOutput: IterateOutput;

        if (structuredOutput) {
          iterateOutput = parseOutput(
            IterateOutputSchema,
            structuredOutput,
            "iterate",
          );
          core.info("Using structured output from in-process chain");
        } else if (filePath && fs.existsSync(filePath)) {
          try {
            const content = fs.readFileSync(filePath, "utf-8");
            iterateOutput = parseOutput(
              IterateOutputSchema,
              JSON.parse(content),
              "iterate file",
            );
            core.info(`Iterate output from file: ${filePath}`);
          } catch (error) {
            core.warning(`Failed to parse iterate output: ${error}`);
            return { applied: false };
          }
        } else {
          core.warning(
            `No structured output provided and iterate output file not found at: ${filePath || "undefined"}. ` +
              "Ensure runClaude action wrote claude-structured-output.json and artifact was downloaded.",
          );
          return { applied: false };
        }

        core.info(`Processing iterate output for issue #${issueNumber}`);
        core.startGroup("Iterate Output");
        core.info(JSON.stringify(iterateOutput, null, 2));
        core.endGroup();

        if (ctx.dryRun) {
          core.info(
            `[DRY RUN] Would apply iterate output to issue #${issueNumber}`,
          );
          return { applied: true, status: iterateOutput.status };
        }

        const { data, update } = await parseIssue(
          ctx.owner,
          ctx.repo,
          issueNumber,
          {
            octokit: asOctokitLike(ctx),
            fetchPRs: false,
            fetchParent: false,
          },
        );

        let state = data;

        if (
          iterateOutput.status === "completed_todo" ||
          iterateOutput.status === "all_done"
        ) {
          const todosToCheck: string[] = [];
          if (
            iterateOutput.todos_completed &&
            iterateOutput.todos_completed.length > 0
          ) {
            todosToCheck.push(...iterateOutput.todos_completed);
          } else if (iterateOutput.todo_completed) {
            todosToCheck.push(iterateOutput.todo_completed);
          }

          for (const todoText of todosToCheck) {
            const newState = checkOffTodo({ todoText }, state);
            if (newState !== state) {
              state = newState;
              core.info(`Completed todo: ${todoText}`);
            } else {
              core.warning(
                `Could not find unchecked todo matching: "${todoText}"`,
              );
            }
          }
        }

        if (iterateOutput.agent_notes.length > 0) {
          const runId = ctx.runUrl?.split("/").pop() || `run-${Date.now()}`;
          const runLink =
            ctx.runUrl ||
            `${ctx.serverUrl}/${ctx.owner}/${ctx.repo}/actions/runs/${runId}`;

          state = appendAgentNotes(
            { runId, runLink, notes: iterateOutput.agent_notes },
            state,
          );

          core.info("Agent notes appended to issue body:");
          for (const note of iterateOutput.agent_notes) {
            core.info(`  - ${note}`);
          }
        }

        if (state !== data) {
          await update(state);
        }

        switch (iterateOutput.status) {
          case "completed_todo":
            break;
          case "waiting_manual":
            core.info(`Waiting for manual todo: ${iterateOutput.manual_todo}`);
            break;
          case "blocked":
            core.warning(`Iteration blocked: ${iterateOutput.blocked_reason}`);
            try {
              await projectActions.block.execute(
                {
                  type: "block",
                  token: "code",
                  issueNumber,
                  message:
                    iterateOutput.blocked_reason || "Agent reported blocked",
                },
                ctx,
              );

              await githubActions.unassignUser.execute(
                {
                  type: "unassignUser",
                  token: "code",
                  issueNumber,
                  username: "nopo-bot",
                },
                ctx,
              );

              await githubActions.appendHistory.execute(
                {
                  type: "appendHistory",
                  token: "code",
                  issueNumber,
                  phase: "-",
                  message: HISTORY_MESSAGES.agentBlocked(
                    iterateOutput.blocked_reason || "Unknown reason",
                  ),
                },
                ctx,
              );

              core.info(
                `Blocked issue #${issueNumber}: ${iterateOutput.blocked_reason}`,
              );
            } catch (error) {
              core.warning(`Failed to transition to blocked: ${error}`);
            }
            break;
          case "all_done":
            core.info(
              "All todos complete — waiting for CI to pass before requesting review",
            );
            break;
        }

        return { applied: true, status: iterateOutput.status };
      },
    },
  ),

  /** Append agent notes to an issue body */
  appendAgentNotes: defAction(
    mkSchema("appendAgentNotes", {
      issueNumber: z.number().int().positive(),
      runId: z.string(),
      runLink: z.string(),
      timestamp: z.string().optional(),
      notes: z.array(z.string()),
    }),
    {
      execute: async (action, ctx) => {
        const { issueNumber, notes, runId, runLink, timestamp } = action;

        if (notes.length === 0) {
          core.info("No agent notes to append, skipping");
          return { appended: false };
        }

        core.info(
          `Appending ${notes.length} agent notes to issue #${issueNumber}`,
        );

        if (ctx.dryRun) {
          core.info(
            `[DRY RUN] Would append agent notes to issue #${issueNumber}`,
          );
          core.startGroup("Agent Notes (dry run)");
          for (const note of notes) {
            core.info(`  - ${note}`);
          }
          core.endGroup();
          return { appended: true };
        }

        const { data, update } = await parseIssue(
          ctx.owner,
          ctx.repo,
          issueNumber,
          {
            octokit: asOctokitLike(ctx),
            fetchPRs: false,
            fetchParent: false,
          },
        );

        const state = appendAgentNotes(
          { runId, runLink, timestamp, notes },
          data,
        );

        if (state !== data) {
          await update(state);
          core.info(
            `Appended ${notes.length} agent notes to issue #${issueNumber}`,
          );
          core.startGroup("Agent Notes");
          for (const note of notes) {
            core.info(`  - ${note}`);
          }
          core.endGroup();
        } else {
          core.info("Issue body unchanged (notes may be empty)");
        }

        return { appended: true };
      },
    },
  ),

  /** Apply review output from Claude's structured output */
  applyReviewOutput: defAction(
    mkSchema("applyReviewOutput", {
      prNumber: z.number().int().positive(),
      filePath: z.string().optional(),
      worktree: z.string().optional(),
    }),
    {
      execute: async (action, ctx, chainCtx) => {
        const structuredOutput = getStructuredOutput(action, chainCtx);
        let reviewOutput: ReviewOutput;

        if (structuredOutput) {
          reviewOutput = parseOutput(
            ReviewOutputSchema,
            structuredOutput,
            "review",
          );
          core.info("Using structured output from in-process chain");
        } else if (action.filePath && fs.existsSync(action.filePath)) {
          try {
            const content = fs.readFileSync(action.filePath, "utf-8");
            reviewOutput = parseOutput(
              ReviewOutputSchema,
              JSON.parse(content),
              "review file",
            );
            core.info(`Review output from file: ${action.filePath}`);
          } catch (error) {
            throw new Error(
              `Failed to parse review output from file: ${error}`,
            );
          }
        } else {
          throw new Error(
            `No structured output provided and review output file not found at: ${action.filePath || "undefined"}. ` +
              "Ensure runClaude action wrote claude-structured-output.json and artifact was downloaded.",
          );
        }

        if (!reviewOutput.decision || !reviewOutput.body) {
          throw new Error(
            `Invalid review output: missing decision or body. Got: ${JSON.stringify(reviewOutput)}`,
          );
        }

        core.info(`Applying review output: ${reviewOutput.decision}`);
        core.startGroup("Review Output");
        core.info(JSON.stringify(reviewOutput, null, 2));
        core.endGroup();

        if (ctx.dryRun) {
          core.info(
            `[DRY RUN] Would submit ${reviewOutput.decision} review on PR #${action.prNumber}`,
          );
          return { submitted: true, decision: reviewOutput.decision };
        }

        return githubActions.submitReview.execute(
          {
            type: "submitReview",
            prNumber: action.prNumber,
            decision: reviewOutput.decision,
            body: reviewOutput.body,
            token: "review",
          },
          ctx,
        );
      },
    },
  ),

  /** Apply PR response output from Claude's structured output */
  applyPRResponseOutput: defAction(
    mkSchema("applyPRResponseOutput", {
      prNumber: z.number().int().positive(),
      issueNumber: z.number().int().positive(),
      filePath: z.string().optional(),
      worktree: z.string().optional(),
      reviewer: z.string().default("nopo-reviewer"),
    }),
    {
      execute: async (action, ctx, chainCtx) => {
        const structuredOutput = getStructuredOutput(action, chainCtx);
        let responseOutput: PRResponseOutput;

        if (structuredOutput) {
          responseOutput = parseOutput(
            PRResponseOutputSchema,
            structuredOutput,
            "pr-response",
          );
          core.info("Using structured output from in-process chain");
        } else if (action.filePath && fs.existsSync(action.filePath)) {
          try {
            const content = fs.readFileSync(action.filePath, "utf-8");
            responseOutput = parseOutput(
              PRResponseOutputSchema,
              JSON.parse(content),
              "pr-response file",
            );
            core.info(`PR response output from file: ${action.filePath}`);
          } catch (error) {
            throw new Error(
              `Failed to parse PR response output from file: ${error}`,
            );
          }
        } else {
          throw new Error(
            `No structured output provided and PR response output file not found at: ${action.filePath || "undefined"}. ` +
              "Ensure runClaude action wrote claude-structured-output.json and artifact was downloaded.",
          );
        }

        if (
          typeof responseOutput.had_commits !== "boolean" ||
          !responseOutput.summary
        ) {
          throw new Error(
            `Invalid PR response output: missing had_commits or summary. Got: ${JSON.stringify(responseOutput)}`,
          );
        }

        core.info(
          `Applying PR response output: had_commits=${responseOutput.had_commits}`,
        );
        core.startGroup("PR Response Output");
        core.info(JSON.stringify(responseOutput, null, 2));
        core.endGroup();

        if (ctx.dryRun) {
          core.info(
            `[DRY RUN] Would post comment and ${responseOutput.had_commits ? "wait for CI" : "re-request review"} on PR #${action.prNumber}`,
          );
          return { applied: true, hadCommits: responseOutput.had_commits };
        }

        await createComment(
          ctx.owner,
          ctx.repo,
          action.prNumber,
          responseOutput.summary,
          asOctokitLike(ctx),
        );

        core.info(`Posted response comment on PR #${action.prNumber}`);

        if (!responseOutput.had_commits) {
          try {
            await ctx.octokit.rest.pulls.requestReviewers({
              owner: ctx.owner,
              repo: ctx.repo,
              pull_number: action.prNumber,
              reviewers: [action.reviewer],
            });

            core.info(
              `Re-requested review from ${action.reviewer} on PR #${action.prNumber}`,
            );
          } catch (error) {
            core.warning(`Failed to re-request review: ${error}`);
          }
        }

        if (
          responseOutput.agent_notes &&
          responseOutput.agent_notes.length > 0
        ) {
          const runId = ctx.runUrl?.split("/").pop() || `run-${Date.now()}`;
          const runLink =
            ctx.runUrl ||
            `${ctx.serverUrl}/${ctx.owner}/${ctx.repo}/actions/runs/${runId}`;

          const { data, update } = await parseIssue(
            ctx.owner,
            ctx.repo,
            action.issueNumber,
            {
              octokit: asOctokitLike(ctx),
              fetchPRs: false,
              fetchParent: false,
            },
          );

          const state = appendAgentNotes(
            { runId, runLink, notes: responseOutput.agent_notes },
            data,
          );

          if (state !== data) {
            await update(state);
            core.info(
              `Appended ${responseOutput.agent_notes.length} agent notes to issue #${action.issueNumber}`,
            );
          }
        }

        return { applied: true, hadCommits: responseOutput.had_commits };
      },
    },
  ),

  /** Apply pivot output from Claude's structured analysis */
  applyPivotOutput: defAction(
    mkSchema("applyPivotOutput", {
      issueNumber: z.number().int().positive(),
      filePath: z.string().optional(),
    }),
    {
      execute: async (action, ctx, chainCtx) => {
        const structuredOutput = getStructuredOutput(action, chainCtx);
        let pivotOutput: PivotOutput;

        if (structuredOutput) {
          pivotOutput = parseOutput(
            PivotOutputSchema,
            structuredOutput,
            "pivot",
          );
          core.info("Using structured output from in-process chain");
        } else if (action.filePath && fs.existsSync(action.filePath)) {
          const content = fs.readFileSync(action.filePath, "utf-8");
          pivotOutput = parseOutput(
            PivotOutputSchema,
            JSON.parse(content),
            "pivot file",
          );
          core.info(`Pivot output from file: ${action.filePath}`);
        } else {
          throw new Error(
            `No structured output provided and file not found at: ${action.filePath}`,
          );
        }

        core.info(`Applying pivot output for issue #${action.issueNumber}`);
        core.startGroup("Pivot Output");
        core.info(JSON.stringify(pivotOutput, null, 2));
        core.endGroup();

        if (pivotOutput.outcome === "needs_clarification") {
          core.info("Pivot needs clarification - posting comment and exiting");
          await createComment(
            ctx.owner,
            ctx.repo,
            action.issueNumber,
            `## Pivot Needs Clarification\n\n${pivotOutput.clarification_needed || pivotOutput.summary_for_user}\n\n*Please provide more details and try again.*`,
            asOctokitLike(ctx),
          );
          return { applied: false, changesApplied: 0 };
        }

        if (pivotOutput.outcome === "no_changes_needed") {
          core.info("No changes needed");
          await createComment(
            ctx.owner,
            ctx.repo,
            action.issueNumber,
            `## Pivot Analysis\n\n${pivotOutput.summary_for_user}\n\n*No changes were required.*`,
            asOctokitLike(ctx),
          );
          return { applied: true, changesApplied: 0 };
        }

        let changesApplied = 0;
        const mods = pivotOutput.modifications;

        if (mods?.parent_issue?.update_sections) {
          changesApplied += Object.keys(
            mods.parent_issue.update_sections,
          ).length;
        }

        if (mods?.sub_issues) {
          for (const subIssue of mods.sub_issues) {
            if (subIssue.action === "modify" && subIssue.todo_modifications) {
              changesApplied += subIssue.todo_modifications.length;
            }
            if (subIssue.update_description) {
              changesApplied++;
            }
          }
        }

        const newSubIssueCount = mods?.new_sub_issues?.length ?? 0;
        changesApplied += newSubIssueCount;

        if (ctx.dryRun) {
          core.info(`[DRY RUN] Would apply ${changesApplied} pivot changes`);
          return { applied: true, changesApplied };
        }

        if (mods?.parent_issue?.update_sections) {
          const { data: parentData, update: parentUpdate } = await parseIssue(
            ctx.owner,
            ctx.repo,
            action.issueNumber,
            {
              octokit: asOctokitLike(ctx),
              fetchPRs: false,
              fetchParent: false,
            },
          );

          let parentState = parentData;
          for (const [section, content] of Object.entries(
            mods.parent_issue.update_sections,
          )) {
            core.info(`Updating parent issue section "${section}"`);
            const sectionAst = parseMarkdown(content);
            const sectionContent: RootContent[] =
              // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- mdast children are RootContent[]
              sectionAst.children as RootContent[];
            parentState = upsertSection(
              { title: section, content: sectionContent },
              parentState,
            );
          }

          await parentUpdate(parentState);
          core.info(`Updated parent issue body`);
        }

        if (mods?.sub_issues) {
          for (const subIssue of mods.sub_issues) {
            if (subIssue.action === "skip") continue;

            core.info(`Modifying sub-issue #${subIssue.issue_number}`);

            const { data: subData, update: subUpdate } = await parseIssue(
              ctx.owner,
              ctx.repo,
              subIssue.issue_number,
              {
                octokit: asOctokitLike(ctx),
                fetchPRs: false,
                fetchParent: false,
              },
            );

            let subState = subData;

            if (
              subIssue.todo_modifications &&
              subIssue.todo_modifications.length > 0
            ) {
              subState = applyTodoModifications(
                { modifications: subIssue.todo_modifications },
                subState,
              );
            }

            if (subIssue.update_description) {
              subState = replaceBody(
                { bodyAst: parseMarkdown(subIssue.update_description) },
                subState,
              );
            }

            await subUpdate(subState);
            core.info(`Updated sub-issue #${subIssue.issue_number}`);
          }
        }

        if (mods?.new_sub_issues && mods.new_sub_issues.length > 0) {
          core.info(`Creating ${mods.new_sub_issues.length} new sub-issues`);

          for (const newSubIssue of mods.new_sub_issues) {
            const todoList = newSubIssue.todos
              .map((t: string) => `- [ ] ${t}`)
              .join("\n");
            const bodyText = `${newSubIssue.description}\n\n## Todo\n\n${todoList}`;
            const bodyAst = parseMarkdown(bodyText);

            try {
              const result = await addSubIssueToParent(
                ctx.owner,
                ctx.repo,
                action.issueNumber,
                { title: newSubIssue.title, body: bodyAst },
                {
                  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- @actions/github octokit type differs from OctokitLike but is compatible
                  octokit: asOctokitLike(ctx) as Parameters<
                    typeof addSubIssueToParent
                  >[4]["octokit"],
                },
              );

              core.info(
                `Created sub-issue #${result.issueNumber}: ${newSubIssue.title} (${newSubIssue.reason})`,
              );
            } catch (error) {
              core.warning(`Failed to create sub-issue: ${error}`);
            }
          }
        }

        await createComment(
          ctx.owner,
          ctx.repo,
          action.issueNumber,
          `## Pivot Applied\n\n${pivotOutput.summary_for_user}\n\n*${changesApplied} changes applied. Review and use \`/lfg\` to continue.*`,
          asOctokitLike(ctx),
        );

        core.info(`Applied ${changesApplied} pivot changes`);
        return { applied: true, changesApplied };
      },
    },
  ),
};
