/**
 * Generic verification types.
 *
 * Shared by any machine's verification infrastructure.
 */

export interface FieldDiff {
  path: string;
  expected: unknown;
  actual: unknown;
  comparison: "exact" | "superset" | "gte" | "lte" | "history_entry";
}

export interface VerifyResult {
  pass: boolean;
  matchedOutcomeIndex: number | null;
  bestMatch: { outcomeIndex: number; diffs: FieldDiff[] };
}

export interface VerificationResult {
  pass: boolean;
  result: VerifyResult;
  retriggerPass: boolean;
}
