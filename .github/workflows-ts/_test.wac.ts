import { NormalJob, Step, Workflow } from '@github-actions-workflow-ts/lib'
import { checkoutStep, setupNodeStep, setupUvStep } from './lib/steps'
import { defaultDefaults, emptyPermissions, testPermissions } from './lib/patterns'

// Test job with matrix strategy
const testJob = new NormalJob('test', {
  'runs-on': 'ubuntu-latest',
  name: "[${{ matrix.service || 'host' }}] ${{ matrix.command }} (${{ matrix.target }})",
  strategy: {
    matrix: {
      service: '${{ fromJson(inputs.services) }}',
      command: ['test'],
      target: ['development', 'production'],
      include: [
        {
          command: 'check',
          target: 'production',
        },
      ],
    },
    'fail-fast': false,
  },
  permissions: testPermissions,
})

testJob.addSteps([
  checkoutStep,
  setupNodeStep,
  setupUvStep,
  new Step({
    name: 'Set up Docker',
    uses: './.github/actions/setup-docker',
    with: {
      registry: 'ghcr.io',
      username: '${{ github.actor }}',
      password: '${{ secrets.GITHUB_TOKEN }}',
    },
  }),
  new Step({
    name: 'Docker Tag',
    id: 'docker_tag',
    uses: './.github/actions/docker-tag',
    with: {
      tag: '${{ inputs.tag }}',
    },
  }),
  new Step({
    name: "Run '${{ matrix.command }}'",
    uses: './.github/actions/run-docker',
    with: {
      tag: '${{ steps.docker_tag.outputs.tag }}',
      service: '${{ matrix.service }}',
      run: '${{ matrix.command }}',
      target: '${{ matrix.target }}',
    },
  }),
])

// Extendable job - tests that base image can be extended
const extendableJob = new NormalJob('extendable', {
  'runs-on': 'ubuntu-latest',
  permissions: testPermissions,
})

extendableJob.addSteps([
  checkoutStep,
  setupNodeStep,
  setupUvStep,
  new Step({
    uses: './.github/actions/setup-docker',
    with: {
      registry: 'ghcr.io',
      username: '${{ github.actor }}',
      password: '${{ secrets.GITHUB_TOKEN }}',
    },
  }),
  new Step({
    name: 'Docker Tag',
    id: 'docker_tag',
    uses: './.github/actions/docker-tag',
    with: {
      tag: '${{ inputs.tag }}',
    },
  }),
  new Step({
    name: 'Get base image',
    env: {
      DOCKER_TAG: '${{ steps.docker_tag.outputs.tag }}',
      DOCKER_DIGEST: '${{ steps.docker_tag.outputs.digest }}',
    },
    run: `if [[ -n "$DOCKER_DIGEST" ]]; then
  echo "Digest present - pulling image from registry"
  docker pull "$DOCKER_TAG"
else
  echo "No digest - building image locally"
  make build base \\
    DOCKER_TAG="$DOCKER_TAG" \\
    DOCKER_TARGET="development"
fi
`,
  }),
  new Step({
    name: 'Verify extendable base image',
    env: {
      DOCKER_TAG: '${{ steps.docker_tag.outputs.tag }}',
    },
    run: './nopo/docker/tests/extendable.sh "${{ steps.docker_tag.outputs.tag }}"',
  }),
])

// Main workflow
export const testWorkflow = new Workflow('_test', {
  name: 'Test',
  on: {
    workflow_call: {
      inputs: {
        tag: {
          description: 'The full docker tag to test',
          required: true,
          type: 'string',
        },
        services: {
          description: 'JSON array of services to test',
          required: true,
          type: 'string',
        },
      },
    },
  },
  permissions: emptyPermissions,
  defaults: defaultDefaults,
})

testWorkflow.addJobs([testJob, extendableJob])
