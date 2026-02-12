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
  executeBlock,
  executeUnassignUser,
  type RunnerContext,
} from "@more/statemachine";

function asOctokitLike(
  octokit: ReturnType<typeof github.getOctokit>,
): OctokitLike {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- @actions/github octokit type differs from OctokitLike but is compatible
  return octokit as unknown as OctokitLike;
}

// ============================================================================
// Full Comparison Table Logger
// ============================================================================

type CheckRow = {
  field: string;
  expected: string;
  actual: string;
  rule: string;
  pass: boolean;
};

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return `[${v.join(", ")}]`;
  return String(v);
}

/**
 * Build a full comparison table for an expected outcome vs actual tree.
 * Every field is included, each with a pass/fail result.
 */
function buildComparisonTable(
  expected: Verify.PredictableStateTree,
  actual: Verify.PredictableStateTree,
): CheckRow[] {
  const rows: CheckRow[] = [];
  const ei = expected.issue;
  const ai = actual.issue;

  // --- Issue-level fields ---

  rows.push({
    field: "issue.state",
    expected: fmt(ei.state),
    actual: fmt(ai.state),
    rule: "exact",
    pass: ei.state === ai.state,
  });

  rows.push({
    field: "issue.projectStatus",
    expected: fmt(ei.projectStatus),
    actual: fmt(ai.projectStatus),
    rule: "exact",
    pass: ei.projectStatus === ai.projectStatus,
  });

  rows.push({
    field: "issue.iteration",
    expected: fmt(ei.iteration),
    actual: fmt(ai.iteration),
    rule: "actual >= expected",
    pass: ai.iteration >= ei.iteration,
  });

  const failuresPass = ei.failures === ai.failures || ai.failures === 0;
  rows.push({
    field: "issue.failures",
    expected: fmt(ei.failures),
    actual: fmt(ai.failures),
    rule: "exact or 0",
    pass: failuresPass,
  });

  const missingLabels = ei.labels.filter((l) => !ai.labels.includes(l));
  rows.push({
    field: "issue.labels",
    expected: fmt(ei.labels),
    actual: fmt(ai.labels),
    rule: "expected ⊆ actual",
    pass: missingLabels.length === 0,
  });

  const missingAssignees = ei.assignees.filter(
    (a) => !ai.assignees.includes(a),
  );
  rows.push({
    field: "issue.assignees",
    expected: fmt(ei.assignees),
    actual: fmt(ai.assignees),
    rule: "expected ⊆ actual",
    pass: missingAssignees.length === 0,
  });

  // Boolean flags: only enforced when expected=true
  rows.push({
    field: "issue.hasBranch",
    expected: fmt(ei.hasBranch),
    actual: fmt(ai.hasBranch),
    rule: "if expected=true",
    pass: !ei.hasBranch || ai.hasBranch,
  });

  rows.push({
    field: "issue.hasPR",
    expected: fmt(ei.hasPR),
    actual: fmt(ai.hasPR),
    rule: "if expected=true",
    pass: !ei.hasPR || ai.hasPR,
  });

  // PR fields
  if (ei.pr && ai.pr) {
    rows.push({
      field: "issue.pr.isDraft",
      expected: fmt(ei.pr.isDraft),
      actual: fmt(ai.pr.isDraft),
      rule: "exact",
      pass: ei.pr.isDraft === ai.pr.isDraft,
    });
    rows.push({
      field: "issue.pr.state",
      expected: fmt(ei.pr.state),
      actual: fmt(ai.pr.state),
      rule: "exact",
      pass: ei.pr.state === ai.pr.state,
    });
  } else if (ei.pr && !ai.pr) {
    rows.push({
      field: "issue.pr",
      expected: "present",
      actual: "null",
      rule: "exact",
      pass: false,
    });
  }

  // --- Body structure flags ---
  const eb = ei.body;
  const ab = ai.body;

  const bodyFlags = [
    "hasDescription",
    "hasTodos",
    "hasHistory",
    "hasAgentNotes",
    "hasQuestions",
    "hasAffectedAreas",
    "hasRequirements",
    "hasApproach",
    "hasAcceptanceCriteria",
    "hasTesting",
    "hasRelated",
  ] as const;

  for (const flag of bodyFlags) {
    const expVal = eb[flag];
    const actVal = ab[flag];
    // Only enforced when expected=true
    const pass = !expVal || actVal;
    rows.push({
      field: `issue.body.${flag}`,
      expected: fmt(expVal),
      actual: fmt(actVal),
      rule: "if expected=true",
      pass,
    });
  }

  // Todo stats
  if (eb.todoStats) {
    if (ab.todoStats) {
      rows.push({
        field: "issue.body.todoStats.total",
        expected: fmt(eb.todoStats.total),
        actual: fmt(ab.todoStats.total),
        rule: "actual >= expected",
        pass: ab.todoStats.total >= eb.todoStats.total,
      });
      rows.push({
        field: "issue.body.todoStats.completed",
        expected: fmt(eb.todoStats.completed),
        actual: fmt(ab.todoStats.completed),
        rule: "actual >= expected",
        pass: ab.todoStats.completed >= eb.todoStats.completed,
      });
      rows.push({
        field: "issue.body.todoStats.uncheckedNonManual",
        expected: fmt(eb.todoStats.uncheckedNonManual),
        actual: fmt(ab.todoStats.uncheckedNonManual),
        rule: "actual <= expected",
        pass:
          ab.todoStats.uncheckedNonManual <= eb.todoStats.uncheckedNonManual,
      });
    } else {
      rows.push({
        field: "issue.body.todoStats",
        expected: "present",
        actual: "null",
        rule: "present",
        pass: false,
      });
    }
  }

  // Question stats
  if (eb.questionStats) {
    if (ab.questionStats) {
      rows.push({
        field: "issue.body.questionStats.total",
        expected: fmt(eb.questionStats.total),
        actual: fmt(ab.questionStats.total),
        rule: "actual >= expected",
        pass: ab.questionStats.total >= eb.questionStats.total,
      });
      rows.push({
        field: "issue.body.questionStats.answered",
        expected: fmt(eb.questionStats.answered),
        actual: fmt(ab.questionStats.answered),
        rule: "actual >= expected",
        pass: ab.questionStats.answered >= eb.questionStats.answered,
      });
    } else {
      rows.push({
        field: "issue.body.questionStats",
        expected: "present",
        actual: "null",
        rule: "present",
        pass: false,
      });
    }
  }

  // History entries
  for (const expEntry of eb.historyEntries) {
    const found = ab.historyEntries.some(
      (act) =>
        act.iteration === expEntry.iteration &&
        act.phase === expEntry.phase &&
        act.action.startsWith(expEntry.action),
    );
    let actualDisplay: string;
    if (found) {
      actualDisplay = "(matched)";
    } else {
      // Show why it failed: text match at wrong iter/phase, or not found at all
      const textMatch = ab.historyEntries.find((act) =>
        act.action.startsWith(expEntry.action),
      );
      if (textMatch) {
        actualDisplay = `found "${textMatch.action}" but at iter=${textMatch.iteration}/phase=${textMatch.phase}`;
      } else {
        // Show entries at the expected iter/phase to help debug
        const sameKey = ab.historyEntries.filter(
          (act) =>
            act.iteration === expEntry.iteration &&
            act.phase === expEntry.phase,
        );
        actualDisplay =
          sameKey.length > 0
            ? `at [${expEntry.iteration}/${expEntry.phase}]: ${sameKey.map((e) => e.action).join(", ")}`
            : `no entries at iter=${expEntry.iteration}/phase=${expEntry.phase}`;
      }
    }
    rows.push({
      field: `issue.body.history[${expEntry.iteration}/${expEntry.phase}]`,
      expected: expEntry.action,
      actual: actualDisplay,
      rule: "entry present",
      pass: found,
    });
  }

  // --- Sub-issues ---
  for (const expSub of expected.subIssues) {
    const actSub = actual.subIssues.find((s) => s.number === expSub.number);
    if (!actSub) {
      rows.push({
        field: `sub[#${expSub.number}]`,
        expected: "present",
        actual: "missing",
        rule: "exists",
        pass: false,
      });
      continue;
    }

    const prefix = `sub[#${expSub.number}]`;

    rows.push({
      field: `${prefix}.state`,
      expected: fmt(expSub.state),
      actual: fmt(actSub.state),
      rule: "exact",
      pass: expSub.state === actSub.state,
    });

    rows.push({
      field: `${prefix}.projectStatus`,
      expected: fmt(expSub.projectStatus),
      actual: fmt(actSub.projectStatus),
      rule: "exact",
      pass: expSub.projectStatus === actSub.projectStatus,
    });

    const subMissingLabels = expSub.labels.filter(
      (l) => !actSub.labels.includes(l),
    );
    rows.push({
      field: `${prefix}.labels`,
      expected: fmt(expSub.labels),
      actual: fmt(actSub.labels),
      rule: "expected ⊆ actual",
      pass: subMissingLabels.length === 0,
    });

    rows.push({
      field: `${prefix}.hasBranch`,
      expected: fmt(expSub.hasBranch),
      actual: fmt(actSub.hasBranch),
      rule: "if expected=true",
      pass: !expSub.hasBranch || actSub.hasBranch,
    });

    rows.push({
      field: `${prefix}.hasPR`,
      expected: fmt(expSub.hasPR),
      actual: fmt(actSub.hasPR),
      rule: "if expected=true",
      pass: !expSub.hasPR || actSub.hasPR,
    });

    if (expSub.pr && actSub.pr) {
      rows.push({
        field: `${prefix}.pr.isDraft`,
        expected: fmt(expSub.pr.isDraft),
        actual: fmt(actSub.pr.isDraft),
        rule: "exact",
        pass: expSub.pr.isDraft === actSub.pr.isDraft,
      });
      rows.push({
        field: `${prefix}.pr.state`,
        expected: fmt(expSub.pr.state),
        actual: fmt(actSub.pr.state),
        rule: "exact",
        pass: expSub.pr.state === actSub.pr.state,
      });
    }

    // Sub-issue body flags
    const subBodyFlags = [
      "hasDescription",
      "hasTodos",
      "hasHistory",
      "hasAgentNotes",
      "hasQuestions",
      "hasAffectedAreas",
    ] as const;

    for (const flag of subBodyFlags) {
      const expVal = expSub.body[flag];
      const actVal = actSub.body[flag];
      rows.push({
        field: `${prefix}.body.${flag}`,
        expected: fmt(expVal),
        actual: fmt(actVal),
        rule: "if expected=true",
        pass: !expVal || actVal,
      });
    }

    // Sub-issue history
    for (const expEntry of expSub.body.historyEntries) {
      const found = actSub.body.historyEntries.some(
        (act) =>
          act.iteration === expEntry.iteration &&
          act.phase === expEntry.phase &&
          act.action.startsWith(expEntry.action),
      );
      let actualDisplay: string;
      if (found) {
        actualDisplay = "(matched)";
      } else {
        const textMatch = actSub.body.historyEntries.find((act) =>
          act.action.startsWith(expEntry.action),
        );
        if (textMatch) {
          actualDisplay = `found "${textMatch.action}" but at iter=${textMatch.iteration}/phase=${textMatch.phase}`;
        } else {
          const sameKey = actSub.body.historyEntries.filter(
            (act) =>
              act.iteration === expEntry.iteration &&
              act.phase === expEntry.phase,
          );
          actualDisplay =
            sameKey.length > 0
              ? `at [${expEntry.iteration}/${expEntry.phase}]: ${sameKey.map((e) => e.action).join(", ")}`
              : `no entries at iter=${expEntry.iteration}/phase=${expEntry.phase}`;
        }
      }
      rows.push({
        field: `${prefix}.body.history[${expEntry.iteration}/${expEntry.phase}]`,
        expected: expEntry.action,
        actual: actualDisplay,
        rule: "entry present",
        pass: found,
      });
    }
  }

  return rows;
}

