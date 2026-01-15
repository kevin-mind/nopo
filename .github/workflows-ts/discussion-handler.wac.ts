import { dedentString, echoKeyValue, expressions, Workflow } from "@github-actions-workflow-ts/lib";

import { ExtendedNormalJob, needs } from "./lib/enhanced-job.js";
import { ExtendedStep } from "./lib/enhanced-step.js";
import { discussionPermissions, permissions } from "./lib/patterns.js";
import { loadPrompt } from "./lib/prompts.js";
import { checkoutStep } from "./lib/steps.js";

// =============================================================================
// PROMPTS
// =============================================================================

const SUMMARIZE_PROMPT = loadPrompt("discussion-summarize.txt", {
  DISCUSSION_NUMBER: expressions.expn("github.event.client_payload.discussion_number"),
});

const RESPOND_PROMPT = loadPrompt("discussion-respond.txt", {
  DISCUSSION_NUMBER: expressions.expn("github.event.client_payload.discussion_number"),
  COMMENT_BODY: expressions.expn("github.event.client_payload.comment_body"),
  COMMENT_AUTHOR: expressions.expn("github.event.client_payload.comment_author"),
});

const RESEARCH_PROMPT = loadPrompt("discussion-research.txt", {
  DISCUSSION_TITLE: expressions.expn("github.event.client_payload.discussion_title"),
  DISCUSSION_BODY: expressions.expn("github.event.client_payload.discussion_body"),
});

const PLAN_PROMPT = loadPrompt("discussion-plan.txt", {
  DISCUSSION_NUMBER: expressions.expn("github.event.client_payload.discussion_number"),
});

// =============================================================================
// GRAPHQL QUERIES
// =============================================================================

const GET_DISCUSSION_QUERY = `query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    discussion(number: $number) {
      id
      body
    }
  }
}`;

const ADD_REACTION_MUTATION = `mutation($subjectId: ID!) {
  addReaction(input: {
    subjectId: $subjectId
    content: EYES
  }) {
    reaction { id }
  }
}`;

const ADD_DISCUSSION_COMMENT_MUTATION = `mutation($discussionId: ID!, $body: String!) {
  addDiscussionComment(input: {
    discussionId: $discussionId
    body: $body
  }) {
    comment { id }
  }
}`;

const ADD_THREADED_COMMENT_MUTATION = `mutation($discussionId: ID!, $replyToId: ID!, $body: String!) {
  addDiscussionComment(input: {
    discussionId: $discussionId
    replyToId: $replyToId
    body: $body
  }) {
    comment { id }
  }
}`;

const GET_COMMENT_PARENT_QUERY = `query($commentId: ID!) {
  node(id: $commentId) {
    ... on DiscussionComment {
      id
      replyTo {
        id
        replyTo {
          id
        }
      }
    }
  }
}`;

const UPDATE_DISCUSSION_BODY_MUTATION = `mutation($discussionId: ID!, $body: String!) {
  updateDiscussion(input: {
    discussionId: $discussionId
    body: $body
  }) {
    discussion { id }
  }
}`;

// =============================================================================
// SHELL SCRIPTS
// =============================================================================

const GET_DISCUSSION_ID_SCRIPT = dedentString(`
  discussion_data=$(gh api graphql -f query='
    ${GET_DISCUSSION_QUERY}
  ' -f owner="\${GITHUB_REPOSITORY%/*}" -f repo="\${GITHUB_REPOSITORY#*/}" -F number="$DISCUSSION_NUMBER")

  discussion_id=$(echo "$discussion_data" | jq -r '.data.repository.discussion.id')
  ${echoKeyValue.toGithubOutput("discussion_id", "$discussion_id")}

  # Store body in a file to handle multiline content safely
  echo "$discussion_data" | jq -r '.data.repository.discussion.body' > /tmp/discussion-original-body.txt
`);

const ADD_EYES_REACTION_SCRIPT = dedentString(`
  gh api graphql -f query='
    ${ADD_REACTION_MUTATION}
  ' -f subjectId="$COMMENT_ID"
`);

