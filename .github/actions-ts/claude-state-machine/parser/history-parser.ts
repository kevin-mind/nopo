import type { HistoryEntry } from "../schemas/index.js";

/**
 * Section header for iteration history
 */
export const HISTORY_SECTION = "## Iteration History";

// ============================================================================
// Schema Definition
// ============================================================================

/**
 * Column definition for history table
 * - key: internal identifier used in row data objects
 * - value: display text shown in table header (case-sensitive matching)
 */
interface HeaderColumn {
  key: string;
  value: string;
}

/**
 * Table schema - defines column order and display names
 * To modify table structure, just change this array.
 */
const HEADER_COLUMNS: HeaderColumn[] = [
  { key: "time", value: "Time" },
  { key: "iteration", value: "#" },
  { key: "phase", value: "Phase" },
  { key: "action", value: "Action" },
  { key: "sha", value: "SHA" },
  { key: "run", value: "Run" },
];

/**
 * Row data as key-value map
 */
interface RowData {
  time?: string;
  iteration?: string;
  phase?: string;
  action?: string;
  sha?: string;
  run?: string;
  [key: string]: string | undefined;
}

/**
 * Parsed table representation
 */
interface ParsedTable {
  headerKeys: string[]; // Column keys in order found in table
  rows: RowData[];
  unmatchedHeaders: string[]; // Headers that couldn't be mapped (for error logging)
}

// ============================================================================
// Table Parsing
// ============================================================================

/**
 * Build a map from display value to key for header parsing
 */
function buildValueToKeyMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const col of HEADER_COLUMNS) {
    map.set(col.value, col.key);
  }
  return map;
}

/**
 * Parse the header row to determine column positions and keys
 * Returns array of keys in column order, or null for unmatched columns
 */
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
      keys.push(null); // Unknown column, will be dropped
      unmatched.push(cell);
    }
  }

  return { keys, unmatched };
}

/**
 * Parse a data row using the column key mapping
 */
function parseDataRow(row: string, columnKeys: (string | null)[]): RowData {
  const cells = row
    .split("|")
    .map((c) => c.trim())
    .filter((c, i, arr) => i > 0 && i < arr.length - 1);

  const data: RowData = {};

  for (let i = 0; i < columnKeys.length && i < cells.length; i++) {
    const key = columnKeys[i];
    if (key) {
      // Only include mapped columns (drop unknown ones)
      data[key] = cells[i];
    }
  }

  return data;
}

/**
 * Parse the history table from issue body into structured data
 */
