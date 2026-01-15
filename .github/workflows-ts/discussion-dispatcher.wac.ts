import { expressions, Workflow } from "@github-actions-workflow-ts/lib";
import { ExtendedNormalJob } from "./lib/enhanced-job.js";
import { ExtendedStep } from "./lib/enhanced-step.js";
import {
  defaultDefaults,
  discussionDispatcherPermissions,
} from "./lib/patterns.js";
import { checkoutStep } from "./lib/steps.js";

// Dispatch job
const dispatchJob = new ExtendedNormalJob("dispatch", {
  "runs-on": "ubuntu-latest",
  steps: [
    checkoutStep("checkout"),
    new ExtendedStep({
      id: "dispatch",
      name: "Dispatch to handler",
      uses: "./.github/actions-ts/discussion-dispatch",
      with: {
        github_token: expressions.secret("GITHUB_TOKEN"),
      },
    }),
  ],
});

// Main workflow
export const discussionDispatcherWorkflow = new Workflow(
  "discussion-dispatcher",
  {
    name: "Discussion Event Dispatcher",
    on: {
      discussion: {
        types: ["created", "edited"],
      },
      discussion_comment: {
        types: ["created"],
      },
    },
    permissions: discussionDispatcherPermissions,
    defaults: defaultDefaults,
  },
);

discussionDispatcherWorkflow.addJobs([dispatchJob]);