/**
 * Log a comparison table to the console and return summary markdown.
 */
function logComparisonTable(outcomeIndex: number, rows: CheckRow[]): string {
  const passed = rows.filter((r) => r.pass).length;
  const failed = rows.filter((r) => !r.pass).length;
  const total = rows.length;
  const icon = failed === 0 ? "✅" : "❌";

  core.startGroup(
    `${icon} Outcome ${outcomeIndex}: ${passed}/${total} checks passed, ${failed} failed`,
  );

  // Find max field length for alignment
  const maxField = Math.max(...rows.map((r) => r.field.length), 5);

  for (const row of rows) {
    const status = row.pass ? "✅" : "❌";
    const paddedField = row.field.padEnd(maxField);
    const line = `  ${status}  ${paddedField}  expected=${row.expected}  actual=${row.actual}  (${row.rule})`;
    if (row.pass) {
      core.info(line);
    } else {
      core.error(line);
    }
  }

  core.endGroup();

  // Build markdown table for step summary
  let md = `### Outcome ${outcomeIndex}: ${passed}/${total} passed, ${failed} failed\n\n`;
  md += "| | Field | Expected | Actual | Rule |\n";
  md += "|---|---|---|---|---|\n";
  for (const row of rows) {
    const status = row.pass ? "✅" : "❌";
    md += `| ${status} | \`${row.field}\` | \`${row.expected}\` | \`${row.actual}\` | ${row.rule} |\n`;
  }
  return md;
}

