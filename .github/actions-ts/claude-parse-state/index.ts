import * as core from "@actions/core";
import * as github from "@actions/github";
import {
  getRequiredInput,
  getOptionalInput,
  setOutputs,
} from "../lib/index.js";

/**
 * Project field state - stored in GitHub Project custom fields
 * Only 3 fields are stored, everything else is derived
 */
interface ProjectState {
  status: ProjectStatus;
  iteration: number;
  failures: number;
}

/**
 * Status values for parent issues and sub-issues
 * Parent issues use: Backlog, In Progress, Done, Blocked, Error
 * Sub-issues use: Ready, Working, Review, Done
 */
type ProjectStatus =
  | "Backlog"
  | "In Progress"
  | "Ready"
  | "Working"
  | "Review"
  | "Done"
  | "Blocked"
  | "Error";

/**
 * Sub-issue info for phase tracking
 */
interface SubIssueInfo {
  number: number;
  title: string;
  status: ProjectStatus;
  state: "open" | "closed";
}

const HISTORY_SECTION = "## Iteration History";

// GraphQL queries and mutations for Project V2 fields
const GET_PROJECT_ITEM_QUERY = `
query GetProjectItem($org: String!, $projectNumber: Int!, $issueNumber: Int!, $repo: String!) {
  repository(owner: $org, name: $repo) {
    issue(number: $issueNumber) {
      id
      number
      title
      body
      state
      projectItems(first: 10) {
        nodes {
          id
          project {
            id
            number
          }
          fieldValues(first: 20) {
            nodes {
              ... on ProjectV2ItemFieldSingleSelectValue {
                name
                field {
                  ... on ProjectV2SingleSelectField {
                    name
                    id
                    options {
                      id
                      name
                    }
                  }
                }
              }
              ... on ProjectV2ItemFieldNumberValue {
                number
                field {
                  ... on ProjectV2Field {
                    name
                    id
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  organization(login: $org) {
    projectV2(number: $projectNumber) {
      id
      fields(first: 20) {
        nodes {
          ... on ProjectV2SingleSelectField {
            id
            name
            options {
              id
              name
            }
          }
          ... on ProjectV2Field {
            id
            name
            dataType
          }
        }
      }
    }
  }
}
`;

const UPDATE_PROJECT_FIELD_MUTATION = `
mutation UpdateProjectField($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: ProjectV2FieldValue!) {
  updateProjectV2ItemFieldValue(input: {
    projectId: $projectId
    itemId: $itemId
    fieldId: $fieldId
    value: $value
  }) {
    projectV2Item {
      id
    }
  }
}
`;

const GET_SUB_ISSUES_QUERY = `
query GetSubIssues($org: String!, $repo: String!, $parentNumber: Int!) {
  repository(owner: $org, name: $repo) {
    issue(number: $parentNumber) {
      id
      subIssues(first: 20) {
        nodes {
          id
          number
          title
          state
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
                }
              }
            }
          }
        }
      }
    }
  }
}
`;

const ADD_ISSUE_TO_PROJECT_MUTATION = `
mutation AddIssueToProject($projectId: ID!, $contentId: ID!) {
  addProjectV2ItemById(input: {
    projectId: $projectId
    contentId: $contentId
  }) {
    item {
      id
    }
  }
}
`;

/**
 * Parse project state from GraphQL response
 */
function parseProjectStateFromResponse(
  projectItems: unknown[],
  projectNumber: number,
): ProjectState | null {
  // Find the project item for our project
  interface ProjectItem {
    project?: { number?: number; id?: string };
    fieldValues?: { nodes?: unknown[] };
    id?: string;
  }

  const projectItem = (projectItems as ProjectItem[]).find(
    (item) => item.project?.number === projectNumber,
  );

  if (!projectItem) {
    return null;
  }

  const state: ProjectState = {
    status: "Backlog",
    iteration: 0,
    failures: 0,
  };

  interface FieldValue {
    name?: string;
    number?: number;
    field?: { name?: string };
  }

  const fieldValues = (projectItem.fieldValues?.nodes || []) as FieldValue[];
  for (const fieldValue of fieldValues) {
    const fieldName = fieldValue.field?.name;
    if (fieldName === "Status" && fieldValue.name) {
      state.status = fieldValue.name as ProjectStatus;
    } else if (
      fieldName === "Iteration" &&
      typeof fieldValue.number === "number"
    ) {
      state.iteration = fieldValue.number;
    } else if (
      fieldName === "Failures" &&
      typeof fieldValue.number === "number"
    ) {
      state.failures = fieldValue.number;
    }
  }

  return state;
}

