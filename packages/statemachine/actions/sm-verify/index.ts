/**
 * State Machine Verify Action
 *
 * Compares actual post-run issue state against predicted outcomes from sm-plan.
 * Gates retrigger: if verification fails, the workflow should not retrigger.
 *
 * Steps:
 * 1. Parse expected_state_json → ExpectedState
 * 2. Fetch actual issue state via parseIssue()
 * 3. Extract PredictableStateTree from actual state
 * 4. Compare expected outcomes against actual tree
 * 5. Output verified (true/false) and structured diff
 */

import * as core from "@actions/core";
import * as github from "@actions/github";
import { parseIssue, type OctokitLike } from "@more/issue-state";
import {
  getRequiredInput,
  getOptionalInput,
  setOutputs,
  createMachineContext,
  Verify,
  HISTORY_MESSAGES,
  addHistoryEntry,
} from "@more/statemachine";

function asOctokitLike(
  octokit: ReturnType<typeof github.getOctokit>,
): OctokitLike {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- @actions/github octokit type differs from OctokitLike but is compatible
  return octokit as unknown as OctokitLike;
}

/**
 * Log a PredictableStateTree in a readable grouped format.
 */
function logTree(label: string, tree: Verify.PredictableStateTree): void {
  core.startGroup(`${label}: Issue #${tree.issue.number}`);

  core.info(`  state:         ${tree.issue.state}`);
  core.info(`  projectStatus: ${tree.issue.projectStatus}`);
  core.info(`  iteration:     ${tree.issue.iteration}`);
  core.info(`  failures:      ${tree.issue.failures}`);
  core.info(`  labels:        [${tree.issue.labels.join(", ")}]`);
  core.info(`  assignees:     [${tree.issue.assignees.join(", ")}]`);
  core.info(`  hasBranch:     ${tree.issue.hasBranch}`);
  core.info(`  hasPR:         ${tree.issue.hasPR}`);
  if (tree.issue.pr) {
    core.info(`  pr.isDraft:    ${tree.issue.pr.isDraft}`);
    core.info(`  pr.state:      ${tree.issue.pr.state}`);
  }

  core.info("");
  core.info("  Body structure:");
  const body = tree.issue.body;
  const flags = [
    ["hasDescription", body.hasDescription],
    ["hasRequirements", body.hasRequirements],
    ["hasApproach", body.hasApproach],
    ["hasAcceptanceCriteria", body.hasAcceptanceCriteria],
    ["hasTesting", body.hasTesting],
    ["hasRelated", body.hasRelated],
    ["hasTodos", body.hasTodos],
    ["hasHistory", body.hasHistory],
    ["hasAgentNotes", body.hasAgentNotes],
    ["hasQuestions", body.hasQuestions],
    ["hasAffectedAreas", body.hasAffectedAreas],
  ];
  for (const [name, value] of flags) {
    if (value) core.info(`    ${name}: ${String(value)}`);
  }

  if (body.todoStats) {
    core.info(
      `    todoStats: total=${body.todoStats.total} completed=${body.todoStats.completed}`,
    );
  }
  if (body.questionStats) {
    core.info(
      `    questionStats: total=${body.questionStats.total} answered=${body.questionStats.answered}`,
    );
  }
  if (body.historyEntries.length > 0) {
    core.info(`    historyEntries: ${body.historyEntries.length}`);
    for (const entry of body.historyEntries) {
      core.info(`      [${entry.iteration}] ${entry.phase}: ${entry.action}`);
    }
  }

  if (tree.subIssues.length > 0) {
    core.info("");
    core.info(`  Sub-issues: ${tree.subIssues.length}`);
    for (const sub of tree.subIssues) {
      core.info(
        `    #${sub.number}: status=${sub.projectStatus}, state=${sub.state}`,
      );
    }
  }

  core.endGroup();
}

