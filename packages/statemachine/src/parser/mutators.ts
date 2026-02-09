/**
 * Issue state mutators
 *
 * Work directly with MDAST JSON - no serialize/re-parse round trips.
 * Each mutator returns a new IssueStateData with the mutation applied.
 */

import { createMutator, type HistoryEntry } from "@more/issue-state";
import { z } from "zod";
import type {
  Root,
  List,
  ListItem,
  Table,
  TableRow,
  TableCell,
  Heading,
  Paragraph,
  Link,
  Text,
  RootContent,
  InlineCode,
  PhrasingContent,
} from "mdast";
import { isList, isHeading, childrenAsRootContent } from "./type-guards.js";

// ============================================================================
// MDAST Helpers (shared with extractors)
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

/** Create a text node */
function createTextNode(value: string): Text {
  return { type: "text", value };
}

/** Create a paragraph node */
function createParagraphNode(text: string): Paragraph {
  return { type: "paragraph", children: [createTextNode(text)] };
}

/** Create a heading node */
function createHeadingNode(
  depth: 1 | 2 | 3 | 4 | 5 | 6,
  text: string,
): Heading {
  return { type: "heading", depth, children: [createTextNode(text)] };
}

/** Create a link node */
function createLinkNode(url: string, text: string): Link {
  return { type: "link", url, children: [createTextNode(text)] };
}

/** Create a list item node */
function createListItemNode(
  text: string,
  checked: boolean | null = null,
): ListItem {
  return {
    type: "listItem",
    checked,
    spread: false,
    children: [createParagraphNode(text)],
  };
}

/** Create a table cell */
function createTableCell(content: PhrasingContent[]): TableCell {
  return { type: "tableCell", children: content };
}

/** Create a table row */
function createTableRowNode(cells: TableCell[]): TableRow {
  return { type: "tableRow", children: cells };
}

/** Format timestamp for display */
function formatTimestamp(isoTimestamp?: string | null): string {
  if (!isoTimestamp) return "-";

  try {
    const date = new Date(isoTimestamp);
    if (isNaN(date.getTime())) return "-";

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
    return "-";
  }
}

/** Extract run ID from a GitHub Actions run URL */
function extractRunIdFromUrl(url: string): string | null {
  const match = url.match(/\/actions\/runs\/(\d+)/);
  return match?.[1] ?? null;
}

// ============================================================================
// Todo Mutators
// ============================================================================

/**
 * Check off a todo by matching text
 * Supports both "Todo" (singular) and "Todos" (plural) headings
 */
export const checkOffTodo = createMutator(
  z.object({ todoText: z.string() }),
  (input, data) => {
    const ast = data.issue.bodyAst;
    const todosIdx = findHeadingIndexAny(ast, ["Todo", "Todos"]);
    if (todosIdx === -1) return data;

    const listNode = ast.children[todosIdx + 1];
    if (!listNode || !isList(listNode)) return data;

    // Deep clone
    const newAst: Root = structuredClone(ast);
    const newListNode = newAst.children[todosIdx + 1];
    if (!newListNode || !isList(newListNode)) return data;
    const newList = newListNode;

    for (const item of newList.children) {
      if (item.checked === false) {
        const text = getNodeText(item);
        if (text.toLowerCase().includes(input.todoText.toLowerCase())) {
          item.checked = true;
          break;
        }
      }
    }

    return { ...data, issue: { ...data.issue, bodyAst: newAst } };
  },
);

/**
 * Uncheck a todo by matching text
 * Supports both "Todo" (singular) and "Todos" (plural) headings
 */
export const uncheckTodo = createMutator(
  z.object({ todoText: z.string() }),
  (input, data) => {
    const ast = data.issue.bodyAst;
    const todosIdx = findHeadingIndexAny(ast, ["Todo", "Todos"]);
    if (todosIdx === -1) return data;

    const listNode = ast.children[todosIdx + 1];
    if (!listNode || !isList(listNode)) return data;

    // Deep clone
    const newAst: Root = structuredClone(ast);
    const newListNode = newAst.children[todosIdx + 1];
    if (!newListNode || !isList(newListNode)) return data;
    const newList = newListNode;

    for (const item of newList.children) {
      if (item.checked === true) {
        const text = getNodeText(item);
        if (text.toLowerCase().includes(input.todoText.toLowerCase())) {
          item.checked = false;
          break;
        }
      }
    }

    return { ...data, issue: { ...data.issue, bodyAst: newAst } };
  },
);

