/**
 * Todo Parser
 *
 * Ported from .github/statemachine/issue/actions-ts/state-machine/parser/todo-parser.ts
 */

import type { TodoItem, TodoStats } from "../schemas/index.js";

const TODO_PATTERNS = {
  checkbox: /^(\s*)-\s*\[([ xX])\]\s*(.+)$/,
  manual: /\[Manual\]|\*\(manual\)\*/i,
};

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

  return { total, completed, uncheckedNonManual };
}

export function parseTodoStats(body: string): TodoStats {
  const todos = parseTodos(body);
  return calculateTodoStats(todos);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseTodosInSection(
  body: string,
  sectionHeader: string,
): TodoItem[] {
  const lines = body.split("\n");
  const sectionRegex = new RegExp(`^##\\s+${escapeRegex(sectionHeader)}`, "i");

  let inSection = false;
  const todos: TodoItem[] = [];

  for (const line of lines) {
    if (sectionRegex.test(line)) {
      inSection = true;
      continue;
    }

    if (inSection && /^##\s+/.test(line)) {
      break;
    }

    if (inSection) {
      const todo = parseTodoLine(line);
      if (todo) {
        todos.push(todo);
      }
    }
  }

  return todos;
}

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
    return body + `\n\n## Todos\n\n${newTodo}`;
  }

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
