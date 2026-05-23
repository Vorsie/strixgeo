// Unit pins for canMergeAt + mergeLithoLayers (debt #102).
//
// Pure-helper tests so the index-shift math + the lithology-match
// gate are netted without rendering. The full gesture flow (boundary
// right-click → menu → merge) is covered by the
// LithoSuggestionGhostColumns component-level tests.

import { describe, expect, it } from 'vitest'

import type { LithoLayerSuggestion } from '../api/client'
import type { BulkAnchorGhost } from '../hooks/useGeologicalModel'
import { canMergeAt, mergeLithoLayers } from './lithoLayerMerge'

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

describe('canMergeAt (debt #102)', () => {
  it('C1 — true when two adjacent pending layers share the same lithology', () => {
    const g = ghost([L(0, 2), L(2, 4)])
    expect(canMergeAt(g.suggestions, g.edits, g.accepted, g.rejected, 0)).toBe(true)
  })

  it('C2 — false when the two layers have different lithologies', () => {
    const g = ghost([L(0, 2), L(2, 4, { suggested_lithology: 'KLEI' })])
    expect(canMergeAt(g.suggestions, g.edits, g.accepted, g.rejected, 0)).toBe(false)
  })

  it('C3 — false when either neighbour is rejected or accepted', () => {
    const gReject = ghost([L(0, 2), L(2, 4)], { rejected: new Set([1]) })
    const gAccept = ghost([L(0, 2), L(2, 4)], { accepted: new Set([0]) })
    expect(canMergeAt(gReject.suggestions, gReject.edits, gReject.accepted, gReject.rejected, 0)).toBe(false)
    expect(canMergeAt(gAccept.suggestions, gAccept.edits, gAccept.accepted, gAccept.rejected, 0)).toBe(false)
  })

  it('C4 — false at the last index (no lower neighbour)', () => {
    const g = ghost([L(0, 2), L(2, 4)])
    expect(canMergeAt(g.suggestions, g.edits, g.accepted, g.rejected, 1)).toBe(false)
  })

  it('C5 — EDITED lithology counts as the effective lithology', () => {
    // Raw says ZAND/KLEI (different); edit changes upper to KLEI so
    // both effectively share KLEI.
    const edits = new Map([[0, { suggested_lithology: 'KLEI' }]])
    const g = ghost(
      [L(0, 2), L(2, 4, { suggested_lithology: 'KLEI' })],
      { edits },
    )
    expect(canMergeAt(g.suggestions, g.edits, g.accepted, g.rejected, 0)).toBe(true)
  })

  it('C6 — false for an out-of-range upperIdx', () => {
    const g = ghost([L(0, 2)])
    expect(canMergeAt(g.suggestions, g.edits, g.accepted, g.rejected, -1)).toBe(false)
    expect(canMergeAt(g.suggestions, g.edits, g.accepted, g.rejected, 5)).toBe(false)
  })
})

describe('mergeLithoLayers (debt #102)', () => {
  it('M1 — collapses two layers into one spanning their full combined extent', () => {
    const g = ghost([L(0, 2), L(2, 4), L(4, 6)])
    const next = mergeLithoLayers(g, 0)
    expect(next.suggestions).toHaveLength(2)
    // Upper layer stays at idx 0; its base extends to the lower's
    // base (4) via an edit. depth_top_m unchanged.
    expect(next.suggestions[0].depth_top_m).toBe(0)
    expect(next.edits.get(0)?.depth_base_m).toBe(4)
    // Original idx 2 (untouched) shifts down to idx 1.
    expect(next.suggestions[1].depth_top_m).toBe(4)
    expect(next.suggestions[1].depth_base_m).toBe(6)
  })

  it('M2 — accepted / rejected indices above the merged pair shift down by 1', () => {
    const g = ghost(
      [L(0, 2), L(2, 4), L(4, 6), L(6, 8)],
      { accepted: new Set([3]), rejected: new Set([2]) },
    )
    // Merge idx 0 + 1; indices > 1 shift down by 1.
    const next = mergeLithoLayers(g, 0)
    expect([...next.accepted]).toEqual([2]) // was 3
    expect([...next.rejected]).toEqual([1]) // was 2
  })

  it('M3 — indices at or below upperIdx unchanged', () => {
    const g = ghost([L(0, 2), L(2, 4), L(4, 6)])
    // Merge idx 1 + 2. idx 0 stays at 0.
    const next = mergeLithoLayers(g, 1)
    expect(next.suggestions).toHaveLength(2)
    expect(next.suggestions[0].depth_top_m).toBe(0)
    expect(next.suggestions[0].depth_base_m).toBe(2)
  })

  it('M4 — preserves the upper layer\'s lithology and admixture edits', () => {
    const edits = new Map<
      number,
      { suggested_lithology?: string; suggested_admixtures?: readonly { soil_code: string; amount: string; locally: boolean }[] }
    >([
      [
        0,
        {
          suggested_lithology: 'KLEI',
          suggested_admixtures: [{ soil_code: 'SL', amount: 'M', locally: false }],
        },
      ],
    ])
    const g = ghost([L(0, 2, { suggested_lithology: 'KLEI' }), L(2, 4, { suggested_lithology: 'KLEI' })], { edits })
    const next = mergeLithoLayers(g, 0)
    expect(next.edits.get(0)?.suggested_lithology).toBe('KLEI')
    expect(next.edits.get(0)?.suggested_admixtures).toEqual([
      { soil_code: 'SL', amount: 'M', locally: false },
    ])
    expect(next.edits.get(0)?.depth_base_m).toBe(4)
  })

  it('M5 — lower layer\'s edit (e.g. an edited depth_base_m) drives the merged extent', () => {
    // The user has dragged the lower layer's base to 5 via an edit;
    // the merged layer extends to 5, not the raw 4.
    const edits = new Map([[1, { depth_base_m: 5 }]])
    const g = ghost([L(0, 2), L(2, 4)], { edits })
    const next = mergeLithoLayers(g, 0)
    expect(next.edits.get(0)?.depth_base_m).toBe(5)
  })

  it('M6 — edits Map keys above the lower index shift down; lower\'s edit is dropped', () => {
    const edits = new Map<
      number,
      { depth_top_m?: number; depth_base_m?: number }
    >([
      [1, { depth_base_m: 4.5 }],
      [3, { depth_top_m: 6.2 }],
    ])
    const g = ghost([L(0, 2), L(2, 4), L(4, 6), L(6, 8)], { edits })
    // Merge idx 0 + 1. idx 1's edit is dropped (it was the lower); the
    // base from that edit drives the merged extent. idx 3's edit
    // shifts to idx 2.
    const next = mergeLithoLayers(g, 0)
    expect(next.edits.get(0)?.depth_base_m).toBe(4.5)
    expect(next.edits.get(2)?.depth_top_m).toBe(6.2)
  })
})
