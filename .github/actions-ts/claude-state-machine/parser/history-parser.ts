import type { HistoryEntry } from "../schemas/index.js";

/**
 * Section header for iteration history
 */
export const HISTORY_SECTION = "## Iteration History";

/**
 * Table header row
 */
const TABLE_HEADER = "| # | Phase | Action | Time | SHA | Run |";
const TABLE_SEPARATOR = "|---|-------|--------|------|-----|-----|";

/**
 * Parse a markdown link to extract URL
 */
function parseMarkdownLink(text: string): string | null {
  const match = text.match(/\[.*?\]\((.*?)\)/);
  return match?.[1] ?? null;
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
 * Parse a table row into a HistoryEntry
 * Supports both old format (5 columns) and new format (6 columns with timestamp)
 */
export function parseHistoryRow(row: string): HistoryEntry | null {
  // Split by | and clean up
  const cells = row.split("|").map((c) => c.trim());

  // cells[0] is empty (before first |), cells[last] may be empty (after last |)
  // Old format: | # | Phase | Action | SHA | Run | → 7 cells after split
  // New format: | # | Phase | Action | Time | SHA | Run | → 8 cells after split
  // Filter out empty cells at start and end for accurate count
  const dataCells = cells.filter((c, i) => i > 0 && i < cells.length - 1);
  const hasTimestampColumn = dataCells.length >= 6;

  if (dataCells.length < 5) {
    return null;
  }

  const iterationStr = dataCells[0];
  const phase = dataCells[1];
  const action = dataCells[2];

  let timestampCell: string | undefined;
  let shaCell: string | undefined;
  let runCell: string | undefined;

  if (hasTimestampColumn) {
    // New format with timestamp: #, Phase, Action, Time, SHA, Run
    timestampCell = dataCells[3];
    shaCell = dataCells[4];
    runCell = dataCells[5];
  } else {
    // Old format without timestamp: #, Phase, Action, SHA, Run
    shaCell = dataCells[3];
    runCell = dataCells[4];
  }

  // Skip header and separator rows
  if (
    !iterationStr ||
    iterationStr === "#" ||
    iterationStr.startsWith("---") ||
    !phase ||
    !action
  ) {
    return null;
  }

  const iteration = parseInt(iterationStr, 10);
  if (isNaN(iteration)) {
    return null;
  }

  // Parse timestamp - it's stored as display format like "Jan 22 19:04"
  const timestamp =
    timestampCell && timestampCell !== "-" ? timestampCell : null;

  return {
    iteration,
    phase,
    action,
    timestamp,
    sha: shaCell ? parseShaCell(shaCell) : null,
    runLink: runCell ? parseMarkdownLink(runCell) : null,
  };
}

/**
 * Parse all history entries from an issue body
 */
export function parseHistory(body: string): HistoryEntry[] {
  const lines = body.split("\n");
  const historyIdx = lines.findIndex((l) => l.includes(HISTORY_SECTION));

  if (historyIdx === -1) {
    return [];
  }

  const entries: HistoryEntry[] = [];

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

    const entry = parseHistoryRow(line);
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

/**
 * Format cells for history table (with links)
 */
export function formatHistoryCells(
  sha?: string,
  runLink?: string,
  repoUrl?: string,
): { shaCell: string; runCell: string } {
  const serverUrl =
    repoUrl || process.env.GITHUB_SERVER_URL || "https://github.com";
  const repo = process.env.GITHUB_REPOSITORY || "";
  const fullRepoUrl = repo ? `${serverUrl}/${repo}` : serverUrl;

  const shaCell = sha
    ? `[\`${sha.slice(0, 7)}\`](${fullRepoUrl}/commit/${sha})`
    : "-";
  const runCell = runLink ? `[Run](${runLink})` : "-";

  return { shaCell, runCell };
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
): string {
  const timeCell = formatTimestamp(timestamp);
  const { shaCell, runCell } = formatHistoryCells(sha, runLink, repoUrl);
  return `| ${iteration} | ${phase} | ${message} | ${timeCell} | ${shaCell} | ${runCell} |`;
}

/**
 * Create the full history table (header + rows)
 */
export function createHistoryTable(
  entries: HistoryEntry[],
  repoUrl?: string,
): string {
  const rows = entries.map((entry) =>
    createHistoryRow(
      entry.iteration,
      entry.phase,
      entry.action,
      entry.timestamp ?? undefined,
      entry.sha ?? undefined,
      entry.runLink ?? undefined,
      repoUrl,
    ),
  );

  return `${HISTORY_SECTION}

${TABLE_HEADER}
${TABLE_SEPARATOR}
${rows.join("\n")}`;
}

/**
 * Add a history entry to an issue body
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
): string {
  const historyIdx = body.indexOf(HISTORY_SECTION);

  const newRow = createHistoryRow(
    iteration,
    phase,
    message,
    timestamp,
    sha,
    runLink,
    repoUrl,
  );

  if (historyIdx === -1) {
    // Add history section at the end
    const historyTable = `

${HISTORY_SECTION}

${TABLE_HEADER}
${TABLE_SEPARATOR}
${newRow}`;

    return body + historyTable;
  }

  // Find the last table row after history section
  const lines = body.split("\n");
  const historyLineIdx = lines.findIndex((l) => l.includes(HISTORY_SECTION));

  if (historyLineIdx === -1) {
    return body;
  }

  // Find last table row
  let insertIdx = historyLineIdx + 1;
  for (let i = historyLineIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    if (line.startsWith("|")) {
      insertIdx = i + 1;
    } else if (line.trim() !== "" && !line.startsWith("|")) {
      break;
    }
  }

  lines.splice(insertIdx, 0, newRow);
  return lines.join("\n");
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
): { body: string; updated: boolean } {
  const lines = body.split("\n");
  const historyLineIdx = lines.findIndex((l) => l.includes(HISTORY_SECTION));

  if (historyLineIdx === -1) {
    return { body, updated: false };
  }

  // Find all table rows after history section
  const tableRows: { idx: number; line: string }[] = [];
  for (let i = historyLineIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    if (
      line.startsWith("|") &&
      !line.startsWith("|---") &&
      !line.startsWith("| #")
    ) {
      tableRows.push({ idx: i, line });
    } else if (line.trim() !== "" && !line.startsWith("|")) {
      break;
    }
  }

  // Search from most recent to oldest for a matching row
  for (let i = tableRows.length - 1; i >= 0; i--) {
    const row = tableRows[i];
    if (!row) continue;

    // Parse the row - support both old and new formats
    const cells = row.line.split("|").map((c) => c.trim());
    const hasTimestampColumn = cells.length >= 7;

    const rowIteration = cells[1] || "";
    const rowPhase = cells[2] || "";
    const rowMessage = cells[3] || "";

    let existingTime: string;
    let existingSha: string;
    let existingRun: string;

    if (hasTimestampColumn) {
      existingTime = cells[4] || "-";
      existingSha = cells[5] || "-";
      existingRun = cells[6] || "-";
    } else {
      existingTime = "-";
      existingSha = cells[4] || "-";
      existingRun = cells[5] || "-";
    }

    // Check if this row matches our criteria
    if (
      rowIteration === String(matchIteration) &&
      rowPhase === String(matchPhase) &&
      rowMessage.includes(matchPattern)
    ) {
      // Update this row
      const timeCell = timestamp ? formatTimestamp(timestamp) : existingTime;
      const { shaCell, runCell } = formatHistoryCells(sha, runLink, repoUrl);

      // Preserve existing values if not provided
      const finalTimeCell = timestamp ? timeCell : existingTime;
      const finalShaCell = sha ? shaCell : existingSha;
      const finalRunCell = runLink ? runCell : existingRun;

      const newRow = `| ${rowIteration} | ${rowPhase} | ${newMessage} | ${finalTimeCell} | ${finalShaCell} | ${finalRunCell} |`;
      lines[row.idx] = newRow;

      return { body: lines.join("\n"), updated: true };
    }
  }

  return { body, updated: false };
}

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
