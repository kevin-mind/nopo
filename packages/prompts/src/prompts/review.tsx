import { promptFactory, Conditional } from "@more/prompt-factory";
import { AgentNotes } from "../components.js";

const Review = promptFactory()
  .inputs((z) => ({
    prNumber: z.number(),
    issueNumber: z.number(),
    headRef: z.string(),
    baseRef: z.string(),
    repoOwner: z.string(),
    repoName: z.string(),
    agentNotes: z.string().optional(),
  }))
  .outputs((z) => ({
    decision: z.enum(["approve", "request_changes", "comment"]),
    body: z.string(),
    agent_notes: z.array(z.string()).optional(),
  }))
  .prompt((inputs) => (
    <prompt>
      <line>{`Review PR #${inputs.prNumber} for issue #${inputs.issueNumber}`}</line>

      <line>{`Branch: \`${inputs.headRef}\` → \`${inputs.baseRef}\``}</line>

      <Conditional when={inputs.agentNotes}>
        <AgentNotes notes={inputs.agentNotes!} />
      </Conditional>

      {"---"}

      <section title="Step 1: View Changes">
        <codeblock lang="bash">
          {`git fetch origin main
git diff origin/main...HEAD --stat    # Summary
git diff origin/main...HEAD           # Full diff`}
        </codeblock>
      </section>

      <section title="Step 2: Read ALL Existing Reviews and Comments">
        {`**IMPORTANT**: Read ALL feedback to understand the full context and avoid repeating concerns already addressed.`}
        <codeblock lang="bash">
          {`# Get ALL reviews (bodies and decisions) - CRITICAL for understanding history
gh pr view ${inputs.prNumber} --json reviews --jq '.reviews[] | "---\\nReviewer: \\(.author.login)\\nState: \\(.state)\\nBody:\\n\\(.body)\\n"'

# Get inline comments on code (file-specific feedback)
gh api repos/${inputs.repoOwner}/${inputs.repoName}/pulls/${inputs.prNumber}/comments --jq '.[] | "---\\nFile: \\(.path):\\(.line)\\nAuthor: \\(.user.login)\\nComment: \\(.body)\\n"'

# Get conversation comments (general discussion)
gh pr view ${inputs.prNumber} --comments`}
        </codeblock>
        {`
Review the feedback history to:
- See what has already been requested
- Check if previous concerns were addressed
- Avoid duplicate feedback`}
      </section>

      <section title="Step 3: Review the Code">
        {`Read changed files and check:
- Code quality and best practices
- Potential bugs or edge cases
- Test coverage
- Security considerations`}

        <section title="Edge Case Testing">
          {`Don't just check if todos are done - verify the LOGIC:

1. **Trace examples**: What happens with empty input? Common case? Boundaries?
2. **Test interactions**: If multiple options exist, what happens when combined?
3. **Run if possible**: Use CLI or tests to verify behavior
4. **Check design**: Does the implementation order make sense?`}
        </section>
      </section>

      <section title="Step 4: Make Your Decision">
        {`Return your review as structured output with:

- **decision**: One of:
  - \`"approve"\` - All requirements met, code is good
  - \`"request_changes"\` - Changes needed before merge
  - \`"comment"\` - Feedback but no blocking issues

- **body**: Your review summary explaining the decision

- **agent_notes** (optional): Key findings for future agents`}
      </section>
    </prompt>
  ));

export default Review;
