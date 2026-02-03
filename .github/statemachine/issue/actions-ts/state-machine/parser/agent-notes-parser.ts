/**
 * Agent Notes Parser
 *
 * Parses, formats, and appends agent notes stored in the issue body.
 * Notes are stored in a "## Agent Notes" section at the end of the issue body.
 */

// ============================================================================
// Constants
// ============================================================================

export const AGENT_NOTES_SECTION = "## Agent Notes";

// ============================================================================
// Types
// ============================================================================

/**
 * A single agent notes entry from a workflow run
 */
export interface AgentNotesEntry {
  runId: string;
  runLink: string;
  timestamp: string;
  notes: string[];
}

// ============================================================================
// Parsing
// ============================================================================

/**
 * Parse agent notes from an issue body
 *
 * Extracts all notes entries from the "## Agent Notes" section.
 * Each entry is identified by a "### [Run X]" header.
 *
 * @param body - The issue body to parse
 * @returns Array of parsed agent notes entries
 */
export function parseAgentNotes(body: string): AgentNotesEntry[] {
  const entries: AgentNotesEntry[] = [];

  // Find the Agent Notes section
  const sectionMatch = body.match(
    new RegExp(`${AGENT_NOTES_SECTION}\\s*\\n([\\s\\S]*)$`, "i"),
  );

  if (!sectionMatch || !sectionMatch[1]) {
    return entries;
  }

  const sectionContent = sectionMatch[1];

  // Match each run entry: ### [Run 12345678901](url) - Jan 22 19:04
  const entryPattern =
    /###\s*\[Run\s+(\d+)\]\(([^)]+)\)\s*-\s*([^\n]+)\n([\s\S]*?)(?=\n###\s*\[Run|\n##\s|$)/g;

  let match;
  while ((match = entryPattern.exec(sectionContent)) !== null) {
    const [, runId, runLink, timestamp, notesBlock] = match;

    // Parse bullet points
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

// ============================================================================
// Formatting
// ============================================================================

/**
 * Format a timestamp for display
 *
 * @param isoTimestamp - ISO 8601 timestamp or Date object
 * @returns Formatted string like "Jan 22 19:04"
 */
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
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
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

/**
 * Format a single agent notes entry as markdown
 *
 * @param entry - The entry to format
 * @returns Markdown string for the entry
 */
function formatEntry(entry: AgentNotesEntry): string {
  const header = `### [Run ${entry.runId}](${entry.runLink}) - ${entry.timestamp}`;
  const bullets = entry.notes
    .slice(0, 10) // Max 10 notes per run
    .map((note) => {
      // Truncate long notes to 500 chars
      const truncated = note.length > 500 ? note.slice(0, 500) + "..." : note;
      return `- ${truncated}`;
    })
    .join("\n");

  return `${header}\n${bullets}`;
}

/**
 * Format agent notes entries for injection into a prompt
 *
 * @param entries - Array of agent notes entries
 * @returns Formatted markdown string for prompt injection
 */
export function formatAgentNotesForPrompt(entries: AgentNotesEntry[]): string {
  if (entries.length === 0) {
    return "No previous agent notes found for this issue.";
  }

  // Take most recent entries (already sorted by time in body)
  const recentEntries = entries.slice(0, 3);

  return recentEntries.map(formatEntry).join("\n\n");
}

// ============================================================================
// Appending
// ============================================================================

/**
 * Append a new agent notes entry to an issue body
 *
 * If the body doesn't have an Agent Notes section, one will be created.
 * New entries are prepended (most recent first).
 *
 * @param body - Current issue body
 * @param entry - New entry to append (without timestamp - will be formatted)
 * @returns Updated issue body with the new entry
 */
export function appendAgentNotes(
  body: string,
  entry: Omit<AgentNotesEntry, "timestamp"> & { timestamp?: string },
): string {
  // Skip if no notes
  if (entry.notes.length === 0) {
    return body;
  }

  // Format the timestamp
  const formattedTimestamp = formatTimestamp(entry.timestamp);

  // Format the new entry
  const fullEntry: AgentNotesEntry = {
    ...entry,
    timestamp: formattedTimestamp,
  };
  const newEntryMarkdown = formatEntry(fullEntry);

  // Check if Agent Notes section exists
  const sectionRegex = new RegExp(
    `(${AGENT_NOTES_SECTION})\\s*\\n([\\s\\S]*)$`,
    "i",
  );
  const sectionMatch = body.match(sectionRegex);

  if (sectionMatch) {
    // Section exists - prepend new entry after the section header
    const existingContent = sectionMatch[2]?.trim() || "";
    const updatedSection = existingContent
      ? `${AGENT_NOTES_SECTION}\n\n${newEntryMarkdown}\n\n${existingContent}`
      : `${AGENT_NOTES_SECTION}\n\n${newEntryMarkdown}`;

    return body.replace(sectionRegex, updatedSection);
  }

  // No section exists - append new section at the end
  const separator = body.trim().endsWith("\n") ? "\n" : "\n\n";
  return `${body.trim()}${separator}${AGENT_NOTES_SECTION}\n\n${newEntryMarkdown}`;
}

/**
 * Remove the Agent Notes section from an issue body
 *
 * Useful for serialization to avoid duplication when the body is reconstructed.
 *
 * @param body - Issue body potentially containing Agent Notes section
 * @returns Body without the Agent Notes section
 */
export function removeAgentNotesSection(body: string): string {
  return body
    .replace(new RegExp(`\\n*${AGENT_NOTES_SECTION}[\\s\\S]*$`, "i"), "")
    .trim();
}

/**
 * Extract the Agent Notes section from an issue body
 *
 * @param body - Issue body potentially containing Agent Notes section
 * @returns The Agent Notes section (including header) or empty string
 */
export function extractAgentNotesSection(body: string): string {
  const match = body.match(
    new RegExp(`(${AGENT_NOTES_SECTION}[\\s\\S]*)$`, "i"),
  );
  return match?.[1]?.trim() || "";
}
