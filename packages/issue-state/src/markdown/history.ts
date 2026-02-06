/**
 * History Parser
 *
 * Ported from .github/statemachine/issue/actions-ts/state-machine/parser/history-parser.ts
 * Key change: removed process.env dependency, accepts repoUrl as param.
 */

import type { HistoryEntry } from "../schemas/index.js";

export const HISTORY_SECTION = "## Iteration History";

interface HeaderColumn {
  key: string;
  value: string;
}

const HEADER_COLUMNS: HeaderColumn[] = [
  { key: "time", value: "Time" },
  { key: "iteration", value: "#" },
  { key: "phase", value: "Phase" },
  { key: "action", value: "Action" },
  { key: "sha", value: "SHA" },
  { key: "run", value: "Run" },
];

interface RowData {
  time?: string;
  iteration?: string;
  phase?: string;
  action?: string;
  sha?: string;
  run?: string;
  [key: string]: string | undefined;
}

interface ParsedTable {
  headerKeys: string[];
  rows: RowData[];
  unmatchedHeaders: string[];
}

function buildValueToKeyMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const col of HEADER_COLUMNS) {
    map.set(col.value, col.key);
  }
  return map;
}

function parseHeaderRow(
  headerRow: string,
  valueToKeyMap: Map<string, string>,
): { keys: (string | null)[]; unmatched: string[] } {
  const cells = headerRow
    .split("|")
    .map((c) => c.trim())
    .filter((c, i, arr) => i > 0 && i < arr.length - 1 && c !== "");

  const keys: (string | null)[] = [];
  const unmatched: string[] = [];

  for (const cell of cells) {
    const key = valueToKeyMap.get(cell);
    if (key) {
      keys.push(key);
    } else {
      keys.push(null);
      unmatched.push(cell);
    }
  }

  return { keys, unmatched };
}

function parseDataRow(row: string, columnKeys: (string | null)[]): RowData {
  const cells = row
    .split("|")
    .map((c) => c.trim())
    .filter((c, i, arr) => i > 0 && i < arr.length - 1);

  const data: RowData = {};

  for (let i = 0; i < columnKeys.length && i < cells.length; i++) {
    const key = columnKeys[i];
    if (key) {
      data[key] = cells[i];
    }
  }

  return data;
}

function parseTableFromBody(body: string): ParsedTable | null {
  const lines = body.split("\n");
  const historyIdx = lines.findIndex((l) => l.includes(HISTORY_SECTION));

  if (historyIdx === -1) {
    return null;
  }

  const valueToKeyMap = buildValueToKeyMap();
  let headerKeys: (string | null)[] = [];
  let unmatchedHeaders: string[] = [];
  const rows: RowData[] = [];
  let foundHeader = false;

  for (let i = historyIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    if (line.startsWith("##") && !line.includes(HISTORY_SECTION)) {
      break;
    }
    if (!line.startsWith("|")) {
      continue;
    }
    if (line.includes("---")) {
      continue;
    }

    if (!foundHeader) {
      const parsed = parseHeaderRow(line, valueToKeyMap);
      headerKeys = parsed.keys;
      unmatchedHeaders = parsed.unmatched;
      foundHeader = true;
      continue;
    }

    const rowData = parseDataRow(line, headerKeys);
    rows.push(rowData);
  }

  return {
    headerKeys: headerKeys.filter((k): k is string => k !== null),
    rows,
    unmatchedHeaders,
  };
}

// ============================================================================
// Serialization
// ============================================================================

function generateHeaderRow(): string {
  const cells = HEADER_COLUMNS.map((col) => col.value);
  return `| ${cells.join(" | ")} |`;
}

function generateSeparatorRow(): string {
  const cells = HEADER_COLUMNS.map(() => "---");
  return `|${cells.join("|")}|`;
}

function serializeRow(data: RowData): string {
  const cells = HEADER_COLUMNS.map((col) => data[col.key] ?? "-");
  return `| ${cells.join(" | ")} |`;
}

