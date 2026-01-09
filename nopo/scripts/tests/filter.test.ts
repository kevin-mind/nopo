import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseFilterExpression,
  matchesFilter,
  getFieldValue,
  applyFilters,
  applyFiltersToNames,
  type FilterExpression,
  type FilterContext,
} from "../src/filter.ts";
import type { NormalizedService } from "../src/config/index.ts";

// Mock the GitInfo module
vi.mock("../src/git-info.ts", () => ({
  GitInfo: {
    getDefaultBranch: vi.fn(() => "main"),
    getChangedFiles: vi.fn(() => ["apps/backend/src/index.ts"]),
  },
}));

// Helper to create a minimal NormalizedService for testing
function createMockService(
  overrides: Partial<NormalizedService> = {},
): NormalizedService {
  return {
    id: "test",
    name: "Test Service",
    description: "",
    staticPath: "build",
    infrastructure: {
      cpu: "1",
      memory: "512Mi",
      port: 3000,
      minInstances: 0,
      maxInstances: 10,
      hasDatabase: false,
      runMigrations: false,
    },
    configPath: "/path/to/nopo.yml",
    dependencies: [],
    commands: {},
    paths: {
      root: "/project/apps/test",
      dockerfile: "/project/apps/test/Dockerfile",
      context: "/project",
    },
    ...overrides,
  };
}

describe("parseFilterExpression", () => {
  it("parses buildable preset", () => {
    const result = parseFilterExpression("buildable");
    expect(result).toEqual({ type: "preset", field: "buildable" });
  });

  it("parses changed preset", () => {
    const result = parseFilterExpression("changed");
    expect(result).toEqual({ type: "preset", field: "changed" });
  });

  it("parses negation expression", () => {
    const result = parseFilterExpression("!image");
    expect(result).toEqual({ type: "not_exists", field: "image" });
  });

  it("parses equality expression", () => {
    const result = parseFilterExpression("infrastructure.cpu=2");
    expect(result).toEqual({
      type: "equals",
      field: "infrastructure.cpu",
      value: "2",
    });
  });

  it("parses equality with multiple equals signs", () => {
    const result = parseFilterExpression("field=value=with=equals");
    expect(result).toEqual({
      type: "equals",
      field: "field",
      value: "value=with=equals",
    });
  });

  it("parses field existence check", () => {
    const result = parseFilterExpression("image");
    expect(result).toEqual({ type: "exists", field: "image" });
  });
});

describe("getFieldValue", () => {
  const service = createMockService({
    infrastructure: {
      cpu: "2",
      memory: "1Gi",
      port: 8080,
      minInstances: 1,
      maxInstances: 5,
      hasDatabase: true,
      runMigrations: true,
    },
  });

  it("gets top-level field", () => {
    expect(getFieldValue(service, "name")).toBe("Test Service");
  });

  it("gets nested field with dot notation", () => {
    expect(getFieldValue(service, "infrastructure.cpu")).toBe("2");
    expect(getFieldValue(service, "infrastructure.hasDatabase")).toBe(true);
  });

  it("returns undefined for non-existent field", () => {
    expect(getFieldValue(service, "nonexistent")).toBeUndefined();
    expect(getFieldValue(service, "infrastructure.nonexistent")).toBeUndefined();
  });

  it("returns undefined for invalid path on non-object", () => {
    expect(getFieldValue(service, "name.nested")).toBeUndefined();
  });
});

