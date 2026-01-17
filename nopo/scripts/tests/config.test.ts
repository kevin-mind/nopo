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
  it("loads directory services", () => {
    const root = createProject({
      rootConfig: `
name: Example Project
services:
  dir: ./apps
`,
      services: {
        api: `
name: api
description: Public API
dockerfile: Dockerfile
static_path: build
runtime:
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

    const api = project.services.entries.api;
    expect(api).toBeDefined();
    expect(api?.runtime?.cpu).toBe("2");
    expect(api?.staticPath).toBe("build");
  });

  it("loads services with image instead of dockerfile", () => {
    const root = createProject({
      rootConfig: `
name: Image Project
services:
  dir: ./apps
`,
      services: {
        db: `
name: db
description: Database
image: postgres:16
runtime:
  port: 5432
`,
      },
    });

    const project = loadProjectConfig(root);

    expect(project.services.targets).toEqual(["db"]);

    const db = project.services.entries.db;
    expect(db).toBeDefined();
    expect(db?.image).toBe("postgres:16");
    expect(db?.paths.dockerfile).toBeUndefined();
  });

  it("applies defaults when fields are omitted", () => {
    const root = createProject({
      rootConfig: `
name: Defaults
`,
      services: {
        worker: `
name: worker
dockerfile: Dockerfile
runtime: {}
`,
      },
    });

    const project = loadProjectConfig(root);
    const worker = project.services.entries.worker;

    expect(project.os.base.from).toBe("node:22.16.0-slim");
    expect(project.os.dependencies).toEqual({
      "build-essential": "",
      jq: "",
      curl: "",
    });
    expect(worker?.runtime?.memory).toBe("512Mi");
    expect(worker?.runtime?.port).toBe(3000);
  });

  it("skips directories without nopo.yml", () => {
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

    // Should not throw - directories without nopo.yml are silently skipped
    const config = loadProjectConfig(root);
    expect(config.services.entries["ghost"]).toBeUndefined();
  });

  it("allows services without dockerfile or image (command-only services)", () => {
    const root = createProject({
      rootConfig: `
name: Command Only Services
services:
  dir: ./apps
`,
      services: {
        "command-only": `
name: command-only
description: Command-only service (no docker)
commands:
  test: echo hello
`,
      },
    });

    // Should not throw - services can now exist without dockerfile/image
    const config = loadProjectConfig(root);
    const commandOnlyService = config.services.entries["command-only"];
    expect(commandOnlyService).toBeDefined();
    expect(commandOnlyService?.paths.dockerfile).toBeUndefined();
    expect(commandOnlyService?.image).toBeUndefined();
  });

  it("identifies packages (no runtime) vs services", () => {
    const root = createProject({
      rootConfig: `
name: Mixed Project
services:
  dir: ./apps
`,
      services: {
        // Service: has runtime
        backend: `
name: backend
dockerfile: Dockerfile
runtime:
  port: 8080
`,
        // Package: no runtime
        ui: `
name: ui
description: Shared UI components
commands:
  compile: pnpm build
`,
      },
    });

    const config = loadProjectConfig(root);

    // Backend is a service (has runtime)
    const backend = config.services.entries.backend;
    expect(backend).toBeDefined();
    expect(backend?.type).toBe("service");

    // UI is a package (no runtime)
    const ui = config.services.entries.ui;
    expect(ui).toBeDefined();
    expect(ui?.type).toBe("package");
  });

  it("supports runtime schema with command", () => {
    const root = createProject({
      rootConfig: `
name: Runtime Schema
services:
  dir: ./apps
`,
      services: {
        api: `
name: api
dockerfile: Dockerfile
runtime:
  command: node server.js
  port: 3000
  cpu: "2"
  memory: "1Gi"
`,
      },
    });

    const config = loadProjectConfig(root);
    const api = config.services.entries.api;

    expect(api).toBeDefined();
    expect(api?.type).toBe("service");
    expect(api?.runtime).toBeDefined();
    expect(api?.runtime?.command).toBe("node server.js");
    expect(api?.runtime?.port).toBe(3000);
    expect(api?.runtime?.cpu).toBe("2");
  });

  it("supports new build schema", () => {
    const root = createProject({
      rootConfig: `
name: Build Schema
services:
  dir: ./apps
`,
      services: {
        web: `
name: web
build:
  command: pnpm build
  output:
    - ./dist
    - ./public
  dockerfile: Dockerfile
  packages:
    - chromium
  env:
    NODE_ENV: production
runtime:
  port: 3000
`,
      },
    });

    const config = loadProjectConfig(root);
    const web = config.services.entries.web;

    expect(web).toBeDefined();
    expect(web?.build).toBeDefined();
    expect(web?.build?.command).toBe("pnpm build");
    expect(web?.build?.output).toEqual(["./dist", "./public"]);
    expect(web?.build?.dockerfile).toBe("Dockerfile");
    expect(web?.build?.packages).toEqual(["chromium"]);
    expect(web?.build?.env).toEqual({ NODE_ENV: "production" });
  });

  it("normalizes build.output from string to array", () => {
    const root = createProject({
      rootConfig: `
name: Single Output
services:
  dir: ./apps
`,
      services: {
        lib: `
name: lib
build:
  command: pnpm build
  output: ./dist
`,
      },
    });

    const config = loadProjectConfig(root);
    const lib = config.services.entries.lib;

    expect(lib?.build?.output).toEqual(["./dist"]);
  });

  it("identifies services with image as services (not packages)", () => {
    const root = createProject({
      rootConfig: `
name: Image Service
services:
  dir: ./apps
`,
      services: {
        db: `
name: db
image: postgres:16
`,
      },
    });

    const config = loadProjectConfig(root);
    const db = config.services.entries.db;

    expect(db).toBeDefined();
    expect(db?.type).toBe("service");
    expect(db?.runtime).toBeUndefined();
  });
});