const POST_SUMMARY_COMMENT_SCRIPT = dedentString(`
  if [[ ! -f /tmp/discussion-summary.md ]]; then
    echo "No summary file found"
    exit 1
  fi

  gh api graphql -f query='
    ${ADD_DISCUSSION_COMMENT_MUTATION}
  ' -f discussionId="$DISCUSSION_ID" -F body=@/tmp/discussion-summary.md
`);

const FIND_THREAD_ROOT_SCRIPT = dedentString(`
  # Query the comment to see if it has a parent (replyTo)
  comment_data=$(gh api graphql -f query='
    ${GET_COMMENT_PARENT_QUERY}
  ' -f commentId="$COMMENT_ID")

  # Extract the root comment ID (walk up the replyTo chain)
  root_id=$(echo "$comment_data" | jq -r '
    .data.node
    | if .replyTo.replyTo.id then .replyTo.replyTo.id
      elif .replyTo.id then .replyTo.id
      else .id
      end
  ')

  echo "Original comment: $COMMENT_ID"
  echo "Root comment: $root_id"
  ${echoKeyValue.toGithubOutput("root_comment_id", "$root_id")}
`);

const POST_THREADED_RESPONSE_SCRIPT = dedentString(`
  if [[ ! -f /tmp/discussion-response.md ]]; then
    echo "No response file found"
    exit 1
  fi

  gh api graphql -f query='
    ${ADD_THREADED_COMMENT_MUTATION}
  ' -f discussionId="$DISCUSSION_ID" -f replyToId="$REPLY_TO_ID" -F body=@/tmp/discussion-response.md
`);

const ADD_SUCCESS_REACTION_SCRIPT = dedentString(`
  gh api graphql -f query='
    mutation($subjectId: ID!) {
      addReaction(input: {
        subjectId: $subjectId
        content: THUMBS_UP
      }) {
        reaction { id }
      }
    }
  ' -f subjectId="$COMMENT_ID"
`);

const HANDLE_RESPOND_FAILURE_SCRIPT = dedentString(`
  # Add thumbs down to the original comment
  gh api graphql -f query='
    mutation($subjectId: ID!) {
      addReaction(input: {
        subjectId: $subjectId
        content: THUMBS_DOWN
      }) {
        reaction { id }
      }
    }
  ' -f subjectId="$COMMENT_ID" || true

  # Post error as reply to the root comment in the thread
  gh api graphql -f query='
    ${ADD_THREADED_COMMENT_MUTATION}
  ' -f discussionId="$DISCUSSION_ID" -f replyToId="\${ROOT_COMMENT_ID:-$COMMENT_ID}" -f body="⚠️ **Failed to process your question**

  See [workflow run]($RUN_URL) for details."
`);

const DEBUG_LIST_FILES_SCRIPT = dedentString(`
  echo "=== Files in /tmp ==="
  ls -la /tmp/research-thread-*.md 2>/dev/null || echo "No research-thread files found"
  ls -la /tmp/discussion-*.md 2>/dev/null || echo "No discussion files found"
  echo ""
  echo "=== Content of research thread files ==="
  for file in /tmp/research-thread-*.md; do
    if [[ -f "$file" ]]; then
      echo "--- $file ---"
      head -20 "$file"
      echo ""
    fi
  done
`);

