// Unit pins for extendGhostToNearest.
//
// Claims pinned:
//   E1  Happy path — top snaps to nearest contact above, base to nearest below.
//   E2  No contact above → top snaps to 0 (ground).
//   E3  No contact below → base snaps to investigationMaxDepthM.
//   E4  Overlap with another ghost → ok: false with depth message.
//   E5  Touching boundary (shared edge, not overlapping) → ok: true.
//   E6  Missing idx → ok: false.
//   E7  Existing depth edits on the extended idx are cleared.

import { describe, expect, it } from 'vitest'

import type { LithoLayerSuggestion } from '../api/client'
import type { BulkAnchorGhost } from '../hooks/useGeologicalModel'
import { extendGhostToNearest } from './extendGhostToNearest'

function L(top: number, base: number, lithology = 'ZAND'): LithoLayerSuggestion {
  return {
    depth_top_m: top,
    depth_base_m: base,
    suggested_lithology: lithology,
    suggested_nad_class: null,
    mean_qc_mpa: null,
    dr_pct: null,
    confidence: 'medium',
    source: 'manual_pick',
    suggested_admixtures: [],
    parent_formation_id: null,
    spans_boundary: false,
  }
}

function ghost(
  suggestions: LithoLayerSuggestion[],
  edits?: ReadonlyMap<number, { depth_top_m?: number; depth_base_m?: number }>,
): BulkAnchorGhost {
  return {
    kind: 'cpt',
    surfaceElevationM: 10,
    suggestions,
    accepted: new Set(),
    rejected: new Set(),
    edits: edits ?? new Map(),
  }
}

describe('extendGhostToNearest', () => {
  it('E1 — happy path: snaps to nearest contacts above and below', () => {
    // Ghost: [3, 3.01] (manual sentinel)
    // Contacts at 1 and 5 → new range should be [1, 5]
    const g = ghost([L(3, 3.01)])
    const contacts = [{ depth_top_m: 1 }, { depth_top_m: 5 }]
    const result = extendGhostToNearest(g, 0, contacts, 20)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.next.suggestions[0].depth_top_m).toBe(1)
    expect(result.next.suggestions[0].depth_base_m).toBe(5)
  })

  it('E2 — no contact above → top snaps to 0', () => {
    const g = ghost([L(3, 3.01)])
    const contacts = [{ depth_top_m: 5 }]
    const result = extendGhostToNearest(g, 0, contacts, 20)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.next.suggestions[0].depth_top_m).toBe(0)
    expect(result.next.suggestions[0].depth_base_m).toBe(5)
  })

  it('E3 — no contact below → base snaps to investigationMaxDepthM', () => {
    const g = ghost([L(3, 3.01)])
    const contacts = [{ depth_top_m: 1 }]
    const result = extendGhostToNearest(g, 0, contacts, 20)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.next.suggestions[0].depth_top_m).toBe(1)
    expect(result.next.suggestions[0].depth_base_m).toBe(20)
  })

  it('E4 — overlap with another ghost suggestion → ok: false', () => {
    // Ghost[0] at [0, 5]; Ghost[1] at [8, 8.01] (the one we extend)
    // Contacts at 2 and 10; extending idx=1 would give [5, 10]
    // which overlaps Ghost[0] at [0, 5] — NO, [5, 10] ∩ [0, 5) is just touching.
    // Let's use contacts at 3 and 10 → [0, 3] extended would overlap Ghost[1].
    const g = ghost([L(0, 5), L(8, 8.01)])
    // Extending idx=0 → contacts at 6 above (none > midpoint 2.5, so top=0, base=6)
    // which doesn't overlap idx=1 at [8, 8.01]. That's fine.
    // Instead: add a ghost that WOULD overlap the extended range.
    const g2 = ghost([L(3, 3.01), L(6, 9)])
    // Extending idx=0 → contacts at 1 and 7. New range [1, 7]. Ghost[1] [6, 9] overlaps.
    const contacts = [{ depth_top_m: 1 }, { depth_top_m: 7 }]
    const result = extendGhostToNearest(g2, 0, contacts, 20)
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/overlap/)
    expect(result.reason).toMatch(/6\.00/)
  })

  it('E5 — touching boundary (exact shared edge) is NOT an overlap', () => {
    // Ghost[0] at [0, 0.01]; Ghost[1] at [5, 8]. Extending idx=0.
    // Contacts at nothing above (→ top=0), 5 below (→ base=5).
    // New range [0, 5]. Ghost[1] starts at 5 → [0, 5) ∩ [5, 8) = empty. No overlap.
    const g = ghost([L(0, 0.01), L(5, 8)])
    const contacts = [{ depth_top_m: 5 }]
    const result = extendGhostToNearest(g, 0, contacts, 20)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.next.suggestions[0].depth_base_m).toBe(5)
  })

  it('E6 — invalid idx returns ok: false', () => {
    const g = ghost([L(0, 1)])
    const result = extendGhostToNearest(g, 5, [], 20)
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/index 5/)
  })

  it('E7 — prior depth edits on the extended idx are cleared', () => {
    // The ghost layer has an existing depth edit that would override the
    // new computed bounds. The helper must clear it.
    const edits = new Map([[0, { depth_top_m: 1, depth_base_m: 2, suggested_lithology: 'KLEI' }]])
    const g = ghost([L(3, 3.01)], edits)
    const contacts = [{ depth_top_m: 0 }, { depth_top_m: 5 }]
    const result = extendGhostToNearest(g, 0, contacts, 20)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // depth overrides cleared; composition edit preserved.
    const edit = result.next.edits.get(0)
    expect(edit?.depth_top_m).toBeUndefined()
    expect(edit?.depth_base_m).toBeUndefined()
    expect(edit?.suggested_lithology).toBe('KLEI')
    // New bounds come from the suggestions array.
    expect(result.next.suggestions[0].depth_top_m).toBe(0)
    expect(result.next.suggestions[0].depth_base_m).toBe(5)
  })
})
