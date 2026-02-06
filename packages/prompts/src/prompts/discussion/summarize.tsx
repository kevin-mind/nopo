import { promptFactory, Conditional } from "@more/prompt-factory";
import { AgentNotes } from "../../components.js";

const DiscussionSummarize = promptFactory()
  .inputs((z) => ({
    discussionNumber: z.number(),
    discussionTitle: z.string(),
    discussionBody: z.string(),
    repoOwner: z.string(),
    repoName: z.string(),
    agentNotes: z.string().optional(),
  }))
  .outputs((z) => ({
    updated_body: z.string(),
    summary_comment: z.string(),
    agent_notes: z.array(z.string()).optional(),
  }))
  .prompt((inputs) => (
    <prompt>
      <line>{`You are summarizing Discussion #${inputs.discussionNumber}.`}</line>

      {`**Discussion title:** ${inputs.discussionTitle}`}

      <section title="Original Discussion Body">
        {inputs.discussionBody}
      </section>

      <Conditional when={inputs.agentNotes}>
        <AgentNotes notes={inputs.agentNotes!} />
      </Conditional>

      {"---"}

      <section title="Your Task">
        {
          "Fetch the full discussion content, analyze all comments, and create a comprehensive summary."
        }

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

      <section title="Summary Structure">
        {`Organize findings into:
- **Summary**: High-level overview of discoveries/decisions
- **Key Findings**: Validated facts from the discussion
- **Answered Questions**: Q&A pairs extracted from comments
- **Decisions**: Any decisions made with rationale
- **Code References**: Relevant file paths and line numbers
- **Related Resources**: Links to issues, PRs, external docs
- **Open Questions**: Unanswered questions
- **Next Steps**: Recommended actions`}
      </section>

      <section title="Output">
        {`Return structured JSON with:

- **updated_body**: Updated discussion description as a comprehensive summary
  - Preserve original user content at the top
  - Create authoritative "## Current State" section synthesizing ALL findings
  - Include all sections that have content (see structure above)

- **summary_comment**: Brief comment to post announcing the summary
  - Point users to the updated description
  - Highlight key findings and next steps

- **agent_notes**: Important context for future agents

The executor will:
- Update the discussion description
- Post the summary comment`}
      </section>
    </prompt>
  ));

export default DiscussionSummarize;
