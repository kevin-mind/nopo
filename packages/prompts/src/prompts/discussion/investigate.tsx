import { promptFactory } from "@more/prompt-factory";

const DiscussionInvestigate = promptFactory()
  .inputs((z) => ({
    discussionNumber: z.number(),
    threadTitle: z.string(),
    threadQuestion: z.string(),
    investigationAreas: z.string(),
    expectedDeliverables: z.string(),
  }))
  .outputs((z) => ({
    findings: z.string(),
    key_points: z.array(z.string()),
    recommendations: z.array(z.string()).optional(),
    open_questions: z.array(z.string()).optional(),
    agent_notes: z.array(z.string()).optional(),
  }))
  .prompt((inputs) => (
    <prompt>
      <line>{`You are investigating a research thread for Discussion #${inputs.discussionNumber}.`}</line>

      <section title="Research Thread">
        {`**Title:** ${inputs.threadTitle}
**Question:** ${inputs.threadQuestion}`}

        <section title="Investigation Areas">
          {inputs.investigationAreas
            .split(",")
            .map((area) => `- ${area.trim()}`)
            .join("\n")}
        </section>

        <section title="Expected Deliverables">
          {inputs.expectedDeliverables
            .split(",")
            .map((d) => `- ${d.trim()}`)
            .join("\n")}
        </section>
      </section>

      {"---"}

      <section title="Your Task">
        {`Thoroughly investigate this research thread:

1. **Search the codebase** (grep, glob, read) to find relevant code and patterns
2. **Search GitHub** (\`gh issue list\`, \`gh pr list\`) for related discussions
3. **Check documentation** (decisions/, AGENTS.md, README.md)
4. **Web search** for external concepts, best practices, and industry standards

Be thorough - this is research, not a quick answer. Explore multiple angles.`}
      </section>

      <section title="Response Format">
        {`Structure your findings clearly:

\`\`\`markdown
## Findings

[Your detailed findings organized by investigation area]

### Key Points
- Bullet point summaries of main discoveries
- Include code references: \`path/file.ts:42\`

### Recommendations
- Actionable recommendations based on findings

### Open Questions
- Questions that need further investigation
- Unknowns that couldn't be resolved
\`\`\``}
      </section>

      <section title="Output">
        {`Return structured JSON with:

- **findings**: Comprehensive markdown write-up of your investigation
  - Cover each investigation area
  - Include code references
  - Cite external sources where applicable

- **key_points**: Array of the most important discoveries (3-7 items)

- **recommendations**: Array of actionable recommendations (optional)

- **open_questions**: Array of questions that remain unanswered (optional)

- **agent_notes**: Important context for future agents

The executor will post your findings as a reply to the research thread.`}
      </section>
    </prompt>
  ));

export default DiscussionInvestigate;
