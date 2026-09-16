// The hard-bounds rules for hand editing packing sub-bands, in the owner's words.
//
// Ruling 2 (docs/debt.md #227, 2026-08-01, amended 2026-08-26): "A packing boundary moves
// freely inside its litho body and clamps at the edge. It can never move a litho contact."
// The hierarchy constrains downward; the owner overrules the CLASS, never the hierarchy.
//
// These cases are about the GESTURE, not the commit. The backend rejects an out-of-body
// depth (`plan_split`), but a rejection the owner only meets after releasing the mouse is a
// worse answer than a boundary that visibly refuses to go there. So the clamp is pinned
// here, on the pure function the drag reads every frame.
//
// There is ONE wall to pin: the litho unit. A geological contact stopped being a wall on
// 2026-08-26 (owner: "just drop the wall everywhere, user wil have to manually do it"), so
// a litho body on this axis may now span one and the clamp must not care. Nothing below
// changes as a result — this module never read a geological datum — but the reason these
// tests are sufficient did: it is that there is only one wall, not that one test happened
// to cover two.

import { describe, expect, it } from 'vitest'

import {
  SPLIT_EDGE_EPSILON_M,
  bandAtDepth,
  canMergeBands,
  clampDragDepth,
  clampSplitDepth,
  columnBands,
  columnIsHandEditable,
  dragAbsorbPrediction,
  enclosingLithoBody,
} from './geotechBandEdit'
import { absorbRemainderThresholdM } from '../../utils/lithoLayerMerge'

/** One litho body spanning 2–8 m; the packing bands below all live inside it. */
const LITHO_BODY = { topDepthM: 2, baseDepthM: 8 }

/** A second litho body directly beneath it, so "different body" is testable. */
const DEEPER_LITHO_BODY = { topDepthM: 8, baseDepthM: 14 }

/** Three packing bands stacked inside LITHO_BODY, plus one inside the deeper body. */
const BANDS = [
  { layerId: 'b-1', formationId: 'f-c5', anchorIsCpt: true, topDepthM: 2, baseDepthM: 4 },
  { layerId: 'b-2', formationId: 'f-c6', anchorIsCpt: true, topDepthM: 4, baseDepthM: 6 },
  { layerId: 'b-3', formationId: 'f-c7', anchorIsCpt: true, topDepthM: 6, baseDepthM: 8 },
  { layerId: 'b-4', formationId: 'f-c5', anchorIsCpt: true, topDepthM: 8, baseDepthM: 14 },
]

describe('a packing boundary moves freely inside its litho body', () => {
  it('CL1 — a depth well inside the body is taken as asked, with nothing to report', () => {
    const result = clampSplitDepth(LITHO_BODY, 5.25)

    expect(result.depthM).toBeCloseTo(5.25, 6)
    expect(result.clampedAt).toBe('none')
    expect(result.clampReason).toBeNull()
  })

  it('CL6 — crossing an internal packing boundary is free; only the litho edge is a wall', () => {
    // 3.5 m is inside band b-1, 6.5 m inside b-3. Dragging from one to the other crosses
    // two packing boundaries and must not be stopped by either: they are the owner's own
    // subdivision, not a level above him.
    expect(clampSplitDepth(LITHO_BODY, 3.5).clampedAt).toBe('none')
    expect(clampSplitDepth(LITHO_BODY, 6.5).clampedAt).toBe('none')
    expect(bandAtDepth(BANDS, 3.5)?.layerId).toBe('b-1')
    expect(bandAtDepth(BANDS, 6.5)?.layerId).toBe('b-3')
  })
})