/**
 * Get project field IDs and option IDs from the project schema
 */
interface ProjectFields {
  projectId: string;
  statusFieldId: string;
  statusOptions: Record<string, string>;
  iterationFieldId: string;
  failuresFieldId: string;
}

function parseProjectFields(projectData: unknown): ProjectFields | null {
  interface Field {
    id?: string;
    name?: string;
    options?: Array<{ id: string; name: string }>;
    dataType?: string;
  }

  interface Project {
    id?: string;
    fields?: { nodes?: Field[] };
  }

  const project = projectData as Project;
  if (!project?.id || !project?.fields?.nodes) {
    return null;
  }

  const fields: ProjectFields = {
    projectId: project.id,
    statusFieldId: "",
    statusOptions: {},
    iterationFieldId: "",
    failuresFieldId: "",
  };

  for (const field of project.fields.nodes) {
    if (field.name === "Status" && field.options) {
      fields.statusFieldId = field.id || "";
      for (const option of field.options) {
        fields.statusOptions[option.name] = option.id;
      }
    } else if (field.name === "Iteration") {
      fields.iterationFieldId = field.id || "";
    } else if (field.name === "Failures") {
      fields.failuresFieldId = field.id || "";
    }
  }

  return fields;
}

/**
 * Case-insensitive lookup for status options
 */
function findStatusOption(
  statusOptions: Record<string, string>,
  status: string,
): string | undefined {
  // Try exact match first
  if (statusOptions[status]) {
    return statusOptions[status];
  }
  // Try case-insensitive match
  const lowerStatus = status.toLowerCase();
  for (const [name, id] of Object.entries(statusOptions)) {
    if (name.toLowerCase() === lowerStatus) {
      return id;
    }
  }
  return undefined;
}

/**
 * Get project item ID for an issue
 */
function getProjectItemId(
  projectItems: unknown[],
  projectNumber: number,
): string | null {
  interface ProjectItem {
    id?: string;
    project?: { number?: number };
  }

  const projectItem = (projectItems as ProjectItem[]).find(
    (item) => item.project?.number === projectNumber,
  );
  return projectItem?.id || null;
}

/**
 * Add entry to iteration history table in parent issue body
 */
function addIterationLogEntry(
  body: string,
  iteration: number,
  phase: number | string,
  message: string,
  sha?: string,
  runLink?: string,
): string {
  const historyIdx = body.indexOf(HISTORY_SECTION);

  // Format SHA as a full GitHub link if provided
  const serverUrl = process.env.GITHUB_SERVER_URL || "https://github.com";
  const repo = process.env.GITHUB_REPOSITORY || "";
  const shaCell = sha
    ? `[\`${sha.slice(0, 7)}\`](${serverUrl}/${repo}/commit/${sha})`
    : "-";
  // Format run link if provided
  const runCell = runLink ? `[Run](${runLink})` : "-";

  if (historyIdx === -1) {
    // Add history section before the end
    const entry = `| ${iteration} | ${phase} | ${message} | ${shaCell} | ${runCell} |`;
    const historyTable = `

${HISTORY_SECTION}

| # | Phase | Action | SHA | Run |
|---|-------|--------|-----|-----|
${entry}`;

    return body + historyTable;
  }

  // Find the table and add a row
  const lines = body.split("\n");
  const historyLineIdx = lines.findIndex((l) => l.includes(HISTORY_SECTION));

  if (historyLineIdx === -1) {
    return body;
  }

  // Find last table row after history section
  let insertIdx = historyLineIdx + 1;
  for (let i = historyLineIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    if (line.startsWith("|")) {
      insertIdx = i + 1;
    } else if (line.trim() !== "" && !line.startsWith("|")) {
      break;
    }
  }

  const entry = `| ${iteration} | ${phase} | ${message} | ${shaCell} | ${runCell} |`;
  lines.splice(insertIdx, 0, entry);

  return lines.join("\n");
}

/**
 * Parse sub-issues from GraphQL response
 */
