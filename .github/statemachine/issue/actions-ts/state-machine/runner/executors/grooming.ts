import * as core from "@actions/core";
import * as fs from "fs";
import type {
  RunClaudeGroomingAction,
  ApplyGroomingOutputAction,
  GroomingAgentType,
} from "../../schemas/index.js";
import type { RunnerContext } from "../runner.js";
import { executeRunClaude } from "./claude.js";
import { executeUpdateHistory, executeRemoveLabel } from "./github.js";
import { executeAppendAgentNotes } from "./agent-notes.js";
import {
  upsertSections,
  STANDARD_SECTION_ORDER,
} from "../../parser/section-parser.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Output from a single grooming agent
 */
interface GroomingAgentOutput {
  ready: boolean;
  questions?: string[];
  [key: string]: unknown;
}

/**
 * Todo item for a phase
 */
interface PhaseTodo {
  task: string;
  manual: boolean;
}

/**
 * Affected area in a phase
 */
interface PhaseAffectedArea {
  path: string;
  change_type: "create" | "modify" | "delete";
  description: string;
}

/**
 * Phase definition from engineer output
 */
interface PhaseDefinition {
  phase_number: number;
  title: string;
  description: string;
  affected_areas?: PhaseAffectedArea[];
  todos: PhaseTodo[];
  depends_on?: number[];
}

/**
 * Engineer agent output with recommended phases
 */
interface EngineerOutput extends GroomingAgentOutput {
  implementation_plan: string;
  affected_areas: PhaseAffectedArea[];
  scope_recommendation: "keep" | "split" | "expand";
  scope_rationale?: string;
  recommended_phases?: PhaseDefinition[];
  technical_risks?: Array<{
    risk: string;
    severity: "low" | "medium" | "high";
    mitigation?: string;
  }>;
}

/**
 * QA agent output with test cases
 */
interface QAOutput extends GroomingAgentOutput {
  test_strategy?: string;
  test_cases?: Array<{
    description: string;
    type: "unit" | "integration" | "e2e";
    phase?: number;
  }>;
}

/**
 * PM agent output with requirements
 */
interface PMOutput extends GroomingAgentOutput {
  requirements?: string[];
  acceptance_criteria?: string[];
}

/**
 * Combined output from all grooming agents
 * Note: The agents may not return all fields, so we use Partial types
 */
interface CombinedGroomingOutput {
  pm: GroomingAgentOutput & Partial<PMOutput>;
  engineer: GroomingAgentOutput & Partial<EngineerOutput>;
  qa: GroomingAgentOutput & Partial<QAOutput>;
  research: GroomingAgentOutput;
}

/**
 * Summary agent decision
 */
interface GroomingSummaryOutput {
  summary: string;
  decision: "ready" | "needs_info" | "blocked";
  decision_rationale: string;
  questions?: Array<{
    question: string;
    source: GroomingAgentType;
    priority: "critical" | "important" | "nice-to-have";
  }>;
  blocker_reason?: string;
  next_steps?: string[];
  agent_notes?: string[];
}

// ============================================================================
// GraphQL Queries for Sub-Issue Creation
// ============================================================================

const GET_REPO_ID_QUERY = `
query GetRepoId($owner: String!, $repo: String!) {
  repository(owner: $owner, name: $repo) {
    id
  }
}
`;

const GET_ISSUE_ID_QUERY = `
query GetIssueId($owner: String!, $repo: String!, $issueNumber: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $issueNumber) {
      id
    }
  }
}
`;

const CREATE_ISSUE_MUTATION = `
mutation CreateIssue($repositoryId: ID!, $title: String!, $body: String!) {
  createIssue(input: { repositoryId: $repositoryId, title: $title, body: $body }) {
    issue {
      id
      number
    }
  }
}
`;

const ADD_SUB_ISSUE_MUTATION = `
mutation AddSubIssue($parentId: ID!, $childId: ID!) {
  addSubIssue(input: { issueId: $parentId, subIssueId: $childId }) {
    issue {
      id
    }
  }
}
`;