describe("matchesFilter", () => {
  const context: FilterContext = {
    projectRoot: "/project",
  };

  describe("preset filters", () => {
    it("matches buildable preset for services with dockerfile", () => {
      const service = createMockService();
      const filter: FilterExpression = { type: "preset", field: "buildable" };
      expect(matchesFilter(service, filter, context)).toBe(true);
    });

    it("does not match buildable preset for services without dockerfile", () => {
      const service = createMockService({
        image: "postgres:16",
        paths: {
          root: "/project/apps/db",
          dockerfile: undefined,
          context: "/project",
        },
      });
      const filter: FilterExpression = { type: "preset", field: "buildable" };
      expect(matchesFilter(service, filter, context)).toBe(false);
    });

    it("matches changed preset for services with changed files", () => {
      const service = createMockService({
        paths: {
          root: "/project/apps/backend",
          dockerfile: "/project/apps/backend/Dockerfile",
          context: "/project",
        },
      });
      const filter: FilterExpression = { type: "preset", field: "changed" };
      expect(matchesFilter(service, filter, context)).toBe(true);
    });

    it("does not match changed preset for services without changed files", () => {
      const service = createMockService({
        paths: {
          root: "/project/apps/web",
          dockerfile: "/project/apps/web/Dockerfile",
          context: "/project",
        },
      });
      const filter: FilterExpression = { type: "preset", field: "changed" };
      expect(matchesFilter(service, filter, context)).toBe(false);
    });
  });

  describe("exists filter", () => {
    it("matches when field exists", () => {
      const service = createMockService({ image: "postgres:16" });
      const filter: FilterExpression = { type: "exists", field: "image" };
      expect(matchesFilter(service, filter, context)).toBe(true);
    });

    it("does not match when field is undefined", () => {
      const service = createMockService();
      const filter: FilterExpression = { type: "exists", field: "image" };
      expect(matchesFilter(service, filter, context)).toBe(false);
    });
  });

  describe("not_exists filter", () => {
    it("matches when field does not exist", () => {
      const service = createMockService();
      const filter: FilterExpression = { type: "not_exists", field: "image" };
      expect(matchesFilter(service, filter, context)).toBe(true);
    });

    it("does not match when field exists", () => {
      const service = createMockService({ image: "postgres:16" });
      const filter: FilterExpression = { type: "not_exists", field: "image" };
      expect(matchesFilter(service, filter, context)).toBe(false);
    });
  });

  describe("equals filter", () => {
    it("matches when field equals value", () => {
      const service = createMockService();
      const filter: FilterExpression = {
        type: "equals",
        field: "infrastructure.cpu",
        value: "1",
      };
      expect(matchesFilter(service, filter, context)).toBe(true);
    });

    it("does not match when field has different value", () => {
      const service = createMockService();
      const filter: FilterExpression = {
        type: "equals",
        field: "infrastructure.cpu",
        value: "2",
      };
      expect(matchesFilter(service, filter, context)).toBe(false);
    });

    it("does not match when field does not exist", () => {
      const service = createMockService();
      const filter: FilterExpression = {
        type: "equals",
        field: "nonexistent",
        value: "value",
      };
      expect(matchesFilter(service, filter, context)).toBe(false);
    });

    it("converts non-string values for comparison", () => {
      const service = createMockService();
      const filter: FilterExpression = {
        type: "equals",
        field: "infrastructure.port",
        value: "3000",
      };
      expect(matchesFilter(service, filter, context)).toBe(true);
    });
  });
});

describe("applyFilters", () => {
  const context: FilterContext = { projectRoot: "/project" };

  const services: NormalizedService[] = [
    createMockService({
      id: "backend",
      paths: {
        root: "/project/apps/backend",
        dockerfile: "/project/apps/backend/Dockerfile",
        context: "/project",
      },
    }),
    createMockService({
      id: "web",
      paths: {
        root: "/project/apps/web",
        dockerfile: "/project/apps/web/Dockerfile",
        context: "/project",
      },
    }),
    createMockService({
      id: "db",
      image: "postgres:16",
      paths: {
        root: "/project/apps/db",
        dockerfile: undefined,
        context: "/project",
      },
    }),
  ];

  it("returns all services when no filters", () => {
    const result = applyFilters(services, [], context);
    expect(result).toHaveLength(3);
  });

  it("filters by single expression", () => {
    const filters: FilterExpression[] = [{ type: "preset", field: "buildable" }];
    const result = applyFilters(services, filters, context);
    expect(result).toHaveLength(2);
    expect(result.map((s) => s.id)).toEqual(["backend", "web"]);
  });

  it("applies multiple filters with AND logic", () => {
    const filters: FilterExpression[] = [
      { type: "preset", field: "buildable" },
      { type: "preset", field: "changed" },
    ];
    const result = applyFilters(services, filters, context);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("backend");
  });
});

describe("applyFiltersToNames", () => {
  const context: FilterContext = { projectRoot: "/project" };

  const services: Record<string, NormalizedService> = {
    backend: createMockService({
      id: "backend",
      paths: {
        root: "/project/apps/backend",
        dockerfile: "/project/apps/backend/Dockerfile",
        context: "/project",
      },
    }),
    web: createMockService({
      id: "web",
      paths: {
        root: "/project/apps/web",
        dockerfile: "/project/apps/web/Dockerfile",
        context: "/project",
      },
    }),
    db: createMockService({
      id: "db",
      image: "postgres:16",
      paths: {
        root: "/project/apps/db",
        dockerfile: undefined,
        context: "/project",
      },
    }),
  };

  const serviceNames = ["backend", "web", "db"];

  it("returns all names when no filters", () => {
    const result = applyFiltersToNames(serviceNames, services, [], context);
    expect(result).toEqual(serviceNames);
  });

  it("filters names by expression", () => {
    const filters: FilterExpression[] = [{ type: "preset", field: "buildable" }];
    const result = applyFiltersToNames(serviceNames, services, filters, context);
    expect(result).toEqual(["backend", "web"]);
  });

  it("handles unknown service names gracefully", () => {
    const filters: FilterExpression[] = [{ type: "preset", field: "buildable" }];
    const result = applyFiltersToNames(
      ["backend", "unknown"],
      services,
      filters,
      context,
    );
    expect(result).toEqual(["backend"]);
  });
});
