import { Step } from '@github-actions-workflow-ts/lib'

/**
 * Helper to create a step that runs an external shell script
 */
export function runScript(
  name: string,
  scriptPath: string,
  opts?: {
    id?: string
    env?: Record<string, string>
    if?: string
  }
): Step {
  return new Step({
    name,
    ...(opts?.id && { id: opts.id }),
    ...(opts?.if && { if: opts.if }),
    ...(opts?.env && { env: opts.env }),
    run: `bash .github/scripts/${scriptPath}`,
  })
}

// Pre-defined script steps for common operations
export const scripts = {
  // =============================================
  // CI Loop Scripts
  // =============================================
  findPRForBranch: (
    id: string,
    env: {
      GH_TOKEN: string
      HEAD_BRANCH: string
      INPUT_PR_NUMBER?: string
      INPUT_CONCLUSION?: string
    }
  ) =>
    runScript('Find PR and check details', 'find-pr-for-branch.sh', {
      id,
      env: env as Record<string, string>,
    }),

  convertPRToDraft: (env: { GH_TOKEN: string; HEAD_BRANCH: string }) =>
    runScript('Find and convert PR to draft', 'convert-pr-to-draft.sh', { env }),

  checkClaudeCommentCount: (env: { GH_TOKEN: string; PR_NUMBER: string }) =>
    runScript('Check Claude comment count', 'check-claude-comment-count.sh', { env }),

  checkUnresolvedComments: (id: string, env: { GH_TOKEN: string; PR_NUMBER: string }) =>
    runScript('Check for unresolved comments', 'check-unresolved-comments.sh', {
      id,
      env: {
        ...env,
        GITHUB_REPOSITORY_OWNER: '${{ github.repository_owner }}',
      },
    }),

  updateProjectStatus: (env: {
    GH_TOKEN: string
    ISSUE_NUMBER: string
    TARGET_STATUS: string
  }) =>
    runScript('Update project status', 'update-project-status.sh', {
      env: {
        ...env,
        GITHUB_REPOSITORY_OWNER: '${{ github.repository_owner }}',
      },
    }),

  prReadyForReview: (env: { GH_TOKEN: string; PR_NUMBER: string }) =>
    runScript('Convert PR to ready and request nopo-bot review', 'pr-ready-for-review.sh', {
      env,
    }),

  // =============================================
  // Issue Loop Scripts (Triage)
  // =============================================
  checkSubIssue: (id: string, env: { GH_TOKEN: string; ISSUE_NUMBER: string }) =>
    runScript('Check if sub-issue', 'check-sub-issue.sh', { id, env }),

  applyTriageLabels: (env: { GH_TOKEN: string; ISSUE_NUMBER: string }) =>
    runScript('Apply labels and project fields from triage output', 'apply-triage-labels.sh', {
      env: {
        ...env,
        GITHUB_REPOSITORY_OWNER: '${{ github.repository_owner }}',
      },
    }),

  // =============================================
  // Issue Loop Scripts (Implementation)
  // =============================================
  checkTriagedLabel: (env: { GH_TOKEN: string; ISSUE_NUMBER: string }) =>
    runScript('Check triaged label', 'check-triaged-label.sh', { env }),

  checkProjectStatusForImpl: (env: { GH_TOKEN: string; ISSUE_NUMBER: string }) =>
    runScript('Check project status allows implementation', 'check-project-status-for-impl.sh', {
      env: {
        ...env,
        GITHUB_REPOSITORY_OWNER: '${{ github.repository_owner }}',
      },
    }),

  getIssueWithComments: (id: string, env: { GH_TOKEN: string; ISSUE_NUMBER: string }) =>
    runScript('Get issue with comments', 'get-issue-with-comments.sh', { id, env }),

  addBotComment: (
    id: string,
    env: { GH_TOKEN: string; ISSUE_NUMBER?: string; PR_NUMBER?: string; MESSAGE: string; RUN_URL: string }
  ) =>
    runScript('Add bot status comment', 'add-bot-comment.sh', { id, env: env as Record<string, string> }),

  checkExistingPR: (id: string, env: { GH_TOKEN: string; ISSUE_NUMBER: string }) =>
    runScript('Check if PR already exists', 'check-existing-pr.sh', { id, env }),

  updateProjectStatusInProgress: (env: { GH_TOKEN: string; ISSUE_NUMBER: string }) =>
    runScript('Update project status to In Progress', 'update-project-status-in-progress.sh', {
      env: {
        ...env,
        GITHUB_REPOSITORY_OWNER: '${{ github.repository_owner }}',
      },
    }),

  createOrCheckoutBranch: (id: string, env: { BRANCH_NAME: string }) =>
    runScript('Create or checkout branch', 'create-or-checkout-branch.sh', { id, env }),

  salvagePartialProgress: (
    env: {
      GH_TOKEN: string
      ISSUE_NUMBER: string
      JOB_STATUS: string
      BRANCH_NAME: string
      GITHUB_SERVER_URL: string
      GITHUB_REPOSITORY: string
    },
    ifCondition?: string
  ) =>
    runScript('Salvage partial progress', 'salvage-partial-progress.sh', {
      env,
      if: ifCondition,
    }),

  unassignNopoBot: (env: { GH_TOKEN: string; ISSUE_NUMBER: string }, ifCondition?: string) =>
    runScript('Unassign nopo-bot on failure', 'unassign-nopo-bot.sh', { env, if: ifCondition }),

  // =============================================
  // Issue Loop Scripts (Comments)
  // =============================================
  getPRBranch: (id: string, env: { GH_TOKEN: string; IS_PR: string; PR_NUMBER: string }) =>
    runScript('Get PR branch (if PR comment)', 'get-pr-branch.sh', { id, env }),

  // =============================================
  // Review Loop Scripts
  // =============================================
  extractLinkedIssue: (id: string, env: { GH_TOKEN: string; PR_NUMBER: string }) =>
    runScript('Extract linked issue', 'extract-linked-issue.sh', { id, env }),

  updateProjectStatusInReview: (env: { GH_TOKEN: string; ISSUE_NUMBER: string }) =>
    runScript('Update project status to In review', 'update-project-status-in-review.sh', {
      env: {
        ...env,
        GITHUB_REPOSITORY_OWNER: '${{ github.repository_owner }}',
      },
    }),

  checkClaudeAuthoredPR: (id: string, env: { GH_TOKEN: string; PR_NUMBER: string }) =>
    runScript('Check if PR is Claude-authored', 'check-claude-authored-pr.sh', { id, env }),

  // =============================================
  // Stalled Review Scripts
  // =============================================
  detectStalledReviews: (env: { GH_TOKEN: string; DRY_RUN: string }) =>
    runScript('Check for stalled review requests', 'detect-stalled-reviews.sh', { env }),

  // =============================================
  // Common Scripts
  // =============================================
  addReaction: (
    env: { GH_TOKEN: string; COMMENT_ID: string; SUCCESS: string },
    ifCondition?: string
  ) =>
    runScript('Add reaction on completion', 'add-reaction.sh', { env, if: ifCondition }),
}
