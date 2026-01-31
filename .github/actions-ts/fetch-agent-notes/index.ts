import * as core from "@actions/core";
import * as github from "@actions/github";
import { getRequiredInput, setOutputs } from "../lib/index.js";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

/**
 * Agent notes structure from artifacts
 */
interface AgentNotes {
  issue_number: number;
  run_id: number;
  timestamp: string;
  agent: string;
  phase: number;
  notes: string[];
}

/**
 * Artifact metadata from GitHub API
 */
interface Artifact {
  id: number;
  name: string;
  created_at: string | null;
  workflow_run?: {
    id?: number;
  } | null;
}

/**
 * Format timestamp for display
 */
function formatTimestamp(isoTimestamp: string): string {
  try {
    const date = new Date(isoTimestamp);
    if (isNaN(date.getTime())) return isoTimestamp;

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
    return isoTimestamp;
  }
}

/**
 * Download artifact using gh CLI (more reliable for binary content)
 */
async function downloadArtifact(
  owner: string,
  repo: string,
  artifactId: number,
): Promise<AgentNotes | null> {
  const tempDir = `/tmp/artifact-${artifactId}`;

  try {
    // Create temp directory
    fs.mkdirSync(tempDir, { recursive: true });

    // Download using gh CLI
    execSync(
      `gh api repos/${owner}/${repo}/actions/artifacts/${artifactId}/zip > ${tempDir}/artifact.zip`,
      { encoding: "utf-8" },
    );

    // Extract zip
    execSync(`unzip -o ${tempDir}/artifact.zip -d ${tempDir}`, {
      encoding: "utf-8",
    });

    // Find and read the notes file
    const files = fs.readdirSync(tempDir);
    const notesFile = files.find(
      (f) => f.endsWith(".json") && f !== "artifact.zip",
    );

    if (!notesFile) {
      core.warning(`No JSON file found in artifact ${artifactId}`);
      return null;
    }

    const content = fs.readFileSync(path.join(tempDir, notesFile), "utf-8");
    const parsed = JSON.parse(content) as AgentNotes;

    // Validate required fields
    if (!parsed.notes || !Array.isArray(parsed.notes)) {
      core.warning(`Invalid notes format in artifact ${artifactId}`);
      return null;
    }

    return parsed;
  } catch (error) {
    core.warning(`Failed to download artifact ${artifactId}: ${error}`);
    return null;
  } finally {
    // Cleanup
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Format notes for prompt injection
 */
function formatNotesForPrompt(allNotes: AgentNotes[]): string {
  if (allNotes.length === 0) {
    return "No previous agent notes found for this issue.";
  }

  const sections: string[] = [];

  for (const notes of allNotes) {
    const timestamp = formatTimestamp(notes.timestamp);
    const header = `### Run ${notes.run_id} (${timestamp}, ${notes.agent || "unknown"}, Phase ${notes.phase || "?"})`;

    const bullets = notes.notes
      .slice(0, 5) // Limit to 5 notes per run
      .map((note) => {
        // Truncate long notes
        const truncated = note.length > 200 ? note.slice(0, 200) + "..." : note;
        return `- ${truncated}`;
      })
      .join("\n");

    sections.push(`${header}\n${bullets}`);
  }

  return sections.join("\n\n");
}

async function run(): Promise<void> {
  try {
    const token = getRequiredInput("github_token");
    const issueNumber = getRequiredInput("issue_number");
    const maxNotes = parseInt(core.getInput("max_notes") || "3", 10);

    const octokit = github.getOctokit(token);
    const { context } = github;
    const owner = context.repo.owner;
    const repo = context.repo.repo;

    // Set GH_TOKEN for CLI commands
    process.env.GH_TOKEN = token;

    core.info(`Fetching agent notes for issue #${issueNumber}`);

    // Query artifacts API for matching pattern
    // Note: GitHub API doesn't support prefix filtering directly,
    // so we fetch recent artifacts and filter client-side
    const artifactPrefix = `claude-notes-issue-${issueNumber}-`;

    const allArtifacts: Artifact[] = [];
    let page = 1;
    const perPage = 100;

    // Fetch artifacts (paginate until we have enough matching ones or reach the end)
    while (allArtifacts.length < maxNotes * 3) {
      // Fetch extra to account for filtering
      const response = await octokit.rest.actions.listArtifactsForRepo({
        owner,
        repo,
        per_page: perPage,
        page,
      });

      if (response.data.artifacts.length === 0) {
        break;
      }

      const matching = response.data.artifacts.filter((a) =>
        a.name.startsWith(artifactPrefix),
      );
      allArtifacts.push(...matching);

      // If no matching artifacts in this page and we're past page 1, stop
      if (
        matching.length === 0 &&
        page > 1 &&
        response.data.artifacts.length < perPage
      ) {
        break;
      }

      page++;

      // Safety limit - don't scan more than 10 pages
      if (page > 10) {
        break;
      }
    }

    // Sort by created_at descending (most recent first)
    allArtifacts.sort((a, b) => {
      const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
      return dateB - dateA;
    });

    // Take only the requested number
    const recentArtifacts = allArtifacts.slice(0, maxNotes);

    core.info(
      `Found ${allArtifacts.length} matching artifacts, fetching ${recentArtifacts.length}`,
    );

    if (recentArtifacts.length === 0) {
      setOutputs({
        notes: "No previous agent notes found for this issue.",
        notes_count: "0",
      });
      return;
    }

    // Download and parse each artifact
    const allNotes: AgentNotes[] = [];

    for (const artifact of recentArtifacts) {
      const notes = await downloadArtifact(owner, repo, artifact.id);
      if (notes) {
        allNotes.push(notes);
      }
    }

    core.info(`Successfully parsed ${allNotes.length} note artifacts`);

    // Format for prompt
    const formattedNotes = formatNotesForPrompt(allNotes);

    // Count total notes
    const totalNotes = allNotes.reduce((sum, n) => sum + n.notes.length, 0);

    setOutputs({
      notes: formattedNotes,
      notes_count: String(totalNotes),
    });

    core.info(`Returning ${totalNotes} notes from ${allNotes.length} runs`);
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed("An unexpected error occurred");
    }
  }
}

run();
