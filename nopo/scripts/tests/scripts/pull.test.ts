import { describe, it, vi, expect, beforeEach } from "vitest";
import PullScript from "../../src/scripts/pull.ts";

import { createTmpEnv, runScript, createTestConfig } from "../utils.ts";

vi.mock("../../src/git-info", () => ({
  GitInfo: {
    exists: () => false,
    parse: vi.fn(() => ({
      repo: "unknown",
      branch: "unknown",
      commit: "unknown",
    })),
  },
}));

vi.mock("node:net", () => ({
  default: {
    createServer: vi.fn().mockImplementation(() => ({
      listen: vi.fn(),
      address: vi.fn().mockReturnValue({ port: 80 }),
      close: vi.fn(),
    })),
  },
}));

// Mock docker-compose module - use vi.hoisted to avoid initialization issues
const mockPullMany = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ exitCode: 0 }),
);
vi.mock("docker-compose", () => ({
  default: {
    pullMany: mockPullMany(),
  },
}));

// Mock exec tagged template to prevent real docker pull calls
const mockExec = vi.fn(
  (_strings: TemplateStringsArray, ..._values: unknown[]) =>
    Promise.resolve({ stdout: "", stderr: "", exitCode: 0 }),
);

describe("pull", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock the exec getter to prevent real docker calls
    Object.defineProperty(PullScript.prototype, "exec", {
      get: () => mockExec,
      configurable: true,
    });
  });

  it("pulls all service images when no targets provided", async () => {
    const config = createTestConfig({
      envFile: createTmpEnv({
        DOCKER_TAG: "docker.io/kevin-mind/nopo:latest",
      }),
      silent: true,
    });

    await runScript(PullScript, config);

    // Should attempt to pull images for all buildable services (backend, web)
    expect(mockExec).toHaveBeenCalledTimes(2);
  });

  it("has correct dependencies", () => {
    expect(PullScript.dependencies).toHaveLength(1);
    expect(PullScript.dependencies[0]?.enabled).toBe(true);
  });
});
