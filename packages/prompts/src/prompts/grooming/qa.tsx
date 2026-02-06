import { promptFactory, Conditional } from "@more/prompt-factory";

const GroomingQA = promptFactory()
  .inputs((z) => ({
    issueNumber: z.number(),
    issueTitle: z.string(),
    issueBody: z.string(),
    issueComments: z.string(),
    issueLabels: z.string(),
  }))
  .outputs((z) => ({
    test_strategy: z.object({
      unit_tests: z.boolean(),
      integration_tests: z.boolean(),
      e2e_tests: z.boolean(),
      rationale: z.string(),
    }),
    test_cases: z.array(
      z.object({
        name: z.string(),
        type: z.enum(["unit", "integration", "e2e"]),
        description: z.string(),
        priority: z.enum(["must-have", "should-have", "nice-to-have"]),
        manual: z.boolean(),
      }),
    ),
    edge_cases: z.array(z.string()).optional(),
    regression_risks: z
      .array(
        z.object({
          area: z.string(),
          test_coverage: z.enum(["exists", "needs-update", "missing"]),
        }),
      )
      .optional(),
    test_infrastructure: z.array(z.string()).optional(),
    ready: z.boolean(),
    questions: z.array(z.string()).optional(),
  }))
  .prompt((inputs) => (
    <prompt>
      <line>{`You are a QA Engineer reviewing issue #${inputs.issueNumber}: "${inputs.issueTitle}"`}</line>

      <section title="Issue Body">{inputs.issueBody}</section>

      <Conditional when={inputs.issueComments}>
        <section title="Issue Comments">{inputs.issueComments}</section>
      </Conditional>

      <Conditional when={inputs.issueLabels}>
        <section title="Current Labels">{inputs.issueLabels}</section>
      </Conditional>

      {"---"}

      <section title="Your Task">
        {`Analyze this issue from a quality assurance perspective. Focus on:

1. **Test Strategy**: What types of tests are needed? (unit, integration, e2e)
2. **Test Cases**: Specific scenarios to test
   - Each test case has a \`manual\` field:
     - \`manual: false\` = **[Auto]** - Claude writes this test during iteration
     - \`manual: true\` = **[Manual]** - Requires human action (manual verification, external system testing)
   - Most code tests (unit, integration) should be \`manual: false\` (Claude writes them)
   - E2E tests that can be automated should also be \`manual: false\`
   - Only mark \`manual: true\` for tests requiring human judgment or external systems
3. **Edge Cases**: Boundary conditions and unusual inputs
4. **Regression Risks**: What existing functionality could break?
5. **Test Infrastructure**: Any test setup or infrastructure needed?`}
      </section>

      <section title="Assessment">
        {`Determine if this issue has adequate testability:

- **Ready**: Clear test scenarios, reasonable test coverage achievable
- **Needs Info**: Unclear expected behavior, missing test data requirements

If not ready, specify what information is needed to write good tests.`}
      </section>

      <section title="Output">
        {"Return structured JSON with your QA analysis."}
      </section>
    </prompt>
  ));

export default GroomingQA;