const ADD_ISSUE_TO_PROJECT_MUTATION = `
mutation AddIssueToProject($projectId: ID!, $contentId: ID!) {
  addProjectV2ItemById(input: {
    projectId: $projectId
    contentId: $contentId
  }) {
    item {
      id
    }
  }
}
`;

const GET_PROJECT_FIELDS_QUERY = `
query($owner: String!, $projectNumber: Int!) {
  organization(login: $owner) {
    projectV2(number: $projectNumber) {
      id
      fields(first: 30) {
        nodes {
          ... on ProjectV2SingleSelectField {
            id
            name
            options { id name }
          }
        }
      }
    }
  }
}
`;

const UPDATE_PROJECT_FIELD_MUTATION = `
mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: ProjectV2FieldValue!) {
  updateProjectV2ItemFieldValue(input: {
    projectId: $projectId
    itemId: $itemId
    fieldId: $fieldId
    value: $value
  }) {
    projectV2Item { id }
  }
}
`;

interface RepoIdResponse {
  repository?: { id?: string };
}

interface IssueIdResponse {
  repository?: { issue?: { id?: string } };
}

interface CreateIssueResponse {
  createIssue?: { issue?: { id?: string; number?: number } };
}

interface ProjectInfo {
  projectId: string;
  statusFieldId: string;
  statusOptions: Record<string, string>;
}

interface AddToProjectResponse {
  addProjectV2ItemById?: { item?: { id?: string } };
}

// ============================================================================
// Main Executors
// ============================================================================

/**
 * Execute runClaudeGrooming action
 *
 * Runs all 4 grooming agents (PM, Engineer, QA, Research) in parallel,
 * collects their outputs, and writes them to grooming-output.json
 */
export async function executeRunClaudeGrooming(
  action: RunClaudeGroomingAction,
  ctx: RunnerContext,
): Promise<{ outputs: CombinedGroomingOutput }> {
  const { issueNumber, promptVars } = action;

  core.info(`Running grooming agents for issue #${issueNumber}`);

  if (ctx.dryRun) {
    core.info("[DRY RUN] Would run 4 grooming agents in parallel");
    const mockOutput: CombinedGroomingOutput = {
      pm: { ready: true },
      engineer: { ready: true },
      qa: { ready: true },
      research: { ready: true },
    };
    return { outputs: mockOutput };
  }

  // Define the 4 grooming agents
  const agents: GroomingAgentType[] = ["pm", "engineer", "qa", "research"];

  // Run all agents in parallel
  const results = await Promise.all(
    agents.map(async (agent) => {
      core.info(`Starting grooming agent: ${agent}`);
      try {
        const result = await executeRunClaude(
          {
            type: "runClaude",
            token: "code",
            promptDir: `grooming/${agent}`,
            promptsDir: ".github/statemachine/issue/prompts",
            promptVars,
            issueNumber,
            // No worktree specified - runs from current directory (main checkout)
          },
          ctx,
        );
        core.info(`Grooming agent ${agent} completed`);
        return { agent, output: result.structuredOutput as GroomingAgentOutput };
      } catch (error) {
        core.warning(`Grooming agent ${agent} failed: ${error}`);
        // Return a default "not ready" output on failure
        return {
          agent,
          output: {
            ready: false,
            questions: [`Grooming agent ${agent} failed to run`],
          } as GroomingAgentOutput,
        };
      }
    }),
  );

  // Combine outputs
  const outputs: CombinedGroomingOutput = {
    pm: { ready: true },
    engineer: { ready: true },
    qa: { ready: true },
    research: { ready: true },
  };

  for (const { agent, output } of results) {
    outputs[agent] = output || { ready: false };
  }

  // Write combined output to file for artifact
  const outputPath = "grooming-output.json";
  fs.writeFileSync(outputPath, JSON.stringify(outputs, null, 2));
  core.info(`Wrote combined grooming output to ${outputPath}`);

  return { outputs };
}

