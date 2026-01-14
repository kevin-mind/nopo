import * as core from '@actions/core'
import * as glob from '@actions/glob'
import * as path from 'node:path'
import { getOptionalInput } from '../lib/index.js'

interface AppNamesInputs {
  environment: string
  app: string
}

function getInputs(): AppNamesInputs {
  return {
    environment: getOptionalInput('environment') ?? '*',
    app: getOptionalInput('app') ?? '*',
  }
}

async function run(): Promise<void> {
  try {
    const inputs = getInputs()

    // Build the glob pattern for fly configs
    const pattern = `fly/configs/nopo-${inputs.environment}-${inputs.app}.toml`
    core.info(`Searching for files matching: ${pattern}`)

    const globber = await glob.create(pattern)
    const files = await globber.glob()

    // Extract app names from filenames
    const appNames = files
      .map((file) => {
        const basename = path.basename(file, '.toml')
        return basename
      })
      .sort()

    // Remove duplicates
    const uniqueAppNames = [...new Set(appNames)]

    // Output as JSON array
    const jsonOutput = JSON.stringify(uniqueAppNames)
    core.setOutput('app_names', jsonOutput)

    core.info(`Found ${uniqueAppNames.length} app(s): ${jsonOutput}`)
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message)
    } else {
      core.setFailed('An unexpected error occurred')
    }
  }
}

run()
