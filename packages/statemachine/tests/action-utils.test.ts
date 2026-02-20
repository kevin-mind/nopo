import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  determineOutcome,
  getOptionalInput,
  getRequiredInput,
  setOutputs,
  execCommand,
} from "../src/core/action-utils.js";

vi.mock("@actions/core", () => ({
  getInput: vi.fn(),
  setOutput: vi.fn(),
}));

vi.mock("@actions/exec", () => ({
  exec: vi.fn(),
}));

import * as core from "@actions/core";
import * as exec from "@actions/exec";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("determineOutcome", () => {
  const baseParams = {
    deriveResult: "success" as const,
    execResult: "success" as const,
    actionCount: 1,
    transitionName: "Iterate",
    phase: "1",
    subIssueNumber: 101,
    repoUrl: "https://github.com/owner/repo",
  };

  it("Iterate with no existing PR → Opened PR", () => {
    const result = determineOutcome({
      ...baseParams,
      hadExistingPR: false,
    });
    expect(result.emoji).toBe("✅");
    expect(result.transition).toBe(
      "Opened PR - [Phase 1](https://github.com/owner/repo/issues/101)",
    );
  });

  it("Iterate with existing PR → Updated PR", () => {
    const result = determineOutcome({
      ...baseParams,
      hadExistingPR: true,
    });
    expect(result.emoji).toBe("✅");
    expect(result.transition).toBe(
      "Updated PR - [Phase 1](https://github.com/owner/repo/issues/101)",
    );
  });

  it("Iterate with stopReason branch_rebased_and_pushed → Rebased", () => {
    const result = determineOutcome({
      ...baseParams,
      stopReason: "branch_rebased_and_pushed",
    });
    expect(result.emoji).toBe("🔄");
    expect(result.transition).toBe(
      "Rebased - [Phase 1](https://github.com/owner/repo/issues/101)",
    );
  });

  it("Fix CI → Fixed CI", () => {
    const result = determineOutcome({
      ...baseParams,
      transitionName: "Fix CI",
      hadExistingPR: true,
    });
    expect(result.emoji).toBe("🔧");
    expect(result.transition).toBe(
      "Fixed CI - [Phase 1](https://github.com/owner/repo/issues/101)",
    );
  });

  it("Fix CI with rebase → Rebased (overrides Fix CI)", () => {
    const result = determineOutcome({
      ...baseParams,
      transitionName: "Fix CI",
      stopReason: "branch_rebased_and_pushed",
    });
    expect(result.emoji).toBe("🔄");
    expect(result.transition).toBe(
      "Rebased - [Phase 1](https://github.com/owner/repo/issues/101)",
    );
  });

  it("Iterate without phase info → no phase link suffix", () => {
    const result = determineOutcome({
      ...baseParams,
      phase: "-",
      subIssueNumber: undefined,
      hadExistingPR: false,
    });
    expect(result.transition).toBe("Opened PR");
  });

  it("non-iterate transitions are not affected", () => {
    const result = determineOutcome({
      ...baseParams,
      transitionName: "Triage",
    });
    expect(result.transition).toBe("Triage");
    expect(result.emoji).toBe("✅");
  });

  it("failed iterate is not enriched", () => {
    const result = determineOutcome({
      ...baseParams,
      execResult: "failure",
      hadExistingPR: false,
    });
    expect(result.emoji).toBe("❌");
    expect(result.transition).toBe("Iterate");
  });
});

describe("getOptionalInput", () => {
  it("returns value when non-empty", () => {
    vi.mocked(core.getInput).mockReturnValue("hello");
    expect(getOptionalInput("my-input")).toBe("hello");
    expect(core.getInput).toHaveBeenCalledWith("my-input");
  });

  it("returns undefined when empty string", () => {
    vi.mocked(core.getInput).mockReturnValue("");
    expect(getOptionalInput("my-input")).toBeUndefined();
  });
});

describe("getRequiredInput", () => {
  it("calls getInput with { required: true } and returns the value", () => {
    vi.mocked(core.getInput).mockReturnValue("required-value");
    expect(getRequiredInput("my-input")).toBe("required-value");
    expect(core.getInput).toHaveBeenCalledWith("my-input", { required: true });
  });
});

describe("setOutputs", () => {
  it("calls setOutput for each defined entry", () => {
    setOutputs({ foo: "bar", baz: "qux" });
    expect(core.setOutput).toHaveBeenCalledWith("foo", "bar");
    expect(core.setOutput).toHaveBeenCalledWith("baz", "qux");
    expect(core.setOutput).toHaveBeenCalledTimes(2);
  });

  it("skips undefined values", () => {
    setOutputs({ foo: "bar", baz: undefined });
    expect(core.setOutput).toHaveBeenCalledTimes(1);
    expect(core.setOutput).toHaveBeenCalledWith("foo", "bar");
  });

  it("handles empty object", () => {
    setOutputs({});
    expect(core.setOutput).not.toHaveBeenCalled();
  });
});

describe("execCommand", () => {
  it("captures stdout and stderr via listeners and trims whitespace", async () => {
    vi.mocked(exec.exec).mockImplementation(
      async (_command, _args, options) => {
        options?.listeners?.stdout?.(Buffer.from("  hello  "));
        options?.listeners?.stderr?.(Buffer.from("  error  "));
        return 0;
      },
    );

    const result = await execCommand("echo", ["hello"]);
    expect(result.stdout).toBe("hello");
    expect(result.stderr).toBe("error");
    expect(result.exitCode).toBe(0);
  });

  it("returns exitCode from exec", async () => {
    vi.mocked(exec.exec).mockImplementation(
      async (_command, _args, options) => {
        options?.listeners?.stdout?.(Buffer.from(""));
        return 1;
      },
    );

    const result = await execCommand("false");
    expect(result.exitCode).toBe(1);
  });

  it("passes through extra options", async () => {
    vi.mocked(exec.exec).mockImplementation(
      async (_command, _args, options) => {
        options?.listeners?.stdout?.(Buffer.from(""));
        return 0;
      },
    );

    await execCommand("echo", [], { ignoreReturnCode: true });
    expect(exec.exec).toHaveBeenCalledWith(
      "echo",
      [],
      expect.objectContaining({ ignoreReturnCode: true }),
    );
  });
});