const POST_RESEARCH_THREADS_SCRIPT = dedentString(`
  # Check if files exist
  if ! ls /tmp/research-thread-*.md 1> /dev/null 2>&1; then
    echo "ERROR: No research thread files found!"
    echo "The Claude agent should have created files like /tmp/research-thread-1.md"
    exit 1
  fi

  # Count files
  file_count=$(ls /tmp/research-thread-*.md 2>/dev/null | wc -l)
  echo "Found $file_count research thread files"

  # Post each research thread and collect comment IDs
  comment_ids=""
  comment_bodies=""

  for file in /tmp/research-thread-*.md; do
    if [[ -f "$file" ]]; then
      echo "Posting research thread: $file"

      # Post comment and capture the comment ID
      comment_result=$(gh api graphql -f query='
        ${ADD_DISCUSSION_COMMENT_MUTATION}
      ' -f discussionId="$DISCUSSION_ID" -F body=@"$file")

      comment_id=$(echo "$comment_result" | jq -r '.data.addDiscussionComment.comment.id')
      echo "Posted comment: $comment_id"

      # Store comment data for dispatch step
      # Use base64 to safely encode the body
      encoded_body=$(cat "$file" | base64 -w 0)
      echo "\${comment_id}:\${encoded_body}" >> /tmp/posted_comments.txt

      # Small delay between posts
      sleep 2
    fi
  done

  echo "Successfully posted $file_count research threads"
  echo "Comments posted with PAT - webhooks will trigger dispatcher automatically"
`);

const POST_PLAN_COMMENT_SCRIPT = dedentString(`
  if [[ ! -f /tmp/discussion-plan-summary.md ]]; then
    echo "No plan summary file found"
    exit 1
  fi

  gh api graphql -f query='
    ${ADD_THREADED_COMMENT_MUTATION}
  ' -f discussionId="$DISCUSSION_ID" -f replyToId="$REPLY_TO_ID" -F body=@/tmp/discussion-plan-summary.md
`);

const ADD_ROCKET_REACTION_SCRIPT = dedentString(`
  gh api graphql -f query='
    mutation($subjectId: ID!) {
      addReaction(input: {
        subjectId: $subjectId
        content: ROCKET
      }) {
        reaction { id }
      }
    }
  ' -f subjectId="$COMMENT_ID"
`);

const POST_COMPLETION_MESSAGE_SCRIPT = dedentString(`
  gh api graphql -f query='
    ${ADD_DISCUSSION_COMMENT_MUTATION}
  ' -f discussionId="$DISCUSSION_ID" -f body="✅ **This discussion thread has been marked as complete.**

  If you have additional questions, feel free to post a new comment!"
`);

const UPDATE_DESCRIPTION_SCRIPT = dedentString(`
  # Find any updated body file
  if [[ -d /tmp/updated-bodies ]]; then
    updated_file=$(find /tmp/updated-bodies -name "*.md" -type f | head -1)
  fi

  if [[ -z "$updated_file" || ! -f "$updated_file" ]]; then
    echo "No updated body file found, skipping description update"
    exit 0
  fi

  echo "Found updated body: $updated_file"

  gh api graphql -f query='
    ${UPDATE_DISCUSSION_BODY_MUTATION}
  ' -f discussionId="$DISCUSSION_ID" -F body=@"$updated_file"

  echo "✅ Discussion description updated"
`);

// =============================================================================
// HELPER: Claude Action Step
// =============================================================================

const claudeActionExtendedStep = <const Id extends string>(opts: {
  id: Id;
  prompt: string;
  maxTurns?: number;
  settings?: string;
  showFullOutput?: boolean;
  secretsTokenName?: string;
  env?: Record<string, string>;
}) => {
  const args = [
    `--model claude-opus-4-5-20251101`,
    `--max-turns ${opts.maxTurns ?? 50}`,
  ].join(" ");

  return new ExtendedStep<Id>({
    id: opts.id,
    uses: "anthropics/claude-code-action@v1",
    with: {
      claude_code_oauth_token: expressions.secret(opts.secretsTokenName ?? "CLAUDE_CODE_OAUTH_TOKEN"),
      settings: opts.settings ?? ".claude/settings.json",
      prompt: opts.prompt,
      claude_args: args,
      ...(opts.showFullOutput && { show_full_output: "true" }),
    },
    env: {
      GITHUB_TOKEN: expressions.secret("GITHUB_TOKEN"),
      ...opts.env,
    },
  });
};

// =============================================================================
// JOBS
// =============================================================================

