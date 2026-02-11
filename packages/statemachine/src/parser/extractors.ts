/**
 * Issue state extractors
 *
 * Work directly with MDAST JSON - no serialize/re-parse round trips.
 * The transformation is explicit and visible in each extractor.
 */

import {
  createExtractor,
  TodoStatsSchema,
  HistoryEntrySchema,
  AgentNotesEntrySchema,
  type TodoStats,
} from "@more/issue-state";
import type { ExistingSubIssue } from "../runner/executors/output-schemas.js";
import { z } from "zod";
import type {
  Root,
  Heading,
  Table,
  ListItem,
  TableRow,
  RootContent,
  PhrasingContent,
  InlineCode,
} from "mdast";
import { isList, childrenAsRootContent } from "./type-guards.js";

// ============================================================================
// MDAST Helpers
// ============================================================================

/** Find index of a heading with given text */
function findHeadingIndex(ast: Root, text: string): number {
  return ast.children.findIndex((node): node is Heading => {
    if (node.type !== "heading") return false;
    const firstChild = node.children[0];
    return firstChild?.type === "text" && firstChild.value === text;
  });
}

/** Find index of a heading matching any of the given texts */
function findHeadingIndexAny(ast: Root, texts: string[]): number {
  return ast.children.findIndex((node) => {
    if (node.type !== "heading") return false;
    const firstChild = node.children[0];
    return firstChild?.type === "text" && texts.includes(firstChild.value);
  });
}

/** Get text content from a node (recursive) */
function getNodeText(
  node: RootContent | PhrasingContent | ListItem | undefined,
): string {
  if (!node) return "";
  if (node.type === "text") return node.value;
  if (node.type === "inlineCode") return node.value;
  if ("children" in node && Array.isArray(node.children)) {
    return childrenAsRootContent(node).map(getNodeText).join("");
  }
  return "";
}

/** Extract URL from a link node */
function getLinkUrl(
  node: RootContent | PhrasingContent | undefined,
): string | null {
  if (!node) return null;
  if (node.type === "link") return node.url;
  if ("children" in node && Array.isArray(node.children)) {
    for (const child of childrenAsRootContent(node)) {
      const url = getLinkUrl(child);
      if (url) return url;
    }
  }
  return null;
}

// ============================================================================
// Extractors
// ============================================================================

/**
 * Extract todo statistics directly from MDAST
 * Supports both "Todo" (singular) and "Todos" (plural) headings
 */
export const todosExtractor = createExtractor(TodoStatsSchema, (data) => {
  const ast = data.issue.bodyAst;
  const todosIdx = findHeadingIndexAny(ast, ["Todo", "Todos"]);

  if (todosIdx === -1) {
    return { total: 0, completed: 0, uncheckedNonManual: 0 };
  }

  // Get the list after the heading
  const listNode = ast.children[todosIdx + 1];
  if (!listNode || !isList(listNode)) {
    return { total: 0, completed: 0, uncheckedNonManual: 0 };
  }

  let total = 0;
  let completed = 0;
  let uncheckedNonManual = 0;

  for (const item of listNode.children) {
    if (item.type === "listItem" && item.checked !== undefined) {
      total++;
      if (item.checked) {
        completed++;
      } else {
        const text = getNodeText(item);
        const isManual = /\[Manual\]|\*\(manual\)\*/i.test(text);
        if (!isManual) {
          uncheckedNonManual++;
        }
      }
    }
  }

  return { total, completed, uncheckedNonManual };
});

/**
 * Extract todos directly from a bodyAst
 *
 * This is a simpler helper for guards that need to check todos
 * on either an issue or a sub-issue without building a full IssueStateData.
 * Supports both "Todo" (singular) and "Todos" (plural) headings.
 */
export function extractTodosFromAst(bodyAst: Root): TodoStats {
  const todosIdx = findHeadingIndexAny(bodyAst, ["Todo", "Todos"]);

  if (todosIdx === -1) {
    return { total: 0, completed: 0, uncheckedNonManual: 0 };
  }

  // Get the list after the heading
  const listNode = bodyAst.children[todosIdx + 1];
  if (!listNode || !isList(listNode)) {
    return { total: 0, completed: 0, uncheckedNonManual: 0 };
  }

  let total = 0;
  let completed = 0;
  let uncheckedNonManual = 0;

  for (const item of listNode.children) {
    if (item.type === "listItem" && item.checked !== undefined) {
      total++;
      if (item.checked) {
        completed++;
      } else {
        const text = getNodeText(item);
        const isManual = /\[Manual\]|\*\(manual\)\*/i.test(text);
        if (!isManual) {
          uncheckedNonManual++;
        }
      }
    }
  }

  return { total, completed, uncheckedNonManual };
}

/** Get text from a table cell */
function getCellText(row: TableRow, index: number): string {
  const cell = row.children[index];
  if (!cell) return "";
  return childrenAsRootContent(cell).map(getNodeText).join("");
}

