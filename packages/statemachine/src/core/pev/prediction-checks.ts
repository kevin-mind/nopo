import { isDeepStrictEqual } from "node:util";
import type {
  PredictionCheck,
  PredictionCheckDiff,
  PredictionCheckResult,
} from "./types.js";

function resolvePath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  const normalized = path.replace(/\[(\w+)\]/g, ".$1").replace(/^\./, "");
  const segments = normalized.split(".");
  let current: unknown = obj;

  for (const segment of segments) {
    if (current == null || typeof current !== "object") {
      return undefined;
    }
    current = Reflect.get(current, segment);
  }

  return current;
}

function valueFromSource(
  check: PredictionCheck,
  oldCtx: unknown,
  newCtx: unknown,
): unknown {
  if (!("field" in check)) return undefined;
  const source = check.from ?? "new";
  const target = source === "old" ? oldCtx : newCtx;
  return resolvePath(target, check.field);
}

function asDiff(
  comparator: PredictionCheck["comparator"],
  field: string,
  expected: unknown,
  actual: unknown,
  description?: string,
): PredictionCheckDiff {
  return { comparator, field, expected, actual, description };
}

function evaluateLeaf(
  check: Extract<PredictionCheck, { comparator: string }>,
  oldCtx: unknown,
  newCtx: unknown,
): PredictionCheckResult {
  if (!("field" in check)) {
    return { pass: true, diffs: [] };
  }

  const actual = valueFromSource(check, oldCtx, newCtx);

  switch (check.comparator) {
    case "eq": {
      const pass = isDeepStrictEqual(actual, check.expected);
      return pass
        ? { pass: true, diffs: [] }
        : {
            pass: false,
            diffs: [
              asDiff(
                check.comparator,
                check.field,
                check.expected,
                actual,
                check.description,
              ),
            ],
          };
    }
    case "gte": {
      const pass =
        typeof actual === "number" &&
        typeof check.expected === "number" &&
        actual >= check.expected;
      return pass
        ? { pass: true, diffs: [] }
        : {
            pass: false,
            diffs: [
              asDiff(
                check.comparator,
                check.field,
                check.expected,
                actual,
                check.description,
              ),
            ],
          };
    }
    case "lte": {
      const pass =
        typeof actual === "number" &&
        typeof check.expected === "number" &&
        actual <= check.expected;
      return pass
        ? { pass: true, diffs: [] }
        : {
            pass: false,
            diffs: [
              asDiff(
                check.comparator,
                check.field,
                check.expected,
                actual,
                check.description,
              ),
            ],
          };
    }
    case "subset": {
      const pass =
        Array.isArray(actual) &&
        check.expected.every((value) =>
          actual.some((item) => isDeepStrictEqual(item, value)),
        );
      return pass
        ? { pass: true, diffs: [] }
        : {
            pass: false,
            diffs: [
              asDiff(
                check.comparator,
                check.field,
                check.expected,
                actual,
                check.description,
              ),
            ],
          };
    }
    case "includes": {
      const pass = Array.isArray(actual)
        ? actual.some((item) => isDeepStrictEqual(item, check.expected))
        : typeof actual === "string" && typeof check.expected === "string"
          ? actual.includes(check.expected)
          : false;
      return pass
        ? { pass: true, diffs: [] }
        : {
            pass: false,
            diffs: [
              asDiff(
                check.comparator,
                check.field,
                check.expected,
                actual,
                check.description,
              ),
            ],
          };
    }
    case "exists": {
      const pass = actual !== null && actual !== undefined;
      return pass
        ? { pass: true, diffs: [] }
        : {
            pass: false,
            diffs: [
              asDiff(
                check.comparator,
                check.field,
                "exists",
                actual,
                check.description,
              ),
            ],
          };
    }
    case "startsWith": {
      const pass =
        typeof actual === "string" &&
        typeof check.expected === "string" &&
        actual.startsWith(check.expected);
      return pass
        ? { pass: true, diffs: [] }
        : {
            pass: false,
            diffs: [
              asDiff(
                check.comparator,
                check.field,
                check.expected,
                actual,
                check.description,
              ),
            ],
          };
    }
    default:
      return { pass: true, diffs: [] };
  }
}

function evaluateSingleCheck(
  check: PredictionCheck,
  oldCtx: unknown,
  newCtx: unknown,
): PredictionCheckResult {
  if (check.comparator === "all") {
    const results = check.checks.map((child) =>
      evaluateSingleCheck(child, oldCtx, newCtx),
    );
    const diffs = results.flatMap((result) => result.diffs);
    return { pass: results.every((result) => result.pass), diffs };
  }

  if (check.comparator === "any") {
    const results = check.checks.map((child) =>
      evaluateSingleCheck(child, oldCtx, newCtx),
    );
    const pass = results.some((result) => result.pass);
    return {
      pass,
      diffs: pass ? [] : results.flatMap((result) => result.diffs),
    };
  }

  return evaluateLeaf(check, oldCtx, newCtx);
}

export function evaluatePredictionChecks(
  checks: PredictionCheck[] | undefined,
  oldCtx: unknown,
  newCtx: unknown,
): PredictionCheckResult {
  if (!checks || checks.length === 0) {
    return { pass: true, diffs: [] };
  }

  const results = checks.map((check) =>
    evaluateSingleCheck(check, oldCtx, newCtx),
  );
  return {
    pass: results.every((result) => result.pass),
    diffs: results.flatMap((result) => result.diffs),
  };
}
