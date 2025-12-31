import { describe, it, expect, vi } from "vitest";
import process from "node:process";

import ListScript from "../../src/scripts/list.ts";
import { createConfig } from "../../src/lib.ts";
import { createTmpEnv, runScript } from "../utils.ts";

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

describe("list", () => {
  describe("output formats", () => {
    it("outputs JSON with config and services", async () => {
      let output = "";
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation((chunk) => {
          output += chunk;
          return true;
        });

      const config = createConfig({ envFile: createTmpEnv(), silent: true });
      await runScript(ListScript, config, ["list", "--json"]);

      const parsed = JSON.parse(output.trim()) as {
        config: unknown;
        services: unknown;
      };
      expect(parsed.config).toBeDefined();
      expect(parsed.services).toBeDefined();
      expect(Object.keys(parsed.services as object)).toContain("backend");
      stdoutSpy.mockRestore();
    });

    it("outputs JSON with -j flag", async () => {
      let output = "";
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation((chunk) => {
          output += chunk;
          return true;
        });

      const config = createConfig({ envFile: createTmpEnv(), silent: true });
      await runScript(ListScript, config, ["list", "-j"]);

      const parsed = JSON.parse(output.trim()) as {
        config: unknown;
        services: unknown;
      };
      expect(parsed.config).toBeDefined();
      expect(parsed.services).toBeDefined();
      stdoutSpy.mockRestore();
    });

    it("outputs JSON with --format json", async () => {
      let output = "";
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation((chunk) => {
          output += chunk;
          return true;
        });

      const config = createConfig({ envFile: createTmpEnv(), silent: true });
      await runScript(ListScript, config, ["list", "--format", "json"]);

      const parsed = JSON.parse(output.trim()) as {
        config: unknown;
        services: unknown;
      };
      expect(parsed.config).toBeDefined();
      expect(parsed.services).toBeDefined();
      stdoutSpy.mockRestore();
    });

    it("outputs CSV with --csv flag", async () => {
      let output = "";
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation((chunk) => {
          output += chunk;
          return true;
        });

      const config = createConfig({ envFile: createTmpEnv(), silent: true });
      await runScript(ListScript, config, ["list", "--csv"]);

      // CSV output is comma-separated service names
      expect(output.trim()).toMatch(/^[\w,]*$/);
      stdoutSpy.mockRestore();
    });

    it("outputs CSV with --format csv", async () => {
      let output = "";
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation((chunk) => {
          output += chunk;
          return true;
        });

      const config = createConfig({ envFile: createTmpEnv(), silent: true });
      await runScript(ListScript, config, ["list", "--format", "csv"]);

      expect(output.trim()).toMatch(/^[\w,]*$/);
      stdoutSpy.mockRestore();
    });

    it("includes project config in JSON output", async () => {
      let output = "";
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation((chunk) => {
          output += chunk;
          return true;
        });

      const config = createConfig({ envFile: createTmpEnv(), silent: true });
      await runScript(ListScript, config, ["list", "--json"]);

      const parsed = JSON.parse(output.trim()) as {
        config: { name: string; services_dir: string };
      };
      expect(parsed.config.name).toBeDefined();
      expect(parsed.config.services_dir).toBeDefined();
      stdoutSpy.mockRestore();
    });

    it("includes all services in JSON output", async () => {
      let output = "";
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation((chunk) => {
          output += chunk;
          return true;
        });

      const config = createConfig({ envFile: createTmpEnv(), silent: true });
      await runScript(ListScript, config, ["list", "--json"]);

      const parsed = JSON.parse(output.trim()) as {
        services: Record<string, { cpu: string }>;
      };
      // Should include directory services like backend, web, db, nginx
      expect(Object.keys(parsed.services).length).toBe(4);
      expect(Object.keys(parsed.services)).toContain("backend");
      expect(Object.keys(parsed.services)).toContain("web");
      expect(Object.keys(parsed.services)).toContain("db");
      expect(Object.keys(parsed.services)).toContain("nginx");
      // Each service should have config
      expect(parsed.services.backend!.cpu).toBeDefined();

      stdoutSpy.mockRestore();
    });
  });

  describe("filters", () => {
    it("filters to buildable services with --filter buildable", async () => {
      let output = "";
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation((chunk) => {
          output += chunk;
          return true;
        });

      const config = createConfig({ envFile: createTmpEnv(), silent: true });
      await runScript(ListScript, config, [
        "list",
        "--json",
        "--filter",
        "buildable",
      ]);

      const parsed = JSON.parse(output.trim()) as {
        services: Record<string, unknown>;
      };
      const services = Object.keys(parsed.services);
      // buildable services have dockerfile, not image (backend, web)
      expect(services).toContain("backend");
      expect(services).toContain("web");
      expect(services).not.toContain("db");
      expect(services).not.toContain("nginx");
      stdoutSpy.mockRestore();
    });

    it("filters to buildable services with -F buildable", async () => {
      let output = "";
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation((chunk) => {
          output += chunk;
          return true;
        });

      const config = createConfig({ envFile: createTmpEnv(), silent: true });
      await runScript(ListScript, config, [
        "list",
        "--json",
        "-F",
        "buildable",
      ]);

      const parsed = JSON.parse(output.trim()) as {
        services: Record<string, unknown>;
      };
      const services = Object.keys(parsed.services);
      expect(services).toContain("backend");
      expect(services).toContain("web");
      expect(services).not.toContain("db");
      expect(services).not.toContain("nginx");
      stdoutSpy.mockRestore();
    });

    it("filters services that have image field with --filter image", async () => {
      let output = "";
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation((chunk) => {
          output += chunk;
          return true;
        });

      const config = createConfig({ envFile: createTmpEnv(), silent: true });
      await runScript(ListScript, config, [
        "list",
        "--json",
        "--filter",
        "image",
      ]);

      const parsed = JSON.parse(output.trim()) as {
        services: Record<string, unknown>;
      };
      const services = Object.keys(parsed.services);
      // db and nginx have image field
      expect(services).toContain("db");
      expect(services).toContain("nginx");
      expect(services).not.toContain("backend");
      expect(services).not.toContain("web");
      stdoutSpy.mockRestore();
    });

    it("filters services without image field with --filter !image", async () => {
      let output = "";
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation((chunk) => {
          output += chunk;
          return true;
        });

      const config = createConfig({ envFile: createTmpEnv(), silent: true });
      await runScript(ListScript, config, [
        "list",
        "--json",
        "--filter",
        "!image",
      ]);

      const parsed = JSON.parse(output.trim()) as {
        services: Record<string, unknown>;
      };
      const services = Object.keys(parsed.services);
      // backend and web don't have image field
      expect(services).toContain("backend");
      expect(services).toContain("web");
      expect(services).not.toContain("db");
      expect(services).not.toContain("nginx");
      stdoutSpy.mockRestore();
    });

    it("filters by field value with --filter infrastructure.hasDatabase=true", async () => {
      let output = "";
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation((chunk) => {
          output += chunk;
          return true;
        });

      const config = createConfig({ envFile: createTmpEnv(), silent: true });
      await runScript(ListScript, config, [
        "list",
        "--json",
        "--filter",
        "infrastructure.hasDatabase=true",
      ]);

      const parsed = JSON.parse(output.trim()) as {
        services: Record<string, unknown>;
      };
      const services = Object.keys(parsed.services);
      // Only backend has hasDatabase=true
      expect(services).toContain("backend");
      expect(services).not.toContain("web");
      expect(services).not.toContain("db");
      expect(services).not.toContain("nginx");
      stdoutSpy.mockRestore();
    });

    it("combines multiple filters with AND logic", async () => {
      let output = "";
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation((chunk) => {
          output += chunk;
          return true;
        });

      const config = createConfig({ envFile: createTmpEnv(), silent: true });
      await runScript(ListScript, config, [
        "list",
        "--json",
        "--filter",
        "buildable",
        "--filter",
        "infrastructure.hasDatabase=true",
      ]);

      const parsed = JSON.parse(output.trim()) as {
        services: Record<string, unknown>;
      };
      // Only backend is buildable AND has database
      expect(Object.keys(parsed.services)).toEqual(["backend"]);
      stdoutSpy.mockRestore();
    });

    it("returns empty services when no services match filter", async () => {
      let output = "";
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation((chunk) => {
          output += chunk;
          return true;
        });

      const config = createConfig({ envFile: createTmpEnv(), silent: true });
      await runScript(ListScript, config, [
        "list",
        "--json",
        "--filter",
        "nonexistent.field=value",
      ]);

      const parsed = JSON.parse(output.trim()) as {
        services: Record<string, unknown>;
      };
      expect(Object.keys(parsed.services)).toEqual([]);
      stdoutSpy.mockRestore();
    });

    it("filters work with CSV output", async () => {
      let output = "";
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation((chunk) => {
          output += chunk;
          return true;
        });

      const config = createConfig({ envFile: createTmpEnv(), silent: true });
      await runScript(ListScript, config, [
        "list",
        "--csv",
        "--filter",
        "buildable",
      ]);

      const services = output.trim().split(",");
      expect(services).toContain("backend");
      expect(services).toContain("web");
      expect(services).not.toContain("db");
      expect(services).not.toContain("nginx");
      stdoutSpy.mockRestore();
    });
  });

  describe("jq processing", () => {
    it("processes JSON output through jq with --jq flag", async () => {
      let output = "";
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation((chunk) => {
          output += chunk;
          return true;
        });

      const config = createConfig({ envFile: createTmpEnv(), silent: true });
      await runScript(ListScript, config, [
        "list",
        "--json",
        "--jq",
        ".services | length",
      ]);

      expect(output.trim()).toBe("4");
      stdoutSpy.mockRestore();
    });

    it("extracts service config with jq", async () => {
      let output = "";
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation((chunk) => {
          output += chunk;
          return true;
        });

      const config = createConfig({ envFile: createTmpEnv(), silent: true });
      await runScript(ListScript, config, [
        "list",
        "--json",
        "--jq",
        ".services.backend.cpu",
      ]);

      expect(output.trim()).toBe('"1"');
      stdoutSpy.mockRestore();
    });

    it("gets service keys with jq", async () => {
      let output = "";
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation((chunk) => {
          output += chunk;
          return true;
        });

      const config = createConfig({ envFile: createTmpEnv(), silent: true });
      await runScript(ListScript, config, [
        "list",
        "--json",
        "--jq",
        '.services | keys | join(",")',
      ]);

      expect(output.trim()).toBe('"backend,db,nginx,web"');
      stdoutSpy.mockRestore();
    });

    it("combines --filter with --jq", async () => {
      let output = "";
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation((chunk) => {
          output += chunk;
          return true;
        });

      const config = createConfig({ envFile: createTmpEnv(), silent: true });
      await runScript(ListScript, config, [
        "list",
        "--json",
        "--filter",
        "buildable",
        "--jq",
        '.services | keys | join(",")',
      ]);

      expect(output.trim()).toBe('"backend,web"');
      stdoutSpy.mockRestore();
    });

    it("extracts project config with jq", async () => {
      let output = "";
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation((chunk) => {
          output += chunk;
          return true;
        });

      const config = createConfig({ envFile: createTmpEnv(), silent: true });
      await runScript(ListScript, config, [
        "list",
        "--json",
        "--jq",
        ".config.name",
      ]);

      expect(output.trim()).toBe('"Nopo Project"');
      stdoutSpy.mockRestore();
    });

    it("throws error when --jq used without --json", async () => {
      const config = createConfig({ envFile: createTmpEnv(), silent: true });

      await expect(
        runScript(ListScript, config, ["list", "--jq", "length"]),
      ).rejects.toThrow("--jq requires --json format");
    });

    it("throws error for invalid jq filter", async () => {
      const config = createConfig({ envFile: createTmpEnv(), silent: true });

      await expect(
        runScript(ListScript, config, ["list", "--json", "--jq", "invalid[["]),
      ).rejects.toThrow("jq filter failed");
    });
  });

  describe("validate", () => {
    it("completes successfully with --validate flag", async () => {
      const config = createConfig({ envFile: createTmpEnv(), silent: true });
      // Should not throw - validates config is valid
      await expect(
        runScript(ListScript, config, ["list", "--validate"]),
      ).resolves.not.toThrow();
    });

    it("completes successfully with -v shorthand", async () => {
      const config = createConfig({ envFile: createTmpEnv(), silent: true });
      await expect(
        runScript(ListScript, config, ["list", "-v"]),
      ).resolves.not.toThrow();
    });

    it("does not output JSON when --validate is used", async () => {
      let output = "";
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation((chunk) => {
          output += chunk;
          return true;
        });

      const config = createConfig({ envFile: createTmpEnv(), silent: true });
      await runScript(ListScript, config, ["list", "--validate"]);

      // --validate should not produce stdout output (logs go to logger)
      expect(output).toBe("");
      stdoutSpy.mockRestore();
    });
  });
});
