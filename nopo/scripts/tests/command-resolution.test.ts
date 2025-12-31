import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  loadProjectConfig,
  type NormalizedProjectConfig,
} from "../src/config/index.ts";
import {
  resolveCommandDependencies,
  buildExecutionPlan,
  validateCommandTargets,
  type ExecutionPlan,
  type CommandDependencySpec,
} from "../src/commands/index.ts";

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
  build:
    command: npm run build
`,
        },
      });

      const project = loadProjectConfig(root);
      const web = project.services.entries.web;

      expect(web?.commands).toBeDefined();
      expect(web?.commands?.lint).toBeDefined();
      expect(web?.commands?.lint?.command).toBe("eslint .");
      expect(web?.commands?.build?.command).toBe("npm run build");
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
  build:
    dependencies:
      - backend
    command: npm run build
`,
        },
      });

      const project = loadProjectConfig(root);
      const web = project.services.entries.web;

      expect(web?.commands?.build?.dependencies).toEqual(["backend"]);
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
  run:
    dependencies:
      web:
        - run
      backend:
        - build
        - clean
    command: npm start
`,
        },
      });

      const project = loadProjectConfig(root);
      const web = project.services.entries.web;

      expect(web?.commands?.run?.dependencies).toEqual({
        web: ["run"],
        backend: ["build", "clean"],
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
      expect(() => validateCommandTargets(project, "lint", ["web", "backend"])).not.toThrow();
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
      expect(() => validateCommandTargets(project, "lint", ["web", "backend"])).toThrow(
        /Service 'backend' does not define command 'lint'/
      );
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
      expect(() => validateCommandTargets(project, "lint", ["web"])).not.toThrow();
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
  build:
    dependencies:
      - backend
      - worker
    command: npm run build
`,
          api: `
name: api
dockerfile: Dockerfile
`,
          backend: `
name: backend
dockerfile: Dockerfile
commands:
  build:
    command: python setup.py build
`,
          worker: `
name: worker
dockerfile: Dockerfile
commands:
  build:
    command: cargo build
`,
        },
      });

      const project = loadProjectConfig(root);
      const deps = resolveCommandDependencies(project, "build", "web");

      // Should use command-specific dependencies, not service-level
      expect(deps).toContainEqual({ service: "backend", command: "build" });
      expect(deps).toContainEqual({ service: "worker", command: "build" });
      expect(deps).not.toContainEqual(expect.objectContaining({ service: "api" }));
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
  run:
    dependencies:
      backend:
        - build
        - clean
    command: npm start
`,
          backend: `
name: backend
dockerfile: Dockerfile
commands:
  build:
    command: npm run build
  clean:
    command: npm run clean
`,
        },
      });

      const project = loadProjectConfig(root);
      const deps = resolveCommandDependencies(project, "run", "web");

      expect(deps).toContainEqual({ service: "backend", command: "build" });
      expect(deps).toContainEqual({ service: "backend", command: "clean" });
    });

    it("skips dependencies that do not have the command defined", () => {
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
      const deps = resolveCommandDependencies(project, "lint", "web");

      // backend doesn't have lint command, so should not be included
      expect(deps).toEqual([]);
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
      expect(plan.stages[0]).toEqual([{ service: "web", command: "lint" }]);
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
      const plan = buildExecutionPlan(project, "lint", ["web", "backend", "worker"]);

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
      expect(plan.stages[0]).toContainEqual({ service: "backend", command: "lint" });
      expect(plan.stages[1]).toContainEqual({ service: "web", command: "lint" });
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
  build:
    command: npm run build
`,
          web: `
name: web
dockerfile: Dockerfile
dependencies:
  - shared
commands:
  build:
    command: npm run build
`,
          api: `
name: api
dockerfile: Dockerfile
dependencies:
  - shared
commands:
  build:
    command: npm run build
`,
          shared: `
name: shared
dockerfile: Dockerfile
commands:
  build:
    command: npm run build
`,
        },
      });

      const project = loadProjectConfig(root);
      const plan = buildExecutionPlan(project, "build", ["app"]);

      // shared first (stage 0), then web & api in parallel (stage 1), then app (stage 2)
      expect(plan.stages).toHaveLength(3);
      expect(plan.stages[0]).toContainEqual({ service: "shared", command: "build" });
      expect(plan.stages[1]).toHaveLength(2);
      expect(plan.stages[1]).toContainEqual({ service: "web", command: "build" });
      expect(plan.stages[1]).toContainEqual({ service: "api", command: "build" });
      expect(plan.stages[2]).toContainEqual({ service: "app", command: "build" });
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
  build:
    command: npm run build