/**
 * Execute applyGroomingOutput action
 *
 * Runs the summary agent to synthesize all grooming agent outputs,
 * then applies the decision:
 * - ready: add "groomed" label, set status to Ready
 * - needs_info: add "needs-info" label, post questions as comment
 * - blocked: set status to Blocked, post blocker reason as comment
 */
export async function executeApplyGroomingOutput(
  action: ApplyGroomingOutputAction,
  ctx: RunnerContext,
  structuredOutput?: unknown,
): Promise<{ applied: boolean; decision?: string }> {
  const { issueNumber, filePath } = action;

  let groomingOutputs: CombinedGroomingOutput;

  // Try structured output first, then fall back to file
  if (structuredOutput) {
    groomingOutputs = structuredOutput as CombinedGroomingOutput;
    core.info("Using grooming output from in-process chain");
  } else if (filePath && fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      groomingOutputs = JSON.parse(content) as CombinedGroomingOutput;
      core.info(`Grooming output from file: ${filePath}`);
    } catch (error) {
      core.warning(`Failed to parse grooming output: ${error}`);
      return { applied: false };
    }
  } else {
    throw new Error(
      `No structured output provided and grooming output file not found at: ${filePath || "undefined"}`,
    );
  }

  core.startGroup("Grooming Outputs");
  core.info(JSON.stringify(groomingOutputs, null, 2));
  core.endGroup();

  if (ctx.dryRun) {
    core.info(`[DRY RUN] Would apply grooming output to issue #${issueNumber}`);
    return { applied: true, decision: "ready" };
  }

  // Run summary agent to synthesize outputs and make decision
  const summaryPromptVars: Record<string, string> = {
    PM_OUTPUT: JSON.stringify(groomingOutputs.pm, null, 2),
    ENGINEER_OUTPUT: JSON.stringify(groomingOutputs.engineer, null, 2),
    QA_OUTPUT: JSON.stringify(groomingOutputs.qa, null, 2),
    RESEARCH_OUTPUT: JSON.stringify(groomingOutputs.research, null, 2),
  };

  let summaryOutput: GroomingSummaryOutput;
  try {
    const summaryResult = await executeRunClaude(
      {
        type: "runClaude",
        token: "code",
        promptDir: "grooming/summary",
        promptsDir: ".github/statemachine/issue/prompts",
        promptVars: summaryPromptVars,
        issueNumber,
        // No worktree specified - runs from current directory (main checkout)
      },
      ctx,
    );

    // Validate that we got a valid structured output
    if (
      !summaryResult.structuredOutput ||
      typeof (summaryResult.structuredOutput as GroomingSummaryOutput)
        .decision !== "string"
    ) {
      throw new Error(
        "Summary agent did not return valid structured output with decision field",
      );
    }
    summaryOutput = summaryResult.structuredOutput as GroomingSummaryOutput;
  } catch (error) {
    core.error(`Summary agent failed: ${error}`);
    // Default to needs_info on summary failure
    summaryOutput = {
      summary: "Summary agent failed to run",
      decision: "needs_info",
      decision_rationale: `Summary agent error: ${error}`,
      questions: [{ question: "Please retry grooming", source: "pm", priority: "critical" }],
    };
  }

  core.info(`Grooming decision: ${summaryOutput.decision}`);
  core.info(`Rationale: ${summaryOutput.decision_rationale}`);

  // Apply the decision (pass groomingOutputs to create sub-issues on ready)
  await applyGroomingDecision(ctx, issueNumber, summaryOutput, groomingOutputs);

  return { applied: true, decision: summaryOutput.decision };
}

// ============================================================================
// Decision Application
// ============================================================================

/**
 * Get the history message for a grooming decision
 */
function getGroomingHistoryMessage(decision: string): string {
  switch (decision) {
    case "ready":
      return "✅ groomed";
    case "needs_info":
      return "🚧 needs-info";
    case "blocked":
      return "⚠️ blocked";
    default:
      return `❓ ${decision}`;
  }
}

