// Unit pins for splitLithoLayer (debt #98).
//
// Pure-helper tests so the index-shift math is netted without
// rendering. The full gesture flow (right-click → menu → split) is
// covered by the LithoSuggestionGhostColumns component-level tests.

import { describe, expect, it } from 'vitest'

import type { LithoLayerSuggestion } from '../api/client'
import type { BulkAnchorGhost } from '../hooks/useGeologicalModel'
import { splitLithoLayer } from './lithoLayerSplit'

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
    edits?: ReadonlyMap<
      number,
      {
        depth_top_m?: number
        depth_base_m?: number
        suggested_lithology?: string
        suggested_admixtures?: readonly { soil_code: string; amount: string; locally: boolean }[]
      }
    >
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

describe('splitLithoLayer (debt #98)', () => {
  it('S1 — splits at the midpoint; both halves inherit lithology + admixtures', () => {
    const g = ghost([L(0, 2), L(2, 4, { suggested_lithology: 'KLEI' }), L(4, 6)])
    const next = splitLithoLayer(g, 1)
    expect(next.suggestions).toHaveLength(4)
    // Upper half stays at idx 1; its base is edited down to the midpoint.
    expect(next.suggestions[1].depth_top_m).toBe(2)
    expect(next.suggestions[1].suggested_lithology).toBe('KLEI')
    expect(next.edits.get(1)?.depth_base_m).toBe(3)
    // Lower half is the new layer at idx 2 — inherits the composition,
    // gets manual_pick semantics + spans_boundary cleared.
    const lower = next.suggestions[2]
    expect(lower.depth_top_m).toBe(3)
    expect(lower.depth_base_m).toBe(4)
    expect(lower.suggested_lithology).toBe('KLEI')
    expect(lower.source).toBe('manual_pick')
    expect(lower.spans_boundary).toBe(false)
  })

  it('S2 — accepted / rejected indices above the split shift by +1', () => {
    const g = ghost(
      [L(0, 2), L(2, 4), L(4, 6), L(6, 8)],
      { accepted: new Set([3]), rejected: new Set([2]) },
    )
    // Split idx 1; every index > 1 shifts by +1.
    const next = splitLithoLayer(g, 1)
    expect([...next.accepted]).toEqual([4]) // was 3
    expect([...next.rejected]).toEqual([3]) // was 2
  })

  it('S3 — indices at or below the split index are unchanged', () => {
    const g = ghost([L(0, 2), L(2, 4), L(4, 6)], { accepted: new Set([0]) })
    const next = splitLithoLayer(g, 1)
    expect([...next.accepted]).toEqual([0])
  })

  it('S4 — existing edits Map keys shift; idx keeps its lithology edit and gets its base edited', () => {
    const edits = new Map<
      number,
      { depth_top_m?: number; depth_base_m?: number; suggested_lithology?: string }
    >([
      [1, { suggested_lithology: 'KLEI' }],
      [2, { depth_top_m: 4.2 }],
    ])
    const g = ghost([L(0, 2), L(2, 4), L(4, 6)], { edits })
    const next = splitLithoLayer(g, 1)
    // idx 1's lithology edit is preserved AND its depth_base_m is set
    // to the midpoint (3).
    expect(next.edits.get(1)?.suggested_lithology).toBe('KLEI')
    expect(next.edits.get(1)?.depth_base_m).toBe(3)
    // The edit that was at key 2 shifts to key 3.
    expect(next.edits.get(3)?.depth_top_m).toBe(4.2)
  })

  it('S5 — the new layer inherits idx\'s EFFECTIVE composition (raw merged with edit)', () => {
    // Raw says ZAND with no admixtures; edit changes it to KLEI with a
    // silt admixture. Both halves must reflect the EFFECTIVE values.
    const edits = new Map<
      number,
      {
        suggested_lithology?: string
        suggested_admixtures?: readonly { soil_code: string; amount: string; locally: boolean }[]
      }
    >([
      [
        0,
        {
          suggested_lithology: 'KLEI',
          suggested_admixtures: [{ soil_code: 'SL', amount: 'M', locally: false }],
        },
      ],
    ])
    const g = ghost([L(0, 4)], { edits })
    const next = splitLithoLayer(g, 0)
    expect(next.suggestions).toHaveLength(2)
    // Upper half: still idx 0, lithology edit preserved.
    expect(next.edits.get(0)?.suggested_lithology).toBe('KLEI')
    // Lower half (new): RAW suggested_lithology IS the effective KLEI
    // (no edit needed — it was baked in at creation).
    expect(next.suggestions[1].suggested_lithology).toBe('KLEI')
    expect(next.suggestions[1].suggested_admixtures).toEqual([
      { soil_code: 'SL', amount: 'M', locally: false },
    ])
  })

  it('S6 — split respects edited depth_top_m / depth_base_m when computing the midpoint', () => {
    // The user has dragged the layer's edges to [1, 5] via edits; the
    // midpoint must be 3, not the raw midpoint of 2.
    const edits = new Map<
      number,
      { depth_top_m?: number; depth_base_m?: number }
    >([[0, { depth_top_m: 1, depth_base_m: 5 }]])
    const g = ghost([L(0, 4)], { edits })
    const next = splitLithoLayer(g, 0)
    expect(next.edits.get(0)?.depth_base_m).toBe(3) // midpoint of [1, 5]
    expect(next.suggestions[1].depth_top_m).toBe(3)
    expect(next.suggestions[1].depth_base_m).toBe(5)
  })

  it('S7 — admixture arrays on the new layer are cloned, not shared by reference', () => {
    const sourceAdmix = [{ soil_code: 'SL', amount: 'M', locally: false }]
    const g = ghost([L(0, 2, { suggested_admixtures: sourceAdmix })])
    const next = splitLithoLayer(g, 0)
    const lowerAdmix = next.suggestions[1].suggested_admixtures
    // Same shape …
    expect(lowerAdmix).toEqual(sourceAdmix)
    // … but a fresh copy — mutating the source must not leak.
    ;(sourceAdmix[0] as { amount: string }).amount = 'V'
    expect(lowerAdmix[0].amount).toBe('M')
  })
})
