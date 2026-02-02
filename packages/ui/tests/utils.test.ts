import { describe, expect, it } from "vitest";
import { cn, isValidTestId } from "../src/lib/utils";

describe("utils", () => {
  describe("cn", () => {
    it("should merge class names", () => {
      expect(cn("foo", "bar")).toBe("foo bar");
    });

    it("should handle conditional classes", () => {
      const condition = false;
      expect(cn("foo", condition && "bar", "baz")).toBe("foo baz");
    });
  });

  describe("isValidTestId", () => {
    it("should return true for valid test IDs", () => {
      expect(isValidTestId("test-id")).toBe(true);
      expect(isValidTestId("test_id")).toBe(true);
      expect(isValidTestId("testId123")).toBe(true);
      expect(isValidTestId("123")).toBe(true);
    });

    it("should return false for invalid test IDs", () => {
      expect(isValidTestId("")).toBe(false);
      expect(isValidTestId("test id")).toBe(false);
      expect(isValidTestId("test@id")).toBe(false);
      expect(isValidTestId("test.id")).toBe(false);
    });

    it("should return false for non-string values", () => {
      expect(isValidTestId(null)).toBe(false);
      expect(isValidTestId(undefined)).toBe(false);
      expect(isValidTestId(123)).toBe(false);
      expect(isValidTestId({})).toBe(false);
      expect(isValidTestId([])).toBe(false);
    });
  });
});
