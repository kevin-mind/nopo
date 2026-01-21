import type { TodoItem, TodoStats } from "../schemas/index.js";

/**
 * Regex patterns for parsing todos
 */
const TODO_PATTERNS = {
  // Matches: - [ ] text or - [x] text or - [X] text
  checkbox: /^(\s*)-\s*\[([ xX])\]\s*(.+)$/,
  // Matches: *(manual)* anywhere in the line
  manual: /\*\(manual\)\*/i,
};

/**
 * Parse a single line into a TodoItem if it's a checkbox
 */
export function parseTodoLine(line: string): TodoItem | null {
  const match = line.match(TODO_PATTERNS.checkbox);
  if (!match) {
    return null;
  }

  const checkMark = match[2];
  const text = match[3]?.trim() || "";

  return {
    text,
    checked: checkMark?.toLowerCase() === "x",
    isManual: TODO_PATTERNS.manual.test(line),
  };
}

/**
 * Parse all todos from a markdown body
 */
export function parseTodos(body: string): TodoItem[] {
  const lines = body.split("\n");
  const todos: TodoItem[] = [];

  for (const line of lines) {
    const todo = parseTodoLine(line);
    if (todo) {
      todos.push(todo);
    }
  }

  return todos;
}

/**
 * Calculate todo statistics from a list of todos
 */
export function calculateTodoStats(todos: TodoItem[]): TodoStats {
  let total = 0;
  let completed = 0;
  let uncheckedNonManual = 0;

  for (const todo of todos) {
    total++;
    if (todo.checked) {
      completed++;
    } else if (!todo.isManual) {
      uncheckedNonManual++;
    }
  }

  return {
    total,
    completed,
    uncheckedNonManual,
  };
}

/**
 * Parse todos and return stats in one call
 */
export function parseTodoStats(body: string): TodoStats {
  const todos = parseTodos(body);
  return calculateTodoStats(todos);
}

/**
 * Count unchecked todos that are NOT manual tasks
 * This is the main function used to determine if work is done
 */
export function countNonManualUncheckedTodos(body: string): number {
  const stats = parseTodoStats(body);
  return stats.uncheckedNonManual;
}

/**
 * Check if all non-manual todos are complete
 */
export function areNonManualTodosDone(body: string): boolean {
  return countNonManualUncheckedTodos(body) === 0;
}

/**
 * Extract todos from a specific section of the body
 */
export function parseTodosInSection(body: string, sectionHeader: string): TodoItem[] {
  const lines = body.split("\n");
  const sectionRegex = new RegExp(`^##\\s+${escapeRegex(sectionHeader)}`, "i");

  let inSection = false;
  const todos: TodoItem[] = [];

  for (const line of lines) {
    // Check if we're entering the target section
    if (sectionRegex.test(line)) {
      inSection = true;
      continue;
    }

    // Check if we're leaving the section (hit another heading)
    if (inSection && /^##\s+/.test(line)) {
      break;
    }

    // Parse todos within the section
    if (inSection) {
      const todo = parseTodoLine(line);
      if (todo) {
        todos.push(todo);
      }
    }
  }

  return todos;
}

/**
 * Get todo stats for a specific section
 */
export function parseTodoStatsInSection(
  body: string,
  sectionHeader: string,
): TodoStats {
  const todos = parseTodosInSection(body, sectionHeader);
  return calculateTodoStats(todos);
}

/**
 * Parse todos from the "## Todos" section specifically
 */
export function parseTodoSection(body: string): TodoItem[] {
  return parseTodosInSection(body, "Todos");
}

/**
 * Parse todos from the "## Testing" section specifically
 */
export function parseTestingSection(body: string): TodoItem[] {
  return parseTodosInSection(body, "Testing");
}

/**
 * Helper to escape regex special characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Update a todo's checked state in the body
 * Returns the updated body or null if todo not found
 */
export function updateTodoInBody(
  body: string,
  todoText: string,
  checked: boolean,
): string | null {
  const lines = body.split("\n");
  const escapedText = escapeRegex(todoText.trim());
  const todoRegex = new RegExp(
    `^(\\s*)-\\s*\\[[ xX]\\]\\s*${escapedText}\\s*$`,
    "i",
  );

  let found = false;
  const newLines = lines.map((line) => {
    if (todoRegex.test(line)) {
      found = true;
      const checkMark = checked ? "x" : " ";
      return line.replace(/\[([ xX])\]/, `[${checkMark}]`);
    }
    return line;
  });

  return found ? newLines.join("\n") : null;
}

/**
 * Add a new todo to the body under the "## Todos" section
 * Creates the section if it doesn't exist
 */
export function addTodoToBody(
  body: string,
  todoText: string,
  checked: boolean = false,
): string {
  const checkMark = checked ? "x" : " ";
  const newTodo = `- [${checkMark}] ${todoText}`;

  const lines = body.split("\n");
  const todosSectionIdx = lines.findIndex((l) => /^##\s+Todos/i.test(l));

  if (todosSectionIdx === -1) {
    // Add Todos section at the end
    return body + `\n\n## Todos\n\n${newTodo}`;
  }

  // Find the last todo item in the section
  let insertIdx = todosSectionIdx + 1;
  for (let i = todosSectionIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    if (TODO_PATTERNS.checkbox.test(line)) {
      insertIdx = i + 1;
    } else if (/^##\s+/.test(line)) {
      break;
    }
  }

  lines.splice(insertIdx, 0, newTodo);
  return lines.join("\n");
}
