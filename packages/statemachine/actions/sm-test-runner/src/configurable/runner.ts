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

import * as fs from "fs";
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
import {
  type ParentIssue,
  type ProjectStatus,
  type MachineContext,
  claudeMachine,
  executeActions,
  createRunnerContext,
} from "@more/statemachine";
import { fetchGitHubState } from "../github-state.js";
import {
  GET_PROJECT_ITEM_QUERY,
  UPDATE_PROJECT_FIELD_MUTATION,
  ADD_ISSUE_TO_PROJECT_MUTATION,
  parseMarkdown,
  serializeMarkdown,
  parseIssue,
  createIssue,
  listComments,
  setLabels,
  type OctokitLike,
} from "@more/issue-state";

type Octokit = InstanceType<typeof GitHub>;

// ============================================================================
// Project Field Types
// ============================================================================
// Note: These local types are kept for runner-specific response parsing.
// The GraphQL queries are imported from @more/issue-state.

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
  /** Optional octokit for submitting reviews (uses different user than main octokit) */
  reviewOctokit?: Octokit;
  owner: string;
  repo: string;
  projectNumber: number;
}

// ============================================================================
// Test Labels for Isolation
// ============================================================================

const TEST_LABEL = "test:automation"; // Used for both skipping automation AND cleanup safety
const TEST_TITLE_PREFIX = "[TEST]";

