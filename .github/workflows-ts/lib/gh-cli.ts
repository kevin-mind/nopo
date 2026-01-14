/**
 * Type-safe wrappers for GitHub CLI commands.
 *
 * These functions generate bash command strings that can be composed
 * into workflow steps. They provide type safety at build time while
 * producing valid shell commands at runtime.
 */

import { Step } from "@github-actions-workflow-ts/lib";

// =============================================================================
// gh api graphql
// =============================================================================

/**
 * Arguments for gh api graphql command.
 * Based on: gh api graphql --help
 */
export interface GhApiGraphqlArgs {
  /** The GraphQL query or mutation string */
  query: string;
  /** String variables passed via -f (raw field) */
  rawFields?: Record<string, string>;
  /** Typed variables passed via -F (field) - for integers, booleans, placeholders */
  fields?: Record<string, string | number | boolean>;
  /** JQ query to filter response (-q/--jq) */
  jq?: string;
  /** Silence output (--silent) */
  silent?: boolean;
  /** Custom hostname (--hostname) */
  hostname?: string;
  /** HTTP headers (-H/--header) */
  headers?: Record<string, string>;
  /** Paginate results (--paginate) */
  paginate?: boolean;
}

/**
 * Generate a gh api graphql command string.
 *
 * @example
 * ```typescript
 * ghApiGraphql({
 *   query: `query($owner: String!, $repo: String!) {
 *     repository(owner: $owner, name: $repo) { id }
 *   }`,
 *   rawFields: { owner: "$OWNER", repo: "$REPO" },
 * })
 * // => gh api graphql -f query='...' -f owner="$OWNER" -f repo="$REPO"
 * ```
 */