/**
 * Add a todo item to the Todos section
 * Supports both "Todo" (singular) and "Todos" (plural) headings
 */
export const addTodo = createMutator(
  z.object({
    text: z.string(),
    checked: z.boolean().default(false),
    isManual: z.boolean().default(false),
  }),
  (input, data) => {
    const ast = data.issue.bodyAst;
    const newAst: Root = structuredClone(ast);
    const todosIdx = findHeadingIndexAny(newAst, ["Todo", "Todos"]);

    const todoText = input.isManual ? `[Manual] ${input.text}` : input.text;
    const newItem = createListItemNode(todoText, input.checked);

    if (todosIdx === -1) {
      // No Todos section - create one at the end
      const heading = createHeadingNode(2, "Todos");
      const list: List = {
        type: "list",
        ordered: false,
        spread: false,
        children: [newItem],
      };
      newAst.children.push(heading, list);
    } else {
      // Add to existing list
      const listNode = newAst.children[todosIdx + 1];
      if (listNode && isList(listNode)) {
        listNode.children.push(newItem);
      } else {
        // No list after heading - create one
        const list: List = {
          type: "list",
          ordered: false,
          spread: false,
          children: [newItem],
        };
        newAst.children.splice(todosIdx + 1, 0, list);
      }
    }

    return { ...data, issue: { ...data.issue, bodyAst: newAst } };
  },
);

// ============================================================================
// History Mutators
// ============================================================================

/** Create history table header row */
function createHistoryHeaderRow(): TableRow {
  return createTableRowNode([
    createTableCell([createTextNode("Time")]),
    createTableCell([createTextNode("#")]),
    createTableCell([createTextNode("Phase")]),
    createTableCell([createTextNode("Action")]),
    createTableCell([createTextNode("SHA")]),
    createTableCell([createTextNode("Run")]),
  ]);
}

/** Create a history table data row */
function createHistoryDataRow(entry: HistoryEntry, repoUrl?: string): TableRow {
  // Format SHA cell
  let shaCell: PhrasingContent[];
  if (entry.sha) {
    const shortSha = entry.sha.slice(0, 7);
    const url = repoUrl ? `${repoUrl}/commit/${entry.sha}` : "#";
    const code: InlineCode = { type: "inlineCode", value: shortSha };
    const link: Link = { type: "link", url, children: [code] };
    shaCell = [link];
  } else {
    shaCell = [createTextNode("-")];
  }

  // Format Run cell
  let runCell: PhrasingContent[];
  if (entry.runLink) {
    const runId = extractRunIdFromUrl(entry.runLink);
    const linkText = runId || "Run";
    runCell = [createLinkNode(entry.runLink, linkText)];
  } else {
    runCell = [createTextNode("-")];
  }

  return createTableRowNode([
    createTableCell([createTextNode(entry.timestamp || "-")]),
    createTableCell([createTextNode(String(entry.iteration))]),
    createTableCell([createTextNode(entry.phase)]),
    createTableCell([createTextNode(entry.action)]),
    createTableCell(shaCell),
    createTableCell(runCell),
  ]);
}

/** Get text from a table cell */
function getCellText(row: TableRow, index: number): string {
  const cell = row.children[index];
  if (!cell) return "";
  return childrenAsRootContent(cell).map(getNodeText).join("");
}

/** Get run ID from a table cell (handles link format) */
function getCellRunId(row: TableRow, index: number): string | null {
  const cell = row.children[index];
  if (!cell) return null;

  for (const child of childrenAsRootContent(cell)) {
    if (child.type === "link") {
      // Check if link text is the run ID
      const linkText = getNodeText(child);
      if (/^\d+$/.test(linkText)) {
        return linkText;
      }
      // Otherwise extract from URL
      return extractRunIdFromUrl(child.url);
    }
  }
  return null;
}

/**
 * Add a history entry to the Iteration History table
 */
