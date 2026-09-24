// Owner 2026-09-23, subdividing testproject_dev: "i copied the ghost from the
// drilling to the cptm, but i couldn't drag the bottom unit to the bottom of the
// cptm." A ghost column copied from a shallower borehole ends at the borehole's
// depth; the CPT goes on below it. The base drag's outer bound was the last
// layer's OWN base (right for a segmenter column, which already reaches the test
// bottom), so the deepest unit could never be pulled down to the CPT's terminal
// depth. The bound is the test's terminal depth when it is known.
import { describe, expect, it } from 'vitest'

import type { LithoLayerSuggestion } from '../api/client'
import { computeDragBounds } from './lithoBoundaryHelpers'

function layer(depth_top_m: number, depth_base_m: number): LithoLayerSuggestion {
  return {
    depth_top_m,
    depth_base_m,
    suggested_lithology: 'ZAND',
    suggested_admixtures: [],
    suggested_nad_class: null,
    mean_qc_mpa: null,
    dr_pct: null,
    confidence: 'medium',
    source: 'manual_pick',
    parent_formation_id: null,
    spans_boundary: false,
  }
}

// The copied column: three units ending at the borehole's 8.0 m; the CPT reaches 15.2 m.
const COPIED = [layer(0, 3), layer(3, 5), layer(5, 8)]
const NONE = new Set<number>()

describe('dragging the deepest ghost unit down to the test bottom', () => {
  it('the last layer\'s base can reach the test\'s terminal depth', () => {
    const b = computeDragBounds('base', 2, COPIED, undefined, NONE, NONE, 15.2)
    expect(b.boundsBelowM).toBe(15.2)
    expect(b.boundsAboveM).toBe(5)
  })

  it('without a known terminal depth the bound stays the last layer\'s base (a segmenter column already reaches the bottom)', () => {
    const b = computeDragBounds('base', 2, COPIED, undefined, NONE, NONE)
    expect(b.boundsBelowM).toBe(8)
    const c = computeDragBounds('base', 2, COPIED, undefined, NONE, NONE, null)
    expect(c.boundsBelowM).toBe(8)
  })

  it('a terminal depth above the last base never pulls the bound up', () => {
    const b = computeDragBounds('base', 2, COPIED, undefined, NONE, NONE, 7.5)
    expect(b.boundsBelowM).toBe(8)
  })

  it('a middle layer\'s base is still bounded by the layer below it, not by the terminal depth', () => {
    const b = computeDragBounds('base', 0, COPIED, undefined, NONE, NONE, 15.2)
    expect(b.boundsBelowM).toBe(5)
  })

  it('with every layer below rejected, the base can reach the terminal depth', () => {
    const b = computeDragBounds('base', 0, COPIED, undefined, NONE, new Set([1, 2]), 15.2)
    expect(b.boundsBelowM).toBe(15.2)
  })
})

// Ctrl+drag absorb-all (owner 2026-09-23/24): the dragged edge may travel through every
// consecutive PENDING unit in its direction; an accepted contact is where it stops; with none,
// the test bottom (base) or the ground (top). The reducer absorbs on release, so no snap chain.
const RUN = [layer(0, 3), layer(3, 5), layer(5, 8), layer(8, 11)]

describe('Ctrl+drag absorb-all bounds', () => {
  it('a base drag runs through every pending unit below to the test bottom', () => {
    const b = computeDragBounds('base', 0, RUN, undefined, NONE, NONE, 15.2, { absorbAll: true })
    expect(b.boundsBelowM).toBe(15.2)
    expect(b.collapseChainBelow).toEqual([])
    expect(b.boundsAboveM).toBe(0)
    expect(b.collapseChainAbove).toEqual([0])
  })

  it('an accepted contact below stops it at that contact\'s near edge', () => {
    const b = computeDragBounds('base', 0, RUN, undefined, new Set([2]), NONE, 15.2, { absorbAll: true })
    expect(b.boundsBelowM).toBe(5)
  })

  it('a top drag runs through every pending unit above to the ground', () => {
    const b = computeDragBounds('top', 3, RUN, undefined, NONE, NONE, 15.2, { absorbAll: true })
    expect(b.boundsAboveM).toBe(0)
    expect(b.collapseChainAbove).toEqual([])
    expect(b.boundsBelowM).toBe(11)
  })

  it('an accepted contact above stops it at that contact\'s base', () => {
    const b = computeDragBounds('top', 3, RUN, undefined, new Set([1]), NONE, 15.2, { absorbAll: true })
    expect(b.boundsAboveM).toBe(5)
  })

  it('without the option the bound is still the immediate neighbour\'s far edge', () => {
    const b = computeDragBounds('base', 0, RUN, undefined, NONE, NONE, 15.2)
    expect(b.boundsBelowM).toBe(5)
  })
})
