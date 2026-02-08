import { promptFactory, Conditional } from "@more/prompt-factory";

const GroomingEngineer = promptFactory()
  .inputs((z) => ({
    issueNumber: z.number(),
    issueTitle: z.string(),
    issueBody: z.string(),
    issueComments: z.string(),
    issueLabels: z.string(),
  }))
  .outputs((z) => ({
    implementation_plan: z.string(),
    affected_areas: z.array(
      z.object({
        path: z.string(),
        change_type: z.enum(["modify", "create", "delete"]),
        description: z.string(),
      }),
    ),
    technical_risks: z
      .array(
        z.object({
          risk: z.string(),
          severity: z.enum(["low", "medium", "high"]),
          mitigation: z.string().optional(),
        }),
      )
      .optional(),
    scope_recommendation: z.enum(["keep", "split", "expand"]),
    scope_rationale: z.string().optional(),
    recommended_phases: z
      .array(
        z.object({
          phase_number: z.number(),
          title: z.string(),
          description: z.string(),
          affected_areas: z
            .array(
              z.object({
                path: z.string(),
                change_type: z.enum(["create", "modify", "delete"]),
                description: z.string(),
              }),
            )
            .optional(),
          todos: z.array(
            z.object({
              task: z.string(),
              manual: z.boolean(),
            }),
          ),
          depends_on: z.array(z.number()).optional(),
        }),
      )
      .optional(),
    ready: z.boolean(),
    blockers: z.array(z.string()).optional(),
    questions: z.array(z.string()).optional(),
  }))
  .prompt((inputs) => (
    <prompt>
      <line>{`You are a Software Engineer reviewing issue #${inputs.issueNumber}: "${inputs.issueTitle}"`}</line>

      <section title="Issue Body">{inputs.issueBody}</section>

      <Conditional when={inputs.issueComments}>
        <section title="Issue Comments">{inputs.issueComments}</section>
      </Conditional>

      <Conditional when={inputs.issueLabels}>
        <section title="Current Labels">{inputs.issueLabels}</section>
      </Conditional>

      {"---"}

      <section title="Your Task">
        {`Analyze this issue from a technical implementation perspective. Focus on:

1. **Implementation Plan**: High-level approach to solving this
2. **Affected Areas**: Files, modules, or systems that need changes
3. **Technical Risks**: Complexity, performance concerns, breaking changes
4. **Scope Assessment**: Is the scope appropriate? Too large to split?
5. **Missing Information**: What technical details are unclear?`}
      </section>

      <section title="Codebase Exploration">
        {`You may explore the codebase to understand:
- Current implementation patterns
- Related code that might be affected
- Existing abstractions or utilities to reuse`}
      </section>

      <section title="Assessment">
        {`Determine if this issue is ready for implementation:

- **Ready**: Clear technical approach, reasonable scope, no blockers
- **Needs Info**: Missing technical details, unclear architecture decisions
- **Blocked**: Depends on other work, infrastructure not ready

If not ready, specify what information or decisions are needed.`}
      </section>

      <section title="Scope Recommendation">
        {`Suggest if the issue should be:
- **keep**: Scope is appropriate as-is (single phase)
- **split**: Issue is too large, recommend splitting into phases
- **expand**: Issue is too small, could combine with related work`}
      </section>

      <section title="Phase Planning (REQUIRED)">
        {`You MUST provide \`recommended_phases\` with at least one phase. This is REQUIRED because:
- Work happens on sub-issues (phases), not parent issues directly
- Sub-issues are created from your recommended_phases
- Without phases, the issue cannot be implemented

Provide \`recommended_phases\` with:
- **phase_number**: 1-indexed phase number
- **title**: Short descriptive title (e.g., "Setup database schema")
- **description**: What this phase accomplishes
- **affected_areas**: Files affected in this phase (path, change_type, description)
- **todos**: Specific implementation tasks for this phase
  - Each todo has \`task\` (description) and \`manual\` (boolean)
  - \`manual: false\` = **[Auto]** - Claude will complete during iteration (code changes, file edits)
  - \`manual: true\` = **[Manual]** - Requires human action (approvals, external config, deployments)
- **depends_on**: Array of phase numbers this depends on (empty for first phase)

**Guidelines for phases:**
- 1-5 phases (even simple XS/S issues need at least 1 phase)
- Each phase should be a self-contained PR
- No generic todos (commit, push, merge) - only specific implementation tasks
- Phases should have clear dependencies

For simple issues (XS/S size), provide a single phase with all todos.`}
      </section>

      <section title="Output">
        {"Return structured JSON with your technical analysis."}
      </section>
    </prompt>
  ));

export default GroomingEngineer;