async function run(): Promise<void> {
  try {
    const token = getRequiredInput("github_token");
    const expectedStateJson = getRequiredInput("expected_state_json");
    const projectNumber = parseInt(
      getOptionalInput("project_number") || "1",
      10,
    );

    // Step 1: Parse expected state
    if (!expectedStateJson || expectedStateJson === "") {
      core.info("No expected state provided — skipping verification");
      setOutputs({ verified: "true", diff_json: "{}" });
      return;
    }

    const expected = Verify.ExpectedStateSchema.parse(
      JSON.parse(expectedStateJson),
    );

    core.startGroup("Step 1: Expected State");
    core.info(`  finalState:        ${expected.finalState}`);
    core.info(`  trigger:           ${expected.trigger}`);
    core.info(`  issueNumber:       #${expected.issueNumber}`);
    core.info(`  parentIssueNumber: ${expected.parentIssueNumber ?? "none"}`);
    core.info(`  outcomes:          ${expected.outcomes.length}`);
    core.info(`  timestamp:         ${expected.timestamp}`);
    core.endGroup();

    for (let i = 0; i < expected.outcomes.length; i++) {
      logTree(`Step 1: Expected Outcome ${i}`, expected.outcomes[i]!);
    }

    // Step 2: Fetch actual issue state
    core.startGroup("Step 2: Fetch actual issue state");
    const octokit = github.getOctokit(token);
    const { owner, repo } = github.context.repo;

    core.info(
      `  Fetching issue #${expected.issueNumber} from ${owner}/${repo}`,
    );
    const { data } = await parseIssue(owner, repo, expected.issueNumber, {
      octokit: asOctokitLike(octokit),
      projectNumber,
      fetchPRs: true,
      fetchParent: true,
    });
    core.info(`  Issue title: ${data.issue.title}`);
    core.info(`  Issue state: ${data.issue.state}`);
    core.info(`  Project status: ${data.issue.projectStatus}`);
    core.endGroup();

    // Step 3: Build minimal MachineContext and extract actual tree
    core.startGroup("Step 3: Build MachineContext and extract actual tree");
    const machineContext = createMachineContext({
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- trigger from expected state is a valid TriggerType
      trigger: expected.trigger as Parameters<
        typeof createMachineContext
      >[0]["trigger"],
      owner: data.owner,
      repo: data.repo,
      issue: data.issue,
      parentIssue: data.parentIssue,
    });

    const actualTree = Verify.extractPredictableTree(machineContext);
    core.info("  Actual tree extracted successfully");
    core.endGroup();

    logTree("Step 3: Actual State", actualTree);

    // Step 4: Compare
    core.startGroup("Step 4: Compare expected vs actual");
    const result = Verify.compareStateTree(expected.outcomes, actualTree);

    if (result.pass) {
      core.info(
        `  Result: PASSED (matched outcome ${result.matchedOutcomeIndex})`,
      );
    } else {
      core.info(
        `  Result: FAILED (best match: outcome ${result.bestMatch.outcomeIndex}, ${result.bestMatch.diffs.length} diff(s))`,
      );
    }
    core.endGroup();

    // Step 5: Output results
    if (result.pass) {
      core.info("");
      core.info(
        `✅ Verification PASSED (matched outcome ${result.matchedOutcomeIndex})`,
      );

      // Write success summary
      await core.summary
        .addHeading("Verification Passed", 1)
        .addRaw(
          `Matched expected outcome **${result.matchedOutcomeIndex}** of ${expected.outcomes.length} for \`${expected.finalState}\` transition.`,
        )
        .write();

      setOutputs({ verified: "true", diff_json: "{}" });
    } else {
      const diffJson = JSON.stringify(result.bestMatch, null, 2);

      core.info("");
      core.error(
        `❌ Verification FAILED: ${result.bestMatch.diffs.length} diff(s) in best match (outcome ${result.bestMatch.outcomeIndex})`,
      );

      // Log each diff prominently
      core.startGroup("Diffs");
      for (const diff of result.bestMatch.diffs) {
        core.error(
          `  ${diff.path}:  expected=${JSON.stringify(diff.expected)}  actual=${JSON.stringify(diff.actual)}  (${diff.comparison})`,
        );
      }
      core.endGroup();

      // Write step summary
      await core.summary
        .addHeading("Verification Failed", 1)
        .addRaw(
          `Transition \`${expected.finalState}\` — best match was outcome **${result.bestMatch.outcomeIndex}** of ${expected.outcomes.length} with **${result.bestMatch.diffs.length}** diff(s).\n\n`,
        )
        .addTable([
          [
            { data: "Path", header: true },
            { data: "Expected", header: true },
            { data: "Actual", header: true },
            { data: "Comparison", header: true },
          ],
          ...result.bestMatch.diffs.map((d) => [
            `\`${d.path}\``,
            `\`${JSON.stringify(d.expected)}\``,
            `\`${JSON.stringify(d.actual)}\``,
            d.comparison,
          ]),
        ])
        .write();

      // Append verification failure to issue history
      try {
        const { data: issueData, update } = await parseIssue(
          owner,
          repo,
          expected.issueNumber,
          {
            octokit: asOctokitLike(octokit),
            fetchPRs: false,
            fetchParent: false,
          },
        );

        const state = addHistoryEntry(
          {
            iteration: data.issue.iteration ?? 0,
            phase: "-",
            action: HISTORY_MESSAGES.VERIFICATION_FAILED,
            timestamp: new Date().toISOString(),
          },
          issueData,
        );

        await update(state);
      } catch (error) {
        core.warning(`Failed to log verification failure: ${error}`);
      }

      setOutputs({ verified: "false", diff_json: diffJson });
      core.setFailed("State verification failed");
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(`Verification error: ${error.message}`);
    } else {
      core.setFailed("An unexpected error occurred during verification");
    }
  }
}

run();
