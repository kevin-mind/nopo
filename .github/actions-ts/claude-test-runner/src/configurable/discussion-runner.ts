/**
 * Discussion Configurable Test Runner
 *
 * Orchestrates discussion state machine testing with configurable mock modes.
 * Key features:
 * - Creates fresh discussion from fixture for idempotent starting points
 * - Verifies each state produces expected actions
 * - Supports mocked or real Claude
 */

import * as core from "@actions/core";
import type { GitHub } from "@actions/github/lib/utils.js";
import { createActor } from "xstate";
import {
  type DiscussionTestRunnerInputs,
  type DiscussionTestResult,
  type LoadedDiscussionScenario,
  type DiscussionStateFixture,
  type DiscussionStateName,
} from "./discussion-types.js";
import type { MachineContext } from "../../../claude-state-machine/schemas/state.js";
import { discussionMachine } from "../../../claude-state-machine/machine/discussion-machine.js";
import {
  executeActions,
  createRunnerContext,
} from "../../../claude-state-machine/runner/runner.js";

type Octokit = InstanceType<typeof GitHub>;

// ============================================================================
// GraphQL Queries for Discussions
// ============================================================================

const CREATE_DISCUSSION_MUTATION = `
mutation CreateDiscussion($repositoryId: ID!, $categoryId: ID!, $title: String!, $body: String!) {
  createDiscussion(input: {
    repositoryId: $repositoryId
    categoryId: $categoryId
    title: $title
    body: $body
  }) {
    discussion {
      id
      number
      url
    }
  }
}
`;

const GET_REPOSITORY_INFO_QUERY = `
query GetRepositoryInfo($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    id
    discussionCategories(first: 20) {
      nodes {
        id
        name
        slug
      }
    }
  }
}
`;

const GET_DISCUSSION_COMMENTS_QUERY = `
query GetDiscussionComments($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    discussion(number: $number) {
      id
      body
      comments(first: 50) {
        totalCount
        nodes {
          id
          body
          author {
            login
          }
          replies(first: 20) {
            totalCount
          }
        }
      }
    }
  }
}
`;

const ADD_DISCUSSION_COMMENT_MUTATION = `
mutation AddDiscussionComment($discussionId: ID!, $body: String!) {
  addDiscussionComment(input: {
    discussionId: $discussionId
    body: $body
  }) {
    comment {
      id
    }
  }
}
`;

// ============================================================================
// GraphQL Response Types
// ============================================================================

interface RepositoryInfoResponse {
  repository?: {
    id?: string;
    discussionCategories?: {
      nodes?: Array<{
        id: string;
        name: string;
        slug: string;
      }>;
    };
  };
}

interface CreateDiscussionResponse {
  createDiscussion?: {
    discussion?: {
      id: string;
      number: number;
      url: string;
    };
  };
}

interface DiscussionCommentsResponse {
  repository?: {
    discussion?: {
      id: string;
      body: string;
      comments?: {
        totalCount: number;
        nodes?: Array<{
          id: string;
          body: string;
          author?: { login: string };
          replies?: { totalCount: number };
        }>;
      };
    };
  };
}

interface AddCommentResponse {
  addDiscussionComment?: {
    comment?: {
      id: string;
    };
  };
}

// ============================================================================
// Test Runner Configuration
// ============================================================================

interface DiscussionRunnerConfig {
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
// Discussion Configurable Test Runner
// ============================================================================

class DiscussionConfigurableTestRunner {
  private scenario: LoadedDiscussionScenario;
  private inputs: DiscussionTestRunnerInputs;
  private config: DiscussionRunnerConfig;
  private discussionNumber: number | null = null;
  private discussionNodeId: string | null = null;
  private repositoryId: string | null = null;
  private categoryId: string | null = null;

  constructor(
    scenario: LoadedDiscussionScenario,
    inputs: DiscussionTestRunnerInputs,
    config: DiscussionRunnerConfig,
  ) {
    this.scenario = scenario;
    this.inputs = inputs;
    this.config = config;
  }

