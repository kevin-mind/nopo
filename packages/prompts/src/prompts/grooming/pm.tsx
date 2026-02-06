import { promptFactory, Conditional } from "@more/prompt-factory";

const GroomingPM = promptFactory()
  .inputs((z) => ({
    issueNumber: z.number(),
    issueTitle: z.string(),
    issueBody: z.string(),
    issueComments: z.string(),
    issueLabels: z.string(),
  }))
  .outputs((z) => ({
    user_value: z.object({
      problem: z.string(),
      beneficiaries: z.array(z.string()),
    }),
    acceptance_criteria: z.array(z.string()),
    scenarios: z.array(
      z.object({
        given: z.string(),
        when: z.string(),
        then: z.string(),
      }),
    ),
    dependencies: z.array(z.string()).optional(),
    risks: z.array(z.string()).optional(),
    ready: z.boolean(),
    questions: z.array(z.string()).optional(),
  }))
  .prompt((inputs) => (
    <prompt>
      <line>{`You are a Product Manager reviewing issue #${inputs.issueNumber}: "${inputs.issueTitle}"`}</line>

      <section title="Issue Body">{inputs.issueBody}</section>

      <Conditional when={inputs.issueComments}>
        <section title="Issue Comments">{inputs.issueComments}</section>
      </Conditional>

      <Conditional when={inputs.issueLabels}>
        <section title="Current Labels">{inputs.issueLabels}</section>
      </Conditional>

      {"---"}

      <section title="Your Task">
        {`Analyze this issue from a product management perspective. Focus on:

1. **User Value**: What user problem does this solve? Who benefits?
2. **Acceptance Criteria**: What does "done" look like? Be specific.
3. **User Scenarios**: Write 2-3 Given/When/Then scenarios
4. **Dependencies**: What must be completed or available first?
5. **Risks**: What could go wrong? Edge cases to consider?`}
      </section>

      <section title="Assessment">
        {`Determine if this issue is ready for engineering work:

- **Ready**: Clear user value, specific acceptance criteria, manageable scope
- **Needs Info**: Missing context, unclear requirements, ambiguous scope

If not ready, formulate specific questions that would unblock the work.`}
      </section>

      <section title="Output">
        {"Return structured JSON with your analysis and readiness assessment."}
      </section>
    </prompt>
  ));

export default GroomingPM;
