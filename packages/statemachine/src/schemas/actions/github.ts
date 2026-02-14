/**
 * GitHub Actions
 *
 * Actions for GitHub API operations: issues, PRs, labels, git, reviews.
 */

import { z } from "zod";
import * as core from "@actions/core";
import * as exec from "@actions/exec";
import {
  GET_PR_ID_QUERY,
  GET_REPO_ID_QUERY,
  CONVERT_PR_TO_DRAFT_MUTATION,
  MARK_PR_READY_MUTATION,
  CREATE_ISSUE_MUTATION,
  ADD_SUB_ISSUE_MUTATION,
  parseIssue,
  createComment,
  parseMarkdown,
} from "@more/issue-state";
import {
  addHistoryEntry,
  updateHistoryEntry,
  replaceBody,
} from "../../parser/index.js";
import {
  mkSchema,
  defAction,
  asOctokitLike,
  type PredictDiff,
} from "./_shared.js";
import { PhaseDefinitionSchema } from "./_shared.js";

// ============================================================================
// Types
// ============================================================================

interface PRIdResponse {
  repository?: {
    pullRequest?: {
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

// ============================================================================
// GitHub Actions
// ============================================================================

export const githubActions = {
  // --------------------------------------------------------------------------
  // Issue Actions
  // --------------------------------------------------------------------------

  /** Close an issue */
  closeIssue: defAction(
    mkSchema("closeIssue", {
      issueNumber: z.number().int().positive(),
      reason: z.enum(["completed", "not_planned"]),
    }),
    {
      predict: () => ({ target: { state: "CLOSED" } }),
      execute: async (action, ctx) => {
        const { data, update } = await parseIssue(
          ctx.owner,
          ctx.repo,
          action.issueNumber,
          {
            octokit: asOctokitLike(ctx),
            projectNumber: ctx.projectNumber,
            fetchPRs: false,
            fetchParent: false,
          },
        );

        const state = {
          ...data,
          issue: {
            ...data.issue,
            state: "CLOSED" as const,
            stateReason:
              action.reason === "not_planned"
                ? ("not_planned" as const)
                : ("completed" as const),
          },
        };

        await update(state);
        core.info(`Closed issue #${action.issueNumber}`);
        return { closed: true };
      },
    },
  ),

  /** Reopen a closed issue */
  reopenIssue: defAction(
    mkSchema("reopenIssue", {
      issueNumber: z.number().int().positive(),
    }),
    {
      predict: () => ({ target: { state: "OPEN" } }),
      execute: (action) => {
        core.info(
          `Reopen issue #${action.issueNumber} - handled by resetIssue`,
        );
        return Promise.resolve({ reopened: true });
      },
    },
  ),

  /** Reset an issue (and sub-issues) to initial state */
  resetIssue: defAction(
    mkSchema("resetIssue", {
      issueNumber: z.number().int().positive(),
      subIssueNumbers: z.array(z.number().int().positive()).default([]),
      botUsername: z.string().min(1),
    }),
    {
      predict: (a) => ({
        issue: {
          state: "OPEN",
          projectStatus: "Backlog",
          failures: 0,
          iteration: 0,
          assignees: { remove: [a.botUsername] },
        },
        subs: a.subIssueNumbers.map((n: number) => ({
          number: n,
          state: "OPEN",
          projectStatus: "Ready",
        })),
      }),
      execute: async (action, ctx) => {
        let resetCount = 0;
        const octokit = asOctokitLike(ctx);

        // 1. Reopen the parent issue if closed
        try {
          const { data, update } = await parseIssue(
            ctx.owner,
            ctx.repo,
            action.issueNumber,
            {
              octokit,
              projectNumber: ctx.projectNumber,
              fetchPRs: false,
              fetchParent: false,
            },
          );

          if (data.issue.state === "CLOSED") {
            await update({
              ...data,
              issue: { ...data.issue, state: "OPEN" },
            });
            core.info(`Reopened issue #${action.issueNumber}`);
            resetCount++;
          }
        } catch (error) {
          core.warning(
            `Failed to reopen issue #${action.issueNumber}: ${error}`,
          );
        }

        // 2. Reopen all sub-issues if closed
        for (const subIssueNumber of action.subIssueNumbers) {
          try {
            const { data: subData, update: subUpdate } = await parseIssue(
              ctx.owner,
              ctx.repo,
              subIssueNumber,
              {
                octokit,
                projectNumber: ctx.projectNumber,
                fetchPRs: false,
                fetchParent: false,
              },
            );

            if (subData.issue.state === "CLOSED") {
              await subUpdate({
                ...subData,
                issue: { ...subData.issue, state: "OPEN" },
              });
              core.info(`Reopened sub-issue #${subIssueNumber}`);
              resetCount++;
            }
          } catch (error) {
            core.warning(
              `Failed to reopen sub-issue #${subIssueNumber}: ${error}`,
            );
          }
        }

        // 3. Unassign bot from parent issue
        try {
          const { data, update } = await parseIssue(
            ctx.owner,
            ctx.repo,
            action.issueNumber,
            {
              octokit,
              projectNumber: ctx.projectNumber,
              fetchPRs: false,
              fetchParent: false,
            },
          );

          await update({
            ...data,
            issue: {
              ...data.issue,
              assignees: data.issue.assignees.filter(
                (a) => a !== action.botUsername,
              ),
            },
          });
          core.info(
            `Unassigned ${action.botUsername} from issue #${action.issueNumber}`,
          );
        } catch (error) {
          core.warning(
            `Failed to unassign bot from issue #${action.issueNumber}: ${error}`,
          );
        }

        // 4. Unassign bot from all sub-issues
        for (const subIssueNumber of action.subIssueNumbers) {
          try {
            const { data: subData, update: subUpdate } = await parseIssue(
              ctx.owner,
              ctx.repo,
              subIssueNumber,
              {
                octokit,
                projectNumber: ctx.projectNumber,
                fetchPRs: false,
                fetchParent: false,
              },
            );

            await subUpdate({
              ...subData,
              issue: {
                ...subData.issue,
                assignees: subData.issue.assignees.filter(
                  (a) => a !== action.botUsername,
                ),
              },
            });
            core.info(
              `Unassigned ${action.botUsername} from sub-issue #${subIssueNumber}`,
            );
          } catch (error) {
            core.warning(
              `Failed to unassign bot from sub-issue #${subIssueNumber}: ${error}`,
            );
          }
        }

        core.info(`Reset complete: ${resetCount} issues reopened`);
        return { resetCount };
      },
    },
  ),

  /** Append an entry to the Iteration History table */
  appendHistory: defAction(
    mkSchema("appendHistory", {
      issueNumber: z.number().int().positive(),
      message: z.string(),
      iteration: z.number().int().min(0).optional(),
      phase: z.string().optional(),
      timestamp: z.string().optional(),
      commitSha: z.string().optional(),
      runLink: z.string().optional(),
      prNumber: z.number().int().positive().nullable().optional(),
    }),
    {
      predict: (a) => ({
        issue: {
          body: {
            historyEntries: {
              add: [
                {
                  iteration: a.iteration ?? 0,
                  phase: a.phase,
                  action: a.message,
                  timestamp: null,
                  sha: null,
                  runLink: null,
                },
              ],
            },
          },
        },
      }),
      execute: async (action, ctx) => {
        const octokit = asOctokitLike(ctx);
        const iteration = action.iteration ?? 0;
        const repoUrl = `${ctx.serverUrl}/${ctx.owner}/${ctx.repo}`;
        const timestamp = action.timestamp || new Date().toISOString();

        const { data, update } = await parseIssue(
          ctx.owner,
          ctx.repo,
          action.issueNumber,
          {
            octokit,
            projectNumber: ctx.projectNumber,
            fetchPRs: false,
            fetchParent: false,
          },
        );

        const state = addHistoryEntry(
          {
            iteration,
            phase: action.phase ?? "-",
            action: action.message,
            timestamp,
            sha: action.commitSha ?? null,
            runLink: action.runLink ?? null,
            repoUrl,
          },
          data,
        );

        await update(state);
        core.info(`Appended history: Phase ${action.phase}, ${action.message}`);

        // If this is a sub-issue, also log to parent
        if (data.issue.parentIssueNumber) {
          const { data: parentData, update: parentUpdate } = await parseIssue(
            ctx.owner,
            ctx.repo,
            data.issue.parentIssueNumber,
            {
              octokit,
              projectNumber: ctx.projectNumber,
              fetchPRs: false,
              fetchParent: false,
            },
          );

          const parentState = addHistoryEntry(
            {
              iteration,
              phase: action.phase ?? "-",
              action: action.message,
              timestamp,
              sha: action.commitSha ?? null,
              runLink: action.runLink ?? null,
              repoUrl,
            },
            parentData,
          );

          await parentUpdate(parentState);
          core.info(
            `Also appended to parent issue #${data.issue.parentIssueNumber}`,
          );
        }

        return { appended: true };
      },
    },
  ),

  /** Update an existing history entry */
  updateHistory: defAction(
    mkSchema("updateHistory", {
      issueNumber: z.number().int().positive(),
      matchIteration: z.number().int().min(0),
      matchPhase: z.string(),
      matchPattern: z.string(),
      newMessage: z.string(),
      timestamp: z.string().optional(),
      commitSha: z.string().optional(),
      runLink: z.string().optional(),
      prNumber: z.number().int().positive().nullable().optional(),
    }),
    {
      execute: async (action, ctx) => {
        const octokit = asOctokitLike(ctx);
        const repoUrl = `${ctx.serverUrl}/${ctx.owner}/${ctx.repo}`;
        const timestamp = action.timestamp || new Date().toISOString();

        const { data, update } = await parseIssue(
          ctx.owner,
          ctx.repo,
          action.issueNumber,
          {
            octokit,
            projectNumber: ctx.projectNumber,
            fetchPRs: false,
            fetchParent: false,
          },
        );

        let state = updateHistoryEntry(
          {
            matchIteration: action.matchIteration,
            matchPhase: action.matchPhase,
            matchPattern: action.matchPattern,
            newAction: action.newMessage,
            timestamp,
            sha: action.commitSha ?? null,
            runLink: action.runLink ?? null,
            repoUrl,
          },
          data,
        );

        if (state === data) {
          core.info(
            `No matching history entry found - adding new entry for Phase ${action.matchPhase}`,
          );
          state = addHistoryEntry(
            {
              iteration: action.matchIteration,
              phase: action.matchPhase,
              action: action.newMessage,
              timestamp,
              sha: action.commitSha ?? null,
              runLink: action.runLink ?? null,
              repoUrl,
            },
            data,
          );
        } else {
          core.info(
            `Updated history: Phase ${action.matchPhase}, ${action.newMessage}`,
          );
        }

        await update(state);

        // If this is a sub-issue, also update parent
        if (data.issue.parentIssueNumber) {
          const { data: parentData, update: parentUpdate } = await parseIssue(
            ctx.owner,
            ctx.repo,
            data.issue.parentIssueNumber,
            {
              octokit,
              projectNumber: ctx.projectNumber,
              fetchPRs: false,
              fetchParent: false,
            },
          );

          let parentState = updateHistoryEntry(
            {
              matchIteration: action.matchIteration,
              matchPhase: action.matchPhase,
              matchPattern: action.matchPattern,
              newAction: action.newMessage,
              timestamp,
              sha: action.commitSha ?? null,
              runLink: action.runLink ?? null,
              repoUrl,
            },
            parentData,
          );

          if (parentState === parentData) {
            parentState = addHistoryEntry(
              {
                iteration: action.matchIteration,
                phase: action.matchPhase,
                action: action.newMessage,
                timestamp,
                sha: action.commitSha ?? null,
                runLink: action.runLink ?? null,
                repoUrl,
              },
              parentData,
            );
            core.info(
              `Added new entry to parent issue #${data.issue.parentIssueNumber}`,
            );
          } else {
            core.info(
              `Also updated parent issue #${data.issue.parentIssueNumber}`,
            );
          }

          await parentUpdate(parentState);
        }

        return { updated: true };
      },
    },
  ),

  /** Update the issue body */
  updateIssueBody: defAction(
    mkSchema("updateIssueBody", {
      issueNumber: z.number().int().positive(),
      body: z.string(),
    }),
    {
      execute: async (action, ctx) => {
        const octokit = asOctokitLike(ctx);
        const { data, update } = await parseIssue(
          ctx.owner,
          ctx.repo,
          action.issueNumber,
          {
            octokit,
            projectNumber: ctx.projectNumber,
            fetchPRs: false,
            fetchParent: false,
          },
        );

        const newBodyAst = parseMarkdown(action.body);
        const state = replaceBody({ bodyAst: newBodyAst }, data);
        await update(state);

        core.info(`Updated body for issue #${action.issueNumber}`);
        return { updated: true };
      },
    },
  ),

  /** Add a comment to an issue */
  addComment: defAction(
    mkSchema("addComment", {
      issueNumber: z.number().int().positive(),
      body: z.string(),
    }),
    {
      execute: async (action, ctx) => {
        const result = await createComment(
          ctx.owner,
          ctx.repo,
          action.issueNumber,
          action.body,
          asOctokitLike(ctx),
        );

        core.info(`Added comment to issue #${action.issueNumber}`);
        return { commentId: result.commentId };
      },
    },
  ),

  /** Unassign a user from an issue */
  unassignUser: defAction(
    mkSchema("unassignUser", {
      issueNumber: z.number().int().positive(),
      username: z.string().min(1),
    }),
    {
      predict: (a) => ({ target: { assignees: { remove: [a.username] } } }),
      execute: async (action, ctx) => {
        await ctx.octokit.rest.issues.removeAssignees({
          owner: ctx.owner,
          repo: ctx.repo,
          issue_number: action.issueNumber,
          assignees: [action.username],
        });

        core.info(
          `Unassigned ${action.username} from issue #${action.issueNumber}`,
        );
        return { unassigned: true };
      },
    },
  ),

  /** Assign a user to an issue */
  assignUser: defAction(
    mkSchema("assignUser", {
      issueNumber: z.number().int().positive(),
      username: z.string().min(1),
    }),
    {
      predict: (a) => ({ target: { assignees: { add: [a.username] } } }),
      execute: async (action, ctx) => {
        await ctx.octokit.rest.issues.addAssignees({
          owner: ctx.owner,
          repo: ctx.repo,
          issue_number: action.issueNumber,
          assignees: [action.username],
        });

        core.info(
          `Assigned ${action.username} to issue #${action.issueNumber}`,
        );
        return { assigned: true };
      },
    },
  ),

  // --------------------------------------------------------------------------
  // Label Actions
  // --------------------------------------------------------------------------

  /** Add a label to an issue */
  addLabel: defAction(
    mkSchema("addLabel", {
      issueNumber: z.number().int().positive(),
      label: z.string().min(1),
    }),
    {
      predict: (a) => ({ target: { labels: { add: [a.label] } } }),
      execute: async (action, ctx) => {
        try {
          const octokit = asOctokitLike(ctx);
          const { data, update } = await parseIssue(
            ctx.owner,
            ctx.repo,
            action.issueNumber,
            {
              octokit,
              projectNumber: ctx.projectNumber,
              fetchPRs: false,
              fetchParent: false,
            },
          );

          await update({
            ...data,
            issue: {
              ...data.issue,
              labels: [...data.issue.labels, action.label],
            },
          });

          core.info(
            `Added label "${action.label}" to issue #${action.issueNumber}`,
          );
          return { added: true };
        } catch (error) {
          core.warning(
            `Failed to add label "${action.label}" to issue #${action.issueNumber}: ${error}`,
          );
          return { added: false };
        }
      },
    },
  ),

  /** Remove a label from an issue */
  removeLabel: defAction(
    mkSchema("removeLabel", {
      issueNumber: z.number().int().positive(),
      label: z.string().min(1),
    }),
    {
      predict: (a) => ({ target: { labels: { remove: [a.label] } } }),
      execute: async (action, ctx) => {
        try {
          const octokit = asOctokitLike(ctx);
          const { data, update } = await parseIssue(
            ctx.owner,
            ctx.repo,
            action.issueNumber,
            {
              octokit,
              projectNumber: ctx.projectNumber,
              fetchPRs: false,
              fetchParent: false,
            },
          );

          await update({
            ...data,
            issue: {
              ...data.issue,
              labels: data.issue.labels.filter((l) => l !== action.label),
            },
          });

          core.info(
            `Removed label "${action.label}" from issue #${action.issueNumber}`,
          );
          return { removed: true };
        } catch (error) {
          if (error instanceof Error && error.message.includes("404")) {
            core.info(
              `Label "${action.label}" was not present on issue #${action.issueNumber}`,
            );
            return { removed: false };
          }
          core.warning(
            `Failed to remove label "${action.label}" from issue #${action.issueNumber}: ${error}`,
          );
          return { removed: false };
        }
      },
    },
  ),

  // --------------------------------------------------------------------------
  // Sub-Issue Actions
  // --------------------------------------------------------------------------

  /** Create sub-issues for phased work */
  createSubIssues: defAction(
    mkSchema("createSubIssues", {
      parentIssueNumber: z.number().int().positive(),
      phases: z.array(PhaseDefinitionSchema).min(1),
    }),
    {
      execute: async (action, ctx) => {
        const repoResponse = await ctx.octokit.graphql<RepoIdResponse>(
          GET_REPO_ID_QUERY,
          { owner: ctx.owner, repo: ctx.repo },
        );

        const repoId = repoResponse.repository?.id;
        if (!repoId) throw new Error("Repository not found");

        const parentQuery = `
          query GetParentIssueId($owner: String!, $repo: String!, $issueNumber: Int!) {
            repository(owner: $owner, name: $repo) {
              issue(number: $issueNumber) { id }
            }
          }
        `;

        const parentResponse = await ctx.octokit.graphql<{
          repository: { issue: { id: string } | null };
        }>(parentQuery, {
          owner: ctx.owner,
          repo: ctx.repo,
          issueNumber: action.parentIssueNumber,
        });

        const parentId = parentResponse.repository?.issue?.id;
        if (!parentId) {
          throw new Error(
            `Parent issue #${action.parentIssueNumber} not found`,
          );
        }

        const subIssueNumbers: number[] = [];
        const octokit = asOctokitLike(ctx);

        for (let i = 0; i < action.phases.length; i++) {
          const phase = action.phases[i];
          if (!phase) continue;

          const title = `[Phase ${i + 1}]: ${phase.title}`;

          const createResponse = await ctx.octokit.graphql<CreateIssueResponse>(
            CREATE_ISSUE_MUTATION,
            { repositoryId: repoId, title, body: phase.body },
          );

          const issueId = createResponse.createIssue?.issue?.id;
          const issueNumber = createResponse.createIssue?.issue?.number;

          if (!issueId || !issueNumber) {
            throw new Error(`Failed to create sub-issue for phase ${i + 1}`);
          }

          await ctx.octokit.graphql(ADD_SUB_ISSUE_MUTATION, {
            parentId,
            childId: issueId,
          });

          // Add "triaged" label
          const { data: subData, update: subUpdate } = await parseIssue(
            ctx.owner,
            ctx.repo,
            issueNumber,
            {
              octokit,
              projectNumber: ctx.projectNumber,
              fetchPRs: false,
              fetchParent: false,
            },
          );

          await subUpdate({
            ...subData,
            issue: {
              ...subData.issue,
              labels: [...subData.issue.labels, "triaged"],
            },
          });

          subIssueNumbers.push(issueNumber);
          core.info(`Created sub-issue #${issueNumber} for phase ${i + 1}`);
        }

        return { subIssueNumbers };
      },
    },
  ),

  // --------------------------------------------------------------------------
  // Git Actions
  // --------------------------------------------------------------------------

  /** Create a new branch */
  createBranch: defAction(
    mkSchema("createBranch", {
      branchName: z.string().min(1),
      baseBranch: z.string().default("main").optional(),
      worktree: z.string().optional(),
    }),
    {
      predict: (_a, _t, ctx) => {
        const subNumber =
          ctx.machineContext.currentSubIssue?.number ??
          ctx.machineContext.issue.number;
        return { subs: [{ number: subNumber, hasBranch: true }] };
      },
      execute: async (action, ctx) => {
        const result = {
          created: false,
          checkedOut: false,
          rebased: false,
          pushed: false,
          shouldStop: false,
        };

        core.info(`Fetching latest from origin...`);
        await exec.exec("git", ["fetch", "origin"], {
          ignoreReturnCode: true,
        });

        const remoteBranchExists = await ctx.octokit.rest.repos
          .getBranch({
            owner: ctx.owner,
            repo: ctx.repo,
            branch: action.branchName,
          })
          .then(() => true)
          .catch(() => false);

        if (!remoteBranchExists) {
          core.info(
            `Branch ${action.branchName} doesn't exist remotely, creating from ${action.baseBranch}`,
          );

          const baseRef = await ctx.octokit.rest.git.getRef({
            owner: ctx.owner,
            repo: ctx.repo,
            ref: `heads/${action.baseBranch}`,
          });

          await ctx.octokit.rest.git.createRef({
            owner: ctx.owner,
            repo: ctx.repo,
            ref: `refs/heads/${action.branchName}`,
            sha: baseRef.data.object.sha,
          });

          result.created = true;
          core.info(`Created remote branch ${action.branchName}`);

          await exec.exec("git", ["fetch", "origin"], {
            ignoreReturnCode: true,
          });
        }

        let checkoutExitCode = await exec.exec(
          "git",
          ["checkout", action.branchName],
          { ignoreReturnCode: true },
        );

        if (checkoutExitCode !== 0) {
          checkoutExitCode = await exec.exec(
            "git",
            [
              "checkout",
              "-b",
              action.branchName,
              `origin/${action.branchName}`,
            ],
            { ignoreReturnCode: true },
          );

          if (checkoutExitCode !== 0) {
            checkoutExitCode = await exec.exec(
              "git",
              [
                "checkout",
                "-b",
                action.branchName,
                `origin/${action.baseBranch}`,
              ],
              { ignoreReturnCode: true },
            );
          }
        }

        if (checkoutExitCode !== 0) {
          throw new Error(`Failed to checkout branch ${action.branchName}`);
        }

        result.checkedOut = true;
        core.info(`Checked out branch ${action.branchName}`);

        await exec.exec(
          "git",
          ["branch", "--set-upstream-to", `origin/${action.branchName}`],
          { ignoreReturnCode: true },
        );

        let commitsCount = "";
        await exec.exec(
          "git",
          ["rev-list", "--count", `HEAD..origin/${action.baseBranch}`],
          {
            ignoreReturnCode: true,
            listeners: {
              stdout: (data) => {
                commitsCount += data.toString();
              },
            },
          },
        );

        const commitsBehind = parseInt(commitsCount.trim(), 10) || 0;

        if (commitsBehind > 0) {
          core.info(
            `Branch is ${commitsBehind} commits behind origin/${action.baseBranch}, attempting rebase...`,
          );

          const rebaseExitCode = await exec.exec(
            "git",
            ["rebase", `origin/${action.baseBranch}`],
            { ignoreReturnCode: true },
          );

          if (rebaseExitCode !== 0) {
            core.warning(
              `Rebase failed, aborting and continuing with current state`,
            );
            await exec.exec("git", ["rebase", "--abort"], {
              ignoreReturnCode: true,
            });
            return result;
          }

          result.rebased = true;
          core.info(`Successfully rebased on origin/${action.baseBranch}`);

          const pushExitCode = await exec.exec(
            "git",
            ["push", "origin", action.branchName, "--force-with-lease"],
            { ignoreReturnCode: true },
          );

          if (pushExitCode === 0) {
            result.pushed = true;
            result.shouldStop = true;
            core.info(
              `Pushed rebased changes. Stopping execution - CI will re-trigger with up-to-date branch.`,
            );
          } else {
            core.warning(`Failed to push rebased changes, continuing anyway`);
          }
        } else {
          core.info(`Branch is up-to-date with origin/${action.baseBranch}`);
        }

        return result;
      },
    },
  ),

  /** Push commits to a branch */
  gitPush: defAction(
    mkSchema("gitPush", {
      branchName: z.string().min(1),
      force: z.boolean().default(false).optional(),
    }),
    {
      execute: async (action) => {
        const args = ["push", "origin", action.branchName];
        if (action.force) args.push("--force");

        let stderr = "";
        const exitCode = await exec.exec("git", args, {
          ignoreReturnCode: true,
          listeners: {
            stderr: (data) => {
              stderr += data.toString();
            },
          },
        });

        if (exitCode !== 0) {
          core.warning(`Git push failed: ${stderr}`);
          return { pushed: false };
        }

        core.info(`Pushed to ${action.branchName}`);
        return { pushed: true };
      },
    },
  ),

  // --------------------------------------------------------------------------
  // PR Actions
  // --------------------------------------------------------------------------

  /** Create a pull request */
  createPR: defAction(
    mkSchema("createPR", {
      title: z.string().min(1),
      body: z.string(),
      branchName: z.string().min(1),
      issueNumber: z.number().int().positive(),
      baseBranch: z.string().default("main").optional(),
      draft: z.boolean().default(true).optional(),
    }),
    {
      predict: (a) => ({
        target: {
          hasPR: true,
          pr: { isDraft: a.draft ?? true, state: "OPEN" },
        },
      }),
      execute: async (action, ctx) => {
        const existingPRs = await ctx.octokit.rest.pulls.list({
          owner: ctx.owner,
          repo: ctx.repo,
          head: `${ctx.owner}:${action.branchName}`,
          base: action.baseBranch,
          state: "open",
        });

        const existingPR = existingPRs.data[0];
        if (existingPR) {
          core.info(
            `PR #${existingPR.number} already exists for branch ${action.branchName}`,
          );
          return { prNumber: existingPR.number };
        }

        const body = `${action.body}\n\nFixes #${action.issueNumber}`;
        const response = await ctx.octokit.rest.pulls.create({
          owner: ctx.owner,
          repo: ctx.repo,
          title: action.title,
          body,
          head: action.branchName,
          base: action.baseBranch ?? "main",
          draft: action.draft,
        });

        core.info(
          `Created PR #${response.data.number} for issue #${action.issueNumber}`,
        );
        return { prNumber: response.data.number };
      },
    },
  ),

  /** Convert PR to draft */
  convertPRToDraft: defAction(
    mkSchema("convertPRToDraft", {
      prNumber: z.number().int().positive(),
    }),
    {
      predict: (a, _t, ctx) => {
        const sub =
          ctx.tree.subIssues.find(
            (s) => s.pr !== null && s.number === a.prNumber,
          ) ?? ctx.tree.subIssues.find((s) => s.hasPR);
        const diff: PredictDiff = {};
        if (sub) diff.subs = [{ number: sub.number, pr: { isDraft: true } }];
        if (ctx.tree.issue.pr && ctx.tree.issue.number === a.prNumber) {
          diff.issue = { pr: { isDraft: true } };
        }
        return diff;
      },
      execute: async (action, ctx) => {
        const prResponse = await ctx.octokit.graphql<PRIdResponse>(
          GET_PR_ID_QUERY,
          {
            owner: ctx.owner,
            repo: ctx.repo,
            prNumber: action.prNumber,
          },
        );

        const prId = prResponse.repository?.pullRequest?.id;
        if (!prId) throw new Error(`PR #${action.prNumber} not found`);

        await ctx.octokit.graphql(CONVERT_PR_TO_DRAFT_MUTATION, { prId });
        core.info(`Converted PR #${action.prNumber} to draft`);
        return { converted: true };
      },
    },
  ),

  /** Mark a PR as ready for review */
  markPRReady: defAction(
    mkSchema("markPRReady", {
      prNumber: z.number().int().positive(),
    }),
    {
      predict: (a, _t, ctx) => {
        const sub =
          ctx.tree.subIssues.find(
            (s) => s.pr !== null && s.number === a.prNumber,
          ) ?? ctx.tree.subIssues.find((s) => s.hasPR);
        const diff: PredictDiff = {};
        if (sub) diff.subs = [{ number: sub.number, pr: { isDraft: false } }];
        if (ctx.tree.issue.pr && ctx.tree.issue.number === a.prNumber) {
          diff.issue = { pr: { isDraft: false } };
        }
        return diff;
      },
      execute: async (action, ctx) => {
        const prResponse = await ctx.octokit.graphql<PRIdResponse>(
          GET_PR_ID_QUERY,
          {
            owner: ctx.owner,
            repo: ctx.repo,
            prNumber: action.prNumber,
          },
        );

        const prId = prResponse.repository?.pullRequest?.id;
        if (!prId) throw new Error(`PR #${action.prNumber} not found`);

        await ctx.octokit.graphql(MARK_PR_READY_MUTATION, { prId });
        core.info(`Marked PR #${action.prNumber} as ready for review`);
        return { ready: true };
      },
    },
  ),

  /** Request a reviewer for a PR */
  requestReview: defAction(
    mkSchema("requestReview", {
      prNumber: z.number().int().positive(),
      reviewer: z.string().min(1),
    }),
    {
      execute: async (action, ctx) => {
        // Dismiss existing reviews from this reviewer
        const { data: reviews } = await ctx.octokit.rest.pulls.listReviews({
          owner: ctx.owner,
          repo: ctx.repo,
          pull_number: action.prNumber,
        });

        const existingReviews = reviews.filter(
          (r) => r.user?.login === action.reviewer && r.state !== "DISMISSED",
        );

        for (const review of existingReviews) {
          await ctx.octokit.graphql(
            `mutation($reviewId: ID!, $message: String!) {
              dismissPullRequestReview(input: {
                pullRequestReviewId: $reviewId
                message: $message
              }) {
                pullRequestReview { id }
              }
            }`,
            {
              reviewId: review.node_id,
              message: "Dismissing for re-review after new iteration",
            },
          );
          core.info(
            `Dismissed ${review.state} review ${review.id} from ${action.reviewer} on PR #${action.prNumber}`,
          );
        }

        // Remove then re-add to fire review_requested event
        try {
          await ctx.octokit.rest.pulls.removeRequestedReviewers({
            owner: ctx.owner,
            repo: ctx.repo,
            pull_number: action.prNumber,
            reviewers: [action.reviewer],
          });
          core.info(
            `Removed ${action.reviewer} from requested reviewers on PR #${action.prNumber}`,
          );
        } catch {
          // Reviewer may not be in the requested list
        }

        await ctx.octokit.rest.pulls.requestReviewers({
          owner: ctx.owner,
          repo: ctx.repo,
          pull_number: action.prNumber,
          reviewers: [action.reviewer],
        });

        core.info(
          `Requested review from ${action.reviewer} on PR #${action.prNumber}`,
        );
        return { requested: true };
      },
    },
  ),

  /** Mark a PR as ready for merge (adds label + history entry) */
  mergePR: defAction(
    mkSchema("mergePR", {
      prNumber: z.number().int().positive(),
      issueNumber: z.number().int().positive(),
      mergeMethod: z
        .enum(["merge", "squash", "rebase"])
        .default("squash")
        .optional(),
    }),
    {
      execute: async (action, ctx) => {
        const octokit = asOctokitLike(ctx);
        const label = "ready-to-merge";

        // Add "ready-to-merge" label to the PR
        try {
          const { data: prData, update: prUpdate } = await parseIssue(
            ctx.owner,
            ctx.repo,
            action.prNumber,
            {
              octokit,
              projectNumber: ctx.projectNumber,
              fetchPRs: false,
              fetchParent: false,
            },
          );

          await prUpdate({
            ...prData,
            issue: {
              ...prData.issue,
              labels: [...prData.issue.labels, label],
            },
          });
          core.info(`Added "${label}" label to PR #${action.prNumber}`);
        } catch (error) {
          core.warning(`Failed to add label: ${error}`);
        }

        // Add history entry
        const { data, update } = await parseIssue(
          ctx.owner,
          ctx.repo,
          action.issueNumber,
          {
            octokit,
            projectNumber: ctx.projectNumber,
            fetchPRs: false,
            fetchParent: false,
          },
        );

        const repoUrl = `${ctx.serverUrl}/${ctx.owner}/${ctx.repo}`;
        const timestamp = new Date().toISOString();
        const runLink = ctx.runUrl;

        const state = addHistoryEntry(
          {
            iteration: 0,
            phase: "-",
            action: "🔀 Ready for merge",
            timestamp,
            runLink: runLink ?? null,
            repoUrl,
          },
          data,
        );

        await update(state);
        core.info(
          `PR #${action.prNumber} marked ready for merge (human action required)`,
        );
        return { markedReady: true };
      },
    },
  ),

  /** Submit a PR review (approve, request changes, or comment) */
  submitReview: defAction(
    mkSchema("submitReview", {
      prNumber: z.number().int().positive(),
      decision: z.enum(["approve", "request_changes", "comment"]),
      body: z.string(),
    }),
    {
      execute: async (action, ctx) => {
        const eventMap: Record<
          string,
          "APPROVE" | "REQUEST_CHANGES" | "COMMENT"
        > = {
          approve: "APPROVE",
          request_changes: "REQUEST_CHANGES",
          comment: "COMMENT",
        };

        const event = eventMap[action.decision];
        if (!event)
          throw new Error(`Invalid review decision: ${action.decision}`);

        await ctx.octokit.rest.pulls.createReview({
          owner: ctx.owner,
          repo: ctx.repo,
          pull_number: action.prNumber,
          event,
          body: action.body,
        });

        core.info(
          `Submitted ${action.decision} review on PR #${action.prNumber}`,
        );
        return { submitted: true, decision: action.decision };
      },
    },
  ),

  /** Remove a reviewer from a PR */
  removeReviewer: defAction(
    mkSchema("removeReviewer", {
      prNumber: z.number().int().positive(),
      reviewer: z.string().min(1),
    }),
    {
      execute: async (action, ctx) => {
        try {
          await ctx.octokit.rest.pulls.removeRequestedReviewers({
            owner: ctx.owner,
            repo: ctx.repo,
            pull_number: action.prNumber,
            reviewers: [action.reviewer],
          });

          core.info(
            `Removed reviewer ${action.reviewer} from PR #${action.prNumber}`,
          );
          return { removed: true };
        } catch (error) {
          if (error instanceof Error && error.message.includes("404")) {
            core.info(
              `Reviewer ${action.reviewer} was not a requested reviewer on PR #${action.prNumber}`,
            );
            return { removed: false };
          }
          throw error;
        }
      },
    },
  ),
};
