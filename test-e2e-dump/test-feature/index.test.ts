import { describe, expect, it } from "vitest";

import { runTest } from "./index";

describe("test-feature runTest", () => {
  it("returns true", () => {
    const result = runTest();

    expect(result).toBe(true);
  });
});
