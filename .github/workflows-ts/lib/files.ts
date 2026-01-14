import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

/**
 * Read a prompt file from the prompts/ directory.
 * Supports template variables in the format {{VAR_NAME}}.
 *
 * @param name - Filename without extension (e.g., 'review' for prompts/review.txt)
 * @param vars - Optional variables to substitute (e.g., { PR_NUMBER: '${{ steps.x.outputs.pr }}' })
 */
export function readPrompt(name: string, vars?: Record<string, string>): string {
  let content = readFileSync(join(ROOT, 'prompts', `${name}.txt`), 'utf-8');
  if (vars) {
    for (const [key, value] of Object.entries(vars)) {
      content = content.replaceAll(`{{${key}}}`, value);
    }
  }
  return content;
}

/**
 * Read a GraphQL file from the graphql/ directory.
 * Supports template variables in the format {{VAR_NAME}}.
 *
 * @param name - Filename without extension (e.g., 'getDiscussion' for graphql/getDiscussion.graphql)
 * @param vars - Optional variables to substitute
 */
export function readGraphQL(name: string, vars?: Record<string, string>): string {
  let content = readFileSync(join(ROOT, 'graphql', `${name}.graphql`), 'utf-8');
  if (vars) {
    for (const [key, value] of Object.entries(vars)) {
      content = content.replaceAll(`{{${key}}}`, value);
    }
  }
  return content;
}
