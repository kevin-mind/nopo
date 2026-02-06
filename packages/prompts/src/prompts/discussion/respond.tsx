import { promptFactory, Conditional } from "@more/prompt-factory";
import { AgentNotes } from "../../components.js";

const DiscussionRespond = promptFactory()
  .inputs((z) => ({
    discussionNumber: z.number(),
    commentBody: z.string(),
    commentAuthor: z.string(),
    discussionBody: z.string(),
    agentNotes: z.string().optional(),
  }))
  .outputs((z) => ({
    response_body: z.string(),
    updated_body: z.string(),
    agent_notes: z.array(z.string()).optional(),
  }))
  .prompt((inputs) => (
    <prompt>
      <line>{`You are investigating a research thread or answering a question on Discussion #${inputs.discussionNumber}.`}</line>

      {`**Comment to respond to:** ${inputs.commentBody}
**Author:** @${inputs.commentAuthor}`}

      <Conditional when={inputs.agentNotes}>
        <AgentNotes notes={inputs.agentNotes!} />
      </Conditional>

      {"---"}

      <section title="Original Discussion Body">
        {inputs.discussionBody}
      </section>

      {"---"}

      <section title="Your Task">
        {`Research thoroughly but respond CONCISELY:
1. Search the codebase (grep, glob, read) to find relevant code
2. Search GitHub (\`gh issue list\`, \`gh pr list\`) for related discussions
3. Check documentation (decisions/, AGENTS.md, README.md)
4. Web search if helpful for understanding external concepts`}
      </section>

      <section title="Response Format (CRITICAL)">
        {`Your response MUST be:
- **Under 1000 words** - be concise and focused
- **Structured with headers** - easy to scan
- **Heavy on visuals** - diagrams, tables, lists over paragraphs

Response structure:
\`\`\`markdown
## Context Summary
> 1-2 sentence summary of what was investigated

## Findings

### <Finding 1>
- Bullet points, not paragraphs
- Code references: \`path/file.ts:42\`

### <Finding 2>
| Column 1 | Column 2 |
|----------|----------|
| Data     | Data     |

## Code References
- \`src/module/file.ts:123\` - Brief description
- \`src/other/file.ts:456\` - Brief description

## Diagram (if applicable)
\`\`\`mermaid
graph LR
  A[Component] --> B[Component]
\`\`\`

## Next Steps
- Actionable recommendation 1
- Actionable recommendation 2
\`\`\`

If they're asking for implementation: "Use \`/plan\` to create issues"`}
      </section>

      <section title="Output">
        {`Return structured JSON with:

- **response_body**: The comment to post (markdown, under 1000 words)

- **updated_body**: Updated discussion description incorporating findings
  - Preserve original user content (everything before \`---\`)
  - Update "## Current State" section with:
    - **Key Findings**: Validated discoveries
    - **Answered Questions**: \`**Q:** Question? **A:** Answer\`
    - **Data & Tables**: Link to comment with table
    - **Code References**: \`path/file.ts:123\` - Description
    - **Open Questions**: Remaining questions

- **agent_notes**: Important context for future agents

The executor will:
- Post the response as a comment
- Update the discussion description`}
      </section>
    </prompt>
  ));

export default DiscussionRespond;
