import { describe, expect, it } from "vitest";
import backend from "./index";

describe("backend", () => {
  it("runs a test", () => {
    expect(backend).toStrictEqual("foo");
  });
});
