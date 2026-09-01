/**
 * constructive/mergeFaces.separations.test.ts — the "Separate" cannot-link threaded into
 * the geotech weld primitive (owner 2026-08-31, debt #278 R5; dogfeed 2026-09-01).
 *
 * ``mergeFaces`` is the single weld both geotech sites delegate to — the per-gap
 * ``fillGap`` merge and the cross-family sweep. Threading ``separatedPairs`` +
 * ``layerIdsOf`` here makes a same-class touching pair the engineer split stay two
 * components (its shared seam survives), while an absent / empty separations input leaves
 * the weld byte-identical.
 */

import { describe, expect, it } from 'vitest'

import { mergeFaces, type LabelledFace } from './mergeFaces'

/** A rectangle ring, CCW-agnostic (mergeFaces normalises orientation). */
function rectRing(
  fLo: number,
  fHi: number,
  eLo: number,
  eHi: number,
): { fraction: number; elevation: number }[] {
  return [
    { fraction: fLo, elevation: eHi },
    { fraction: fHi, elevation: eHi },
    { fraction: fHi, elevation: eLo },
    { fraction: fLo, elevation: eLo },
  ]
}

type Band = { layerId: string }

/** Two same-class rectangles sharing the fraction-0.5 edge. */
function touchingPair(): LabelledFace<Band>[] {
  return [
    { key: 'ZAND|6', label: { layerId: 'lyr-A' }, ring: rectRing(0.0, 0.5, 4, 8) },
    { key: 'ZAND|6', label: { layerId: 'lyr-B' }, ring: rectRing(0.5, 1.0, 4, 8) },
  ]
}

describe('mergeFaces — separations are a cannot-link on the geotech weld', () => {
  it('(M1) two same-class touching faces the engineer Separated stay UNWELDED', () => {
    // Baseline: no separation → they weld into one component.
    const welded = mergeFaces(touchingPair())
    expect(welded).toHaveLength(1)
    expect(welded[0].welded).toBe(true)
    expect(new Set(welded[0].members.map((m) => m.layerId))).toEqual(new Set(['lyr-A', 'lyr-B']))

    // With the separation lyr-A | lyr-B (a < b) they do NOT weld: two components, each a
    // lone face carrying only its own band.
    const split = mergeFaces(touchingPair(), {
      layerIdsOf: (band) => [band.layerId],
      separatedPairs: new Set(['lyr-A|lyr-B']),
    })
    expect(split).toHaveLength(2)
    expect(split.every((e) => e.welded === false)).toBe(true)
    expect(new Set(split.map((e) => e.label.layerId))).toEqual(new Set(['lyr-A', 'lyr-B']))
  })

  it('(M2) an empty (and an absent) separations input is byte-identical', () => {
    const base = mergeFaces(touchingPair())
    const emptySet = mergeFaces(touchingPair(), {
      layerIdsOf: (band) => [band.layerId],
      separatedPairs: new Set<string>(),
    })
    const noLayerFn = mergeFaces(touchingPair(), { separatedPairs: new Set(['lyr-A|lyr-B']) })
    // Empty set: identical to the plain call.
    expect(emptySet).toEqual(base)
    // A separation with NO layerIdsOf cannot read side membership, so no face is
    // constrained and the weld is unchanged — the cannot-link needs both halves.
    expect(noLayerFn).toEqual(base)
  })

  it('(M3) an unrelated separation does not block a weld', () => {
    // lyr-C | lyr-D touches neither face — the pair welds as normal.
    const split = mergeFaces(touchingPair(), {
      layerIdsOf: (band) => [band.layerId],
      separatedPairs: new Set(['lyr-C|lyr-D']),
    })
    expect(split).toHaveLength(1)
    expect(split[0].welded).toBe(true)
  })
})
