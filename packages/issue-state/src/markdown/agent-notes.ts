/**
 * Agent Notes Parser
 *
 * Ported from .github/statemachine/issue/actions-ts/state-machine/parser/agent-notes-parser.ts
 */

import type { AgentNotesEntry } from "../schemas/index.js";

export const AGENT_NOTES_SECTION = "## Agent Notes";

export function parseAgentNotes(body: string): AgentNotesEntry[] {
  const entries: AgentNotesEntry[] = [];

  const sectionMatch = body.match(
    new RegExp(`${AGENT_NOTES_SECTION}\\s*\\n([\\s\\S]*)$`, "i"),
  );

  if (!sectionMatch || !sectionMatch[1]) {
    return entries;
  }

  const sectionContent = sectionMatch[1];

  const entryPattern =
    /###\s*\[Run\s+(\d+)\]\(([^)]+)\)\s*-\s*([^\n]+)\n([\s\S]*?)(?=\n###\s*\[Run|\n##\s|$)/g;

  let match;
  while ((match = entryPattern.exec(sectionContent)) !== null) {
    const [, runId, runLink, timestamp, notesBlock] = match;

    const notes: string[] = [];
    const bulletPattern = /^[-*]\s+(.+)$/gm;
    let bulletMatch;
    while ((bulletMatch = bulletPattern.exec(notesBlock || "")) !== null) {
      if (bulletMatch[1]) {
        notes.push(bulletMatch[1].trim());
      }
    }

    if (runId && runLink && timestamp) {
      entries.push({
        runId,
        runLink,
        timestamp: timestamp.trim(),
        notes,
      });
    }
  }

  return entries;
}

function formatTimestamp(isoTimestamp?: string | Date): string {
  try {
    const date =
      isoTimestamp instanceof Date
        ? isoTimestamp
        : isoTimestamp
          ? new Date(isoTimestamp)
          : new Date();

    if (isNaN(date.getTime())) {
      return new Date().toISOString();
    }

    const months = [
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    const month = months[date.getUTCMonth()];
    const day = date.getUTCDate();
    const hours = String(date.getUTCHours()).padStart(2, "0");
    const minutes = String(date.getUTCMinutes()).padStart(2, "0");

    return `${month} ${day} ${hours}:${minutes}`;
  } catch {
    return new Date().toISOString();
  }
}

function formatEntry(entry: AgentNotesEntry): string {
  const header = `### [Run ${entry.runId}](${entry.runLink}) - ${entry.timestamp}`;
  const bullets = entry.notes
    .slice(0, 10)
    .map((note) => {
      const truncated = note.length > 500 ? note.slice(0, 500) + "..." : note;
      return `- ${truncated}`;
    })
    .join("\n");

  return `${header}\n${bullets}`;
}

export function formatAgentNotesForPrompt(entries: AgentNotesEntry[]): string {
  if (entries.length === 0) {
    return "No previous agent notes found for this issue.";
  }

  const recentEntries = entries.slice(0, 3);
  return recentEntries.map(formatEntry).join("\n\n");
}

export function appendAgentNotes(
  body: string,
  entry: Omit<AgentNotesEntry, "timestamp"> & { timestamp?: string },
): string {
  if (entry.notes.length === 0) {
    return body;
  }

  const formattedTimestamp = formatTimestamp(entry.timestamp);

  const fullEntry: AgentNotesEntry = {
    ...entry,
    timestamp: formattedTimestamp,
  };
  const newEntryMarkdown = formatEntry(fullEntry);

  const sectionRegex = new RegExp(
    `(${AGENT_NOTES_SECTION})\\s*\\n([\\s\\S]*)$`,
    "i",
  );
  const sectionMatch = body.match(sectionRegex);

  if (sectionMatch) {
    const existingContent = sectionMatch[2]?.trim() || "";
    const updatedSection = existingContent
      ? `${AGENT_NOTES_SECTION}\n\n${newEntryMarkdown}\n\n${existingContent}`
      : `${AGENT_NOTES_SECTION}\n\n${newEntryMarkdown}`;

    return body.replace(sectionRegex, updatedSection);
  }

  const separator = body.trim().endsWith("\n") ? "\n" : "\n\n";
  return `${body.trim()}${separator}${AGENT_NOTES_SECTION}\n\n${newEntryMarkdown}`;
}

export function removeAgentNotesSection(body: string): string {
  return body
    .replace(new RegExp(`\\n*${AGENT_NOTES_SECTION}[\\s\\S]*$`, "i"), "")
    .trim();
}

export function extractAgentNotesSection(body: string): string {
  const match = body.match(
    new RegExp(`(${AGENT_NOTES_SECTION}[\\s\\S]*)$`, "i"),
  );
  return match?.[1]?.trim() || "";
}
