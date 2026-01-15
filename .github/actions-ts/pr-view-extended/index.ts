import * as core from '@actions/core'
import { execCommand, getOptionalInput, getRequiredInput, setOutputs } from '../lib/index.js'

interface PrViewInputs {
  ghToken: string
  headBranch?: string
  prNumber?: string
  repository: string
}

interface PrData {
  number: number
  isDraft: boolean
  author: { login: string }
  headRefName: string
  body: string | null
}

interface PrViewOutputs extends Record<string, string> {
  has_pr: string
  is_claude_pr: string
  is_draft: string
  pr_number: string
  pr_head_branch: string
  pr_body: string
  has_issue: string
  issue_number: string
}

function getInputs(): PrViewInputs {
  return {
    ghToken: getRequiredInput('gh_token'),
    headBranch: getOptionalInput('head_branch'),
    prNumber: getOptionalInput('pr_number'),
    repository: getOptionalInput('repository') ?? process.env.GITHUB_REPOSITORY ?? '',
  }
}

function isClaudePr(author: string, headBranch: string): boolean {
  return author === 'claude[bot]' || headBranch.startsWith('claude/')
}

function extractIssueNumber(body: string): string | undefined {
  // Match patterns like: Fixes #123, Closes #456, Resolves #789
  const match = body.match(/(?:Fixes|Closes|Resolves)\s+#(\d+)/i)
  return match?.[1]
}

async function fetchPrByNumber(repository: string, prNumber: string): Promise<PrData | null> {
  const { stdout, exitCode } = await execCommand('gh', [
    'pr',
    'view',
    prNumber,
    '--repo',
    repository,
    '--json',
    'number,isDraft,author,headRefName,body',
  ], { ignoreReturnCode: true })

  if (exitCode !== 0 || !stdout) {
    return null
  }

  try {
    return JSON.parse(stdout) as PrData
  } catch {
    return null
  }
}

async function fetchPrByBranch(repository: string, headBranch: string): Promise<PrData | null> {
  const { stdout, exitCode } = await execCommand('gh', [
    'pr',
    'list',
    '--repo',
    repository,
    '--head',
    headBranch,
    '--json',
    'number,isDraft,author,headRefName,body',
    '--jq',
    '.[0]',
  ], { ignoreReturnCode: true })

  if (exitCode !== 0 || !stdout || stdout === 'null') {
    return null
  }

  try {
    return JSON.parse(stdout) as PrData
  } catch {
    return null
  }
}

function emptyOutputs(): PrViewOutputs {
  return {
    has_pr: 'false',
    is_claude_pr: 'false',
    is_draft: 'false',
    pr_number: '',
    pr_head_branch: '',
    pr_body: '',
    has_issue: 'false',
    issue_number: '',
  }
}

async function run(): Promise<void> {
  try {
    const inputs = getInputs()

    // Set GH_TOKEN for gh CLI
    process.env.GH_TOKEN = inputs.ghToken

    // Validate inputs
    if (!inputs.prNumber && !inputs.headBranch) {
      core.setFailed('Either pr_number or head_branch must be provided')
      return
    }

    if (!inputs.repository) {
      core.setFailed('repository must be provided or GITHUB_REPOSITORY must be set')
      return
    }

    // Fetch PR data
    let pr: PrData | null = null

    if (inputs.prNumber) {
      pr = await fetchPrByNumber(inputs.repository, inputs.prNumber)
    } else if (inputs.headBranch) {
      pr = await fetchPrByBranch(inputs.repository, inputs.headBranch)
    }

    // Handle no PR found
    if (!pr) {
      core.info('No PR found')
      setOutputs(emptyOutputs())
      return
    }

    // Extract data
    const body = pr.body ?? ''
    const author = pr.author.login
    const headBranch = pr.headRefName
    const claudePr = isClaudePr(author, headBranch)
    const issueNumber = extractIssueNumber(body)

    // Build outputs
    const outputs: PrViewOutputs = {
      has_pr: 'true',
      is_claude_pr: claudePr ? 'true' : 'false',
      is_draft: pr.isDraft ? 'true' : 'false',
      pr_number: String(pr.number),
      pr_head_branch: headBranch,
      pr_body: body,
      has_issue: issueNumber ? 'true' : 'false',
      issue_number: issueNumber ?? '',
    }

    setOutputs(outputs)

    // Log summary
    core.info(`Found PR #${pr.number}`)
    core.info(`  Draft: ${outputs.is_draft}`)
    core.info(`  Claude PR: ${outputs.is_claude_pr}`)
    core.info(`  Author: ${author}`)
    core.info(`  Branch: ${headBranch}`)
    if (issueNumber) {
      core.info(`  Linked Issue: #${issueNumber}`)
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message)
    } else {
      core.setFailed('An unexpected error occurred')
    }
  }
}

run()
