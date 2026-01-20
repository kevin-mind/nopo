import { describe, expect, it } from "vitest";
import { capitalize, cn } from "../src/lib/utils";

describe("capitalize", () => {
  it("capitalizes the first letter of a string", () => {
    expect(capitalize("hello")).toBe("Hello");
  });

  it("returns empty string for empty input", () => {
    expect(capitalize("")).toBe("");
  });

  it("handles already capitalized strings", () => {
    expect(capitalize("Hello")).toBe("Hello");
  });

  it("handles single character strings", () => {
    expect(capitalize("a")).toBe("A");
  });

  it("preserves the rest of the string", () => {
    expect(capitalize("hELLO wORLD")).toBe("HELLO wORLD");
  });
});

describe("cn", () => {
  it("merges class names", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("handles conditional classes", () => {
    const showBar = false;
    expect(cn("foo", showBar && "bar", "baz")).toBe("foo baz");
  });
});
