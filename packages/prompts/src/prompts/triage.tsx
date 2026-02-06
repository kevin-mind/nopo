import { promptFactory, Conditional } from "@more/prompt-factory";
import { IssueHeader, AgentNotes } from "../components.js";

const Triage = promptFactory()
  .inputs((z) => ({
    issueNumber: z.number(),
    issueTitle: z.string(),
    issueBody: z.string(),
    agentNotes: z.string().optional(),
  }))
  .outputs((z) => ({
    triage: z.object({
      type: z.enum([
        "bug",
        "enhancement",
        "documentation",
        "refactor",
        "test",
        "chore",
      ]),
      priority: z
        .enum(["none", "low", "medium", "high", "critical"])
        .optional(),
      size: z.enum(["xs", "s", "m", "l", "xl"]),
      estimate: z.union([
        z.literal(1),
        z.literal(2),
        z.literal(3),
        z.literal(5),
        z.literal(8),
        z.literal(13),
        z.literal(21),
      ]),
      topics: z.array(z.string()),
      needs_info: z.boolean(),
    }),
    requirements: z.array(z.string()),
    initial_approach: z.string(),
    initial_questions: z.array(z.string()).optional(),
    related_issues: z.array(z.number()).optional(),
    agent_notes: z.array(z.string()).optional(),
  }))
  .prompt((inputs) => (
    <prompt>
      <IssueHeader number={inputs.issueNumber} title={inputs.issueTitle} />

      {inputs.issueBody}

      <Conditional when={inputs.agentNotes}>
        <AgentNotes notes={inputs.agentNotes!} />
      </Conditional>

      {"---"}

      <section title="Your Task">
        {`Analyze this issue and provide structured triage output. Do NOT execute any commands - just return the structured data.

**IMPORTANT**: Triage classifies and structures the issue. Sub-issues are created LATER during grooming, after the issue has been fully refined.`}
      </section>

      <section title="1. Classification">
        {`Determine:
- **Type**: bug, enhancement, documentation, refactor, test, or chore
- **Priority**: none, low, medium, high, critical (use "none" if not applicable)
- **Size**: XS (<1h), S (1-3h), M (3-8h), L (8-21h), XL (21+h)
- **Estimate**: Fibonacci hours (XS=1, S=2-3, M=5-8, L=13, XL=21)
- **Topics**: Up to 3 topic labels (e.g., "ci", "testing", "backend")
- **Needs info**: Whether more information is needed`}
      </section>

      <section title="2. Extract Requirements">
        {`Identify the key requirements from the issue:
- What must the solution accomplish?
- What are the acceptance criteria?
- What constraints exist?

Return these as an array of clear, specific requirements.`}
      </section>

      <section title="3. Initial Approach">
        {`Provide a high-level implementation approach:
- What's the general strategy?
- What files/areas might be affected?
- What patterns should be followed?

This is initial thinking - grooming will refine this.`}
      </section>

      <section title="4. Initial Questions (Optional)">
        {`If the issue lacks clarity, what questions need answering?
- What ambiguities exist?
- What decisions need human input?
- What technical details are missing?

These questions will be addressed during grooming.`}
      </section>

      <section title="5. Related Issues (Optional)">
        {"If you find related or duplicate issues, include their numbers."}
      </section>

      <section title="6. Agent Notes (Optional)">
        {
          "Save any important discoveries from codebase exploration that future agents should know."
        }
      </section>

      {"---"}

      <section title="Output">
        {`Return structured JSON matching the output schema. The executor will:
- Apply labels (type + topics + triaged)
- Set project fields (Priority, Size, Estimate)
- Update the issue body with structured sections (Requirements, Approach, Questions)
- Link related issues

**Note**: Sub-issues are NOT created during triage. They are created during grooming after the issue is fully refined.`}
      </section>
    </prompt>
  ));

export default Triage;
