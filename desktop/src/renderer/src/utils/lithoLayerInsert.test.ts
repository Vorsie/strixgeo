// Unit pins for insertLithoLayer (debt #85).
//
// Pure-helper tests so the index-shift math is netted without
// rendering. The full gesture flow (boundary hit-strip → menu →
// picker → callback) is covered by the LithoSuggestionGhostColumns
// component-level tests.

import { describe, expect, it } from 'vitest'

import type { LithoLayerSuggestion } from '../api/client'
import type { BulkAnchorGhost } from '../hooks/useGeologicalModel'
import { insertLithoLayer } from './lithoLayerInsert'

function L(top: number, base: number, overrides?: Partial<LithoLayerSuggestion>): LithoLayerSuggestion {
  return {
    depth_top_m: top,
    depth_base_m: base,
    suggested_lithology: 'ZAND',
    suggested_nad_class: 8,
    mean_qc_mpa: 10,
    dr_pct: 60,
    confidence: 'high',
    source: 'cpt_robertson_2015',
    suggested_admixtures: [],
    parent_formation_id: 'geo-a',
    spans_boundary: false,
    ...overrides,
  }
}

function ghost(
  suggestions: LithoLayerSuggestion[],
  options: {
    accepted?: ReadonlySet<number>
    rejected?: ReadonlySet<number>
    edits?: ReadonlyMap<number, { depth_top_m?: number; depth_base_m?: number }>
  } = {},
): BulkAnchorGhost {
  return {
    kind: 'cpt',
    suggestions,
    surfaceElevationM: 10,
    accepted: options.accepted ?? new Set(),
    rejected: options.rejected ?? new Set(),
    edits: options.edits ?? new Map(),
  }
}

describe('insertLithoLayer (debt #85)', () => {
  it('I1 — inserted layer takes the upper half of the lower neighbour', () => {
    const g = ghost([L(0, 2), L(2, 4), L(4, 6)])
    const next = insertLithoLayer(g, 0, {
      suggested_lithology: 'KLEI',
      suggested_admixtures: [],
    })
    expect(next.suggestions).toHaveLength(4)
    const inserted = next.suggestions[1]
    // Lower neighbour was [2, 4]; the new layer takes [2, 3] (upper half).
    expect(inserted.depth_top_m).toBe(2)
    expect(inserted.depth_base_m).toBe(3)
    expect(inserted.suggested_lithology).toBe('KLEI')
    expect(inserted.confidence).toBe('high')
    expect(inserted.source).toBe('manual_pick')
  })

  it('I2 — lower neighbour gets a depth_top edit at the new layer base', () => {
    const g = ghost([L(0, 2), L(2, 4), L(4, 6)])
    const next = insertLithoLayer(g, 0, {
      suggested_lithology: 'KLEI',
      suggested_admixtures: [],
    })
    // Original layer 1 (now at index 2 after shift) — its depth_top
    // edit was patched to the new layer's base (the midpoint, 3).
    const lowerEdit = next.edits.get(2)
    expect(lowerEdit?.depth_top_m).toBe(3)
  })

  it('I3 — accepted/rejected indices above afterIdx shift by +1', () => {
    const g = ghost(
      [L(0, 2), L(2, 4), L(4, 6), L(6, 8)],
      { accepted: new Set([3]), rejected: new Set([2]) },
    )
    // Insert between idx 0 and 1 — every index > 0 shifts by 1.
    const next = insertLithoLayer(g, 0, {
      suggested_lithology: 'KLEI',
      suggested_admixtures: [],
    })
    expect([...next.accepted]).toEqual([4]) // was 3
    expect([...next.rejected]).toEqual([3]) // was 2
  })

  it('I4 — indices at or below afterIdx are unchanged', () => {
    const g = ghost(
      [L(0, 2), L(2, 4), L(4, 6)],
      { accepted: new Set([0]) },
    )
    // Insert between idx 1 and 2 — accepted[0] stays at 0.
    const next = insertLithoLayer(g, 1, {
      suggested_lithology: 'KLEI',
      suggested_admixtures: [],
    })
    expect([...next.accepted]).toEqual([0])
  })

  it('I5 — existing edits Map keys above afterIdx shift; below stay', () => {
    const edits = new Map<number, { depth_top_m?: number; depth_base_m?: number }>([
      [0, { depth_base_m: 1.8 }],
      [2, { depth_top_m: 4.2 }],
    ])
    const g = ghost([L(0, 2), L(2, 4), L(4, 6)], { edits })
    // Insert between idx 0 and 1. Key 0 stays; key 2 shifts to 3.
    // The (shifted) lower neighbour's depth_top edit at key 2 is
    // overwritten with the sentinel boundary (the patched depth_top
    // wins on the immediate-lower neighbour).
    const next = insertLithoLayer(g, 0, {
      suggested_lithology: 'KLEI',
      suggested_admixtures: [],
    })
    expect(next.edits.get(0)?.depth_base_m).toBe(1.8)
    expect(next.edits.get(3)?.depth_top_m).toBe(4.2)
  })

  it('I6 — upper neighbour with edited depth_base_m drives the shared_boundary', () => {
    // The user has dragged layer 0's BASE to 2.5m (via edits). The new
    // shared_boundary is therefore 2.5, not the segmenter's 2.0.
    const edits = new Map<number, { depth_top_m?: number; depth_base_m?: number }>([
      [0, { depth_base_m: 2.5 }],
    ])
    const g = ghost([L(0, 2), L(2, 4)], { edits })
    const next = insertLithoLayer(g, 0, {
      suggested_lithology: 'KLEI',
      suggested_admixtures: [],
    })
    expect(next.suggestions[1].depth_top_m).toBe(2.5)
    // Lower neighbour [2.5, 4] (edited top) → new layer takes [2.5, 3.25].
    expect(next.suggestions[1].depth_base_m).toBeCloseTo(3.25, 5)
  })

  it('I7 — new layer inherits parent_formation_id from upper neighbour', () => {
    const g = ghost([
      L(0, 2, { parent_formation_id: 'geo-x' }),
      L(2, 4, { parent_formation_id: 'geo-x' }),
    ])
    const next = insertLithoLayer(g, 0, {
      suggested_lithology: 'KLEI',
      suggested_admixtures: [],
    })
    expect(next.suggestions[1].parent_formation_id).toBe('geo-x')
    expect(next.suggestions[1].spans_boundary).toBe(false)
  })
})
