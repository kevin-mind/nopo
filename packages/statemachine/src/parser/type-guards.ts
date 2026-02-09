/**
 * Type guards for mdast nodes
 *
 * TypeScript doesn't narrow union types like RootContent to specific
 * node types (List, Heading, Table) after checking node.type.
 * These guards provide proper narrowing.
 */

import type { RootContent, List, Heading } from "mdast";

export function isList(node: RootContent): node is List {
  return node.type === "list";
}

export function isHeading(node: RootContent): node is Heading {
  return node.type === "heading";
}

/**
 * Get children of an mdast node as RootContent[].
 *
 * Many mdast nodes (TableCell, ListItem, etc.) have children typed as
 * PhrasingContent[], but these are structurally compatible with RootContent.
 * This helper centralizes the single unavoidable assertion.
 */
export function childrenAsRootContent(node: {
  children?: unknown[];
}): RootContent[] {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- PhrasingContent is structurally compatible with RootContent for text extraction
  return (node.children ?? []) as RootContent[];
}
