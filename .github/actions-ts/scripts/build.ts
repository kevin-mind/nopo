import * as esbuild from 'esbuild'
import * as fs from 'node:fs'
import * as path from 'node:path'

const actionsDir = path.dirname(import.meta.dirname)
const isWatch = process.argv.includes('--watch')

// Find all action directories (those with action.yml and index.ts)
function findActions(): string[] {
  const entries = fs.readdirSync(actionsDir, { withFileTypes: true })
  const actions: string[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name === 'node_modules' || entry.name === 'scripts' || entry.name === 'lib') continue

    const actionYml = path.join(actionsDir, entry.name, 'action.yml')
    const indexTs = path.join(actionsDir, entry.name, 'index.ts')

    if (fs.existsSync(actionYml) && fs.existsSync(indexTs)) {
      actions.push(entry.name)
    }
  }

  return actions
}

async function build() {
  const actions = findActions()

  if (actions.length === 0) {
    console.log('No actions found to build')
    return
  }

  console.log(`Building ${actions.length} actions: ${actions.join(', ')}`)

  const buildConfigs = actions.map((action) => ({
    entryPoints: [path.join(actionsDir, action, 'index.ts')],
    bundle: true,
    platform: 'node' as const,
    target: 'node20',
    outfile: path.join(actionsDir, action, 'dist', 'index.js'),
    format: 'esm' as const,
    sourcemap: true,
    minify: false,
    // Bundle all dependencies into the output
    external: [],
    banner: {
      js: '// This file is auto-generated. Do not edit directly.',
    },
  }))

  if (isWatch) {
    console.log('Watching for changes...')
    const contexts = await Promise.all(buildConfigs.map((config) => esbuild.context(config)))
    await Promise.all(contexts.map((ctx) => ctx.watch()))
  } else {
    await Promise.all(buildConfigs.map((config) => esbuild.build(config)))
    console.log('Build complete!')
  }
}

build().catch((err) => {
  console.error(err)
  process.exit(1)
})
