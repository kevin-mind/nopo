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
  type TestSubIssue,
  type TestPR,
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
  private testBranchName: string | null = null;
  private prNumber: number | null = null;
  private subIssueNumbers: Map<string, number> = new Map(); // title -> issue number

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

      // 3. Create test branch for the scenario
      this.testBranchName = `test/${this.scenario.name}/issue-${this.issueNumber}`;
      await this.createTestBranch();
      core.info(`Created test branch: ${this.testBranchName}`);

      // 4. If starting mid-flow, set up GitHub to match starting fixture
      //    AND apply side effects to set up conditions for the transition
      if (startIndex > 0) {
        const startState = this.scenario.orderedStates[startIndex]!;
        const nextState = this.scenario.orderedStates[startIndex + 1];
        const startFixture = this.scenario.fixtures.get(startState)!;
        await this.setupGitHubState(startFixture);
        core.info(`Set up GitHub state for '${startState}'`);

        // Apply side effects BEFORE running state machine to set up transition conditions
        // e.g., assign nopo-bot to trigger iterating state
        if (nextState) {
          const nextFixture = this.scenario.fixtures.get(nextState)!;
          await this.applyStateTransitionSideEffects(startFixture, nextFixture);
          core.info(`Applied side effects for '${startState}' -> '${nextState}'`);

          // Update the fixture data in memory to reflect the side effects
          // This ensures buildMachineContext uses the correct state
          this.syncFixtureWithSideEffects(startFixture, nextFixture);
        }
      }

      // 5. Run through states
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

          // Apply side effects to reach next state (e.g., assign nopo-bot, create PR)
          // This must happen BEFORE verification so the state matches
          await this.applyStateTransitionSideEffects(
            currentFixture,
            nextFixture,
          );

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
   * Create a test branch for the scenario
   * Creates the branch from main with a placeholder commit so the branch exists
   * and the state machine can push commits to it
   */
  private async createTestBranch(): Promise<void> {
    if (!this.testBranchName) {
      throw new Error("Test branch name not set");
    }

    core.info(`Creating test branch: ${this.testBranchName}`);

    // Get main branch commit
    const { data: mainRef } = await this.config.octokit.rest.git.getRef({
      owner: this.config.owner,
      repo: this.config.repo,
      ref: "heads/main",
    });

    const { data: mainCommit } = await this.config.octokit.rest.git.getCommit({
      owner: this.config.owner,
      repo: this.config.repo,
      commit_sha: mainRef.object.sha,
    });

    // Create a placeholder file blob
    const placeholderContent = `# Test Branch Placeholder
# Scenario: ${this.scenario.name}
# Issue: #${this.issueNumber}
# Created: ${new Date().toISOString()}

This branch was created by the configurable test runner.
`;

    const { data: blob } = await this.config.octokit.rest.git.createBlob({
      owner: this.config.owner,
      repo: this.config.repo,
      content: Buffer.from(placeholderContent).toString("base64"),
      encoding: "base64",
    });

    // Create tree with the placeholder file
    const { data: tree } = await this.config.octokit.rest.git.createTree({
      owner: this.config.owner,
      repo: this.config.repo,
      base_tree: mainCommit.tree.sha,
      tree: [
        {
          path: ".test-placeholder",
          mode: "100644",
          type: "blob",
          sha: blob.sha,
        },
      ],
    });

    // Create commit
    const { data: commit } = await this.config.octokit.rest.git.createCommit({
      owner: this.config.owner,
      repo: this.config.repo,
      message: `test: initialize branch for ${this.scenario.name} scenario

Issue: #${this.issueNumber}
`,
      tree: tree.sha,
      parents: [mainRef.object.sha],
    });

    // Create or update the branch ref
    try {
      await this.config.octokit.rest.git.createRef({
        owner: this.config.owner,
        repo: this.config.repo,
        ref: `refs/heads/${this.testBranchName}`,
        sha: commit.sha,
      });
      core.info(`Created branch ${this.testBranchName} with initial commit`);
    } catch (error) {
      // Branch might already exist (from previous failed run) - update it
      if (
        error instanceof Error &&
        error.message.includes("Reference already exists")
      ) {
        await this.config.octokit.rest.git.updateRef({
          owner: this.config.owner,
          repo: this.config.repo,
          ref: `heads/${this.testBranchName}`,
          sha: commit.sha,
          force: true,
        });
        core.info(`Updated existing branch ${this.testBranchName}`);
      } else {
        throw error;
      }
    }
  }

  /**
   * Create a test PR for the scenario
   * Called when a fixture requires a PR to exist
   */
  private async createTestPR(prSpec: TestPR): Promise<number> {
    if (!this.testBranchName || !this.issueNumber) {
      throw new Error("Branch and issue must be created before PR");
    }

    const headRef = prSpec.headRef || this.testBranchName;
    const baseRef = prSpec.baseRef || "main";
    const title = prSpec.title || `[TEST] PR for issue #${this.issueNumber}`;
    const body =
      prSpec.body ||
      `Test PR for scenario: ${this.scenario.name}\n\nFixes #${this.issueNumber}`;

    core.info(`Creating test PR: ${title}`);
    core.info(`  Head: ${headRef} -> Base: ${baseRef}`);
    core.info(`  Draft: ${prSpec.isDraft}`);

    const response = await this.config.octokit.rest.pulls.create({
      owner: this.config.owner,
      repo: this.config.repo,
      title,
      body,
      head: headRef,
      base: baseRef,
      draft: prSpec.isDraft,
    });

    this.prNumber = response.data.number;
    core.info(`Created PR #${this.prNumber}`);

    // Add test label to the PR
    await this.config.octokit.rest.issues.addLabels({
      owner: this.config.owner,
      repo: this.config.repo,
      issue_number: this.prNumber,
      labels: [TEST_LABEL],
    });

    return this.prNumber;
  }

  /**
   * Request a review on a PR
   */
  private async requestReview(
    prNumber: number,
    reviewer: string,
  ): Promise<void> {
    core.info(`Requesting review from ${reviewer} on PR #${prNumber}`);

    await this.config.octokit.rest.pulls.requestReviewers({
      owner: this.config.owner,
      repo: this.config.repo,
      pull_number: prNumber,
      reviewers: [reviewer],
    });
  }

  /**
   * Apply side effects needed to transition from current state to next state.
   * This handles external triggers (e.g., assigning nopo-bot) that the state machine
   * doesn't handle automatically.
   *
   * Called AFTER executing the current state but BEFORE verification.
   */
  private async applyStateTransitionSideEffects(
    currentFixture: StateFixture,
    nextFixture: StateFixture,
  ): Promise<void> {
    if (!this.issueNumber) return;

    core.info(
      `\nApplying side effects for: ${currentFixture.state} -> ${nextFixture.state}`,
    );

    // Check if nopo-bot needs to be assigned
    const needsAssignment =
      nextFixture.issue.assignees.includes("nopo-bot") &&
      !currentFixture.issue.assignees.includes("nopo-bot");

    if (needsAssignment) {
      core.info("  → Assigning nopo-bot");
      await this.config.octokit.rest.issues.addAssignees({
        owner: this.config.owner,
        repo: this.config.repo,
        issue_number: this.issueNumber,
        assignees: ["nopo-bot"],
      });
    }

    // Check if PR needs to be created
    if (nextFixture.issue.pr && !this.prNumber) {
      core.info("  → Creating PR");
      await this.createTestPR(nextFixture.issue.pr);
    }

    // Check if review needs to be requested
    if (
      nextFixture.state === "reviewing" ||
      nextFixture.state === "prReviewing"
    ) {
      if (this.prNumber) {
        core.info("  → Requesting review");
        await this.requestReview(this.prNumber, "nopo-bot");
      }
    }

    // Check if PR needs to be merged (for processingMerge state)
    if (nextFixture.state === "processingMerge" && this.prNumber) {
      core.info("  → Merging PR");
      await this.mergePR(this.prNumber);
    }

    // Note: We intentionally do NOT update project status or iteration here.
    // Those should be set by the state machine actions, not by side effects.
    // If verification fails on those fields, it means the state machine isn't
    // producing the expected actions.
  }

  /**
   * Sync fixture data with side effects applied
   *
   * After applying side effects (e.g., assigning nopo-bot), the fixture data
   * needs to be updated so buildMachineContext uses the correct state.
   * This is an in-memory update only.
   */
  private syncFixtureWithSideEffects(
    currentFixture: StateFixture,
    nextFixture: StateFixture,
  ): void {
    // If nopo-bot was assigned, update the fixture's assignees
    const needsAssignment =
      nextFixture.issue.assignees.includes("nopo-bot") &&
      !currentFixture.issue.assignees.includes("nopo-bot");

    if (needsAssignment) {
      currentFixture.issue.assignees = [
        ...currentFixture.issue.assignees,
        "nopo-bot",
      ];
      core.debug("  → Updated fixture assignees to include nopo-bot");
    }

    // If PR was created, note that we have one
    // (prNumber is already set by applyStateTransitionSideEffects)

    // If PR state changed (e.g., merged), update fixture
    if (nextFixture.issue.pr && currentFixture.issue.pr) {
      currentFixture.issue.pr = {
        ...currentFixture.issue.pr,
        state: nextFixture.issue.pr.state,
      };
    }
  }

  /**
   * Merge a PR
   */
  private async mergePR(prNumber: number): Promise<void> {
    core.info(`Merging PR #${prNumber}`);

    await this.config.octokit.rest.pulls.merge({
      owner: this.config.owner,
      repo: this.config.repo,
      pull_number: prNumber,
      merge_method: "squash",
    });
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
    for (const subIssue of fixture.issue.subIssues as TestSubIssue[]) {
      await this.createSubIssue(subIssue);
    }

    // Create PR if specified in the fixture
    if (fixture.issue.pr) {
      const prSpec: TestPR = {
        ...fixture.issue.pr,
        headRef: fixture.issue.pr.headRef || this.testBranchName!,
      };
      await this.createTestPR(prSpec);

      // If in reviewing state, request review from nopo-bot
      if (fixture.state === "reviewing" && this.prNumber) {
        await this.requestReview(this.prNumber, "nopo-bot");
      }
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
    if (fixture.state === "detecting") {
      // Detecting state needs to determine what to do
      if (!fixture.issue.labels.includes("triaged")) {
        trigger = "issue_triage";
      } else if (fixture.issue.assignees.includes("nopo-bot")) {
        trigger = "issue_assigned";
      }
    } else if (fixture.state === "triaging") {
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
    } else if (fixture.state === "processingMerge") {
      trigger = "pr_merged";
    } else if (fixture.ciResult) {
      // If ciResult is set, this is a CI completion trigger
      trigger = "workflow_run_completed";
    }

    // Build PR object if we have a PR number
    let pr: MachineContext["pr"] = null;
    if (this.prNumber && fixture.issue.pr) {
      pr = {
        number: this.prNumber,
        state: fixture.issue.pr.state,
        isDraft: fixture.issue.pr.isDraft,
        title: fixture.issue.pr.title,
        headRef: this.testBranchName!,
        baseRef: fixture.issue.pr.baseRef || "main",
      };
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
      branch: this.testBranchName!,
      hasBranch: fixture.issue.iteration > 0 || this.testBranchName !== null,
      pr,
      hasPR: pr !== null,
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
    if (!this.issueNumber || !this.testBranchName) return;

    const branch = this.testBranchName;

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

    core.info(
      `Waiting for CI workflow to complete on branch ${this.testBranchName}...`,
    );

    while (Date.now() - startTime < maxWaitMs) {
      // Get recent workflow runs for CI on our test branch
      const { data: runs } =
        await this.config.octokit.rest.actions.listWorkflowRuns({
          owner: this.config.owner,
          repo: this.config.repo,
          workflow_id: "ci.yml",
          branch: this.testBranchName || undefined,
          per_page: 5,
        });

      // Find the most recent run that matches our test branch
      const matchingRun = runs.workflow_runs.find(
        (run) => run.head_branch === this.testBranchName,
      );

      if (matchingRun) {
        if (matchingRun.status === "completed") {
          core.info(`CI completed with conclusion: ${matchingRun.conclusion}`);
          return;
        }
        core.info(
          `CI status: ${matchingRun.status} (run ${matchingRun.id}), waiting...`,
        );
      } else {
        core.info("No CI run found yet, waiting...");
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    core.warning("CI wait timeout - proceeding anyway");
  }

  /**
   * Verify GitHub state matches expected fixture
   * Returns array of error messages (empty if all checks pass)
   */
  private async verifyGitHubState(expected: StateFixture): Promise<string[]> {
    if (!this.issueNumber) {
      return ["Issue not created"];
    }

    // Fetch current GitHub state using the existing function
    const state = await fetchGitHubState(
      this.config.octokit,
      this.config.owner,
      this.config.repo,
      this.issueNumber,
      this.config.projectNumber,
    );

    // Build comparison objects for deterministic fields only
    const expectedFields = {
      issueState: expected.issue.state,
      projectStatus: expected.issue.projectStatus,
      iteration: expected.issue.iteration,
      failures: expected.issue.failures,
      botAssigned: expected.issue.assignees.includes("nopo-bot"),
      hasTriagedLabel: expected.issue.labels.includes("triaged"),
    };

    const actualFields = {
      issueState: state.issueState,
      projectStatus: state.projectStatus,
      iteration: state.iteration,
      failures: state.failures,
      botAssigned: state.botAssigned,
      hasTriagedLabel: state.labels.includes("triaged"),
    };

    // Log the comparison
    core.info(`\nState Verification:`);
    core.info(`${"─".repeat(60)}`);

    const errors: string[] = [];
    const diffLines: string[] = [];

    // Compare each field
    for (const key of Object.keys(expectedFields) as Array<
      keyof typeof expectedFields
    >) {
      const exp = expectedFields[key];
      const act = actualFields[key];
      const match = exp === act;

      if (match) {
        diffLines.push(`  "${key}": ${JSON.stringify(act)}`);
      } else {
        diffLines.push(`- "${key}": ${JSON.stringify(exp)}`);
        diffLines.push(`+ "${key}": ${JSON.stringify(act)}`);
        errors.push(
          `${key}: expected ${JSON.stringify(exp)}, got ${JSON.stringify(act)}`,
        );
      }
    }

    // Output diff format
    core.info(`{`);
    for (const line of diffLines) {
      if (line.startsWith("-")) {
        core.info(`\x1b[31m${line}\x1b[0m`); // Red for expected
      } else if (line.startsWith("+")) {
        core.info(`\x1b[32m${line}\x1b[0m`); // Green for actual
      } else {
        core.info(line);
      }
    }
    core.info(`}`);
    core.info(`${"─".repeat(60)}`);

    if (errors.length > 0) {
      core.info(`\n❌ ${errors.length} field(s) differ`);
    } else {
      core.info(`\n✅ All fields match`);
    }

    return errors;
  }

  /**
   * Create a sub-issue with optional branch and PR
   */
  private async createSubIssue(subIssue: TestSubIssue): Promise<number> {
    core.info(`Creating sub-issue: ${subIssue.title}`);

    const response = await this.config.octokit.rest.issues.create({
      owner: this.config.owner,
      repo: this.config.repo,
      title: subIssue.title,
      body: subIssue.body,
      labels: [TEST_LABEL],
    });

    const issueNumber = response.data.number;
    this.subIssueNumbers.set(subIssue.title, issueNumber);
    core.info(`Created sub-issue #${issueNumber}`);

    if (subIssue.projectStatus) {
      await this.setProjectField(issueNumber, "Status", subIssue.projectStatus);
    }

    // Create branch for sub-issue if specified
    if (subIssue.branch) {
      const branchName = subIssue.branch.replace(
        "{issue}",
        issueNumber.toString(),
      );
      await this.createBranchForSubIssue(branchName, issueNumber);
    }

    // Create PR for sub-issue if specified
    if (subIssue.pr) {
      const prSpec: TestPR = {
        ...subIssue.pr,
        headRef:
          subIssue.pr.headRef?.replace("{issue}", issueNumber.toString()) ||
          subIssue.branch?.replace("{issue}", issueNumber.toString()) ||
          `test/sub-${issueNumber}`,
        body: subIssue.pr.title
          ? undefined
          : `Fixes #${issueNumber}\n\nSub-issue PR for test scenario.`,
      };

      // Need to save/restore prNumber since createTestPR sets it
      const savedPrNumber = this.prNumber;
      await this.createTestPR(prSpec);
      this.prNumber = savedPrNumber;
    }

    // Link as sub-issue to parent using GraphQL
    await this.linkSubIssueToParent(issueNumber);

    return issueNumber;
  }

  /**
   * Create a branch for a sub-issue
   */
  private async createBranchForSubIssue(
    branchName: string,
    issueNumber: number,
  ): Promise<void> {
    core.info(`Creating branch for sub-issue #${issueNumber}: ${branchName}`);

    // Get main branch commit
    const { data: mainRef } = await this.config.octokit.rest.git.getRef({
      owner: this.config.owner,
      repo: this.config.repo,
      ref: "heads/main",
    });

    const { data: mainCommit } = await this.config.octokit.rest.git.getCommit({
      owner: this.config.owner,
      repo: this.config.repo,
      commit_sha: mainRef.object.sha,
    });

    // Create a placeholder file blob
    const placeholderContent = `# Sub-issue Branch Placeholder
# Issue: #${issueNumber}
# Parent: #${this.issueNumber}
# Created: ${new Date().toISOString()}
`;

    const { data: blob } = await this.config.octokit.rest.git.createBlob({
      owner: this.config.owner,
      repo: this.config.repo,
      content: Buffer.from(placeholderContent).toString("base64"),
      encoding: "base64",
    });

    // Create tree with the placeholder file
    const { data: tree } = await this.config.octokit.rest.git.createTree({
      owner: this.config.owner,
      repo: this.config.repo,
      base_tree: mainCommit.tree.sha,
      tree: [
        {
          path: ".test-placeholder",
          mode: "100644",
          type: "blob",
          sha: blob.sha,
        },
      ],
    });

    // Create commit
    const { data: commit } = await this.config.octokit.rest.git.createCommit({
      owner: this.config.owner,
      repo: this.config.repo,
      message: `test: initialize branch for sub-issue #${issueNumber}`,
      tree: tree.sha,
      parents: [mainRef.object.sha],
    });

    // Create the branch ref
    try {
      await this.config.octokit.rest.git.createRef({
        owner: this.config.owner,
        repo: this.config.repo,
        ref: `refs/heads/${branchName}`,
        sha: commit.sha,
      });
      core.info(`Created branch ${branchName}`);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("Reference already exists")
      ) {
        await this.config.octokit.rest.git.updateRef({
          owner: this.config.owner,
          repo: this.config.repo,
          ref: `heads/${branchName}`,
          sha: commit.sha,
          force: true,
        });
        core.info(`Updated existing branch ${branchName}`);
      } else {
        throw error;
      }
    }
  }

  /**
   * Link a sub-issue to the parent issue using GitHub's sub-issues API
   */
  private async linkSubIssueToParent(subIssueNumber: number): Promise<void> {
    if (!this.issueNumber) return;

    core.info(
      `Linking sub-issue #${subIssueNumber} to parent #${this.issueNumber}`,
    );

    // GitHub's sub-issues feature requires the "sub-issue of" reference
    // We'll add it to the issue body as a workaround since the GraphQL API
    // for sub-issues is not widely available
    const { data: subIssue } = await this.config.octokit.rest.issues.get({
      owner: this.config.owner,
      repo: this.config.repo,
      issue_number: subIssueNumber,
    });

    const parentRef = `Parent: #${this.issueNumber}`;
    if (!subIssue.body?.includes(parentRef)) {
      await this.config.octokit.rest.issues.update({
        owner: this.config.owner,
        repo: this.config.repo,
        issue_number: subIssueNumber,
        body: `${parentRef}\n\n${subIssue.body || ""}`,
      });
    }
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
