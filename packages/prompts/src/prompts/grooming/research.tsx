import { promptFactory, Conditional } from "@more/prompt-factory";

const GroomingResearch = promptFactory()
  .inputs((z) => ({
    issueNumber: z.number(),
    issueTitle: z.string(),
    issueBody: z.string(),
    issueComments: z.string(),
    issueLabels: z.string(),
  }))
  .outputs((z) => ({
    related_issues: z
      .array(
        z.object({
          number: z.number(),
          title: z.string(),
          relationship: z.enum([
            "duplicate",
            "related",
            "blocks",
            "blocked-by",
          ]),
          status: z.enum(["open", "closed"]),
          relevance: z.string().optional(),
        }),
      )
      .optional(),
    related_prs: z
      .array(
        z.object({
          number: z.number(),
          title: z.string(),
          status: z.enum(["open", "merged", "closed"]),
          relevance: z.string().optional(),
        }),
      )
      .optional(),
    related_discussions: z
      .array(
        z.object({
          number: z.number(),
          title: z.string(),
          relevance: z.string().optional(),
        }),
      )
      .optional(),
    prior_art: z
      .object({
        attempted_before: z.boolean(),
        summary: z.string().optional(),
        lessons: z.array(z.string()).optional(),
      })
      .optional(),
    codebase_context: z
      .array(
        z.object({
          path: z.string(),
          relevance: z.string(),
        }),
      )
      .optional(),
    context_summary: z.string(),
    ready: z.boolean(),
    questions: z.array(z.string()).optional(),
  }))
  .prompt((inputs) => (
    <prompt>
      <line>{`You are a Research Analyst reviewing issue #${inputs.issueNumber}: "${inputs.issueTitle}"`}</line>

      <section title="Issue Body">{inputs.issueBody}</section>

      <Conditional when={inputs.issueComments}>
        <section title="Issue Comments">{inputs.issueComments}</section>
      </Conditional>

      <Conditional when={inputs.issueLabels}>
        <section title="Current Labels">{inputs.issueLabels}</section>
      </Conditional>

      {"---"}

      <section title="Your Task">
        {`Research context and prior art for this issue. Focus on:

1. **Related Issues**: Find similar issues, duplicates, or related work
2. **Related PRs**: Find relevant PRs (merged, open, or closed)
3. **Related Discussions**: Find relevant GitHub discussions
4. **Prior Art**: Has this been attempted before? What happened?
5. **Codebase Context**: Key files or modules relevant to this work
6. **Readiness**: Based on your research, is there enough context to proceed?`}
      </section>

      <section title="Research Methods">
        {`Use the GitHub CLI and codebase search to find:
- \`gh issue list --search "keywords"\` - find related issues
- \`gh pr list --search "keywords"\` - find related PRs
- Grep/search for relevant code patterns`}
      </section>

      <section title="Output">
        {`Return structured JSON with your research findings. Focus on actionable context that will help implementation.

Set ready=true if research found no blockers or duplicates. Set ready=false with questions if critical context is missing.`}
      </section>
    </prompt>
  ));

export default GroomingResearch;
