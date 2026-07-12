import { describe, expect, it } from 'vitest'

import { lithologyAbbrev } from './lensLabel'

describe('lensLabel', () => {
  it('lithologyAbbrev — core soils map to their owner-defined abbreviations', () => {
    expect(lithologyAbbrev('GRIND')).toBe('G')
    expect(lithologyAbbrev('SILT')).toBe('Si')
    expect(lithologyAbbrev('ZAND')).toBe('Sa')
    expect(lithologyAbbrev('KLEI')).toBe('C')
    expect(lithologyAbbrev('VEEN')).toBe('P')
  })

  it('lithologyAbbrev — unknown token falls back to first two chars; blank → empty', () => {
    expect(lithologyAbbrev('loam')).toBe('Lo')
    expect(lithologyAbbrev(null)).toBe('')
    expect(lithologyAbbrev('  ')).toBe('')
  })
})