export const addHistoryEntry = createMutator(
  z.object({
    iteration: z.number(),
    phase: z.string(),
    action: z.string(),
    timestamp: z.string().nullable().optional(),
    sha: z.string().nullable().optional(),
    runLink: z.string().nullable().optional(),
    repoUrl: z.string().optional(),
  }),
  (input, data) => {
    const ast = data.issue.bodyAst;
    const newAst: Root = structuredClone(ast);
    const historyIdx = findHeadingIndex(newAst, "Iteration History");

    const entry: HistoryEntry = {
      iteration: input.iteration,
      phase: input.phase,
      action: input.action,
      timestamp: input.timestamp
        ? formatTimestamp(input.timestamp)
        : formatTimestamp(new Date().toISOString()),
      sha: input.sha ?? null,
      runLink: input.runLink ?? null,
    };

    const newRow = createHistoryDataRow(entry, input.repoUrl);
    const runId = input.runLink ? extractRunIdFromUrl(input.runLink) : null;

    if (historyIdx === -1) {
      // No history section - create one
      const heading = createHeadingNode(2, "Iteration History");
      const table: Table = {
        type: "table",
        align: null,
        children: [createHistoryHeaderRow(), newRow],
      };
      newAst.children.push(heading, table);
    } else {
      // Find table after heading
      let tableIdx = -1;
      for (let i = historyIdx + 1; i < newAst.children.length; i++) {
        if (newAst.children[i]?.type === "table") {
          tableIdx = i;
          break;
        }
        // Stop if we hit another section
        if (newAst.children[i]?.type === "heading") break;
      }

      if (tableIdx === -1) {
        // No table found - create one after heading
        const table: Table = {
          type: "table",
          align: null,
          children: [createHistoryHeaderRow(), newRow],
        };
        newAst.children.splice(historyIdx + 1, 0, table);
      } else {
        const tableNode = newAst.children[tableIdx];
        if (!tableNode || tableNode.type !== "table") return data;
        const table = tableNode;

        // Check for deduplication by run ID
        if (runId) {
          for (let i = 1; i < table.children.length; i++) {
            const row = table.children[i];
            if (!row) continue;
            const existingRunId = getCellRunId(row, 5);
            if (existingRunId === runId) {
              // Found existing row - append action
              const actionCell = row.children[3];
              if (actionCell) {
                const existingAction = getCellText(row, 3);
                const newAction = existingAction
                  ? `${existingAction} -> ${input.action}`
                  : input.action;
                actionCell.children = [createTextNode(newAction)];
              }
              return { ...data, issue: { ...data.issue, bodyAst: newAst } };
            }
          }
        }

        // No duplicate - append new row
        table.children.push(newRow);
      }
    }

    return { ...data, issue: { ...data.issue, bodyAst: newAst } };
  },
);

/**
 * Update a history entry matching criteria
 */