describe('and clamps at the edge of the litho body', () => {
  it('CL2 — dragging above the litho body stops at its top, never above it', () => {
    const result = clampSplitDepth(LITHO_BODY, 0.4)

    expect(result.depthM).toBeGreaterThanOrEqual(LITHO_BODY.topDepthM)
    expect(result.clampedAt).toBe('litho-top')
  })

  it('CL3 — dragging below the litho body stops at its base, never below it', () => {
    const result = clampSplitDepth(LITHO_BODY, 11.7)

    expect(result.depthM).toBeLessThanOrEqual(LITHO_BODY.baseDepthM)
    expect(result.clampedAt).toBe('litho-base')
  })

  it('CL4 — the clamp stops just inside, so a split can never land ON the litho contact', () => {
    // Landing exactly on the contact would ask for a zero-thickness packing band, which
    // the mm-rounded no-overlap constraint turns into a 500 rather than a layer.
    const atTop = clampSplitDepth(LITHO_BODY, -5)
    const atBase = clampSplitDepth(LITHO_BODY, 99)

    expect(atTop.depthM).toBeGreaterThan(LITHO_BODY.topDepthM)
    expect(atBase.depthM).toBeLessThan(LITHO_BODY.baseDepthM)
    expect(atTop.depthM - LITHO_BODY.topDepthM).toBeCloseTo(SPLIT_EDGE_EPSILON_M, 6)
    expect(LITHO_BODY.baseDepthM - atBase.depthM).toBeCloseTo(SPLIT_EDGE_EPSILON_M, 6)
  })

  it('CL5 — the clamp says the litho boundary is what stopped it, so the gesture can explain', () => {
    const result = clampSplitDepth(LITHO_BODY, 0.4)

    expect(result.clampReason).toBeTruthy()
    expect(result.clampReason?.toLowerCase()).toContain('litho')
  })
})

describe('the enclosing litho body is what a split is bounded by', () => {
  it('CL7 — a depth resolves to the litho body that contains it', () => {
    expect(enclosingLithoBody([LITHO_BODY, DEEPER_LITHO_BODY], 5)).toEqual(LITHO_BODY)
    expect(enclosingLithoBody([LITHO_BODY, DEEPER_LITHO_BODY], 9)).toEqual(DEEPER_LITHO_BODY)
  })

  it('CL8 — a depth in no litho body has no bounds, so no split may be placed there', () => {
    expect(enclosingLithoBody([LITHO_BODY, DEEPER_LITHO_BODY], 20)).toBeNull()
  })

  it('CL9 — bands are read per column, top to bottom, so the stack matches the drawing', () => {
    const layers = [
      { id: 'x', formation_id: 'f-c6', cpt_id: 'cpt-1', borehole_id: null, depth_top_m: 4, depth_base_m: 6 },
      { id: 'y', formation_id: 'f-c5', cpt_id: 'cpt-1', borehole_id: null, depth_top_m: 2, depth_base_m: 4 },
      { id: 'z', formation_id: 'f-c5', cpt_id: 'cpt-2', borehole_id: null, depth_top_m: 2, depth_base_m: 4 },
    ]

    expect(columnBands(layers, 'cpt-1').map(b => b.layerId)).toEqual(['y', 'x'])
  })
})

describe('a merge is bounded by the same litho body', () => {
  it('MG1 — two adjacent bands inside one litho body may be merged', () => {
    const result = canMergeBands(BANDS[1], BANDS[2], [LITHO_BODY, DEEPER_LITHO_BODY])

    expect(result.ok).toBe(true)
  })

  it('MG2 — bands in different litho bodies may not: the boundary between them is litho’s', () => {
    // b-3 ends at 8 m and b-4 starts at 8 m: adjacent, but 8 m is the litho contact.
    // Merging them would erase a litho boundary from the geotech axis, which ruling 2
    // forbids outright — this is the one refusal that is correct, not a defect.
    const result = canMergeBands(BANDS[2], BANDS[3], [LITHO_BODY, DEEPER_LITHO_BODY])

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason.toLowerCase()).toContain('litho')
  })

  it('MG5 — and it points at the gesture in front of him, not only at the other axis', () => {
    // The refusal used to end "edit it on the litho axis instead", which was true when
    // nothing on this screen could move a contact. Since 2026-08-08 the contact IS
    // draggable here (owner ruling), so sending the engineer to another axis would send
    // him away from the answer. The rule is unchanged and stays in the message — what
    // changed is that there are now two ways to act on it, and the near one comes first.
    const result = canMergeBands(BANDS[2], BANDS[3], [LITHO_BODY, DEEPER_LITHO_BODY])

    expect(result.ok).toBe(false)
    if (result.ok === false) {
      expect(result.reason).toContain('Drag the contact')
      // The rule is the half that did not change; a reword must not quietly drop it.
      expect(result.reason).toContain('never crosses')
    }
  })

  it('MG3 — bands that do not touch may not be merged; there is material between them', () => {
    const result = canMergeBands(BANDS[0], BANDS[2], [LITHO_BODY, DEEPER_LITHO_BODY])

    expect(result.ok).toBe(false)
  })

  it('MG4 — the pair must be given upper-then-lower, matching what the boundary joins', () => {
    const result = canMergeBands(BANDS[2], BANDS[1], [LITHO_BODY, DEEPER_LITHO_BODY])

    expect(result.ok).toBe(false)
  })
})

