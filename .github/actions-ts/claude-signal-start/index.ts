import * as core from '@actions/core'
import * as github from '@actions/github'
import { getOptionalInput, getRequiredInput, setOutputs } from '../lib/index.js'

type ResourceType = 'issue' | 'pr' | 'discussion'

const JOB_DESCRIPTIONS: Record<string, string> = {
  'issue-triage': 'triaging this issue',
  'issue-implement': 'implementing this issue',
  'issue-comment': 'responding to your request',
  'push-to-draft': 'converting PR to draft',
  'ci-fix': 'fixing CI failures',
  'ci-suggest': 'suggesting CI fixes',
  'ci-success': 'marking PR as ready for review',
  'pr-review': 'reviewing this PR',
  'pr-response': 'responding to review feedback',
  'pr-human-response': 'addressing your review feedback',
  'discussion-research': 'researching this topic',
  'discussion-respond': 'responding to your question',
  'discussion-summarize': 'summarizing this discussion',
  'discussion-plan': 'creating implementation plan',
  'discussion-complete': 'marking discussion as complete',
}

async function addReactionToComment(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  commentId: string,
  resourceType: ResourceType
): Promise<void> {
  try {
    if (resourceType === 'discussion') {
      // Use GraphQL for discussion comment reactions
      await octokit.graphql(
        `
        mutation($subjectId: ID!) {
          addReaction(input: {
            subjectId: $subjectId
            content: EYES
          }) {
            reaction { id }
          }
        }
      `,
        { subjectId: commentId }
      )
    } else {
      // Use REST API for issue/PR comment reactions
      await octokit.rest.reactions.createForIssueComment({
        owner,
        repo,
        comment_id: parseInt(commentId, 10),
        content: 'eyes',
      })
    }
    core.info(`Added eyes reaction to comment ${commentId}`)
  } catch (error) {
    // Don't fail if reaction fails - it's not critical
    core.warning(`Failed to add reaction to comment: ${error}`)
  }
}

async function createStatusComment(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  resourceType: ResourceType,
  resourceNumber: string,
  job: string
): Promise<string> {
  const description = JOB_DESCRIPTIONS[job] ?? job
  const runUrl = `${process.env.GITHUB_SERVER_URL}/${owner}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`

  const body = `👀 **nopo-bot** is ${description}...

[View workflow run](${runUrl})`

  if (resourceType === 'discussion') {
    // Get discussion ID first
    const discussionResult = await octokit.graphql<{
      repository: {
        discussion: { id: string }
      }
    }>(
      `
      query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          discussion(number: $number) {
            id
          }
        }
      }
    `,
      { owner, repo, number: parseInt(resourceNumber, 10) }
    )

    const discussionId = discussionResult.repository.discussion.id

    // Create comment
    const commentResult = await octokit.graphql<{
      addDiscussionComment: { comment: { id: string } }
    }>(
      `
      mutation($discussionId: ID!, $body: String!) {
        addDiscussionComment(input: {
          discussionId: $discussionId
          body: $body
        }) {
          comment { id }
        }
      }
    `,
      { discussionId, body }
    )

    return commentResult.addDiscussionComment.comment.id
  }

  // For issues and PRs, use the issues API (PRs are issues in GitHub)
  const { data: comment } = await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: parseInt(resourceNumber, 10),
    body,
  })

  return String(comment.id)
}

async function run(): Promise<void> {
  try {
    const token = getRequiredInput('github_token')
    const resourceType = getRequiredInput('resource_type') as ResourceType
    const resourceNumber = getRequiredInput('resource_number')
    const commentId = getOptionalInput('comment_id')
    const job = getRequiredInput('job')

    const octokit = github.getOctokit(token)
    const { context } = github
    const owner = context.repo.owner
    const repo = context.repo.repo

    core.info(`Signaling start for ${resourceType} #${resourceNumber}`)
    core.info(`Job: ${job}`)

    // Add reaction to triggering comment if provided
    if (commentId) {
      await addReactionToComment(octokit, owner, repo, commentId, resourceType)
    }

    // Create status comment
    const statusCommentId = await createStatusComment(octokit, owner, repo, resourceType, resourceNumber, job)

    core.info(`Created status comment: ${statusCommentId}`)

    setOutputs({
      status_comment_id: statusCommentId,
    })
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message)
    } else {
      core.setFailed('An unexpected error occurred')
    }
  }
}

run()
