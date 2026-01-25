/**
 * Triage verification for E2E tests
 *
 * Waits for triage workflow to complete and verifies:
 * - Issue has "triaged" label
 * - Type/Priority/Topic labels set
 * - Project fields: Priority, Size, Estimate set
 * - Sub-issues created (if multi-phase)
 * - Status = Backlog
 */

import * as core from "@actions/core";
import type { TriageResult, TriageExpectation } from "./types.js";
import { pollUntil, DEFAULT_POLLER_CONFIG } from "./poller.js";

interface OctokitType {
  graphql: <T>(
    query: string,
    variables?: Record<string, unknown>,
  ) => Promise<T>;
  rest: {
    issues: {
      get: (params: {
        owner: string;
        repo: string;
        issue_number: number;
      }) => Promise<{ data: IssueData }>;
    };
  };
}

interface IssueData {
  state: string;
  labels: Array<string | { name?: string }>;
  body?: string;
  node_id: string;
}

interface TriageState {
  hasTriagedLabel: boolean;
  labels: string[];
  projectFields: {
    Priority?: string;
    Size?: string;
    Estimate?: number;
    Status?: string;
  };
  subIssueCount: number;
  issueState: string;
}

const GET_ISSUE_WITH_PROJECT_QUERY = `
query GetIssueWithProject($owner: String!, $repo: String!, $number: Int!, $projectNumber: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      id
      state
      labels(first: 50) {
        nodes {
          name
        }
      }
      projectItems(first: 10) {
        nodes {
          project {
            number
          }
          fieldValues(first: 20) {
            nodes {
              ... on ProjectV2ItemFieldSingleSelectValue {
                name
                field {
                  ... on ProjectV2SingleSelectField {
                    name
                  }
                }
              }
              ... on ProjectV2ItemFieldNumberValue {
                number
                field {
                  ... on ProjectV2Field {
                    name
                  }
                }
              }
              ... on ProjectV2ItemFieldTextValue {
                text
                field {
                  ... on ProjectV2Field {
                    name
                  }
                }
              }
            }
          }
        }
      }
      subIssues(first: 20) {
        totalCount
      }
    }
  }
}
`;

interface ProjectFieldValue {
  name?: string;
  number?: number;
  text?: string;
  field?: {
    name?: string;
  };
}

interface ProjectItem {
  project?: {
    number?: number;
  };
  fieldValues?: {
    nodes?: ProjectFieldValue[];
  };
}

interface IssueQueryResponse {
  repository?: {
    issue?: {
      id?: string;
      state?: string;
      labels?: {
        nodes?: Array<{ name?: string }>;
      };
      projectItems?: {
        nodes?: ProjectItem[];
      };
      subIssues?: {
        totalCount?: number;
      };
    };
  };
}

/**
 * Fetch current triage state from GitHub
 */
async function fetchTriageState(
  octokit: OctokitType,
  owner: string,
  repo: string,
  issueNumber: number,
  projectNumber: number,
): Promise<TriageState> {
  const response = await octokit.graphql<IssueQueryResponse>(
    GET_ISSUE_WITH_PROJECT_QUERY,
    {
      owner,
      repo,
      number: issueNumber,
      projectNumber,
    },
  );

  const issue = response.repository?.issue;
  if (!issue) {
    return {
      hasTriagedLabel: false,
      labels: [],
      projectFields: {},
      subIssueCount: 0,
      issueState: "unknown",
    };
  }

  const labels =
    issue.labels?.nodes?.map((l) => l.name || "").filter(Boolean) || [];
  const hasTriagedLabel = labels.includes("triaged");

  // Extract project fields for our project
  const projectFields: TriageState["projectFields"] = {};
  const projectItem = issue.projectItems?.nodes?.find(
    (item) => item.project?.number === projectNumber,
  );

  if (projectItem?.fieldValues?.nodes) {
    for (const fieldValue of projectItem.fieldValues.nodes) {
      const fieldName = fieldValue.field?.name;
      if (!fieldName) continue;

      if (fieldName === "Priority" && fieldValue.name) {
        projectFields.Priority = fieldValue.name;
      } else if (fieldName === "Size" && fieldValue.name) {
        projectFields.Size = fieldValue.name;
      } else if (
        fieldName === "Estimate" &&
        typeof fieldValue.number === "number"
      ) {
        projectFields.Estimate = fieldValue.number;
      } else if (fieldName === "Status" && fieldValue.name) {
        projectFields.Status = fieldValue.name;
      }
    }
  }

  return {
    hasTriagedLabel,
    labels,
    projectFields,
    subIssueCount: issue.subIssues?.totalCount || 0,
    issueState: issue.state || "unknown",
  };
}