function parseSubIssues(
  subIssuesData: unknown,
  projectNumber: number,
): SubIssueInfo[] {
  interface SubIssueNode {
    number?: number;
    title?: string;
    state?: string;
    projectItems?: {
      nodes?: Array<{
        project?: { number?: number };
        fieldValues?: {
          nodes?: Array<{
            name?: string;
            field?: { name?: string };
          }>;
        };
      }>;
    };
  }

  interface SubIssuesResponse {
    nodes?: SubIssueNode[];
  }

  const response = subIssuesData as SubIssuesResponse;
  if (!response?.nodes) {
    return [];
  }

  return response.nodes.map((node) => {
    let status: ProjectStatus = "Ready";

    // Find status from project items
    const projectItem = node.projectItems?.nodes?.find(
      (item) => item.project?.number === projectNumber,
    );

    if (projectItem?.fieldValues?.nodes) {
      for (const fieldValue of projectItem.fieldValues.nodes) {
        if (fieldValue.field?.name === "Status" && fieldValue.name) {
          status = fieldValue.name as ProjectStatus;
          break;
        }
      }
    }

    return {
      number: node.number || 0,
      title: node.title || "",
      status,
      state: (node.state?.toLowerCase() || "open") as "open" | "closed",
    };
  });
}

/**
 * Derive branch name from parent issue and phase number
 */
function deriveBranch(parentIssueNumber: number, phaseNumber: number): string {
  return `claude/issue/${parentIssueNumber}/phase-${phaseNumber}`;
}

/**
 * Find current phase from sub-issues (first where Status != Done)
 */
function getCurrentPhase(subIssues: SubIssueInfo[]): {
  phaseNumber: number;
  subIssueNumber: number;
  status: ProjectStatus;
} | null {
  // Sort by number to get phases in order
  const sorted = [...subIssues].sort((a, b) => a.number - b.number);

  for (let i = 0; i < sorted.length; i++) {
    const subIssue = sorted[i];
    if (!subIssue) continue;
    if (subIssue.status !== "Done" && subIssue.state === "open") {
      return {
        phaseNumber: i + 1,
        subIssueNumber: subIssue.number,
        status: subIssue.status,
      };
    }
  }

  // All done or no sub-issues
  return null;
}

