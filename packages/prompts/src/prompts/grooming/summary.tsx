import { promptFactory, Conditional } from "@more/prompt-factory";

const GroomingSummary = promptFactory()
  .inputs((z) => ({
    issueNumber: z.number(),
    issueTitle: z.string(),
    issueBody: z.string(),
    issueComments: z.string(),
    pmOutput: z.string(),
    engineerOutput: z.string(),
    qaOutput: z.string(),
    researchOutput: z.string(),
  }))
  .outputs((z) => ({
    summary: z.string(),
    consensus: z.array(z.string()).optional(),
    conflicts: z
      .array(
        z.object({
          issue: z.string(),
          resolution: z.string(),
        }),
      )
      .optional(),
    decision: z.enum(["ready", "needs_info", "blocked"]),
    decision_rationale: z.string(),
    questions: z
      .array(
        z.object({
          question: z.string(),
          source: z.enum(["pm", "engineer", "qa", "research"]),
          priority: z.enum(["critical", "important", "nice-to-have"]),
        }),
      )
      .optional(),
    blocker_reason: z.string().optional(),
    next_steps: z.array(z.string()).optional(),
    agent_notes: z.array(z.string()).optional(),
  }))
  .prompt((inputs) => (
    <prompt>
      <line>{`You are a Grooming Coordinator synthesizing analysis for issue #${inputs.issueNumber}: "${inputs.issueTitle}"`}</line>

      <section title="Issue Body">{inputs.issueBody}</section>

      <Conditional when={inputs.issueComments}>
        <section title="Issue Comments">{inputs.issueComments}</section>
      </Conditional>

      {"---"}

      <section title="Agent Analyses">
        <section title="PM Analysis">{inputs.pmOutput}</section>
        <section title="Engineer Analysis">{inputs.engineerOutput}</section>
        <section title="QA Analysis">{inputs.qaOutput}</section>
        <section title="Research Findings">{inputs.researchOutput}</section>
      </section>

      {"---"}

      <section title="Your Task">
        {`Synthesize the analyses from all four agents and make a final decision:

1. **Summary**: Combine key insights from all agents
2. **Consensus**: Where do agents agree?
3. **Conflicts**: Where do agents disagree? How should conflicts be resolved?
4. **Decision**: Based on all input, is this issue ready?`}
      </section>

      <section title="Decision Criteria">
        {`- **ready**: All agents agree ready, OR conflicts are minor and resolvable, AND Engineer has provided recommended_phases
- **needs_info**: Any agent has critical questions, unclear requirements
- **blocked**: Technical blockers, dependencies not met, scope issues

**CRITICAL**: An issue can ONLY be marked "ready" if the Engineer analysis includes \`recommended_phases\` with at least one phase. This is because:
- Work happens on sub-issues, not parent issues directly
- Sub-issues are created from the recommended_phases
- Without phases, there's nothing to iterate on`}
      </section>

      <section title="Output">
        {`Return structured JSON with your synthesis and final decision.

If decision is "needs_info", consolidate all questions from agents into a prioritized list.
If decision is "blocked", clearly state what's blocking and what needs to happen.`}
      </section>
    </prompt>
  ));

export default GroomingSummary;