export const updateHistoryEntry = createMutator(
  z.object({
    matchIteration: z.number(),
    matchPhase: z.string(),
    matchPattern: z.string(),
    newAction: z.string(),
    timestamp: z.string().nullable().optional(),
    sha: z.string().nullable().optional(),
    runLink: z.string().nullable().optional(),
    repoUrl: z.string().optional(),
  }),
  (input, data) => {
    const ast = data.issue.bodyAst;
    const historyIdx = findHeadingIndex(ast, "Iteration History");
    if (historyIdx === -1) return data;

    // Find table
    let tableIdx = -1;
    for (let i = historyIdx + 1; i < ast.children.length; i++) {
      if (ast.children[i]?.type === "table") {
        tableIdx = i;
        break;
      }
      if (ast.children[i]?.type === "heading") break;
    }

    if (tableIdx === -1) return data;

    const tableNode = ast.children[tableIdx];
    if (!tableNode || tableNode.type !== "table") return data;

    // Find matching row (search from end for most recent)
    let matchRowIdx = -1;
    for (let i = tableNode.children.length - 1; i >= 1; i--) {
      const row = tableNode.children[i];
      if (!row) continue;

      const rowIteration = getCellText(row, 1);
      const rowPhase = getCellText(row, 2);
      const rowAction = getCellText(row, 3);

      if (
        rowIteration === String(input.matchIteration) &&
        rowPhase === input.matchPhase &&
        rowAction.includes(input.matchPattern)
      ) {
        matchRowIdx = i;
        break;
      }
    }

    if (matchRowIdx === -1) return data;

    // Clone and update
    const newAst: Root = structuredClone(ast);
    const newTableNode = newAst.children[tableIdx];
    if (!newTableNode || newTableNode.type !== "table") return data;
    const newTable = newTableNode;
    const row = newTable.children[matchRowIdx];
    if (!row) return data;

    // Update action
    const actionCell = row.children[3];
    if (actionCell) {
      actionCell.children = [createTextNode(input.newAction)];
    }

    // Update timestamp if provided
    if (input.timestamp) {
      const timeCell = row.children[0];
      if (timeCell) {
        timeCell.children = [createTextNode(formatTimestamp(input.timestamp))];
      }
    }

    // Update SHA if provided
    if (input.sha) {
      const shaCell = row.children[4];
      if (shaCell) {
        const shortSha = input.sha.slice(0, 7);
        const url = input.repoUrl
          ? `${input.repoUrl}/commit/${input.sha}`
          : "#";
        const code: InlineCode = { type: "inlineCode", value: shortSha };
        const link: Link = { type: "link", url, children: [code] };
        shaCell.children = [link];
      }
    }

    // Update run link if provided
    if (input.runLink) {
      const runCell = row.children[5];
      if (runCell) {
        const runId = extractRunIdFromUrl(input.runLink);
        const linkText = runId || "Run";
        runCell.children = [createLinkNode(input.runLink, linkText)];
      }
    }

    return { ...data, issue: { ...data.issue, bodyAst: newAst } };
  },
);

// ============================================================================
// Agent Notes Mutators
// ============================================================================

/**
 * Append agent notes entry
 */
export const appendAgentNotes = createMutator(
  z.object({
    runId: z.string(),
    runLink: z.string(),
    timestamp: z.string().optional(),
    notes: z.array(z.string()),
  }),
  (input, data) => {
    // Skip if no notes
    if (input.notes.length === 0) return data;

    const ast = data.issue.bodyAst;
    const newAst: Root = structuredClone(ast);
    const notesIdx = findHeadingIndex(newAst, "Agent Notes");

    const formattedTimestamp = formatTimestamp(
      input.timestamp || new Date().toISOString(),
    );

    // Create the entry header: ### [Run 12345678901](url) - Jan 22 19:04
    const headerLink = createLinkNode(input.runLink, `Run ${input.runId}`);
    const headerText = createTextNode(` - ${formattedTimestamp}`);
    const entryHeader: Heading = {
      type: "heading",
      depth: 3,
      children: [headerLink, headerText],
    };

    // Create bullet list of notes (max 10, truncate long ones)
    const noteItems: ListItem[] = input.notes.slice(0, 10).map((note) => {
      const truncated = note.length > 500 ? note.slice(0, 500) + "..." : note;
      return createListItemNode(truncated, null);
    });

    const notesList: List = {
      type: "list",
      ordered: false,
      spread: false,
      children: noteItems,
    };

    if (notesIdx === -1) {
      // No Agent Notes section - create one at the end
      const sectionHeader = createHeadingNode(2, "Agent Notes");
      newAst.children.push(sectionHeader, entryHeader, notesList);
    } else {
      // Insert new entry after the section header (prepend - most recent first)
      newAst.children.splice(notesIdx + 1, 0, entryHeader, notesList);
    }

    return { ...data, issue: { ...data.issue, bodyAst: newAst } };
  },
);

// ============================================================================
// Section Mutators
// ============================================================================

/**
 * Standard section order for issue bodies
 */
const STANDARD_SECTION_ORDER = [
  "Description",
  "Requirements",
  "Approach",
  "Acceptance Criteria",
  "Testing",
  "Related",
  "Questions",
  "Todos",
  "Agent Notes",
  "Iteration History",
];

/**
 * Upsert a section in the issue body.
 * Content is an array of MDAST RootContent nodes inserted directly.
 */
