import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROMPTS_DIR = path.resolve(__dirname, "../prompts");

/**
 * Load a prompt file and replace placeholders with values.
 *
 * Placeholder format: {{PLACEHOLDER_NAME}}
 *
 * @param filename - The prompt filename (e.g., "review.txt")
 * @param replacements - Object mapping placeholder names to their values
 * @returns The prompt with placeholders replaced
 *
 * @example
 * ```ts
 * const prompt = loadPrompt("review.txt", {
 *   PR_NUMBER: expressions.expn("needs.request-setup.outputs.pr_number"),
 *   ISSUE_SECTION: issueSection,
 * });
 * ```
 */
export function loadPrompt(
  filename: string,
  replacements: Record<string, string> = {}
): string {
  const filepath = path.join(PROMPTS_DIR, filename);
  let content = fs.readFileSync(filepath, "utf-8");

  // Replace all {{PLACEHOLDER}} patterns
  for (const [key, value] of Object.entries(replacements)) {
    content = content.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
  }

  return content;
}
