import * as core from '@actions/core'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { execCommand, getOptionalInput, parseEnvFile, setOutputs } from '../lib/index.js'

interface DockerTagInputs {
  skipClean: boolean
  tag?: string
  registry?: string
  image?: string
  version?: string
  digest?: string
  target?: string
  nodeEnv?: string
}

interface DockerTagOutputs {
  DOCKER_TAG?: string
  DOCKER_REGISTRY?: string
  DOCKER_IMAGE?: string
  DOCKER_VERSION?: string
  DOCKER_DIGEST?: string
  DOCKER_TARGET?: string
  NODE_ENV?: string
}

function getInputs(): DockerTagInputs {
  return {
    skipClean: getOptionalInput('skip_clean') !== undefined,
    tag: getOptionalInput('tag'),
    registry: getOptionalInput('registry'),
    image: getOptionalInput('image'),
    version: getOptionalInput('version'),
    digest: getOptionalInput('digest'),
    target: getOptionalInput('target'),
    nodeEnv: getOptionalInput('node_env'),
  }
}

function computeTag(inputs: DockerTagInputs): string | undefined {
  // If tag is provided, use it
  if (inputs.tag) {
    return inputs.tag
  }
  // Compute tag from registry/image/version
  if (inputs.registry && inputs.image && inputs.version) {
    return `${inputs.registry}/${inputs.image}:${inputs.version}`
  }
  return undefined
}

async function run(): Promise<void> {
  try {
    const inputs = getInputs()
    const tag = computeTag(inputs)

    // Remove .env file unless skip_clean is set
    const envPath = path.join(process.cwd(), '.env')
    if (!inputs.skipClean && fs.existsSync(envPath)) {
      core.info('Removing .env file')
      fs.unlinkSync(envPath)
    }

    // Build make env command with arguments
    const makeArgs = ['env']
    const envVars: string[] = []

    if (tag) envVars.push(`DOCKER_TAG=${tag}`)
    if (inputs.registry) envVars.push(`DOCKER_REGISTRY=${inputs.registry}`)
    if (inputs.image) envVars.push(`DOCKER_IMAGE=${inputs.image}`)
    if (inputs.version) envVars.push(`DOCKER_VERSION=${inputs.version}`)
    if (inputs.digest) envVars.push(`DOCKER_DIGEST=${inputs.digest}`)
    if (inputs.target) envVars.push(`DOCKER_TARGET=${inputs.target}`)
    if (inputs.nodeEnv) envVars.push(`NODE_ENV=${inputs.nodeEnv}`)

    // Run make env with the provided variables
    await execCommand('make', [...makeArgs, ...envVars])

    // Read and parse the generated .env file
    if (!fs.existsSync(envPath)) {
      throw new Error('.env file was not created by make env')
    }

    const envContent = fs.readFileSync(envPath, 'utf-8')
    const envVarsFromFile = parseEnvFile(envContent)

    // Set outputs based on the .env file
    const outputs: DockerTagOutputs = {
      DOCKER_TAG: envVarsFromFile['DOCKER_TAG'],
      DOCKER_REGISTRY: envVarsFromFile['DOCKER_REGISTRY'],
      DOCKER_IMAGE: envVarsFromFile['DOCKER_IMAGE'],
      DOCKER_VERSION: envVarsFromFile['DOCKER_VERSION'],
      DOCKER_DIGEST: envVarsFromFile['DOCKER_DIGEST'],
      DOCKER_TARGET: envVarsFromFile['DOCKER_TARGET'],
      NODE_ENV: envVarsFromFile['NODE_ENV'],
    }

    // Map to action output names (lowercase)
    setOutputs({
      tag: outputs.DOCKER_TAG,
      registry: outputs.DOCKER_REGISTRY,
      image: outputs.DOCKER_IMAGE,
      version: outputs.DOCKER_VERSION,
      digest: outputs.DOCKER_DIGEST,
      target: outputs.DOCKER_TARGET,
      node_env: outputs.NODE_ENV,
    })

    core.info('Docker tag outputs set successfully')
    for (const [key, value] of Object.entries(outputs)) {
      if (value) {
        core.info(`  ${key}=${value}`)
      }
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
