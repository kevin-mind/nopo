import { describe, it, expect } from "vitest";
import { parseTargetArgs, validateTargets } from "../src/target-args.ts";

describe("parseTargetArgs", () => {
  const availableTargets = ["backend", "web", "api"];

  it("parses targets from positionals", () => {
    const argv = ["backend", "web"];
    const result = parseTargetArgs("build", argv, availableTargets);

    expect(result.targets).toEqual(["backend", "web"]);
    expect(result.leadingArgs).toEqual([]);
    expect(result.options).toEqual({});
  });

  it("returns empty targets when none specified", () => {
    const argv: string[] = [];
    const result = parseTargetArgs("build", argv, availableTargets);

    expect(result.targets).toEqual([]);
    expect(result.leadingArgs).toEqual([]);
    expect(result.options).toEqual({});
  });

  it("handles leadingPositionals option for run command", () => {
    const argv = ["test", "backend", "web"];
    const result = parseTargetArgs("run", argv, availableTargets, {
      leadingPositionals: 1,
    });

    expect(result.leadingArgs).toEqual(["test"]);
    expect(result.targets).toEqual(["backend", "web"]);
  });

  it("validates targets against available list", () => {
    const argv = ["backend", "invalid"];
    expect(() => {
      parseTargetArgs("build", argv, availableTargets);
    }).toThrow("Unknown target 'invalid'");
  });

  it("throws for unknown target names", () => {
    const argv = ["unknown-service"];
    expect(() => {
      parseTargetArgs("build", argv, availableTargets);
    }).toThrow("Unknown target 'unknown-service'");
  });

  it("handles options mixed with targets", () => {
    const argv = ["backend", "--no-cache", "web", "--output", "build.json"];
    const result = parseTargetArgs("build", argv, availableTargets, {
      boolean: ["no-cache"],
      string: ["output"],
    });

    expect(result.targets).toEqual(["backend", "web"]);
    expect(result.options["no-cache"]).toBe(true);
    expect(result.options["output"]).toBe("build.json");
  });

  it("handles case-insensitive targets", () => {
    const argv = ["BACKEND", "Web"];
    const result = parseTargetArgs("build", argv, availableTargets);

    expect(result.targets).toEqual(["backend", "web"]);
  });

  it("handles multiple unknown targets in error message", () => {
    const argv = ["unknown1", "unknown2"];
    expect(() => {
      parseTargetArgs("build", argv, availableTargets);
    }).toThrow("Unknown targets 'unknown1', 'unknown2'");
  });
});

describe("validateTargets", () => {
  const availableTargets = ["backend", "web", "api"];

  it("passes validation for valid targets", () => {
    expect(() => {
      validateTargets(["backend", "web"], availableTargets);
    }).not.toThrow();
  });

  it("throws for unknown targets", () => {
    expect(() => {
      validateTargets(["unknown"], availableTargets);
    }).toThrow("Unknown target 'unknown'");
  });

  it("throws for multiple unknown targets", () => {
    expect(() => {
      validateTargets(["unknown1", "unknown2"], availableTargets);
    }).toThrow("Unknown targets 'unknown1', 'unknown2'");
  });

  it("handles empty target list", () => {
    expect(() => {
      validateTargets([], availableTargets);
    }).not.toThrow();
  });
});
