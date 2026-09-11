// Unit pins for canMergeAt, mergeLithoLayers (debt #102), and
// absorbLithoLayer (dogfeed 2026-05-25 — shift+drag absorb gesture).
//
// Pure-helper tests so the index-shift math + the lithology-match
// gate are netted without rendering. The full gesture flow is covered
// by the LithoSuggestionGhostColumns component-level tests (AB1–AB6).

import { describe, expect, it } from 'vitest'

import type { LithoLayerSuggestion } from '../api/client'
import type { BulkAnchorGhost } from '../hooks/useGeologicalModel'
import {
  absorbLithoLayer,
  absorbThroughLayer,
  applyCrossMergeOnDrag,
  canMergeAt,
  mergeLithoLayers,
} from './lithoLayerMerge'

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

// ---------------------------------------------------------------------------
// absorbLithoLayer (dogfeed 2026-05-25 — shift+drag absorb gesture)
// ---------------------------------------------------------------------------
// AB-H: helper-level contracts (AB1–AB6 are the component-level contracts).

describe('absorbLithoLayer (dogfeed 2026-05-25)', () => {
  it('AB-H1 — absorb-down: dragger 0 absorbs neighbour 1; depth_base extends to neighbour base', () => {
    // Two layers: dragger=0 (ZAND, 0→2 m), neighbour=1 (KLEI, 2→4 m).
    // Absorb-down: result is 1 layer, depth_base_m = 4, composition = ZAND.
    const g = ghost([
      L(0, 2, { suggested_lithology: 'ZAND' }),
      L(2, 4, { suggested_lithology: 'KLEI' }),
    ])
    const next = absorbLithoLayer(g, 0, 'down')
    expect(next.suggestions).toHaveLength(1)
    // Dragger's raw lithology stays ZAND (dragger composition wins).
    expect(next.suggestions[0].suggested_lithology).toBe('ZAND')
    // depth_base_m extended to the absorbed layer's base (4).
    expect(next.edits.get(0)?.depth_base_m).toBe(4)
    // depth_top_m not touched by an absorb-down (remains at raw 0).
    expect(next.edits.get(0)?.depth_top_m).toBeUndefined()
  })

  it('AB-H2 — absorb-up: dragger 1 absorbs neighbour 0; depth_top extends to neighbour top', () => {
    // Two layers: neighbour=0 (KLEI, 0→2 m), dragger=1 (ZAND, 2→4 m).
    // Absorb-up: result is 1 layer at new idx 0, depth_top_m = 0.
    const g = ghost([
      L(0, 2, { suggested_lithology: 'KLEI' }),
      L(2, 4, { suggested_lithology: 'ZAND' }),
    ])
    const next = absorbLithoLayer(g, 1, 'up')
    expect(next.suggestions).toHaveLength(1)
    // Dragger's raw lithology stays ZAND (was originally at idx 1).
    // After idx 0 is removed, dragger lands at new idx 0.
    expect(next.suggestions[0].suggested_lithology).toBe('ZAND')
    // depth_top_m = neighbour's raw top (0).
    expect(next.edits.get(0)?.depth_top_m).toBe(0)
    expect(next.edits.get(0)?.depth_base_m).toBeUndefined()
  })

  it('AB-H3 — absorbed neighbour\'s edits are discarded', () => {
    // Neighbour (idx 1) has a prior depth_base edit to 5.
    // Absorb-down should use that edited base (5) as the new outer edge,
    // but the edit key for the absorbed layer disappears.
    const edits = new Map([[1, { depth_base_m: 5 }]])
    const g = ghost([L(0, 2), L(2, 4)], { edits })
    const next = absorbLithoLayer(g, 0, 'down')
    // No edit entry for the absorbed layer remains.
    expect(next.edits.has(1)).toBe(false)
    // Dragger uses the absorbed layer's EDITED base as its new depth_base.
    expect(next.edits.get(0)?.depth_base_m).toBe(5)
  })

  it('AB-H4 — absorbed neighbour\'s accepted/rejected membership is removed', () => {
    // Neighbour (idx 2) is in the accepted set. After absorb-down from
    // dragger=0, the layer at old idx 1 is absorbed → removed; idx 2
    // shifts to idx 1. But here we test that the absorbed idx itself
    // vanishes from accepted/rejected.
    const g = ghost(
      [L(0, 2), L(2, 4), L(4, 6)],
      { accepted: new Set([1]) },
    )
    // Absorb-down from dragger=0 → absorb idx 1.
    const next = absorbLithoLayer(g, 0, 'down')
    expect(next.accepted.has(0)).toBe(false) // absorbed idx gone
    expect(next.accepted.has(1)).toBe(false) // shift check
    // idx 2 (was 3rd layer, now 2nd) shifts to idx 1 — not in accepted.
    expect([...next.accepted]).toHaveLength(0)
  })

  it('AB-H5 — indices above the absorbed layer shift down by 1', () => {
    // Three layers: absorb-down from dragger=0 removes idx 1.
    // Old idx 2 must become new idx 1.
    const g = ghost([L(0, 2), L(2, 4), L(4, 6)], {
      accepted: new Set([2]),
      rejected: new Set([]),
    })
    const next = absorbLithoLayer(g, 0, 'down')
    expect(next.suggestions).toHaveLength(2)
    // Old idx 2 now at new idx 1.
    expect(next.suggestions[1].depth_top_m).toBe(4)
    expect(next.accepted.has(1)).toBe(true)
  })

  it('AB-H6 — dragger\'s prior edits (lithology, top depth) are preserved', () => {
    // Dragger at idx 0 already has a composition + top-depth edit.
    // Absorb-down extends depth_base only; other edits stay.
    const edits = new Map([[0, { suggested_lithology: 'KLEI', depth_top_m: 0.5 }]])
    const g = ghost([L(0, 2), L(2, 4)], { edits })
    const next = absorbLithoLayer(g, 0, 'down')
    expect(next.edits.get(0)?.suggested_lithology).toBe('KLEI')
    expect(next.edits.get(0)?.depth_top_m).toBe(0.5)
    expect(next.edits.get(0)?.depth_base_m).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// applyCrossMergeOnDrag — plain-drag cross-merge (no Shift required)
// ---------------------------------------------------------------------------
// CM: cross-merge test ids.

describe('applyCrossMergeOnDrag', () => {
  it('CM1 — TOP dragged UP past neighbour FAR edge → neighbour deleted, dragger top extended', () => {
    // Three layers: 0→2, 2→4, 4→6.
    // Drag layer 2 (idx=1) TOP from 2 to 0 — crosses neighbour 0's FAR
    // edge (its depth_top_m = 0). Absorb-up semantics: a drag only collapses
    // a neighbour when the new edge has fully traversed the neighbour
    // (release-to-collapse, not near-edge nudge — dogfeed 2026-05-26).
    const g = ghost([L(0, 2), L(2, 4), L(4, 6)])
    const result = applyCrossMergeOnDrag(g, 1, { depth_top_m: 0 })
    // Neighbour (idx 0) absorbed → 2 layers remain.
    expect(result.suggestions).toHaveLength(2)
    // Dragger (was idx 1, now idx 0 after absorb-up) has top extended to 0.
    expect(result.edits.get(0)?.depth_top_m).toBe(0)
    // Original bottom layer (was idx 2) now at idx 1 — unchanged.
    expect(result.suggestions[1].depth_top_m).toBe(4)
  })

  it('CM1b — TOP nudged into neighbour but not past its far edge → no absorb, plain edit', () => {
    // Three layers: 0→2, 2→4, 4→6.
    // Drag layer 2 (idx=1) TOP from 2 to 1.5 — crosses neighbour 0's near
    // edge (base=2) but NOT its far edge (top=0). Under the old (buggy)
    // near-edge semantic this absorbed neighbour 0; under the new
    // far-edge semantic it's just a partial overlap resize.
    const g = ghost([L(0, 2), L(2, 4), L(4, 6)])
    const result = applyCrossMergeOnDrag(g, 1, { depth_top_m: 1.5 })
    // No absorb — still 3 layers.
    expect(result.suggestions).toHaveLength(3)
    // Edit recorded at idx 1.
    expect(result.edits.get(1)?.depth_top_m).toBe(1.5)
  })

  it('CM2 — BASE dragged DOWN past neighbour top → neighbour deleted, dragger base extended', () => {
    // Three layers: 0→2, 2→4, 4→6.
    // Drag layer 0 (idx=0) BASE from 2 to 4.5 — crosses neighbour 1 whose top is 2.
    // (new base 4.5 >= neighbourTop 2 → absorb-down)
    // After absorb: 2 layers; dragger base extended to neighbour base (4).
    const g = ghost([L(0, 2), L(2, 4), L(4, 6)])
    const result = applyCrossMergeOnDrag(g, 0, { depth_base_m: 4.5 })
    expect(result.suggestions).toHaveLength(2)
    // Dragger stays at idx 0; its base extended to absorbed layer's effective base (4).
    expect(result.edits.get(0)?.depth_base_m).toBe(4)
    // Third layer (was idx 2) shifts to idx 1.
    expect(result.suggestions[1].depth_top_m).toBe(4)
  })

  it('CM3 — drag within own range → plain depth edit, no deletion', () => {
    // Layer 1 (2→4) top dragged slightly up to 2.5 — does NOT cross neighbour 0 base (2).
    const g = ghost([L(0, 2), L(2, 4), L(4, 6)])
    const result = applyCrossMergeOnDrag(g, 1, { depth_top_m: 2.5 })
    // No structural change — still 3 layers.
    expect(result.suggestions).toHaveLength(3)
    // Simple edit stored at idx 1.
    expect(result.edits.get(1)?.depth_top_m).toBe(2.5)
  })

  it('CM4 — accepted neighbour above is a hard barrier, no absorb', () => {
    // Layer 1 (2→4) accepted; layer 2 (4→6) top dragged to 1.5 — would cross accepted idx 1.
    // Accepted layers are frozen; no absorb should fire.
    const g = ghost([L(0, 2), L(2, 4), L(4, 6)], { accepted: new Set([1]) })
    const result = applyCrossMergeOnDrag(g, 2, { depth_top_m: 1.5 })
    // Accepted barrier prevents absorb — still 3 layers.
    expect(result.suggestions).toHaveLength(3)
    // Edit stored at the dragger idx.
    expect(result.edits.get(2)?.depth_top_m).toBe(1.5)
  })

  // Dogfeed 2026-05-26: defensive-guard pins. Before these guards a
  // stale idx surviving a Suggest-all rebuild crashed the function
  // inside the reducer with "Cannot read properties of undefined
  // (reading 'depth_top_m')". The guards return the ghost unchanged
  // OR fall through to the simple merge so the reducer never throws.

  it('CM5 — out-of-bounds idx returns ghost unchanged, no crash', () => {
    // Simulates the post-Suggest-all crash: Suggest-all replaced the
    // anchor's suggestions with a shorter list, but a queued
    // handleEditBulkLitho updater still carries the pre-replace idx.
    const g = ghost([L(0, 2), L(2, 4)])
    const result = applyCrossMergeOnDrag(g, 5, { depth_top_m: 1.5 })
    // No mutation: same suggestions, no edit stored.
    expect(result).toBe(g)
  })

  it('CM6 — empty edit returns ghost with no-op edits merge, no crash', () => {
    // The reducer must not throw on an empty edit. The simple-merge
    // fallback writes an empty edits entry for the idx — harmless
    // and matches the prior (pre-cross-merge) behaviour.
    const g = ghost([L(0, 2), L(2, 4)])
    const result = applyCrossMergeOnDrag(g, 0, {})
    expect(result.suggestions).toHaveLength(2)
    // No structural change.
    expect(result.suggestions).toEqual(g.suggestions)
  })

  it('CM7 — composition-only edit (no depth fields) merges without scanning neighbours', () => {
    // Alt-drag cross-column paste sends suggested_lithology +
    // suggested_admixtures with no depth field. Cross-merge must NOT
    // crash and must persist the composition override in the edits Map.
    const g = ghost([L(0, 2), L(2, 4), L(4, 6)])
    const result = applyCrossMergeOnDrag(g, 1, {
      suggested_lithology: 'KLEI',
      suggested_admixtures: [],
    })
    // Same structure — no absorb fired.
    expect(result.suggestions).toHaveLength(3)
    expect(result.edits.get(1)?.suggested_lithology).toBe('KLEI')
    expect(result.edits.get(1)?.depth_top_m).toBeUndefined()
  })

  it('CM8 — no-op depth edit (matches pre-edit effective depth) falls through to simple merge', () => {
    // edit.depth_top_m equals the current effective top — no drag
    // direction can be detected. Should not fire the neighbour scan
    // (which would also be a no-op, but skipping the scan is correct
    // and matches the prior simple-merge code path).
    const g = ghost([L(0, 2), L(2, 4), L(4, 6)])
    const result = applyCrossMergeOnDrag(g, 1, { depth_top_m: 2 })
    expect(result.suggestions).toHaveLength(3)
    // Edit stored at idx 1 with the no-op depth.
    expect(result.edits.get(1)?.depth_top_m).toBe(2)
  })

  it('CM9 — post-Suggest-all state shape: stale idx targets shorter suggestions list', () => {
    // Models the exact crash scenario from the runtime report:
    //   1. Suggest-all completes; anchor's suggestions list has 2 layers.
    //   2. A queued updater (from Alt-drag paste before the replace)
    //      fires with idx=4 carrying a composition-only edit.
    //   3. The reducer must not crash.
    const afterSuggestAll = ghost([L(0, 1.5), L(1.5, 3)])
    expect(() =>
      applyCrossMergeOnDrag(afterSuggestAll, 4, {
        suggested_lithology: 'ZAND',
        suggested_admixtures: [],
      }),
    ).not.toThrow()
    const result = applyCrossMergeOnDrag(afterSuggestAll, 4, {
      suggested_lithology: 'ZAND',
      suggested_admixtures: [],
    })
    expect(result).toBe(afterSuggestAll)
  })

  // CM10 / CM11 — double-absorb regression (dogfeed 2026-05-26).
  //
  // Root cause: ``handleUp`` in LithoSuggestionGhostColumns fires TWO
  // ``onEdit`` calls for a shared-boundary drag — one for the dragger
  // (primary, with cross-merge) and one for the partner (secondary,
  // shared-boundary propagation). The secondary call ran
  // ``applyCrossMergeOnDrag`` on the post-primary ghost, where the
  // primary had already set the dragger's base to ``final``. The
  // secondary then saw ``newTop <= dragger.updatedBase`` and absorbed
  // the dragger — wrong direction, double absorb.
  //
  // Fix: ``handleUp`` marks the secondary edit with
  // ``_propagateOnly: true``; ``applyCrossMergeOnDrag`` skips the
  // neighbour scan for propagate-only edits and performs a plain
  // depth merge only.
  //
  // These tests exercise the pure-helper half: a _propagateOnly edit
  // must never trigger absorb regardless of the depth values.

  it('CM10 — _propagateOnly edit: no absorb even when depth crosses neighbour boundary', () => {
    // Simulates the secondary shared-boundary call after a base-drag
    // UP gesture. The primary already updated layer 1's base to 1 (via
    // its own applyCrossMergeOnDrag call). The secondary fires
    // onEdit(2, { depth_top_m: 1, _propagateOnly: true }). From layer
    // 2's perspective newTop=1 < preTop=4 AND neighbourBase=1 —
    // without the fix this absorbs layer 1. With the fix: plain merge.
    const g = ghost(
      [L(0, 2), L(2, 4), L(4, 6)],
      // Simulate primary already having updated layer 1's base to 1.
      { edits: new Map([[1, { depth_base_m: 1 }]]) },
    )
    const result = applyCrossMergeOnDrag(g, 2, { depth_top_m: 1, _propagateOnly: true })
    // No absorption — still 3 layers.
    expect(result.suggestions).toHaveLength(3)
    // The propagated depth is stored as a plain edit on idx 2.
    expect(result.edits.get(2)?.depth_top_m).toBe(1)
    // The _propagateOnly flag is stripped from the stored edit.
    expect(result.edits.get(2)?._propagateOnly).toBeUndefined()
  })

  it('CM11 — _propagateOnly edit: mirrors CM10 for a top-drag DOWN propagation', () => {
    // Symmetric case: primary dragged layer 1's top DOWN to 5 (past layer
    // 2's territory). Secondary fires onEdit(0, { depth_base_m: 5,
    // _propagateOnly: true }). Without the fix: layer 0's base going past
    // layer 1's updated top (5) would absorb layer 1. With the fix: plain.
    const g = ghost(
      [L(0, 2), L(2, 4), L(4, 6)],
      { edits: new Map([[1, { depth_top_m: 5 }]]) },
    )
    const result = applyCrossMergeOnDrag(g, 0, { depth_base_m: 5, _propagateOnly: true })
    expect(result.suggestions).toHaveLength(3)
    expect(result.edits.get(0)?.depth_base_m).toBe(5)
    expect(result.edits.get(0)?._propagateOnly).toBeUndefined()
  })

  // CM-RJ1 / CM-RJ2 — cross-merge across a rejected layer (dogfeed
  // 2026-05-31). When the dragger's edge crosses past a REJECTED
  // neighbour to hit a pending one beyond, the cross-merge detection
  // already walks past rejected (skip-rejected loop). The absorb
  // operation must absorb the actually-found target (the pending one
  // beyond the rejected), not the immediate-rejected layer. Pre-fix
  // ``absorbLithoLayer`` hardcoded ``draggerIdx ± 1`` and absorbed
  // the rejected (visually invisible) layer instead, leaving the
  // pending target alive — manifesting as "two sand bands with a
  // sliver" after a drag-up-to-collapse through a previously-merged
  // rejected silt.
  //
  // Post-fix: the rejected layers between dragger and target are
  // consumed by the absorb (they were inside the dragger's traversed
  // path), and the dragger extends to the target's far edge.

  it('CM-RJ1 — TOP dragged UP past a rejected neighbour absorbs the pending target beyond', () => {
    // Layers 0→2 (pending sand), 2→3 (REJECTED silt), 3→6 (pending sand),
    // 6→8 (pending sand). Drag idx=2 (3→6) TOP up to 0. The dragger
    // crosses past rejected idx=1 to fully consume pending idx=0.
    const g = ghost(
      [L(0, 2), L(2, 3), L(3, 6), L(6, 8)],
      { rejected: new Set([1]) },
    )
    const result = applyCrossMergeOnDrag(g, 2, { depth_top_m: 0 })
    // The dragger consumed pending idx=0 AND the rejected idx=1 in
    // between — 4 layers down to 2.
    expect(result.suggestions).toHaveLength(2)
    // The dragger (was idx=2, now idx=0 after two layers removed
    // above it) has top extended to 0.
    expect(result.edits.get(0)?.depth_top_m).toBe(0)
    // Original last layer (was idx=3) now at idx=1.
    expect(result.suggestions[1].depth_top_m).toBe(6)
    // Rejected set is empty — the rejected layer was consumed by the
    // through-absorb, not left as a stale-idx entry.
    expect(result.rejected.size).toBe(0)
  })

  it('CM-RJ2 — BASE dragged DOWN past a rejected neighbour absorbs the pending target beyond', () => {
    // Mirror of CM-RJ1.  Layers 0→2 (pending), 2→5 (pending sand),
    // 5→6 (REJECTED silt), 6→8 (pending sand). Drag idx=1 (2→5) BASE
    // down to 8. The dragger crosses past rejected idx=2 to consume
    // pending idx=3.
    const g = ghost(
      [L(0, 2), L(2, 5), L(5, 6), L(6, 8)],
      { rejected: new Set([2]) },
    )
    const result = applyCrossMergeOnDrag(g, 1, { depth_base_m: 8 })
    expect(result.suggestions).toHaveLength(2)
    // Dragger stays at idx=1; its base extended to absorbed target's far edge (8).
    expect(result.edits.get(1)?.depth_base_m).toBe(8)
    expect(result.rejected.size).toBe(0)
  })

  it('CM-RJ3 — stale edits on consumed in-between rejected layer are dropped', () => {
    // The rejected layer might carry a stale depth edit from the
    // earlier drag that rejected it (the auto-fill path patches the
    // surviving neighbour's depth, not the rejected one — but defence
    // in depth: through-absorb drops ALL edits on the consumed range
    // so no stale idx survives the shift). Mirrors the production
    // case where a rejected silt was once dragged then rejected.
    const g = ghost(
      [L(0, 2), L(2, 3), L(3, 6)],
      {
        rejected: new Set([1]),
        edits: new Map([
          // Pretend the rejected layer had a stale depth edit on it.
          [1, { depth_top_m: 2.5 }],
          // Pretend the pending target had its base extended earlier.
          [0, { depth_base_m: 3 }],
        ]),
      },
    )
    const result = applyCrossMergeOnDrag(g, 2, { depth_top_m: 0 })
    expect(result.suggestions).toHaveLength(1)
    // The merged dragger has top=0, no stale top-edit from rejected idx=1.
    expect(result.edits.get(0)?.depth_top_m).toBe(0)
    // Stale edit on the absorbed pending (idx=0) is gone.
    expect(result.edits.get(0)?.depth_base_m).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Owner dogfeed 2026-09-11 (installer #32) — "a whole suggestion disappeared"
// ---------------------------------------------------------------------------
// "i split, renamed (added admixture) then tried to pull up the boundary and
// then it went wrong ... a whole suggestion disappeared and i can't redo it
// any more."
//
// The drag commit fires TWO edits for a shared boundary: the dragger's own
// depth, then the partner's ``_propagateOnly`` depth so the partner's facing
// edge follows the seam. When the first edit absorbs the partner, the second
// edit's index no longer points at the partner — it points at the MERGED layer.
// Applying it there sets the merged layer's far edge to the released depth and
// the suggestion the user just split and renamed collapses to a sliver.
//
// SEQ1 / SEQ2 replay the two emissions in order on the pure helpers. The pin is
// the survivor's thickness: a merge must never make a layer thinner than the
// two layers it merged.

describe('applyCrossMergeOnDrag — a propagate edit must never collapse the layer it lands on', () => {
  it('SEQ1 — after an absorb-up, the stale partner propagate leaves the merged layer spanning BOTH layers', () => {
    // Three layers 0→2, 2→5, 5→8. Drag idx=1's TOP up to 0.05 — inside layer
    // 0's absorb sliver window (threshold = max(0.1, 0.15 * 2) = 0.3), so the
    // first edit absorbs layer 0. The commit then fires the partner edit at the
    // pre-absorb index 0, which is now the merged layer.
    const g = ghost([L(0, 2), L(2, 5), L(5, 8)])
    const afterPrimary = applyCrossMergeOnDrag(g, 1, { depth_top_m: 0.05 })
    expect(afterPrimary.suggestions).toHaveLength(2)
    const afterPartner = applyCrossMergeOnDrag(afterPrimary, 0, {
      depth_base_m: 0.05,
      _propagateOnly: true,
    })
    // The merged layer still runs from the absorbed layer's top (0) to its own
    // base (5) — it did not shrink to a 5 cm sliver and leave a hole behind.
    const top = afterPartner.edits.get(0)?.depth_top_m ?? afterPartner.suggestions[0].depth_top_m
    const base = afterPartner.edits.get(0)?.depth_base_m ?? afterPartner.suggestions[0].depth_base_m
    expect(top).toBeCloseTo(0, 6)
    expect(base).toBeCloseTo(5, 6)
  })

  it('SEQ2 — the merged layer keeps the composition the user typed into it', () => {
    // Same sequence, but the dragger carries the composition edit the user made
    // in the ghost composition editor (an added admixture). The collapse must
    // not be able to take the renamed layer off the column.
    const edits = new Map([
      [1, {
        suggested_lithology: 'ZAND',
        suggested_admixtures: [{ soil_code: 'KH', amount: 'weinig', locally: false }],
      }],
    ])
    const g = ghost([L(0, 2), L(2, 5), L(5, 8)], { edits })
    const afterPrimary = applyCrossMergeOnDrag(g, 1, { depth_top_m: 0.05 })
    const afterPartner = applyCrossMergeOnDrag(afterPrimary, 0, {
      depth_base_m: 0.05,
      _propagateOnly: true,
    })
    expect(afterPartner.edits.get(0)?.suggested_admixtures).toHaveLength(1)
    const top = afterPartner.edits.get(0)?.depth_top_m ?? afterPartner.suggestions[0].depth_top_m
    const base = afterPartner.edits.get(0)?.depth_base_m ?? afterPartner.suggestions[0].depth_base_m
    expect(base - top).toBeGreaterThan(0.5)
  })

  it('SEQ3 — a propagate edit that would invert a layer (base above its top) is refused', () => {
    // Defence in depth, independent of which index the commit aimed at: a
    // propagate that puts a layer's base ABOVE its own top is never a legal
    // shared-boundary move, so the layer keeps its depths.
    const g = ghost([L(0, 2), L(2, 5)])
    const result = applyCrossMergeOnDrag(g, 1, { depth_top_m: 6, _propagateOnly: true })
    const top = result.edits.get(1)?.depth_top_m ?? result.suggestions[1].depth_top_m
    const base = result.edits.get(1)?.depth_base_m ?? result.suggestions[1].depth_base_m
    expect(base - top).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Structural helpers must never empty an anchor's ghost list
// ---------------------------------------------------------------------------
// The same dogfeed: whatever goes wrong mid-gesture, the column must keep its
// suggestions. A stale index (the class that crashed applyCrossMergeOnDrag in
// 2026-05-26) must make the helper a no-op, never a wipe and never a throw.

describe('structural helpers — an anchor never loses its whole ghost list', () => {
  it('GUARD1 — mergeLithoLayers with no lower neighbour returns the ghost unchanged', () => {
    const g = ghost([L(0, 2), L(2, 5)])
    expect(() => mergeLithoLayers(g, 1)).not.toThrow()
    expect(mergeLithoLayers(g, 1)).toBe(g)
  })

  it('GUARD2 — mergeLithoLayers with an out-of-range index returns the ghost unchanged', () => {
    const g = ghost([L(0, 2), L(2, 5)])
    expect(mergeLithoLayers(g, 7)).toBe(g)
    expect(mergeLithoLayers(g, -1)).toBe(g)
  })

  it('GUARD3 — absorbLithoLayer with no neighbour in the direction returns the ghost unchanged', () => {
    const g = ghost([L(0, 2), L(2, 5)])
    expect(() => absorbLithoLayer(g, 0, 'up')).not.toThrow()
    expect(absorbLithoLayer(g, 0, 'up')).toBe(g)
    expect(absorbLithoLayer(g, 1, 'down')).toBe(g)
  })

  it('GUARD4 — absorbThroughLayer never removes the last remaining layer', () => {
    // A one-layer anchor has nothing to absorb; the range maths must not be
    // able to empty the column.
    const g = ghost([L(0, 2)])
    expect(absorbThroughLayer(g, 0, 0, 'up')).toBe(g)
    expect(absorbThroughLayer(g, 0, 0, 'down')).toBe(g)
  })
})
