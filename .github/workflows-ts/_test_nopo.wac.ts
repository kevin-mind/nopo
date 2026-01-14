import { NormalJob, Step, Workflow } from '@github-actions-workflow-ts/lib'

// Reusable steps
const checkoutStep = new Step({
  uses: 'actions/checkout@v4',
})

const setupNodeStep = new Step({
  uses: './.github/actions/setup-node',
})

const setupUvStep = new Step({
  uses: './.github/actions/setup-uv',
})

const setupNopoStep = new Step({
  uses: './.github/actions/setup-nopo',
})

// Build job - tests nopo CLI builds successfully (and fails when expected)
const buildJob = new NormalJob('build', {
  'runs-on': 'ubuntu-latest',
  name: '[nopo] build (${{ matrix.expected }})',
  strategy: {
    matrix: {
      expected: ['success', 'failure'],
    },
  },
})

buildJob.addSteps([
  checkoutStep,
  setupNodeStep,
  setupUvStep,
  new Step({
    name: 'Monkeywrench nopo',
    if: "${{ matrix.expected == 'failure' }}",
    run: 'rm -f ./nopo/scripts/src/index.ts\n',
  }),
  new Step({
    name: 'Make nopo',
    id: 'nopo',
    'continue-on-error': true,
    run: 'make -C ./nopo/scripts init',
  }),
  new Step({
    name: 'Verify result',
    env: {
      expected: '${{ matrix.expected }}',
      actual: '${{ steps.nopo.outcome }}',
    },
    run: `if [[ "$expected" != "$actual" ]]; then
  echo "Expected build to result in $expected, but got $actual"
  exit 1
fi
`,
  }),
])

// Unit tests job
const unitJob = new NormalJob('unit', {
  'runs-on': 'ubuntu-latest',
  name: '[nopo] unit tests',
})

unitJob.addSteps([
  checkoutStep,
  setupNodeStep,
  setupUvStep,
  setupNopoStep,
  new Step({
    name: 'Run unit tests',
    run: 'pnpm run --dir ./nopo/scripts test',
  }),
])

// TypeScript Actions tests job
const actionsJob = new NormalJob('actions', {
  'runs-on': 'ubuntu-latest',
  name: '[actions] TypeScript actions',
})

actionsJob.addSteps([
  checkoutStep,
  setupNodeStep,
  new Step({
    name: 'Run TypeScript actions tests',
    run: 'pnpm run --filter @nopo/github-actions test',
  }),
  new Step({
    name: 'Validate TypeScript actions build',
    run: 'pnpm run check:actions:root',
  }),
])

// Shellcheck job - validates shell scripts
const shellcheckJob = new NormalJob('shellcheck', {
  'runs-on': 'ubuntu-latest',
  name: '[scripts] shellcheck',
})

shellcheckJob.addSteps([
  checkoutStep,
  new Step({
    name: 'Run shellcheck',
    run: 'shellcheck .github/scripts/*.sh',
  }),
])

// E2E tests job
const e2eTests = [
  { name: 'list services', command: 'nopo list', expect: 'minimal' },
  { name: 'list json', command: 'nopo list --json', expect: 'complex' },
  { name: 'list dependent', command: 'nopo list', expect: 'dependent' },
  { name: 'test command', command: 'nopo test minimal', expect: 'FIXTURE_MINIMAL_TEST_SUCCESS' },
  { name: 'check command', command: 'nopo check minimal', expect: 'FIXTURE_MINIMAL_CHECK_SUCCESS' },
  { name: 'subcommand check:py', command: 'nopo check py complex', expect: 'FIXTURE_COMPLEX_CHECK_PY_SUCCESS' },
]

const e2eJob = new NormalJob('e2e', {
  'runs-on': 'ubuntu-latest',
  name: '[nopo] e2e: ${{ matrix.test.name }}',
  strategy: {
    'fail-fast': false,
    matrix: {
      test: e2eTests,
    },
  },
})

e2eJob.addSteps([
  checkoutStep,
  setupNodeStep,
  setupUvStep,
  setupNopoStep,
  new Step({
    name: 'Run ${{ matrix.test.name }}',
    'working-directory': './nopo/fixtures',
    env: {
      COMMAND: '${{ matrix.test.command }}',
      EXPECT: '${{ matrix.test.expect }}',
    },
    run: `echo "Running: $COMMAND"
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
`,
  }),
])

// Main workflow
export const testNopoWorkflow = new Workflow('_test_nopo', {
  name: 'Test Nopo CLI',
  on: {
    workflow_call: {},
  },
  permissions: {},
  defaults: {
    run: {
      shell: 'bash',
    },
  },
})

testNopoWorkflow.addJobs([buildJob, unitJob, actionsJob, shellcheckJob, e2eJob])
