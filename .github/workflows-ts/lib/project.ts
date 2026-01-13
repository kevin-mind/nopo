/**
 * Project field IDs and mappings for GitHub Project V2.
 * These are hardcoded IDs from the nopo project board.
 */

// Project field IDs
export const PROJECT_FIELD_IDS = {
  PRIORITY: 'PVTSSF_lADOBBYMds4BMB5szg7bd4o',
  SIZE: 'PVTSSF_lADOBBYMds4BMB5szg7bd4s',
  ESTIMATE: 'PVTF_lADOBBYMds4BMB5szg7bd4w',
  STATUS: 'PVTSSF_lADOBBYMds4BMB5szg7be5k',
} as const

// Priority field option IDs
export const PRIORITY_OPTIONS = {
  P0_CRITICAL: '79628723',
  P1_HIGH: '0a877460',
  P2_NORMAL: 'da944a9c',
} as const

// Size field option IDs
export const SIZE_OPTIONS = {
  XS: '6c6483d2',
  S: 'f784b110',
  M: '7515a9f1',
  L: '817d0097',
  XL: 'db339eb2',
} as const

// Status field option IDs
export const STATUS_OPTIONS = {
  READY: 'f75ad846',
  IN_PROGRESS: '47fc9ee4',
  IN_REVIEW: 'faf3f113',
  DONE: '98236657',
} as const

/**
 * Maps triage priority string to project field option ID
 */
export const priorityToOptionId = (priority: string | null): string => {
  switch (priority) {
    case 'critical':
      return PRIORITY_OPTIONS.P0_CRITICAL
    case 'high':
      return PRIORITY_OPTIONS.P1_HIGH
    default:
      return PRIORITY_OPTIONS.P2_NORMAL
  }
}

/**
 * Maps triage size string to project field option ID
 */
export const sizeToOptionId = (size: string): string => {
  const map: Record<string, string> = {
    xs: SIZE_OPTIONS.XS,
    s: SIZE_OPTIONS.S,
    m: SIZE_OPTIONS.M,
    l: SIZE_OPTIONS.L,
    xl: SIZE_OPTIONS.XL,
  }
  return map[size.toLowerCase()] ?? SIZE_OPTIONS.M
}