const prepareJob = new ExtendedNormalJob("prepare", {
  "runs-on": "ubuntu-latest",
  permissions: {
    ...permissions.contents.read,
    ...permissions.discussions.write,
    ...permissions.idToken.write,
  },
  outputs: (steps) => ({
    discussion_id: steps.get_id.outputs.discussion_id,
    discussion_body: steps.get_id.outputs.discussion_body,
    action_type: "github.event.client_payload.action_type",
  }),
  steps: [
    new ExtendedStep({
      id: "get_id",
      name: "Get discussion ID and body",
      outputs: ["discussion_id", "discussion_body"],
      env: {
        GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
        DISCUSSION_NUMBER: expressions.expn("github.event.client_payload.discussion_number"),
      },
      run: GET_DISCUSSION_ID_SCRIPT,
    }),
    new ExtendedStep({
      id: "upload_body",
      name: "Upload original body",
      uses: "actions/upload-artifact@v4",
      with: {
        name: "discussion-original-body",
        path: "/tmp/discussion-original-body.txt",
        "retention-days": 1,
      },
    }),
    new ExtendedStep({
      id: "add_eyes",
      name: "Add eyes reaction if responding",
      if: "github.event.client_payload.action_type == 'respond'",
      env: {
        GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
        COMMENT_ID: expressions.expn("github.event.client_payload.comment_id"),
      },
      run: ADD_EYES_REACTION_SCRIPT,
    }),
  ],
});

const summarizeJob = new ExtendedNormalJob("summarize", {
  needs: [prepareJob],
  if: "github.event.client_payload.action_type == 'summarize'",
  "runs-on": "ubuntu-latest",
  permissions: {
    ...permissions.contents.read,
    ...permissions.discussions.write,
    ...permissions.idToken.write,
  },
  steps: [
    checkoutStep("checkout"),
    new ExtendedStep({
      id: "download_body",
      name: "Download original body",
      uses: "actions/download-artifact@v4",
      with: {
        name: "discussion-original-body",
        path: "/tmp",
      },
    }),
    claudeActionExtendedStep({
      id: "claude",
      prompt: SUMMARIZE_PROMPT,
      maxTurns: 50,
      settings: ".claude/settings.json",
      showFullOutput: true,
      secretsTokenName: "CLAUDE_CODE_OAUTH_TOKEN",
      env: {
        GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
      },
    }),
    new ExtendedStep({
      id: "post_summary",
      name: "Post summary comment",
      if: "always()",
      env: {
        GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
        DISCUSSION_ID: expressions.expn(needs(prepareJob).outputs.discussion_id),
      },
      run: POST_SUMMARY_COMMENT_SCRIPT,
    }),
    new ExtendedStep({
      id: "upload_updated_body",
      name: "Upload updated body",
      if: "always()",
      uses: "actions/upload-artifact@v4",
      with: {
        name: "discussion-updated-body-summarize",
        path: "/tmp/discussion-updated-body.md",
        "if-no-files-found": "ignore",
      },
    }),
  ],
});