  // ============================================================================
  // URL Generation Helpers
  // ============================================================================

  private getRepoUrl(): string {
    return `https://github.com/${this.config.owner}/${this.config.repo}`;
  }

  private getDiscussionUrl(discussionNumber: number): string {
    return `${this.getRepoUrl()}/discussions/${discussionNumber}`;
  }

  private logResourceCreated(type: string, url: string): void {
    core.info(`📌 Created ${type}: ${url}`);
  }

  /**
   * Run the discussion test scenario
   */
  async run(): Promise<DiscussionTestResult> {
    const startTime = Date.now();

    try {
      // 1. Get repository info (ID and discussion categories)
      await this.fetchRepositoryInfo();

      // 2. Get the first fixture
      const firstState = this.scenario.orderedStates[0]!;
      const firstFixture = this.scenario.fixtures.get(firstState)!;

      // 3. Create test discussion
      this.discussionNumber = await this.createTestDiscussion(firstFixture);
      this.logResourceCreated(
        "Discussion",
        this.getDiscussionUrl(this.discussionNumber),
      );

      // 4. If this is a comment/command scenario, add the triggering comment
      if (
        firstFixture.trigger === "discussion_comment" ||
        firstFixture.trigger === "discussion_command"
      ) {
        await this.addTriggeringComment(firstFixture);
      }

      // 5. Build machine context and run state machine
      const context = this.buildMachineContext(firstFixture);

      core.info(`Building machine context for state: ${firstFixture.state}`);
      core.startGroup("Machine Context");
      core.info(JSON.stringify(context, null, 2));
      core.endGroup();

      // Run state machine to get pending actions
      const actor = createActor(discussionMachine, { input: context });
      actor.start();
      const snapshot = actor.getSnapshot();
      actor.stop();

      const pendingActions = snapshot.context.pendingActions;
      const finalState = String(snapshot.value) as DiscussionStateName;

      core.info(`State machine produced ${pendingActions.length} actions`);
      core.info(`Final state: ${finalState}`);

      if (pendingActions.length === 0) {
        core.warning(
          "No actions to execute - state machine produced no actions",
        );
        return {
          status: "completed",
          discussionNumber: this.discussionNumber,
          finalState,
          actionsExecuted: 0,
          totalDurationMs: Date.now() - startTime,
        };
      }

      // 6. Get mock output if in mock mode
      const mockOutput =
        this.inputs.mockClaude && firstFixture.claudeMock
          ? this.scenario.claudeMocks.get(firstFixture.claudeMock)?.output
          : undefined;

      // Build mock outputs map for the runner
      const mockOutputs =
        mockOutput && firstFixture.claudeMock
          ? { [this.getPromptDirFromMock(firstFixture.claudeMock)]: mockOutput }
          : undefined;

      if (this.inputs.mockClaude && mockOutputs) {
        core.info(
          `Using mock Claude mode with output: ${firstFixture.claudeMock}`,
        );
        core.startGroup("Mock Output");
        core.info(JSON.stringify(mockOutput, null, 2));
        core.endGroup();
      }

      // 7. Create runner context with mock outputs
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

      // 8. Execute the actions
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

      const actionsExecuted = result.results.filter((r) => !r.skipped).length;
      core.info(`Executed ${actionsExecuted} actions successfully`);

      // 9. Verify expected outcomes
      const verificationErrors =
        await this.verifyExpectedOutcomes(firstFixture);

      if (verificationErrors.length > 0) {
        core.error(`Verification failed:`);
        for (const error of verificationErrors) {
          core.error(`  - ${error}`);
        }
        return {
          status: "failed",
          discussionNumber: this.discussionNumber,
          finalState,
          actionsExecuted,
          totalDurationMs: Date.now() - startTime,
          verificationErrors,
        };
      }

      core.info(`✓ All verifications passed`);

      return {
        status: "completed",
        discussionNumber: this.discussionNumber,
        finalState,
        actionsExecuted,
        totalDurationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        status: "error",
        discussionNumber: this.discussionNumber ?? 0,
        finalState: "noContext",
        actionsExecuted: 0,
        totalDurationMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Fetch repository info (ID and discussion categories)
   */
  private async fetchRepositoryInfo(): Promise<void> {
    const response = await this.config.octokit.graphql<RepositoryInfoResponse>(
      GET_REPOSITORY_INFO_QUERY,
      {
        owner: this.config.owner,
        name: this.config.repo,
      },
    );

    if (!response.repository?.id) {
      throw new Error("Repository not found");
    }

    this.repositoryId = response.repository.id;

    // Find the category matching our scenario
    const categories = response.repository.discussionCategories?.nodes ?? [];
    const category = categories.find(
      (c) =>
        c.slug === this.scenario.category ||
        c.name.toLowerCase() === this.scenario.category.toLowerCase(),
    );

    if (!category) {
      // Default to Q&A or first available category
      const defaultCategory =
        categories.find((c) => c.slug === "q-a") ?? categories[0];
      if (!defaultCategory) {
        throw new Error("No discussion categories found in repository");
      }
      this.categoryId = defaultCategory.id;
      core.info(`Using default category: ${defaultCategory.name}`);
    } else {
      this.categoryId = category.id;
      core.info(`Using category: ${category.name}`);
    }
  }

  /**
   * Create a test discussion from the fixture
   */
  private async createTestDiscussion(
    fixture: DiscussionStateFixture,
  ): Promise<number> {
    const title = `${TEST_TITLE_PREFIX} ${fixture.discussion.title}`;
    const body = `${fixture.discussion.body}\n\n---\n_Test discussion for scenario: ${this.scenario.name}_`;

    const response =
      await this.config.octokit.graphql<CreateDiscussionResponse>(
        CREATE_DISCUSSION_MUTATION,
        {
          repositoryId: this.repositoryId,
          categoryId: this.categoryId,
          title,
          body,
        },
      );

    const discussion = response.createDiscussion?.discussion;
    if (!discussion) {
      throw new Error("Failed to create discussion");
    }

    this.discussionNodeId = discussion.id;
    return discussion.number;
  }

  /**
   * Add a triggering comment for comment/command scenarios
   */
  private async addTriggeringComment(
    fixture: DiscussionStateFixture,
  ): Promise<void> {
    if (!this.discussionNodeId) {
      throw new Error("Discussion not created yet");
    }

    const commentBody =
      fixture.trigger === "discussion_command"
        ? (fixture.discussion.command ?? "/summarize")
        : (fixture.discussion.commentBody ?? "Test comment");

    core.info(`Adding triggering comment: ${commentBody}`);

    const response = await this.config.octokit.graphql<AddCommentResponse>(
      ADD_DISCUSSION_COMMENT_MUTATION,
      {
        discussionId: this.discussionNodeId,
        body: commentBody,
      },
    );

    if (!response.addDiscussionComment?.comment?.id) {
      throw new Error("Failed to add comment to discussion");
    }
  }

  /**
   * Build MachineContext from a fixture
   */
  private buildMachineContext(fixture: DiscussionStateFixture): MachineContext {
    // Determine trigger based on fixture
    let trigger: MachineContext["trigger"];
    if (fixture.trigger === "discussion_created") {
      trigger = "discussion_created";
    } else if (fixture.trigger === "discussion_command") {
      trigger = "discussion_command";
    } else {
      trigger = "discussion_comment";
    }

    return {
      trigger,
      owner: this.config.owner,
      repo: this.config.repo,
      issue: null,
      parentIssue: null,
      currentPhase: null,
      totalPhases: 0,
      currentSubIssue: null,
      ciResult: null,
      ciRunUrl: null,
      ciCommitSha: null,
      reviewDecision: null,
      reviewerId: null,
      branch: null,
      hasBranch: false,
      pr: null,
      hasPR: false,
      maxRetries: 5,
      botUsername: "nopo-bot",
      discussion: {
        number: this.discussionNumber!,
        nodeId: this.discussionNodeId!,
        title: fixture.discussion.title,
        body: fixture.discussion.body,
        commentId: fixture.discussion.commentId ?? null,
        commentBody: fixture.discussion.commentBody ?? null,
        commentAuthor: fixture.discussion.commentAuthor ?? null,
        command: fixture.discussion.command ?? null,
      },
      commentContextType: null,
      commentContextDescription: null,
      releaseEvent: null,
      workflowStartedAt: null,
    };
  }

  /**
   * Extract prompt directory from mock reference (e.g., "discussion-research/basic" -> "discussion-research")
   */
  private getPromptDirFromMock(mockRef: string): string {
    return mockRef.split("/")[0] ?? mockRef;
  }

  /**
   * Verify expected outcomes after action execution
   */
  private async verifyExpectedOutcomes(
    fixture: DiscussionStateFixture,
  ): Promise<string[]> {
    const errors: string[] = [];
    const expected = fixture.expected;

    if (!expected || !this.discussionNumber) {
      return errors;
    }

    // Wait a bit for actions to complete
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Fetch current discussion state
    const response =
      await this.config.octokit.graphql<DiscussionCommentsResponse>(
        GET_DISCUSSION_COMMENTS_QUERY,
        {
          owner: this.config.owner,
          name: this.config.repo,
          number: this.discussionNumber,
        },
      );

    const discussion = response.repository?.discussion;
    if (!discussion) {
      errors.push("Discussion not found after execution");
      return errors;
    }

    // Verify minimum comments
    if (expected.minComments !== undefined) {
      const totalComments = discussion.comments?.totalCount ?? 0;
      if (totalComments < expected.minComments) {
        errors.push(
          `Expected at least ${expected.minComments} comments, got ${totalComments}`,
        );
      }
    }

    // Verify body contains expected strings
    if (expected.bodyContains) {
      for (const expectedText of expected.bodyContains) {
        if (!discussion.body.includes(expectedText)) {
          errors.push(`Discussion body does not contain: "${expectedText}"`);
        }
      }
    }

    // Verify created issues (for /plan command)
    if (expected.createdIssues) {
      // Search for issues with the test label
      const { data: issues } =
        await this.config.octokit.rest.issues.listForRepo({
          owner: this.config.owner,
          repo: this.config.repo,
          labels: TEST_LABEL,
          state: "open",
          per_page: 100,
        });

      // Filter to issues that reference this discussion
      const relatedIssues = issues.filter(
        (issue) =>
          issue.body?.includes(`#${this.discussionNumber}`) ||
          issue.body?.includes(this.discussionNodeId!),
      );

      if (relatedIssues.length < expected.createdIssues.minCount) {
        errors.push(
          `Expected at least ${expected.createdIssues.minCount} issues, got ${relatedIssues.length}`,
        );
      }

      // Check required labels
      if (expected.createdIssues.requiredLabels) {
        for (const issue of relatedIssues) {
          const issueLabels = issue.labels.map((l) =>
            typeof l === "string" ? l : (l.name ?? ""),
          );
          for (const requiredLabel of expected.createdIssues.requiredLabels) {
            if (!issueLabels.includes(requiredLabel)) {
              errors.push(
                `Issue #${issue.number} missing required label: ${requiredLabel}`,
              );
            }
          }
        }
      }
    }

    // Log verification results
    core.info(`\nVerification Results:`);
    core.info(`${"─".repeat(60)}`);
    if (errors.length === 0) {
      core.info(`✅ All checks passed`);
    } else {
      core.info(`❌ ${errors.length} check(s) failed`);
    }
    core.info(`${"─".repeat(60)}`);

    return errors;
  }
}

/**
 * Create and run a discussion configurable test
 */
export async function runDiscussionConfigurableTest(
  scenario: LoadedDiscussionScenario,
  inputs: DiscussionTestRunnerInputs,
  config: DiscussionRunnerConfig,
): Promise<DiscussionTestResult> {
  const runner = new DiscussionConfigurableTestRunner(scenario, inputs, config);
  return runner.run();
}
