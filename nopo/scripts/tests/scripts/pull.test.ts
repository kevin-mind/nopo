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

describe("pull", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips pulling when no targets provided", async () => {
    const config = createTestConfig({
      envFile: createTmpEnv({
        DOCKER_TAG: "docker.io/kevin-mind/nopo:latest",
      }),
      silent: true,
    });

    await runScript(PullScript, config);

    // Should not call pullMany when no targets
    expect(mockPullMany).not.toHaveBeenCalled();
  });

  it("has correct dependencies", () => {
    expect(PullScript.dependencies).toHaveLength(1);
    expect(PullScript.dependencies[0]?.enabled).toBe(true);
  });
});
