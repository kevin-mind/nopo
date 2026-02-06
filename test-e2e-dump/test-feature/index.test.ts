import { describe, it, expect } from "vitest";
import { runTest } from "./index.js";

describe("runTest", () => {
  it("should return true", () => {
    const result = runTest();
    expect(result).toBe(true);
  });

  it("should be callable multiple times", () => {
    expect(runTest()).toBe(true);
    expect(runTest()).toBe(true);
  });
});
