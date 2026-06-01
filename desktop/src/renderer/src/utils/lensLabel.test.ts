import { describe, expect, it } from 'vitest'

import { lensAutoLabel, lensDisplayLabel } from './lensLabel'

describe('lensLabel', () => {
  it('lensAutoLabel — lithology + 1-based stacking number', () => {
    expect(lensAutoLabel('ZAND', 0)).toBe('ZAND 1')
    expect(lensAutoLabel('KLEI', 2)).toBe('KLEI 3')
  })

  it('lensDisplayLabel — explicit name wins over the auto-label', () => {
    expect(lensDisplayLabel('My lens', 'ZAND', 0)).toBe('My lens')
  })

  it('lensDisplayLabel — falls back to the auto-label when name is null/blank', () => {
    expect(lensDisplayLabel(null, 'ZAND', 0)).toBe('ZAND 1')
    expect(lensDisplayLabel('   ', 'KLEI', 1)).toBe('KLEI 2')
    expect(lensDisplayLabel(undefined, 'VEEN', 4)).toBe('VEEN 5')
  })
})
