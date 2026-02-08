/**
 * Section Parser
 *
 * Utilities for manipulating markdown sections in issue bodies.
 * Handles upsert, get, and remove operations on ## sections.
 */

import type { SectionContent } from "./types.js";

/**
 * Get the content of a section from the issue body
 *
 * @param body - The issue body markdown
 * @param sectionName - The section name (without ##)
 * @returns The section content, or null if not found
 */
export function getSection(body: string, sectionName: string): string | null {
  // Match section header (case-insensitive) until next section or special markers
  const escapedName = sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `## ${escapedName}\\s*\\n([\\s\\S]*?)(?=\\n## |\\n<!-- |$)`,
    "i",
  );
  const match = body.match(pattern);

  if (match?.[1]) {
    return match[1].trim();
  }

  return null;
}

/**
 * Remove a section from the issue body
 *
 * @param body - The issue body markdown
 * @param sectionName - The section name (without ##)
 * @returns The body with the section removed
 */
export function removeSection(body: string, sectionName: string): string {
  // Match section header (case-insensitive) and content until next section or special markers
  const escapedName = sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `\\n?## ${escapedName}\\s*\\n[\\s\\S]*?(?=\\n## |\\n<!-- |$)`,
    "gi",
  );

  return body.replace(pattern, "").trim();
}

/**
 * Check if a section exists in the body
 */
export function hasSection(body: string, sectionName: string): boolean {
  return getSection(body, sectionName) !== null;
}

/**
 * Insert content before a specific section
 */
function insertBeforeSection(
  body: string,
  sectionName: string,
  content: string,
): string {
  const escapedName = sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(\\n?)(## ${escapedName})`, "i");
  return body.replace(pattern, `\n\n${content}\n$1$2`).trim();
}

/**
 * Insert content at the end, but before special markers like <!-- or ## Iteration History
 */
function insertAtEnd(body: string, content: string): string {
  // Check for special sections that should stay at the end
  const specialSections = ["Agent Notes", "Iteration History"];

  for (const special of specialSections) {
    if (hasSection(body, special)) {
      return insertBeforeSection(body, special, content);
    }
  }

  // Check for HTML comments (like iteration markers)
  const commentMatch = body.match(/(\n<!-- [\s\S]*)/);
  if (commentMatch?.[1]) {
    const insertPos = body.indexOf(commentMatch[1]);
    return (
      body.slice(0, insertPos) +
      "\n\n" +
      content +
      body.slice(insertPos)
    ).trim();
  }

  // Just append at the end
  return (body + "\n\n" + content).trim();
}

/**
 * Insert or update a section in the issue body
 *
 * If the section exists, replaces its content.
 * If not, inserts it at the appropriate position based on the order array.
 *
 * @param body - The issue body markdown
 * @param sectionName - The section name (without ##)
 * @param content - The new content for the section
 * @param options - Optional configuration
 * @returns The updated body
 */
export function upsertSection(
  body: string,
  sectionName: string,
  content: string,
  options: {
    /** Preferred section order (sections will be inserted to maintain this order) */
    sectionOrder?: string[];
    /** Insert before this section if exists and sectionOrder not specified */
    insertBefore?: string;
  } = {},
): string {
  const existingContent = getSection(body, sectionName);

  if (existingContent !== null) {
    // Section exists - replace it
    const escapedName = sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(
      `(## ${escapedName}\\s*\\n)[\\s\\S]*?(?=\\n## |\\n<!-- |$)`,
      "i",
    );
    return body.replace(pattern, `$1\n${content}\n`).trim();
  }

  // Section doesn't exist - need to insert it
  const newSection = `## ${sectionName}\n\n${content}`;

  // If sectionOrder is specified, find the right position
  if (options.sectionOrder) {
    const targetIndex = options.sectionOrder.indexOf(sectionName);
    if (targetIndex >= 0) {
      // Find the first section that comes AFTER our target in the order
      for (let i = targetIndex + 1; i < options.sectionOrder.length; i++) {
        const nextSection = options.sectionOrder[i];
        if (nextSection !== undefined && hasSection(body, nextSection)) {
          // Insert before this section
          return insertBeforeSection(body, nextSection, newSection);
        }
      }
      // No later section found, insert before special markers or at end
      return insertAtEnd(body, newSection);
    }
  }

  // If insertBefore is specified and that section exists
  if (options.insertBefore && hasSection(body, options.insertBefore)) {
    return insertBeforeSection(body, options.insertBefore, newSection);
  }

  // Default: insert before special markers or at end
  return insertAtEnd(body, newSection);
}

/**
 * Update multiple sections at once
 *
 * @param body - The issue body markdown
 * @param sections - Array of sections to update
 * @param sectionOrder - Preferred order of sections
 * @returns The updated body
 */
export function upsertSections(
  body: string,
  sections: SectionContent[],
  sectionOrder?: string[],
): string {
  let result = body;
  for (const section of sections) {
    result = upsertSection(result, section.name, section.content, {
      sectionOrder,
    });
  }
  return result;
}

/**
 * Standard section order for issue bodies
 * Used to maintain consistent structure
 */
export const STANDARD_SECTION_ORDER = [
  "Description",
  "Requirements",
  "Approach",
  "Acceptance Criteria",
  "Testing",
  "Related",
  "Questions",
  "Todo",
  "Agent Notes",
  "Iteration History",
];

/**
 * Format requirements as markdown list
 */
export function formatRequirements(requirements: string[]): string {
  if (requirements.length === 0) {
    return "_No specific requirements identified._";
  }
  return requirements.map((r) => `- ${r}`).join("\n");
}

/**
 * Format questions as markdown checklist
 * Unanswered questions are unchecked, answered questions include the answer
 */
export function formatQuestions(
  questions: Array<{ question: string; answer?: string }>,
): string {
  if (questions.length === 0) {
    return "_No questions._";
  }

  return questions
    .map((q) => {
      if (q.answer) {
        return `- [x] ${q.question}: ${q.answer}`;
      }
      return `- [ ] ${q.question}`;
    })
    .join("\n");
}

/**
 * Format related issues/PRs as markdown list
 */
export function formatRelated(
  items: Array<{ number: number; description?: string }>,
): string {
  if (items.length === 0) {
    return "_No related items._";
  }

  return items
    .map((item) => {
      if (item.description) {
        return `- #${item.number} - ${item.description}`;
      }
      return `- #${item.number}`;
    })
    .join("\n");
}
