import { promptFactory, Conditional } from "@more/prompt-factory";

const TestAnalysis = promptFactory()
  .inputs((z) => ({
    testResultsFile: z.string(),
    scenarioDocsFile: z.string().optional(),
  }))
  .prompt((inputs) => (
    <prompt>
      <line>
        You are analyzing the results of an automated end-to-end test suite for
        a GitHub Actions state machine that automates issue management.
      </line>

      <section title="Instructions">
        {`1. **Read the test results file** at \`${inputs.testResultsFile}\` using the Read tool.
   The file contains a JSON object with:
   - \`workflow\`: metadata (run_id, run_url, branch, commit, batch statuses)
   - \`summary\`: pass/fail counts
   - \`results\`: array of individual test results with scenario, mode, batch, status, error fields`}

        <Conditional when={inputs.scenarioDocsFile}>
          {`

2. **Read the scenario documentation** at \`${inputs.scenarioDocsFile}\` using the Read tool.
   This contains README documentation for each failed scenario explaining expected behavior,
   state machine mechanics, expected field values, and why those values are correct.
   Use this to understand what SHOULD happen, then investigate why it DIDN'T.`}
        </Conditional>

        {`

3. **For failures, investigate job logs** using the \`gh\` CLI via Bash:
   - \`gh api repos/{owner}/{repo}/actions/runs/{run_id}/jobs\` to list jobs for the run
   - \`gh run view {run_id} --job {job_id} --log\` to get step logs
   - Focus on the "Run test" step logs which show Claude's reasoning during test execution
   - Look for assertion failures, unexpected state transitions, or timeout issues
   - The run_id is in the workflow metadata from the results file`}
      </section>

      <section title="Your Task">
        {`Analyze the test results and provide:

1. **Validity Assessment**
   - Are these test results valid? (not infrastructure issues)
   - Any flaky tests or timing issues?

2. **For Failures (if any)**
   - Consult the Scenario Documentation to understand what the test expects and why
   - Compare the expected state transitions against what actually happened
   - Root cause analysis: Is the guard wrong? Is an action not firing? Is a field not being updated?
   - Is it a test fixture issue, state machine bug, or external dependency?
   - Specific fix recommendation with file paths if possible

3. **Overall Health**
   - If all passing: Confirm suite health
   - If failures: Prioritize fixes
   - Actionable next steps

Format as GitHub-flavored markdown.`}
      </section>
    </prompt>
  ));

export default TestAnalysis;
