import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Test utility function to validate test scenario data
 * Returns true if the provided value is a valid test identifier
 */
export function isValidTestId(testId: unknown): testId is string {
  return (
    typeof testId === "string" &&
    testId.length > 0 &&
    /^[a-zA-Z0-9-_]+$/.test(testId)
  );
}