/**
 * Apply the grooming decision to the issue
 */
async function applyGroomingDecision(
  ctx: RunnerContext,
  issueNumber: number,
  summary: GroomingSummaryOutput,
  groomingOutputs?: CombinedGroomingOutput,
): Promise<void> {
  switch (summary.decision) {
    case "ready":
      await applyReadyDecision(ctx, issueNumber, summary, groomingOutputs);
      break;
    case "needs_info":
      await applyNeedsInfoDecision(ctx, issueNumber, summary);
      break;
    case "blocked":
      await applyBlockedDecision(ctx, issueNumber, summary);
      break;
    default:
      core.warning(`Unknown grooming decision: ${summary.decision}`);
  }

  // Update grooming history entry with outcome
  const historyMessage = getGroomingHistoryMessage(summary.decision);
  try {
    await executeUpdateHistory(
      {
        type: "updateHistory",
        token: "code",
        issueNumber,
        matchIteration: 0,
        matchPhase: "groom",
        matchPattern: "⏳ grooming...",
        newMessage: historyMessage,
      },
      ctx,
    );
    core.info(`Updated grooming history entry: ${historyMessage}`);
  } catch (error) {
    core.warning(`Failed to update grooming history entry: ${error}`);
  }

  // Also update the log-run-start entry (phase="-") to redirect to groom
  // This prevents a dangling "⏳ running..." entry
  try {
    await executeUpdateHistory(
      {
        type: "updateHistory",
        token: "code",
        issueNumber,
        matchIteration: 0,
        matchPhase: "-",
        matchPattern: "⏳ running...",
        newMessage: "→ groom",
      },
      ctx,
    );
    core.info("Updated log-run-start entry to redirect to groom");
  } catch (error) {
    // This is expected to fail if there's no matching entry (dry run, etc.)
    core.debug(`No log-run-start entry to update: ${error}`);
  }
}

/**
 * Apply "ready" decision - issue is ready for implementation
 *
 * This function:
 * 1. Updates the main issue body with grooming outputs
 * 2. Creates sub-issues if engineer recommended phases
 * 3. Adds labels and agent notes
 */
async function applyReadyDecision(
  ctx: RunnerContext,
  issueNumber: number,
  summary: GroomingSummaryOutput,
  groomingOutputs?: CombinedGroomingOutput,
): Promise<void> {
  // Remove "needs-info" label if present (can't have both needs-info and groomed)
  try {
    await executeRemoveLabel(
      {
        type: "removeLabel",
        token: "code",
        issueNumber,
        label: "needs-info",
      },
      ctx,
    );
  } catch (error) {
    // Label might not be present, that's fine
    core.debug(`Could not remove needs-info label: ${error}`);
  }

  // Add "groomed" label
  try {
    await ctx.octokit.rest.issues.addLabels({
      owner: ctx.owner,
      repo: ctx.repo,
      issue_number: issueNumber,
      labels: ["groomed"],
    });
    core.info('Added "groomed" label');
  } catch (error) {
    core.warning(`Failed to add groomed label: ${error}`);
  }

  // Update main issue with grooming outputs if available
  if (groomingOutputs) {
    await applyGroomingToIssue(ctx, issueNumber, groomingOutputs);

    // Create sub-issues if engineer recommended phases
    const phases = groomingOutputs.engineer.recommended_phases;
    if (phases && phases.length > 0) {
      const subIssueNumbers = await createSubIssuesFromPlan(
        ctx,
        issueNumber,
        phases,
        groomingOutputs.qa,
      );
      core.info(`Created ${subIssueNumbers.length} sub-issues`);
    }
  }

  // Add grooming summary to Agent Notes
  try {
    const notes = formatReadyNotes(summary);
    const runId = ctx.runUrl?.split("/").pop() || `run-${Date.now()}`;
    const runLink =
      ctx.runUrl ||
      `${ctx.serverUrl}/${ctx.owner}/${ctx.repo}/actions/runs/${runId}`;

    await executeAppendAgentNotes(
      {
        type: "appendAgentNotes",
        token: "code",
        issueNumber,
        notes,
        runId,
        runLink,
        timestamp: new Date().toISOString(),
      },
      ctx,
    );
    core.info("Added grooming summary to Agent Notes");
  } catch (error) {
    core.warning(`Failed to add grooming notes: ${error}`);
  }
}

