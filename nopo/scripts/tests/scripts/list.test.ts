import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import process from "node:process";

import ListScript from "../../src/scripts/list.ts";
import { createConfig, discoverTargets } from "../../src/lib.ts";
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
  describe("discoverTargets", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nopo-test-"));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("returns empty array when apps directory does not exist", () => {
      const targets = discoverTargets(tmpDir);
      expect(targets).toEqual([]);
    });

    it("returns empty array when apps directory is empty", () => {
      fs.mkdirSync(path.join(tmpDir, "apps"));
      const targets = discoverTargets(tmpDir);
      expect(targets).toEqual([]);
    });

    it("discovers services with Dockerfile", () => {
      const appsDir = path.join(tmpDir, "apps");
      fs.mkdirSync(appsDir);

      // Create service with Dockerfile
      const backendDir = path.join(appsDir, "backend");
      fs.mkdirSync(backendDir);
      fs.writeFileSync(path.join(backendDir, "Dockerfile"), "FROM node:18");

      const targets = discoverTargets(tmpDir);
      expect(targets).toEqual(["backend"]);
    });

    it("ignores directories without Dockerfile", () => {
      const appsDir = path.join(tmpDir, "apps");
      fs.mkdirSync(appsDir);

      // Create service WITH Dockerfile
      const backendDir = path.join(appsDir, "backend");
      fs.mkdirSync(backendDir);
      fs.writeFileSync(path.join(backendDir, "Dockerfile"), "FROM node:18");

      // Create service WITHOUT Dockerfile
      const libDir = path.join(appsDir, "shared-lib");
      fs.mkdirSync(libDir);
      fs.writeFileSync(path.join(libDir, "package.json"), "{}");

      const targets = discoverTargets(tmpDir);
      expect(targets).toEqual(["backend"]);
    });

    it("discovers multiple services", () => {
      const appsDir = path.join(tmpDir, "apps");
      fs.mkdirSync(appsDir);

      // Create multiple services
      for (const service of ["backend", "web", "worker"]) {
        const serviceDir = path.join(appsDir, service);
        fs.mkdirSync(serviceDir);
        fs.writeFileSync(path.join(serviceDir, "Dockerfile"), "FROM node:18");
      }

      const targets = discoverTargets(tmpDir);
      expect(targets).toHaveLength(3);
      expect(targets).toContain("backend");
      expect(targets).toContain("web");
      expect(targets).toContain("worker");
    });

    it("ignores files in apps directory", () => {
      const appsDir = path.join(tmpDir, "apps");
      fs.mkdirSync(appsDir);

      // Create a file (not a directory)
      fs.writeFileSync(path.join(appsDir, "README.md"), "# Apps");

      // Create actual service
      const backendDir = path.join(appsDir, "backend");
      fs.mkdirSync(backendDir);
      fs.writeFileSync(path.join(backendDir, "Dockerfile"), "FROM node:18");

      const targets = discoverTargets(tmpDir);
      expect(targets).toEqual(["backend"]);
    });
  });

  describe("ListScript.parseArgs", () => {
    it("defaults to text format", () => {
      const config = createConfig({ silent: true });
      const args = ListScript.parseArgs(
        { config, argv: ["list"] } as any,
        false,
      );
      expect(args.format).toBe("text");
      expect(args.withConfig).toBe(false);
    });

    it("parses --json flag", () => {
      const config = createConfig({ silent: true });
      const args = ListScript.parseArgs(
        { config, argv: ["list", "--json"] } as any,
        false,
      );
      expect(args.format).toBe("json");
    });

    it("parses -j flag", () => {
      const config = createConfig({ silent: true });
      const args = ListScript.parseArgs(
        { config, argv: ["list", "-j"] } as any,
        false,
      );
      expect(args.format).toBe("json");
    });

    it("parses --format json", () => {
      const config = createConfig({ silent: true });
      const args = ListScript.parseArgs(
        { config, argv: ["list", "--format", "json"] } as any,
        false,
      );
      expect(args.format).toBe("json");
    });

    it("parses -f json", () => {
      const config = createConfig({ silent: true });
      const args = ListScript.parseArgs(
        { config, argv: ["list", "-f", "json"] } as any,
        false,
      );
      expect(args.format).toBe("json");
    });

    it("parses --csv flag", () => {
      const config = createConfig({ silent: true });
      const args = ListScript.parseArgs(
        { config, argv: ["list", "--csv"] } as any,
        false,
      );
      expect(args.format).toBe("csv");
    });

    it("parses --format csv", () => {
      const config = createConfig({ silent: true });
      const args = ListScript.parseArgs(
        { config, argv: ["list", "--format", "csv"] } as any,
        false,
      );
      expect(args.format).toBe("csv");
    });

    it("parses --with-config flag", () => {
      const config = createConfig({ silent: true });
      const args = ListScript.parseArgs(
        { config, argv: ["list", "--with-config"] } as any,
        false,
      );
      expect(args.withConfig).toBe(true);
    });

    it("parses -c flag", () => {
      const config = createConfig({ silent: true });
      const args = ListScript.parseArgs(
        { config, argv: ["list", "-c"] } as any,
        false,
      );
      expect(args.withConfig).toBe(true);
    });

    it("parses combined flags", () => {
      const config = createConfig({ silent: true });
      const args = ListScript.parseArgs(
        { config, argv: ["list", "--json", "--with-config"] } as any,
        false,
      );
      expect(args.format).toBe("json");
      expect(args.withConfig).toBe(true);
    });

    it("returns defaults when run as dependency", () => {
      const config = createConfig({ silent: true });
      const args = ListScript.parseArgs(
        { config, argv: ["list", "--json"] } as any,
        true, // isDependency
      );
      expect(args.format).toBe("text");
      expect(args.withConfig).toBe(false);
    });
  });

  describe("JSON output", () => {
    it("outputs services as JSON array", async () => {
      let output = "";
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation((chunk) => {
          output += chunk;
          return true;
        });

      const config = createConfig({
        envFile: createTmpEnv(),
        silent: true,
      });

      await runScript(ListScript, config, ["list", "--json"]);

      expect(stdoutSpy).toHaveBeenCalled();
      const parsed = JSON.parse(output.trim());
      expect(Array.isArray(parsed)).toBe(true);

      stdoutSpy.mockRestore();
    });

    it("outputs services with config when --with-config is set", async () => {
      let output = "";
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation((chunk) => {
          output += chunk;
          return true;
        });

      const config = createConfig({
        envFile: createTmpEnv(),
        silent: true,
      });

      await runScript(ListScript, config, ["list", "--json", "--with-config"]);

      expect(stdoutSpy).toHaveBeenCalled();
      const parsed = JSON.parse(output.trim());
      expect(typeof parsed).toBe("object");
      expect(Array.isArray(parsed)).toBe(false);

      // Each service should have config properties
      for (const service of Object.keys(parsed)) {
        expect(parsed[service]).toHaveProperty("cpu");
        expect(parsed[service]).toHaveProperty("memory");
        expect(parsed[service]).toHaveProperty("port");
        expect(parsed[service]).toHaveProperty("min_instances");
        expect(parsed[service]).toHaveProperty("max_instances");
        expect(parsed[service]).toHaveProperty("has_database");
        expect(parsed[service]).toHaveProperty("run_migrations");
      }

      stdoutSpy.mockRestore();
    });
  });
});
