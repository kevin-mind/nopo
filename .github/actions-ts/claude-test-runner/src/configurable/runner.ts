/**
 * Configurable Test Runner
 *
 * Orchestrates state machine testing with configurable mock modes.
 * Key features:
 * - Creates fresh issue from fixture for idempotent starting points
 * - Can start at any state by setting up GitHub to match that fixture
 * - Verifies each transition against the next fixture
 * - Supports mocked or real Claude and CI
 */

import * as core from "@actions/core";
import * as github from "@actions/github";
import * as exec from "@actions/exec";
import type { GitHub } from "@actions/github/lib/utils.js";
import { createActor } from "xstate";
import {
  type TestRunnerInputs,
  type TestResult,
  type StateTransitionResult,
  type LoadedScenario,
  type StateFixture,
  type StateName,
} from "./types.js";
import type {
  ParentIssue,
  ProjectStatus,
  MachineContext,
} from "../../../claude-state-machine/schemas/state.js";
import { claudeMachine } from "../../../claude-state-machine/machine/machine.js";
import {
  executeActions,
  createRunnerContext,
} from "../../../claude-state-machine/runner/runner.js";
import { fetchGitHubState } from "../github-state.js";

type Octokit = InstanceType<typeof GitHub>;

// ============================================================================
// GraphQL Queries for Project Fields
// ============================================================================

