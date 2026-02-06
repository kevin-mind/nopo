/**
 * Section Parser
 *
 * Utilities for manipulating markdown sections in issue bodies.
 * Handles upsert, get, and remove operations on ## sections.
 *
 * Ported from .github/statemachine/issue/actions-ts/state-machine/parser/section-parser.ts
 */

import type { Section } from "../schemas/index.js";

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function getSection(body: string, sectionName: string): string | null {
  const escapedName = escapeRegex(sectionName);
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

export function removeSection(body: string, sectionName: string): string {
  const escapedName = escapeRegex(sectionName);
  const pattern = new RegExp(
    `\\n?## ${escapedName}\\s*\\n[\\s\\S]*?(?=\\n## |\\n<!-- |$)`,
    "gi",
  );

  return body.replace(pattern, "").trim();
}

export function hasSection(body: string, sectionName: string): boolean {
  return getSection(body, sectionName) !== null;
}

function insertBeforeSection(
  body: string,
  sectionName: string,
  content: string,
): string {
  const escapedName = escapeRegex(sectionName);
  const pattern = new RegExp(`(\\n?)(## ${escapedName})`, "i");
  return body.replace(pattern, `\n\n${content}\n$1$2`).trim();
}

function insertAtEnd(body: string, content: string): string {
  const specialSections = ["Agent Notes", "Iteration History"];

  for (const special of specialSections) {
    if (hasSection(body, special)) {
      return insertBeforeSection(body, special, content);
    }
  }

  const commentMatch = body.match(/(\n<!-- [\s\S]*)/);
  if (commentMatch) {
    const insertPos = body.indexOf(commentMatch[1]!);
    return (
      body.slice(0, insertPos) +
      "\n\n" +
      content +
      body.slice(insertPos)
    ).trim();
  }

  return (body + "\n\n" + content).trim();
}

export function upsertSection(
  body: string,
  sectionName: string,
  content: string,
  options: {
    sectionOrder?: string[];
    insertBefore?: string;
  } = {},
): string {
  const existingContent = getSection(body, sectionName);

  if (existingContent !== null) {
    const escapedName = escapeRegex(sectionName);
    const pattern = new RegExp(
      `(## ${escapedName}\\s*\\n)[\\s\\S]*?(?=\\n## |\\n<!-- |$)`,
      "i",
    );
    return body.replace(pattern, `$1\n${content}\n`).trim();
  }

  const newSection = `## ${sectionName}\n\n${content}`;

  if (options.sectionOrder) {
    const targetIndex = options.sectionOrder.indexOf(sectionName);
    if (targetIndex >= 0) {
      for (let i = targetIndex + 1; i < options.sectionOrder.length; i++) {
        const nextSection = options.sectionOrder[i];
        if (nextSection !== undefined && hasSection(body, nextSection)) {
          return insertBeforeSection(body, nextSection, newSection);
        }
      }
      return insertAtEnd(body, newSection);
    }
  }

  if (options.insertBefore && hasSection(body, options.insertBefore)) {
    return insertBeforeSection(body, options.insertBefore, newSection);
  }

  return insertAtEnd(body, newSection);
}

export function upsertSections(
  body: string,
  sections: Section[],
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
 * Extract all sections from a markdown body.
 * Returns an array of { name, content } for each ## section found.
 */
export function extractAllSections(body: string): Section[] {
  const sections: Section[] = [];
  const pattern = /## ([^\n]+)\s*\n([\s\S]*?)(?=\n## |\n<!-- |$)/gi;

  let match;
  while ((match = pattern.exec(body)) !== null) {
    const name = match[1]?.trim();
    const content = match[2]?.trim();
    if (name) {
      sections.push({ name, content: content || "" });
    }
  }

  return sections;
}

/**
 * Get the description text (content before the first ## section).
 */
export function getDescription(body: string): string | null {
  const firstSectionIdx = body.search(/\n## /);
  if (firstSectionIdx === -1) {
    return body.trim() || null;
  }
  const desc = body.slice(0, firstSectionIdx).trim();
  return desc || null;
}