export function ghApiGraphql(args: GhApiGraphqlArgs): string {
  const parts: string[] = ["gh api graphql"];

  // Query (always required, passed as -f)
  // Use heredoc for multiline queries to handle special characters
  const queryEscaped = args.query.replace(/'/g, "'\\''");
  parts.push(`-f query='${queryEscaped}'`);

  // Raw fields (-f) - string values
  if (args.rawFields) {
    for (const [key, value] of Object.entries(args.rawFields)) {
      parts.push(`-f ${key}="${value}"`);
    }
  }

  // Typed fields (-F) - integers, booleans, placeholders
  if (args.fields) {
    for (const [key, value] of Object.entries(args.fields)) {
      if (typeof value === "number") {
        parts.push(`-F ${key}=${value}`);
      } else if (typeof value === "boolean") {
        parts.push(`-F ${key}=${value}`);
      } else {
        // String with placeholder like {owner}
        parts.push(`-F ${key}="${value}"`);
      }
    }
  }

  // JQ filter
  if (args.jq) {
    const jqEscaped = args.jq.replace(/'/g, "'\\''");
    parts.push(`-q '${jqEscaped}'`);
  }

  // Silent mode
  if (args.silent) {
    parts.push("--silent");
  }

  // Hostname
  if (args.hostname) {
    parts.push(`--hostname "${args.hostname}"`);
  }

  // Headers
  if (args.headers) {
    for (const [key, value] of Object.entries(args.headers)) {
      parts.push(`-H "${key}: ${value}"`);
    }
  }

  // Paginate
  if (args.paginate) {
    parts.push("--paginate");
  }

  return parts.join(" \\\n  ");
}

/**
 * Generate a Step that runs gh api graphql.
 */
export function ghApiGraphqlStep(
  name: string,
  args: GhApiGraphqlArgs,
  opts?: {
    id?: string;
    env?: Record<string, string>;
    if?: string;
    /** Variable name to capture output (result=$(cmd)) */
    outputVar?: string;
    /** Additional script after the command */
    postScript?: string;
  },
): Step {
  let script = ghApiGraphql(args);

  if (opts?.outputVar) {
    script = `${opts.outputVar}=$(${script})`;
  }

  if (opts?.postScript) {
    script = `${script}\n\n${opts.postScript}`;
  }

  return new Step({
    name,
    ...(opts?.id && { id: opts.id }),
    ...(opts?.if && { if: opts.if }),
    ...(opts?.env && { env: opts.env }),
    run: script,
  });
}

// =============================================================================
// gh issue
// =============================================================================

export interface GhIssueEditArgs {
  /** Issue number (can be env var like $ISSUE_NUMBER) */
  issue: string;
  /** Labels to add */
  addLabels?: string[];
  /** Labels to remove */
  removeLabels?: string[];
  /** Assignees to add */
  addAssignees?: string[];
  /** Assignees to remove */
  removeAssignees?: string[];
  /** New title */
  title?: string;
  /** New body */
  body?: string;
  /** Milestone to set */
  milestone?: string;
}

/**
 * Generate a gh issue edit command string.
 */
export function ghIssueEdit(args: GhIssueEditArgs): string {
  const parts: string[] = [`gh issue edit "${args.issue}"`];

  if (args.addLabels?.length) {
    parts.push(`--add-label "${args.addLabels.join(",")}"`);
  }
  if (args.removeLabels?.length) {
    parts.push(`--remove-label "${args.removeLabels.join(",")}"`);
  }
  if (args.addAssignees?.length) {
    parts.push(`--add-assignee "${args.addAssignees.join(",")}"`);
  }
  if (args.removeAssignees?.length) {
    parts.push(`--remove-assignee "${args.removeAssignees.join(",")}"`);
  }
  if (args.title) {
    parts.push(`--title "${args.title}"`);
  }
  if (args.body) {
    parts.push(`--body "${args.body}"`);
  }
  if (args.milestone) {
    parts.push(`--milestone "${args.milestone}"`);
  }

  return parts.join(" \\\n  ");
}

export interface GhIssueViewArgs {
  /** Issue number */
  issue: string;
  /** JSON fields to output */
  json?: string[];
  /** JQ query for JSON output */
  jq?: string;
  /** Include comments */
  comments?: boolean;
}

/**
 * Generate a gh issue view command string.
 */
export function ghIssueView(args: GhIssueViewArgs): string {
  const parts: string[] = [`gh issue view "${args.issue}"`];

  if (args.json?.length) {
    parts.push(`--json "${args.json.join(",")}"`);
  }
  if (args.jq) {
    parts.push(`--jq '${args.jq}'`);
  }
  if (args.comments) {
    parts.push("--comments");
  }

  return parts.join(" ");
}

// =============================================================================
// gh label
// =============================================================================

export interface GhLabelCreateArgs {
  /** Label name */
  name: string;
  /** Label color (hex without #) */
  color?: string;
  /** Label description */
  description?: string;
  /** Force update if exists */
  force?: boolean;
}

/**
 * Generate a gh label create command string.
 */
export function ghLabelCreate(args: GhLabelCreateArgs): string {
  const parts: string[] = [`gh label create "${args.name}"`];

  if (args.color) {
    parts.push(`--color "${args.color}"`);
  }
  if (args.description) {
    parts.push(`--description "${args.description}"`);
  }
  if (args.force) {
    parts.push("--force");
  }

  return parts.join(" ");
}

export interface GhLabelListArgs {
  /** Search query */
  search?: string;
  /** JSON fields to output */
  json?: string[];
  /** JQ query for JSON output */
  jq?: string;
  /** Limit results */
  limit?: number;
}

/**
 * Generate a gh label list command string.
 */
export function ghLabelList(args: GhLabelListArgs = {}): string {
  const parts: string[] = ["gh label list"];

  if (args.search) {
    parts.push(`--search "${args.search}"`);
  }
  if (args.json?.length) {
    parts.push(`--json "${args.json.join(",")}"`);
  }
  if (args.jq) {
    parts.push(`--jq '${args.jq}'`);
  }
  if (args.limit) {
    parts.push(`--limit ${args.limit}`);
  }

  return parts.join(" ");
}

// =============================================================================
// gh pr
// =============================================================================

export interface GhPrEditArgs {
  /** PR number (can be env var) */
  pr: string;
  /** Labels to add */
  addLabels?: string[];
  /** Labels to remove */
  removeLabels?: string[];
  /** Reviewers to add */
  addReviewers?: string[];
  /** Reviewers to remove */
  removeReviewers?: string[];
  /** Title */
  title?: string;
  /** Body */
  body?: string;
  /** Base branch */
  base?: string;
}

/**
 * Generate a gh pr edit command string.
 */
export function ghPrEdit(args: GhPrEditArgs): string {
  const parts: string[] = [`gh pr edit "${args.pr}"`];

  if (args.addLabels?.length) {
    parts.push(`--add-label "${args.addLabels.join(",")}"`);
  }
  if (args.removeLabels?.length) {
    parts.push(`--remove-label "${args.removeLabels.join(",")}"`);
  }
  if (args.addReviewers?.length) {
    parts.push(`--add-reviewer "${args.addReviewers.join(",")}"`);
  }
  if (args.removeReviewers?.length) {
    parts.push(`--remove-reviewer "${args.removeReviewers.join(",")}"`);
  }
  if (args.title) {
    parts.push(`--title "${args.title}"`);
  }
  if (args.body) {
    parts.push(`--body "${args.body}"`);
  }
  if (args.base) {
    parts.push(`--base "${args.base}"`);
  }

  return parts.join(" \\\n  ");
}

export interface GhPrViewArgs {
  /** PR number or branch */
  pr: string;
  /** JSON fields to output */
  json?: string[];
  /** JQ query for JSON output */
  jq?: string;
  /** Include comments */
  comments?: boolean;
}

/**
 * Generate a gh pr view command string.
 */
export function ghPrView(args: GhPrViewArgs): string {
  const parts: string[] = [`gh pr view "${args.pr}"`];

  if (args.json?.length) {
    parts.push(`--json "${args.json.join(",")}"`);
  }
  if (args.jq) {
    parts.push(`--jq '${args.jq}'`);
  }
  if (args.comments) {
    parts.push("--comments");
  }

  return parts.join(" ");
}

export interface GhPrReadyArgs {
  /** PR number */
  pr: string;
  /** Undo (convert to draft) */
  undo?: boolean;
}

/**
 * Generate a gh pr ready command string.
 */
export function ghPrReady(args: GhPrReadyArgs): string {
  const parts: string[] = [`gh pr ready "${args.pr}"`];

  if (args.undo) {
    parts.push("--undo");
  }

  return parts.join(" ");
}

// =============================================================================
// Common GraphQL queries/mutations as typed functions
// =============================================================================

/**
 * GraphQL query to get issue's project item info.
 */
export const QUERY_ISSUE_PROJECT_ITEM = `
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      projectItems(first: 1) {
        nodes { id project { id } }
      }
    }
  }
}
`.trim();

/**
 * GraphQL mutation to update a project field (single select).
 */
export const MUTATION_UPDATE_PROJECT_SINGLE_SELECT = `
mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
  updateProjectV2ItemFieldValue(input: {
    projectId: $projectId, itemId: $itemId, fieldId: $fieldId,
    value: { singleSelectOptionId: $optionId }
  }) { projectV2Item { id } }
}
`.trim();

/**
 * GraphQL mutation to update a project field (number).
 */
export const MUTATION_UPDATE_PROJECT_NUMBER = `
mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $number: Float!) {
  updateProjectV2ItemFieldValue(input: {
    projectId: $projectId, itemId: $itemId, fieldId: $fieldId,
    value: { number: $number }
  }) { projectV2Item { id } }
}
`.trim();

/**
 * GraphQL mutation to update a project field (text).
 */
export const MUTATION_UPDATE_PROJECT_TEXT = `
mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $text: String!) {
  updateProjectV2ItemFieldValue(input: {
    projectId: $projectId, itemId: $itemId, fieldId: $fieldId,
    value: { text: $text }
  }) { projectV2Item { id } }
}
`.trim();

/**
 * GraphQL mutation to update a project field (status - single select).
 */
export const MUTATION_UPDATE_PROJECT_STATUS = `
mutation($projectId: ID!, $itemId: ID!, $statusFieldId: ID!, $optionId: String!) {
  updateProjectV2ItemFieldValue(input: {
    projectId: $projectId, itemId: $itemId, fieldId: $statusFieldId,
    value: { singleSelectOptionId: $optionId }
  }) { projectV2Item { id } }
}
`.trim();
