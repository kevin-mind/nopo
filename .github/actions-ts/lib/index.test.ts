import { describe, expect, it } from 'vitest'
import { parseEnvFile } from './index.js'

describe('parseEnvFile', () => {
  it('should parse simple key=value pairs', () => {
    const content = `
FOO=bar
BAZ=qux
`
    const result = parseEnvFile(content)
    expect(result).toEqual({
      FOO: 'bar',
      BAZ: 'qux',
    })
  })

  it('should handle quoted values', () => {
    const content = `
DOCKER_TAG="my-image:latest"
DOCKER_REGISTRY='gcr.io/my-project'
`
    const result = parseEnvFile(content)
    expect(result).toEqual({
      DOCKER_TAG: 'my-image:latest',
      DOCKER_REGISTRY: 'gcr.io/my-project',
    })
  })

  it('should skip empty lines and comments', () => {
    const content = `
# This is a comment
FOO=bar

# Another comment
BAZ=qux
`
    const result = parseEnvFile(content)
    expect(result).toEqual({
      FOO: 'bar',
      BAZ: 'qux',
    })
  })

  it('should handle values with equals signs', () => {
    const content = `
DATABASE_URL=postgres://user:pass@host:5432/db?sslmode=require
`
    const result = parseEnvFile(content)
    expect(result).toEqual({
      DATABASE_URL: 'postgres://user:pass@host:5432/db?sslmode=require',
    })
  })

  it('should handle empty values', () => {
    const content = `
EMPTY=
FOO=bar
`
    const result = parseEnvFile(content)
    expect(result).toEqual({
      EMPTY: '',
      FOO: 'bar',
    })
  })

  it('should handle whitespace in values', () => {
    const content = `
MESSAGE="Hello World"
`
    const result = parseEnvFile(content)
    expect(result).toEqual({
      MESSAGE: 'Hello World',
    })
  })
})
