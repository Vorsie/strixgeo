import { describe, expect, it } from 'vitest'

import { computeDepthStacking, lensAutoLabel, lensDisplayLabel } from './lensLabel'

describe('lensLabel', () => {
  it('lensAutoLabel — formation + depth rank', () => {
    expect(lensAutoLabel('Diest', 1)).toBe('Diest 1')
    expect(lensAutoLabel('Boom', 3)).toBe('Boom 3')
  })

  it('lensDisplayLabel — explicit name wins over the auto-label', () => {
    expect(lensDisplayLabel('My lens', 'Diest', 1)).toBe('My lens')
  })

  it('lensDisplayLabel — falls back to the auto-label when name is null/blank', () => {
    expect(lensDisplayLabel(null, 'Diest', 1)).toBe('Diest 1')
    expect(lensDisplayLabel('   ', 'Boom', 2)).toBe('Boom 2')
    expect(lensDisplayLabel(undefined, 'Kasterlee', 5)).toBe('Kasterlee 5')
  })

  it('computeDepthStacking — shallowest = 1, deepest = N within a label group', () => {
    const ranks = computeDepthStacking([
      { id: 'b-mid', label: 'Diest', depth: 5 },
      { id: 'b-deep', label: 'Diest', depth: 9 },
      { id: 'b-shallow', label: 'Diest', depth: 2 },
    ])
    expect(ranks.get('b-shallow')).toBe(1)
    expect(ranks.get('b-mid')).toBe(2)
    expect(ranks.get('b-deep')).toBe(3)
  })

  it('computeDepthStacking — ranks are independent per formation label', () => {
    const ranks = computeDepthStacking([
      { id: 'd1', label: 'Diest', depth: 4 },
      { id: 's1', label: 'Boom', depth: 8 },
      { id: 's2', label: 'Boom', depth: 12 },
    ])
    expect(ranks.get('d1')).toBe(1) // only Diest body → 1
    expect(ranks.get('s1')).toBe(1) // shallower Boom
    expect(ranks.get('s2')).toBe(2) // deeper Boom
  })
})
