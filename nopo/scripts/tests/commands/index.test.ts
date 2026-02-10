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

    it("resolves service-level dependencies", () => {
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
commands:
  lint:
    command: ruff check .
`,
        },
      });

      const project = loadProjectConfig(root);
      const deps = resolveCommandDependencies(project, "lint", "web");

      expect(deps).toEqual([{ service: "backend", command: "lint" }]);
    });

    it("resolves nested dependencies", () => {
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
dependencies:
  - db
commands:
  lint:
    command: ruff check .
`,
          db: `
name: db
image: postgres:16
commands:
  lint:
    command: echo "no lint for db"
`,
        },
      });

      const project = loadProjectConfig(root);
      const deps = resolveCommandDependencies(project, "lint", "web");

      // Should include both backend and db (transitively)
      expect(deps).toContainEqual({ service: "backend", command: "lint" });
      expect(deps).toContainEqual({ service: "db", command: "lint" });
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

    it("throws when dependency does not have the command defined", () => {
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

      // backend doesn't have lint command, so should error
      expect(() => resolveCommandDependencies(project, "lint", "web")).toThrow(
        /Service 'backend' does not define command 'lint'/,
      );
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

    it("orders dependent services in correct stages", () => {
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
commands:
  lint:
    command: ruff check .
`,
        },
      });

      const project = loadProjectConfig(root);
      const plan = buildExecutionPlan(project, "lint", ["web"]);

      // backend first, then web
      expect(plan.stages).toHaveLength(2);
      expect(plan.stages[0]).toContainEqual(
        expect.objectContaining({ service: "backend", command: "lint" }),
      );
      expect(plan.stages[1]).toContainEqual(
        expect.objectContaining({ service: "web", command: "lint" }),
      );
    });

    it("handles diamond dependencies correctly", () => {
      const root = createProject({
        rootConfig: `
name: Test Project
services:
  dir: ./apps
`,
        services: {
          app: `
name: app
dockerfile: Dockerfile
dependencies:
  - web
  - api
commands:
  lint:
    command: eslint .
`,
          web: `
name: web
dockerfile: Dockerfile
dependencies:
  - shared
commands:
  lint:
    command: eslint .
`,
          api: `
name: api
dockerfile: Dockerfile
dependencies:
  - shared
commands:
  lint:
    command: eslint .
`,
          shared: `
name: shared
dockerfile: Dockerfile
commands:
  lint:
    command: eslint .
`,
        },
      });

      const project = loadProjectConfig(root);
      const plan = buildExecutionPlan(project, "lint", ["app"]);

      // shared first (stage 0), then web & api in parallel (stage 1), then app (stage 2)
      expect(plan.stages).toHaveLength(3);
      expect(plan.stages[0]).toContainEqual(
        expect.objectContaining({ service: "shared", command: "lint" }),
      );
      expect(plan.stages[1]).toHaveLength(2);
      expect(plan.stages[1]).toContainEqual(
        expect.objectContaining({ service: "web", command: "lint" }),
      );
      expect(plan.stages[1]).toContainEqual(
        expect.objectContaining({ service: "api", command: "lint" }),
      );
      expect(plan.stages[2]).toContainEqual(
        expect.objectContaining({ service: "app", command: "lint" }),
      );
    });

    it("deduplicates services across multiple targets", () => {
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
  - shared
commands:
  lint:
    command: eslint .
`,
          api: `
name: api
dockerfile: Dockerfile
dependencies:
  - shared
commands:
  lint:
    command: eslint .
`,
          shared: `
name: shared
dockerfile: Dockerfile
commands:
  lint:
    command: eslint .
`,
        },
      });

      const project = loadProjectConfig(root);
      const plan = buildExecutionPlan(project, "lint", ["web", "api"]);

      // shared should appear only once
      const allTasks = plan.stages.flat();
      const sharedTasks = allTasks.filter((t) => t.service === "shared");
      expect(sharedTasks).toHaveLength(1);
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

    it("handles circular dependency detection", () => {
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
    command: eslint .
`,
          api: `
name: api
dockerfile: Dockerfile
dependencies:
  - web
commands:
  lint:
    command: eslint .
`,
        },
      });

      const project = loadProjectConfig(root);
      expect(() => buildExecutionPlan(project, "lint", ["web"])).toThrow(
        /Circular dependency detected/,
      );
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

    it("handles deeply nested dependencies", () => {
      const root = createProject({
        rootConfig: `
name: Test Project
services:
  dir: ./apps
`,
        services: {
          a: `
name: a
dockerfile: Dockerfile
dependencies:
  - b
commands:
  lint:
    command: echo a
`,
          b: `
name: b
dockerfile: Dockerfile
dependencies:
  - c
commands:
  lint:
    command: echo b
`,
          c: `
name: c
dockerfile: Dockerfile
dependencies:
  - d
commands:
  lint:
    command: echo c
`,
          d: `
name: d
dockerfile: Dockerfile
commands:
  lint:
    command: echo d
`,
        },
      });

      const project = loadProjectConfig(root);
      const plan = buildExecutionPlan(project, "lint", ["a"]);

      // d -> c -> b -> a
      expect(plan.stages).toHaveLength(4);
      expect(plan.stages[0]).toContainEqual(
        expect.objectContaining({ service: "d", command: "lint" }),
      );
      expect(plan.stages[1]).toContainEqual(
        expect.objectContaining({ service: "c", command: "lint" }),
      );
      expect(plan.stages[2]).toContainEqual(
        expect.objectContaining({ service: "b", command: "lint" }),
      );
      expect(plan.stages[3]).toContainEqual(
        expect.objectContaining({ service: "a", command: "lint" }),
      );
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

  describe("Context-specific dependencies (build.depends_on/runtime.depends_on)", () => {
    it("uses build.depends_on for build commands (compile)", () => {
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
build:
  depends_on:
    - prompts
commands:
  compile:
    command: npm run compile
`,
          backend: `
name: backend
dockerfile: Dockerfile
commands:
  compile:
    command: python -m compileall .
`,
          prompts: `
name: prompts
dockerfile: Dockerfile
commands:
  compile:
    command: echo "compile prompts"
`,
          db: `
name: db
image: postgres:16
`,
        },
      });

      const project = loadProjectConfig(root);
      const deps = resolveCommandDependencies(project, "compile", "web");

      // Should use build.depends_on (only prompts), not service dependencies (backend, db)
      expect(deps).toHaveLength(1);
      expect(deps).toContainEqual({ service: "prompts", command: "compile" });
      expect(deps).not.toContainEqual(
        expect.objectContaining({ service: "backend" }),
      );
      expect(deps).not.toContainEqual(expect.objectContaining({ service: "db" }));
    });

    it("uses build.depends_on for test commands", () => {
      const root = createProject({
        rootConfig: `
name: Test Project
services:
  dir: ./apps
`,
        services: {
          api: `
name: api
dockerfile: Dockerfile
dependencies:
  - db
build:
  depends_on:
    - shared
commands:
  test:
    command: npm test
`,
          shared: `
name: shared
dockerfile: Dockerfile
commands:
  test:
    command: npm test
`,
          db: `
name: db
image: postgres:16
`,
        },
      });

      const project = loadProjectConfig(root);
      const deps = resolveCommandDependencies(project, "test", "api");

      // test is a build command, should use build.depends_on
      expect(deps).toHaveLength(1);
      expect(deps).toContainEqual({ service: "shared", command: "test" });
      expect(deps).not.toContainEqual(expect.objectContaining({ service: "db" }));
    });

    it("uses build.depends_on for check commands", () => {
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
build:
  depends_on:
    - ui
commands:
  check:
    commands:
      lint: eslint .
      types: tsc --noEmit
`,
          ui: `
name: ui
dockerfile: Dockerfile
commands:
  check:
    commands:
      lint: eslint .
`,
          backend: `
name: backend
dockerfile: Dockerfile
`,
        },
      });

      const project = loadProjectConfig(root);
      const deps = resolveCommandDependencies(project, "check", "web");

      // check is a build command, should use build.depends_on
      expect(deps).toHaveLength(1);
      expect(deps).toContainEqual({ service: "ui", command: "check" });
    });

    it("uses runtime.depends_on for runtime commands (dev)", () => {
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
  - prompts
runtime:
  depends_on:
    - backend
    - db
commands:
  dev:
    command: npm run dev
`,
          backend: `
name: backend
dockerfile: Dockerfile
commands:
  dev:
    command: python manage.py runserver
`,
          db: `
name: db
image: postgres:16
commands:
  dev:
    command: echo "db is running"
`,
          prompts: `
name: prompts
dockerfile: Dockerfile
`,
        },
      });

      const project = loadProjectConfig(root);
      const deps = resolveCommandDependencies(project, "dev", "web");

      // Should use runtime.depends_on (backend, db), not service dependencies (includes prompts)
      expect(deps).toHaveLength(2);
      expect(deps).toContainEqual({ service: "backend", command: "dev" });
      expect(deps).toContainEqual({ service: "db", command: "dev" });
      expect(deps).not.toContainEqual(
        expect.objectContaining({ service: "prompts" }),
      );
    });

    it("uses runtime.depends_on for start commands", () => {
      const root = createProject({
        rootConfig: `
name: Test Project
services:
  dir: ./apps
`,
        services: {
          app: `
name: app
dockerfile: Dockerfile
dependencies:
  - api
  - cache
  - shared
runtime:
  depends_on:
    - api
    - cache
commands:
  start:
    command: node server.js
`,
          api: `
name: api
dockerfile: Dockerfile
commands:
  start:
    command: node api.js
`,
          cache: `
name: cache
image: redis:alpine
commands:
  start:
    command: redis-server
`,
          shared: `
name: shared
dockerfile: Dockerfile
`,
        },
      });

      const project = loadProjectConfig(root);
      const deps = resolveCommandDependencies(project, "start", "app");

      // start is a runtime command, should use runtime.depends_on
      expect(deps).toHaveLength(2);
      expect(deps).toContainEqual({ service: "api", command: "start" });
      expect(deps).toContainEqual({ service: "cache", command: "start" });
      expect(deps).not.toContainEqual(
        expect.objectContaining({ service: "shared" }),
      );
    });

    it("falls back to service.dependencies when build.depends_on is empty", () => {
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
build:
  depends_on: []
commands:
  compile:
    command: npm run compile
`,
          backend: `
name: backend
dockerfile: Dockerfile
commands:
  compile:
    command: python setup.py build
`,
        },
      });

      const project = loadProjectConfig(root);
      const deps = resolveCommandDependencies(project, "compile", "web");

      // build.depends_on is empty array, should fall back to service.dependencies
      expect(deps).toHaveLength(1);
      expect(deps).toContainEqual({ service: "backend", command: "compile" });
    });

    it("falls back to service.dependencies when runtime.depends_on is empty", () => {
      const root = createProject({
        rootConfig: `
name: Test Project
services:
  dir: ./apps
`,
        services: {
          app: `
name: app
dockerfile: Dockerfile
dependencies:
  - api
runtime:
  depends_on: []
commands:
  dev:
    command: npm run dev
`,
          api: `
name: api
dockerfile: Dockerfile
commands:
  dev:
    command: node api.js
`,
        },
      });

      const project = loadProjectConfig(root);
      const deps = resolveCommandDependencies(project, "dev", "app");

      // runtime.depends_on is empty array, should fall back to service.dependencies
      expect(deps).toHaveLength(1);
      expect(deps).toContainEqual({ service: "api", command: "dev" });
    });

    it("handles empty object {} for depends_on (no dependencies)", () => {
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
build:
  depends_on: {}
commands:
  compile:
    command: npm run compile
`,
          backend: `
name: backend
dockerfile: Dockerfile
`,
        },
      });

      const project = loadProjectConfig(root);
      const deps = resolveCommandDependencies(project, "compile", "web");

      // Empty object {} means no dependencies
      expect(deps).toEqual([]);
    });

    it("isBuildCommand correctly identifies build commands", () => {
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
  - runtime-dep
build:
  depends_on:
    - build-dep
commands:
  build:
    command: npm run build
  compile:
    command: tsc
  test:
    command: npm test
  check:
    command: npm run check
  lint:
    command: eslint .
  format:
    command: prettier --write .
  types:
    command: tsc --noEmit
  typecheck:
    command: tsc --noEmit
  clean:
    command: rm -rf dist
`,
          "build-dep": `
name: build-dep
dockerfile: Dockerfile
commands:
  build:
    command: echo "build"
  compile:
    command: echo "compile"
  test:
    command: echo "test"
  check:
    command: echo "check"
  lint:
    command: echo "lint"
  format:
    command: echo "format"
  types:
    command: echo "types"
  typecheck:
    command: echo "typecheck"
  clean:
    command: echo "clean"
`,
          "runtime-dep": `
name: runtime-dep
dockerfile: Dockerfile
`,
        },
      });

      const project = loadProjectConfig(root);

      // All these should use build.depends_on (build-dep)
      const buildCommands = [
        "build",
        "compile",
        "test",
        "check",
        "lint",
        "format",
        "types",
        "typecheck",
        "clean",
      ];

      for (const cmd of buildCommands) {
        const deps = resolveCommandDependencies(project, cmd, "web");
        expect(deps).toHaveLength(1);
        expect(deps[0]?.service).toBe("build-dep");
      }
    });

    it("isBuildCommand correctly identifies runtime commands", () => {
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
  - build-dep
runtime:
  depends_on:
    - runtime-dep
commands:
  dev:
    command: npm run dev
  start:
    command: node server.js
  run:
    command: npm start
  serve:
    command: npx serve dist
`,
          "runtime-dep": `
name: runtime-dep
dockerfile: Dockerfile
commands:
  dev:
    command: echo "dev"
  start:
    command: echo "start"
  run:
    command: echo "run"
  serve:
    command: echo "serve"
`,
          "build-dep": `
name: build-dep
dockerfile: Dockerfile
`,
        },
      });

      const project = loadProjectConfig(root);

      // All these should use runtime.depends_on (runtime-dep)
      const runtimeCommands = ["dev", "start", "run", "serve"];

      for (const cmd of runtimeCommands) {
        const deps = resolveCommandDependencies(project, cmd, "web");
        expect(deps).toHaveLength(1);
        expect(deps[0]?.service).toBe("runtime-dep");
      }
    });

    it("command-specific dependencies override context-specific dependencies", () => {
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
  - service-dep
build:
  depends_on:
    - build-dep
runtime:
  depends_on:
    - runtime-dep
commands:
  compile:
    dependencies:
      - custom-dep
    command: npm run compile
`,
          "custom-dep": `
name: custom-dep
dockerfile: Dockerfile
commands:
  compile:
    command: echo "custom compile"
`,
          "build-dep": `
name: build-dep
dockerfile: Dockerfile
`,
          "runtime-dep": `
name: runtime-dep
dockerfile: Dockerfile
`,
          "service-dep": `
name: service-dep
dockerfile: Dockerfile
`,
        },
      });

      const project = loadProjectConfig(root);
      const deps = resolveCommandDependencies(project, "compile", "web");

      // Command-specific dependencies should override build.depends_on
      expect(deps).toHaveLength(1);
      expect(deps).toContainEqual({ service: "custom-dep", command: "compile" });
      expect(deps).not.toContainEqual(
        expect.objectContaining({ service: "build-dep" }),
      );
    });

    it("handles object format for build.depends_on", () => {
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
build:
  depends_on:
    ui:
      - compile
      - test
commands:
  compile:
    command: npm run compile
`,
          ui: `
name: ui
dockerfile: Dockerfile
commands:
  compile:
    command: npm run compile
  test:
    command: npm test
`,
        },
      });

      const project = loadProjectConfig(root);
      const deps = resolveCommandDependencies(project, "compile", "web");

      // Object format: ui has specific commands (compile, test)
      // For compile command on web, it should depend on ui:compile
      expect(deps).toContainEqual({ service: "ui", command: "compile" });
    });

    it("resolves transitive dependencies using context-specific depends_on", () => {
      const root = createProject({
        rootConfig: `
name: Test Project
services:
  dir: ./apps
`,
        services: {
          app: `
name: app
dockerfile: Dockerfile
build:
  depends_on:
    - web
commands:
  compile:
    command: npm run compile
`,
          web: `
name: web
dockerfile: Dockerfile
build:
  depends_on:
    - ui
commands:
  compile:
    command: npm run compile
`,
          ui: `
name: ui
dockerfile: Dockerfile
commands:
  compile:
    command: npm run compile
`,
        },
      });

      const project = loadProjectConfig(root);
      const deps = resolveCommandDependencies(project, "compile", "app");

      // Should resolve transitively: app -> web -> ui
      expect(deps).toHaveLength(2);
      expect(deps).toContainEqual({ service: "web", command: "compile" });
      expect(deps).toContainEqual({ service: "ui", command: "compile" });
    });
  });
});
