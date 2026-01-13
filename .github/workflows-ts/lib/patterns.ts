// Common workflow defaults
export const defaultDefaults = {
  run: {
    shell: 'bash' as const,
  },
}

// Common permissions
export const readPermissions = {
  contents: 'read' as const,
}

export const buildPermissions = {
  packages: 'write' as const,
  contents: 'read' as const,
  attestations: 'write' as const,
  'id-token': 'write' as const,
}

export const testPermissions = {
  packages: 'read' as const,
  contents: 'read' as const,
}

export const deployPermissions = {
  contents: 'read' as const,
  packages: 'write' as const,
  attestations: 'write' as const,
  'id-token': 'write' as const,
}

export const versionPermissions = {
  contents: 'write' as const,
  packages: 'read' as const,
  'pull-requests': 'write' as const,
}

// Empty permissions (workflow level)
export const emptyPermissions = {}
