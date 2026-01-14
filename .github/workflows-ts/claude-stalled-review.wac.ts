import { NormalJob, Workflow } from '@github-actions-workflow-ts/lib'
import { checkoutStep } from './lib/steps'
import { defaultDefaults, stalledReviewPermissions } from './lib/patterns'
import { scripts } from './lib/scripts'

// Detect stalled reviews job
const detectStalledReviewsJob = new NormalJob('detect-stalled-reviews', {
  'runs-on': 'ubuntu-latest',
})

detectStalledReviewsJob.addSteps([
  checkoutStep,
  scripts.detectStalledReviews({
    GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}',
    DRY_RUN: "${{ github.event.inputs.dry_run || 'false' }}",
  }),
])

// Main workflow
export const claudeStalledReviewWorkflow = new Workflow('claude-stalled-review', {
  name: 'Claude Stalled Review Detector',
  on: {
    schedule: [
      {
        // Run every 30 minutes
        cron: '*/30 * * * *',
      },
    ],
    workflow_dispatch: {
      inputs: {
        dry_run: {
          description: "Dry run (don't post comments)",
          required: false,
          default: 'false',
          type: 'boolean',
        },
      },
    },
  },
  permissions: stalledReviewPermissions,
  defaults: defaultDefaults,
})

claudeStalledReviewWorkflow.addJobs([detectStalledReviewsJob])
