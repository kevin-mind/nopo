import { describe, expect, it } from "vitest";

import { runTest } from "./index";

describe("test-feature", () => {
  it("runTest returns true", () => {
    expect(runTest()).toBe(true);
  });
});
