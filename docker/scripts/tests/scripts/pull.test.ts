import { describe, it, vi, expect, beforeEach } from "vitest";
import PullScript from "../../src/scripts/pull";
import { createConfig } from "../../src/lib";

import { createTmpEnv, runScript } from "../utils";

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

// Mock the exec property getter to return a mock function
const mockExec = vi
  .fn()
  .mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
Object.defineProperty(PullScript.prototype, "exec", {
  get: () => mockExec,
  configurable: true,
});

describe("pull", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("pulls image with correct command", async () => {
    const config = createConfig({
      envFile: createTmpEnv({
        DOCKER_TAG: "docker.io/kevin-mind/nopo:latest",
      }),
      silent: true,
    });

    await runScript(PullScript, config);

    expect(mockExec).toHaveBeenCalledWith([
      "docker compose -f docker/docker-compose.base.yml pull base --policy always",
    ]);
  });

  it("has correct dependencies", () => {
    expect(PullScript.dependencies).toHaveLength(1);
    expect(PullScript.dependencies[0]?.enabled).toBe(true);
  });
});
