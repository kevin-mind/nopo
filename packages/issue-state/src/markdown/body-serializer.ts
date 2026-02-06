/**
 * Body Serializer
 *
 * Converts structured fields back into a markdown body string.
 */

import type { Section, HistoryEntry, AgentNotesEntry } from "../schemas/index.js";
import { createHistoryTable } from "./history.js";
import { AGENT_NOTES_SECTION } from "./agent-notes.js";

export interface SerializeBodyOptions {
  description?: string | null;
  sections?: Section[];
  history?: HistoryEntry[];
  agentNotes?: AgentNotesEntry[];
  repoUrl?: string;
}

function formatAgentNotesEntry(entry: AgentNotesEntry): string {
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

export function serializeBody(options: SerializeBodyOptions): string {
  const parts: string[] = [];

  if (options.description) {
    parts.push(options.description);
  }

  if (options.sections) {
    for (const section of options.sections) {
      // Skip Iteration History and Agent Notes — handled separately
      if (
        section.name === "Iteration History" ||
        section.name === "Agent Notes"
      ) {
        continue;
      }
      parts.push(`## ${section.name}\n\n${section.content}`);
    }
  }

  if (options.agentNotes && options.agentNotes.length > 0) {
    const entries = options.agentNotes.map(formatAgentNotesEntry).join("\n\n");
    parts.push(`${AGENT_NOTES_SECTION}\n\n${entries}`);
  }

  if (options.history && options.history.length > 0) {
    parts.push(createHistoryTable(options.history, options.repoUrl));
  }

  return parts.join("\n\n");
}
