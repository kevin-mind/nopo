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

  describe("output formats", () => {
    it("outputs JSON with --json flag", async () => {
      let output = "";
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation((chunk) => {
          output += chunk;
          return true;
        });

      const config = createConfig({ envFile: createTmpEnv(), silent: true });
      await runScript(ListScript, config, ["list", "--json"]);

      const parsed = JSON.parse(output.trim());
      expect(Array.isArray(parsed)).toBe(true);
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

      const parsed = JSON.parse(output.trim());
      expect(Array.isArray(parsed)).toBe(true);
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

      const parsed = JSON.parse(output.trim());
      expect(Array.isArray(parsed)).toBe(true);
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

    it("outputs JSON object with --json --with-config", async () => {
      let output = "";
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation((chunk) => {
          output += chunk;
          return true;
        });

      const config = createConfig({ envFile: createTmpEnv(), silent: true });
      await runScript(ListScript, config, ["list", "--json", "--with-config"]);

      const parsed = JSON.parse(output.trim());
      expect(typeof parsed).toBe("object");
      expect(Array.isArray(parsed)).toBe(false);
      stdoutSpy.mockRestore();
    });

    it("outputs JSON object with -j -c flags", async () => {
      let output = "";
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation((chunk) => {
          output += chunk;
          return true;
        });

      const config = createConfig({ envFile: createTmpEnv(), silent: true });
      await runScript(ListScript, config, ["list", "-j", "-c"]);

      const parsed = JSON.parse(output.trim());
      expect(typeof parsed).toBe("object");
      expect(Array.isArray(parsed)).toBe(false);
      stdoutSpy.mockRestore();
    });
  });
});
