import { promptFactory, Conditional } from "@more/prompt-factory";
import { AgentNotes } from "../../components.js";

const DiscussionResearch = promptFactory()
  .inputs((z) => ({
    discussionTitle: z.string(),
    discussionBody: z.string(),
    agentNotes: z.string().optional(),
  }))
  .outputs((z) => ({
    threads: z.array(
      z.object({
        title: z.string(),
        question: z.string(),
        investigation_areas: z.array(z.string()),
        expected_deliverables: z.array(z.string()),
      }),
    ),
    updated_body: z.string(),
    agent_notes: z.array(z.string()).optional(),
  }))
  .prompt((inputs) => (
    <prompt>
      <line>{`A new discussion was created: **${inputs.discussionTitle}**`}</line>

      <section title="Discussion body">{inputs.discussionBody}</section>

      <Conditional when={inputs.agentNotes}>
        <AgentNotes notes={inputs.agentNotes!} />
      </Conditional>

      {"---"}

      <section title="Your Task">
        {`Your goal is to IDENTIFY research questions, NOT to answer them. You are defining research threads
that will be investigated by separate agents.

1. Read the discussion topic to understand what needs to be researched
2. Identify 3-7 distinct research questions or investigation areas
3. Define each thread with clear scope and expected deliverables

DO NOT do any research yourself. Just identify the questions and define the threads.`}
      </section>

      <section title="Thread Design Guidelines">
        {`Each thread should be:
- **Focused**: Single topic or question
- **Actionable**: Clear investigation steps
- **Measurable**: Defined deliverables

Common thread patterns:
- **Current Architecture** - How does the existing system work?
- **Related Issues & PRs** - What prior work exists?
- **Implementation Approaches** - What are the options?
- **External Research** - What do other projects/tools do?
- **Performance/Security** - What are the implications?
- **Dependencies** - What would be affected?`}
      </section>

      <section title="Output">
        {`Return structured JSON with:

- **threads**: Array of 3-7 research threads, each with:
  - \`title\`: Short descriptive title
  - \`question\`: Main question to investigate
  - \`investigation_areas\`: Specific things to look at
  - \`expected_deliverables\`: What the research should produce

- **updated_body**: Updated discussion description
  - Preserve original user content
  - Add "## Current State" section listing:
    - Research threads being spawned
    - Open questions being investigated

- **agent_notes**: Important context for future agents

The executor will:
- Create a comment for each research thread
- Each comment triggers a discussion-respond agent to investigate
- Update the discussion description`}
      </section>
    </prompt>
  ));

export default DiscussionResearch;