`,
          api: `
name: api
dockerfile: Dockerfile
dependencies:
  - shared
commands:
  build:
    command: npm run build
`,
          shared: `
name: shared
dockerfile: Dockerfile
commands:
  build:
    command: npm run build
`,
        },
      });

      const project = loadProjectConfig(root);
      const plan = buildExecutionPlan(project, "build", ["web", "api"]);

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
  build:
    command: npm run build
`,
          api: `
name: api
dockerfile: Dockerfile
dependencies:
  - web
commands:
  build:
    command: npm run build
`,
        },
      });

      const project = loadProjectConfig(root);
      expect(() => buildExecutionPlan(project, "build", ["web"])).toThrow(
        /Circular dependency detected/
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
  build:
    dependencies:
      - backend
      - worker
    command: npm run build
`,
          backend: `
name: backend
dockerfile: Dockerfile
commands:
  build:
    command: python setup.py build
`,
          worker: `
name: worker
dockerfile: Dockerfile
commands:
  build:
    command: cargo build
`,
        },
      });

      const project = loadProjectConfig(root);
      const web = project.services.entries.web;

      // Array dependencies should be normalized to same command
      expect(web?.commands?.build?.dependencies).toEqual(["backend", "worker"]);
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
        - build
        - migrate
    command: npm run deploy
`,
          backend: `
name: backend
dockerfile: Dockerfile
commands:
  build:
    command: npm run build
  migrate:
    command: npm run migrate
`,
        },
      });

      const project = loadProjectConfig(root);
      const web = project.services.entries.web;

      expect(web?.commands?.deploy?.dependencies).toEqual({
        backend: ["build", "migrate"],
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
  build:
    command: npm run build
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

      // web has both lint and build, backend only has lint
      expect(project.services.entries.web?.commands?.lint).toBeDefined();
      expect(project.services.entries.web?.commands?.build).toBeDefined();
      expect(project.services.entries.backend?.commands?.lint).toBeDefined();
      expect(project.services.entries.backend?.commands?.build).toBeUndefined();
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
  build:
    command: echo a
`,
          b: `
name: b
dockerfile: Dockerfile
dependencies:
  - c
commands:
  build:
    command: echo b
`,
          c: `
name: c
dockerfile: Dockerfile
dependencies:
  - d
commands:
  build:
    command: echo c
`,
          d: `
name: d
dockerfile: Dockerfile
commands:
  build:
    command: echo d
`,
        },
      });

      const project = loadProjectConfig(root);
      const plan = buildExecutionPlan(project, "build", ["a"]);

      // d -> c -> b -> a
      expect(plan.stages).toHaveLength(4);
      expect(plan.stages[0]).toContainEqual({ service: "d", command: "build" });
      expect(plan.stages[1]).toContainEqual({ service: "c", command: "build" });
      expect(plan.stages[2]).toContainEqual({ service: "b", command: "build" });
      expect(plan.stages[3]).toContainEqual({ service: "a", command: "build" });
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
      const plan = buildExecutionPlan(project, "lint", ["pkg-a", "pkg-b", "pkg-c"]);

      // All independent
      expect(plan.stages).toHaveLength(1);
      expect(plan.stages[0]).toHaveLength(3);
    });
  });
});
