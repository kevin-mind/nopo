import * as core from '@actions/core'
import { getRequiredInput, setOutputs } from '../lib/index.js'

/**
 * Build a JSON object from newline-separated KEY=VALUE pairs.
 * Handles special characters in values safely via JSON.stringify.
 */
export function buildReplacements(pairs: string): string {
  const result: Record<string, string> = {}
  const lines = pairs.split('\n')

  for (const line of lines) {
    // Find first = to split key from value
    const idx = line.indexOf('=')
    if (idx === -1) continue

    const key = line.slice(0, idx).trim()
    // Don't trim value - preserve whitespace (important for multiline content)
    const value = line.slice(idx + 1)

    if (key) {
      result[key] = value
    }
  }

  // JSON.stringify handles all escaping properly
  return JSON.stringify(result)
}

async function run(): Promise<void> {
  try {
    const pairs = getRequiredInput('pairs')
    const json = buildReplacements(pairs)

    core.info(`Built replacements JSON (${Object.keys(JSON.parse(json)).length} keys)`)
    core.debug(`JSON: ${json}`)

    setOutputs({ json })
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message)
    }
  }
}

run()
