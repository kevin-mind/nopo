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

    core.info(
      `Expected: finalState=${expected.finalState}, outcomes=${expected.outcomes.length}, issue=#${expected.issueNumber}`,
    );

    // Step 2: Fetch actual issue state
    const octokit = github.getOctokit(token);
    const { owner, repo } = github.context.repo;

    const { data } = await parseIssue(owner, repo, expected.issueNumber, {
      octokit: asOctokitLike(octokit),
      projectNumber,
      fetchPRs: true,
      fetchParent: true,
    });

    // Step 3: Build minimal MachineContext and extract actual tree
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

    // Step 4: Compare
    const result = Verify.compareStateTree(expected.outcomes, actualTree);

    // Step 5: Output results
    if (result.pass) {
      core.info(
        `Verification PASSED (matched outcome ${result.matchedOutcomeIndex})`,
      );
      setOutputs({ verified: "true", diff_json: "{}" });
    } else {
      const diffJson = JSON.stringify(result.bestMatch, null, 2);

      core.error(
        `Verification FAILED: ${result.bestMatch.diffs.length} diff(s) in best match (outcome ${result.bestMatch.outcomeIndex})`,
      );

      // Log each diff
      for (const diff of result.bestMatch.diffs) {
        core.error(
          `  ${diff.path}: expected=${JSON.stringify(diff.expected)} actual=${JSON.stringify(diff.actual)} (${diff.comparison})`,
        );
      }

      // Write step summary
      core.summary
        .addHeading("Verification Failed", 1)
        .addTable([
          [
            { data: "Path", header: true },
            { data: "Expected", header: true },
            { data: "Actual", header: true },
            { data: "Comparison", header: true },
          ],
          ...result.bestMatch.diffs.map((d) => [
            d.path,
            JSON.stringify(d.expected),
            JSON.stringify(d.actual),
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
