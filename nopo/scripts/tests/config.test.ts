import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadProjectConfig } from "../src/config/index.ts";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures
    }
  }
  tmpDirs.length = 0;
});

function writeFile(filePath: string, contents: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, "utf-8");
}

function createProject(structure: {
  rootConfig: string;
  services?: Record<string, string>;
}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nopo-config-"));
  tmpDirs.push(root);

  writeFile(path.join(root, "nopo.yml"), structure.rootConfig);

  if (structure.services) {
    for (const [service, config] of Object.entries(structure.services)) {
      writeFile(path.join(root, "apps", service, "nopo.yml"), config);
    }
  }

  return root;
}

describe("loadProjectConfig", () => {
  it("loads directory services and inline overrides", () => {
    const root = createProject({
      rootConfig: `
name: Example Project
services:
  dir: ./apps
  helper:
    description: Inline helper
    static_path: inline
    infrastructure:
      port: 8080
`,
      services: {
        api: `
name: api
description: Public API
dockerfile: Dockerfile
static_path: build
infrastructure:
  cpu: "2"
  memory: "1Gi"
  port: 8080
  min_instances: 1
  max_instances: 5
  has_database: true
  run_migrations: true
`,
      },
    });

    const project = loadProjectConfig(root);

    expect(project.name).toBe("Example Project");
    expect(project.services.targets).toEqual(["api"]);
    expect(project.services.order).toEqual(["api", "helper"]);

    const api = project.services.entries.api;
    expect(api).toBeDefined();
    expect(api?.infrastructure.cpu).toBe("2");
    expect(api?.origin.type).toBe("directory");
    expect(api?.staticPath).toBe("build");

    const helper = project.services.entries.helper;
    expect(helper?.origin.type).toBe("inline");
    expect(helper?.staticPath).toBe("inline");
    expect(helper?.infrastructure.port).toBe(8080);
  });

  it("applies defaults when fields are omitted", () => {
    const root = createProject({
      rootConfig: `
name: Defaults
`,
      services: {
        worker: `
name: worker
infrastructure: {}
`,
      },
    });

    const project = loadProjectConfig(root);
    const worker = project.services.entries.worker;

    expect(project.os.base.from).toBe("node:22.16.0-slim");
    expect(project.os.dependencies.node).toBeDefined();
    expect(worker?.infrastructure.memory).toBe("512Mi");
    expect(worker?.infrastructure.port).toBe(3000);
  });

  it("throws when a service directory is missing nopo.yml", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nopo-config-"));
    tmpDirs.push(root);
    writeFile(
      path.join(root, "nopo.yml"),
      `
name: Missing Service Config
services:
  dir: ./apps
`,
    );
    fs.mkdirSync(path.join(root, "apps", "ghost"), { recursive: true });

    expect(() => loadProjectConfig(root)).toThrow(
      /Missing nopo\.yml in .*ghost/,
    );
  });
});