function parseTable(body: string): ParsedTable | null {
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

    // Stop if we hit another section
    if (line.startsWith("##") && !line.includes(HISTORY_SECTION)) {
      break;
    }

    // Skip non-table lines
    if (!line.startsWith("|")) {
      continue;
    }

    // Skip separator rows
    if (line.includes("---")) {
      continue;
    }

    // First table row should be header
    if (!foundHeader) {
      const parsed = parseHeaderRow(line, valueToKeyMap);
      headerKeys = parsed.keys;
      unmatchedHeaders = parsed.unmatched;
      foundHeader = true;
      continue;
    }

    // Data rows
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
// Table Serialization
// ============================================================================

/**
 * Generate table header row from schema
 */
function generateHeaderRow(): string {
  const cells = HEADER_COLUMNS.map((col) => col.value);
  return `| ${cells.join(" | ")} |`;
}

/**
 * Generate table separator row from schema
 */
function generateSeparatorRow(): string {
  const cells = HEADER_COLUMNS.map(() => "---");
  return `|${cells.join("|")}|`;
}

/**
 * Serialize a row data object to table row string
 */
function serializeRow(data: RowData): string {
  const cells = HEADER_COLUMNS.map((col) => data[col.key] ?? "-");
  return `| ${cells.join(" | ")} |`;
}

/**
 * Serialize full table from rows
 */
function serializeTable(rows: RowData[]): string {
  const headerRow = generateHeaderRow();
  const separatorRow = generateSeparatorRow();
  const dataRows = rows.map(serializeRow);

  return [headerRow, separatorRow, ...dataRows].join("\n");
}

// ============================================================================
// Timestamp Formatting
// ============================================================================

/**
 * Format timestamp for display in history table
 * Input: ISO 8601 timestamp (e.g., "2026-01-22T19:04:52Z")
 * Output: Compact format (e.g., "Jan 22 19:04")
 */
function formatTimestamp(isoTimestamp?: string): string {
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

// ============================================================================
// Cell Formatting Helpers
// ============================================================================

/**
 * Parse a markdown link to extract URL
 */
function parseMarkdownLink(text: string): string | null {
  const match = text.match(/\[.*?\]\((.*?)\)/);
  return match?.[1] ?? null;
}

/**
 * Extract run ID from a GitHub Actions run URL
 * Input: https://github.com/owner/repo/actions/runs/12345678901
 * Output: "12345678901"
 */
function extractRunIdFromUrl(url: string): string | null {
  const match = url.match(/\/actions\/runs\/(\d+)/);
  return match?.[1] ?? null;
}

/**
 * Parse run ID from a Run cell
 * Cell formats:
 *   - New format: [12345678901](url) - returns "12345678901"
 *   - Old format: [Run](url) - extracts from URL
 */
function parseRunIdFromCell(cell: string): string | null {
  if (cell === "-" || cell.trim() === "") {
    return null;
  }

  // Try to extract link text (new format: [runId](url))
  const linkTextMatch = cell.match(/\[(\d+)\]/);
  if (linkTextMatch) {
    return linkTextMatch[1] ?? null;
  }

  // Old format: [Run](url) - extract from URL
  const url = parseMarkdownLink(cell);
  if (url) {
    return extractRunIdFromUrl(url);
  }

  return null;
}

/**
 * Parse a SHA cell - could be a link or just text
 */
function parseShaCell(cell: string): string | null {
  if (cell === "-" || cell.trim() === "") {
    return null;
  }

  // Try to extract from markdown link like [`abc123`](url)
  const linkMatch = cell.match(/\[`?([a-f0-9]+)`?\]/i);
  if (linkMatch) {
    return linkMatch[1] ?? null;
  }

  // Plain SHA
  const shaMatch = cell.match(/^[a-f0-9]+$/i);
  if (shaMatch) {
    return cell;
  }

  return null;
}

/**
 * Format cells for history table (with links)
 * Run cell format: [runId](url) for deduplication by run_id
 * SHA cell: commit link or PR link (if prNumber provided)
 */
export function formatHistoryCells(
  sha?: string,
  runLink?: string,
  repoUrl?: string,
  prNumber?: number,
): { shaCell: string; runCell: string } {
  const serverUrl =
    repoUrl || process.env.GITHUB_SERVER_URL || "https://github.com";
  const repo = process.env.GITHUB_REPOSITORY || "";
  const fullRepoUrl = repo ? `${serverUrl}/${repo}` : serverUrl;

  // PR number takes precedence for review-related rows
  let shaCell = "-";
  if (prNumber) {
    shaCell = `[#${prNumber}](${fullRepoUrl}/pull/${prNumber})`;
  } else if (sha) {
    shaCell = `[\`${sha.slice(0, 7)}\`](${fullRepoUrl}/commit/${sha})`;
  }

  // Use run ID as link text for deduplication
  let runCell = "-";
  if (runLink) {
    const runId = extractRunIdFromUrl(runLink);
    if (runId) {
      runCell = `[${runId}](${runLink})`;
    } else {
      // Fallback to old format if no run ID found
      runCell = `[Run](${runLink})`;
    }
  }

  return { shaCell, runCell };
}

// ============================================================================
// Public API - Parsing
// ============================================================================

/**
 * Convert RowData to HistoryEntry
 */
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

/**
 * Parse a table row into a HistoryEntry (for backward compatibility)
 */
export function parseHistoryRow(row: string): HistoryEntry | null {
  const valueToKeyMap = buildValueToKeyMap();

  // Try to detect if this is a header row
  const cells = row
    .split("|")
    .map((c) => c.trim())
    .filter((c, i, arr) => i > 0 && i < arr.length - 1 && c !== "");

  // Skip header and separator rows
  if (cells.some((c) => valueToKeyMap.has(c)) || row.includes("---")) {
    return null;
  }

  // Try to parse as new format first (Time first)
  const newFormatKeys = HEADER_COLUMNS.map((c) => c.key);
  const newData = parseDataRow(row, newFormatKeys);

  // Check if it looks like new format (time is not a number)
  const firstCell = cells[0] || "";
  if (!/^\d+$/.test(firstCell)) {
    // New format: Time, #, Phase, Action, SHA, Run
    return rowDataToHistoryEntry(newData);
  }

  // Old format: #, Phase, Action, SHA, Run (no time column)
  const oldFormatKeys = ["iteration", "phase", "action", "sha", "run"];
  const oldData = parseDataRow(row, oldFormatKeys);
  return rowDataToHistoryEntry(oldData);
}

/**
 * Parse all history entries from an issue body
 */
export function parseHistory(body: string): HistoryEntry[] {
  const parsed = parseTable(body);

  if (!parsed) {
    return [];
  }

  // Log unmatched headers as warnings
  if (parsed.unmatchedHeaders.length > 0) {
    console.warn(
      `[history-parser] Unmatched table headers (will be dropped): ${parsed.unmatchedHeaders.join(", ")}`,
    );
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

/**
 * Get the latest history entry
 */
export function getLatestHistoryEntry(body: string): HistoryEntry | null {
  const entries = parseHistory(body);
  return entries.length > 0 ? entries[entries.length - 1]! : null;
}

// ============================================================================
// Public API - Creating/Updating
// ============================================================================

/**
 * Create row data from entry parameters
 */
function createRowData(
  iteration: number,
  phase: string | number,
  message: string,
  timestamp?: string,
  sha?: string,
  runLink?: string,
  repoUrl?: string,
  prNumber?: number,
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

/**
 * Create a new history entry row
 */
export function createHistoryRow(
  iteration: number,
  phase: string | number,
  message: string,
  timestamp?: string,
  sha?: string,
  runLink?: string,
  repoUrl?: string,
  prNumber?: number,
): string {
  const data = createRowData(
    iteration,
    phase,
    message,
    timestamp,
    sha,
    runLink,
    repoUrl,
    prNumber,
  );
  return serializeRow(data);
}

/**
 * Create the full history table (header + rows)
 * Note: HistoryEntry.timestamp is already in display format, not ISO
 */
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

  return `${HISTORY_SECTION}

${serializeTable(rows)}`;
}

/**
 * Add a history entry to an issue body
 * Handles migration from old table formats automatically
 *
 * Deduplication: If a row with the same run_id already exists,
 * the new message is appended to that row's action with " → " separator
 * instead of creating a new row.
 */
export function addHistoryEntry(
  body: string,
  iteration: number,
  phase: string | number,
  message: string,
  timestamp?: string,
  sha?: string,
  runLink?: string,
  repoUrl?: string,
  prNumber?: number,
): string {
  const newRowData = createRowData(
    iteration,
    phase,
    message,
    timestamp,
    sha,
    runLink,
    repoUrl,
    prNumber,
  );

  // Extract run_id from the new entry for deduplication
  const newRunId = runLink ? extractRunIdFromUrl(runLink) : null;

  const historyIdx = body.indexOf(HISTORY_SECTION);

  if (historyIdx === -1) {
    // No history section - create new one
    const table = serializeTable([newRowData]);
    return `${body}

${HISTORY_SECTION}

${table}`;
  }

  // Parse existing table
  const parsed = parseTable(body);

  if (!parsed) {
    // Couldn't parse, just append
    const table = serializeTable([newRowData]);
    return `${body}

${HISTORY_SECTION}

${table}`;
  }

  // Log unmatched headers
  if (parsed.unmatchedHeaders.length > 0) {
    console.warn(
      `[history-parser] Unmatched table headers during add (will be dropped): ${parsed.unmatchedHeaders.join(", ")}`,
    );
  }

  // Convert existing rows to proper format
  const existingRows: RowData[] = parsed.rows.map((row) => {
    // Fill in missing keys with "-"
    const normalized: RowData = {};
    for (const col of HEADER_COLUMNS) {
      normalized[col.key] = row[col.key] ?? "-";
    }
    return normalized;
  });

  // Check for deduplication: if a row with the same run_id exists, update it
  let allRows: RowData[];
  let matchIdx = -1;

  if (newRunId) {
    // Search for existing row with same run_id
    matchIdx = existingRows.findIndex((row) => {
      const existingRunId = parseRunIdFromCell(row.run ?? "");
      return existingRunId === newRunId;
    });
  }

  if (matchIdx !== -1) {
    // Found existing row with same run_id - append action
    const existingRow = existingRows[matchIdx]!;
    const existingAction = existingRow.action ?? "";
    const newAction = existingAction
      ? `${existingAction} → ${message}`
      : message;

    // Update the existing row with appended action and new SHA if provided
    const updatedRow: RowData = {
      ...existingRow,
      action: newAction,
    };

    // Update SHA if new one provided (use latest)
    if (sha && newRowData.sha !== "-") {
      updatedRow.sha = newRowData.sha;
    }

    // Update timestamp to latest
    if (newRowData.time && newRowData.time !== "-") {
      updatedRow.time = newRowData.time;
    }

    allRows = existingRows.map((row, idx) =>
      idx === matchIdx ? updatedRow : row,
    );
  } else {
    // No matching run_id - add new row
    allRows = [...existingRows, newRowData];
  }

  // Find where the history section ends to preserve content after it
  const lines = body.split("\n");
  const historyLineIdx = lines.findIndex((l) => l.includes(HISTORY_SECTION));

  // Find end of table
  let tableEndIdx = historyLineIdx + 1;
  for (let i = historyLineIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.startsWith("|")) {
      tableEndIdx = i + 1;
    } else if (line.trim() !== "") {
      break;
    }
  }

  // Rebuild body with new table
  const beforeHistory = lines.slice(0, historyLineIdx).join("\n");
  const afterTable = lines.slice(tableEndIdx).join("\n");
  const newTable = serializeTable(allRows);

  const parts = [beforeHistory, HISTORY_SECTION, "", newTable];
  if (afterTable.trim()) {
    parts.push("", afterTable);
  }

  return parts.join("\n");
}

/**
 * Update the most recent history entry matching criteria
 */
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
  prNumber?: number,
): { body: string; updated: boolean } {
  const parsed = parseTable(body);

  if (!parsed || parsed.rows.length === 0) {
    return { body, updated: false };
  }

  // Log unmatched headers
  if (parsed.unmatchedHeaders.length > 0) {
    console.warn(
      `[history-parser] Unmatched table headers during update (will be dropped): ${parsed.unmatchedHeaders.join(", ")}`,
    );
  }

  // Find matching row (search from end for most recent)
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

  // Update the matched row
  const existingRow = parsed.rows[matchIdx]!;
  const { shaCell, runCell } = formatHistoryCells(
    sha,
    runLink,
    repoUrl,
    prNumber,
  );

  const updatedRow: RowData = {
    time: timestamp ? formatTimestamp(timestamp) : (existingRow.time ?? "-"),
    iteration: existingRow.iteration,
    phase: existingRow.phase,
    action: newMessage,
    sha: sha || prNumber ? shaCell : (existingRow.sha ?? "-"),
    run: runLink ? runCell : (existingRow.run ?? "-"),
  };

  // Normalize all rows and apply update
  const normalizedRows: RowData[] = parsed.rows.map((row, idx) => {
    if (idx === matchIdx) {
      return updatedRow;
    }
    // Normalize existing row
    const normalized: RowData = {};
    for (const col of HEADER_COLUMNS) {
      normalized[col.key] = row[col.key] ?? "-";
    }
    return normalized;
  });

  // Rebuild body
  const lines = body.split("\n");
  const historyLineIdx = lines.findIndex((l) => l.includes(HISTORY_SECTION));

  // Find end of table
  let tableEndIdx = historyLineIdx + 1;
  for (let i = historyLineIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.startsWith("|")) {
      tableEndIdx = i + 1;
    } else if (line.trim() !== "") {
      break;
    }
  }

  // Rebuild body with updated table
  const beforeHistory = lines.slice(0, historyLineIdx).join("\n");
  const afterTable = lines.slice(tableEndIdx).join("\n");
  const newTable = serializeTable(normalizedRows);

  const parts = [beforeHistory, HISTORY_SECTION, "", newTable];
  if (afterTable.trim()) {
    parts.push("", afterTable);
  }

  return { body: parts.join("\n"), updated: true };
}

// ============================================================================
// Public API - Querying
// ============================================================================

/**
 * Find history entries matching a pattern
 */
export function findHistoryEntries(
  body: string,
  pattern: string,
): HistoryEntry[] {
  const entries = parseHistory(body);
  return entries.filter((entry) => entry.action.includes(pattern));
}

/**
 * Get history entries for a specific phase
 */
export function getPhaseHistory(
  body: string,
  phase: string | number,
): HistoryEntry[] {
  const entries = parseHistory(body);
  return entries.filter((entry) => entry.phase === String(phase));
}

/**
 * Check if a history entry exists with a specific message pattern
 */
export function hasHistoryEntry(body: string, pattern: string): boolean {
  const entries = findHistoryEntries(body, pattern);
  return entries.length > 0;
}
