/**
 * Fixture Loader for Configurable Test Runner
 *
 * Loads scenarios from directory structure with NN-<state>.json files.
 * Validates all fixtures on load using Zod for fail-fast behavior.
 */

import * as fs from "fs";
import * as path from "path";
import * as core from "@actions/core";
import {
  StateFixtureSchema,
  ScenarioConfigSchema,
  ClaudeMockSchema,
  type StateFixture,
  type ClaudeMock,
  type StateName,
  type LoadedScenario,
} from "./types.js";

// ============================================================================
// Constants
// ============================================================================

const FIXTURES_BASE_PATH = ".github/test-fixtures";
const SCENARIOS_DIR = "scenarios";
const CLAUDE_MOCKS_DIR = "claude-mocks";
const STATES_DIR = "states";
const SCENARIO_CONFIG_FILE = "scenario.json";

// ============================================================================
// Loader Implementation
// ============================================================================

/**
 * Load a scenario from the test-fixtures directory
 *
 * @param scenarioName - Name of the scenario directory (e.g., "ci-failure-recovery")
 * @param basePath - Base path for fixtures (default: ".github/test-fixtures")
 * @returns Fully loaded scenario ready for execution
 * @throws Error if scenario or any fixture is invalid
 */
export async function loadScenario(
  scenarioName: string,
  basePath: string = FIXTURES_BASE_PATH,
): Promise<LoadedScenario> {
  const scenarioDir = path.join(basePath, SCENARIOS_DIR, scenarioName);

  // 1. Load scenario configuration
  const configPath = path.join(scenarioDir, SCENARIO_CONFIG_FILE);
  if (!fs.existsSync(configPath)) {
    throw new Error(
      `Scenario config not found: ${configPath}. Create a scenario.json file with name and description.`,
    );
  }

  const configContent = fs.readFileSync(configPath, "utf-8");
  const configJson = JSON.parse(configContent);
  const config = ScenarioConfigSchema.parse(configJson);

  core.info(`Loading scenario: ${config.name}`);
  core.info(`Description: ${config.description}`);

  // 2. Load state fixtures in order
  const statesDir = path.join(scenarioDir, STATES_DIR);
  if (!fs.existsSync(statesDir)) {
    throw new Error(
      `States directory not found: ${statesDir}. Create a states/ directory with fixture files.`,
    );
  }

  const { orderedStates, fixtures } = await loadStateFixtures(statesDir);

  if (orderedStates.length < 2) {
    throw new Error(
      `Scenario must have at least 2 state fixtures (got ${orderedStates.length}). ` +
        `The first is the starting state, the last is the final expected state.`,
    );
  }

  core.info(`Loaded ${orderedStates.length} state fixtures`);

  // 3. Load referenced Claude mocks
  const claudeMocks = await loadReferencedMocks(fixtures, basePath);
  core.info(`Loaded ${claudeMocks.size} Claude mocks`);

  return {
    name: config.name,
    description: config.description,
    orderedStates,
    fixtures,
    claudeMocks,
  };
}

/**
 * Load all state fixtures from a states directory
 *
 * Files must be named with format: NN-<state>.json (e.g., 01-iterating.json)
 * The NN prefix determines ordering, the state name is extracted after the dash.
 */
async function loadStateFixtures(statesDir: string): Promise<{
  orderedStates: StateName[];
  fixtures: Map<StateName, StateFixture>;
}> {
  const files = fs
    .readdirSync(statesDir)
    .filter((f) => f.endsWith(".json"))
    .sort(); // Sort by filename (01-, 02-, etc.)

  const orderedStates: StateName[] = [];
  const fixtures = new Map<StateName, StateFixture>();

  for (const file of files) {
    const filePath = path.join(statesDir, file);
    const content = fs.readFileSync(filePath, "utf-8");

    let json: unknown;
    try {
      json = JSON.parse(content);
    } catch (error) {
      throw new Error(
        `Invalid JSON in ${file}: ${error instanceof Error ? error.message : error}`,
      );
    }

    // Validate with Zod - fail fast if invalid
    const parseResult = StateFixtureSchema.safeParse(json);
    if (!parseResult.success) {
      const errors = parseResult.error.errors
        .map((e) => `  ${e.path.join(".")}: ${e.message}`)
        .join("\n");
      throw new Error(`Invalid state fixture ${file}:\n${errors}`);
    }

    const fixture = parseResult.data;

    // Check for duplicate states
    if (fixtures.has(fixture.state)) {
      throw new Error(
        `Duplicate state '${fixture.state}' in ${file}. Each state can only appear once in a scenario.`,
      );
    }

    orderedStates.push(fixture.state);
    fixtures.set(fixture.state, fixture);

    core.debug(`  Loaded: ${file} -> state '${fixture.state}'`);
  }

  return { orderedStates, fixtures };
}

/**
 * Load all Claude mocks referenced by fixtures
 *
 * Mocks are referenced via claudeMock field with format: "<type>/<name>"
 * e.g., "iterate/broken-code" loads from claude-mocks/iterate/broken-code.json
 */
async function loadReferencedMocks(
  fixtures: Map<StateName, StateFixture>,
  basePath: string,
): Promise<Map<string, ClaudeMock>> {
  const claudeMocks = new Map<string, ClaudeMock>();
  const mocksDir = path.join(basePath, CLAUDE_MOCKS_DIR);

  for (const [state, fixture] of fixtures) {
    if (!fixture.claudeMock) continue;

    // Already loaded?
    if (claudeMocks.has(fixture.claudeMock)) continue;

    const mockPath = path.join(mocksDir, `${fixture.claudeMock}.json`);
    if (!fs.existsSync(mockPath)) {
      throw new Error(
        `Claude mock not found: ${mockPath} (referenced by state '${state}')`,
      );
    }

    const content = fs.readFileSync(mockPath, "utf-8");
    let json: unknown;
    try {
      json = JSON.parse(content);
    } catch (error) {
      throw new Error(
        `Invalid JSON in ${mockPath}: ${error instanceof Error ? error.message : error}`,
      );
    }

    const parseResult = ClaudeMockSchema.safeParse(json);
    if (!parseResult.success) {
      const errors = parseResult.error.errors
        .map((e) => `  ${e.path.join(".")}: ${e.message}`)
        .join("\n");
      throw new Error(`Invalid Claude mock ${fixture.claudeMock}:\n${errors}`);
    }

    claudeMocks.set(fixture.claudeMock, parseResult.data);
    core.debug(`  Loaded mock: ${fixture.claudeMock}`);
  }

  return claudeMocks;
}

/**
 * List all available scenarios
 */
export async function listScenarios(
  basePath: string = FIXTURES_BASE_PATH,
): Promise<string[]> {
  const scenariosDir = path.join(basePath, SCENARIOS_DIR);

  if (!fs.existsSync(scenariosDir)) {
    return [];
  }

  const entries = fs.readdirSync(scenariosDir, { withFileTypes: true });
  const scenarios: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const configPath = path.join(
      scenariosDir,
      entry.name,
      SCENARIO_CONFIG_FILE,
    );
    if (fs.existsSync(configPath)) {
      scenarios.push(entry.name);
    }
  }

  return scenarios.sort();
}

/**
 * Validate a scenario without fully loading it
 * Useful for CI checks to ensure fixtures are valid
 */
export async function validateScenario(
  scenarioName: string,
  basePath: string = FIXTURES_BASE_PATH,
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];

  try {
    await loadScenario(scenarioName, basePath);
    return { valid: true, errors: [] };
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    return { valid: false, errors };
  }
}