// Single-task body variants for when multiIssue is false
// These are simpler versions focusing on one aspect of housekeeping
const SINGLE_TASK_BODIES = [
  "I noticed there are some variables in the codebase with unclear names. Could you find one that could be renamed to better describe its purpose and fix it? Keep it small - just one change.",
  "Our test coverage could use some improvement. Find one test that is missing or incomplete and enhance it. Nothing major, just a small improvement.",
  "Some of our documentation has gotten stale. Find one function or module where the docs are missing or outdated and update them. Keep the scope minimal.",
];

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

  private asOctokitLike(): OctokitLike {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- @actions/github octokit type differs from OctokitLike but is compatible
    return this.config.octokit as unknown as OctokitLike;
  }

  // ============================================================================
  // URL Generation Helpers
  // ============================================================================

  private getRepoUrl(): string {
    return `https://github.com/${this.config.owner}/${this.config.repo}`;
  }

  private getIssueUrl(issueNumber: number): string {
    return `${this.getRepoUrl()}/issues/${issueNumber}`;
  }

  private getPrUrl(prNumber: number): string {
    return `${this.getRepoUrl()}/pull/${prNumber}`;
  }

  private getBranchUrl(branchName: string): string {
    return `${this.getRepoUrl()}/tree/${branchName}`;
  }

  private getWorkflowRunUrl(runId: number): string {
    return `${this.getRepoUrl()}/actions/runs/${runId}`;
  }

  private logResourceCreated(type: string, url: string): void {
    core.info(`📌 Created ${type}: ${url}`);
  }

  /**
   * Persist parent issue number to disk so cleanup can find it even if the runner crashes.
   * The manifest is uploaded as an artifact by the workflow.
   */
  private saveManifest(): void {
    if (!this.issueNumber) return;
    try {
      const manifest = {
        parentIssue: this.issueNumber,
        scenario: this.scenario.name,
        createdAt: new Date().toISOString(),
      };
      const manifestPath = "/tmp/test-resource-manifest.json";
      fs.writeFileSync(manifestPath, JSON.stringify(manifest));
      core.info(`Saved resource manifest to ${manifestPath}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      core.warning(`Failed to save resource manifest: ${msg}`);
    }
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
      this.saveManifest();
      this.logResourceCreated("Issue", this.getIssueUrl(this.issueNumber));

      // 3. Create test branch for the scenario
      this.testBranchName = `test/${this.scenario.name}/issue-${this.issueNumber}`;
      await this.createTestBranch();
      this.logResourceCreated("Branch", this.getBranchUrl(this.testBranchName));

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
          core.info(
            `Applied side effects for '${startState}' -> '${nextState}'`,
          );

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
          // Apply side effects BEFORE executing the state machine
          // This sets up the conditions for the current transition (e.g., assign nopo-bot
          // so the state machine uses issue_assigned trigger instead of issue_triage)
          await this.applyStateTransitionSideEffects(
            currentFixture,
            nextFixture,
          );

          // Update the fixture data in memory to reflect the side effects
          // This ensures buildMachineContext uses the correct state
          this.syncFixtureWithSideEffects(currentFixture, nextFixture);

          // Execute the state transition
          // Pass nextFixture so CI can be triggered with the expected result
          await this.executeStateTransition(currentFixture, nextFixture);

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
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- startStep is validated to be a StateName by indexOf check below
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
   * When multiIssue is false, transforms the body to a single random task
   */
  private async createTestIssue(fixture: StateFixture): Promise<number> {
    const title = `${TEST_TITLE_PREFIX} ${fixture.issue.title}`;
    const labels = [...fixture.issue.labels, TEST_LABEL];

    // Transform body based on multiIssue mode
    let body = fixture.issue.body;
    if (!this.inputs.multiIssue) {
      // Pick a random single-task body for single-issue mode
      const randomIndex = Math.floor(Math.random() * SINGLE_TASK_BODIES.length);
      body = SINGLE_TASK_BODIES[randomIndex]!;
      core.info(`Single-issue mode: using task variant ${randomIndex + 1}`);
    }

    const result = await createIssue(
      this.config.owner,
      this.config.repo,
      { title, body, labels },
      { octokit: this.asOctokitLike() },
    );

    const issueNumber = result.issueNumber;
    // Set this.issueNumber early so sub-issue linking can reference the parent
    this.issueNumber = issueNumber;

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
      const { data: assignData, update: assignUpdate } = await parseIssue(
        this.config.owner,
        this.config.repo,
        issueNumber,
        { octokit: this.asOctokitLike(), fetchPRs: false, fetchParent: false },
      );
      const assignState = {
        ...assignData,
        issue: {
          ...assignData.issue,
          assignees: [...new Set([...assignData.issue.assignees, "nopo-bot"])],
        },
      };
      await assignUpdate(assignState);
    }

    // Create sub-issues from fixture
    if (fixture.issue.subIssues && fixture.issue.subIssues.length > 0) {
      await this.createSubIssuesFromFixture(
        issueNumber,
        fixture.issue.subIssues,
      );
    }

    return issueNumber;
  }

  /**
   * Create sub-issues from fixture data and link them to parent
   */
  private async createSubIssuesFromFixture(
    parentIssueNumber: number,
    subIssues: TestSubIssue[],
  ): Promise<void> {
    core.info(
      `Creating ${subIssues.length} sub-issues for parent #${parentIssueNumber}`,
    );

    for (const subIssue of subIssues) {
      // Use existing createSubIssue method which handles project status, branch, PR, and linking
      const subIssueNumber = await this.createSubIssue(subIssue);
      this.logResourceCreated("Sub-issue", this.getIssueUrl(subIssueNumber));

      // Close the issue if state is CLOSED (not handled by createSubIssue)
      if (subIssue.state === "CLOSED") {
        const { data: closeData, update: closeUpdate } = await parseIssue(
          this.config.owner,
          this.config.repo,
          subIssueNumber,
          {
            octokit: this.asOctokitLike(),
            fetchPRs: false,
            fetchParent: false,
          },
        );
        const closeState = {
          ...closeData,
          issue: { ...closeData.issue, state: "CLOSED" as const },
        };
        await closeUpdate(closeState);
        core.info(`  Closed sub-issue #${subIssueNumber}`);
      }
    }
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
    this.logResourceCreated("PR", this.getPrUrl(this.prNumber));

    // Add test label to the PR
    const { data: prLabelData, update: prLabelUpdate } = await parseIssue(
      this.config.owner,
      this.config.repo,
      this.prNumber,
      { octokit: this.asOctokitLike(), fetchPRs: false, fetchParent: false },
    );
    const prLabelState = {
      ...prLabelData,
      issue: {
        ...prLabelData.issue,
        labels: [...new Set([...prLabelData.issue.labels, TEST_LABEL])],
      },
    };
    await prLabelUpdate(prLabelState);

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
      const { data: sideEffectData, update: sideEffectUpdate } =
        await parseIssue(
          this.config.owner,
          this.config.repo,
          this.issueNumber,
          {
            octokit: this.asOctokitLike(),
            fetchPRs: false,
            fetchParent: false,
          },
        );
      const sideEffectState = {
        ...sideEffectData,
        issue: {
          ...sideEffectData.issue,
          assignees: [
            ...new Set([...sideEffectData.issue.assignees, "nopo-bot"]),
          ],
        },
      };
      await sideEffectUpdate(sideEffectState);
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
   * Sync next fixture with side effects we just applied to GitHub
   *
   * In continue mode, after applying side effects, nextFixture will become
   * currentFixture in the next iteration. We need to update it to reflect
   * the side effects we just applied so buildMachineContext works correctly.
   */
  private syncFixtureWithAppliedSideEffects(
    currentFixture: StateFixture,
    nextFixture: StateFixture,
  ): void {
    // If we assigned nopo-bot (side effect applied), update nextFixture
    // so when it becomes currentFixture, the bot is already assigned
    const assignedBot =
      nextFixture.issue.assignees.includes("nopo-bot") &&
      !currentFixture.issue.assignees.includes("nopo-bot");

    if (assignedBot) {
      // The nextFixture already expects nopo-bot, so it already has the right state
      // But we need to ensure it's there for buildMachineContext
      if (!nextFixture.issue.assignees.includes("nopo-bot")) {
        nextFixture.issue.assignees = [
          ...nextFixture.issue.assignees,
          "nopo-bot",
        ];
      }
      core.debug(
        "  → Synced next fixture: nopo-bot assigned for next iteration",
      );
    }

    // If we created a PR (side effect applied), update nextFixture
    if (this.prNumber && nextFixture.issue.pr) {
      core.debug("  → Synced next fixture: PR exists for next iteration");
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
    {
      const { data: bodyData, update: bodyUpdate } = await parseIssue(
        this.config.owner,
        this.config.repo,
        this.issueNumber,
        {
          octokit: this.asOctokitLike(),
          fetchPRs: false,
          fetchParent: false,
        },
      );
      const bodyState = {
        ...bodyData,
        issue: {
          ...bodyData.issue,
          bodyAst: parseMarkdown(fixture.issue.body),
        },
      };
      await bodyUpdate(bodyState);
    }

    // Update labels
    await setLabels(
      this.config.owner,
      this.config.repo,
      this.issueNumber,
      [...fixture.issue.labels, TEST_LABEL],
      this.asOctokitLike(),
    );

    // Update assignees - assign nopo-bot if specified in fixture
    if (fixture.issue.assignees.includes("nopo-bot")) {
      core.info("  → Assigning nopo-bot (via setupGitHubState)");
      const { data: setupAssignData, update: setupAssignUpdate } =
        await parseIssue(
          this.config.owner,
          this.config.repo,
          this.issueNumber,
          {
            octokit: this.asOctokitLike(),
            fetchPRs: false,
            fetchParent: false,
          },
        );
      const setupAssignState = {
        ...setupAssignData,
        issue: {
          ...setupAssignData.issue,
          assignees: [
            ...new Set([...setupAssignData.issue.assignees, "nopo-bot"]),
          ],
        },
      };
      await setupAssignUpdate(setupAssignState);
    }

    // Handle sub-issues if specified
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- fixture.issue.subIssues typed generically, narrowing to TestSubIssue[]
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
   * @param fixture The current state fixture
   * @param nextFixture Optional next fixture (used to get ciResult for CI-triggering states)
   */
  private async executeStateTransition(
    fixture: StateFixture,
    nextFixture?: StateFixture,
  ): Promise<void> {
    if (!this.issueNumber) {
      throw new Error("Issue not created yet");
    }

    // Get the mock output if in mock mode
    const _mockOutput =
      this.inputs.mockClaude && fixture.claudeMock
        ? this.scenario.claudeMocks.get(fixture.claudeMock)?.output
        : undefined;

    // Build MachineContext from fixture
    // Pass nextFixture to get trigger-specific fields (reviewDecision, ciResult)
    const context = this.buildMachineContext(fixture, nextFixture);

    core.info(`Building machine context for state: ${fixture.state}`);
    core.startGroup("Machine Context");
    core.info(JSON.stringify(context, null, 2));
    core.endGroup();

    // Run state machine to get pending actions
    // Send DETECT event to trigger ONE state transition (event-based, not `always`)
    const actor = createActor(claudeMachine, { input: context });
    actor.start();
    actor.send({ type: "DETECT" });
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
    // Include ALL mocks from the scenario (not just current fixture) to support
    // states that call multiple Claude prompts (e.g., grooming calls pm, engineer, qa, research, summary)
    let mockOutputs: Record<string, Record<string, unknown>> | undefined;
    if (this.inputs.mockClaude) {
      mockOutputs = {};

      // Track grooming mocks for combining into a single output
      const groomingMocks: Record<string, Record<string, unknown>> = {};

      for (const [mockRef, mock] of this.scenario.claudeMocks) {
        // Transform the mock output to replace placeholder issue numbers with real ones
        const transformedOutput = this.transformMockOutput(
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- mock output typed as z.record(z.unknown()), safe to cast
          mock.output as Record<string, unknown>,
        );

        // Use the full mock reference as the key (e.g., "grooming/pm")
        // This allows nested prompt dirs like "grooming/pm" to work
        mockOutputs[mockRef] = transformedOutput;

        // Also add an entry for just the base prompt directory
        // This handles cases like "triage/simple-issue" where promptDir is just "triage"
        // but the mock file has a variant suffix
        const basePromptDir = mockRef.split("/")[0];
        if (
          basePromptDir &&
          basePromptDir !== mockRef &&
          !mockOutputs[basePromptDir]
        ) {
          mockOutputs[basePromptDir] = transformedOutput;
        }

        // Collect grooming mocks for combining
        // Mocks like grooming/pm, grooming/engineer-with-phases, etc. need to be combined into
        // a single "grooming" output with { pm: ..., engineer: ..., qa: ..., research: ... }
        if (mockRef.startsWith("grooming/") && mockRef !== "grooming/summary") {
          const fullAgentType = mockRef.split("/")[1]; // e.g., "engineer-with-phases"
          // Extract base agent type before any variant suffix (e.g., "engineer")
          const agentType = fullAgentType?.split("-")[0];
          if (agentType) {
            groomingMocks[agentType] = transformedOutput;
          }
        }
      }

      // If we have grooming mocks, combine them into a single "grooming" output
      // The executeRunClaudeGrooming executor expects ctx.mockOutputs.grooming
      // to have { pm: ..., engineer: ..., qa: ..., research: ... }
      if (Object.keys(groomingMocks).length > 0) {
        mockOutputs.grooming = groomingMocks;
        core.info(
          `Combined ${Object.keys(groomingMocks).length} grooming mocks into 'grooming' key`,
        );
      }

      if (Object.keys(mockOutputs).length > 0) {
        core.info(
          `Using mock Claude mode with ${Object.keys(mockOutputs).length} mock outputs`,
        );
        core.startGroup("Mock Outputs");
        core.info(Object.keys(mockOutputs).join(", "));
        core.endGroup();
      } else {
        mockOutputs = undefined;
      }
    }

    // Build issue context for executors that need issue data without API fetch
    // This is necessary because test issues may not exist yet or API fetch would fail
    const issueContext = {
      number: context.issue.number,
      title: context.issue.title,
      body: serializeMarkdown(context.issue.bodyAst), // Convert MDAST back to string
      comments: context.issue.comments
        ?.map((c) => `${c.author}: ${c.body}`)
        .join("\n\n---\n\n"),
    };

    // Create runner context with mock outputs and issue context
    const runnerCtx = createRunnerContext(
      this.config.octokit,
      this.config.owner,
      this.config.repo,
      this.config.projectNumber,
      {
        dryRun: false,
        mockOutputs,
        reviewOctokit: this.config.reviewOctokit,
        issueContext,
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

    // Only trigger CI for states that push commits
    // The ciResult comes from the NEXT fixture (e.g., processingCI) not the current one
    // because the current state (iterating) produces code that will be validated by CI
    const statesThatTriggerCI: StateName[] = ["iterating", "iteratingFix"];
    if (statesThatTriggerCI.includes(fixture.state) && nextFixture?.ciResult) {
      await this.triggerCI(nextFixture.ciResult);
    }
  }

  /**
   * Build MachineContext from a fixture
   * @param fixture The current state fixture
   * @param nextFixture Optional next fixture (used to get trigger-specific fields like reviewDecision, ciResult)
   */
  private buildMachineContext(
    fixture: StateFixture,
    nextFixture?: StateFixture,
  ): MachineContext {
    // Map sub-issues from fixture to proper SubIssue format (with bodyAst)
    // Use real issue numbers from subIssueNumbers map if available
    const subIssues = (fixture.issue.subIssues || []).map((sub, index) => {
      // Look up the real issue number by title (without TEST prefix)
      const realNumber =
        this.subIssueNumbers.get(sub.title) || sub.number || 1000 + index;
      return {
        number: realNumber,
        title: sub.title,
        state: sub.state,
        bodyAst: parseMarkdown(sub.body), // Convert body to MDAST
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- fixture projectStatus is string | null, maps to ProjectStatus
        projectStatus: sub.projectStatus as ProjectStatus | null,
        branch: sub.branch || null,
        pr: sub.pr || null,
      };
    });

    // Build ParentIssue with bodyAst (IssueData schema)
    const issue: ParentIssue = {
      number: this.issueNumber!,
      title: fixture.issue.title,
      state: fixture.issue.state,
      bodyAst: parseMarkdown(fixture.issue.body), // Convert body to MDAST
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- fixture projectStatus is string | null, maps to ProjectStatus
      projectStatus: fixture.issue.projectStatus as ProjectStatus | null,
      iteration: fixture.issue.iteration,
      failures: fixture.issue.failures,
      assignees: fixture.issue.assignees,
      labels: fixture.issue.labels,
      subIssues: subIssues,
      hasSubIssues: fixture.issue.hasSubIssues,
      comments: [], // Simplified in fixtures
      branch: this.testBranchName || null,
      pr:
        this.prNumber && fixture.issue.pr
          ? {
              number: this.prNumber,
              state: fixture.issue.pr.state,
              isDraft: fixture.issue.pr.isDraft,
              title: fixture.issue.pr.title,
              headRef: this.testBranchName!,
              baseRef: fixture.issue.pr.baseRef || "main",
            }
          : null,
      parentIssueNumber: fixture.parentIssue ? 0 : null, // 0 = placeholder, will be real number
    };

    // Build parentIssue if fixture has one (for sub-issue scenarios)
    let parentIssue: ParentIssue | null = null;
    if (fixture.parentIssue) {
      parentIssue = {
        number: fixture.parentIssue.number || this.issueNumber!, // Use real number or placeholder
        title: fixture.parentIssue.title,
        state: fixture.parentIssue.state,
        bodyAst: parseMarkdown(fixture.parentIssue.body), // Convert body to MDAST
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- fixture projectStatus is string | null, maps to ProjectStatus
        projectStatus: fixture.parentIssue
          .projectStatus as ProjectStatus | null,
        iteration: fixture.parentIssue.iteration,
        failures: fixture.parentIssue.failures,
        assignees: [],
        labels: [],
        subIssues: [],
        hasSubIssues: true, // Parent has sub-issues by definition
        comments: [],
        branch: null,
        pr: null,
        parentIssueNumber: null,
      };
    }

    // Determine trigger - check state-specific overrides first, then fall back to fixture trigger
    // Note: fixture may have been modified by syncFixtureWithSideEffects
    let trigger: MachineContext["trigger"] = "issue-edited";

    // State-specific overrides take precedence over fixture trigger.
    // These handle cases where side effects (like assigning nopo-bot) should
    // change the trigger to route to a different state.
    if (fixture.state === "triaging") {
      // If nopo-bot is assigned (via side effects), use issue-assigned trigger
      // to route to iterating instead of re-running triage
      if (fixture.issue.assignees.includes("nopo-bot")) {
        trigger = "issue-assigned";
      } else if (fixture.issue.labels.includes("triaged")) {
        // Issue is already triaged (has "triaged" label), so use issue-edited
        // which will cause the state machine to check needsGrooming
        trigger = "issue-edited";
      } else {
        trigger = fixture.trigger || "issue-triage";
      }
    } else if (fixture.state === "grooming") {
      // If nopo-bot is assigned (via side effects) and issue is already groomed,
      // use issue-assigned trigger to route to iterating instead of re-running grooming.
      // The "groomed" label in the fixture indicates grooming has completed.
      if (
        fixture.issue.assignees.includes("nopo-bot") &&
        fixture.issue.labels.includes("groomed")
      ) {
        trigger = "issue-assigned";
      } else {
        trigger = fixture.trigger || "issue-groom";
      }
    } else if (fixture.trigger) {
      // Use explicit trigger from fixture if provided and no state-specific override
      trigger = fixture.trigger;
    } else if (fixture.state === "detecting") {
      // Detecting state needs to determine what to do
      if (!fixture.issue.labels.includes("triaged")) {
        trigger = "issue-triage";
      } else if (fixture.issue.assignees.includes("nopo-bot")) {
        trigger = "issue-assigned";
      }
    } else if (
      fixture.state === "reviewing" ||
      fixture.state === "prReviewing"
    ) {
      trigger = "pr-review-requested";
    } else if (fixture.state === "processingCI") {
      trigger = "workflow-run-completed";
    } else if (fixture.state === "processingReview") {
      trigger = "pr-review-submitted";
    } else if (fixture.state === "processingMerge") {
      trigger = "pr-merged";
    } else if (fixture.state === "pivoting") {
      trigger = fixture.trigger || "issue-pivot";
    } else if (fixture.ciResult) {
      // If ciResult is set, this is a CI completion trigger
      trigger = "workflow-run-completed";
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

    // For processing states (processingCI), use the CURRENT fixture's ciResult
    // because that's the result being processed. For other states, use nextFixture's
    // ciResult which indicates what the triggered CI should return.
    const isProcessingState = fixture.state === "processingCI";
    const ciResult = isProcessingState
      ? fixture.ciResult || null
      : nextFixture?.ciResult || fixture.ciResult || null;

    return {
      trigger,
      owner: this.config.owner,
      repo: this.config.repo,
      issue,
      parentIssue, // Use the built parentIssue (null if not a sub-issue)
      currentPhase: null,
      totalPhases: 0,
      currentSubIssue: null,
      ciResult,
      ciRunUrl: null,
      ciCommitSha: null,
      reviewDecision:
        nextFixture?.reviewDecision || fixture.reviewDecision || null,
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
      // Pivot-specific fields
      pivotDescription: fixture.pivotDescription || null,
    };
  }

  /**
   * Extract prompt directory from mock reference (e.g., "iterate/broken-code" -> "iterate")
   */
  private getPromptDirFromMock(mockRef: string): string {
    return mockRef.split("/")[0] ?? mockRef;
  }

  /**
   * Transform mock output to replace placeholder issue numbers with real ones
   *
   * For pivot mocks that reference sub-issues, we need to map the fixture
   * sub-issue numbers to the real issue numbers that were created during the test.
   *
   * The mock can use:
   * - Index-based references (0, 1, 2...) which map to subIssues by position
   * - Fixture issue numbers which we look up by title
   */
  private transformMockOutput(
    output: Record<string, unknown>,
  ): Record<string, unknown> {
    // Deep clone to avoid mutating the original
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- JSON.parse returns unknown, deep clone preserves original shape
    const transformed = JSON.parse(JSON.stringify(output)) as Record<
      string,
      unknown
    >;

    // Check if this is a pivot output with sub_issues modifications
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- accessing untyped field from Record<string, unknown>
    const modifications = transformed.modifications as
      | Record<string, unknown>
      | undefined;
    if (!modifications?.sub_issues) {
      return transformed;
    }

    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- accessing untyped field from Record<string, unknown>
    const subIssueMods = modifications.sub_issues as Array<{
      issue_number: number;
      [key: string]: unknown;
    }>;

    // Get the fixture's sub-issues to map indices to titles
    const currentFixture = this.scenario.fixtures.get(
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- array element type assertion for Map.get() lookup
      this.scenario
        .orderedStates[0] as (typeof this.scenario.orderedStates)[number],
    );
    const fixtureSubIssues = currentFixture?.issue.subIssues || [];

    for (const subMod of subIssueMods) {
      const originalNumber = subMod.issue_number;

      // If it's a small number (0-99), treat it as an index
      if (originalNumber >= 0 && originalNumber < 100) {
        const subIssue = fixtureSubIssues[originalNumber];
        if (subIssue) {
          const realNumber = this.subIssueNumbers.get(subIssue.title);
          if (realNumber) {
            core.debug(
              `Transformed sub-issue index ${originalNumber} -> #${realNumber} (${subIssue.title})`,
            );
            subMod.issue_number = realNumber;
          }
        }
      } else {
        // It's a fixture issue number - try to find by matching fixture sub-issue
        for (const subIssue of fixtureSubIssues) {
          if (subIssue.number === originalNumber) {
            const realNumber = this.subIssueNumbers.get(subIssue.title);
            if (realNumber) {
              core.debug(
                `Transformed fixture issue #${originalNumber} -> #${realNumber} (${subIssue.title})`,
              );
              subMod.issue_number = realNumber;
            }
            break;
          }
        }
      }
    }

    return transformed;
  }

  /**
   * Trigger CI workflow (mock or real)
   */
  private async triggerCI(
    result: "success" | "failure" | "cancelled" | "skipped",
  ): Promise<void> {
    if (!this.issueNumber || !this.testBranchName) return;

    const branch = this.testBranchName;

    // Record timestamp before triggering so we can find the new run
    const triggeredAfter = new Date().toISOString();

    if (this.inputs.mockCI) {
      // Mock mode: trigger CI with mock result on the test branch
      const mockResult = result === "success" ? "pass" : "fail";
      core.info(
        `Triggering mock CI with result: ${mockResult} on branch ${branch}`,
      );

      await exec.exec("gh", [
        "workflow",
        "run",
        "ci.yml",
        "--ref",
        branch,
        "-f",
        `mock=${mockResult}`,
      ]);
    } else {
      // Real mode: wait for actual CI
      core.info("Waiting for real CI...");
    }

    // Wait for CI completion (only consider runs started after we triggered)
    await this.waitForCI(triggeredAfter);
  }

  /**
   * Wait for CI workflow to complete
   * Throws an error if CI times out - tests should fail when expected CI doesn't run
   * @param triggeredAfter ISO timestamp - only consider runs created after this time
   */
  private async waitForCI(triggeredAfter?: string): Promise<void> {
    const maxWaitMs = 300000; // 5 minutes max
    const pollIntervalMs = 10000; // 10 seconds
    const startTime = Date.now();
    let ciRunId: number | null = null;
    const triggeredAfterDate = triggeredAfter ? new Date(triggeredAfter) : null;

    core.info(
      `Waiting for CI workflow to complete on branch ${this.testBranchName}...`,
    );
    if (triggeredAfter) {
      core.info(`Only considering runs created after ${triggeredAfter}`);
    }

    while (Date.now() - startTime < maxWaitMs) {
      // Get recent workflow runs for CI on our test branch
      const { data: runs } =
        await this.config.octokit.rest.actions.listWorkflowRuns({
          owner: this.config.owner,
          repo: this.config.repo,
          workflow_id: "ci.yml",
          branch: this.testBranchName || undefined,
          per_page: 10,
        });

      // Find a run that:
      // 1. Matches our test branch
      // 2. If triggeredAfter is specified, was created after that time
      // 3. If we triggered via workflow_dispatch, prefer that event type
      const matchingRun = runs.workflow_runs.find((run) => {
        if (run.head_branch !== this.testBranchName) return false;

        // If we have a trigger time, only consider runs created after it
        if (triggeredAfterDate) {
          const runCreatedAt = new Date(run.created_at);
          if (runCreatedAt < triggeredAfterDate) {
            return false;
          }
        }

        return true;
      });

      if (matchingRun) {
        // Log the workflow URL on first detection (only once)
        if (ciRunId !== matchingRun.id) {
          ciRunId = matchingRun.id;
          core.info(
            `Found CI run ${matchingRun.id} (event: ${matchingRun.event}, created: ${matchingRun.created_at})`,
          );
          this.logResourceCreated(
            "CI Workflow",
            this.getWorkflowRunUrl(matchingRun.id),
          );
        }
        if (matchingRun.status === "completed") {
          core.info(`CI completed with conclusion: ${matchingRun.conclusion}`);
          core.info(`📌 CI Run: ${this.getWorkflowRunUrl(matchingRun.id)}`);
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

    // Timeout is a test failure - we expected CI to run but it didn't complete
    throw new Error(
      `CI wait timeout after ${maxWaitMs / 1000}s - expected CI to run on branch ${this.testBranchName} but it did not complete`,
    );
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
      hasGroomedLabel: expected.issue.labels.includes("groomed"),
    };

    const actualFields = {
      issueState: state.issueState,
      projectStatus: state.projectStatus,
      iteration: state.iteration,
      failures: state.failures,
      botAssigned: state.botAssigned,
      hasTriagedLabel: state.labels.includes("triaged"),
      hasGroomedLabel: state.labels.includes("groomed"),
    };

    // Log the comparison
    core.info(`\nState Verification:`);
    core.info(`${"─".repeat(60)}`);

    const errors: string[] = [];
    const diffLines: string[] = [];

    // Compare each field
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- Object.keys returns string[], narrowing to keyof for typed access
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

    // Verify history if expected history entries are specified in fixture
    const expectedHistory = expected.issue.history;
    if (expectedHistory && expectedHistory.length > 0) {
      core.info(`\nHistory Verification:`);
      core.info(`${"─".repeat(60)}`);

      const actualActions = state.history.map((h) => h.action);
      const missingActions: string[] = [];

      // Check that each expected history action appears in actual history
      // We match by checking if the expected action pattern is contained in any actual action
      for (const expectedEntry of expectedHistory) {
        // Handle both string patterns (from z.unknown array) and structured entries
        const expectedAction =
          typeof expectedEntry === "string"
            ? expectedEntry
            : // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- z.unknown() array entry, accessing optional action field
              (expectedEntry as { action?: string }).action ||
              String(expectedEntry);

        const found = actualActions.some((action) =>
          action.includes(expectedAction),
        );
        if (found) {
          core.info(`  ✓ Found: "${expectedAction}"`);
        } else {
          core.info(`  ✗ Missing: "${expectedAction}"`);
          missingActions.push(expectedAction);
        }
      }

      if (missingActions.length > 0) {
        core.info(
          `\nActual history actions (${state.history.length} entries):`,
        );
        for (const entry of state.history) {
          core.info(`  [${entry.iteration}/${entry.phase}] ${entry.action}`);
        }
        errors.push(`Missing history actions: ${missingActions.join(", ")}`);
      } else {
        core.info(`\n✅ All expected history entries found`);
      }

      core.info(`${"─".repeat(60)}`);
    }

    // Verify expected pivot/modification outcomes if specified
    if (expected.expected) {
      core.info(`\nPivot/Modification Verification:`);
      core.info(`${"─".repeat(60)}`);

      const pivotErrors = await this.verifyExpectedOutcomes(expected, state);
      if (pivotErrors.length > 0) {
        for (const err of pivotErrors) {
          core.info(`  ✗ ${err}`);
          errors.push(err);
        }
      } else {
        core.info(`  ✓ All expected outcomes verified`);
      }

      core.info(`${"─".repeat(60)}`);
    }

    return errors;
  }

  /**
   * Verify expected outcomes like newSubIssueCreated, todosRemoved, etc.
   * Compares the before state (from fixture) with after state (from GitHub)
   */
  private async verifyExpectedOutcomes(
    expected: StateFixture,
    _state: Record<string, unknown>, // GitHubState - we fetch sub-issues separately
  ): Promise<string[]> {
    const errors: string[] = [];
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- expected.expected is z.record(z.unknown()) parsed as unknown
    const exp = expected.expected as Record<string, unknown>;

    // Get the first fixture (before state) to compare counts and detect modifications
    const firstFixture = this.scenario.fixtures.get(
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- array element type assertion for Map.get() lookup
      this.scenario
        .orderedStates[0] as (typeof this.scenario.orderedStates)[number],
    );
    // Initial state sub-issues (used for detecting modifications)
    const initialSubIssues = firstFixture?.issue.subIssues || [];
    const beforeSubIssueCount = initialSubIssues.length;
    // Count only unchecked todos to be consistent with afterTotalTodos
    const beforeTotalTodos = (firstFixture?.issue.subIssues || []).reduce(
      (sum, s) => {
        const total = s.todos?.total || 0;
        const completed = s.todos?.completed || 0;
        return sum + (total - completed);
      },
      0,
    );

    // Fetch current sub-issues from GitHub using GraphQL
    const subIssuesQuery = `
      query GetSubIssues($owner: String!, $repo: String!, $issueNumber: Int!) {
        repository(owner: $owner, name: $repo) {
          issue(number: $issueNumber) {
            subIssues(first: 50) {
              nodes {
                number
                title
                state
                body
              }
            }
          }
        }
      }
    `;

    interface SubIssuesResponse {
      repository: {
        issue: {
          subIssues: {
            nodes: Array<{
              number: number;
              title: string;
              state: string;
              body: string;
            }>;
          };
        };
      };
    }

    let afterSubIssues: Array<{
      number: number;
      title: string;
      state: string;
      body: string;
    }> = [];
    try {
      const response = await this.config.octokit.graphql<SubIssuesResponse>(
        subIssuesQuery,
        {
          owner: this.config.owner,
          repo: this.config.repo,
          issueNumber: this.issueNumber,
        },
      );
      afterSubIssues = response.repository?.issue?.subIssues?.nodes || [];
    } catch (error) {
      core.warning(`Failed to fetch sub-issues: ${error}`);
    }

    // Count todos in each sub-issue
    const countTodos = (body: string): number => {
      const matches = body.match(/- \[ \]/g);
      return matches ? matches.length : 0;
    };

    const afterSubIssueCount = afterSubIssues.length;
    const afterTotalTodos = afterSubIssues.reduce(
      (sum, s) => sum + countTodos(s.body),
      0,
    );

    core.info(
      `  Before: ${beforeSubIssueCount} sub-issues, ${beforeTotalTodos} todos`,
    );
    core.info(
      `  After:  ${afterSubIssueCount} sub-issues, ${afterTotalTodos} todos`,
    );

    // Check newSubIssueCreated - supports boolean (any increase) or number (exact count)
    if (typeof exp.newSubIssueCreated === "number") {
      const expectedAfterCount = beforeSubIssueCount + exp.newSubIssueCreated;
      if (afterSubIssueCount !== expectedAfterCount) {
        errors.push(
          `newSubIssueCreated: expected ${exp.newSubIssueCreated} sub-issues created (${beforeSubIssueCount} -> ${expectedAfterCount}), but got ${afterSubIssueCount}`,
        );
      } else {
        core.info(
          `  ✓ newSubIssueCreated: ${exp.newSubIssueCreated} sub-issue(s) created as expected`,
        );
      }
    } else if (exp.newSubIssueCreated === true) {
      if (afterSubIssueCount <= beforeSubIssueCount) {
        errors.push(
          `newSubIssueCreated: expected sub-issue count to increase, but went from ${beforeSubIssueCount} to ${afterSubIssueCount}`,
        );
      } else {
        core.info(
          `  ✓ newSubIssueCreated: sub-issue count increased from ${beforeSubIssueCount} to ${afterSubIssueCount}`,
        );
      }
    }

    // Check todosRemoved
    if (typeof exp.todosRemoved === "number") {
      const expectedAfterTodos = beforeTotalTodos - exp.todosRemoved;
      if (afterTotalTodos !== expectedAfterTodos) {
        errors.push(
          `todosRemoved: expected ${exp.todosRemoved} todos removed (${beforeTotalTodos} -> ${expectedAfterTodos}), but got ${afterTotalTodos}`,
        );
      } else {
        core.info(
          `  ✓ todosRemoved: ${exp.todosRemoved} todo(s) removed as expected`,
        );
      }
    }

    // Check todosAdded - supports exact number or { min: N } for minimum
    if (exp.todosAdded !== undefined) {
      const actualAdded = afterTotalTodos - beforeTotalTodos;

      if (typeof exp.todosAdded === "number") {
        if (actualAdded !== exp.todosAdded) {
          errors.push(
            `todosAdded: expected ${exp.todosAdded} todos added (${beforeTotalTodos} -> ${beforeTotalTodos + exp.todosAdded}), but got ${actualAdded}`,
          );
        } else {
          core.info(
            `  ✓ todosAdded: ${exp.todosAdded} todo(s) added as expected`,
          );
        }
      } else if (
        typeof exp.todosAdded === "object" &&
        "min" in exp.todosAdded
      ) {
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- exp.todosAdded validated as object with min property above
        const minExpected = exp.todosAdded.min as number;
        if (actualAdded < minExpected) {
          errors.push(
            `todosAdded: expected at least ${minExpected} todos added, but got ${actualAdded}`,
          );
        } else {
          core.info(
            `  ✓ todosAdded: ${actualAdded} todo(s) added (minimum ${minExpected} required)`,
          );
        }
      }
    }

    // Check requirementsUpdated - verify parent body changed
    if (exp.requirementsUpdated === true) {
      // Fetch parent issue body
      const { data: reqParentData } = await parseIssue(
        this.config.owner,
        this.config.repo,
        this.issueNumber!,
        {
          octokit: this.asOctokitLike(),
          fetchPRs: false,
          fetchParent: false,
        },
      );
      const parentBody = serializeMarkdown(reqParentData.issue.bodyAst);
      const originalBody = firstFixture?.issue.body || "";

      // Check if body changed (ignoring iteration history section)
      const getBodyWithoutHistory = (body: string) =>
        body.split("## Iteration History")[0].trim();

      if (
        getBodyWithoutHistory(parentBody) ===
        getBodyWithoutHistory(originalBody)
      ) {
        errors.push(
          `requirementsUpdated: expected parent body to change, but it didn't`,
        );
      } else {
        core.info(`  ✓ requirementsUpdated: parent body was modified`);
      }
    }

    // Check parentIssueModified
    if (exp.parentIssueModified === true) {
      const { data: modParentData } = await parseIssue(
        this.config.owner,
        this.config.repo,
        this.issueNumber!,
        {
          octokit: this.asOctokitLike(),
          fetchPRs: false,
          fetchParent: false,
        },
      );
      const parentBody = serializeMarkdown(modParentData.issue.bodyAst);
      const originalBody = firstFixture?.issue.body || "";

      const getBodyWithoutHistory = (body: string) =>
        body.split("## Iteration History")[0].trim();

      if (
        getBodyWithoutHistory(parentBody) ===
        getBodyWithoutHistory(originalBody)
      ) {
        errors.push(
          `parentIssueModified: expected parent body to change, but it didn't`,
        );
      } else {
        core.info(`  ✓ parentIssueModified: parent body was modified`);
      }
    }

    // Check subIssuesModified - at least one sub-issue body should be different from initial state
    if (exp.subIssuesModified === true) {
      let anyModified = false;
      for (const sub of afterSubIssues) {
        // Compare against INITIAL fixture sub-issues, not expected end state
        const initialSub = initialSubIssues.find((f) => f.title === sub.title);
        if (initialSub && sub.body !== initialSub.body) {
          anyModified = true;
          core.info(
            `  Sub-issue "${sub.title}" was modified (body differs from initial)`,
          );
          break;
        }
      }
      if (!anyModified) {
        errors.push(
          `subIssuesModified: expected at least one sub-issue to be modified, but none were`,
        );
      } else {
        core.info(`  ✓ subIssuesModified: at least one sub-issue was modified`);
      }
    }

    // Check completedWorkPreserved - closed sub-issues and checked todos unchanged
    if (exp.completedWorkPreserved === true) {
      // Find closed sub-issues in initial fixture
      const closedFixtureSubs = initialSubIssues.filter(
        (s) => s.state === "CLOSED",
      );
      let allPreserved = true;
      for (const closedSub of closedFixtureSubs) {
        const realNumber = this.subIssueNumbers.get(closedSub.title);
        if (realNumber) {
          const { data: closedSubData } = await parseIssue(
            this.config.owner,
            this.config.repo,
            realNumber,
            {
              octokit: this.asOctokitLike(),
              fetchPRs: false,
              fetchParent: false,
            },
          );
          // Check state is still closed (parseIssue returns uppercase "CLOSED")
          if (closedSubData.issue.state !== "CLOSED") {
            allPreserved = false;
            errors.push(
              `completedWorkPreserved: closed sub-issue #${realNumber} was reopened`,
            );
          }
        }
      }
      if (allPreserved && closedFixtureSubs.length > 0) {
        core.info(
          `  ✓ completedWorkPreserved: ${closedFixtureSubs.length} closed sub-issue(s) unchanged`,
        );
      }
    }

    // Check maxFailuresReached - verify failures count hit max (5)
    if (exp.maxFailuresReached === true) {
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- _state is Record<string, unknown>, failures is numeric
      const failures = _state.failures as number;
      if (failures !== 5) {
        errors.push(
          `maxFailuresReached: expected failures to be 5, but got ${failures}`,
        );
      } else {
        core.info(`  ✓ maxFailuresReached: failures count is 5 as expected`);
      }
    }

    // Check botUnassigned - verify nopo-bot is not assigned
    if (exp.botUnassigned === true) {
      const { data: botCheckData } = await parseIssue(
        this.config.owner,
        this.config.repo,
        this.issueNumber!,
        {
          octokit: this.asOctokitLike(),
          fetchPRs: false,
          fetchParent: false,
        },
      );
      const assignees = botCheckData.issue.assignees;
      if (assignees.includes("nopo-bot")) {
        errors.push(
          `botUnassigned: expected nopo-bot to be unassigned, but it's still assigned`,
        );
      } else {
        core.info(`  ✓ botUnassigned: nopo-bot is not assigned as expected`);
      }
    }

    // Check allTodosComplete - verify all todos are checked
    if (exp.allTodosComplete === true) {
      const { data: todosData } = await parseIssue(
        this.config.owner,
        this.config.repo,
        this.issueNumber!,
        {
          octokit: this.asOctokitLike(),
          fetchPRs: false,
          fetchParent: false,
        },
      );
      const body = serializeMarkdown(todosData.issue.bodyAst);
      const uncheckedCount = (body.match(/- \[ \]/g) || []).length;
      if (uncheckedCount > 0) {
        errors.push(
          `allTodosComplete: expected all todos complete, but found ${uncheckedCount} unchecked`,
        );
      } else {
        core.info(`  ✓ allTodosComplete: all todos are checked`);
      }
    }

    // Check prCreated - verify a PR exists for the branch
    if (exp.prCreated === true) {
      const { data: prCreatedData } = await parseIssue(
        this.config.owner,
        this.config.repo,
        this.issueNumber!,
        {
          octokit: this.asOctokitLike(),
          fetchPRs: false,
          fetchParent: false,
        },
      );
      const prCreatedIssueNumber = prCreatedData.issue.number;
      // Search for PRs that mention this issue
      const { data: prs } = await this.config.octokit.rest.pulls.list({
        owner: this.config.owner,
        repo: this.config.repo,
        state: "open",
      });
      const linkedPr = prs.find(
        (pr) =>
          pr.body?.includes(`#${prCreatedIssueNumber}`) ||
          pr.body?.includes(`Fixes #${prCreatedIssueNumber}`),
      );
      if (!linkedPr) {
        errors.push(
          `prCreated: expected PR to be created for issue #${prCreatedIssueNumber}, but none found`,
        );
      } else {
        core.info(`  ✓ prCreated: PR #${linkedPr.number} found for issue`);
      }
    }

    // Check prIsDraft - verify PR is a draft
    if (exp.prIsDraft === true) {
      const { data: draftData } = await parseIssue(
        this.config.owner,
        this.config.repo,
        this.issueNumber!,
        {
          octokit: this.asOctokitLike(),
          fetchPRs: false,
          fetchParent: false,
        },
      );
      const draftIssueNumber = draftData.issue.number;
      const { data: prs } = await this.config.octokit.rest.pulls.list({
        owner: this.config.owner,
        repo: this.config.repo,
        state: "open",
      });
      const linkedPr = prs.find(
        (pr) =>
          pr.body?.includes(`#${draftIssueNumber}`) ||
          pr.body?.includes(`Fixes #${draftIssueNumber}`),
      );
      if (!linkedPr) {
        errors.push(`prIsDraft: no PR found to check draft status`);
      } else if (!linkedPr.draft) {
        errors.push(
          `prIsDraft: expected PR #${linkedPr.number} to be draft, but it's ready for review`,
        );
      } else {
        core.info(`  ✓ prIsDraft: PR #${linkedPr.number} is a draft`);
      }
    }

    // Check prMarkedReady - verify PR is not a draft (ready for review)
    if (exp.prMarkedReady === true) {
      const { data: readyData } = await parseIssue(
        this.config.owner,
        this.config.repo,
        this.issueNumber!,
        {
          octokit: this.asOctokitLike(),
          fetchPRs: false,
          fetchParent: false,
        },
      );
      const readyIssueNumber = readyData.issue.number;
      const { data: prs } = await this.config.octokit.rest.pulls.list({
        owner: this.config.owner,
        repo: this.config.repo,
        state: "open",
      });
      const linkedPr = prs.find(
        (pr) =>
          pr.body?.includes(`#${readyIssueNumber}`) ||
          pr.body?.includes(`Fixes #${readyIssueNumber}`),
      );
      if (!linkedPr) {
        errors.push(`prMarkedReady: no PR found to check ready status`);
      } else if (linkedPr.draft) {
        errors.push(
          `prMarkedReady: expected PR #${linkedPr.number} to be ready, but it's a draft`,
        );
      } else {
        core.info(
          `  ✓ prMarkedReady: PR #${linkedPr.number} is ready for review`,
        );
      }
    }

    // Check commentPosted - verify a comment was posted (by bot or nopo-bot)
    if (exp.commentPosted === true) {
      const issueComments = await listComments(
        this.config.owner,
        this.config.repo,
        this.issueNumber!,
        this.asOctokitLike(),
      );
      // Look for comments from claude[bot], nopo-bot, or any Bot type
      const botComment = issueComments.find(
        (c) =>
          c.user?.login === "claude[bot]" ||
          c.user?.login === "nopo-bot" ||
          c.user?.login?.endsWith("[bot]"),
      );
      if (!botComment) {
        const commentUsers = issueComments.map((c) => c.user?.login).join(", ");
        errors.push(
          `commentPosted: expected bot comment, but none found. Comments from: ${commentUsers || "(none)"}`,
        );
      } else {
        core.info(
          `  ✓ commentPosted: comment from ${botComment.user?.login} found`,
        );
      }
    }

    // Check issueClosed - verify issue is closed
    if (exp.issueClosed === true) {
      const { data: closedCheckData } = await parseIssue(
        this.config.owner,
        this.config.repo,
        this.issueNumber!,
        {
          octokit: this.asOctokitLike(),
          fetchPRs: false,
          fetchParent: false,
        },
      );
      // parseIssue returns uppercase state: "OPEN" or "CLOSED"
      if (closedCheckData.issue.state !== "CLOSED") {
        errors.push(
          `issueClosed: expected issue to be closed, but state is ${closedCheckData.issue.state}`,
        );
      } else {
        core.info(`  ✓ issueClosed: issue is closed`);
      }
    }

    // Check failuresReset - verify failures went from >0 to 0
    if (exp.failuresReset === true) {
      const beforeFailures = firstFixture?.issue.failures || 0;
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- _state is Record<string, unknown>, failures is numeric
      const afterFailures = _state.failures as number;
      if (beforeFailures <= 0) {
        errors.push(
          `failuresReset: expected starting failures > 0, but was ${beforeFailures}`,
        );
      } else if (afterFailures !== 0) {
        errors.push(
          `failuresReset: expected failures to reset to 0, but got ${afterFailures}`,
        );
      } else {
        core.info(
          `  ✓ failuresReset: failures reset from ${beforeFailures} to 0`,
        );
      }
    }

    // Check hasTriagedLabel - verify issue has triaged label
    if (exp.hasTriagedLabel === true) {
      const { data: triagedData } = await parseIssue(
        this.config.owner,
        this.config.repo,
        this.issueNumber!,
        {
          octokit: this.asOctokitLike(),
          fetchPRs: false,
          fetchParent: false,
        },
      );
      const labels = triagedData.issue.labels;
      if (!labels.includes("triaged")) {
        errors.push(
          `hasTriagedLabel: expected triaged label, but not found. Labels: ${labels.join(", ")}`,
        );
      } else {
        core.info(`  ✓ hasTriagedLabel: triaged label present`);
      }
    }

    // Check hasGroomedLabel - verify issue has groomed label
    if (exp.hasGroomedLabel === true) {
      const { data: groomedData } = await parseIssue(
        this.config.owner,
        this.config.repo,
        this.issueNumber!,
        {
          octokit: this.asOctokitLike(),
          fetchPRs: false,
          fetchParent: false,
        },
      );
      const labels = groomedData.issue.labels;
      if (!labels.includes("groomed")) {
        errors.push(
          `hasGroomedLabel: expected groomed label, but not found. Labels: ${labels.join(", ")}`,
        );
      } else {
        core.info(`  ✓ hasGroomedLabel: groomed label present`);
      }
    }

    return errors;
  }

  /**
   * Create a sub-issue with optional branch and PR
   */
  private async createSubIssue(subIssue: TestSubIssue): Promise<number> {
    core.info(`Creating sub-issue: ${subIssue.title}`);

    const subResult = await createIssue(
      this.config.owner,
      this.config.repo,
      { title: subIssue.title, body: subIssue.body, labels: [TEST_LABEL] },
      { octokit: this.asOctokitLike() },
    );

    const issueNumber = subResult.issueNumber;
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

    // Get the node IDs for both issues (required for GraphQL mutation)
    const nodeIdQuery = `
      query GetIssueNodeId($owner: String!, $repo: String!, $issueNumber: Int!) {
        repository(owner: $owner, name: $repo) {
          issue(number: $issueNumber) {
            id
          }
        }
      }
    `;

    interface NodeIdResponse {
      repository: { issue: { id: string } };
    }

    const parentNodeIdResult =
      await this.config.octokit.graphql<NodeIdResponse>(nodeIdQuery, {
        owner: this.config.owner,
        repo: this.config.repo,
        issueNumber: this.issueNumber,
      });
    const parentNodeId = parentNodeIdResult.repository.issue.id;

    const subNodeIdResult = await this.config.octokit.graphql<NodeIdResponse>(
      nodeIdQuery,
      {
        owner: this.config.owner,
        repo: this.config.repo,
        issueNumber: subIssueNumber,
      },
    );
    const subNodeId = subNodeIdResult.repository.issue.id;

    // Use GitHub's addSubIssue mutation to properly link the sub-issue
    const mutation = `
      mutation AddSubIssue($parentId: ID!, $subIssueId: ID!) {
        addSubIssue(input: { issueId: $parentId, subIssueId: $subIssueId }) {
          issue {
            id
          }
          subIssue {
            id
          }
        }
      }
    `;

    try {
      await this.config.octokit.graphql(mutation, {
        parentId: parentNodeId,
        subIssueId: subNodeId,
      });
      core.info(
        `  Linked sub-issue #${subIssueNumber} to parent #${this.issueNumber}`,
      );
    } catch (error) {
      // If GraphQL mutation fails, fall back to adding parent reference in body
      core.warning(
        `Failed to link via GraphQL, adding parent reference to body: ${error}`,
      );
      const parentRef = `Parent: #${this.issueNumber}`;
      const { data: fallbackData, update: fallbackUpdate } = await parseIssue(
        this.config.owner,
        this.config.repo,
        subIssueNumber,
        {
          octokit: this.asOctokitLike(),
          fetchPRs: false,
          fetchParent: false,
        },
      );
      const fallbackBody = serializeMarkdown(fallbackData.issue.bodyAst);
      if (!fallbackBody.includes(parentRef)) {
        const fallbackState = {
          ...fallbackData,
          issue: {
            ...fallbackData.issue,
            bodyAst: parseMarkdown(`${parentRef}\n\n${fallbackBody}`),
          },
        };
        await fallbackUpdate(fallbackState);
      }
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
      try {
        const addResult = await this.config.octokit.graphql<{
          addProjectV2ItemById?: { item?: { id?: string } };
        }>(ADD_ISSUE_TO_PROJECT_MUTATION, {
          projectId: projectFields.projectId,
          contentId: issue.id,
        });

        itemId = addResult.addProjectV2ItemById?.item?.id || null;
      } catch (error) {
        // Handle "Content already exists in this project" error
        // This can happen due to race conditions with project automations
        if (
          error instanceof Error &&
          error.message.includes("Content already exists")
        ) {
          core.info("Issue already in project, refetching item ID...");
          // Refetch to get the item ID
          const refetchResponse =
            await this.config.octokit.graphql<ProjectQueryResponse>(
              GET_PROJECT_ITEM_QUERY,
              {
                org: this.config.owner,
                repo: this.config.repo,
                issueNumber,
                projectNumber: this.config.projectNumber,
              },
            );
          const refetchedIssue = refetchResponse.repository?.issue;
          itemId = this.getProjectItemId(
            refetchedIssue?.projectItems?.nodes || [],
            this.config.projectNumber,
          );
        } else {
          throw error;
        }
      }

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
