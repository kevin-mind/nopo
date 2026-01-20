import { describe, expect, it } from "vitest";
import { slugify } from "../src/lib/feature";

describe("slugify", () => {
  it("should convert a simple string to lowercase", () => {
    expect(slugify("Hello")).toBe("hello");
  });

  it("should replace spaces with hyphens", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("should handle multiple spaces", () => {
    expect(slugify("Multiple   Spaces")).toBe("multiple-spaces");
  });

  it("should trim leading and trailing whitespace", () => {
    expect(slugify("  trimmed  ")).toBe("trimmed");
  });

  it("should remove special characters", () => {
    expect(slugify("Special @#$ Characters!")).toBe("special-characters");
  });

  it("should handle mixed case with spaces and special chars", () => {
    expect(slugify("Hello, World! How Are You?")).toBe(
      "hello-world-how-are-you",
    );
  });

  it("should collapse multiple hyphens", () => {
    expect(slugify("Multiple---Hyphens")).toBe("multiple-hyphens");
  });

  it("should handle an empty string", () => {
    expect(slugify("")).toBe("");
  });

  it("should handle a string with only special characters", () => {
    expect(slugify("@#$%^&*()")).toBe("");
  });

  it("should preserve numbers", () => {
    expect(slugify("Version 2.0 Release")).toBe("version-20-release");
  });

  it("should handle underscores", () => {
    expect(slugify("snake_case_text")).toBe("snake_case_text");
  });
});