const respondJob = new ExtendedNormalJob("respond", {
  needs: [prepareJob],
  if: "github.event.client_payload.action_type == 'respond'",
  "runs-on": "ubuntu-latest",
  permissions: {
    ...permissions.contents.read,
    ...permissions.discussions.write,
    ...permissions.idToken.write,
  },
  steps: [
    checkoutStep("checkout"),
    new ExtendedStep({
      id: "download_body",
      name: "Download original body",
      uses: "actions/download-artifact@v4",
      with: {
        name: "discussion-original-body",
        path: "/tmp",
      },
    }),
    claudeActionExtendedStep({
      id: "claude",
      prompt: RESPOND_PROMPT,
      maxTurns: 100,
      settings: ".claude/settings.json",
      showFullOutput: true,
      secretsTokenName: "CLAUDE_CODE_OAUTH_TOKEN",
      env: {
        GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
      },
    }),
    new ExtendedStep({
      id: "find_root",
      name: "Find thread root comment",
      outputs: ["root_comment_id"],
      env: {
        GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
        DISCUSSION_ID: expressions.expn(needs(prepareJob).outputs.discussion_id),
        COMMENT_ID: expressions.expn("github.event.client_payload.comment_id"),
      },
      run: FIND_THREAD_ROOT_SCRIPT,
    }),
    new ExtendedStep({
      id: "post_response",
      name: "Post response comment",
      if: "always()",
      env: {
        GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
        DISCUSSION_ID: expressions.expn(needs(prepareJob).outputs.discussion_id),
        REPLY_TO_ID: expressions.expn("steps.find_root.outputs.root_comment_id"),
      },
      run: POST_THREADED_RESPONSE_SCRIPT,
    }),
    new ExtendedStep({
      id: "upload_updated_body",
      name: "Upload updated body",
      if: "always()",
      uses: "actions/upload-artifact@v4",
      with: {
        name: "discussion-updated-body-respond",
        path: "/tmp/discussion-updated-body.md",
        "if-no-files-found": "ignore",
      },
    }),
    new ExtendedStep({
      id: "add_success",
      name: "Add success reaction",
      if: "success()",
      env: {
        GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
        COMMENT_ID: expressions.expn("github.event.client_payload.comment_id"),
      },
      run: ADD_SUCCESS_REACTION_SCRIPT,
    }),
    new ExtendedStep({
      id: "handle_failure",
      name: "Handle failure",
      if: "failure()",
      env: {
        GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
        DISCUSSION_ID: expressions.expn(needs(prepareJob).outputs.discussion_id),
        COMMENT_ID: expressions.expn("github.event.client_payload.comment_id"),
        ROOT_COMMENT_ID: expressions.expn("steps.find_root.outputs.root_comment_id"),
        RUN_URL:
          `${expressions.expn("github.server_url")}/${expressions.expn("github.repository")}/actions/runs/${expressions.expn("github.run_id")}`,
      },
      run: HANDLE_RESPOND_FAILURE_SCRIPT,
    }),
  ],
});

const researchJob = new ExtendedNormalJob("research", {
  needs: [prepareJob],
  if: "github.event.client_payload.action_type == 'research'",
  "runs-on": "ubuntu-latest",
  permissions: {
    ...permissions.contents.read,
    ...permissions.discussions.write,
    ...permissions.idToken.write,
  },
  steps: [
    checkoutStep("checkout"),
    new ExtendedStep({
      id: "download_body",
      name: "Download original body",
      uses: "actions/download-artifact@v4",
      with: {
        name: "discussion-original-body",
        path: "/tmp",
      },
    }),
    claudeActionExtendedStep({
      id: "claude",
      prompt: RESEARCH_PROMPT,
      maxTurns: 30,
      settings: ".claude/settings.json",
      showFullOutput: true,
      secretsTokenName: "CLAUDE_CODE_OAUTH_TOKEN",
      env: {
        GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
      },
    }),
    new ExtendedStep({
      id: "debug_files",
      name: "Debug - List created files",
      if: "always()",
      run: DEBUG_LIST_FILES_SCRIPT,
    }),
    new ExtendedStep({
      id: "post_threads",
      name: "Post research thread comments",
      if: "always()",
      env: {
        // Use PAT to post comments so GitHub fires webhooks
        // (GITHUB_TOKEN comments don't trigger discussion_comment events)
        GH_TOKEN: expressions.secret("PAT_TOKEN"),
        DISCUSSION_ID: expressions.expn(needs(prepareJob).outputs.discussion_id),
      },
      run: POST_RESEARCH_THREADS_SCRIPT,
    }),
    new ExtendedStep({
      id: "upload_updated_body",
      name: "Upload updated body",
      if: "always()",
      uses: "actions/upload-artifact@v4",
      with: {
        name: "discussion-updated-body-research",
        path: "/tmp/discussion-updated-body.md",
        "if-no-files-found": "ignore",
      },
    }),
  ],
});

