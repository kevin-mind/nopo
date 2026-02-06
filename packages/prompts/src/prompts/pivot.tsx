import { promptFactory } from "@more/prompt-factory";

const Pivot = promptFactory()
  .inputs((z) => ({
    issueNumber: z.number(),
    issueTitle: z.string(),
    pivotDescription: z.string(),
    issueBody: z.string(),
    subIssuesJson: z.string(),
    issueComments: z.string(),
  }))
  .outputs((z) => ({
    analysis: z.object({
      change_summary: z.string(),
      affects_completed_work: z.boolean(),
      completed_work_details: z
        .array(
          z.object({
            type: z.enum(["checked_todo", "closed_sub_issue"]),
            issue_number: z.number(),
            description: z.string(),
          }),
        )
        .optional(),
    }),
    modifications: z
      .object({
        parent_issue: z
          .object({
            update_sections: z.record(z.string()).optional(),
          })
          .optional(),
        sub_issues: z
          .array(
            z.object({
              issue_number: z.number(),
              action: z.enum(["modify", "skip"]),
              todo_modifications: z
                .array(
                  z.object({
                    action: z.enum(["add", "modify", "remove"]),
                    index: z.number(),
                    text: z.string().optional(),
                  }),
                )
                .optional(),
              update_description: z.string().optional(),
            }),
          )
          .optional(),
        new_sub_issues: z
          .array(
            z.object({
              title: z.string(),
              description: z.string(),
              todos: z.array(z.string()),
              reason: z.enum(["reversion", "new_scope", "extension"]),
            }),
          )
          .optional(),
      })
      .optional(),
    outcome: z.enum([
      "changes_applied",
      "needs_clarification",
      "no_changes_needed",
    ]),
    clarification_needed: z.string().optional(),
    summary_for_user: z.string(),
  }))
  .prompt((inputs) => (
    <prompt>
      <line>{`You are analyzing a pivot request for issue #${inputs.issueNumber}: "${inputs.issueTitle}"`}</line>

      <section title="Pivot Request">{inputs.pivotDescription}</section>

      <section title="Current State">
        <section title="Parent Issue Body">{inputs.issueBody}</section>
        <section title="Sub-Issues">{inputs.subIssuesJson}</section>
        <section title="Issue Comments">{inputs.issueComments}</section>
      </section>

      {"---"}

      <section title="CRITICAL SAFETY CONSTRAINTS">
        {`These constraints are NON-NEGOTIABLE and enforced at the executor level:

1. **Checked todos are IMMUTABLE** - You CANNOT uncheck or modify any \`[x]\` items
2. **Closed sub-issues are IMMUTABLE** - You CANNOT modify CLOSED issues
3. **For completed work changes** - Create NEW sub-issues with reason: "reversion" or "extension"`}
      </section>

      <section title="Your Task">
        {`1. **Understand the pivot request** - What does the user want to change?
2. **Identify affected issues/todos** - Which issues and todos are impacted?
3. **Check for completed work** - Are any checked todos or closed sub-issues affected?
4. **Plan safe changes**:
   - **Uncompleted work**: Modify directly (update unchecked todos, open sub-issues)
   - **Completed work**: Create NEW sub-issues to revert or extend`}
      </section>

      <section title="Change Types">
        <section title="IMPORTANT: Todos Belong on Sub-Issues, Not Parent Issues">
          {`The parent issue contains high-level requirements and scope. **Todos are specific action items that belong on sub-issues.**

When the user requests adding new work:
1. **If it relates to an existing sub-issue** → Add todos to that sub-issue
2. **If it's a new scope of work** → Create a new sub-issue with its own todos

Never add \`- [ ]\` checkbox items to the parent issue body.`}
        </section>

        <section title="For Parent Issue Modifications">
          {`You can update the parent issue's descriptive sections:
- \`update_sections\`: Object with section names as keys, new content as values
  - Use this for updating "Requirements", "Description", etc.
  - Do NOT add todos here - add them to sub-issues instead`}
        </section>

        <section title="For Sub-Issue Modifications">
          {`For each OPEN sub-issue, you can:
- \`action\`: "modify" to make changes, "skip" to leave unchanged
- \`todo_modifications\`: Array of index-based todo operations (see below)`}

          <section title="Todo Modifications (Index-Based)">
            {`Todos are referenced by their 0-based index. This is deterministic and order-aware.

Each modification has:
- \`action\`: "add" | "modify" | "remove"
- \`index\`: 0-based position
- \`text\`: New text (required for "add" and "modify")

**Operations:**

1. **Add** - Insert a new todo AFTER the specified index
   - \`index: -1\` → prepend (insert at beginning)
   - \`index: 0\` → insert after first todo
   - \`index: 2\` → insert after third todo

2. **Modify** - Change the text of an existing unchecked todo
   - Cannot modify checked todos (will fail safety validation)

3. **Remove** - Delete an unchecked todo at the index
   - Cannot remove checked todos (will fail safety validation)

**Example:** Given todos: \`[0: "Setup", 1: "Implement", 2: "Test"]\``}
            <codeblock lang="json">
              {`{
  "todo_modifications": [
    { "action": "add", "index": 1, "text": "Add validation" },
    { "action": "modify", "index": 2, "text": "Write unit tests" },
    { "action": "remove", "index": 0 }
  ]
}`}
            </codeblock>
            {`Result: \`["Implement", "Add validation", "Write unit tests"]\`

**Important:** Operations are applied in order with index recalculation after each operation.`}
          </section>
        </section>

        <section title="For New Work (Create Sub-Issues)">
          {`When the pivot adds new scope that doesn't fit existing sub-issues:
- \`reason\`: "new_scope" (new work), "reversion" (undo completed work), or "extension" (build on completed work)
- \`title\`: Descriptive title for the new sub-issue (e.g., "[Phase N]: Feature name")
- \`description\`: Full description of what needs to be done
- \`todos\`: Array of todo items for the new sub-issue`}
        </section>
      </section>

      <section title="Output Format">
        {`Return structured JSON with:

1. \`analysis\`: Your understanding of the change and its impact
2. \`modifications\`: The actual changes to apply
3. \`outcome\`: One of "changes_applied", "needs_clarification", "no_changes_needed"
4. \`clarification_needed\`: If outcome is "needs_clarification", explain what's unclear
5. \`summary_for_user\`: A human-readable summary of what was changed`}
      </section>

      {"---"}

      <section title="Important Notes">
        {`- Be conservative - only make changes that are clearly requested
- If the pivot request is ambiguous, use outcome "needs_clarification"
- Always preserve completed work by creating new sub-issues rather than modifying it
- The summary_for_user will be posted as a comment on the issue`}
      </section>
    </prompt>
  ));

export default Pivot;