/**
 * Apply "needs_info" decision - issue needs clarification
 */
async function applyNeedsInfoDecision(
  ctx: RunnerContext,
  issueNumber: number,
  summary: GroomingSummaryOutput,
): Promise<void> {
  // Add "needs-info" label
  try {
    await ctx.octokit.rest.issues.addLabels({
      owner: ctx.owner,
      repo: ctx.repo,
      issue_number: issueNumber,
      labels: ["needs-info"],
    });
    core.info('Added "needs-info" label');
  } catch (error) {
    core.warning(`Failed to add needs-info label: ${error}`);
  }

  // Add questions to Agent Notes
  try {
    const notes = formatNeedsInfoNotes(summary);
    const runId = ctx.runUrl?.split("/").pop() || `run-${Date.now()}`;
    const runLink =
      ctx.runUrl ||
      `${ctx.serverUrl}/${ctx.owner}/${ctx.repo}/actions/runs/${runId}`;

    await executeAppendAgentNotes(
      {
        type: "appendAgentNotes",
        token: "code",
        issueNumber,
        notes,
        runId,
        runLink,
        timestamp: new Date().toISOString(),
      },
      ctx,
    );
    core.info("Added grooming questions to Agent Notes");
  } catch (error) {
    core.warning(`Failed to add grooming notes: ${error}`);
  }
}

/**
 * Apply "blocked" decision - issue cannot proceed
 */
async function applyBlockedDecision(
  ctx: RunnerContext,
  issueNumber: number,
  summary: GroomingSummaryOutput,
): Promise<void> {
  // Add "blocked" label
  try {
    await ctx.octokit.rest.issues.addLabels({
      owner: ctx.owner,
      repo: ctx.repo,
      issue_number: issueNumber,
      labels: ["blocked"],
    });
    core.info('Added "blocked" label');
  } catch (error) {
    core.warning(`Failed to add blocked label: ${error}`);
  }

  // Add blocker reason to Agent Notes
  try {
    const notes = formatBlockedNotes(summary);
    const runId = ctx.runUrl?.split("/").pop() || `run-${Date.now()}`;
    const runLink =
      ctx.runUrl ||
      `${ctx.serverUrl}/${ctx.owner}/${ctx.repo}/actions/runs/${runId}`;

    await executeAppendAgentNotes(
      {
        type: "appendAgentNotes",
        token: "code",
        issueNumber,
        notes,
        runId,
        runLink,
        timestamp: new Date().toISOString(),
      },
      ctx,
    );
    core.info("Added blocker reason to Agent Notes");
  } catch (error) {
    core.warning(`Failed to add grooming notes: ${error}`);
  }
}

// ============================================================================
// Agent Notes Formatting
// ============================================================================

/**
 * Format agent notes for "ready" decision
 */
function formatReadyNotes(summary: GroomingSummaryOutput): string[] {
  const notes: string[] = [
    `**Grooming Complete** - Ready for implementation`,
    summary.summary,
    `Rationale: ${summary.decision_rationale}`,
  ];

  if (summary.next_steps && summary.next_steps.length > 0) {
    notes.push(`Next steps: ${summary.next_steps.join("; ")}`);
  }

  return notes;
}

/**
 * Format agent notes for "needs_info" decision
 */
