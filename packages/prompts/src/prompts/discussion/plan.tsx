import { promptFactory, Conditional } from "@more/prompt-factory";
import { AgentNotes } from "../../components.js";

const DiscussionPlan = promptFactory()
  .inputs((z) => ({
    discussionNumber: z.number(),
    discussionTitle: z.string(),
    discussionBody: z.string(),
    repoOwner: z.string(),
    repoName: z.string(),
    isE2ETest: z.boolean().optional(),
    agentNotes: z.string().optional(),
  }))
  .outputs((z) => ({
    issues: z.array(
      z.object({
        title: z.string(),
        body: z.string(),
        labels: z.array(z.string()).optional(),
      }),
    ),
    updated_body: z.string(),
    summary_comment: z.string(),
    agent_notes: z.array(z.string()).optional(),
  }))
  .prompt((inputs) => (
    <prompt>
      <line>{`A user requested a plan for Discussion #${inputs.discussionNumber}.`}</line>

      {`**Discussion title:** ${inputs.discussionTitle}`}

      <section title="Original Discussion Body">
        {inputs.discussionBody}
      </section>

      <Conditional when={inputs.agentNotes}>
        <AgentNotes notes={inputs.agentNotes!} />
      </Conditional>

      {"---"}

      <section title="Your Task">
        {`1. Fetch the full discussion content using gh api graphql
2. Search the codebase to understand current architecture
3. Extract actionable items and define issues`}

        <codeblock lang="bash">
          {`gh api graphql -f query='
  query($number: Int!) {
    repository(owner: "${inputs.repoOwner}", name: "${inputs.repoName}") {
      discussion(number: $number) {
        body
        comments(first: 100) {
          nodes {
            author { login }
            body
            replies(first: 50) {
              nodes {
                author { login }
                body
              }
            }
          }
        }
      }
    }
  }
' -F number=${inputs.discussionNumber}`}
        </codeblock>
      </section>

      <section title="Issue Guidelines">
        {`Each issue should:
- Have a clear, actionable title
- Include context from the discussion
- Have specific tasks/todos
- Be appropriately sized (prefer smaller issues)

Issue body template:
\`\`\`markdown
Related to discussion: #${inputs.discussionNumber}

## Context
[Context from discussion]

## Tasks
- [ ] Task 1
- [ ] Task 2
\`\`\``}
      </section>

      <Conditional when={inputs.isE2ETest !== undefined}>
        <section title="E2E Test Mode">
          {`**IS_E2E_TEST**: ${inputs.isE2ETest}

If IS_E2E_TEST is "true", include \`test:automation\` label on all issues to prevent automatic processing.`}
        </section>
      </Conditional>

      <section title="Output">
        {`Return structured JSON with:

- **issues**: Array of issues to create, each with:
  - \`title\`: Issue title
  - \`body\`: Issue body with context and tasks
  - \`labels\`: Array of labels (always include \`discussion:${inputs.discussionNumber}\`, add \`test:automation\` if IS_E2E_TEST)

- **updated_body**: Updated discussion description
  - Preserve original content
  - Add "### Implementation Plan" section with issue references (use placeholders like \`#ISSUE_1\`, \`#ISSUE_2\`)

- **summary_comment**: Comment to post after issues are created
  - List created issues with titles
  - Note that assigning nopo-bot will start implementation

- **agent_notes**: Important context for future agents

The executor will:
- Create each issue via gh issue create
- Replace issue placeholders in updated_body with actual numbers
- Update the discussion description
- Post the summary comment`}
      </section>
    </prompt>
  ));

export default DiscussionPlan;
