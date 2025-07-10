import { describe, expect, it } from "vitest";
import Component from "../src/component";

describe("Component", () => {
  it("runs a test", () => {
    expect(Component()).toStrictEqual("Component");
  });
});