describe('neither verb applies to a borehole', () => {
  // Owner ruling A (2026-08-01). Both verbs re-derive the NAD class from cone resistance,
  // and a borehole records none — its bands' classes were extrapolated from the surrounding
  // CPTs by "Divide boreholes". So the gesture is not offered there, and the anchor that
  // decides it is the BAND's own: a borehole standing beside a CPT is still a borehole.
  const boreholeLayers = [
    { id: 'p', formation_id: 'f-c5', cpt_id: null, borehole_id: 'bh-1', depth_top_m: 2, depth_base_m: 5 },
    { id: 'q', formation_id: 'f-c6', cpt_id: null, borehole_id: 'bh-1', depth_top_m: 5, depth_base_m: 8 },
  ]

  it('AN1 — a band reports the anchor it actually hangs off', () => {
    const cptBands = columnBands(
      [{ id: 'x', formation_id: 'f-c6', cpt_id: 'cpt-1', borehole_id: null, depth_top_m: 4, depth_base_m: 6 }],
      'cpt-1',
    )

    expect(cptBands[0].anchorIsCpt).toBe(true)
    expect(columnBands(boreholeLayers, 'bh-1')[0].anchorIsCpt).toBe(false)
  })

  it('AN2 — a borehole column is not hand-editable', () => {
    expect(columnIsHandEditable(columnBands(boreholeLayers, 'bh-1'))).toBe(false)
  })

  it('AN3 — a CPT column is, so the refusal does not swallow the feature', () => {
    expect(columnIsHandEditable(BANDS)).toBe(true)
  })

  it('AN4 — and an empty column is not: there is nothing there to edit', () => {
    expect(columnIsHandEditable([])).toBe(false)
  })
})


// ---------------------------------------------------------------------------
// DR — clampDragDepth: the drag verb's per-frame clamp (owner 2026-08-07)
// ---------------------------------------------------------------------------
//
// Drag is only offered on a mergeable pair (same litho body), so the PAIR's
// own envelope is the wall: the boundary moves freely between the pair's outer
// edges and visibly refuses to leave them. The litho walls need no second
// check — the pair cannot exceed its own body.

describe('clampDragDepth — the boundary moves freely inside the pair', () => {
  const upper = { layerId: 'u', topDepthM: 3, baseDepthM: 4, nadClass: 7, anchorIsCpt: true }
  const lower = { layerId: 'l', topDepthM: 4, baseDepthM: 7, nadClass: 8, anchorIsCpt: true }

  it('DR1 — inside the pair the cursor is followed exactly', () => {
    const clamped = clampDragDepth(upper, lower, 5.25)
    expect(clamped.depthM).toBe(5.25)
    expect(clamped.atLimit).toBe('none')
  })

  it('DR2 — dragging past the upper band top stops at it and names the limit', () => {
    const clamped = clampDragDepth(upper, lower, 1.0)
    expect(clamped.depthM).toBeCloseTo(3 + SPLIT_EDGE_EPSILON_M, 6)
    expect(clamped.atLimit).toBe('upper')
  })

  it('DR3 — dragging past the lower band base stops at it symmetrically', () => {
    const clamped = clampDragDepth(upper, lower, 9.0)
    expect(clamped.depthM).toBeCloseTo(7 - SPLIT_EDGE_EPSILON_M, 6)
    expect(clamped.atLimit).toBe('lower')
  })
})

