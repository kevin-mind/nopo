/**
 * Truncates a string to a maximum length, adding ellipsis if truncated.
 *
 * @param str - The string to truncate
 * @param maxLen - Maximum length of the resulting string (must be > 0)
 * @returns The truncated string with "..." appended if truncation occurred
 * @throws Error if maxLen is <= 0
 *
 * @example
 * truncate("hello world", 8) // Returns "hello..."
 * truncate("hello", 10)      // Returns "hello"
 * truncate("hi", 3)          // Returns "hi"
 */
export function truncate(str: string, maxLen: number): string {
  if (maxLen <= 0) {
    throw new Error("maxLen must be greater than 0");
  }

  // If string is already within limit, return as-is
  if (str.length <= maxLen) {
    return str;
  }

  // For very short maxLen values (1-3), just return the substring
  // There's not enough room for meaningful ellipsis
  if (maxLen <= 3) {
    return str.substring(0, maxLen);
  }

  // For maxLen >= 4, we can add ellipsis
  // Subtract 3 for the "..." and take that many characters
  return str.substring(0, maxLen - 3) + "...";
}
