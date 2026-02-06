import { promptFactory, Conditional } from "@more/prompt-factory";
import { AgentNotes } from "../components.js";

const HumanReviewResponse = promptFactory()
  .inputs((z) => ({
    prNumber: z.number(),
    reviewer: z.string(),
    reviewDecision: z.string(),
    headRef: z.string(),
    repoOwner: z.string(),
    repoName: z.string(),
    agentNotes: z.string().optional(),
  }))
  .outputs((z) => ({
    had_commits: z.boolean(),
    summary: z.string(),
    commits: z.array(z.string()).optional(),
    agent_notes: z.array(z.string()).optional(),
  }))
  .prompt((inputs) => (
    <prompt>
      <line>{`Address human review feedback on PR #${inputs.prNumber}`}</line>

      {`Reviewer: @${inputs.reviewer}
Decision: ${inputs.reviewDecision}
Branch: \`${inputs.headRef}\``}

      <Conditional when={inputs.agentNotes}>
        <AgentNotes notes={inputs.agentNotes!} />
      </Conditional>

      {"---"}

      <section title="Step 1: Read ALL Reviews and Comments">
        {`**IMPORTANT**: Read ALL feedback to understand the full context of what's being requested.`}

        <codeblock lang="bash">
          {`# Get ALL reviews (bodies and decisions) - CRITICAL for understanding ALL feedback
gh pr view ${inputs.prNumber} --json reviews --jq '.reviews[] | "---\\nReviewer: \\(.author.login)\\nState: \\(.state)\\nBody:\\n\\(.body)\\n"'

# Get inline comments on code (file-specific feedback) - THESE ARE OFTEN THE MOST IMPORTANT
gh api repos/${inputs.repoOwner}/${inputs.repoName}/pulls/${inputs.prNumber}/comments --jq '.[] | "---\\nFile: \\(.path):\\(.line)\\nAuthor: \\(.user.login)\\nComment: \\(.body)\\n"'

# Get conversation comments (general discussion)
gh pr view ${inputs.prNumber} --comments`}
        </codeblock>

        {`**Pay attention to:**
- Review bodies (overall feedback)
- Inline comments on specific code lines (often contain the actual change requests)
- Conversation history (may have follow-up context)`}
      </section>

      <section title="Step 2: Process Feedback">
        {`Human reviewers may have different perspectives than automated reviews. Pay special attention to:
- Architectural concerns
- Maintainability feedback
- Domain knowledge insights
- User experience considerations

**For each comment:**

- **Change request**: Make the fix, commit
- **Question**: Prepare a response; make change if implied
- **Concern**: Address the concern or explain the trade-off`}
      </section>

      <section title="Step 3: Commit and Push (if changes made)">
        <codeblock lang="bash">{`git push origin ${inputs.headRef}`}</codeblock>

        {"Push converts PR to draft and triggers CI. CI-pass marks it ready."}
      </section>

      <section title="Rules">
        {`- Address ALL feedback from human reviewer
- Atomic commits for each change
- Follow CLAUDE.md guidelines
- Be respectful of human insights - they often catch things automation misses`}
      </section>

      <section title="Output">
        {`Return structured JSON with:

- **had_commits**: true if you made commits, false if discussion only

- **summary**: Comment to post on the PR explaining:
  - What changes were made (if any)
  - Responses to questions/discussion
  - Any concerns or clarifications

- **commits**: Array of commit SHAs created

- **agent_notes**: Important context for future agents

The executor will:
- Post the summary as a PR comment
- If had_commits=false, re-request review from the reviewer
- If had_commits=true, CI will trigger and handle PR state`}
      </section>
    </prompt>
  ));

export default HumanReviewResponse;
