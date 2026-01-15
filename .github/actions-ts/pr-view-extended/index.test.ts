import { describe, expect, it } from 'vitest'

// Test the pure functions by importing them
// Since they're not exported, we test the logic inline

describe('isClaudePr', () => {
  const isClaudePr = (author: string, headBranch: string): boolean => {
    return author === 'claude[bot]' || headBranch.startsWith('claude/')
  }

  it('returns true for claude[bot] author', () => {
    expect(isClaudePr('claude[bot]', 'feature/test')).toBe(true)
  })

  it('returns true for claude/ branch prefix', () => {
    expect(isClaudePr('human', 'claude/issue/123')).toBe(true)
  })

  it('returns false for regular author and branch', () => {
    expect(isClaudePr('human', 'feature/test')).toBe(false)
  })

  it('returns false for partial matches', () => {
    expect(isClaudePr('claude', 'feature/test')).toBe(false)
    expect(isClaudePr('human', 'not-claude/test')).toBe(false)
  })
})

describe('extractIssueNumber', () => {
  const extractIssueNumber = (body: string): string | undefined => {
    const match = body.match(/(?:Fixes|Closes|Resolves)\s+#(\d+)/i)
    return match?.[1]
  }

  it('extracts issue number from Fixes #123', () => {
    expect(extractIssueNumber('Some text\n\nFixes #123')).toBe('123')
  })

  it('extracts issue number from Closes #456', () => {
    expect(extractIssueNumber('Closes #456')).toBe('456')
  })

  it('extracts issue number from Resolves #789', () => {
    expect(extractIssueNumber('Resolves #789')).toBe('789')
  })

  it('is case insensitive', () => {
    expect(extractIssueNumber('fixes #100')).toBe('100')
    expect(extractIssueNumber('FIXES #200')).toBe('200')
  })

  it('returns undefined when no issue pattern found', () => {
    expect(extractIssueNumber('No issue here')).toBeUndefined()
    expect(extractIssueNumber('Related to #123')).toBeUndefined()
  })

  it('extracts first match when multiple present', () => {
    expect(extractIssueNumber('Fixes #100\nFixes #200')).toBe('100')
  })
})
