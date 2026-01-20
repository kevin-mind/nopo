import { describe, expect, it } from "vitest";
import { capitalize, truncate } from "../src/lib/feature";

describe("capitalize", () => {
  it("should capitalize the first letter of a lowercase string", () => {
    expect(capitalize("hello")).toBe("Hello");
  });

  it("should lowercase the rest of the string", () => {
    expect(capitalize("HELLO")).toBe("Hello");
  });

  it("should handle mixed case strings", () => {
    expect(capitalize("hELLO")).toBe("Hello");
  });

  it("should return empty string for empty input", () => {
    expect(capitalize("")).toBe("");
  });

  it("should handle single character strings", () => {
    expect(capitalize("a")).toBe("A");
    expect(capitalize("A")).toBe("A");
  });
});

describe("truncate", () => {
  it("should not truncate strings shorter than maxLength", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("should not truncate strings equal to maxLength", () => {
    expect(truncate("hello", 5)).toBe("hello");
  });

  it("should truncate strings longer than maxLength and add ellipsis", () => {
    expect(truncate("hello world", 5)).toBe("hello...");
  });

  it("should return empty string for empty input", () => {
    expect(truncate("", 10)).toBe("");
  });

  it("should handle maxLength of 0", () => {
    expect(truncate("hello", 0)).toBe("...");
  });
});