// ---------------------------------------------------------------------------
// AB — dragAbsorbPrediction: squeeze the neighbour to a sliver → merge
// ---------------------------------------------------------------------------
//
// Owner decision 2026-08-07: "Absorb, like litho" — the SAME
// max(0.1 m, 15 % of original thickness) remaining-sliver rule the litho
// ghost cross-merge uses, hoisted into one shared helper so the two axes'
// absorb feel can never drift.

describe('dragAbsorbPrediction — drag-up-to-collapse becomes a merge', () => {
  const upper = { layerId: 'u', topDepthM: 3, baseDepthM: 4, nadClass: 7, anchorIsCpt: true }
  const lower = { layerId: 'l', topDepthM: 4, baseDepthM: 7, nadClass: 8, anchorIsCpt: true }

  it('AB1 — mid-pair there is no absorb', () => {
    expect(dragAbsorbPrediction(upper, lower, 5.0)).toBeNull()
  })

  it('AB2 — the 0.1 m floor governs a thin band', () => {
    // upper is 1 m thick → threshold max(0.1, 0.15) = 0.15 m remaining.
    expect(dragAbsorbPrediction(upper, lower, 3.1)).toEqual({ side: 'upper' })
    expect(dragAbsorbPrediction(upper, lower, 3.2)).toBeNull()
  })

  it('AB3 — 15 % governs a thick band', () => {
    // lower is 3 m thick → threshold 0.45 m remaining.
    expect(dragAbsorbPrediction(upper, lower, 6.6)).toEqual({ side: 'lower' })
    expect(dragAbsorbPrediction(upper, lower, 6.5)).toBeNull()
  })

  it('AB4 — the upper side is symmetric', () => {
    const thickUpper = { layerId: 'u', topDepthM: 0, baseDepthM: 4, nadClass: 7, anchorIsCpt: true }
    const thinLower = { layerId: 'l', topDepthM: 4, baseDepthM: 5, nadClass: 8, anchorIsCpt: true }
    // thickUpper 4 m → threshold 0.6 m remaining.
    expect(dragAbsorbPrediction(thickUpper, thinLower, 0.5)).toEqual({ side: 'upper' })
  })

  it('AB5 — the threshold is the exact helper litho cross-merge uses', () => {
    expect(absorbRemainderThresholdM(1.0)).toBe(0.15)
    expect(absorbRemainderThresholdM(0.4)).toBe(0.1) // the floor
    expect(absorbRemainderThresholdM(2.0)).toBeCloseTo(0.3, 10)
  })
})

describe('the absorb needs a squeeze, not merely a thin band', () => {
  // An absorb means "you pushed this band away". A band that was ALREADY
  // thinner than the floor has not been pushed anywhere just by existing —
  // and at rest, before any drag, nothing is being absorbed at all. Without
  // a direction the prediction fires on a 5 cm band the moment it is touched,
  // so the release silently MERGES two bands the engineer only meant to nudge.
  const THIN_UPPER = { topDepthM: 3.0, baseDepthM: 3.05 } // 5 cm — under the 10 cm floor
  const FAT_LOWER = { topDepthM: 3.05, baseDepthM: 9.05 }

  it('AB6 — a band already thinner than the floor is not absorbed at rest', () => {
    expect(dragAbsorbPrediction(THIN_UPPER, FAT_LOWER, 3.05)).toBeNull()
  })

  it('AB7 — dragging away from a thin band GROWS it, which is never an absorb', () => {
    // 3.05 → 3.09 makes the upper band thicker. Still under the floor, but the
    // gesture is the opposite of a squeeze.
    expect(dragAbsorbPrediction(THIN_UPPER, FAT_LOWER, 3.09)).toBeNull()
  })

  it('AB8 — squeezing that same thin band the other way still absorbs it', () => {
    // 3.05 → 3.01 shrinks it to 1 cm: the squeeze the verb is for.
    expect(dragAbsorbPrediction(THIN_UPPER, FAT_LOWER, 3.01)).toEqual({ side: 'upper' })
  })
})