function serializeTableRows(rows: RowData[]): string {
  const headerRow = generateHeaderRow();
  const separatorRow = generateSeparatorRow();
  const dataRows = rows.map(serializeRow);
  return [headerRow, separatorRow, ...dataRows].join("\n");
}

// ============================================================================
// Formatting Helpers
// ============================================================================

function formatTimestamp(isoTimestamp?: string): string {
  if (!isoTimestamp) return "-";

  try {
    const date = new Date(isoTimestamp);
    if (isNaN(date.getTime())) return "-";

    const months = [
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
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

function parseMarkdownLink(text: string): string | null {
  const match = text.match(/\[.*?\]\((.*?)\)/);
  return match?.[1] ?? null;
}

function extractRunIdFromUrl(url: string): string | null {
  const match = url.match(/\/actions\/runs\/(\d+)/);
  return match?.[1] ?? null;
}

function parseRunIdFromCell(cell: string): string | null {
  if (cell === "-" || cell.trim() === "") {
    return null;
  }

  const linkTextMatch = cell.match(/\[(\d+)\]/);
  if (linkTextMatch) {
    return linkTextMatch[1] ?? null;
  }

  const url = parseMarkdownLink(cell);
  if (url) {
    return extractRunIdFromUrl(url);
  }

  return null;
}

function parseShaCell(cell: string): string | null {
  if (cell === "-" || cell.trim() === "") {
    return null;
  }

  const linkMatch = cell.match(/\[`?([a-f0-9]+)`?\]/i);
  if (linkMatch) {
    return linkMatch[1] ?? null;
  }

  const shaMatch = cell.match(/^[a-f0-9]+$/i);
  if (shaMatch) {
    return cell;
  }

  return null;
}

export function formatHistoryCells(
  sha?: string,
  runLink?: string,
  repoUrl?: string,
  prNumber?: number | null,
): { shaCell: string; runCell: string } {
  const fullRepoUrl = repoUrl || "";

  let shaCell = "-";
  if (prNumber) {
    shaCell = `[#${prNumber}](${fullRepoUrl}/pull/${prNumber})`;
  } else if (sha) {
    shaCell = `[\`${sha.slice(0, 7)}\`](${fullRepoUrl}/commit/${sha})`;
  }

  let runCell = "-";
  if (runLink) {
    const runId = extractRunIdFromUrl(runLink);
    if (runId) {
      runCell = `[${runId}](${runLink})`;
    } else {
      runCell = `[Run](${runLink})`;
    }
  }

  return { shaCell, runCell };
}

// ============================================================================
// Public API - Parsing
// ============================================================================

function rowDataToHistoryEntry(data: RowData): HistoryEntry | null {
  const iterationStr = data.iteration;
  if (!iterationStr) return null;

  const iteration = parseInt(iterationStr, 10);
  if (isNaN(iteration)) return null;

  const timestamp = data.time && data.time !== "-" ? data.time : null;

  return {
    iteration,
    phase: data.phase || "",
    action: data.action || "",
    timestamp,
    sha: data.sha ? parseShaCell(data.sha) : null,
    runLink: data.run ? parseMarkdownLink(data.run) : null,
  };
}

export function parseHistoryRow(row: string): HistoryEntry | null {
  const valueToKeyMap = buildValueToKeyMap();

  const cells = row
    .split("|")
    .map((c) => c.trim())
    .filter((c, i, arr) => i > 0 && i < arr.length - 1 && c !== "");

  if (cells.some((c) => valueToKeyMap.has(c)) || row.includes("---")) {
    return null;
  }

  const newFormatKeys = HEADER_COLUMNS.map((c) => c.key);
  const newData = parseDataRow(row, newFormatKeys);

  const firstCell = cells[0] || "";
  if (!/^\d+$/.test(firstCell)) {
    return rowDataToHistoryEntry(newData);
  }

  const oldFormatKeys = ["iteration", "phase", "action", "sha", "run"];
  const oldData = parseDataRow(row, oldFormatKeys);
  return rowDataToHistoryEntry(oldData);
}

export function parseHistory(body: string): HistoryEntry[] {
  const parsed = parseTableFromBody(body);

  if (!parsed) {
    return [];
  }

  const entries: HistoryEntry[] = [];
  for (const row of parsed.rows) {
    const entry = rowDataToHistoryEntry(row);
    if (entry) {
      entries.push(entry);
    }
  }

  return entries;
}

export function getLatestHistoryEntry(body: string): HistoryEntry | null {
  const entries = parseHistory(body);
  return entries.length > 0 ? entries[entries.length - 1]! : null;
}

// ============================================================================
// Public API - Creating/Updating
// ============================================================================

function createRowData(
  iteration: number,
  phase: string | number,
  message: string,
  timestamp?: string,
  sha?: string,
  runLink?: string,
  repoUrl?: string,
  prNumber?: number | null,
): RowData {
  const { shaCell, runCell } = formatHistoryCells(
    sha,
    runLink,
    repoUrl,
    prNumber,
  );

  return {
    time: formatTimestamp(timestamp),
    iteration: String(iteration),
    phase: String(phase),
    action: message,
    sha: shaCell,
    run: runCell,
  };
}

export function createHistoryRow(
  iteration: number,
  phase: string | number,
  message: string,
  timestamp?: string,
  sha?: string,
  runLink?: string,
  repoUrl?: string,
  prNumber?: number | null,
): string {
  const data = createRowData(
    iteration, phase, message, timestamp, sha, runLink, repoUrl, prNumber,
  );
  return serializeRow(data);
}

export function createHistoryTable(
  entries: HistoryEntry[],
  repoUrl?: string,
): string {
  const rows = entries.map((entry) => {
    const { shaCell, runCell } = formatHistoryCells(
      entry.sha ?? undefined,
      entry.runLink ?? undefined,
      repoUrl,
    );

    return {
      time: entry.timestamp ?? "-",
      iteration: String(entry.iteration),
      phase: entry.phase,
      action: entry.action,
      sha: shaCell,
      run: runCell,
    };
  });

  return `${HISTORY_SECTION}\n\n${serializeTableRows(rows)}`;
}

export function addHistoryEntry(
  body: string,
  iteration: number,
  phase: string | number,
  message: string,
  timestamp?: string,
  sha?: string,
  runLink?: string,
  repoUrl?: string,
  prNumber?: number | null,
): string {
  const newRowData = createRowData(
    iteration, phase, message, timestamp, sha, runLink, repoUrl, prNumber,
  );

  const newRunId = runLink ? extractRunIdFromUrl(runLink) : null;

  const historyIdx = body.indexOf(HISTORY_SECTION);

  if (historyIdx === -1) {
    const table = serializeTableRows([newRowData]);
    return `${body}\n\n${HISTORY_SECTION}\n\n${table}`;
  }

  const parsed = parseTableFromBody(body);

  if (!parsed) {
    const table = serializeTableRows([newRowData]);
    return `${body}\n\n${HISTORY_SECTION}\n\n${table}`;
  }

  const existingRows: RowData[] = parsed.rows.map((row) => {
    const normalized: RowData = {};
    for (const col of HEADER_COLUMNS) {
      normalized[col.key] = row[col.key] ?? "-";
    }
    return normalized;
  });

  let allRows: RowData[];
  let matchIdx = -1;

  if (newRunId) {
    matchIdx = existingRows.findIndex((row) => {
      const existingRunId = parseRunIdFromCell(row.run ?? "");
      return existingRunId === newRunId;
    });
  }

  if (matchIdx !== -1) {
    const existingRow = existingRows[matchIdx]!;
    const existingAction = existingRow.action ?? "";
    const newAction = existingAction
      ? `${existingAction} → ${message}`
      : message;

    const updatedRow: RowData = {
      ...existingRow,
      action: newAction,
    };

    if (sha && newRowData.sha !== "-") {
      updatedRow.sha = newRowData.sha;
    }

    if (newRowData.time && newRowData.time !== "-") {
      updatedRow.time = newRowData.time;
    }

    allRows = existingRows.map((row, idx) =>
      idx === matchIdx ? updatedRow : row,
    );
  } else {
    allRows = [...existingRows, newRowData];
  }

  const lines = body.split("\n");
  const historyLineIdx = lines.findIndex((l) => l.includes(HISTORY_SECTION));

  let tableEndIdx = historyLineIdx + 1;
  for (let i = historyLineIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.startsWith("|")) {
      tableEndIdx = i + 1;
    } else if (line.trim() !== "") {
      break;
    }
  }

  const beforeHistory = lines.slice(0, historyLineIdx).join("\n");
  const afterTable = lines.slice(tableEndIdx).join("\n");
  const newTable = serializeTableRows(allRows);

  const parts = [beforeHistory, HISTORY_SECTION, "", newTable];
  if (afterTable.trim()) {
    parts.push("", afterTable);
  }

  return parts.join("\n");
}

export function updateHistoryEntry(
  body: string,
  matchIteration: number,
  matchPhase: string | number,
  matchPattern: string,
  newMessage: string,
  timestamp?: string,
  sha?: string,
  runLink?: string,
  repoUrl?: string,
  prNumber?: number | null,
): { body: string; updated: boolean } {
  const parsed = parseTableFromBody(body);

  if (!parsed || parsed.rows.length === 0) {
    return { body, updated: false };
  }

  let matchIdx = -1;
  for (let i = parsed.rows.length - 1; i >= 0; i--) {
    const row = parsed.rows[i];
    if (!row) continue;

    const rowIteration = row.iteration || "";
    const rowPhase = row.phase || "";
    const rowAction = row.action || "";

    if (
      rowIteration === String(matchIteration) &&
      rowPhase === String(matchPhase) &&
      rowAction.includes(matchPattern)
    ) {
      matchIdx = i;
      break;
    }
  }

  if (matchIdx === -1) {
    return { body, updated: false };
  }

  const existingRow = parsed.rows[matchIdx]!;
  const { shaCell, runCell } = formatHistoryCells(
    sha, runLink, repoUrl, prNumber,
  );

  const updatedRow: RowData = {
    time: timestamp ? formatTimestamp(timestamp) : (existingRow.time ?? "-"),
    iteration: existingRow.iteration,
    phase: existingRow.phase,
    action: newMessage,
    sha: sha || prNumber ? shaCell : (existingRow.sha ?? "-"),
    run: runLink ? runCell : (existingRow.run ?? "-"),
  };

  const normalizedRows: RowData[] = parsed.rows.map((row, idx) => {
    if (idx === matchIdx) {
      return updatedRow;
    }
    const normalized: RowData = {};
    for (const col of HEADER_COLUMNS) {
      normalized[col.key] = row[col.key] ?? "-";
    }
    return normalized;
  });

  const lines = body.split("\n");
  const historyLineIdx = lines.findIndex((l) => l.includes(HISTORY_SECTION));

  let tableEndIdx = historyLineIdx + 1;
  for (let i = historyLineIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.startsWith("|")) {
      tableEndIdx = i + 1;
    } else if (line.trim() !== "") {
      break;
    }
  }

  const beforeHistory = lines.slice(0, historyLineIdx).join("\n");
  const afterTable = lines.slice(tableEndIdx).join("\n");
  const newTable = serializeTableRows(normalizedRows);

  const parts = [beforeHistory, HISTORY_SECTION, "", newTable];
  if (afterTable.trim()) {
    parts.push("", afterTable);
  }

  return { body: parts.join("\n"), updated: true };
}

export function findHistoryEntries(
  body: string,
  pattern: string,
): HistoryEntry[] {
  const entries = parseHistory(body);
  return entries.filter((entry) => entry.action.includes(pattern));
}

export function getPhaseHistory(
  body: string,
  phase: string | number,
): HistoryEntry[] {
  const entries = parseHistory(body);
  return entries.filter((entry) => entry.phase === String(phase));
}

export function hasHistoryEntry(body: string, pattern: string): boolean {
  const entries = findHistoryEntries(body, pattern);
  return entries.length > 0;
}
