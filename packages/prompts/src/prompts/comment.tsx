import { promptFactory, Conditional } from "@more/prompt-factory";
import { AgentNotes } from "../components.js";

const Comment = promptFactory()
  .inputs((z) => ({
    contextType: z.enum(["issue", "pr"]),
    contextDescription: z.string(),
    agentNotes: z.string().optional(),
  }))
  .outputs((z) => ({
    action_type: z.enum(["response", "implementation"]),
    response_body: z.string(),
    commits: z.array(z.string()).optional(),
    agent_notes: z.array(z.string()).optional(),
  }))
  .prompt((inputs) => (
    <prompt>
      <line>{`You are responding to a question or request in a GitHub ${inputs.contextType} comment.`}</line>

      {inputs.contextDescription}

      <Conditional when={inputs.agentNotes}>
        <AgentNotes notes={inputs.agentNotes!} />
      </Conditional>

      {"---"}

      <section title="Your Task">
        {`Read the user's comment carefully and respond ONLY to what they asked.
DO NOT make unrelated suggestions or analyze unrelated code.`}
      </section>

      <section title="Action Detection">
        {`**If the user's comment contains ACTION WORDS** like:
- "fix", "implement", "change", "update", "add", "remove", "refactor", "delete"
- "do it", "make it", "apply", "commit", "push"

Then **DO IT IMMEDIATELY** - make the code changes and push them. Do NOT ask
"Would you like me to..." or "Should I..." - the user explicitly asked, so act.

**If the comment is a QUESTION or ANALYSIS REQUEST** (no action words):
- Answer the question
- Explain the code
- Suggest approaches (let user decide if they want implementation)

For large-scale implementation (new features), users should:
- Assign \`nopo-bot\` to an issue for full implementation

Focus on:
- Detecting whether this is an ACTION REQUEST or a QUESTION
- For actions: implement immediately, commit, and push
- For questions: provide clear, helpful answers`}
      </section>

      <section title="Output">
        {`Return structured JSON with:

- **action_type**: One of:
  - \`response\` - Answered a question or provided analysis
  - \`implementation\` - Made code changes and committed

- **response_body**: The comment to post (always required)
  - For questions: Your answer/analysis
  - For implementations: Summary of what was changed

- **commits**: Array of commit SHAs (if action_type=implementation)

- **agent_notes**: Important context for future agents

The executor will:
- Post the response as a comment on the issue/PR
- Record the action type for analytics`}
      </section>
    </prompt>
  ));

export default Comment;