/** Get link URL from a table cell */
function getCellLinkUrl(row: TableRow, index: number): string | null {
  const cell = row.children[index];
  if (!cell) return null;
  for (const child of childrenAsRootContent(cell)) {
    const url = getLinkUrl(child);
    if (url) return url;
  }
  return null;
}

/**
 * Extract iteration history directly from MDAST table
 */
export const historyExtractor = createExtractor(
  z.array(HistoryEntrySchema),
  (data) => {
    const ast = data.issue.bodyAst;
    const historyIdx = findHeadingIndex(ast, "Iteration History");

    if (historyIdx === -1) return [];

    // Find table after the heading
    const tableNode = ast.children
      .slice(historyIdx + 1)
      .find((n): n is Table => n.type === "table");

    if (!tableNode) return [];

    // Skip header row, parse data rows
    return tableNode.children.slice(1).map((row: TableRow) => {
      // Extract text from each cell
      const timestamp = getCellText(row, 0) || null;
      const iterationStr = getCellText(row, 1) || "0";
      const phase = getCellText(row, 2) || "";
      const action = getCellText(row, 3) || "";
      const sha = getCellText(row, 4) || null;
      const runLink = getCellLinkUrl(row, 5);

      return {
        timestamp: timestamp === "-" ? null : timestamp,
        iteration: parseInt(iterationStr, 10) || 0,
        phase,
        action,
        sha: sha === "-" ? null : sha,
        runLink,
      };
    });
  },
);

/**
 * Extract agent notes directly from MDAST
 */
// ============================================================================
// Question Extractors
// ============================================================================

export const QuestionStatsSchema = z.object({
  total: z.number(),
  answered: z.number(),
  unanswered: z.number(),
});

export type QuestionStats = z.infer<typeof QuestionStatsSchema>;

export interface QuestionItem {
  id: string | null;
  text: string;
  checked: boolean;
}

/**
 * Extract question statistics directly from MDAST
 */
export const questionsExtractor = createExtractor(
  QuestionStatsSchema,
  (data) => {
    return extractQuestionsFromAst(data.issue.bodyAst);
  },
);

/**
 * Extract question statistics from a bodyAst.
 * Finds the ## Questions heading, counts checklist items.
 */
export function extractQuestionsFromAst(bodyAst: Root): QuestionStats {
  const questionsIdx = findHeadingIndex(bodyAst, "Questions");

  if (questionsIdx === -1) {
    return { total: 0, answered: 0, unanswered: 0 };
  }

  const listNode = bodyAst.children[questionsIdx + 1];
  if (!listNode || !isList(listNode)) {
    return { total: 0, answered: 0, unanswered: 0 };
  }

  let total = 0;
  let answered = 0;

  for (const item of listNode.children) {
    if (item.type === "listItem" && item.checked !== undefined) {
      total++;
      if (item.checked) {
        answered++;
      }
    }
  }

  return { total, answered, unanswered: total - answered };
}

/**
 * Parse ID from a question item's text.
 * IDs are embedded as trailing `id:slug` inline code.
 */
function parseQuestionId(item: ListItem): string | null {
  // Walk through the listItem's paragraph children to find an inlineCode node
  // matching `id:slug`
  for (const child of childrenAsRootContent(item)) {
    if ("children" in child && Array.isArray(child.children)) {
      for (const node of childrenAsRootContent(child)) {
        if (node.type === "inlineCode") {
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- type narrowing from RootContent to InlineCode after type check
          const code = (node as InlineCode).value;
          if (code.startsWith("id:")) {
            return code.slice(3);
          }
        }
      }
    }
  }
  return null;
}

/**
 * Extract detailed question items from a bodyAst.
 * Returns QuestionItem[] with IDs parsed from `id:slug` inline code.
 */
export function extractQuestionItems(bodyAst: Root): QuestionItem[] {
  const questionsIdx = findHeadingIndex(bodyAst, "Questions");

  if (questionsIdx === -1) {
    return [];
  }

  const listNode = bodyAst.children[questionsIdx + 1];
  if (!listNode || !isList(listNode)) {
    return [];
  }

  const items: QuestionItem[] = [];

  for (const item of listNode.children) {
    if (item.type === "listItem" && typeof item.checked === "boolean") {
      const id = parseQuestionId(item);
      const text = getNodeText(item);
      items.push({
        id,
        text,
        checked: item.checked,
      });
    }
  }

  return items;
}

// ============================================================================
// Sub-Issue Specs Extractor
// ============================================================================

/**
 * Parse `[Phase N]` from a sub-issue title. Returns the phase number or null.
 */
function parsePhaseNumber(title: string): number | null {
  const match = /^\[Phase\s+(\d+)\]/.exec(title);
  return match?.[1] ? parseInt(match[1], 10) : null;
}

/**
 * Extract text content between a heading and the next heading in an AST.
 */