/**
 * Check if triage conditions are met
 */
function isTriageComplete(state: TriageState): boolean {
  // Minimum requirement: has "triaged" label
  return state.hasTriagedLabel;
}

/**
 * Verify triage results against expectations
 */
function verifyTriageExpectations(
  state: TriageState,
  expectations: TriageExpectation | undefined,
): string[] {
  const errors: string[] = [];

  if (!expectations) {
    // No specific expectations, just check that triage completed
    if (!state.hasTriagedLabel) {
      errors.push('Issue does not have "triaged" label');
    }
    return errors;
  }

  // Check expected labels
  if (expectations.labels) {
    for (const expectedLabel of expectations.labels) {
      if (!state.labels.includes(expectedLabel)) {
        errors.push(
          `Missing expected label: ${expectedLabel} (found: ${state.labels.join(", ")})`,
        );
      }
    }
  }

  // Check project fields
  if (expectations.project_fields) {
    const pf = expectations.project_fields;

    if (pf.Priority && state.projectFields.Priority !== pf.Priority) {
      errors.push(
        `Priority mismatch: expected ${pf.Priority}, got ${state.projectFields.Priority || "unset"}`,
      );
    }

    if (pf.Size && state.projectFields.Size !== pf.Size) {
      errors.push(
        `Size mismatch: expected ${pf.Size}, got ${state.projectFields.Size || "unset"}`,
      );
    }

    if (pf.Estimate !== undefined) {
      if (state.projectFields.Estimate === undefined) {
        errors.push(`Estimate not set, expected ${pf.Estimate}`);
      } else if (state.projectFields.Estimate !== pf.Estimate) {
        errors.push(
          `Estimate mismatch: expected ${pf.Estimate}, got ${state.projectFields.Estimate}`,
        );
      }
    }

    if (pf.Status && state.projectFields.Status !== pf.Status) {
      errors.push(
        `Status mismatch: expected ${pf.Status}, got ${state.projectFields.Status || "unset"}`,
      );
    }
  }

  // Check sub-issue count
  if (expectations.sub_issue_count !== undefined) {
    if (state.subIssueCount !== expectations.sub_issue_count) {
      errors.push(
        `Sub-issue count mismatch: expected ${expectations.sub_issue_count}, got ${state.subIssueCount}`,
      );
    }
  }

  return errors;
}

interface WaitForTriageOptions {
  octokit: OctokitType;
  owner: string;
  repo: string;
  issueNumber: number;
  projectNumber: number;
  timeoutMs?: number;
  pollIntervalMs?: number;
  expectations?: TriageExpectation;
}

/**
 * Wait for triage to complete and verify results
 */