function formatNeedsInfoNotes(summary: GroomingSummaryOutput): string[] {
  const notes: string[] = [
    `**Grooming: Needs Info** - Questions must be answered before proceeding`,
    summary.summary,
    `Rationale: ${summary.decision_rationale}`,
  ];

  if (summary.questions && summary.questions.length > 0) {
    // Group by priority
    const critical = summary.questions.filter((q) => q.priority === "critical");
    const important = summary.questions.filter((q) => q.priority === "important");
    const niceToHave = summary.questions.filter((q) => q.priority === "nice-to-have");

    if (critical.length > 0) {
      notes.push(`**Critical questions:** ${critical.map((q) => `${q.question} (${q.source})`).join(" | ")}`);
    }
    if (important.length > 0) {
      notes.push(`**Important questions:** ${important.map((q) => `${q.question} (${q.source})`).join(" | ")}`);
    }
    if (niceToHave.length > 0) {
      notes.push(`**Nice-to-have questions:** ${niceToHave.map((q) => `${q.question} (${q.source})`).join(" | ")}`);
    }
  }

  notes.push(`Answer questions in comments, then trigger /lfg to re-run grooming`);

  return notes;
}

/**
 * Format agent notes for "blocked" decision
 */
function formatBlockedNotes(summary: GroomingSummaryOutput): string[] {
  const notes: string[] = [
    `**Grooming: Blocked** - Cannot proceed with this issue`,
    summary.summary,
    `Rationale: ${summary.decision_rationale}`,
  ];

  if (summary.blocker_reason) {
    notes.push(`Blocker: ${summary.blocker_reason}`);
  }

  if (summary.next_steps && summary.next_steps.length > 0) {
    notes.push(`To unblock: ${summary.next_steps.join("; ")}`);
  }

  return notes;
}

// ============================================================================
// Apply Grooming to Issue Body
// ============================================================================

/**
 * Update the main issue body with grooming outputs
 *
 * Updates sections:
 * - Requirements (from PM)
 * - Approach (from Engineer)
 * - Testing (from QA)
 */
async function applyGroomingToIssue(
  ctx: RunnerContext,
  issueNumber: number,
  outputs: CombinedGroomingOutput,
): Promise<void> {
  try {
    // Get current issue body
    const { data: issue } = await ctx.octokit.rest.issues.get({
      owner: ctx.owner,
      repo: ctx.repo,
      issue_number: issueNumber,
    });

    const currentBody = issue.body || "";

    // Build sections to update
    const sections: Array<{ name: string; content: string }> = [];

    // Requirements section (from PM)
    if (outputs.pm.requirements && outputs.pm.requirements.length > 0) {
      const requirementsContent = outputs.pm.requirements
        .map((r) => `- ${r}`)
        .join("\n");
      sections.push({ name: "Requirements", content: requirementsContent });
    }

    // Acceptance Criteria section (from PM)
    if (outputs.pm.acceptance_criteria && outputs.pm.acceptance_criteria.length > 0) {
      const criteriaContent = outputs.pm.acceptance_criteria
        .map((c) => `- [ ] ${c}`)
        .join("\n");
      sections.push({ name: "Acceptance Criteria", content: criteriaContent });
    }

    // Approach section (from Engineer)
    if (outputs.engineer.implementation_plan) {
      let approachContent = outputs.engineer.implementation_plan;

      // Add affected areas if present
      if (outputs.engineer.affected_areas && outputs.engineer.affected_areas.length > 0) {
        approachContent += "\n\n**Affected Areas:**\n";
        approachContent += outputs.engineer.affected_areas
          .map((a) => `- \`${a.path}\` (${a.change_type}) - ${a.description}`)
          .join("\n");
      }

      // Add technical risks if present
      if (outputs.engineer.technical_risks && outputs.engineer.technical_risks.length > 0) {
        approachContent += "\n\n**Technical Risks:**\n";
        approachContent += outputs.engineer.technical_risks
          .map((r) => {
            let risk = `- **${r.severity}**: ${r.risk}`;
            if (r.mitigation) {
              risk += ` (Mitigation: ${r.mitigation})`;
            }
            return risk;
          })
          .join("\n");
      }

      sections.push({ name: "Approach", content: approachContent });
    }

    // Testing section (from QA)
    if (outputs.qa.test_strategy || (outputs.qa.test_cases && outputs.qa.test_cases.length > 0)) {
      let testingContent = "";

      if (outputs.qa.test_strategy) {
        testingContent = outputs.qa.test_strategy + "\n\n";
      }

      if (outputs.qa.test_cases && outputs.qa.test_cases.length > 0) {
        testingContent += "**Test Cases:**\n";
        testingContent += outputs.qa.test_cases
          .map((t) => `- [ ] [${t.type}] ${t.description}`)
          .join("\n");
      }

      sections.push({ name: "Testing", content: testingContent.trim() });
    }

    // Update the issue body with new sections
    if (sections.length > 0) {
      const newBody = upsertSections(currentBody, sections, STANDARD_SECTION_ORDER);

      await ctx.octokit.rest.issues.update({
        owner: ctx.owner,
        repo: ctx.repo,
        issue_number: issueNumber,
        body: newBody,
      });

      core.info(`Updated issue #${issueNumber} with grooming sections`);
    }
  } catch (error) {
    core.warning(`Failed to apply grooming to issue: ${error}`);
  }
}

