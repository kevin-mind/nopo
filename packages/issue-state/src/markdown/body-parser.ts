/**
 * Body Parser
 *
 * Parses a full issue body into structured fields:
 * description, approach, todos, todoStats, history, agentNotes, sections.
 */

import type {
  TodoItem,
  TodoStats,
  HistoryEntry,
  AgentNotesEntry,
  Section,
} from "../schemas/index.js";
import { getDescription, extractAllSections, getSection } from "./sections.js";
import { parseTodos, calculateTodoStats } from "./todos.js";
import { parseHistory } from "./history.js";
import { parseAgentNotes } from "./agent-notes.js";

export interface ParsedBody {
  description: string | null;
  approach: string | null;
  todos: TodoItem[];
  todoStats: TodoStats;
  history: HistoryEntry[];
  agentNotes: AgentNotesEntry[];
  sections: Section[];
}

export function parseBody(body: string): ParsedBody {
  const description = getDescription(body);
  const approach = getSection(body, "Approach");
  const todos = parseTodos(body);
  const todoStats = calculateTodoStats(todos);
  const history = parseHistory(body);
  const agentNotes = parseAgentNotes(body);
  const sections = extractAllSections(body);

  return {
    description,
    approach,
    todos,
    todoStats,
    history,
    agentNotes,
    sections,
  };
}
