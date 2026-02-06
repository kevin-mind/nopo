import { promptFactory, Conditional } from "@more/prompt-factory";
import { IssueHeader, AgentNotes, IssueState } from "../components.js";

const Iterate = promptFactory()
  .inputs((z) => ({
    issueNumber: z.number(),
    issueTitle: z.string(),
    iteration: z.number(),
    lastCiResult: z.string(),
    consecutiveFailures: z.number(),
    branchName: z.string(),
    parentContext: z.string().optional(),
    prCreateCommand: z.string(),
    existingBranchSection: z.string().optional(),
    issueBody: z.string(),
    agentNotes: z.string(),
  }))
  .outputs((z) => ({
    status: z.enum(["completed_todo", "waiting_manual", "blocked", "all_done"]),
    todos_completed: z.array(z.string()).optional(),
    manual_todo: z.string().optional(),
    blocked_reason: z.string().optional(),
    agent_notes: z.array(z.string()),
  }))
  .prompt((inputs) => (
    <prompt>
      <IssueHeader number={inputs.issueNumber} title={inputs.issueTitle} />

      <IssueState
        iteration={inputs.iteration}
        lastCiResult={inputs.lastCiResult}
        consecutiveFailures={inputs.consecutiveFailures}
        branchName={inputs.branchName}
        parentContext={inputs.parentContext}
      />

      <AgentNotes notes={inputs.agentNotes} />

      {"---"}

      {inputs.issueBody}

      <Conditional when={inputs.existingBranchSection}>
        {inputs.existingBranchSection}
      </Conditional>

      <section title="Instructions">
        {`This is iteration ${inputs.iteration}. Make **incremental progress** - do NOT try to complete everything at once.`}
      </section>

      <section title="1. Assess Current State">
        <codeblock lang="bash">
          {"git status && git log --oneline -3"}
        </codeblock>
        {"\nCheck which todos are done vs pending."}
      </section>

      <section title="1.5. Check for Conflicts with Main">
        {`**Before doing any work**, check if your branch has conflicts with main:`}
        <codeblock lang="bash">{`git fetch origin main\ngit merge-base --is-ancestor origin/main HEAD && echo "Up to date" || echo "Behind main"`}</codeblock>
        {`\n**If behind main**, try to rebase:`}
        <codeblock lang="bash">{"git rebase origin/main"}</codeblock>
        {[
          `\n**If rebase fails with conflicts**:`,
          "1. Check the conflict severity: `git diff --name-only --diff-filter=U`",
          "2. If conflicts are in files YOU modified, try to resolve them",
          "3. If conflicts are in files you didn't touch or are too complex:",
          "   - Abort the rebase: `git rebase --abort`",
          '   - Set status to `blocked` with `blocked_reason: "Merge conflicts with main that require human intervention. Conflicting files: [list them]"`',
          "   - **Do NOT waste iterations on unresolvable conflicts**",
          "",
          "**Simple conflicts** (your changes + main changes in different parts of same file):",
          "- Resolve by keeping both changes appropriately",
          "- `git add <file>` and `git rebase --continue`",
          "",
          "**Complex conflicts** (overlapping changes, structural refactors, deleted files):",
          "- These need human judgment - set status to `blocked` immediately",
        ].join("\n")}
      </section>

      <section title="2. Determine Action">
        {[
          "**If CI failed** (`LAST_CI_RESULT = failure`):",
          "- Run `make check && make test` to reproduce locally",
          "- Fix the issues, verify, commit",
          "",
          "**If CI passed or first iteration**:",
          "- Review unchecked todos (those without `[x]`)",
          "- Implement what makes sense for this iteration",
          '- Return `status: "completed_todo"` with the todos you completed',
          "- You don't need to complete everything in one iteration - make reasonable progress",
          "",
          "**If next unchecked todo has `[Manual]` prefix**:",
          "- These require human action (testing, verification, etc.)",
          "- **EXIT IMMEDIATELY** - do not attempt to complete it",
          "- Set status to `waiting_manual` with the todo text in `manual_todo`",
          "- A human will complete the task, check it off, and re-trigger the workflow",
          "",
          "**If all non-manual todos are checked off and CI passed**:",
          "- Set status to `all_done`",
          "- Workflow handles marking PR ready and requesting review",
        ].join("\n")}
      </section>

      <section title="3. Implementation">
        {[
          "1. Read files before editing",
          "2. Follow CLAUDE.md guidelines",
          "3. Keep changes small and focused",
        ].join("\n")}
      </section>

      <section title="4. Verify Before Committing">
        <codeblock lang="bash">{"make check && make test"}</codeblock>
        {"\n**STOP if any command fails.** Fix before committing."}
      </section>

      <section title="5. Commit and Push">
        {
          "Commit with descriptive message, push to origin. Workflow handles the rest."
        }
      </section>

      <section title="6. Create PR (First Iteration Only)">
        {`If no PR exists:\n${inputs.prCreateCommand}`}
      </section>

      <section title="Output">
        {[
          "Return structured JSON with:",
          "",
          "- **status**: What happened this iteration",
          "  - `completed_todo` - A todo item is satisfied (code exists OR you just implemented it)",
          "  - `waiting_manual` - Next unchecked todo has `[Manual]` prefix",
          "  - `blocked` - Cannot proceed (explain in blocked_reason)",
          "  - `all_done` - All non-manual todos are checked off, ready for review",
          "",
          "- **todos_completed**: List of todos that are now satisfied (if status=completed_todo)",
          "  - Copy the todo text EXACTLY as it appears in the issue (without the `- [ ]` prefix)",
          '  - Example: ["Add login form validation", "Add error handling for invalid input"]',
          "  - The executor will check these off in the issue body",
          "",
          "- **manual_todo**: The **exact text** of the manual todo (if status=waiting_manual)",
          "  - Only use this when the NEXT unchecked todo has `[Manual]` prefix",
          "",
          "- **blocked_reason**: Explanation if status=blocked",
          "",
          "- **agent_notes**: Important discoveries for future iterations (stored in history)",
          "",
          "The executor will:",
          "- Check off todos_completed in the issue body (matches fuzzy, so slight differences OK)",
          "- Store agent_notes in iteration history",
          "- Handle PR ready state transitions based on status",
        ].join("\n")}
      </section>
    </prompt>
  ));

export default Iterate;