// ============================================================================
// Main
// ============================================================================

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

    const actualShouldRetrigger = getOptionalInput("actual_should_retrigger");

    core.startGroup("Step 1: Expected State");
    core.info(`  finalState:         ${expected.finalState}`);
    core.info(`  trigger:            ${expected.trigger}`);
    core.info(`  issueNumber:        #${expected.issueNumber}`);
    core.info(`  parentIssueNumber:  ${expected.parentIssueNumber ?? "none"}`);
    core.info(`  outcomes:           ${expected.outcomes.length}`);
    core.info(`  expectedRetrigger:  ${expected.expectedRetrigger}`);
    core.info(
      `  actualRetrigger:    ${actualShouldRetrigger || "(not provided)"}`,
    );
    core.info(`  timestamp:          ${expected.timestamp}`);
    core.endGroup();

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

    // Step 3: Build MachineContext and extract actual tree
    core.startGroup("Step 3: Extract actual state tree");
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

    // Step 4: Compare — run the engine, then log full table for each outcome
    const result = Verify.compareStateTree(expected.outcomes, actualTree);

    core.info("");
    core.info(
      `=== Comparison: ${expected.outcomes.length} outcome(s) vs actual ===`,
    );
    core.info("");

    const summaryParts: string[] = [];

    for (let i = 0; i < expected.outcomes.length; i++) {
      const outcome = expected.outcomes[i]!;
      const rows = buildComparisonTable(outcome, actualTree);
      const md = logComparisonTable(i, rows);
      summaryParts.push(md);
    }

    // Step 4b: Check retrigger expectation
    let retriggerPass = true;
    let retriggerMd = "";

    if (actualShouldRetrigger !== undefined && actualShouldRetrigger !== "") {
      const actualRetrigger = actualShouldRetrigger === "true";
      retriggerPass = expected.expectedRetrigger === actualRetrigger;
      const icon = retriggerPass ? "✅" : "❌";

      core.info("");
      core.info(`=== Retrigger Check ===`);
      core.info(
        `  ${icon}  expected=${expected.expectedRetrigger}  actual=${actualRetrigger}  (exact)`,
      );

      retriggerMd = `### Retrigger Check\n\n`;
      retriggerMd += "| | Field | Expected | Actual | Rule |\n";
      retriggerMd += "|---|---|---|---|---|\n";
      retriggerMd += `| ${icon} | \`retrigger\` | \`${expected.expectedRetrigger}\` | \`${actualRetrigger}\` | exact |\n`;

      summaryParts.push(retriggerMd);
    }

    // Step 5: Output results — tree comparison AND retrigger must both pass
    const overallPass = result.pass && retriggerPass;

    if (overallPass) {
      core.info("");
      core.info(
        `✅ Verification PASSED (matched outcome ${result.matchedOutcomeIndex})`,
      );

      await core.summary
        .addHeading("✅ Verification Passed", 1)
        .addRaw(
          `Matched expected outcome **${result.matchedOutcomeIndex}** of ${expected.outcomes.length} for \`${expected.finalState}\` transition.\n\n`,
        )
        .addRaw(summaryParts.join("\n"))
        .write();

      setOutputs({ verified: "true", diff_json: "{}" });
    } else {
      const failReasons: string[] = [];
      if (!result.pass) {
        failReasons.push(
          `no outcome matched (best: outcome ${result.bestMatch.outcomeIndex} with ${result.bestMatch.diffs.length} diff(s))`,
        );
      }
      if (!retriggerPass) {
        failReasons.push(
          `retrigger mismatch (expected=${expected.expectedRetrigger}, actual=${actualShouldRetrigger})`,
        );
      }

      core.info("");
      core.error(`❌ Verification FAILED — ${failReasons.join("; ")}`);

      const diffJson = JSON.stringify(
        {
          ...result.bestMatch,
          retriggerPass,
        },
        null,
        2,
      );

      await core.summary
        .addHeading("❌ Verification Failed", 1)
        .addRaw(
          `Transition \`${expected.finalState}\` — ${failReasons.join("; ")}.\n\n`,
        )
        .addRaw(summaryParts.join("\n"))
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

      // Block the issue and unassign bot to prevent further state machine runs
      try {
        const runnerCtx: RunnerContext = {
          octokit,
          owner,
          repo,
          projectNumber,
          serverUrl: process.env.GITHUB_SERVER_URL || "https://github.com",
        };

        await executeBlock(
          {
            type: "block",
            token: "code",
            issueNumber: expected.issueNumber,
            reason: "Verification failed",
          },
          runnerCtx,
        );

        await executeUnassignUser(
          {
            type: "unassignUser",
            token: "code",
            issueNumber: expected.issueNumber,
            username: "nopo-bot",
          },
          runnerCtx,
        );

        core.info(
          `Blocked issue #${expected.issueNumber} and unassigned nopo-bot`,
        );
      } catch (error) {
        core.warning(
          `Failed to block issue after verification failure: ${error}`,
        );
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
