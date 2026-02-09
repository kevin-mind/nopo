import { promptFactory } from "@more/prompt-factory";

const LiveIssueScout = promptFactory()
  .inputs((z) => ({
    category: z.enum([
      "documentation",
      "tests",
      "performance",
      "readability",
      "type-safety",
    ]),
  }))
  .outputs((z) => ({
    title: z
      .string()
      .describe("Concise issue title, imperative mood, under 80 chars"),
    body: z.string().describe("Unstructured paragraph, max 100 words"),
  }))
  .prompt((inputs) => (
    <prompt>
      <section title="Purpose">
        {`You are a codebase scout. Find exactly ONE small, concrete improvement
in the "${inputs.category}" category.`}
      </section>

      <section title="Constraints">
        {`- XS size (under 1 hour of work), touching only 1-2 files
- Must be a real improvement, not busywork
- If touching production code, it must be testable
- No changes to generated files, lock files, or dist/ directories
- No new dependencies
- Must be something that can pass CI`}
      </section>

      <section title="Output Format">
        {`Return a title (imperative, under 80 chars) and a body paragraph
(max 100 words, unstructured, no markdown headings/bullets).
Be specific about which file(s) to change and the expected outcome.
Scope is most important, outcome is second most important.`}
      </section>
    </prompt>
  ));

export default LiveIssueScout;
