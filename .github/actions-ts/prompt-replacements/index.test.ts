import { describe, expect, it } from 'vitest'
import { buildReplacements } from './index.js'

describe('buildReplacements', () => {
  it('handles simple key=value pairs', () => {
    const result = buildReplacements('ISSUE_NUMBER=123\nISSUE_TITLE=Test')
    expect(JSON.parse(result)).toEqual({
      ISSUE_NUMBER: '123',
      ISSUE_TITLE: 'Test',
    })
  })

  it('handles special characters in values - quotes', () => {
    const result = buildReplacements('TITLE=Test "quotes" in title')
    const parsed = JSON.parse(result)
    expect(parsed.TITLE).toBe('Test "quotes" in title')
  })

  it('handles special characters in values - braces', () => {
    const result = buildReplacements('TITLE=Test {braces} and {more}')
    const parsed = JSON.parse(result)
    expect(parsed.TITLE).toBe('Test {braces} and {more}')
  })

  it('handles special characters in values - dollar signs', () => {
    const result = buildReplacements('TITLE=Test $variable and ${other}')
    const parsed = JSON.parse(result)
    expect(parsed.TITLE).toBe('Test $variable and ${other}')
  })

  it('handles template placeholders in values', () => {
    const result = buildReplacements('BODY=Issue with {{PLACEHOLDER}} syntax')
    const parsed = JSON.parse(result)
    expect(parsed.BODY).toBe('Issue with {{PLACEHOLDER}} syntax')
  })

  it('handles newlines in issue body', () => {
    const multilineBody = 'Line 1'
    const result = buildReplacements(`BODY=${multilineBody}`)
    const parsed = JSON.parse(result)
    expect(parsed.BODY).toBe('Line 1')
  })

  it('handles empty values', () => {
    const result = buildReplacements('EMPTY=\nFOO=bar')
    const parsed = JSON.parse(result)
    expect(parsed.EMPTY).toBe('')
    expect(parsed.FOO).toBe('bar')
  })

  it('handles values with equals signs', () => {
    const result = buildReplacements('URL=https://example.com?foo=bar&baz=qux')
    const parsed = JSON.parse(result)
    expect(parsed.URL).toBe('https://example.com?foo=bar&baz=qux')
  })

  it('skips lines without equals sign', () => {
    const result = buildReplacements('FOO=bar\nnotakeyvalue\nBAZ=qux')
    const parsed = JSON.parse(result)
    expect(Object.keys(parsed)).toEqual(['FOO', 'BAZ'])
  })

  it('handles whitespace in keys', () => {
    const result = buildReplacements('  KEY  =value')
    const parsed = JSON.parse(result)
    expect(parsed.KEY).toBe('value')
  })

  it('preserves leading/trailing whitespace in values', () => {
    const result = buildReplacements('KEY=  value with spaces  ')
    const parsed = JSON.parse(result)
    expect(parsed.KEY).toBe('  value with spaces  ')
  })

  it('handles JSON in values', () => {
    const jsonValue = '{"nested": "json", "array": [1, 2, 3]}'
    const result = buildReplacements(`DATA=${jsonValue}`)
    const parsed = JSON.parse(result)
    expect(parsed.DATA).toBe(jsonValue)
  })

  it('handles backslashes in values', () => {
    const result = buildReplacements('PATH=C:\\Users\\test\\file.txt')
    const parsed = JSON.parse(result)
    expect(parsed.PATH).toBe('C:\\Users\\test\\file.txt')
  })

  it('handles unicode characters', () => {
    const result = buildReplacements('EMOJI=Hello 🚀 World')
    const parsed = JSON.parse(result)
    expect(parsed.EMOJI).toBe('Hello 🚀 World')
  })
})
