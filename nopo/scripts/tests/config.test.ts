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

    const api = project.services.entries.api;
    expect(api).toBeDefined();
    expect(api?.infrastructure.cpu).toBe("2");
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
infrastructure:
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
infrastructure: {}
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
    expect(worker?.infrastructure.memory).toBe("512Mi");
    expect(worker?.infrastructure.port).toBe(3000);
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

  describe("runtime configuration", () => {
    it("supports the new 'runtime' key", () => {
      const root = createProject({
        rootConfig: `
name: Runtime Config
services:
  dir: ./apps
`,
        services: {
          api: `
name: api
dockerfile: Dockerfile
runtime:
  cpu: "2"
  memory: "1Gi"
  port: 8080
`,
        },
      });

      const project = loadProjectConfig(root);
      const api = project.services.entries.api;

      expect(api?.runtime.cpu).toBe("2");
      expect(api?.runtime.memory).toBe("1Gi");
      expect(api?.runtime.port).toBe(8080);
      // infrastructure should mirror runtime for backward compatibility
      expect(api?.infrastructure.cpu).toBe("2");
    });

    it("supports legacy 'infrastructure' key for backward compatibility", () => {
      const root = createProject({
        rootConfig: `
name: Legacy Infrastructure
services:
  dir: ./apps
`,
        services: {
          api: `
name: api
dockerfile: Dockerfile
infrastructure:
  cpu: "4"
  memory: "2Gi"
`,
        },
      });

      const project = loadProjectConfig(root);
      const api = project.services.entries.api;

      // Both runtime and infrastructure should have the same values
      expect(api?.runtime.cpu).toBe("4");
      expect(api?.infrastructure.cpu).toBe("4");
    });

    it("prefers 'runtime' over 'infrastructure' when both are specified", () => {
      const root = createProject({
        rootConfig: `
name: Both Keys
services:
  dir: ./apps
`,
        services: {
          api: `
name: api
dockerfile: Dockerfile
runtime:
  cpu: "2"
infrastructure:
  cpu: "4"
`,
        },
      });

      const project = loadProjectConfig(root);
      const api = project.services.entries.api;

      // runtime takes precedence
      expect(api?.runtime.cpu).toBe("2");
      expect(api?.infrastructure.cpu).toBe("2");
    });
  });

  describe("build configuration", () => {
    it("supports build.dockerfile", () => {
      const root = createProject({
        rootConfig: `
name: Build Config
services:
  dir: ./apps
`,
        services: {
          api: `
name: api
build:
  dockerfile: Dockerfile.prod
`,
        },
      });

      const project = loadProjectConfig(root);
      const api = project.services.entries.api;

      expect(api?.build?.dockerfile).toBe("Dockerfile.prod");
      expect(api?.paths.dockerfile).toBe(
        path.resolve(root, "apps", "api", "Dockerfile.prod"),
      );
    });

    it("prefers build.dockerfile over top-level dockerfile", () => {
      const root = createProject({
        rootConfig: `
name: Dockerfile Priority
services:
  dir: ./apps
`,
        services: {
          api: `
name: api
dockerfile: Dockerfile.old
build:
  dockerfile: Dockerfile.new
`,
        },
      });

      const project = loadProjectConfig(root);
      const api = project.services.entries.api;

      expect(api?.paths.dockerfile).toBe(
        path.resolve(root, "apps", "api", "Dockerfile.new"),
      );
    });

    it("supports build.command for packages", () => {
      const root = createProject({
        rootConfig: `
name: Package Build
services:
  dir: ./apps
`,
        services: {
          ui: `
name: ui
build:
  command: pnpm build
  output:
    - dist
    - types
`,
        },
      });

      const project = loadProjectConfig(root);
      const ui = project.services.entries.ui;

      expect(ui?.build?.command).toBe("pnpm build");
      expect(ui?.build?.output).toEqual(["dist", "types"]);
    });

    it("normalizes single output string to array", () => {
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
  command: tsc
  output: dist
`,
        },
      });

      const project = loadProjectConfig(root);
      const lib = project.services.entries.lib;

      expect(lib?.build?.output).toEqual(["dist"]);
    });

    it("supports build.packages for Docker builds", () => {
      const root = createProject({
        rootConfig: `
name: Docker with Packages
services:
  dir: ./apps
`,
        services: {
          api: `
name: api
build:
  dockerfile: Dockerfile
  packages:
    - "@more/shared"
    - "@more/utils"
`,
        },
      });

      const project = loadProjectConfig(root);
      const api = project.services.entries.api;

      expect(api?.build?.packages).toEqual(["@more/shared", "@more/utils"]);
    });

    it("supports build.env for environment variables", () => {
      const root = createProject({
        rootConfig: `
name: Build Env
services:
  dir: ./apps
`,
        services: {
          api: `
name: api
build:
  dockerfile: Dockerfile
  env:
    NODE_ENV: production
    BUILD_TARGET: api
`,
        },
      });

      const project = loadProjectConfig(root);
      const api = project.services.entries.api;

      expect(api?.build?.env).toEqual({
        NODE_ENV: "production",
        BUILD_TARGET: "api",
      });
    });
  });

  describe("isPackage property", () => {
    it("identifies services with dockerfile as not packages", () => {
      const root = createProject({
        rootConfig: `
name: Service Check
services:
  dir: ./apps
`,
        services: {
          api: `
name: api
dockerfile: Dockerfile
`,
        },
      });

      const project = loadProjectConfig(root);
      const api = project.services.entries.api;

      expect(api?.isPackage).toBe(false);
    });

    it("identifies services with image as not packages", () => {
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

      const project = loadProjectConfig(root);
      const db = project.services.entries.db;

      expect(db?.isPackage).toBe(false);
    });

    it("identifies services with only build.command as packages", () => {
      const root = createProject({
        rootConfig: `
name: Package Check
services:
  dir: ./apps
`,
        services: {
          ui: `
name: ui
build:
  command: pnpm build
`,
        },
      });

      const project = loadProjectConfig(root);
      const ui = project.services.entries.ui;

      expect(ui?.isPackage).toBe(true);
    });

    it("identifies services with neither dockerfile nor image as packages", () => {
      const root = createProject({
        rootConfig: `
name: Command Only
services:
  dir: ./apps
`,
        services: {
          scripts: `
name: scripts
commands:
  test: echo test
`,
        },
      });

      const project = loadProjectConfig(root);
      const scripts = project.services.entries.scripts;

      expect(scripts?.isPackage).toBe(true);
    });

    it("identifies services with build.dockerfile as not packages", () => {
      const root = createProject({
        rootConfig: `
name: Build Dockerfile
services:
  dir: ./apps
`,
        services: {
          api: `
name: api
build:
  dockerfile: Dockerfile
  command: pnpm build
`,
        },
      });

      const project = loadProjectConfig(root);
      const api = project.services.entries.api;

      expect(api?.isPackage).toBe(false);
    });

    it("marks root service as a package", () => {
      const root = createProject({
        rootConfig: `
name: Root Package
services:
  dir: ./apps
root:
  commands:
    test: pnpm test
`,
        services: {
          // Need at least one service directory to exist
          placeholder: `
name: placeholder
`,
        },
      });

      const project = loadProjectConfig(root);
      const rootService = project.services.entries.root;

      expect(rootService?.isPackage).toBe(true);
    });
  });
});
