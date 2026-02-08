/**
 * Builder classes and MDAST helpers for creating common markdown patterns.
 */

import type { HistoryEntry, TodoItem } from "./types.js";
import { formatHistoryCells } from "./history.js";

// ============================================================================
// HistoryEntry Builder
// ============================================================================

export interface HistoryEntryOptions {
  message: string;
  iteration?: number;
  phase?: string | number;
  timestamp?: Date | string;
  commitSha?: string;
  runLink?: string;
  prNumber?: number;
  repoUrl?: string;
}

/**
 * Builder class for creating HistoryEntry objects with a fluent API.
 *
 * @example
 * ```typescript
 * const entry = new HistoryEntryBuilder("Started iteration")
 *   .iteration(1)
 *   .phase("Setup")
 *   .commit("abc1234")
 *   .run("https://github.com/owner/repo/actions/runs/123")
 *   .build();
 * ```
 */
export class HistoryEntryBuilder {
  private _message: string;
  private _iteration: number = 0;
  private _phase: string = "";
  private _timestamp: string | null = null;
  private _sha: string | null = null;
  private _runLink: string | null = null;

  constructor(message: string) {
    this._message = message;
  }

  /**
   * Create a HistoryEntryBuilder from options object.
   */
  static from(options: HistoryEntryOptions): HistoryEntryBuilder {
    const builder = new HistoryEntryBuilder(options.message);

    if (options.iteration !== undefined) {
      builder._iteration = options.iteration;
    }

    if (options.phase !== undefined) {
      builder._phase = String(options.phase);
    }

    if (options.timestamp !== undefined) {
      builder._timestamp = formatTimestampForEntry(options.timestamp);
    }

    if (options.commitSha) {
      builder._sha = options.commitSha;
    }

    if (options.runLink) {
      builder._runLink = options.runLink;
    }

    return builder;
  }

  /**
   * Set the iteration number.
   */
  iteration(n: number): this {
    this._iteration = n;
    return this;
  }

  /**
   * Set the phase name or number.
   */
  phase(p: string | number): this {
    this._phase = String(p);
    return this;
  }

  /**
   * Set the timestamp (ISO string or Date).
   */
  timestamp(t: Date | string): this {
    this._timestamp = formatTimestampForEntry(t);
    return this;
  }

  /**
   * Set the commit SHA.
   */
  commit(sha: string): this {
    this._sha = sha;
    return this;
  }

  /**
   * Alias for commit().
   */
  sha(sha: string): this {
    return this.commit(sha);
  }

  /**
   * Set the workflow run link.
   */
  run(link: string): this {
    this._runLink = link;
    return this;
  }

  /**
   * Alias for run().
   */
  runLink(link: string): this {
    return this.run(link);
  }

  /**
   * Build the HistoryEntry object.
   */
  build(): HistoryEntry {
    return {
      iteration: this._iteration,
      phase: this._phase,
      action: this._message,
      timestamp: this._timestamp,
      sha: this._sha,
      runLink: this._runLink,
    };
  }

  /**
   * Build and format as a table row string.
   */
  toTableRow(repoUrl?: string, prNumber?: number | null): string {
    const { shaCell, runCell } = formatHistoryCells(
      this._sha ?? undefined,
      this._runLink ?? undefined,
      repoUrl,
      prNumber,
    );

    const cells = [
      this._timestamp ?? "-",
      String(this._iteration),
      this._phase,
      this._message,
      shaCell,
      runCell,
    ];

    return `| ${cells.join(" | ")} |`;
  }
}

/**
 * Format timestamp for display in history entries.
 */
function formatTimestampForEntry(input: Date | string): string {
  try {
    const date = input instanceof Date ? input : new Date(input);
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

// ============================================================================
// MDAST Helpers
// ============================================================================

/**
 * MDAST node type - flexible record type for markdown AST nodes.
 * This is intentionally flexible to work with remark/unified ecosystem.
 */
export interface MdastNode {
  type: string;
  children?: MdastNode[];
  value?: string;
  depth?: number;
  ordered?: boolean;
  checked?: boolean | null;
  [key: string]: unknown;
}

/**
 * Create a text node.
 */
export function createText(value: string): MdastNode {
  return { type: "text", value };
}

/**
 * Create a heading node.
 */
export function createHeading(
  depth: 1 | 2 | 3 | 4 | 5 | 6,
  text: string,
): MdastNode {
  return {
    type: "heading",
    depth,
    children: [createText(text)],
  };
}

/**
 * Create a paragraph node.
 */
export function createParagraph(text: string): MdastNode {
  return {
    type: "paragraph",
    children: [createText(text)],
  };
}

/**
 * Create a list item node (for todos/checklists).
 */
export function createListItem(
  text: string,
  checked?: boolean | null,
): MdastNode {
  return {
    type: "listItem",
    checked: checked ?? null,
    children: [createParagraph(text)],
  };
}

/**
 * Create a todo list (unordered list with checkboxes).
 */
export function createTodoList(
  items: Array<{
    text: string;
    checked: boolean;
    manual?: boolean;
  }>,
): MdastNode {
  return {
    type: "list",
    ordered: false,
    children: items.map((item) =>
      createListItem(
        item.manual ? `[Manual] ${item.text}` : item.text,
        item.checked,
      ),
    ),
  };
}

/**
 * Create a bullet list (unordered list without checkboxes).
 */
export function createBulletList(items: string[]): MdastNode {
  return {
    type: "list",
    ordered: false,
    children: items.map((text) => createListItem(text)),
  };
}

/**
 * Create a numbered list (ordered list).
 */
export function createNumberedList(items: string[]): MdastNode {
  return {
    type: "list",
    ordered: true,
    children: items.map((text) => createListItem(text)),
  };
}

/**
 * Create a section with a heading and content.
 */
export function createSection(
  title: string,
  content: MdastNode[],
  depth: 2 | 3 | 4 = 2,
): MdastNode[] {
  return [createHeading(depth, title), ...content];
}

/**
 * Create a todo section with heading and todo list.
 */
export function createTodoSection(todos: TodoItem[]): MdastNode[] {
  return createSection("Todos", [
    createTodoList(
      todos.map((t) => ({
        text: t.text,
        checked: t.checked,
        manual: t.isManual,
      })),
    ),
  ]);
}

/**
 * Create a description section.
 */
export function createDescriptionSection(text: string): MdastNode[] {
  return createSection("Description", [createParagraph(text)]);
}

/**
 * Create a requirements section with a bullet list.
 */
export function createRequirementsSection(requirements: string[]): MdastNode[] {
  if (requirements.length === 0) {
    return createSection("Requirements", [
      createParagraph("_No specific requirements identified._"),
    ]);
  }
  return createSection("Requirements", [createBulletList(requirements)]);
}
