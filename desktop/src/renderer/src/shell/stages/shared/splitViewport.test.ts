// Behavioural pins for the 3-D split viewport (owner ballot 2026-08-26, #64).
//
// Two DIFFERENT things are called "split" in the viewer, and keeping them
// distinct is the whole job of this state machine:
//
//   CUT split      — one model, two viewports, each showing one half of a
//                    user-drawn plane. Shipped 2026-06-01 (debt #64 as
//                    originally written).
//   COMPARE split  — two DIFFERENT models side by side (litho left, geotech
//                    right), whole, at the same viewpoint. The thing the
//                    ballot still wants: "did my NAD subdivision respect the
//                    litho units?" is a question you answer by looking at both
//                    at once.
//
// The assertions below are phrased against what the engineer sees, not against
// the fields:
//
//   • asking to compare must show WHOLE models — a leftover cut plane would
//     hide half of each and the comparison would be a lie;
//   • drawing a cut line means "cut this model", so it leaves compare;
//   • one way back to a single view, from either mode;
//   • the Compare verb is only offered when there is something real on the
//     other side — a button that opens an empty pane is worse than no button.

import { describe, expect, it } from 'vitest'

import {
  SINGLE_VIEWPORT,
  canCompare,
  splitAfterCompare,
  splitAfterCutDrawn,
  splitAfterExit,
  type CompareScene,
} from './splitViewport'

/** Stand-ins for Cesium.Plane / SplitLine — the reducer never inspects them. */
const PLANE = { normal: 'n', distance: 3 }
const LINE = { x0: 0, y0: 0, x1: 10, y1: 10 }

describe('split viewport mode', () => {
  it('starts as one whole viewport', () => {
    expect(SINGLE_VIEWPORT).toEqual({ mode: 'single', plane: null, line: null })
  })

  it('shows whole models when asked to compare, even straight out of a cut', () => {
    const cut = splitAfterCutDrawn(SINGLE_VIEWPORT, PLANE, LINE)
    const compared = splitAfterCompare(cut)

    expect(compared.mode).toBe('compare')
    // The half-model clip is gone — both panes are complete.
    expect(compared.plane).toBeNull()
    expect(compared.line).toBeNull()
  })

  it('leaves compare when the user draws a cut line', () => {
    const compared = splitAfterCompare(SINGLE_VIEWPORT)
    const cut = splitAfterCutDrawn(compared, PLANE, LINE)

    expect(cut.mode).toBe('split')
    expect(cut.plane).toBe(PLANE)
    expect(cut.line).toBe(LINE)
  })

  it('returns to a single whole viewport from a cut', () => {
    const cut = splitAfterCutDrawn(SINGLE_VIEWPORT, PLANE, LINE)

    expect(splitAfterExit(cut)).toEqual(SINGLE_VIEWPORT)
  })

  it('returns to a single whole viewport from a comparison', () => {
    const compared = splitAfterCompare(SINGLE_VIEWPORT)

    expect(splitAfterExit(compared)).toEqual(SINGLE_VIEWPORT)
  })
})

describe('canCompare', () => {
  const formations = [{ id: 'f1' }] as unknown as CompareScene['formations']

  it('offers the comparison when the other model has built solids', () => {
    const scene: CompareScene = {
      label: 'Lithology',
      formations,
      bodySolids: [{ vertices: [[0, 0, 0]] }] as unknown as CompareScene['bodySolids'],
    }

    expect(canCompare(scene)).toBe(true)
  })

  it('offers the comparison when the other model has fence panels', () => {
    const scene: CompareScene = {
      label: 'Lithology',
      formations,
      fencePanels: [{ vertices: [[0, 0, 0]] }] as unknown as CompareScene['fencePanels'],
    }

    expect(canCompare(scene)).toBe(true)
  })

  it('does not offer a comparison against nothing', () => {
    // No counterpart stage open, nothing built there yet, or every solid came
    // back empty (a flagged slab carries zero triangles). Each of those would
    // open a blank second pane, which reads as "the viewer broke".
    expect(canCompare(null)).toBe(false)
    expect(canCompare(undefined)).toBe(false)
    expect(canCompare({ label: 'Lithology', formations })).toBe(false)
    expect(
      canCompare({
        label: 'Lithology',
        formations,
        bodySolids: [] as unknown as CompareScene['bodySolids'],
        fencePanels: [] as unknown as CompareScene['fencePanels'],
      }),
    ).toBe(false)
    expect(
      canCompare({
        label: 'Lithology',
        formations,
        bodySolids: [{ vertices: [] }] as unknown as CompareScene['bodySolids'],
      }),
    ).toBe(false)
  })
})
