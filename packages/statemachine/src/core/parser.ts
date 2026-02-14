/**
 * Parser functions re-exported for machine consumption.
 *
 * Copied from src/parser/ — these are standalone functions with minimal deps.
 * The originals remain in src/parser/ for other consumers (runner, verify, etc.).
 */

import type { TodoStats } from "@more/issue-state";
import type { Root, RootContent, PhrasingContent, ListItem } from "mdast";
import { SECTION_NAMES } from "./constants.js";

// ============================================================================
// MDAST Helpers
// ============================================================================

/** Find index of a heading matching any of the given texts */
function findHeadingIndexAny(ast: Root, texts: readonly string[]): number {
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
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- PhrasingContent is structurally compatible with RootContent for text extraction
    return (node.children as RootContent[]).map(getNodeText).join("");
  }
  return "";
}

/** Type guard for List nodes */
function isList(node: RootContent): node is import("mdast").List {
  return node.type === "list";
}

// ============================================================================
// Exported Functions
// ============================================================================

/**
 * Extract todos directly from a bodyAst.
 *
 * Supports both "Todo" (singular) and "Todos" (plural) headings.
 */
export function extractTodosFromAst(bodyAst: Root): TodoStats {
  const todosIdx = findHeadingIndexAny(bodyAst, SECTION_NAMES.TODO_ALIASES);

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

/**
 * Derive branch name from issue number and phase.
 */
export function deriveBranchName(
  parentIssueNumber: number,
  phaseNumber?: number,
): string {
  if (phaseNumber !== undefined && phaseNumber > 0) {
    return `claude/issue/${parentIssueNumber}/phase-${phaseNumber}`;
  }
  return `claude/issue/${parentIssueNumber}`;
}
