// Cascade clamp + merge-confirm title tests for the drag gesture
// (debt #83 cascade + #84 merge prompt).
//
// Pure-helper level tests so the topology rules are pinned without
// rendering. The full component-mount path is covered by the existing
// LithoSuggestionGhostColumns.test.tsx; here we exercise just the
// math.

import { describe, expect, it } from 'vitest'

import type { LithoLayerSuggestion } from '../../api/client'
import {
  buildMergeConfirmTitle,
} from './MergeConfirmDialog'
import { computeDragBounds } from './LithoSuggestionGhostColumns'

function L(
  i: number,
  top: number,
  base: number,
  overrides?: Partial<LithoLayerSuggestion>,
): LithoLayerSuggestion {
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

const empty = (): ReadonlySet<number> => new Set()

// ---------------------------------------------------------------------------
// C1–C4: cascade chain behaviour from computeDragBounds.collapseChainBelow
// ---------------------------------------------------------------------------

describe('computeDragBounds — cascade (debt #83 + #84)', () => {
  it('C1 — base-drag with 3 same-parent pending neighbours yields a 3-chain', () => {
    // Layer 0 dragged at base; layers 1/2/3 all same parent, all pending.
    const sugs = [L(0, 0, 1), L(1, 1, 2), L(2, 2, 3), L(3, 3, 4)]
    const bounds = computeDragBounds('base', 0, sugs, undefined, empty(), empty())
    expect(bounds.collapseChainBelow).toEqual([1, 2, 3])
    // Snap target is layer 3's BASE (the far edge of the last chain entry).
    expect(bounds.boundsBelowM).toBe(4)
  })

  it('C2 — cascade stops at different-parent neighbour (geological boundary)', () => {
    // Layer 0 same parent as 1; layer 2 has different parent → barrier.
    const sugs = [
      L(0, 0, 1, { parent_formation_id: 'geo-a' }),
      L(1, 1, 2, { parent_formation_id: 'geo-a' }),
      L(2, 2, 3, { parent_formation_id: 'geo-b' }),
      L(3, 3, 4, { parent_formation_id: 'geo-b' }),
    ]
    const bounds = computeDragBounds('base', 0, sugs, undefined, empty(), empty())
    // Chain = [1] (only layer 1 absorbed; layer 2 barriers).
    expect(bounds.collapseChainBelow).toEqual([1])
    // Snap target is layer 1's BASE (its far edge — standard single-layer
    // resize from #83 v1.2 since the cascade stopped after one entry).
    expect(bounds.boundsBelowM).toBe(2)
  })

  it('C3 — spans_boundary suggestion is a barrier even with matching parent_formation_id', () => {
    // Layer 0 and 1 are same parent. Layer 2 is "officially geo-a" per
    // parent_formation_id but spans_boundary=true → segmenter flagged
    // it as a straddle — must not join the cascade.
    const sugs = [
      L(0, 0, 1),
      L(1, 1, 2),
      L(2, 2, 3, { spans_boundary: true }),
      L(3, 3, 4),
    ]
    const bounds = computeDragBounds('base', 0, sugs, undefined, empty(), empty())
    // Cascade stops at layer 2 (the straddler is a barrier).
    expect(bounds.collapseChainBelow).toEqual([1])
    // Clamp at layer 1's far edge — same as #83 v1.2 single-layer case
    // since the cascade chain has length 1.
    expect(bounds.boundsBelowM).toBe(2)
  })

  it('C4 — accepted neighbour barriers cascade even with same parent', () => {
    const sugs = [L(0, 0, 1), L(1, 1, 2), L(2, 2, 3), L(3, 3, 4)]
    const accepted: ReadonlySet<number> = new Set([2])
    const bounds = computeDragBounds('base', 0, sugs, undefined, accepted, empty())
    // Chain = [1] (layer 2 is accepted barrier). Clamp at layer 2's NEAR
    // edge (its top = 2) per the existing accepted-barrier rule.
    expect(bounds.collapseChainBelow).toEqual([1])
    expect(bounds.boundsBelowM).toBe(2)
  })

  it('C5 — rejected gap immediately below disables cascade entirely', () => {
    // Layer 0 dragged; layer 1 rejected; layer 2 pending same parent.
    // Per gap-fill rule (#83 v1.2): clamp at layer 2's NEAR edge, no
    // cascade through it (the rejected gap fills, layer 2 stays put).
    const sugs = [L(0, 0, 1), L(1, 1, 2), L(2, 2, 3), L(3, 3, 4)]
    const rejected: ReadonlySet<number> = new Set([1])
    const bounds = computeDragBounds('base', 0, sugs, undefined, empty(), rejected)
    expect(bounds.collapseChainBelow).toEqual([])
    expect(bounds.boundsBelowM).toBe(2) // layer 2 top
  })

  it('C6 — top-drag mirrors cascade in the above direction', () => {
    // Layer 3 dragged at top; layers 0/1/2 all same parent.
    const sugs = [L(0, 0, 1), L(1, 1, 2), L(2, 2, 3), L(3, 3, 4)]
    const bounds = computeDragBounds('top', 3, sugs, undefined, empty(), empty())
    // Walk order: closest-first → [2, 1, 0].
    expect(bounds.collapseChainAbove).toEqual([2, 1, 0])
    // Snap target: layer 0's TOP (= 0, the far edge of the last entry).
    expect(bounds.boundsAboveM).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// M1–M4: dialog title with NAD fallback
// ---------------------------------------------------------------------------

describe('buildMergeConfirmTitle — #84 wording', () => {
  it('M1 — all same lithology + same NAD class → Merge … (NAD K)', () => {
    const dragged = L(0, 0, 1, { suggested_lithology: 'ZAND', suggested_nad_class: 8 })
    const chain = [
      L(1, 1, 2, { suggested_lithology: 'ZAND', suggested_nad_class: 8 }),
      L(2, 2, 3, { suggested_lithology: 'ZAND', suggested_nad_class: 8 }),
    ]
    expect(buildMergeConfirmTitle(dragged, chain)).toBe('Merge 3 ZAND layers (NAD 8)?')
  })

  it('M2 — same lithology but any NAD null → Merge … (no NAD parenthetical)', () => {
    const dragged = L(0, 0, 1, { suggested_lithology: 'KLEI', suggested_nad_class: null })
    const chain = [
      L(1, 1, 2, { suggested_lithology: 'KLEI', suggested_nad_class: null }),
    ]
    expect(buildMergeConfirmTitle(dragged, chain)).toBe('Merge 2 KLEI layers?')
  })

  it('M3 — mixed lithology → Collapse N layers', () => {
    const dragged = L(0, 0, 1, { suggested_lithology: 'ZAND' })
    const chain = [L(1, 1, 2, { suggested_lithology: 'KLEI' })]
    expect(buildMergeConfirmTitle(dragged, chain)).toBe('Collapse 2 layers?')
  })

  it('M4 — empty chain or null dragged → defensive Collapse 0 layers', () => {
    expect(buildMergeConfirmTitle(null, [])).toBe('Collapse 0 layers?')
    expect(buildMergeConfirmTitle(L(0, 0, 1), [])).toBe('Collapse 0 layers?')
  })

  it('M5 — singular (chain length 1, total 2) keeps "layers" plural', () => {
    // Singular wording would imply "1 ZAND layer" — but the total count
    // including the dragged layer is 2. Stays plural for the user.
    const dragged = L(0, 0, 1, { suggested_lithology: 'ZAND', suggested_nad_class: 8 })
    const chain = [L(1, 1, 2, { suggested_lithology: 'ZAND', suggested_nad_class: 8 })]
    expect(buildMergeConfirmTitle(dragged, chain)).toBe('Merge 2 ZAND layers (NAD 8)?')
  })
})
