/**
 * Discussion Fixture Loader for Configurable Test Runner
 *
 * Loads discussion scenarios from directory structure with NN-<state>.json files.
 * Validates all fixtures on load using Zod for fail-fast behavior.
 */

import * as fs from "fs";
import * as path from "path";
import * as core from "@actions/core";
import {
  DiscussionStateFixtureSchema,
  DiscussionScenarioConfigSchema,
  DiscussionClaudeMockSchema,
  type DiscussionStateFixture,
  type DiscussionClaudeMock,
  type DiscussionStateName,
  type LoadedDiscussionScenario,
} from "./discussion-types.js";

// ============================================================================
// Constants
// ============================================================================

const FIXTURES_BASE_PATH =
  "packages/statemachine/actions/sm-test-runner/fixtures/discussion";
const DISCUSSION_SCENARIOS_DIR = "scenarios";
const CLAUDE_MOCKS_DIR = "mocks";
const STATES_DIR = "states";
const SCENARIO_CONFIG_FILE = "scenario.json";

// ============================================================================
// Loader Implementation
// ============================================================================

/**
 * Load a discussion scenario from the test-fixtures directory
 *
 * @param scenarioName - Name of the scenario directory (e.g., "discussion-research")
 * @param basePath - Base path for fixtures (default: ".github/test-fixtures")
 * @returns Fully loaded scenario ready for execution
 * @throws Error if scenario or any fixture is invalid
 */
export async function loadDiscussionScenario(
  scenarioName: string,
  basePath: string = FIXTURES_BASE_PATH,
): Promise<LoadedDiscussionScenario> {
  const scenarioDir = path.join(
    basePath,
    DISCUSSION_SCENARIOS_DIR,
    scenarioName,
  );

  // 1. Load scenario configuration
  const configPath = path.join(scenarioDir, SCENARIO_CONFIG_FILE);
  if (!fs.existsSync(configPath)) {
    throw new Error(
      `Discussion scenario config not found: ${configPath}. Create a scenario.json file with name and description.`,
    );
  }

  const configContent = fs.readFileSync(configPath, "utf-8");
  const configJson = JSON.parse(configContent);
  const config = DiscussionScenarioConfigSchema.parse(configJson);

  core.info(`Loading discussion scenario: ${config.name}`);
  core.info(`Description: ${config.description}`);

  // 2. Load state fixtures in order
  const statesDir = path.join(scenarioDir, STATES_DIR);
  if (!fs.existsSync(statesDir)) {
    throw new Error(
      `States directory not found: ${statesDir}. Create a states/ directory with fixture files.`,
    );
  }

  const { orderedStates, fixtures } =
    await loadDiscussionStateFixtures(statesDir);

  if (orderedStates.length < 1) {
    throw new Error(
      `Discussion scenario must have at least 1 state fixture (got ${orderedStates.length}).`,
    );
  }

  core.info(`Loaded ${orderedStates.length} state fixtures`);

  // 3. Load referenced Claude mocks
  const claudeMocks = await loadReferencedMocks(fixtures, basePath);
  core.info(`Loaded ${claudeMocks.size} Claude mocks`);

  return {
    name: config.name,
    description: config.description,
    category: config.category,
    orderedStates,
    fixtures,
    claudeMocks,
  };
}

/**
 * Load all discussion state fixtures from a states directory
 *
 * Files must be named with format: NN-<state>.json (e.g., 01-researching.json)
 * The NN prefix determines ordering, the state name is extracted after the dash.
 */
async function loadDiscussionStateFixtures(statesDir: string): Promise<{
  orderedStates: DiscussionStateName[];
  fixtures: Map<DiscussionStateName, DiscussionStateFixture>;
}> {
  const files = fs
    .readdirSync(statesDir)
    .filter((f) => f.endsWith(".json"))
    .sort(); // Sort by filename (01-, 02-, etc.)

  const orderedStates: DiscussionStateName[] = [];
  const fixtures = new Map<DiscussionStateName, DiscussionStateFixture>();

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
    const parseResult = DiscussionStateFixtureSchema.safeParse(json);
    if (!parseResult.success) {
      const errors = parseResult.error.errors
        .map((e) => `  ${e.path.join(".")}: ${e.message}`)
        .join("\n");
      throw new Error(`Invalid discussion state fixture ${file}:\n${errors}`);
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
 * e.g., "discussion-research/basic" loads from claude-mocks/discussion-research/basic.json
 */
async function loadReferencedMocks(
  fixtures: Map<DiscussionStateName, DiscussionStateFixture>,
  basePath: string,
): Promise<Map<string, DiscussionClaudeMock>> {
  const claudeMocks = new Map<string, DiscussionClaudeMock>();
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

    const parseResult = DiscussionClaudeMockSchema.safeParse(json);
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
 * List all available discussion scenarios
 */
export async function listDiscussionScenarios(
  basePath: string = FIXTURES_BASE_PATH,
): Promise<string[]> {
  const scenariosDir = path.join(basePath, DISCUSSION_SCENARIOS_DIR);

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