// ============================================================================
// Sub-Issue Creation from Grooming Plan
// ============================================================================

/**
 * Create sub-issues from the engineer's recommended phases
 */
async function createSubIssuesFromPlan(
  ctx: RunnerContext,
  parentIssueNumber: number,
  phases: PhaseDefinition[],
  qaOutput: QAOutput,
): Promise<number[]> {
  if (phases.length === 0) {
    core.info("No phases recommended, skipping sub-issue creation");
    return [];
  }

  // Get repository ID
  const repoResponse = await ctx.octokit.graphql<RepoIdResponse>(
    GET_REPO_ID_QUERY,
    {
      owner: ctx.owner,
      repo: ctx.repo,
    },
  );

  const repoId = repoResponse.repository?.id;
  if (!repoId) {
    throw new Error("Repository not found");
  }

  // Get parent issue ID
  const parentResponse = await ctx.octokit.graphql<IssueIdResponse>(
    GET_ISSUE_ID_QUERY,
    {
      owner: ctx.owner,
      repo: ctx.repo,
      issueNumber: parentIssueNumber,
    },
  );

  const parentId = parentResponse.repository?.issue?.id;
  if (!parentId) {
    throw new Error(`Parent issue #${parentIssueNumber} not found`);
  }

  // Get project info for adding sub-issues to project
  const projectInfo = await getProjectInfo(ctx);

  const subIssueNumbers: number[] = [];

  for (const phase of phases) {
    // Format title with phase number
    const formattedTitle =
      phases.length > 1
        ? `[Phase ${phase.phase_number}] ${phase.title}`
        : phase.title;

    // Build the sub-issue body
    const body = formatSubIssueBody(phase, qaOutput, parentIssueNumber);

    // Create the sub-issue
    const createResponse = await ctx.octokit.graphql<CreateIssueResponse>(
      CREATE_ISSUE_MUTATION,
      {
        repositoryId: repoId,
        title: formattedTitle,
        body,
      },
    );

    const issueId = createResponse.createIssue?.issue?.id;
    const issueNumber = createResponse.createIssue?.issue?.number;

    if (!issueId || !issueNumber) {
      throw new Error(`Failed to create sub-issue for phase ${phase.phase_number}`);
    }

    // Link as sub-issue
    await ctx.octokit.graphql(ADD_SUB_ISSUE_MUTATION, {
      parentId,
      childId: issueId,
    });

    // Add labels to sub-issue (triaged + groomed since it came from grooming)
    await ctx.octokit.rest.issues.addLabels({
      owner: ctx.owner,
      repo: ctx.repo,
      issue_number: issueNumber,
      labels: ["triaged", "groomed"],
    });

    // Add to project with "Ready" status
    if (projectInfo) {
      await addToProjectWithStatus(ctx, issueId, projectInfo, "Ready");
    }

    subIssueNumbers.push(issueNumber);
    core.info(`Created sub-issue #${issueNumber}: ${formattedTitle}`);
  }

  return subIssueNumbers;
}

