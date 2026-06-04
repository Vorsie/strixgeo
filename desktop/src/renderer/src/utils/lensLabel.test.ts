import { describe, expect, it } from 'vitest'

import {
  computeDepthStacking,
  lensAutoLabel,
  lensDisplayLabel,
  lithologyAbbrev,
} from './lensLabel'

describe('lensLabel', () => {
  it('lensAutoLabel — base + depth rank, no separator', () => {
    expect(lensAutoLabel('QPSa', 1)).toBe('QPSa1')
    expect(lensAutoLabel('QHC', 3)).toBe('QHC3')
  })

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

  it('lensDisplayLabel — explicit name wins over the auto-label', () => {
    expect(lensDisplayLabel('My lens', 'QPSa', 1)).toBe('My lens')
  })

  it('lensDisplayLabel — falls back to the auto-label when name is null/blank', () => {
    expect(lensDisplayLabel(null, 'QPSa', 1)).toBe('QPSa1')
    expect(lensDisplayLabel('   ', 'QHC', 2)).toBe('QHC2')
  })

  it('computeDepthStacking — shallowest = 1, deepest = N within a label group', () => {
    const ranks = computeDepthStacking([
      { id: 'b-mid', label: 'QPSa', depth: 5 },
      { id: 'b-deep', label: 'QPSa', depth: 9 },
      { id: 'b-shallow', label: 'QPSa', depth: 2 },
    ])
    expect(ranks.get('b-shallow')).toBe(1)
    expect(ranks.get('b-mid')).toBe(2)
    expect(ranks.get('b-deep')).toBe(3)
  })

  it('computeDepthStacking — ranks are independent per formation label', () => {
    const ranks = computeDepthStacking([
      { id: 'd1', label: 'QPSa', depth: 4 },
      { id: 's1', label: 'QHC', depth: 8 },
      { id: 's2', label: 'QHC', depth: 12 },
    ])
    expect(ranks.get('d1')).toBe(1)
    expect(ranks.get('s1')).toBe(1)
    expect(ranks.get('s2')).toBe(2)
  })
})
