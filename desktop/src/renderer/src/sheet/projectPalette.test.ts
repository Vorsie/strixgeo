import { describe, expect, it } from 'vitest'
import { assignProjectColours, NO_PROJECT_KEY } from './projectPalette'
import { PROJECT_PALETTE } from './sheetConstants'

describe('assignProjectColours — one colour per project, by first appearance from A', () => {
  it('numbers projects in the order they are first met', () => {
    const idx = assignProjectColours(['GEO-2', 'GEO-1', 'GEO-2', 'GEO-3'])
    expect(idx.get('GEO-2')).toBe(0)
    expect(idx.get('GEO-1')).toBe(1)
    expect(idx.get('GEO-3')).toBe(2)
  })
  it('cycles after the palette is exhausted', () => {
    const keys = Array.from({ length: PROJECT_PALETTE.length + 1 }, (_, i) => `P${i}`)
    const idx = assignProjectColours(keys)
    expect(idx.get(`P${PROJECT_PALETTE.length}`)).toBe(0)
  })
  it('an empty key groups under the no-project key', () => {
    const idx = assignProjectColours(['', 'GEO-1', ''])
    expect(idx.get(NO_PROJECT_KEY)).toBe(0)
    expect(idx.get('GEO-1')).toBe(1)
    expect(idx.size).toBe(2)
  })
})
