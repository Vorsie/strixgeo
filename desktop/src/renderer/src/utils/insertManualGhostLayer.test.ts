// Unit pins for insertManualGhostLayer.
//
// Claims pinned:
//   M1  Fresh anchor (existing=undefined) → single-layer ghost with correct depths.
//   M2  Existing anchor → layer appended, sorted by depth_top_m.
//   M3  Layer at clicked depth has depth_base = depth_top + 0.01.
//   M4  Existing accepted/rejected/edits are preserved.
//   M5  Layers clicked out of order sort ascending.

import { describe, expect, it } from 'vitest'

import type { LithoLayerSuggestion } from '../api/client'
import type { BulkAnchorGhost } from '../hooks/useGeologicalModel'
import { insertManualGhostLayer } from './insertManualGhostLayer'

function L(top: number, base: number): LithoLayerSuggestion {
  return {
    depth_top_m: top,
    depth_base_m: base,
    suggested_lithology: 'ZAND',
    suggested_nad_class: null,
    mean_qc_mpa: null,
    dr_pct: null,
    confidence: 'high',
    source: 'cpt_robertson_2015',
    suggested_admixtures: [],
    parent_formation_id: null,
    spans_boundary: false,
  }
}

function ghost(
  suggestions: LithoLayerSuggestion[],
  opts: {
    accepted?: ReadonlySet<number>
    rejected?: ReadonlySet<number>
  } = {},
): BulkAnchorGhost {
  return {
    kind: 'cpt',
    surfaceElevationM: 10,
    suggestions,
    accepted: opts.accepted ?? new Set(),
    rejected: opts.rejected ?? new Set(),
    edits: new Map(),
  }
}

describe('insertManualGhostLayer', () => {
  it('M1 — fresh anchor creates a single-layer ghost', () => {
    const result = insertManualGhostLayer(
      undefined,
      'cpt',
      10,
      3,
      'KLEI',
      [],
    )
    expect(result.suggestions).toHaveLength(1)
    expect(result.suggestions[0].depth_top_m).toBe(3)
    expect(result.suggestions[0].depth_base_m).toBe(3.01)
    expect(result.suggestions[0].suggested_lithology).toBe('KLEI')
    expect(result.suggestions[0].source).toBe('manual_pick')
    expect(result.suggestions[0].confidence).toBe('medium')
    expect(result.suggestions[0].parent_formation_id).toBeNull()
    expect(result.suggestions[0].spans_boundary).toBe(false)
    expect(result.kind).toBe('cpt')
    expect(result.surfaceElevationM).toBe(10)
  })

  it('M2 — appends to existing ghost', () => {
    const g = ghost([L(0, 2), L(4, 6)])
    const result = insertManualGhostLayer(g, 'cpt', 10, 2, 'VEEN', [])
    expect(result.suggestions).toHaveLength(3)
    // Sorted: 0–2, 2–2.01, 4–6
    expect(result.suggestions[1].depth_top_m).toBe(2)
    expect(result.suggestions[1].depth_base_m).toBeCloseTo(2.01, 5)
    expect(result.suggestions[1].suggested_lithology).toBe('VEEN')
  })

  it('M3 — depth_base is always depth_top + 0.01', () => {
    const result = insertManualGhostLayer(undefined, 'borehole', 5, 7.5, 'SILT', [])
    expect(result.suggestions[0].depth_base_m - result.suggestions[0].depth_top_m).toBeCloseTo(0.01, 5)
  })

  it('M4 — existing accepted/rejected preserved', () => {
    const accepted = new Set([0])
    const rejected = new Set([1])
    const g: BulkAnchorGhost = {
      kind: 'cpt',
      surfaceElevationM: 10,
      suggestions: [L(0, 2), L(2, 4)],
      accepted,
      rejected,
      edits: new Map(),
    }
    const result = insertManualGhostLayer(g, 'cpt', 10, 5, 'GRIND', [])
    // accepted/rejected indices are NOT shifted — the new layer is appended
    // at the end (after sort), so indices of pre-existing layers don't change.
    expect(result.accepted).toBe(accepted)
    expect(result.rejected).toBe(rejected)
  })

  it('M5 — layers clicked out of order sort ascending', () => {
    let g = insertManualGhostLayer(undefined, 'cpt', 10, 8, 'KLEI', [])
    g = insertManualGhostLayer(g, 'cpt', 10, 2, 'ZAND', [])
    g = insertManualGhostLayer(g, 'cpt', 10, 5, 'SILT', [])
    expect(g.suggestions[0].depth_top_m).toBe(2)
    expect(g.suggestions[1].depth_top_m).toBe(5)
    expect(g.suggestions[2].depth_top_m).toBe(8)
  })

  it('M6 — admixtures are shallow-copied into the new layer', () => {
    const admix = [{ soil_code: 'KLEI', amount: 'weinig', locally: false }]
    const result = insertManualGhostLayer(undefined, 'cpt', 10, 1, 'ZAND', admix)
    expect(result.suggestions[0].suggested_admixtures).toHaveLength(1)
    // Mutation of original admix does not affect the layer.
    admix[0].soil_code = 'VEEN'
    expect(result.suggestions[0].suggested_admixtures[0].soil_code).toBe('KLEI')
  })
})
