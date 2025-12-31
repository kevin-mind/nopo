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

    it("includes inline services when --with-config is used", async () => {
      let output = "";
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation((chunk) => {
          output += chunk;
          return true;
        });

      const config = createConfig({ envFile: createTmpEnv(), silent: true });
      await runScript(ListScript, config, ["list", "--json", "--with-config"]);

      const parsed = JSON.parse(output.trim()) as Record<string, unknown>;
      expect(parsed.shaddow).toBeDefined();
      expect(parsed.shaddow).toHaveProperty("kind", "inline");

      stdoutSpy.mockRestore();
    });
  });
});
