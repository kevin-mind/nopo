import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadProjectConfig } from "../../src/config/index.ts";
import {
  resolveCommandDependencies,
  buildExecutionPlan,
  validateCommandTargets,
  resolveCommand,
} from "../../src/commands/index.ts";

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nopo-cmd-"));
  tmpDirs.push(root);

  writeFile(path.join(root, "nopo.yml"), structure.rootConfig);

  if (structure.services) {
    for (const [service, config] of Object.entries(structure.services)) {
      writeFile(path.join(root, "apps", service, "nopo.yml"), config);
    }
  }

  return root;
}

describe("Command Resolution", () => {
  describe("loadProjectConfig with commands", () => {
    it("loads commands from service nopo.yml", () => {
      const root = createProject({
        rootConfig: `
name: Test Project
services:
  dir: ./apps
`,
        services: {
          web: `
name: web
dockerfile: Dockerfile
commands:
  lint:
    command: eslint .
`,
        },
      });

      const project = loadProjectConfig(root);
      const web = project.services.entries.web;

      expect(web?.commands).toBeDefined();
      expect(web?.commands?.lint).toBeDefined();
      expect(web?.commands?.lint?.command).toBe("eslint .");
    });

    it("loads command dependencies", () => {
      const root = createProject({
        rootConfig: `
name: Test Project
services:
  dir: ./apps
`,
        services: {
          web: `
name: web
dockerfile: Dockerfile
commands:
  lint:
    dependencies:
      - backend
    command: eslint .
`,
        },
      });

      const project = loadProjectConfig(root);
      const web = project.services.entries.web;

      expect(web?.commands?.lint?.dependencies).toEqual(["backend"]);
    });

    it("loads complex command dependencies with command overrides", () => {
      const root = createProject({
        rootConfig: `
name: Test Project
services:
  dir: ./apps
`,
        services: {
          web: `
name: web
dockerfile: Dockerfile
commands:
  banana:
    dependencies:
      web:
        - banana
      backend:
        - lint
        - clean
    command: npm start
`,
        },
      });

      const project = loadProjectConfig(root);
      const web = project.services.entries.web;

      expect(web?.commands?.banana?.dependencies).toEqual({
        web: ["banana"],
        backend: ["lint", "clean"],
      });
    });

    it("loads empty dependencies to override service dependencies", () => {
      const root = createProject({
        rootConfig: `
name: Test Project
services:
  dir: ./apps
`,
        services: {
          web: `
name: web
dockerfile: Dockerfile
dependencies:
  - backend
commands:
  lint:
    dependencies: {}
    command: eslint .
`,
        },
      });

      const project = loadProjectConfig(root);
      const web = project.services.entries.web;

      expect(web?.dependencies).toEqual(["backend"]);
      expect(web?.commands?.lint?.dependencies).toEqual({});
    });

    it("loads service-level dependencies", () => {
      const root = createProject({
        rootConfig: `
name: Test Project
services:
  dir: ./apps
`,
        services: {
          web: `
name: web
dockerfile: Dockerfile
dependencies:
  - backend
  - db
`,
          backend: `
name: backend
dockerfile: Dockerfile
dependencies:
  - db
`,
          db: `
name: db
image: postgres:16
`,
        },
      });

      const project = loadProjectConfig(root);

      expect(project.services.entries.web?.dependencies).toEqual([
        "backend",
        "db",
      ]);
      expect(project.services.entries.backend?.dependencies).toEqual(["db"]);
      expect(project.services.entries.db?.dependencies).toEqual([]);
    });
  });

  describe("validateCommandTargets", () => {
    it("succeeds when all top-level targets have the command", () => {
      const root = createProject({
        rootConfig: `
name: Test Project
services:
  dir: ./apps
`,
        services: {
          web: `
name: web
dockerfile: Dockerfile
commands:
  lint:
    command: eslint .
`,
          backend: `
name: backend
dockerfile: Dockerfile
commands:
  lint:
    command: ruff check .
`,
        },
      });

      const project = loadProjectConfig(root);
      expect(() =>
        validateCommandTargets(project, "lint", ["web", "backend"]),
      ).not.toThrow();
    });

    it("throws when a top-level target is missing the command", () => {
      const root = createProject({
        rootConfig: `
name: Test Project
services:
  dir: ./apps
`,
        services: {
          web: `
name: web
dockerfile: Dockerfile
commands:
  lint:
    command: eslint .
`,
          backend: `
name: backend
dockerfile: Dockerfile
`,
        },
      });

      const project = loadProjectConfig(root);
      expect(() =>
        validateCommandTargets(project, "lint", ["web", "backend"]),
      ).toThrow(/Service 'backend' does not define command 'lint'/);
    });

    it("does not require dependencies to have the command", () => {
      const root = createProject({
        rootConfig: `
name: Test Project
services:
  dir: ./apps
`,
        services: {
          web: `
name: web
dockerfile: Dockerfile
dependencies:
  - backend
commands:
  lint:
    command: eslint .
`,
          backend: `
name: backend
dockerfile: Dockerfile
`,
        },
      });

      const project = loadProjectConfig(root);
      // backend is a dependency but not a top-level target, so should not throw
      expect(() =>
        validateCommandTargets(project, "lint", ["web"]),
      ).not.toThrow();
    });
  });

  describe("resolveCommandDependencies", () => {
    it("returns empty when no dependencies", () => {
      const root = createProject({
        rootConfig: `
name: Test Project
services:
  dir: ./apps
`,
        services: {
          web: `
name: web
dockerfile: Dockerfile
commands:
  lint:
    command: eslint .
`,
        },
      });

      const project = loadProjectConfig(root);
      const deps = resolveCommandDependencies(project, "lint", "web");

      expect(deps).toEqual([]);
    });

    it("uses empty dependencies to override service-level dependencies", () => {
      const root = createProject({
        rootConfig: `
name: Test Project
services:
  dir: ./apps
`,
        services: {
          web: `
name: web
dockerfile: Dockerfile
dependencies:
  - backend
commands:
  lint:
    dependencies: {}
    command: eslint .
`,
          backend: `
name: backend
dockerfile: Dockerfile
`,
        },
      });

      const project = loadProjectConfig(root);
      const deps = resolveCommandDependencies(project, "lint", "web");

      expect(deps).toEqual([]);
    });

    it("uses command-specific dependencies when defined", () => {
      const root = createProject({
        rootConfig: `
name: Test Project
services:
  dir: ./apps
`,
        services: {
          web: `
name: web
dockerfile: Dockerfile
dependencies:
  - api
commands:
  lint:
    dependencies:
      - backend
      - worker
    command: eslint .
`,
          api: `
name: api
dockerfile: Dockerfile
`,
          backend: `
name: backend
dockerfile: Dockerfile
commands:
  lint:
    command: python setup.py build
`,
          worker: `
name: worker
dockerfile: Dockerfile
commands:
  lint:
    command: cargo build
`,
        },
      });

      const project = loadProjectConfig(root);
      const deps = resolveCommandDependencies(project, "lint", "web");

      // Should use command-specific dependencies, not service-level
      expect(deps).toContainEqual({ service: "backend", command: "lint" });
      expect(deps).toContainEqual({ service: "worker", command: "lint" });
      expect(deps).not.toContainEqual(
        expect.objectContaining({ service: "api" }),
      );
    });

    it("resolves complex command dependencies with different commands", () => {
      const root = createProject({
        rootConfig: `
name: Test Project
services:
  dir: ./apps
`,
        services: {
          web: `
name: web
dockerfile: Dockerfile
commands:
  banana:
    dependencies:
      backend:
        - lint
        - clean
    command: npm start
`,
          backend: `
name: backend
dockerfile: Dockerfile
commands:
  lint:
    command: eslint .
  clean:
    command: npm run clean
`,
        },
      });

      const project = loadProjectConfig(root);
      const deps = resolveCommandDependencies(project, "banana", "web");

      expect(deps).toContainEqual({ service: "backend", command: "lint" });
      expect(deps).toContainEqual({ service: "backend", command: "clean" });
    });
  });

  describe("buildExecutionPlan", () => {
    it("creates a simple execution plan", () => {
      const root = createProject({
        rootConfig: `
name: Test Project
services:
  dir: ./apps
`,
        services: {
          web: `
name: web
dockerfile: Dockerfile
commands:
  lint:
    command: eslint .
`,
        },
      });

      const project = loadProjectConfig(root);
      const plan = buildExecutionPlan(project, "lint", ["web"]);

      expect(plan.stages).toHaveLength(1);
      expect(plan.stages[0]).toHaveLength(1);
      expect(plan.stages[0]![0]).toMatchObject({
        service: "web",
        command: "lint",
      });
    });

    it("groups independent services in the same stage for parallelization", () => {
      const root = createProject({
        rootConfig: `
name: Test Project
services:
  dir: ./apps
`,
        services: {
          web: `
name: web
dockerfile: Dockerfile
commands:
  lint:
    command: eslint .
`,
          backend: `
name: backend
dockerfile: Dockerfile
commands:
  lint:
    command: ruff check .
`,
          worker: `
name: worker
dockerfile: Dockerfile
commands:
  lint:
    command: cargo clippy
`,
        },
      });

      const project = loadProjectConfig(root);
      const plan = buildExecutionPlan(project, "lint", [
        "web",
        "backend",
        "worker",
      ]);

      // All independent, should be in same stage
      expect(plan.stages).toHaveLength(1);
      expect(plan.stages[0]).toHaveLength(3);
    });

    it("handles services with no dependencies independently", () => {
      const root = createProject({
        rootConfig: `
name: Test Project
services:
  dir: ./apps
`,
        services: {
          web: `
name: web
dockerfile: Dockerfile
commands:
  lint:
    dependencies: {}
    command: eslint .
`,
          backend: `
name: backend
dockerfile: Dockerfile
commands:
  lint:
    dependencies: {}
    command: ruff check .
`,
        },
      });

      const project = loadProjectConfig(root);
      const plan = buildExecutionPlan(project, "lint", ["web", "backend"]);

      // Both should be in the same stage (parallel)
      expect(plan.stages).toHaveLength(1);
      expect(plan.stages[0]).toHaveLength(2);
    });
  });

  describe("CommandDependencySpec normalization", () => {
    it("normalizes array dependencies", () => {
      const root = createProject({
        rootConfig: `
name: Test Project
services:
  dir: ./apps
`,
        services: {
          web: `
name: web
dockerfile: Dockerfile
commands:
  lint:
    dependencies:
      - backend
      - worker
    command: eslint .
`,
          backend: `
name: backend
dockerfile: Dockerfile
commands:
  lint:
    command: python setup.py build
`,
          worker: `
name: worker
dockerfile: Dockerfile
commands:
  lint:
    command: cargo build
`,
        },
      });

      const project = loadProjectConfig(root);
      const web = project.services.entries.web;

      // Array dependencies should be normalized to same command
      expect(web?.commands?.lint?.dependencies).toEqual(["backend", "worker"]);
    });

    it("normalizes object dependencies with command arrays", () => {
      const root = createProject({
        rootConfig: `
name: Test Project
services:
  dir: ./apps
`,
        services: {
          web: `
name: web
dockerfile: Dockerfile
commands:
  deploy:
    dependencies:
      backend:
        - lint
        - migrate
    command: npm run deploy
`,
          backend: `
name: backend
dockerfile: Dockerfile
commands:
  lint:
    command: eslint .
  migrate:
    command: npm run migrate
`,
        },
      });

      const project = loadProjectConfig(root);
      const web = project.services.entries.web;

      expect(web?.commands?.deploy?.dependencies).toEqual({
        backend: ["lint", "migrate"],
      });
    });
  });

  describe("Edge Cases", () => {
    it("handles services with only some commands defined", () => {
      const root = createProject({
        rootConfig: `
name: Test Project
services:
  dir: ./apps
`,
        services: {
          web: `
name: web
dockerfile: Dockerfile
commands:
  lint:
    command: eslint .
  foo:
    command: echo "foo"
`,
          backend: `
name: backend
dockerfile: Dockerfile
commands:
  lint:
    command: ruff check .
`,
        },
      });

      const project = loadProjectConfig(root);

      // web has both lint and foo, backend only has lint
      expect(project.services.entries.web?.commands?.lint).toEqual({
        command: "eslint .",
        dependencies: undefined,
        dir: undefined,
        env: undefined,
      });
      expect(project.services.entries.web?.commands?.foo).toEqual({
        command: 'echo "foo"',
        dependencies: undefined,
        dir: undefined,
        env: undefined,
      });
      expect(project.services.entries.backend?.commands?.lint).toEqual({
        command: "ruff check .",
        dependencies: undefined,
        dir: undefined,
        env: undefined,
      });
      expect(project.services.entries.backend?.commands?.foo).toBeUndefined();
    });

    it("handles service with no commands at all", () => {
      const root = createProject({
        rootConfig: `
name: Test Project
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
      expect(project.services.entries.db?.commands).toEqual({});
    });

    it("handles targets with glob patterns", () => {
      // This test documents behavior when glob patterns like packages/* are used
      // The glob resolution happens at a higher level, but buildExecutionPlan should work
      // with the resolved service list
      const root = createProject({
        rootConfig: `
name: Test Project
services:
  dir: ./apps
`,
        services: {
          "pkg-a": `
name: pkg-a
dockerfile: Dockerfile
commands:
  lint:
    command: eslint .
`,
          "pkg-b": `
name: pkg-b
dockerfile: Dockerfile
commands:
  lint:
    command: eslint .
`,
          "pkg-c": `
name: pkg-c
dockerfile: Dockerfile
commands:
  lint:
    command: eslint .
`,
        },
      });

      const project = loadProjectConfig(root);
      // Simulating resolved glob pattern
      const plan = buildExecutionPlan(project, "lint", [
        "pkg-a",
        "pkg-b",
        "pkg-c",
      ]);

      // All independent
      expect(plan.stages).toHaveLength(1);
      expect(plan.stages[0]).toHaveLength(3);
    });
  });

  describe("Subcommands", () => {
    it("loads subcommands from service nopo.yml", () => {
      const root = createProject({
        rootConfig: `
name: Test Project
services:
  dir: ./apps
`,
        services: {
          web: `
name: web
dockerfile: Dockerfile
commands:
  lint:
    commands:
      ts:
        command: tsc --noEmit
      eslint:
        command: eslint .
`,
        },
      });

      const project = loadProjectConfig(root);
      const web = project.services.entries.web;

      expect(web?.commands?.lint).toBeDefined();
      expect(web?.commands?.lint?.commands).toBeDefined();
      expect(web?.commands?.lint?.commands?.ts?.command).toBe("tsc --noEmit");
      expect(web?.commands?.lint?.commands?.eslint?.command).toBe("eslint .");
    });

    it("resolves all subcommands when running parent command", () => {
      const root = createProject({
        rootConfig: `
name: Test Project
services:
  dir: ./apps
`,
        services: {
          web: `
name: web
dockerfile: Dockerfile
commands:
  lint:
    commands:
      ts:
        command: tsc --noEmit
      eslint:
        command: eslint .
`,
        },
      });

      const project = loadProjectConfig(root);
      const resolved = resolveCommand(project, "lint", "web");

      // Should return both subcommands
      expect(resolved).toHaveLength(2);
      expect(resolved).toContainEqual({
        service: "web",
        command: "lint:ts",
        executable: "tsc --noEmit",
      });
      expect(resolved).toContainEqual({
        service: "web",
        command: "lint:eslint",
        executable: "eslint .",
      });
    });

    it("runs subcommands in parallel (same stage)", () => {
      const root = createProject({
        rootConfig: `
name: Test Project
services:
  dir: ./apps
`,
        services: {
          web: `
name: web
dockerfile: Dockerfile
commands:
  check:
    commands:
      types:
        command: tsc --noEmit
      lint:
        command: eslint .
      format:
        command: prettier --check .
`,
        },
      });

      const project = loadProjectConfig(root);
      const plan = buildExecutionPlan(project, "check", ["web"]);

      // All subcommands should be in same stage (parallel)
      expect(plan.stages).toHaveLength(1);
      expect(plan.stages[0]).toHaveLength(3);
    });

    it("supports nested subcommands (up to 3 levels)", () => {
      const root = createProject({
        rootConfig: `
name: Test Project
services:
  dir: ./apps
`,
        services: {
          web: `
name: web
dockerfile: Dockerfile
commands:
  check:
    commands:
      lint:
        commands:
          ts:
            command: tsc --noEmit
          js:
            command: eslint .
`,
        },
      });

      const project = loadProjectConfig(root);
      const resolved = resolveCommand(project, "check", "web");

      // Should flatten all nested subcommands
      expect(resolved).toHaveLength(2);
      expect(resolved).toContainEqual({
        service: "web",
        command: "check:lint:ts",
        executable: "tsc --noEmit",
      });
      expect(resolved).toContainEqual({
        service: "web",
        command: "check:lint:js",
        executable: "eslint .",
      });
    });

    it("can run specific subcommand directly", () => {
      const root = createProject({
        rootConfig: `
name: Test Project
services:
  dir: ./apps
`,
        services: {
          web: `
name: web
dockerfile: Dockerfile
commands:
  lint:
    commands:
      ts:
        command: tsc --noEmit
      eslint:
        command: eslint .
`,
        },
      });

      const project = loadProjectConfig(root);
      const resolved = resolveCommand(project, "lint:ts", "web");

      expect(resolved).toHaveLength(1);
      expect(resolved[0]).toEqual({
        service: "web",
        command: "lint:ts",
        executable: "tsc --noEmit",
      });
    });

    it("subcommands cannot define dependencies", () => {
      const root = createProject({
        rootConfig: `
name: Test Project
services:
  dir: ./apps
`,
        services: {
          web: `
name: web
dockerfile: Dockerfile
commands:
  lint:
    commands:
      ts:
        dependencies:
          - backend
        command: tsc --noEmit
`,
        },
      });

      // Should throw when loading config because subcommands can't have dependencies
      // The Zod schema catches this with "Expected never, received array"
      expect(() => loadProjectConfig(root)).toThrow();
    });

    it("parent command with subcommands cannot also have command field", () => {
      const root = createProject({
        rootConfig: `
name: Test Project
services:
  dir: ./apps
`,
        services: {
          web: `
name: web
dockerfile: Dockerfile
commands:
  lint:
    command: eslint .
    commands:
      ts:
        command: tsc --noEmit
`,
        },
      });

      // Should throw because can't have both command and commands
      expect(() => loadProjectConfig(root)).toThrow(
        /Cannot specify both 'command' and 'commands'/,
      );
    });

    it("handles mixed commands and subcommands", () => {
      const root = createProject({
        rootConfig: `
name: Test Project
services:
  dir: ./apps
`,
        services: {
          web: `
name: web
dockerfile: Dockerfile
commands:
  lint:
    command: eslint .
  check:
    commands:
      types:
        command: tsc --noEmit
      lint:
        command: eslint .
`,
        },
      });

      const project = loadProjectConfig(root);

      // build is a simple command
      const buildResolved = resolveCommand(project, "lint", "web");
      expect(buildResolved).toHaveLength(1);
      expect(buildResolved[0]).toEqual({
        service: "web",
        command: "lint",
        executable: "eslint .",
      });

      // check has subcommands
      const checkResolved = resolveCommand(project, "check", "web");
      expect(checkResolved).toHaveLength(2);
    });

    it("validates subcommand exists when running specific subcommand", () => {
      const root = createProject({
        rootConfig: `
name: Test Project
services:
  dir: ./apps
`,
        services: {
          web: `
name: web
dockerfile: Dockerfile
commands:
  lint:
    commands:
      ts:
        command: tsc --noEmit
`,
        },
      });

      const project = loadProjectConfig(root);

      expect(() => resolveCommand(project, "lint:nonexistent", "web")).toThrow(
        /Command 'lint:nonexistent' not found/,
      );
    });
  });

  describe("Root Service", () => {
    it("creates root service when root commands are defined", () => {
      const root = createProject({
        rootConfig: `
name: Test Project
services:
  dir: ./apps
root:
  commands:
    lint:
      command: eslint .
    check:
      commands:
        types: tsc --noEmit
        lint: eslint .
`,
        services: {
          web: `
name: web
dockerfile: Dockerfile
commands:
  lint:
    command: eslint .
`,
        },
      });

      const project = loadProjectConfig(root);

      // Root service should exist
      expect(project.services.entries.root).toBeDefined();
      expect(project.services.entries.root?.id).toBe("root");
      expect(project.services.entries.root?.name).toBe("Root");
      expect(project.services.entries.root?.commands?.lint?.command).toBe(
        "eslint .",
      );

      // Root should be in targets
      expect(project.services.targets).toContain("root");
      expect(project.rootName).toBe("root");
    });

    it("supports custom root_name", () => {
      const root = createProject({
        rootConfig: `
name: Test Project
services:
  dir: ./apps
root_name: workspace
root:
  commands:
    lint:
      command: eslint .
`,
        services: {
          web: `
name: web
dockerfile: Dockerfile
commands:
  lint:
    command: eslint .
`,
        },
      });

      const project = loadProjectConfig(root);

      expect(project.rootName).toBe("workspace");
      expect(project.services.entries.workspace).toBeDefined();
      expect(project.services.entries.root).toBeUndefined();
      expect(project.services.targets).toContain("workspace");
    });

    it("does not create root service when no root commands defined", () => {
      const root = createProject({
        rootConfig: `
name: Test Project
services:
  dir: ./apps
`,
        services: {
          web: `
name: web
dockerfile: Dockerfile
commands:
  lint:
    command: eslint .
`,
        },
      });

      const project = loadProjectConfig(root);

      expect(project.services.entries.root).toBeUndefined();
      expect(project.services.targets).not.toContain("root");
    });

    it("throws when root_name conflicts with service name", () => {
      const root = createProject({
        rootConfig: `
name: Test Project
services:
  dir: ./apps
root_name: web
root:
  commands:
    lint:
      command: eslint .
`,
        services: {
          web: `
name: web
dockerfile: Dockerfile
commands:
  lint:
    command: eslint .
`,
        },
      });

      expect(() => loadProjectConfig(root)).toThrow(
        /Service "web" conflicts with root_name/,
      );
    });

    it("throws when service has root in top-level dependencies", () => {
      const root = createProject({
        rootConfig: `
name: Test Project
services:
  dir: ./apps
root:
  commands:
    lint:
      command: eslint .
`,
        services: {
          web: `
name: web
dockerfile: Dockerfile
dependencies:
  - root
commands:
  lint:
    command: eslint .
`,
        },
      });

      expect(() => loadProjectConfig(root)).toThrow(
        /Service "web" cannot depend on "root" at service level/,
      );
    });

    it("allows root in command-level dependencies", () => {
      const root = createProject({
        rootConfig: `
name: Test Project
services:
  dir: ./apps
root:
  commands:
    lint:
      command: eslint .
`,
        services: {
          web: `
name: web
dockerfile: Dockerfile
commands:
  lint:
    dependencies:
      - root
    command: eslint .
`,
        },
      });

      // Should not throw
      const project = loadProjectConfig(root);
      expect(
        project.services.entries.web?.commands?.lint?.dependencies,
      ).toEqual(["root"]);
    });

    it("resolves root commands correctly", () => {
      const root = createProject({
        rootConfig: `
name: Test Project
services:
  dir: ./apps
root:
  commands:
    check:
      commands:
        lint: eslint .
        types: tsc --noEmit
`,
        services: {
          web: `
name: web
dockerfile: Dockerfile
commands:
  lint:
    command: eslint .
`,
        },
      });

      const project = loadProjectConfig(root);
      const resolved = resolveCommand(project, "check", "root");

      expect(resolved).toHaveLength(2);
      expect(resolved).toContainEqual({
        service: "root",
        command: "check:lint",
        executable: "eslint .",
      });
      expect(resolved).toContainEqual({
        service: "root",
        command: "check:types",
        executable: "tsc --noEmit",
      });
    });

    it("builds execution plan with root dependencies", () => {
      const root = createProject({
        rootConfig: `
name: Test Project
services:
  dir: ./apps
root:
  commands:
    lint:
      command: eslint .
`,
        services: {
          web: `
name: web
dockerfile: Dockerfile
commands:
  lint:
    dependencies:
      - root
    command: eslint .
`,
        },
      });

      const project = loadProjectConfig(root);
      const plan = buildExecutionPlan(project, "lint", ["web"]);

      // Root lint should run before web lint
      expect(plan.stages).toHaveLength(2);
      expect(plan.stages[0]).toContainEqual(
        expect.objectContaining({ service: "root", command: "lint" }),
      );
      expect(plan.stages[1]).toContainEqual(
        expect.objectContaining({ service: "web", command: "lint" }),
      );
    });

    it("can run root command directly", () => {
      const root = createProject({
        rootConfig: `
name: Test Project
services:
  dir: ./apps
root:
  commands:
    lint:
      command: eslint .
`,
        services: {
          web: `
name: web
dockerfile: Dockerfile
commands:
  lint:
    command: eslint .
`,
        },
      });

      const project = loadProjectConfig(root);
      const plan = buildExecutionPlan(project, "lint", ["root"]);

      expect(plan.stages).toHaveLength(1);
      expect(plan.stages[0]).toHaveLength(1);
      expect(plan.stages[0]![0]).toMatchObject({
        service: "root",
        command: "lint",
        executable: "eslint .",
      });
    });

    it("root service path is project root directory", () => {
      const root = createProject({
        rootConfig: `
name: Test Project
services:
  dir: ./apps
root:
  commands:
    lint:
      command: eslint .
`,
        services: {
          web: `
name: web
dockerfile: Dockerfile
commands:
  lint:
    command: eslint .
`,
        },
      });

      const project = loadProjectConfig(root);

      // Root service path should be the project root, not apps/root
      expect(project.services.entries.root?.paths.root).toBe(root);
    });
  });
});
