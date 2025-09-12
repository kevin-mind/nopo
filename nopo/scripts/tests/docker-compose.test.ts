import { describe, it, expect } from "vitest";

import { DockerCompose, COMPOSE_CONFIG_SCHEMA } from "../src/docker-compose.ts";
import { vi } from "vitest";

const config = COMPOSE_CONFIG_SCHEMA.parse({
  name: "nopo",
  services: {
    a: {
      image: "alpine",
    },
  },
  networks: {
    default: null,
  },
  volumes: {},
});

vi.mock("child_process", () => {
  return {
    ...vi.importActual("child_process"),
    execSync: vi.fn(() => JSON.stringify(config)),
    exec: vi.fn(() => {
      return {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event, callback) => {
          if (event === "close") {
            // Simulate process closing immediately
            setImmediate(() => callback(0));
          }
        }),
      };
    }),
  };
});

import { exec } from "child_process";

describe("docker-compose", () => {
  describe("down", () => {
    it("should build the command", async () => {
      const compose = new DockerCompose();
      await compose.down(["a"], {
        commandOptions: ["--rmi=local", "--volumes"],
      });
      expect(exec).toHaveBeenCalledWith(
        "docker compose down a --rmi=local --volumes",
        expect.any(Object),
      );
    });

    it("should default to all services", async () => {
      const compose = new DockerCompose();
      await compose.down([], {
        commandOptions: ["--rmi=local", "--volumes"],
      });
      expect(exec).toHaveBeenCalledWith(
        "docker compose down --rmi=local --volumes",
        expect.any(Object),
      );
    });
  });
});