export async function waitForTriage(
  options: WaitForTriageOptions,
): Promise<TriageResult> {
  const {
    octokit,
    owner,
    repo,
    issueNumber,
    projectNumber,
    timeoutMs = 300000, // 5 minutes default
    pollIntervalMs = 10000, // 10 seconds default
    expectations,
  } = options;

  const startTime = Date.now();

  core.info(`Waiting for triage to complete on issue #${issueNumber}...`);
  core.info(
    `Timeout: ${timeoutMs / 1000}s, Poll interval: ${pollIntervalMs / 1000}s`,
  );

  const pollResult = await pollUntil<TriageState>(
    () => fetchTriageState(octokit, owner, repo, issueNumber, projectNumber),
    isTriageComplete,
    {
      ...DEFAULT_POLLER_CONFIG,
      initialIntervalMs: pollIntervalMs,
      maxIntervalMs: pollIntervalMs * 3,
      timeoutMs,
    },
    (state, attempt, elapsed) => {
      const c = (ok: boolean) => (ok ? "✅" : "⬜");

      // Compact single-line format showing what's done
      core.info(
        `[${attempt}] ${Math.round(elapsed / 1000)}s | ` +
          `triaged:${c(state.hasTriagedLabel)} ` +
          `status:${c(!!state.projectFields.Status)}${state.projectFields.Status ? `(${state.projectFields.Status})` : ""} ` +
          `priority:${c(!!state.projectFields.Priority)} ` +
          `size:${c(!!state.projectFields.Size)} ` +
          `estimate:${c(state.projectFields.Estimate !== undefined)} ` +
          `subs:${state.subIssueCount}`,
      );
    },
  );

  const duration = Date.now() - startTime;

  if (!pollResult.success || !pollResult.data) {
    const finalState = pollResult.data;

    // Log detailed failure state
    core.error(
      `\n╔══════════════════════════════════════════════════════════════╗`,
    );
    core.error(
      `║  TRIAGE TIMEOUT - Final State                                 ║`,
    );
    core.error(
      `╚══════════════════════════════════════════════════════════════╝`,
    );
    core.error(
      `  Duration: ${Math.round(duration / 1000)}s (timeout: ${timeoutMs / 1000}s)`,
    );
    core.error(
      `  Triaged label: ${finalState?.hasTriagedLabel ? "✅ present" : "❌ MISSING"}`,
    );
    core.error(`  Labels: ${finalState?.labels?.join(", ") || "(none)"}`);
    core.error(`  Issue state: ${finalState?.issueState || "unknown"}`);
    core.error(`  Sub-issues: ${finalState?.subIssueCount || 0}`);
    core.error(`  Project fields:`);
    core.error(
      `    Status: ${finalState?.projectFields?.Status || "(not set)"}`,
    );
    core.error(
      `    Priority: ${finalState?.projectFields?.Priority || "(not set)"}`,
    );
    core.error(`    Size: ${finalState?.projectFields?.Size || "(not set)"}`);
    core.error(
      `    Estimate: ${finalState?.projectFields?.Estimate !== undefined ? finalState.projectFields.Estimate : "(not set)"}`,
    );

    return {
      success: false,
      labels: finalState?.labels || [],
      project_fields: finalState?.projectFields || {},
      sub_issue_count: finalState?.subIssueCount || 0,
      errors: [
        "Triage did not complete within timeout - 'triaged' label was never added",
      ],
      duration_ms: duration,
    };
  }

  const state = pollResult.data;

  // Verify expectations
  const errors = verifyTriageExpectations(state, expectations);

  // Log final state summary
  core.info(
    `\n╔══════════════════════════════════════════════════════════════╗`,
  );
  core.info(
    `║  TRIAGE ${errors.length === 0 ? "COMPLETE ✅" : "FAILED ❌"}                                         ║`,
  );
  core.info(`╚══════════════════════════════════════════════════════════════╝`);
  core.info(`  Duration: ${Math.round(duration / 1000)}s`);
  core.info(`  Labels: ${state.labels.join(", ")}`);
  core.info(`  Sub-issues created: ${state.subIssueCount}`);
  core.info(`  Project fields:`);
  core.info(`    Status: ${state.projectFields.Status || "(not set)"}`);
  core.info(`    Priority: ${state.projectFields.Priority || "(not set)"}`);
  core.info(`    Size: ${state.projectFields.Size || "(not set)"}`);
  core.info(
    `    Estimate: ${state.projectFields.Estimate !== undefined ? state.projectFields.Estimate : "(not set)"}`,
  );

  if (errors.length > 0) {
    core.error(`\n  Verification errors (${errors.length}):`);
    for (const error of errors) {
      core.error(`    ❌ ${error}`);
    }
  }

  return {
    success: errors.length === 0,
    labels: state.labels,
    project_fields: state.projectFields,
    sub_issue_count: state.subIssueCount,
    errors,
    duration_ms: duration,
  };
}