async function run(): Promise<void> {
  try {
    const token = getRequiredInput("github_token");
    const issueNumber = parseInt(getRequiredInput("issue_number"), 10);
    const action = getRequiredInput("action");
    const projectNumber = parseInt(
      getOptionalInput("project_number") || "1",
      10,
    );

    const octokit = github.getOctokit(token);
    const { owner, repo } = github.context.repo;

    core.info(
      `Action: ${action}, Issue: #${issueNumber}, Project: ${projectNumber}`,
    );

    // Read project state action
    if (action === "read") {
      interface QueryResponse {
        repository?: {
          issue?: {
            id?: string;
            number?: number;
            title?: string;
            body?: string;
            state?: string;
            projectItems?: { nodes?: unknown[] };
          };
        };
        organization?: {
          projectV2?: unknown;
        };
      }

      const response = await octokit.graphql<QueryResponse>(
        GET_PROJECT_ITEM_QUERY,
        {
          org: owner,
          repo,
          issueNumber,
          projectNumber,
        },
      );

      const issue = response.repository?.issue;
      if (!issue) {
        core.setFailed(`Issue #${issueNumber} not found`);
        return;
      }

      const projectItems = issue.projectItems?.nodes || [];
      const state = parseProjectStateFromResponse(projectItems, projectNumber);

      if (!state) {
        setOutputs({
          has_state: "false",
          status: "",
          iteration: "0",
          failures: "0",
        });
        return;
      }

      setOutputs({
        has_state: "true",
        status: state.status,
        iteration: String(state.iteration),
        failures: String(state.failures),
        issue_body: issue.body || "",
        issue_state: issue.state || "",
      });
      return;
    }

    // Update project fields action
    if (action === "update") {
      const status = getOptionalInput("status") as ProjectStatus | undefined;
      const iteration = getOptionalInput("iteration");
      const failures = getOptionalInput("failures");

      interface QueryResponse {
        repository?: {
          issue?: {
            id?: string;
            projectItems?: { nodes?: unknown[] };
          };
        };
        organization?: {
          projectV2?: unknown;
        };
      }

      const response = await octokit.graphql<QueryResponse>(
        GET_PROJECT_ITEM_QUERY,
        {
          org: owner,
          repo,
          issueNumber,
          projectNumber,
        },
      );

      const issue = response.repository?.issue;
      const projectData = response.organization?.projectV2;

      if (!issue || !projectData) {
        core.setFailed(`Issue #${issueNumber} or project not found`);
        return;
      }

      const projectItems = issue.projectItems?.nodes || [];
      const projectFields = parseProjectFields(projectData);
      let itemId = getProjectItemId(projectItems, projectNumber);

      if (!projectFields) {
        core.setFailed("Failed to parse project fields");
        return;
      }

      // If issue is not in project, add it
      if (!itemId) {
        core.info(`Adding issue #${issueNumber} to project ${projectNumber}`);

        interface AddItemResponse {
          addProjectV2ItemById?: {
            item?: { id?: string };
          };
        }

        const addResult = await octokit.graphql<AddItemResponse>(
          ADD_ISSUE_TO_PROJECT_MUTATION,
          {
            projectId: projectFields.projectId,
            contentId: issue.id,
          },
        );

        itemId = addResult.addProjectV2ItemById?.item?.id || null;

        if (!itemId) {
          core.setFailed("Failed to add issue to project");
          return;
        }
      }

      // Update Status field if provided
      if (status) {
        const optionId = findStatusOption(projectFields.statusOptions, status);
        if (optionId) {
          await octokit.graphql(UPDATE_PROJECT_FIELD_MUTATION, {
            projectId: projectFields.projectId,
            itemId,
            fieldId: projectFields.statusFieldId,
            value: { singleSelectOptionId: optionId },
          });
          core.info(`Updated Status to ${status}`);
        } else {
          core.warning(`Status option '${status}' not found in project`);
        }
      }

      // Update Iteration field if provided
      if (iteration !== undefined) {
        await octokit.graphql(UPDATE_PROJECT_FIELD_MUTATION, {
          projectId: projectFields.projectId,
          itemId,
          fieldId: projectFields.iterationFieldId,
          value: { number: parseFloat(iteration) },
        });
        core.info(`Updated Iteration to ${iteration}`);
      }

      // Update Failures field if provided
      if (failures !== undefined) {
        await octokit.graphql(UPDATE_PROJECT_FIELD_MUTATION, {
          projectId: projectFields.projectId,
          itemId,
          fieldId: projectFields.failuresFieldId,
          value: { number: parseFloat(failures) },
        });
        core.info(`Updated Failures to ${failures}`);
      }

      setOutputs({
        success: "true",
      });
      return;
    }

    // Increment iteration action
    if (action === "increment") {
      interface QueryResponse {
        repository?: {
          issue?: {
            id?: string;
            projectItems?: { nodes?: unknown[] };
          };
        };
        organization?: {
          projectV2?: unknown;
        };
      }

      const response = await octokit.graphql<QueryResponse>(
        GET_PROJECT_ITEM_QUERY,
        {
          org: owner,
          repo,
          issueNumber,
          projectNumber,
        },
      );

      const issue = response.repository?.issue;
      const projectData = response.organization?.projectV2;

      if (!issue || !projectData) {
        core.setFailed(`Issue #${issueNumber} or project not found`);
        return;
      }

      const projectItems = issue.projectItems?.nodes || [];
      const projectFields = parseProjectFields(projectData);
      const itemId = getProjectItemId(projectItems, projectNumber);
      const currentState = parseProjectStateFromResponse(
        projectItems,
        projectNumber,
      );

      if (!projectFields || !itemId) {
        core.setFailed(
          "Issue not in project or failed to parse project fields",
        );
        return;
      }

      const newIteration = (currentState?.iteration || 0) + 1;

      await octokit.graphql(UPDATE_PROJECT_FIELD_MUTATION, {
        projectId: projectFields.projectId,
        itemId,
        fieldId: projectFields.iterationFieldId,
        value: { number: newIteration },
      });

      core.info(`Incremented Iteration to ${newIteration}`);

      setOutputs({
        iteration: String(newIteration),
        success: "true",
      });
      return;
    }

    // Record failure action (increments failures count)
    if (action === "record_failure") {
      interface QueryResponse {
        repository?: {
          issue?: {
            id?: string;
            projectItems?: { nodes?: unknown[] };
          };
        };
        organization?: {
          projectV2?: unknown;
        };
      }

      const response = await octokit.graphql<QueryResponse>(
        GET_PROJECT_ITEM_QUERY,
        {
          org: owner,
          repo,
          issueNumber,
          projectNumber,
        },
      );

      const issue = response.repository?.issue;
      const projectData = response.organization?.projectV2;

      if (!issue || !projectData) {
        core.setFailed(`Issue #${issueNumber} or project not found`);
        return;
      }

      const projectItems = issue.projectItems?.nodes || [];
      const projectFields = parseProjectFields(projectData);
      const itemId = getProjectItemId(projectItems, projectNumber);
      const currentState = parseProjectStateFromResponse(
        projectItems,
        projectNumber,
      );

      if (!projectFields || !itemId) {
        core.setFailed(
          "Issue not in project or failed to parse project fields",
        );
        return;
      }

      const newFailures = (currentState?.failures || 0) + 1;

      await octokit.graphql(UPDATE_PROJECT_FIELD_MUTATION, {
        projectId: projectFields.projectId,
        itemId,
        fieldId: projectFields.failuresFieldId,
        value: { number: newFailures },
      });

      core.info(`Incremented Failures to ${newFailures}`);

      setOutputs({
        failures: String(newFailures),
        success: "true",
      });
      return;
    }

    // Clear failures action (resets to 0)
    if (action === "clear_failures") {
      interface QueryResponse {
        repository?: {
          issue?: {
            id?: string;
            projectItems?: { nodes?: unknown[] };
          };
        };
        organization?: {
          projectV2?: unknown;
        };
      }

      const response = await octokit.graphql<QueryResponse>(
        GET_PROJECT_ITEM_QUERY,
        {
          org: owner,
          repo,
          issueNumber,
          projectNumber,
        },
      );

      const issue = response.repository?.issue;
      const projectData = response.organization?.projectV2;

      if (!issue || !projectData) {
        core.setFailed(`Issue #${issueNumber} or project not found`);
        return;
      }

      const projectItems = issue.projectItems?.nodes || [];
      const projectFields = parseProjectFields(projectData);
      const itemId = getProjectItemId(projectItems, projectNumber);

      if (!projectFields || !itemId) {
        core.setFailed(
          "Issue not in project or failed to parse project fields",
        );
        return;
      }

      await octokit.graphql(UPDATE_PROJECT_FIELD_MUTATION, {
        projectId: projectFields.projectId,
        itemId,
        fieldId: projectFields.failuresFieldId,
        value: { number: 0 },
      });

      core.info("Cleared Failures to 0");

      setOutputs({
        failures: "0",
        success: "true",
      });
      return;
    }

    // Append to iteration history action
    if (action === "append_history") {
      const phase = getOptionalInput("phase") || "-";
      const message = getRequiredInput("message");
      const sha = getOptionalInput("commit_sha");
      const runLink = getOptionalInput("run_link");

      // Get current issue body and iteration
      interface QueryResponse {
        repository?: {
          issue?: {
            id?: string;
            body?: string;
            projectItems?: { nodes?: unknown[] };
          };
        };
      }

      const response = await octokit.graphql<QueryResponse>(
        GET_PROJECT_ITEM_QUERY,
        {
          org: owner,
          repo,
          issueNumber,
          projectNumber,
        },
      );

      const issue = response.repository?.issue;
      if (!issue) {
        core.setFailed(`Issue #${issueNumber} not found`);
        return;
      }

      const projectItems = issue.projectItems?.nodes || [];
      const currentState = parseProjectStateFromResponse(
        projectItems,
        projectNumber,
      );
      const iteration = currentState?.iteration || 0;

      const newBody = addIterationLogEntry(
        issue.body || "",
        iteration,
        phase,
        message,
        sha,
        runLink,
      );

      await octokit.rest.issues.update({
        owner,
        repo,
        issue_number: issueNumber,
        body: newBody,
      });

      core.info(`Appended history entry: Phase ${phase}, ${message}`);

      setOutputs({
        success: "true",
      });
      return;
    }

    // Get sub-issues and current phase action
    if (action === "get_current_phase") {
      const parentNumber = parseInt(
        getOptionalInput("parent_issue") || String(issueNumber),
        10,
      );

      interface SubIssuesResponse {
        repository?: {
          issue?: {
            subIssues?: unknown;
          };
        };
      }

      const response = await octokit.graphql<SubIssuesResponse>(
        GET_SUB_ISSUES_QUERY,
        {
          org: owner,
          repo,
          parentNumber,
        },
      );

      const subIssuesData = response.repository?.issue?.subIssues;
      const subIssues = parseSubIssues(subIssuesData, projectNumber);

      if (subIssues.length === 0) {
        setOutputs({
          has_sub_issues: "false",
          current_phase: "0",
          current_sub_issue: "0",
          total_phases: "0",
          all_phases_done: "false",
        });
        return;
      }

      const currentPhase = getCurrentPhase(subIssues);
      const allDone = subIssues.every(
        (s) => s.status === "Done" || s.state === "closed",
      );

      if (currentPhase) {
        const branch = deriveBranch(parentNumber, currentPhase.phaseNumber);

        setOutputs({
          has_sub_issues: "true",
          current_phase: String(currentPhase.phaseNumber),
          current_sub_issue: String(currentPhase.subIssueNumber),
          current_phase_status: currentPhase.status,
          total_phases: String(subIssues.length),
          all_phases_done: "false",
          branch: branch,
          sub_issues: subIssues.map((s) => s.number).join(","),
        });
      } else {
        setOutputs({
          has_sub_issues: "true",
          current_phase: String(subIssues.length),
          current_sub_issue: "0",
          current_phase_status: "Done",
          total_phases: String(subIssues.length),
          all_phases_done: String(allDone),
          sub_issues: subIssues.map((s) => s.number).join(","),
        });
      }
      return;
    }

    // Initialize parent issue with sub-issues
    if (action === "init_parent") {
      const subIssuesInput = getRequiredInput("sub_issues");
      const subIssueNumbers = subIssuesInput
        .split(",")
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !isNaN(n) && n > 0);

      if (subIssueNumbers.length === 0) {
        core.setFailed("No valid sub-issue numbers provided");
        return;
      }

      interface QueryResponse {
        repository?: {
          issue?: {
            id?: string;
            body?: string;
            projectItems?: { nodes?: unknown[] };
          };
        };
        organization?: {
          projectV2?: unknown;
        };
      }

      // Get parent issue and project info
      const response = await octokit.graphql<QueryResponse>(
        GET_PROJECT_ITEM_QUERY,
        {
          org: owner,
          repo,
          issueNumber,
          projectNumber,
        },
      );

      const issue = response.repository?.issue;
      const projectData = response.organization?.projectV2;

      if (!issue || !projectData) {
        core.setFailed(`Issue #${issueNumber} or project not found`);
        return;
      }

      const projectFields = parseProjectFields(projectData);
      if (!projectFields) {
        core.setFailed("Failed to parse project fields");
        return;
      }

      const projectItems = issue.projectItems?.nodes || [];
      let itemId = getProjectItemId(projectItems, projectNumber);

      // Add parent to project if not already
      if (!itemId) {
        interface AddItemResponse {
          addProjectV2ItemById?: {
            item?: { id?: string };
          };
        }

        const addResult = await octokit.graphql<AddItemResponse>(
          ADD_ISSUE_TO_PROJECT_MUTATION,
          {
            projectId: projectFields.projectId,
            contentId: issue.id,
          },
        );

        itemId = addResult.addProjectV2ItemById?.item?.id || null;
      }

      if (!itemId) {
        core.setFailed("Failed to add parent issue to project");
        return;
      }

      // Set parent to In Progress, Iteration = 0, Failures = 0
      const statusOptionId = findStatusOption(
        projectFields.statusOptions,
        "In Progress",
      );
      if (statusOptionId) {
        await octokit.graphql(UPDATE_PROJECT_FIELD_MUTATION, {
          projectId: projectFields.projectId,
          itemId,
          fieldId: projectFields.statusFieldId,
          value: { singleSelectOptionId: statusOptionId },
        });
      }

      await octokit.graphql(UPDATE_PROJECT_FIELD_MUTATION, {
        projectId: projectFields.projectId,
        itemId,
        fieldId: projectFields.iterationFieldId,
        value: { number: 0 },
      });

      await octokit.graphql(UPDATE_PROJECT_FIELD_MUTATION, {
        projectId: projectFields.projectId,
        itemId,
        fieldId: projectFields.failuresFieldId,
        value: { number: 0 },
      });

      // Add history entry for initialization
      const newBody = addIterationLogEntry(
        issue.body || "",
        0,
        "-",
        `Initialized with ${subIssueNumbers.length} phases`,
      );

      await octokit.rest.issues.update({
        owner,
        repo,
        issue_number: issueNumber,
        body: newBody,
      });

      // Set first sub-issue to Working
      const firstSubIssue = subIssueNumbers[0];

      // Get the first sub-issue's project item
      interface SubIssueQueryResponse {
        repository?: {
          issue?: {
            id?: string;
            projectItems?: { nodes?: unknown[] };
          };
        };
      }

      const subIssueResponse = await octokit.graphql<SubIssueQueryResponse>(
        GET_PROJECT_ITEM_QUERY,
        {
          org: owner,
          repo,
          issueNumber: firstSubIssue,
          projectNumber,
        },
      );

      const subIssue = subIssueResponse.repository?.issue;
      if (subIssue) {
        const subProjectItems = subIssue.projectItems?.nodes || [];
        let subItemId = getProjectItemId(subProjectItems, projectNumber);

        // Add sub-issue to project if not already
        if (!subItemId) {
          interface AddItemResponse {
            addProjectV2ItemById?: {
              item?: { id?: string };
            };
          }

          const addResult = await octokit.graphql<AddItemResponse>(
            ADD_ISSUE_TO_PROJECT_MUTATION,
            {
              projectId: projectFields.projectId,
              contentId: subIssue.id,
            },
          );

          subItemId = addResult.addProjectV2ItemById?.item?.id || null;
        }

        if (subItemId) {
          const workingOptionId = findStatusOption(
            projectFields.statusOptions,
            "Working",
          );
          if (workingOptionId) {
            await octokit.graphql(UPDATE_PROJECT_FIELD_MUTATION, {
              projectId: projectFields.projectId,
              itemId: subItemId,
              fieldId: projectFields.statusFieldId,
              value: { singleSelectOptionId: workingOptionId },
            });
          }
        }
      }

      core.info(
        `Initialized parent #${issueNumber} with ${subIssueNumbers.length} sub-issues`,
      );

      const branch = deriveBranch(issueNumber, 1);

      setOutputs({
        success: "true",
        current_phase: "1",
        current_sub_issue: String(firstSubIssue),
        total_phases: String(subIssueNumbers.length),
        branch,
      });
      return;
    }

    // Advance to next phase (when current phase is merged)
    if (action === "advance_phase") {
      const completedSubIssue = parseInt(
        getRequiredInput("completed_sub_issue"),
        10,
      );
      const parentIssue = parseInt(
        getOptionalInput("parent_issue") || String(issueNumber),
        10,
      );

      interface SubIssuesResponse {
        repository?: {
          issue?: {
            id?: string;
            body?: string;
            subIssues?: unknown;
            projectItems?: { nodes?: unknown[] };
          };
        };
        organization?: {
          projectV2?: unknown;
        };
      }

      // Get parent issue and sub-issues
      const response = await octokit.graphql<SubIssuesResponse>(
        `
        query GetParentAndSubIssues($org: String!, $repo: String!, $parentNumber: Int!, $projectNumber: Int!) {
          repository(owner: $org, name: $repo) {
            issue(number: $parentNumber) {
              id
              body
              projectItems(first: 10) {
                nodes {
                  id
                  project {
                    number
                  }
                }
              }
              subIssues(first: 20) {
                nodes {
                  id
                  number
                  title
                  state
                  projectItems(first: 10) {
                    nodes {
                      id
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
                        }
                      }
                    }
                  }
                }
              }
            }
          }
          organization(login: $org) {
            projectV2(number: $projectNumber) {
              id
              fields(first: 20) {
                nodes {
                  ... on ProjectV2SingleSelectField {
                    id
                    name
                    options {
                      id
                      name
                    }
                  }
                  ... on ProjectV2Field {
                    id
                    name
                    dataType
                  }
                }
              }
            }
          }
        }
      `,
        {
          org: owner,
          repo,
          parentNumber: parentIssue,
          projectNumber,
        },
      );

      const parent = response.repository?.issue;
      const projectData = response.organization?.projectV2;

      if (!parent || !projectData) {
        core.setFailed(`Parent issue #${parentIssue} or project not found`);
        return;
      }

      const projectFields = parseProjectFields(projectData);
      if (!projectFields) {
        core.setFailed("Failed to parse project fields");
        return;
      }

      const subIssues = parseSubIssues(parent.subIssues, projectNumber);
      const parentItems = parent.projectItems?.nodes || [];
      const parentItemId = getProjectItemId(parentItems, projectNumber);

      // Find the completed sub-issue and mark it as Done
      const completedIdx = subIssues.findIndex(
        (s) => s.number === completedSubIssue,
      );
      const completedSubIssueObj = subIssues[completedIdx];
      if (completedIdx >= 0 && completedSubIssueObj) {
        completedSubIssueObj.status = "Done";
      }

      // Find next phase (first sub-issue that's not Done and is open)
      const nextPhase = getCurrentPhase(subIssues);

      if (nextPhase) {
        // Set next sub-issue to Working
        interface SubIssueQueryResponse {
          repository?: {
            issue?: {
              id?: string;
              projectItems?: { nodes?: unknown[] };
            };
          };
        }

        const subIssueResponse = await octokit.graphql<SubIssueQueryResponse>(
          GET_PROJECT_ITEM_QUERY,
          {
            org: owner,
            repo,
            issueNumber: nextPhase.subIssueNumber,
            projectNumber,
          },
        );

        const subIssue = subIssueResponse.repository?.issue;
        if (subIssue) {
          const subProjectItems = subIssue.projectItems?.nodes || [];
          let subItemId = getProjectItemId(subProjectItems, projectNumber);

          if (!subItemId) {
            interface AddItemResponse {
              addProjectV2ItemById?: {
                item?: { id?: string };
              };
            }

            const addResult = await octokit.graphql<AddItemResponse>(
              ADD_ISSUE_TO_PROJECT_MUTATION,
              {
                projectId: projectFields.projectId,
                contentId: subIssue.id,
              },
            );

            subItemId = addResult.addProjectV2ItemById?.item?.id || null;
          }

          if (subItemId) {
            const workingOptionId = findStatusOption(
              projectFields.statusOptions,
              "Working",
            );
            if (workingOptionId) {
              await octokit.graphql(UPDATE_PROJECT_FIELD_MUTATION, {
                projectId: projectFields.projectId,
                itemId: subItemId,
                fieldId: projectFields.statusFieldId,
                value: { singleSelectOptionId: workingOptionId },
              });
            }
          }
        }

        // Log phase advance
        const newBody = addIterationLogEntry(
          parent.body || "",
          0, // Will be overwritten by increment
          `Phase ${nextPhase.phaseNumber}`,
          `Started (after Phase ${completedIdx + 1} merged)`,
        );

        await octokit.rest.issues.update({
          owner,
          repo,
          issue_number: parentIssue,
          body: newBody,
        });

        const branch = deriveBranch(parentIssue, nextPhase.phaseNumber);

        core.info(
          `Advanced to Phase ${nextPhase.phaseNumber} (sub-issue #${nextPhase.subIssueNumber})`,
        );

        setOutputs({
          success: "true",
          next_phase: String(nextPhase.phaseNumber),
          next_sub_issue: String(nextPhase.subIssueNumber),
          all_phases_done: "false",
          branch,
        });
      } else {
        // All phases done - mark parent as Done
        if (parentItemId) {
          const doneOptionId = findStatusOption(
            projectFields.statusOptions,
            "Done",
          );
          if (doneOptionId) {
            await octokit.graphql(UPDATE_PROJECT_FIELD_MUTATION, {
              projectId: projectFields.projectId,
              itemId: parentItemId,
              fieldId: projectFields.statusFieldId,
              value: { singleSelectOptionId: doneOptionId },
            });
          }
        }

        // Log completion
        const newBody = addIterationLogEntry(
          parent.body || "",
          0,
          "-",
          "All phases complete",
        );

        await octokit.rest.issues.update({
          owner,
          repo,
          issue_number: parentIssue,
          body: newBody,
        });

        // Close parent issue
        await octokit.rest.issues.update({
          owner,
          repo,
          issue_number: parentIssue,
          state: "closed",
        });

        core.info(`All phases complete for parent #${parentIssue}`);

        setOutputs({
          success: "true",
          all_phases_done: "true",
        });
      }
      return;
    }

    // Set blocked status (circuit breaker)
    if (action === "set_blocked") {
      const reason = getOptionalInput("reason") || "Max failures reached";

      interface QueryResponse {
        repository?: {
          issue?: {
            id?: string;
            projectItems?: { nodes?: unknown[] };
          };
        };
        organization?: {
          projectV2?: unknown;
        };
      }

      const response = await octokit.graphql<QueryResponse>(
        GET_PROJECT_ITEM_QUERY,
        {
          org: owner,
          repo,
          issueNumber,
          projectNumber,
        },
      );

      const issue = response.repository?.issue;
      const projectData = response.organization?.projectV2;

      if (!issue || !projectData) {
        core.setFailed(`Issue #${issueNumber} or project not found`);
        return;
      }

      const projectItems = issue.projectItems?.nodes || [];
      const projectFields = parseProjectFields(projectData);
      const itemId = getProjectItemId(projectItems, projectNumber);

      if (!projectFields || !itemId) {
        core.setFailed(
          "Issue not in project or failed to parse project fields",
        );
        return;
      }

      const blockedOptionId = findStatusOption(
        projectFields.statusOptions,
        "Blocked",
      );
      if (blockedOptionId) {
        await octokit.graphql(UPDATE_PROJECT_FIELD_MUTATION, {
          projectId: projectFields.projectId,
          itemId,
          fieldId: projectFields.statusFieldId,
          value: { singleSelectOptionId: blockedOptionId },
        });
      }

      core.info(`Set issue #${issueNumber} to Blocked: ${reason}`);

      // NOTE: Do NOT append to history here - see plan for why
      // Appending after Blocked would trigger iterate, creating infinite loop

      setOutputs({
        success: "true",
      });
      return;
    }

    core.setFailed(`Unknown action: ${action}`);
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed("An unexpected error occurred");
    }
  }
}

run();
