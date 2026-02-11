import { promptFactory } from "@more/prompt-factory";

const ReconcileSubIssues = promptFactory()
  .inputs((z) => ({
    issueNumber: z.number(),
    issueTitle: z.string(),
    existingSubIssues: z.string(),
    expectedSubIssues: z.string(),
  }))
  .outputs((z) => {
    const SubIssueSpecSchema = z.object({
      phase_number: z.number(),
      title: z.string(),
      description: z.string(),
      affected_areas: z
        .array(
          z.object({
            path: z.string(),
            change_type: z.string().optional(),
            description: z.string().optional(),
            impact: z.string().optional(),
          }),
        )
        .optional(),
      todos: z
        .array(
          z.object({
            task: z.string(),
            manual: z.boolean().optional(),
          }),
        )
        .optional(),
      depends_on: z.array(z.number()).optional(),
    });

    return {
      create: z.array(SubIssueSpecSchema),
      update: z.array(
        SubIssueSpecSchema.extend({
          number: z.number(),
          match_reason: z.string(),
        }),
      ),
      delete: z.array(
        z.object({
          number: z.number(),
          reason: z.string(),
        }),
      ),
      reasoning: z.string(),
    };
  })
  .prompt((inputs) => (
    <prompt>
      <line>{`You are a Sub-Issue Reconciliation Agent for issue #${inputs.issueNumber}: "${inputs.issueTitle}"`}</line>

      <section title="Task">
        {`Compare the EXISTING sub-issues (currently on GitHub) against the EXPECTED sub-issues (from the latest grooming analysis). Produce three buckets:

1. **create**: Expected sub-issues that have no semantic match in the existing set. Output them as-is (no \`number\` field).
2. **update**: Expected sub-issues that semantically match an existing one. Output the MERGED version with the existing \`number\` and a \`match_reason\` explaining the match. Merge content: use the expected title/description/affected_areas/todos but preserve any existing content that adds value.
3. **delete**: Existing sub-issues that have no semantic match in the expected set. Output \`{ number, reason }\`.`}
      </section>

      <section title="Existing Sub-Issues (currently on GitHub)">
        {inputs.existingSubIssues}
      </section>

      <section title="Expected Sub-Issues (from grooming analysis)">
        {inputs.expectedSubIssues}
      </section>

      <section title="Matching Rules">
        {`Match by SEMANTIC SIMILARITY of scope and intent, NOT by:
- Phase numbers (Phase 2 in one run may be completely different from Phase 2 in another)
- Exact title matches (titles may be reworded)

Good signals for a match:
- Similar description/scope (same area of the codebase, same feature)
- Overlapping affected areas (same files/directories)
- Similar todo items (same tasks, even if worded differently)
- Same functional intent (both about "auth", both about "UI", etc.)

**Handling closed/merged sub-issues:**
Existing sub-issues may have \`state\` and \`merged\` fields:
- \`merged: true\` — This phase is COMPLETED (PR was merged). Put it in the \`update\` bucket matched to its corresponding expected phase, with no content changes. This preserves the match but the executor will skip it.
- \`state: "CLOSED"\` + \`merged: false\` (or merged absent) — This phase was ABANDONED (closed without merging). Treat it as a normal candidate for semantic matching. If matched, put it in the \`update\` bucket and the executor will handle replacement.
- \`state: "OPEN"\` — Normal active sub-issue, handle as before.

When merging for update:
- Use the expected phase_number and title (they reflect the latest analysis)
- Prefer the expected description but incorporate unique details from the existing one
- Merge affected_areas: keep all from expected, add any from existing that aren't covered
- Merge todos: keep all from expected, add any from existing that represent completed work or unique tasks not in the expected set`}
      </section>

      <section title="Output">
        {`Return structured JSON with all three buckets and a brief \`reasoning\` field explaining your overall reconciliation decisions.

Every expected sub-issue must appear in exactly one of \`create\` or \`update\`.
Every existing sub-issue must appear in exactly one of \`update\` or \`delete\`.`}
      </section>
    </prompt>
  ));

export default ReconcileSubIssues;