const planJob = new ExtendedNormalJob("plan", {
  needs: [prepareJob],
  if: "github.event.client_payload.action_type == 'plan'",
  "runs-on": "ubuntu-latest",
  permissions: {
    ...permissions.contents.read,
    ...permissions.discussions.write,
    ...permissions.issues.write,
    ...permissions.idToken.write,
  },
  steps: [
    checkoutStep("checkout"),
    new ExtendedStep({
      id: "download_body",
      name: "Download original body",
      uses: "actions/download-artifact@v4",
      with: {
        name: "discussion-original-body",
        path: "/tmp",
      },
    }),
    claudeActionExtendedStep({
      id: "claude",
      prompt: PLAN_PROMPT,
      maxTurns: 100,
      settings: ".claude/settings.json",
      showFullOutput: true,
      secretsTokenName: "CLAUDE_CODE_OAUTH_TOKEN",
      env: {
        GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
      },
    }),
    new ExtendedStep({
      id: "find_root",
      name: "Find thread root comment",
      outputs: ["root_comment_id"],
      env: {
        GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
        COMMENT_ID: expressions.expn("github.event.client_payload.comment_id"),
      },
      run: FIND_THREAD_ROOT_SCRIPT,
    }),
    new ExtendedStep({
      id: "post_plan",
      name: "Post plan summary comment",
      if: "always()",
      env: {
        GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
        DISCUSSION_ID: expressions.expn(needs(prepareJob).outputs.discussion_id),
        REPLY_TO_ID: expressions.expn("steps.find_root.outputs.root_comment_id"),
      },
      run: POST_PLAN_COMMENT_SCRIPT,
    }),
    new ExtendedStep({
      id: "upload_updated_body",
      name: "Upload updated body",
      if: "always()",
      uses: "actions/upload-artifact@v4",
      with: {
        name: "discussion-updated-body-plan",
        path: "/tmp/discussion-updated-body.md",
        "if-no-files-found": "ignore",
      },
    }),
  ],
});

const completeJob = new ExtendedNormalJob("complete", {
  needs: [prepareJob],
  if: "github.event.client_payload.action_type == 'complete'",
  "runs-on": "ubuntu-latest",
  permissions: {
    ...permissions.contents.read,
    ...permissions.discussions.write,
    ...permissions.idToken.write,
  },
  steps: [
    new ExtendedStep({
      id: "add_rocket",
      name: "Add rocket reaction",
      env: {
        GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
        COMMENT_ID: expressions.expn("github.event.client_payload.comment_id"),
      },
      run: ADD_ROCKET_REACTION_SCRIPT,
    }),
    new ExtendedStep({
      id: "post_completion",
      name: "Post completion message",
      env: {
        GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
        DISCUSSION_ID: expressions.expn(needs(prepareJob).outputs.discussion_id),
      },
      run: POST_COMPLETION_MESSAGE_SCRIPT,
    }),
  ],
});

const updateDescriptionJob = new ExtendedNormalJob("update-description", {
  needs: [prepareJob, summarizeJob, respondJob, researchJob, planJob],
  if: "always() && !cancelled()",
  "runs-on": "ubuntu-latest",
  permissions: {
    ...permissions.discussions.write,
  },
  steps: [
    new ExtendedStep({
      id: "download_updated_body",
      name: "Download updated body (try all sources)",
      uses: "actions/download-artifact@v4",
      with: {
        pattern: "discussion-updated-body-*",
        "merge-multiple": true,
        path: "/tmp/updated-bodies",
      },
      "continue-on-error": true,
    }),
    new ExtendedStep({
      id: "apply_updated_body",
      name: "Find and apply updated body",
      env: {
        GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
        DISCUSSION_ID: expressions.expn(needs(prepareJob).outputs.discussion_id),
      },
      run: UPDATE_DESCRIPTION_SCRIPT,
    }),
  ],
});

// =============================================================================
// WORKFLOW
// =============================================================================

const workflow = new Workflow("discussion-handler", {
  name: "Discussion Handler",
  on: {
    repository_dispatch: {
      types: ["discussion_event"],
    },
  },
  permissions: discussionPermissions,
});

workflow.addJobs([
  prepareJob,
  summarizeJob,
  respondJob,
  researchJob,
  planJob,
  completeJob,
  updateDescriptionJob,
]);

export default workflow;
