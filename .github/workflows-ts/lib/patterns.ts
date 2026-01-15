import type {
  GeneratedWorkflowTypes,
} from "@github-actions-workflow-ts/lib";

// Common workflow defaults
export const defaultDefaults: GeneratedWorkflowTypes.Defaults = {
  run: {
    shell: "bash",
  },
};

// =============================================
// Permission Utilities
// =============================================

/**
 * Composable permission objects for building workflow/job permissions.
 *
 * @example
 * ```ts
 * // Compose permissions using spread
 * const myPermissions = {
 *   ...permissions.contents.read,
 *   ...permissions.packages.write,
 *   ...permissions.idToken.write,
 * };
 * ```
 */
export const permissions = {
  contents: {
    read: { contents: "read" } as const,
    write: { contents: "write" } as const,
  },
  packages: {
    read: { packages: "read" } as const,
    write: { packages: "write" } as const,
  },
  attestations: {
    read: { attestations: "read" } as const,
    write: { attestations: "write" } as const,
  },
  idToken: {
    read: { "id-token": "read" } as const,
    write: { "id-token": "write" } as const,
  },
  pullRequests: {
    read: { "pull-requests": "read" } as const,
    write: { "pull-requests": "write" } as const,
  },
  issues: {
    read: { issues: "read" } as const,
    write: { issues: "write" } as const,
  },
  actions: {
    read: { actions: "read" } as const,
    write: { actions: "write" } as const,
  },
  discussions: {
    read: { discussions: "read" } as const,
    write: { discussions: "write" } as const,
  },
  statuses: {
    read: { statuses: "read" } as const,
    write: { statuses: "write" } as const,
  },
  checks: {
    read: { checks: "read" } as const,
    write: { checks: "write" } as const,
  },
  deployments: {
    read: { deployments: "read" } as const,
    write: { deployments: "write" } as const,
  },
  securityEvents: {
    read: { "security-events": "read" } as const,
    write: { "security-events": "write" } as const,
  },
  repositoryProjects: {
    read: { "repository-projects": "read" } as const,
    write: { "repository-projects": "write" } as const,
  },
  pages: {
    read: { pages: "read" } as const,
    write: { pages: "write" } as const,
  },
} as const;

// =============================================
// Common Permission Sets (using composable permissions)
// =============================================

// Empty permissions (workflow level)
export const emptyPermissions: GeneratedWorkflowTypes.PermissionsEvent = {};

export const readPermissions: GeneratedWorkflowTypes.PermissionsEvent = {
  ...permissions.contents.read,
};

export const buildPermissions: GeneratedWorkflowTypes.PermissionsEvent = {
  ...permissions.contents.read,
  ...permissions.packages.write,
  ...permissions.attestations.write,
  ...permissions.idToken.write,
};

export const testPermissions: GeneratedWorkflowTypes.PermissionsEvent = {
  ...permissions.contents.read,
  ...permissions.packages.read,
};

export const deployPermissions: GeneratedWorkflowTypes.PermissionsEvent = {
  ...permissions.contents.read,
  ...permissions.packages.write,
  ...permissions.attestations.write,
  ...permissions.idToken.write,
};

export const versionPermissions: GeneratedWorkflowTypes.PermissionsEvent = {
  ...permissions.contents.write,
  ...permissions.packages.read,
  ...permissions.pullRequests.write,
};

// =============================================
// Claude Automation Permissions
// =============================================

/**
 * Permissions for Claude issue loop workflow.
 * Needs write access to contents, issues, PRs for implementation.
 */
export const claudeIssuePermissions: GeneratedWorkflowTypes.PermissionsEvent = {
  ...permissions.contents.write,
  ...permissions.issues.write,
  ...permissions.pullRequests.write,
  ...permissions.idToken.write,
};

/**
 * Permissions for Claude CI loop workflow.
 * Needs write access to contents, PRs, issues, and actions.
 */
export const claudeCIPermissions: GeneratedWorkflowTypes.PermissionsEvent = {
  ...permissions.contents.write,
  ...permissions.pullRequests.write,
  ...permissions.issues.write,
  ...permissions.actions.write,
  ...permissions.idToken.write,
};

/**
 * Permissions for Claude review loop workflow.
 * Needs write access to contents, PRs, issues for review responses.
 */
export const claudeReviewPermissions: GeneratedWorkflowTypes.PermissionsEvent = {
  ...permissions.contents.write,
  ...permissions.pullRequests.write,
  ...permissions.issues.write,
  ...permissions.idToken.write,
};

/**
 * Permissions for stalled review detector workflow.
 * Read-only contents, write to PRs/issues for notifications.
 */
export const stalledReviewPermissions: GeneratedWorkflowTypes.PermissionsEvent = {
  ...permissions.contents.read,
  ...permissions.pullRequests.write,
  ...permissions.issues.write,
};

/**
 * Permissions for discussion automation workflows.
 * Needs write access to discussions and issues for responses.
 */
export const discussionPermissions: GeneratedWorkflowTypes.PermissionsEvent = {
  ...permissions.contents.write,
  ...permissions.discussions.write,
  ...permissions.issues.write,
  ...permissions.idToken.write,
};

/**
 * Permissions for discussion dispatcher (event routing).
 * Needs contents write for repository_dispatch.
 */
export const discussionDispatcherPermissions: GeneratedWorkflowTypes.PermissionsEvent = {
  ...permissions.contents.write,
  ...permissions.discussions.write,
};
