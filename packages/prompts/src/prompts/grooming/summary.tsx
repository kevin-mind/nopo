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
    previousQuestions: z.string().optional(),
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
    consolidated_questions: z
      .array(
        z.object({
          id: z.string(),
          title: z.string(),
          description: z.string(),
          sources: z.array(z.enum(["pm", "engineer", "qa", "research"])),
          priority: z.enum(["critical", "important", "nice-to-have"]),
        }),
      )
      .optional(),
    answered_questions: z
      .array(
        z.object({
          id: z.string(),
          title: z.string(),
          answer_summary: z.string(),
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

      <Conditional when={inputs.previousQuestions}>
        <section title="Previous Grooming Questions">
          {`The following questions are from the issue body's Questions section. Compare them with the current agent analyses to determine which have been answered:

${inputs.previousQuestions ?? ""}`}
        </section>
      </Conditional>

      {"---"}

      <section title="Your Task">
        {`Synthesize the analyses from all four agents and make a final decision:

1. **Summary**: Combine key insights from all agents
2. **Consensus**: Where do agents agree?
3. **Conflicts**: Where do agents disagree? How should conflicts be resolved?
4. **Decision**: Based on all input, is this issue ready?
5. **Consolidated Questions**: Deduplicate questions across agents into distinct decision themes`}
      </section>

      <section title="Question Consolidation Rules">
        {`When consolidating questions from agents:
- Deduplicate similar questions across agents into a single question per decision theme
- Use a stable, short \`id\` slug for each question (e.g., "auth-strategy", "db-migration-plan") so questions can be tracked across runs
- Provide a short title (5-10 words) and a 2-3 sentence description with context
- List which agents raised the question in the \`sources\` array
- Assign priority: "critical" (blocks implementation), "important" (affects design), "nice-to-have" (minor clarification)`}
      </section>

      <Conditional when={inputs.previousQuestions}>
        <section title="Answer Tracking">
          {`Compare previous questions with current agent analyses. If a question from a previous run is no longer raised by any agent, or the issue body/comments now contain the answer, mark it as answered in \`answered_questions\` with a brief summary of the answer. Keep the same \`id\` slug from the previous run.`}
        </section>
      </Conditional>

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

If decision is "needs_info", provide \`consolidated_questions\` with deduplicated, prioritized questions grouped by decision theme.
If decision is "blocked", clearly state what's blocking and what needs to happen.
If previous questions were provided, include \`answered_questions\` for any that are now resolved.`}
      </section>
    </prompt>
  ));

export default GroomingSummary;
