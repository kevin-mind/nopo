import * as core from '@actions/core'
import { execCommand, getOptionalInput, getRequiredInput } from '../lib/index.js'

interface RunDockerInputs {
  tag: string
  service?: string
  run?: string
  target: string
  dir: string
}

function getInputs(): RunDockerInputs {
  return {
    tag: getRequiredInput('tag'),
    service: getOptionalInput('service'),
    run: getOptionalInput('run'),
    target: getOptionalInput('target') ?? 'production',
    dir: getOptionalInput('dir') ?? '.',
  }
}

async function run(): Promise<void> {
  try {
    const inputs = getInputs()

    // Build make command arguments
    const makeArgs: string[] = []
    const envVars = [`DOCKER_TAG=${inputs.tag}`, `DOCKER_TARGET=${inputs.target}`, 'DOCKER_PORT=80']

    if (inputs.run) {
      // Run mode: make ${run} ${service}
      makeArgs.push(inputs.run)
      if (inputs.service) {
        makeArgs.push(inputs.service)
      }
      core.info(`Running: make ${makeArgs.join(' ')} with tag=${inputs.tag}, target=${inputs.target}`)
    } else {
      // Up mode: make up
      makeArgs.push('up')
      core.info(`Running: make up with tag=${inputs.tag}, target=${inputs.target}`)
    }

    // Execute the command
    const { exitCode, stdout, stderr } = await execCommand('make', [...makeArgs, ...envVars], {
      cwd: inputs.dir,
    })

    if (stdout) {
      core.info(stdout)
    }

    if (exitCode !== 0) {
      if (stderr) {
        core.error(stderr)
      }
      throw new Error(`make command failed with exit code ${exitCode}`)
    }

    core.info('Docker command completed successfully')
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message)
    } else {
      core.setFailed('An unexpected error occurred')
    }
  }
}

run()