const GET_PROJECT_ITEM_QUERY = `
query GetProjectItem($org: String!, $repo: String!, $issueNumber: Int!, $projectNumber: Int!) {
  repository(owner: $org, name: $repo) {
    issue(number: $issueNumber) {
      id
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

// ============================================================================
// Project Field Types
// ============================================================================

interface ProjectFields {
  projectId: string;
  statusFieldId: string;
  statusOptions: Record<string, string>;
  iterationFieldId: string;
  failuresFieldId: string;
}

interface ProjectItemNode {
  id?: string;
  project?: { id?: string; number?: number };
  fieldValues?: {
    nodes?: Array<{
      name?: string;
      number?: number;
      field?: { name?: string; id?: string };
    }>;
  };
}

interface ProjectQueryResponse {
  repository?: {
    issue?: {
      id?: string;
      projectItems?: { nodes?: ProjectItemNode[] };
    };
  };
  organization?: {
    projectV2?: {
      id?: string;
      fields?: {
        nodes?: Array<{
          id?: string;
          name?: string;
          options?: Array<{ id: string; name: string }>;
          dataType?: string;
        }>;
      };
    };
  };
}

// ============================================================================
// Test Runner Configuration
// ============================================================================

interface RunnerConfig {
  octokit: Octokit;
  owner: string;
  repo: string;
  projectNumber: number;
}

// ============================================================================
// Test Labels for Isolation
// ============================================================================

const TEST_LABEL = "test:automation";
const TEST_TITLE_PREFIX = "[TEST]";

// ============================================================================
// Configurable Test Runner
// ============================================================================

class ConfigurableTestRunner {
  private scenario: LoadedScenario;
  private inputs: TestRunnerInputs;
  private config: RunnerConfig;
  private issueNumber: number | null = null;

  constructor(
    scenario: LoadedScenario,
    inputs: TestRunnerInputs,
    config: RunnerConfig,
  ) {
    this.scenario = scenario;
    this.inputs = inputs;
    this.config = config;
  }

  /**
   * Run the test scenario
   */
  async run(): Promise<TestResult> {
    const startTime = Date.now();
    const transitions: StateTransitionResult[] = [];

    try {
      // 1. Find starting index
      const startIndex = this.findStartIndex();
      const startingState = this.scenario.orderedStates[startIndex]!;
      core.info(`Starting at state: ${startingState} (index ${startIndex})`);

      // 2. Create test issue from first fixture
      const firstState = this.scenario.orderedStates[0]!;
      const firstFixture = this.scenario.fixtures.get(firstState)!;
      this.issueNumber = await this.createTestIssue(firstFixture);
      core.info(`Created test issue #${this.issueNumber}`);

      // 3. If starting mid-flow, set up GitHub to match starting fixture
      if (startIndex > 0) {
        const startState = this.scenario.orderedStates[startIndex]!;
        const startFixture = this.scenario.fixtures.get(startState)!;
        await this.setupGitHubState(startFixture);
        core.info(`Set up GitHub state for '${startState}'`);
      }

      // 4. Run through states
      for (
        let i = startIndex;
        i < this.scenario.orderedStates.length - 1;
        i++
      ) {
        const currentState = this.scenario.orderedStates[i]!;
        const nextState = this.scenario.orderedStates[i + 1]!;
        const currentFixture = this.scenario.fixtures.get(currentState)!;
        const nextFixture = this.scenario.fixtures.get(nextState)!;

        core.info(`\n${"=".repeat(60)}`);
        core.info(`Transition: ${currentState} -> ${nextState}`);
        core.info(`${"=".repeat(60)}`);

        const transitionStartTime = Date.now();

        try {
          // Execute the state transition
          await this.executeStateTransition(currentFixture);

          // Verify: next fixture IS the expected state
          const verificationErrors = await this.verifyGitHubState(nextFixture);

          const transitionResult: StateTransitionResult = {
            fromState: currentState,
            toState: nextState,
            success: verificationErrors.length === 0,
            durationMs: Date.now() - transitionStartTime,
            verificationErrors:
              verificationErrors.length > 0 ? verificationErrors : undefined,
          };

          transitions.push(transitionResult);

          if (verificationErrors.length > 0) {
            core.error(`Verification failed:`);
            for (const error of verificationErrors) {
              core.error(`  - ${error}`);
            }
            return {
              status: "failed",
              issueNumber: this.issueNumber,
              transitions,
              totalDurationMs: Date.now() - startTime,
              error: `Verification failed: ${verificationErrors.join("; ")}`,
            };
          }

          core.info(`✓ Transition verified`);

          // Stop if not continuing
          if (!this.inputs.continue) {
            return {
              status: "paused",
              currentState,
              nextState,
              issueNumber: this.issueNumber,
              transitions,
              totalDurationMs: Date.now() - startTime,
            };
          }
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);

          transitions.push({
            fromState: currentState,
            toState: nextState,
            success: false,
            error: errorMessage,
            durationMs: Date.now() - transitionStartTime,
          });

          return {
            status: "error",
            issueNumber: this.issueNumber,
            transitions,
            totalDurationMs: Date.now() - startTime,
            error: errorMessage,
          };
        }
      }

      return {
        status: "completed",
        issueNumber: this.issueNumber,
        transitions,
        totalDurationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        status: "error",
        issueNumber: this.issueNumber ?? 0,
        transitions,
        totalDurationMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Find the starting index based on start_step input
   */
  private findStartIndex(): number {
    if (!this.inputs.startStep) {
      return 0;
    }

    const index = this.scenario.orderedStates.indexOf(
      this.inputs.startStep as StateName,
    );
    if (index === -1) {
      throw new Error(
        `Unknown state: ${this.inputs.startStep}. ` +
          `Available states: ${this.scenario.orderedStates.join(", ")}`,
      );
    }
    return index;
  }

  /**
   * Create a test issue from the first fixture
   */
  private async createTestIssue(fixture: StateFixture): Promise<number> {
    const title = `${TEST_TITLE_PREFIX} ${fixture.issue.title}`;
    const labels = [...fixture.issue.labels, TEST_LABEL];

    const response = await this.config.octokit.rest.issues.create({
      owner: this.config.owner,
      repo: this.config.repo,
      title,
      body: fixture.issue.body,
      labels,
    });

    const issueNumber = response.data.number;

    // Set project fields if specified
    if (fixture.issue.projectStatus) {
      await this.setProjectField(
        issueNumber,
        "Status",
        fixture.issue.projectStatus,
      );
    }
    if (fixture.issue.iteration > 0) {
      await this.setProjectField(
        issueNumber,
        "Iteration",
        fixture.issue.iteration,
      );
    }
    if (fixture.issue.failures > 0) {
      await this.setProjectField(
        issueNumber,
        "Failures",
        fixture.issue.failures,
      );
    }

    // Assign nopo-bot if in assignees
    if (fixture.issue.assignees.includes("nopo-bot")) {
      await this.config.octokit.rest.issues.addAssignees({
        owner: this.config.owner,
        repo: this.config.repo,
        issue_number: issueNumber,
        assignees: ["nopo-bot"],
      });
    }

    return issueNumber;
  }

  /**
   * Set up GitHub state to match a fixture (for starting mid-flow)
   */
  private async setupGitHubState(fixture: StateFixture): Promise<void> {
    if (!this.issueNumber) {
      throw new Error("Issue not created yet");
    }

    // Update project fields
    if (fixture.issue.projectStatus) {
      await this.setProjectField(
        this.issueNumber,
        "Status",
        fixture.issue.projectStatus,
      );
    }
    await this.setProjectField(
      this.issueNumber,
      "Iteration",
      fixture.issue.iteration,
    );
    await this.setProjectField(
      this.issueNumber,
      "Failures",
      fixture.issue.failures,
    );

    // Update issue body if different
    await this.config.octokit.rest.issues.update({
      owner: this.config.owner,
      repo: this.config.repo,
      issue_number: this.issueNumber,
      body: fixture.issue.body,
    });

    // Update labels
    await this.config.octokit.rest.issues.setLabels({
      owner: this.config.owner,
      repo: this.config.repo,
      issue_number: this.issueNumber,
      labels: [...fixture.issue.labels, TEST_LABEL],
    });

    // Handle sub-issues if specified
    for (const subIssue of fixture.issue.subIssues as Array<{
      number: number;
      title: string;
      body: string;
      state: "OPEN" | "CLOSED";
      projectStatus: ProjectStatus | null;
    }>) {
      await this.createSubIssue(subIssue);
    }
  }

  /**
   * Execute a state transition
   */
  private async executeStateTransition(fixture: StateFixture): Promise<void> {
    if (!this.issueNumber) {
      throw new Error("Issue not created yet");
    }

    // Get the mock output if in mock mode
    const mockOutput =
      this.inputs.mockClaude && fixture.claudeMock
        ? this.scenario.claudeMocks.get(fixture.claudeMock)?.output
        : undefined;

    // Build MachineContext from fixture
    const context = this.buildMachineContext(fixture);

    core.info(`Building machine context for state: ${fixture.state}`);
    core.startGroup("Machine Context");
    core.info(JSON.stringify(context, null, 2));
    core.endGroup();

    // Run state machine to get pending actions
    const actor = createActor(claudeMachine, { input: context });
    actor.start();
    const snapshot = actor.getSnapshot();
    actor.stop();

    const pendingActions = snapshot.context.pendingActions;
    core.info(`State machine produced ${pendingActions.length} actions`);
    core.info(`Target state: ${String(snapshot.value)}`);

    if (pendingActions.length === 0) {
      core.warning("No actions to execute - state machine produced no actions");
      return;
    }

    // Build mock outputs map for the runner
    const mockOutputs =
      mockOutput && fixture.claudeMock
        ? { [this.getPromptDirFromMock(fixture.claudeMock)]: mockOutput }
        : undefined;

    if (this.inputs.mockClaude && mockOutputs) {
      core.info(`Using mock Claude mode with output: ${fixture.claudeMock}`);
      core.startGroup("Mock Output");
      core.info(JSON.stringify(mockOutput, null, 2));
      core.endGroup();
    }

    // Create runner context with mock outputs
    const runnerCtx = createRunnerContext(
      this.config.octokit,
      this.config.owner,
      this.config.repo,
      this.config.projectNumber,
      {
        dryRun: false,
        mockOutputs,
      },
    );

    // Execute the actions
    core.info("Executing actions...");
    const result = await executeActions(pendingActions, runnerCtx);

    if (!result.success) {
      const failedActions = result.results.filter(
        (r) => !r.success && !r.skipped,
      );
      throw new Error(
        `Action execution failed: ${failedActions.map((r) => r.error?.message).join(", ")}`,
      );
    }

    core.info(
      `Executed ${result.results.filter((r) => !r.skipped).length} actions successfully`,
    );

    // Trigger CI if fixture specifies a CI result
    if (fixture.ciResult) {
      await this.triggerCI(fixture.ciResult);
    }
  }

  /**
   * Build MachineContext from a fixture
   */
  private buildMachineContext(fixture: StateFixture): MachineContext {
    // Cast fixture issue to ParentIssue, providing default empty arrays for simplified fields
    const issue: ParentIssue = {
      number: this.issueNumber!,
      title: fixture.issue.title,
      state: fixture.issue.state,
      body: fixture.issue.body,
      projectStatus: fixture.issue.projectStatus as ProjectStatus | null,
      iteration: fixture.issue.iteration,
      failures: fixture.issue.failures,
      assignees: fixture.issue.assignees,
      labels: fixture.issue.labels,
      subIssues: [], // Simplified in fixtures
      hasSubIssues: fixture.issue.hasSubIssues,
      history: [], // Simplified in fixtures
      todos: fixture.issue.todos,
    };

    // Determine trigger based on state and context
    let trigger: MachineContext["trigger"] = "issue_edited";
    if (fixture.state === "triaging") {
      trigger = "issue_triage";
    } else if (
      fixture.state === "reviewing" ||
      fixture.state === "prReviewing"
    ) {
      trigger = "pr_review_requested";
    } else if (fixture.state === "processingCI") {
      trigger = "workflow_run_completed";
    } else if (fixture.state === "processingReview") {
      trigger = "pr_review_submitted";
    } else if (fixture.ciResult) {
      // If ciResult is set, this is a CI completion trigger
      trigger = "workflow_run_completed";
    }

    return {
      trigger,
      owner: this.config.owner,
      repo: this.config.repo,
      issue,
      parentIssue: null,
      currentPhase: null,
      totalPhases: 0,
      currentSubIssue: null,
      ciResult: fixture.ciResult || null,
      ciRunUrl: null,
      ciCommitSha: null,
      reviewDecision: fixture.reviewDecision || null,
      reviewerId: null,
      branch: `claude/issue/${this.issueNumber}`,
      hasBranch: fixture.issue.iteration > 0,
      pr: null,
      hasPR: false,
      maxRetries: 5,
      botUsername: "nopo-bot",
      discussion: null,
      commentContextType: null,
      commentContextDescription: null,
      releaseEvent: null,
      workflowStartedAt: null,
    };
  }

  /**
   * Extract prompt directory from mock reference (e.g., "iterate/broken-code" -> "iterate")
   */
  private getPromptDirFromMock(mockRef: string): string {
    return mockRef.split("/")[0] ?? mockRef;
  }

  /**
   * Trigger CI workflow (mock or real)
   */
  private async triggerCI(
    result: "success" | "failure" | "cancelled" | "skipped",
  ): Promise<void> {
    if (!this.issueNumber) return;

    const branch = `test/scenario-${this.scenario.name}/${this.issueNumber}`;

    if (this.inputs.mockCI) {
      // Mock mode: trigger CI with mock result
      const mockResult = result === "success" ? "pass" : "fail";
      core.info(`Triggering mock CI with result: ${mockResult}`);

      await exec.exec("gh", [
        "workflow",
        "run",
        "ci.yml",
        "-f",
        `mock=${mockResult}`,
        "-f",
        `ref=${branch}`,
      ]);
    } else {
      // Real mode: wait for actual CI
      core.info("Waiting for real CI...");
    }

    // Wait for CI completion
    await this.waitForCI();
  }

  /**
   * Wait for CI workflow to complete
   */
  private async waitForCI(): Promise<void> {
    const maxWaitMs = 300000; // 5 minutes max
    const pollIntervalMs = 10000; // 10 seconds
    const startTime = Date.now();

    core.info("Waiting for CI workflow to complete...");

    while (Date.now() - startTime < maxWaitMs) {
      // Get recent workflow runs for CI
      const { data: runs } = await this.config.octokit.rest.actions.listWorkflowRuns({
        owner: this.config.owner,
        repo: this.config.repo,
        workflow_id: "ci.yml",
        per_page: 5,
      });

      // Find the most recent run that matches our test scenario
      const recentRun = runs.workflow_runs[0];
      if (recentRun) {
        if (recentRun.status === "completed") {
          core.info(`CI completed with conclusion: ${recentRun.conclusion}`);
          return;
        }
        core.info(`CI status: ${recentRun.status}, waiting...`);
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    core.warning("CI wait timeout - proceeding anyway");
  }

  /**
   * Verify GitHub state matches expected fixture
   */
  private async verifyGitHubState(expected: StateFixture): Promise<string[]> {
    if (!this.issueNumber) {
      return ["Issue not created"];
    }

    const errors: string[] = [];

    // Fetch current GitHub state using the existing function
    const state = await fetchGitHubState(
      this.config.octokit,
      this.config.owner,
      this.config.repo,
      this.issueNumber,
      this.config.projectNumber,
    );

    core.info(`Fetched GitHub state for verification:`);
    core.info(`  Issue state: ${state.issueState}`);
    core.info(`  Project status: ${state.projectStatus}`);
    core.info(`  Iteration: ${state.iteration}`);
    core.info(`  Failures: ${state.failures}`);

    // Verify issue state
    const expectedState = expected.issue.state;
    if (state.issueState !== expectedState) {
      errors.push(
        `Issue state: expected ${expectedState}, got ${state.issueState}`,
      );
    }

    // Verify project status
    if (expected.issue.projectStatus) {
      if (state.projectStatus !== expected.issue.projectStatus) {
        errors.push(
          `Project status: expected ${expected.issue.projectStatus}, got ${state.projectStatus}`,
        );
      }
    }

    // Verify iteration
    if (state.iteration !== expected.issue.iteration) {
      errors.push(
        `Iteration: expected ${expected.issue.iteration}, got ${state.iteration}`,
      );
    }

    // Verify failures
    if (state.failures !== expected.issue.failures) {
      errors.push(
        `Failures: expected ${expected.issue.failures}, got ${state.failures}`,
      );
    }

    return errors;
  }

  /**
   * Create a sub-issue
   */
  private async createSubIssue(subIssue: {
    number: number;
    title: string;
    body: string;
    state: "OPEN" | "CLOSED";
    projectStatus: ProjectStatus | null;
  }): Promise<number> {
    const response = await this.config.octokit.rest.issues.create({
      owner: this.config.owner,
      repo: this.config.repo,
      title: subIssue.title,
      body: subIssue.body,
      labels: [TEST_LABEL],
    });

    const issueNumber = response.data.number;

    if (subIssue.projectStatus) {
      await this.setProjectField(issueNumber, "Status", subIssue.projectStatus);
    }

    // Link as sub-issue to parent
    // Note: GitHub's sub-issues API requires GraphQL
    // For now, we'll add a reference in the body

    return issueNumber;
  }

  /**
   * Set a project field on an issue
   */
  private async setProjectField(
    issueNumber: number,
    field: string,
    value: string | number,
  ): Promise<void> {
    core.info(`Setting ${field}=${value} on issue #${issueNumber}`);

    // Get project item and field info
    const response = await this.config.octokit.graphql<ProjectQueryResponse>(
      GET_PROJECT_ITEM_QUERY,
      {
        org: this.config.owner,
        repo: this.config.repo,
        issueNumber,
        projectNumber: this.config.projectNumber,
      },
    );

    const issue = response.repository?.issue;
    const projectData = response.organization?.projectV2;

    if (!issue || !projectData) {
      throw new Error(`Issue #${issueNumber} or project not found`);
    }

    // Parse project fields
    const projectFields = this.parseProjectFields(projectData);
    if (!projectFields) {
      throw new Error("Failed to parse project fields");
    }

    // Get or create project item
    let itemId = this.getProjectItemId(
      issue.projectItems?.nodes || [],
      this.config.projectNumber,
    );

    if (!itemId) {
      // Add issue to project
      core.info(`Adding issue #${issueNumber} to project`);
      const addResult = await this.config.octokit.graphql<{
        addProjectV2ItemById?: { item?: { id?: string } };
      }>(ADD_ISSUE_TO_PROJECT_MUTATION, {
        projectId: projectFields.projectId,
        contentId: issue.id,
      });

      itemId = addResult.addProjectV2ItemById?.item?.id || null;
      if (!itemId) {
        throw new Error("Failed to add issue to project");
      }
    }

    // Update the field
    let fieldId: string;
    let fieldValue: Record<string, unknown>;

    if (field === "Status") {
      fieldId = projectFields.statusFieldId;
      const optionId = this.findStatusOption(
        projectFields.statusOptions,
        String(value),
      );
      if (!optionId) {
        throw new Error(`Status option '${value}' not found`);
      }
      fieldValue = { singleSelectOptionId: optionId };
    } else if (field === "Iteration") {
      fieldId = projectFields.iterationFieldId;
      fieldValue = { number: Number(value) };
    } else if (field === "Failures") {
      fieldId = projectFields.failuresFieldId;
      fieldValue = { number: Number(value) };
    } else {
      throw new Error(`Unknown field: ${field}`);
    }

    await this.config.octokit.graphql(UPDATE_PROJECT_FIELD_MUTATION, {
      projectId: projectFields.projectId,
      itemId,
      fieldId,
      value: fieldValue,
    });

    core.info(`Set ${field}=${value} on issue #${issueNumber}`);
  }

  /**
   * Parse project fields from GraphQL response
   */
  private parseProjectFields(
    projectData: NonNullable<
      NonNullable<ProjectQueryResponse["organization"]>["projectV2"]
    >,
  ): ProjectFields | null {
    if (!projectData?.id || !projectData.fields?.nodes) {
      return null;
    }

    const fields: ProjectFields = {
      projectId: projectData.id,
      statusFieldId: "",
      statusOptions: {},
      iterationFieldId: "",
      failuresFieldId: "",
    };

    for (const field of projectData.fields.nodes) {
      if (!field) continue;
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
   * Get project item ID for a specific project
   */
  private getProjectItemId(
    projectItems: ProjectItemNode[],
    projectNumber: number,
  ): string | null {
    const projectItem = projectItems.find(
      (item) => item.project?.number === projectNumber,
    );
    return projectItem?.id || null;
  }

  /**
   * Find status option ID by name
   */
  private findStatusOption(
    statusOptions: Record<string, string>,
    status: string,
  ): string | undefined {
    if (statusOptions[status]) {
      return statusOptions[status];
    }
    const lowerStatus = status.toLowerCase();
    for (const [name, id] of Object.entries(statusOptions)) {
      if (name.toLowerCase() === lowerStatus) {
        return id;
      }
    }
    return undefined;
  }

  /**
   * Get a project field from an issue
   */
  private async getProjectField(
    issueNumber: number,
    field: string,
  ): Promise<string | number | null> {
    const response = await this.config.octokit.graphql<ProjectQueryResponse>(
      GET_PROJECT_ITEM_QUERY,
      {
        org: this.config.owner,
        repo: this.config.repo,
        issueNumber,
        projectNumber: this.config.projectNumber,
      },
    );

    const projectItems = response.repository?.issue?.projectItems?.nodes || [];
    const projectItem = projectItems.find(
      (item) => item.project?.number === this.config.projectNumber,
    );

    if (!projectItem) {
      return null;
    }

    const fieldValues = projectItem.fieldValues?.nodes || [];
    for (const fieldValue of fieldValues) {
      if (fieldValue.field?.name === field) {
        if (typeof fieldValue.number === "number") {
          return fieldValue.number;
        }
        if (fieldValue.name) {
          return fieldValue.name;
        }
      }
    }

    return null;
  }
}

/**
 * Create and run a configurable test
 */
export async function runConfigurableTest(
  scenario: LoadedScenario,
  inputs: TestRunnerInputs,
  config: RunnerConfig,
): Promise<TestResult> {
  const runner = new ConfigurableTestRunner(scenario, inputs, config);
  return runner.run();
}
