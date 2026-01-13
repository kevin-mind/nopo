import { Step } from '@github-actions-workflow-ts/lib'

// Checkout steps
export const checkoutStep = new Step({
  uses: 'actions/checkout@v4',
})

export const checkoutWithRef = (ref: string) =>
  new Step({
    uses: 'actions/checkout@v4',
    with: { ref },
  })

export const checkoutWithDepth = (fetchDepth: number, ref?: string) =>
  new Step({
    uses: 'actions/checkout@v4',
    with: {
      ...(ref && { ref }),
      'fetch-depth': fetchDepth,
    },
  })

// Setup steps
export const setupNodeStep = new Step({
  uses: './.github/actions/setup-node',
})

export const setupUvStep = new Step({
  uses: './.github/actions/setup-uv',
})

export const setupNopoStep = new Step({
  uses: './.github/actions/setup-nopo',
})

export const setupDockerStep = (opts?: {
  registry?: string
  username?: string
  password?: string
}) =>
  new Step({
    uses: './.github/actions/setup-docker',
    ...(opts && { with: opts }),
  })

// Context action
export const contextStep = (id: string) =>
  new Step({
    name: 'Context',
    id,
    uses: './.github/actions/context',
  })

// Docker tag action
export const dockerTagStep = (
  id: string,
  opts: {
    tag?: string
    registry?: string
    image?: string
    version?: string
    digest?: string
  }
) =>
  new Step({
    name: 'Docker Tag',
    id,
    uses: './.github/actions/docker-tag',
    with: opts,
  })

// Run docker action
export const runDockerStep = (opts?: {
  tag?: string
  service?: string
  run?: string
  target?: string
}) =>
  new Step({
    uses: './.github/actions/run-docker',
    ...(opts && { with: opts }),
  })

// Check action (for final status checks)
export const checkStep = (json: string) =>
  new Step({
    name: 'Check',
    uses: './.github/actions/check',
    with: { json },
  })

// Smoketest action
export const smoketestStep = (publicUrl: string) =>
  new Step({
    name: 'Run smoketest',
    uses: './.github/actions/smoketest',
    with: { public_url: publicUrl },
  })
