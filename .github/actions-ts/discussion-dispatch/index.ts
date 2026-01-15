import * as core from '@actions/core'
import * as github from '@actions/github'
import { getRequiredInput, setOutputs } from '../lib/index.js'

type ActionType = 'research' | 'respond' | 'summarize' | 'plan' | 'complete' | 'unknown' | 'skipped'

interface DispatchPayload {
  action_type: ActionType
  discussion_number: number
  discussion_title: string
  discussion_body: string
  comment_id?: string
  comment_body?: string
  comment_author?: string
}

async function run(): Promise<void> {
  try {
    const token = getRequiredInput('github_token')
    const octokit = github.getOctokit(token)
    const { context } = github
    const eventName = context.eventName
    const payload = context.payload

    let actionType: ActionType = 'unknown'
    let discussionNumber: number | undefined
    let discussionTitle: string | undefined
    let discussionBody: string | undefined
    let commentId: string | undefined
    let commentBody: string | undefined
    let commentAuthor: string | undefined

    if (eventName === 'discussion') {
      const discussion = payload.discussion as {
        number: number
        title: string
        body: string
      }
      discussionNumber = discussion.number
      discussionTitle = discussion.title
      discussionBody = discussion.body

      if (payload.action === 'created') {
        actionType = 'research'
      }
    } else if (eventName === 'discussion_comment') {
      const discussion = payload.discussion as {
        number: number
        title: string
        body: string
      }
      const comment = payload.comment as unknown as {
        node_id: string
        body: string
        parent_id?: number
        user: { login: string }
      }

      discussionNumber = discussion.number
      discussionTitle = discussion.title
      discussionBody = discussion.body
      commentId = comment.node_id
      commentBody = comment.body
      commentAuthor = comment.user.login

      // Check if this is a top-level comment (no parent)
      const isTopLevel = !comment.parent_id

      // Check for commands first (works for any author)
      const body = commentBody.trim()
      if (body === '/summarize') {
        actionType = 'summarize'
      } else if (body === '/plan') {
        actionType = 'plan'
      } else if (body === '/complete') {
        actionType = 'complete'
      } else if (commentAuthor !== 'claude[bot]' && commentAuthor !== 'nopo-bot') {
        // Human comment - always respond
        actionType = 'respond'
      } else if (isTopLevel && commentBody.includes('## 🔍 Research:')) {
        // Bot's top-level research thread - trigger investigation
        actionType = 'respond'
        core.info('Triggering response for bot research thread')
      } else {
        // Skip bot's reply comments (prevent infinite loop)
        core.info('Skipping bot reply comment to prevent infinite loop')
        setOutputs({
          action_type: 'skipped',
          discussion_number: String(discussionNumber),
          skipped: 'true',
        })
        return
      }
    }

    if (!discussionNumber || !discussionTitle) {
      throw new Error('Could not extract discussion information from event payload')
    }

    // Dispatch to handler workflow
    const dispatchPayload: DispatchPayload = {
      action_type: actionType,
      discussion_number: discussionNumber,
      discussion_title: discussionTitle,
      discussion_body: discussionBody ?? '',
      comment_id: commentId,
      comment_body: commentBody,
      comment_author: commentAuthor,
    }

    await octokit.rest.repos.createDispatchEvent({
      owner: context.repo.owner,
      repo: context.repo.repo,
      event_type: 'discussion_event',
      client_payload: dispatchPayload as unknown as { [key: string]: unknown },
    })

    core.info(`Dispatched ${actionType} event for discussion #${discussionNumber}`)

    setOutputs({
      action_type: actionType,
      discussion_number: String(discussionNumber),
      skipped: 'false',
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