export const upsertSection = createMutator(
  z.object({
    title: z.string(),
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- complex recursive mdast types require double cast
    content: z.array(z.record(z.unknown())) as unknown as z.ZodType<
      RootContent[]
    >,
    sectionOrder: z.array(z.string()).optional(),
  }),
  (input, data) => {
    const ast = data.issue.bodyAst;
    const newAst: Root = structuredClone(ast);
    const sectionIdx = findHeadingIndex(newAst, input.title);
    const sectionOrder = input.sectionOrder || STANDARD_SECTION_ORDER;

    if (sectionIdx !== -1) {
      // Section exists - find its end and replace content
      let endIdx = sectionIdx + 1;
      for (let i = sectionIdx + 1; i < newAst.children.length; i++) {
        const node = newAst.children[i];
        if (node && isHeading(node) && node.depth === 2) {
          break;
        }
        endIdx = i + 1;
      }

      // Remove old content, insert new MDAST nodes
      newAst.children.splice(
        sectionIdx + 1,
        endIdx - sectionIdx - 1,
        ...input.content,
      );
    } else {
      // Section doesn't exist - find insertion point based on order
      const targetOrderIdx = sectionOrder.indexOf(input.title);
      let insertIdx = newAst.children.length;

      if (targetOrderIdx >= 0) {
        // Find the first section that comes AFTER our target in the order
        for (let i = targetOrderIdx + 1; i < sectionOrder.length; i++) {
          const nextSection = sectionOrder[i];
          if (!nextSection) continue;
          const nextIdx = findHeadingIndex(newAst, nextSection);
          if (nextIdx !== -1) {
            insertIdx = nextIdx;
            break;
          }
        }
      }

      // Insert heading and content nodes
      const heading = createHeadingNode(2, input.title);
      newAst.children.splice(insertIdx, 0, heading, ...input.content);
    }

    return { ...data, issue: { ...data.issue, bodyAst: newAst } };
  },
);

// ============================================================================
// Todo Index-Based Mutators
// ============================================================================

/**
 * Apply index-based todo modifications (add/modify/remove).
 * Used by pivot executor for structured todo changes.
 * Safety: refuses to modify or remove checked todos.
 */
export const applyTodoModifications = createMutator(
  z.object({
    modifications: z.array(
      z.object({
        action: z.enum(["add", "modify", "remove"]),
        index: z.number(),
        text: z.string().optional(),
      }),
    ),
  }),
  (input, data) => {
    const ast = data.issue.bodyAst;
    const newAst: Root = structuredClone(ast);
    const todosIdx = findHeadingIndexAny(newAst, ["Todo", "Todos"]);
    if (todosIdx === -1) return data;

    const listNode = newAst.children[todosIdx + 1];
    if (!listNode || !isList(listNode)) return data;

    for (const mod of input.modifications) {
      if (mod.action === "add") {
        const newItem = createListItemNode(mod.text || "", false);
        if (mod.index < 0) {
          // Prepend
          listNode.children.splice(0, 0, newItem);
        } else if (mod.index >= listNode.children.length) {
          listNode.children.push(newItem);
        } else {
          listNode.children.splice(mod.index + 1, 0, newItem);
        }
      } else if (mod.action === "modify") {
        if (mod.index < 0 || mod.index >= listNode.children.length) continue;
        const item = listNode.children[mod.index];
        if (!item || item.checked === true) continue; // Safety: don't modify checked
        item.children = [createParagraphNode(mod.text || "")];
      } else if (mod.action === "remove") {
        if (mod.index < 0 || mod.index >= listNode.children.length) continue;
        const item = listNode.children[mod.index];
        if (!item || item.checked === true) continue; // Safety: don't remove checked
        listNode.children.splice(mod.index, 1);
      }
    }

    return { ...data, issue: { ...data.issue, bodyAst: newAst } };
  },
);

// ============================================================================
// Body Replacement
// ============================================================================

/**
 * Replace the entire issue body AST.
 * Used by executors that receive a fully-formed body from Claude output.
 */
export const replaceBody = createMutator(
  z.object({
    /* eslint-disable @typescript-eslint/consistent-type-assertions -- complex recursive mdast types require double cast */
    bodyAst: z
      .object({
        type: z.literal("root"),
        children: z.array(z.record(z.unknown())),
      })
      .passthrough() as unknown as z.ZodType<Root>,
    /* eslint-enable @typescript-eslint/consistent-type-assertions */
  }),
  (input, data) => ({
    ...data,
    issue: { ...data.issue, bodyAst: input.bodyAst },
  }),
);
