/** Project key → palette index, in order of first appearance (spec "Colours"). */
import { PROJECT_PALETTE } from './sheetConstants'

/** Sentinel for investigations whose name carries no project. Rendered through i18n. */
export const NO_PROJECT_KEY = ' no-project'

export function normaliseProjectKey(key: string): string {
  return key === '' ? NO_PROJECT_KEY : key
}

/**
 * Parameters
 * ----------
 * keysInOrder : the project key of every investigation, on-profile ones first
 *   in A → A′ order, then the off-profile map points.
 */
export function assignProjectColours(keysInOrder: readonly string[]): Map<string, number> {
  const index = new Map<string, number>()
  for (const raw of keysInOrder) {
    const key = normaliseProjectKey(raw)
    if (!index.has(key)) index.set(key, index.size % PROJECT_PALETTE.length)
  }
  return index
}

export function projectColour(colourIndex: number): string {
  return PROJECT_PALETTE[colourIndex % PROJECT_PALETTE.length]
}
