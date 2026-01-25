/**
 * Fixture validation utilities
 *
 * Validates test fixtures against expected schema and checks for common issues
 */

import { z } from "zod";

/**
 * Schema for project fields
 */
const ProjectFieldsSchema = z
  .object({
    Status: z.string().optional(),
    Iteration: z.number().int().min(0).optional(),
    Failures: z.number().int().min(0).optional(),
  })
  .strict();

/**
 * Schema for parent issue configuration
 */
const ParentIssueSchema = z
  .object({
    title: z.string().min(1, "Parent issue title is required"),
    body: z.string().min(1, "Parent issue body is required"),
    labels: z.array(z.string()).optional(),
    project_fields: ProjectFieldsSchema.optional(),
  })
  .strict();

/**
 * Schema for sub-issue configuration
 */
const SubIssueSchema = z
  .object({
    title: z.string().min(1, "Sub-issue title is required"),
    body: z.string().min(1, "Sub-issue body is required"),
    project_fields: z
      .object({
        Status: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

/**
 * Schema for branch configuration
 */
const BranchSchema = z
  .object({
    name: z.string().min(1, "Branch name is required"),
    from: z.string().min(1, "Base branch is required"),
    commits: z
      .array(
        z
          .object({
            message: z.string().min(1, "Commit message is required"),
            files: z.record(z.string()),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

/**
 * Schema for PR configuration
 */
const PRSchema = z
  .object({
    title: z.string().min(1, "PR title is required"),
    body: z.string().min(1, "PR body is required"),
    draft: z.boolean().optional(),
    request_review: z.boolean().optional(),
  })
  .strict();

/**
 * Schema for comment configuration
 */
const CommentSchema = z
  .object({
    body: z.string().min(1, "Comment body is required"),
  })
  .strict();

/**
 * Schema for review configuration
 */
const ReviewSchema = z
  .object({
    state: z.enum(["approve", "request_changes", "comment"]),
    body: z.string().min(1, "Review body is required"),
    reviewer: z.string().optional(),
  })
  .strict();

/**
 * Schema for discussion configuration
 */
const DiscussionSchema = z
  .object({
    title: z.string().min(1, "Discussion title is required"),
    body: z.string().min(1, "Discussion body is required"),
    category: z.string().optional(),
  })
  .strict();

/**
 * Valid project status values
 */
const ProjectStatusValues = [
  "Backlog",
  "In progress",
  "Ready",
  "In review",
  "Done",
  "Blocked",
  "Error",
] as const;

/**
 * Schema for triage verification expectations
 */
const TriageExpectationSchema = z
  .object({
    labels: z.array(z.string()).optional(),
    project_fields: z
      .object({
        Priority: z.string().optional(),
        Size: z.string().optional(),
        Estimate: z.number().optional(),
        Status: z.string().optional(),
      })
      .optional(),
    sub_issue_count: z.number().int().min(0).optional(),
  })
  .strict();

/**
 * Schema for phase verification expectations
 */
const PhaseExpectationSchema = z
  .object({
    branch_pattern: z.string().optional(),
    pr_title_contains: z.string().optional(),
    ci_required: z.boolean().optional(),
    review_required: z.boolean().optional(),
    deploy_required: z.boolean().optional(),
  })
  .strict();

/**
 * Schema for completion verification expectations
 */
const CompletionExpectationSchema = z
  .object({
    parent_status: z.string().optional(),
    all_sub_issues_closed: z.boolean().optional(),
    all_prs_merged: z.boolean().optional(),
  })
  .strict();

/**
 * Schema for expected outcomes
 */
const ExpectedSchema = z
  .object({
    parent_status: z.enum(ProjectStatusValues).optional(),
    sub_issue_statuses: z.array(z.enum(ProjectStatusValues)).optional(),
    issue_state: z.enum(["open", "closed"]).optional(),
    pr_state: z.enum(["open", "closed", "merged", "draft"]).optional(),
    labels: z.array(z.string()).optional(),
    min_iteration: z.number().int().min(0).optional(),
    failures: z.number().int().min(0).optional(),
    min_comments: z.number().int().min(0).optional(),
    all_sub_issues_closed: z.boolean().optional(),
    sub_issues_todos_done: z.boolean().optional(),
    history_contains: z.array(z.string()).optional(),
    sub_issues_have_merged_pr: z.boolean().optional(),
    // New E2E per-phase verification fields
    triage: TriageExpectationSchema.optional(),
    phases: z.array(PhaseExpectationSchema).optional(),
    completion: CompletionExpectationSchema.optional(),
  })
  .strict();

/**
 * Schema for expected machine state (dry-run mode)
 */
const ExpectedMachineSchema = z
  .object({
    final_state: z.string().optional(),
    contains_actions: z.array(z.string()).optional(),
    action_count: z.number().int().min(0).optional(),
    stopped_early: z.union([z.boolean(), z.string()]).optional(),
    stop_reason: z.string().optional(),
  })
  .strict();

/**
 * Full fixture schema
 */
const FixtureSchema = z
  .object({
    name: z.string().min(1, "Fixture name is required"),
    description: z.string().min(1, "Fixture description is required"),
    job_type: z.string().optional(),
    trigger: z.string().optional(),
    trigger_context: z
      .object({
        ci_result: z.string().optional(),
        review_decision: z.string().optional(),
        reviewer: z.string().optional(),
      })
      .optional(),
    parent_issue: ParentIssueSchema.optional(),
    sub_issues: z.array(SubIssueSchema).optional(),
    branch: BranchSchema.optional(),
    pr: PRSchema.optional(),
    comment: CommentSchema.optional(),
    review: ReviewSchema.optional(),
    discussion: DiscussionSchema.optional(),
    expected: ExpectedSchema.optional(),
    expected_machine: ExpectedMachineSchema.optional(),
    timeout: z.number().int().positive().optional(),
    poll_interval: z.number().int().positive().optional(),
  })
  .refine(
    (data) => data.parent_issue || data.discussion,
    "Fixture must have either parent_issue or discussion",
  );

type ValidatedFixture = z.infer<typeof FixtureSchema>;

/**
 * Validation error with details
 */
interface ValidationError {
  path: string;
  message: string;
  code: string;
}

/**
 * Validation result
 */
interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: string[];
  fixture: ValidatedFixture | null;
}

/**
 * Check for common issues in fixtures
 */
function checkForWarnings(fixture: ValidatedFixture): string[] {
  const warnings: string[] = [];

  // Check if fixture has expected outcomes
  if (!fixture.expected && !fixture.expected_machine) {
    warnings.push("Fixture has no expected outcomes defined");
  }

  // Check for placeholder patterns that might be forgotten
  if (fixture.parent_issue?.body.includes("{TODO}")) {
    warnings.push("Parent issue body contains {TODO} placeholder");
  }

  // Check for very short timeouts
  if (fixture.timeout && fixture.timeout < 60) {
    warnings.push(`Timeout of ${fixture.timeout}s is very short`);
  }

  // Check for inconsistent sub-issue statuses
  if (fixture.sub_issues && fixture.expected?.sub_issue_statuses) {
    if (
      fixture.sub_issues.length !== fixture.expected.sub_issue_statuses.length
    ) {
      warnings.push(
        `Number of sub_issues (${fixture.sub_issues.length}) doesn't match expected statuses (${fixture.expected.sub_issue_statuses.length})`,
      );
    }
  }

  // Check for unreachable expectations
  if (fixture.expected?.all_sub_issues_closed && !fixture.sub_issues) {
    warnings.push(
      "all_sub_issues_closed expected but no sub_issues defined - triage may create them",
    );
  }

  // Check for missing triaged label when sub-issues are predefined
  if (
    fixture.sub_issues &&
    fixture.parent_issue?.labels &&
    !fixture.parent_issue.labels.includes("triaged")
  ) {
    warnings.push(
      "Sub-issues are predefined but parent_issue is missing 'triaged' label - triage may create duplicate sub-issues",
    );
  }

  // Check PR expectations without branch/PR config
  if (fixture.expected?.pr_state && !fixture.branch && !fixture.pr) {
    warnings.push(
      "PR state expected but no branch or pr config defined - PR will be created during iteration",
    );
  }

  return warnings;
}

/**
 * Validate a fixture against the schema
 */
export function validateFixture(fixture: unknown): ValidationResult {
  const result = FixtureSchema.safeParse(fixture);

  if (!result.success) {
    const errors: ValidationError[] = result.error.errors.map((err) => ({
      path: err.path.join("."),
      message: err.message,
      code: err.code,
    }));

    return {
      valid: false,
      errors,
      warnings: [],
      fixture: null,
    };
  }

  const warnings = checkForWarnings(result.data);

  return {
    valid: true,
    errors: [],
    warnings,
    fixture: result.data,
  };
}

/**
 * Validate multiple fixtures and return combined results
 */
export function validateFixtures(
  fixtures: Record<string, unknown>,
): Record<string, ValidationResult> {
  const results: Record<string, ValidationResult> = {};

  for (const [name, fixture] of Object.entries(fixtures)) {
    results[name] = validateFixture(fixture);
  }

  return results;
}

/**
 * Format validation result for logging
 */
export function formatValidationResult(
  name: string,
  result: ValidationResult,
): string {
  const lines: string[] = [`Fixture: ${name}`];

  if (result.valid) {
    lines.push("  Status: ✅ Valid");
  } else {
    lines.push("  Status: ❌ Invalid");
    lines.push("  Errors:");
    for (const error of result.errors) {
      lines.push(`    - ${error.path}: ${error.message}`);
    }
  }

  if (result.warnings.length > 0) {
    lines.push("  Warnings:");
    for (const warning of result.warnings) {
      lines.push(`    - ${warning}`);
    }
  }

  return lines.join("\n");
}
