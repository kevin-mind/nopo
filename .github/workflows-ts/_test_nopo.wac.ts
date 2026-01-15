import { dedentString, expressions, Workflow } from "@github-actions-workflow-ts/lib";
import { ExtendedNormalJob } from "./lib/enhanced-job";
import { ExtendedStep } from "./lib/enhanced-step";
import { checkoutStep, setupNodeStep, setupNopoStep, setupUvStep } from "./lib/steps";

// E2E tests configuration
const e2eTests = [
  { name: "list services", command: "nopo list", expect: "minimal" },
  { name: "list json", command: "nopo list --json", expect: "complex" },
  { name: "list dependent", command: "nopo list", expect: "dependent" },
  {
    name: "test command",
    command: "nopo test minimal",
    expect: "FIXTURE_MINIMAL_TEST_SUCCESS",
  },
  {
    name: "check command",
    command: "nopo check minimal",
    expect: "FIXTURE_MINIMAL_CHECK_SUCCESS",
  },
  {
    name: "subcommand check:py",
    command: "nopo check py complex",
    expect: "FIXTURE_COMPLEX_CHECK_PY_SUCCESS",
  },
];

// Build job - tests nopo CLI builds successfully (and fails when expected)
const buildJob = new ExtendedNormalJob("build", {
  "runs-on": "ubuntu-latest",
  name: `[nopo] build (${expressions.expn("matrix.expected")})`,
  strategy: {
    matrix: {
      expected: ["success", "failure"],
    },
  },
  steps: [
    checkoutStep("checkout"),
    setupNodeStep("setup_node"),
    setupUvStep("setup_uv"),
    new ExtendedStep({
      id: "monkeywrench",
      name: "Monkeywrench nopo",
      if: expressions.expn("matrix.expected == 'failure'"),
      run: "rm -f ./nopo/scripts/src/index.ts\n",
    }),
    new ExtendedStep({
      id: "nopo",
      name: "Make nopo",
      "continue-on-error": true,
      run: "make -C ./nopo/scripts init",
    }),
    new ExtendedStep({
      id: "verify",
      name: "Verify result",
      env: {
        expected: expressions.expn("matrix.expected"),
        actual: expressions.expn("steps.nopo.outcome"),
      },
      run: dedentString(`
        if [[ "$expected" != "$actual" ]]; then
          echo "Expected build to result in $expected, but got $actual"
          exit 1
        fi
      `),
    }),
  ],
});

// Unit tests job
const unitJob = new ExtendedNormalJob("unit", {
  "runs-on": "ubuntu-latest",
  name: "[nopo] unit tests",
  steps: [
    checkoutStep("checkout"),
    setupNodeStep("setup_node"),
    setupUvStep("setup_uv"),
    setupNopoStep("setup_nopo"),
    new ExtendedStep({
      id: "run_tests",
      name: "Run unit tests",
      run: "pnpm run --dir ./nopo/scripts test",
    }),
  ],
});

// TypeScript Actions tests job
const actionsJob = new ExtendedNormalJob("actions", {
  "runs-on": "ubuntu-latest",
  name: "[actions] TypeScript actions",
  steps: [
    checkoutStep("checkout"),
    setupNodeStep("setup_node"),
    new ExtendedStep({
      id: "run_tests",
      name: "Run TypeScript actions tests",
      run: "pnpm run --filter @nopo/github-actions test",
    }),
    new ExtendedStep({
      id: "validate_build",
      name: "Validate TypeScript actions build",
      run: "pnpm run check:actions:root",
    }),
  ],
});

// E2E tests job
const e2eJob = new ExtendedNormalJob("e2e", {
  "runs-on": "ubuntu-latest",
  name: `[nopo] e2e: ${expressions.expn("matrix.test.name")}`,
  strategy: {
    "fail-fast": false,
    matrix: {
      test: e2eTests,
    },
  },
  steps: [
    checkoutStep("checkout"),
    setupNodeStep("setup_node"),
    setupUvStep("setup_uv"),
    setupNopoStep("setup_nopo"),
    new ExtendedStep({
      id: "run_e2e",
      name: `Run ${expressions.expn("matrix.test.name")}`,
      "working-directory": "./nopo/fixtures",
      env: {
        COMMAND: expressions.expn("matrix.test.command"),
        EXPECT: expressions.expn("matrix.test.expect"),
      },
      run: dedentString(`echo "Running: $COMMAND"
        output=$($COMMAND 2>&1) || true
        echo "$output"
        if [[ -n "$EXPECT" ]]; then
          if echo "$output" | grep -q "$EXPECT"; then
            echo "✓ Found expected output: $EXPECT"
          else
            echo "✗ Expected output not found: $EXPECT"
            exit 1
          fi
        fi
      `),
    }),
  ],
});

// Main workflow
export const testNopoWorkflow = new Workflow("_test_nopo", {
  name: "Test Nopo CLI",
  on: {
    workflow_call: {},
  },
  permissions: {},
  defaults: {
    run: {
      shell: "bash",
    },
  },
});

testNopoWorkflow.addJobs([buildJob, unitJob, actionsJob, e2eJob]);
