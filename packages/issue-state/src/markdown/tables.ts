/**
 * Generic Markdown Table <-> JSON
 *
 * Parses markdown tables into structured JSON arrays and serializes them back.
 */

import type { Table } from "../schemas/index.js";

/**
 * Parse a markdown table into { headers, rows }.
 * Each row is a Record<string, string> keyed by header name.
 */
export function parseTable(markdown: string): Table | null {
  const lines = markdown.split("\n").filter((l) => l.trim().startsWith("|"));

  if (lines.length < 2) {
    return null;
  }

  const parseCells = (line: string): string[] =>
    line
      .split("|")
      .map((c) => c.trim())
      .filter((c, i, arr) => i > 0 && i < arr.length - 1);

  const headers = parseCells(lines[0]!);

  if (headers.length === 0) {
    return null;
  }

  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    // Skip separator rows
    if (line.includes("---")) {
      continue;
    }

    const cells = parseCells(line);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]!] = cells[j] ?? "";
    }
    rows.push(row);
  }

  return { headers, rows };
}

/**
 * Serialize a table back to markdown.
 */
export function serializeTable(table: Table): string {
  const { headers, rows } = table;

  const headerRow = `| ${headers.join(" | ")} |`;
  const separatorRow = `|${headers.map(() => "---").join("|")}|`;

  const dataRows = rows.map((row) => {
    const cells = headers.map((h) => row[h] ?? "-");
    return `| ${cells.join(" | ")} |`;
  });

  return [headerRow, separatorRow, ...dataRows].join("\n");
}
