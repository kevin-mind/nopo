// Common workflow defaults
export const defaultDefaults = {
  run: {
    shell: 'bash' as const,
  },
}

// Common permissions
export const readPermissions = {
  contents: 'read' as const,
}

export const buildPermissions = {
  packages: 'write' as const,
  contents: 'read' as const,
  attestations: 'write' as const,
  'id-token': 'write' as const,
}

export const testPermissions = {
  packages: 'read' as const,
  contents: 'read' as const,
}

export const deployPermissions = {
  contents: 'read' as const,
  packages: 'write' as const,
  attestations: 'write' as const,
  'id-token': 'write' as const,
}

export const versionPermissions = {
  contents: 'write' as const,
  packages: 'read' as const,
  'pull-requests': 'write' as const,
}

// Empty permissions (workflow level)
export const emptyPermissions = {}

// =============================================
// Claude Automation Permissions
// =============================================

/**
 * Permissions for Claude issue loop workflow.
 * Needs write access to contents, issues, PRs for implementation.
 */
export const claudeIssuePermissions = {
  contents: 'write' as const,
  issues: 'write' as const,
  'pull-requests': 'write' as const,
  'id-token': 'write' as const,
}

/**
 * Permissions for Claude CI loop workflow.
 * Needs write access to contents, PRs, issues, and actions.
 */
export const claudeCIPermissions = {
  contents: 'write' as const,
  'pull-requests': 'write' as const,
  issues: 'write' as const,
  actions: 'write' as const,
  'id-token': 'write' as const,
}

/**
 * Permissions for Claude review loop workflow.
 * Needs write access to contents, PRs, issues for review responses.
 */
export const claudeReviewPermissions = {
  contents: 'write' as const,
  'pull-requests': 'write' as const,
  issues: 'write' as const,
  'id-token': 'write' as const,
}

/**
 * Permissions for stalled review detector workflow.
 * Read-only contents, write to PRs/issues for notifications.
 */
export const stalledReviewPermissions = {
  contents: 'read' as const,
  'pull-requests': 'write' as const,
  issues: 'write' as const,
}

/**
 * Permissions for discussion automation workflows.
 * Needs write access to discussions and issues for responses.
 */
export const discussionPermissions = {
  contents: 'write' as const,
  discussions: 'write' as const,
  issues: 'write' as const,
  'id-token': 'write' as const,
}

/**
 * Permissions for discussion dispatcher (event routing).
 * Needs contents write for repository_dispatch.
 */
export const discussionDispatcherPermissions = {
  contents: 'write' as const,
  discussions: 'write' as const,
}
