import { describe, it, expect } from "vitest";
import { truncate } from "../src/utils/truncate.js";

describe("truncate", () => {
  it("returns empty string for empty input", () => {
    expect(truncate("", 10)).toBe("");
  });

  it("returns original string when shorter than maxLen", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("returns original string when exactly at maxLen", () => {
    expect(truncate("hello", 5)).toBe("hello");
  });

  it("truncates string when longer than maxLen", () => {
    expect(truncate("hello world", 8)).toBe("hello...");
  });

  it("throws error when maxLen is 0", () => {
    expect(() => truncate("hello", 0)).toThrow("maxLen must be greater than 0");
  });

  it("throws error when maxLen is negative", () => {
    expect(() => truncate("hello", -5)).toThrow(
      "maxLen must be greater than 0",
    );
  });

  it("handles maxLen = 1 (returns single character)", () => {
    expect(truncate("hello", 1)).toBe("h");
  });

  it("handles maxLen = 2 (returns two characters)", () => {
    expect(truncate("hello", 2)).toBe("he");
  });

  it("handles maxLen = 3 (not enough room for ellipsis)", () => {
    expect(truncate("hello", 3)).toBe("hel");
  });

  it("adds ellipsis when maxLen >= 4 and truncation needed", () => {
    expect(truncate("hello world", 7)).toBe("hell...");
  });

  it("handles strings with unicode characters", () => {
    // Note: truncate works with UTF-16 code units, not grapheme clusters
    // The emoji 😀 takes 2 code units, so "hello 😀 world" is 14 code units
    // Truncating to 11 gives us "hello 😀" (8 code units) + "..." = 11
    expect(truncate("hello 😀 world", 11)).toBe("hello 😀...");
  });

  it("handles very long strings", () => {
    const longString = "a".repeat(1000);
    const result = truncate(longString, 50);
    expect(result).toBe("a".repeat(47) + "...");
    expect(result.length).toBe(50);
  });
});