function extractSectionText(ast: Root, sectionName: string): string {
  const idx = findHeadingIndex(ast, sectionName);
  if (idx === -1) return "";

  const parts: string[] = [];
  for (let i = idx + 1; i < ast.children.length; i++) {
    const node = ast.children[i];
    if (!node) break;
    if (node.type === "heading") break;
    parts.push(getNodeText(node));
  }
  return parts.join("\n").trim();
}

/**
 * Extract affected areas from a sub-issue body AST.
 * Parses bullet list items under ## Affected Areas heading.
 */
function extractAffectedAreas(ast: Root): Array<{
  path: string;
  change_type?: string;
  description?: string;
}> {
  const idx = findHeadingIndex(ast, "Affected Areas");
  if (idx === -1) return [];

  const listNode = ast.children[idx + 1];
  if (!listNode || !isList(listNode)) return [];

  return listNode.children.map((item) => {
    const text = getNodeText(item);
    // Format: `path` (change_type) - description
    const pathMatch = /`([^`]+)`/.exec(text);
    const path = pathMatch?.[1] ?? text;
    const changeTypeMatch = /\(([^)]+)\)/.exec(text);
    const descMatch = /- (.+)$/.exec(text);
    return {
      path,
      ...(changeTypeMatch?.[1] ? { change_type: changeTypeMatch[1] } : {}),
      ...(descMatch?.[1] ? { description: descMatch[1] } : {}),
    };
  });
}

/**
 * Extract todo items from a sub-issue body AST.
 * Parses checklist items under ## Todo/Todos heading.
 */
function extractTodoItems(
  ast: Root,
): Array<{ task: string; manual?: boolean }> {
  const idx = findHeadingIndexAny(ast, ["Todo", "Todos"]);
  if (idx === -1) return [];

  const listNode = ast.children[idx + 1];
  if (!listNode || !isList(listNode)) return [];

  return listNode.children
    .filter(
      (item): item is ListItem =>
        item.type === "listItem" && item.checked !== undefined,
    )
    .map((item) => {
      const text = getNodeText(item);
      const isManual = /\[Manual\]|\*\(manual\)\*/i.test(text);
      return { task: text, ...(isManual ? { manual: true } : {}) };
    });
}

/**
 * Extract ExistingSubIssue[] from sub-issues by parsing their body ASTs.
 * This converts GitHub SubIssueData into the canonical SubIssueSpec shape
 * (with `number`) for use in reconciliation.
 */
export function extractSubIssueSpecs(
  subIssues: Array<{
    number: number;
    title: string;
    bodyAst: Root;
    state: string;
  }>,
): ExistingSubIssue[] {
  return subIssues
    .filter((sub) => sub.state !== "CLOSED")
    .map((sub) => {
      const phaseNumber = parsePhaseNumber(sub.title) ?? 0;
      // Strip [Phase N]: prefix from title
      const title = sub.title.replace(/^\[Phase\s+\d+\]:\s*/, "");
      const description = extractSectionText(sub.bodyAst, "Description");
      const affectedAreas = extractAffectedAreas(sub.bodyAst);
      const todos = extractTodoItems(sub.bodyAst);

      return {
        number: sub.number,
        phase_number: phaseNumber,
        title,
        description,
        ...(affectedAreas.length > 0 ? { affected_areas: affectedAreas } : {}),
        ...(todos.length > 0 ? { todos } : {}),
      };
    });
}

export const agentNotesExtractor = createExtractor(
  z.array(AgentNotesEntrySchema),
  (data) => {
    const ast = data.issue.bodyAst;
    const notesIdx = findHeadingIndex(ast, "Agent Notes");

    if (notesIdx === -1) return [];

    const entries: z.infer<typeof AgentNotesEntrySchema>[] = [];

    // Find all h3 headings after Agent Notes section
    for (let i = notesIdx + 1; i < ast.children.length; i++) {
      const node = ast.children[i];
      if (!node) continue;

      // Stop at next h2
      if (node.type === "heading" && node.depth === 2) break;

      // Parse h3 run headers: ### [Run 12345678901](url) - Jan 22 19:04
      if (node.type === "heading" && node.depth === 3) {
        // First child should be a link
        const linkNode = node.children[0];
        if (!linkNode || linkNode.type !== "link") continue;

        const linkText = getNodeText(linkNode);
        const runMatch = linkText.match(/Run\s+(\d+)/);
        if (!runMatch || !runMatch[1]) continue;

        const runId = runMatch[1];
        const runLink = linkNode.url;

        // Rest of heading is timestamp
        const headingText = getNodeText(node);
        const timestampMatch = headingText.match(/-\s*(.+)$/);
        const timestamp = timestampMatch?.[1]?.trim() || "";

        // Get bullet list that follows
        const listNode = ast.children[i + 1];
        const notes =
          listNode && isList(listNode)
            ? listNode.children.map((item: ListItem) => getNodeText(item))
            : [];

        entries.push({
          runId,
          runLink,
          timestamp,
          notes,
        });
      }
    }

    return entries;
  },
);
