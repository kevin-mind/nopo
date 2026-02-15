import { promptFactory } from "@more/prompt-factory";

const Doctor = promptFactory()
  .inputs((z) => ({
    diagnosisFile: z.string(),
  }))
  .outputs((z) => ({
    classification: z.enum([
      "false_negative",
      "true_bug",
      "race_condition",
      "unknown",
    ]),
    confidence: z.number(),
    root_cause: z.string(),
    fix_summary: z.string(),
    affected_files: z.array(z.string()),
  }))
  .prompt((inputs) => (
    <prompt>
      <line>You are diagnosing a state machine verification failure.</line>

      <section title="Instructions">
        {`1. **Read the diagnosis file** at \`${inputs.diagnosisFile}\` using the Read tool.
   The file contains a JSON object with:
   - \`expectedState\`: the predicted post-run state from sm-plan
   - \`actualTree\`: the actual issue state after sm-run executed
   - \`diffJson\`: structured diff showing field-level mismatches
   - \`summaryMarkdown\`: human-readable summary of the verification failure
   - \`retriggerMismatch\`: whether the retrigger flag was wrong
   - \`workflowRunUrl\`: link to the failed workflow run

2. **Read the relevant source code** in \`packages/statemachine/\`:
   - Predictors: \`src/core/predictors/\` — predict post-run state
   - Mutators: \`src/core/mutators/\` — execute state changes
   - Compare logic: \`src/core/verify/\` — compare expected vs actual
   - Actions: \`src/core/actions/\` — action implementations

3. **Determine the root cause**:
   - **false_negative**: The prediction is wrong (predictor bug) but execution was correct
   - **true_bug**: The execution produced wrong state (mutator/action bug)
   - **race_condition**: Timing issue between predict and verify
   - **unknown**: Cannot determine with confidence

4. **Fix the code** — edit the relevant files in \`packages/statemachine/\`

5. **Add a test case** that reproduces this specific failure scenario

6. **Run tests**: \`cd packages/statemachine && pnpm exec vitest run\``}
      </section>

      <section title="Output">
        {`Return structured JSON with:
- \`classification\`: one of false_negative, true_bug, race_condition, unknown
- \`confidence\`: 0-1 confidence score
- \`root_cause\`: detailed explanation of what went wrong
- \`fix_summary\`: what was changed and why
- \`affected_files\`: list of files that were modified`}
      </section>
    </prompt>
  ));

export default Doctor;
