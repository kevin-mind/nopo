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
import { z } from "zod";
import type {
  Root,
  List,
  ListItem,
  Table,
  TableRow,
  Heading,
  RootContent,
} from "mdast";

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
  return ast.children.findIndex((node): node is Heading => {
    if (node.type !== "heading") return false;
    const firstChild = node.children[0];
    return (
      firstChild?.type === "text" && texts.includes(firstChild.value as string)
    );
  });
}

/** Get text content from a node (recursive) */
function getNodeText(node: RootContent | ListItem | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.value;
  if (node.type === "inlineCode") return node.value;
  if ("children" in node && Array.isArray(node.children)) {
    return (node.children as RootContent[]).map(getNodeText).join("");
  }
  return "";
}

/** Extract URL from a link node */
function getLinkUrl(node: RootContent | undefined): string | null {
  if (!node) return null;
  if (node.type === "link") return node.url;
  if ("children" in node && Array.isArray(node.children)) {
    for (const child of node.children as RootContent[]) {
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
  if (!listNode || listNode.type !== "list") {
    return { total: 0, completed: 0, uncheckedNonManual: 0 };
  }

  let total = 0;
  let completed = 0;
  let uncheckedNonManual = 0;

  for (const item of (listNode as List).children) {
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
  if (!listNode || listNode.type !== "list") {
    return { total: 0, completed: 0, uncheckedNonManual: 0 };
  }

  let total = 0;
  let completed = 0;
  let uncheckedNonManual = 0;

  for (const item of (listNode as List).children) {
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
  return (cell.children as RootContent[]).map(getNodeText).join("");
}

/** Get link URL from a table cell */
function getCellLinkUrl(row: TableRow, index: number): string | null {
  const cell = row.children[index];
  if (!cell) return null;
  for (const child of cell.children as RootContent[]) {
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

        const linkText = getNodeText(linkNode as RootContent);
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
          listNode?.type === "list"
            ? (listNode as List).children.map((item: ListItem) =>
                getNodeText(item),
              )
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