/**
 * Format the body for a sub-issue
 */
function formatSubIssueBody(
  phase: PhaseDefinition,
  qaOutput: QAOutput,
  parentIssueNumber: number,
): string {
  let body = `## Description\n\n${phase.description}\n`;

  // Affected areas
  if (phase.affected_areas && phase.affected_areas.length > 0) {
    body += `\n## Affected Areas\n\n`;
    body += phase.affected_areas
      .map((a) => `- \`${a.path}\` (${a.change_type}) - ${a.description}`)
      .join("\n");
    body += "\n";
  }

  // Todos
  if (phase.todos && phase.todos.length > 0) {
    body += `\n## Todo\n\n`;
    body += phase.todos
      .map((todo) => {
        const prefix = todo.manual ? "[Manual] " : "";
        return `- [ ] ${prefix}${todo.task}`;
      })
      .join("\n");
    body += "\n";
  }

  // Test cases for this phase
  const phaseTests = qaOutput.test_cases?.filter(
    (t) => t.phase === phase.phase_number || !t.phase,
  );
  if (phaseTests && phaseTests.length > 0) {
    body += `\n## Testing\n\n`;
    body += phaseTests
      .map((t) => `- [ ] [${t.type}] ${t.description}`)
      .join("\n");
    body += "\n";
  }

  // Dependencies
  if (phase.depends_on && phase.depends_on.length > 0) {
    body += `\n## Dependencies\n\n`;
    body += `Depends on phases: ${phase.depends_on.join(", ")}\n`;
  }

  body += `\n---\n\nParent: #${parentIssueNumber}`;

  return body;
}

/**
 * Get project info for adding sub-issues to project
 */
async function getProjectInfo(ctx: RunnerContext): Promise<ProjectInfo | null> {
  try {
    const result = await ctx.octokit.graphql<{
      organization: {
        projectV2: {
          id: string;
          fields: {
            nodes: Array<{
              id: string;
              name: string;
              options?: Array<{ id: string; name: string }>;
            }>;
          };
        };
      };
    }>(GET_PROJECT_FIELDS_QUERY, {
      owner: ctx.owner,
      projectNumber: ctx.projectNumber,
    });

    const project = result.organization.projectV2;
    const fields = project.fields.nodes;

    const projectInfo: ProjectInfo = {
      projectId: project.id,
      statusFieldId: "",
      statusOptions: {},
    };

    for (const field of fields) {
      if (field.name === "Status" && field.options) {
        projectInfo.statusFieldId = field.id;
        for (const option of field.options) {
          projectInfo.statusOptions[option.name] = option.id;
        }
      }
    }

    return projectInfo;
  } catch (error) {
    core.warning(`Failed to get project info: ${error}`);
    return null;
  }
}

/**
 * Add an issue to the project with a specific status
 */
async function addToProjectWithStatus(
  ctx: RunnerContext,
  issueNodeId: string,
  projectInfo: ProjectInfo,
  status: string,
): Promise<void> {
  try {
    // Add to project
    const addResult = await ctx.octokit.graphql<AddToProjectResponse>(
      ADD_ISSUE_TO_PROJECT_MUTATION,
      {
        projectId: projectInfo.projectId,
        contentId: issueNodeId,
      },
    );

    const itemId = addResult.addProjectV2ItemById?.item?.id;
    if (!itemId) {
      core.warning("Failed to add issue to project");
      return;
    }

    // Set status
    const statusOptionId = projectInfo.statusOptions[status];
    if (statusOptionId && projectInfo.statusFieldId) {
      await ctx.octokit.graphql(UPDATE_PROJECT_FIELD_MUTATION, {
        projectId: projectInfo.projectId,
        itemId,
        fieldId: projectInfo.statusFieldId,
        value: { singleSelectOptionId: statusOptionId },
      });
      core.info(`Set project status to ${status}`);
    }
  } catch (error) {
    core.warning(`Failed to add issue to project with status: ${error}`);
  }
}
