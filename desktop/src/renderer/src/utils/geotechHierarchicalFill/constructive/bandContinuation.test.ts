/**
 * The bridging pass: for a genuine 0-tie band whose immediate run-neighbour
 * is blind but a column further along the SAME run reads its ground, work
 * out which gaps the band must be spliced into so it becomes visible there
 * too. ``buildGapConstructs``'s EXISTING, unchanged ``facingHasData`` check
 * (evaluated fresh, per gap, against the section-wide ``stacks``) then
 * naturally sorts each spliced gap into a flat full-thickness pass-through
 * (``extendsToFar``, wherever that gap's own immediate flank is STILL
 * blind) or the ordinary, correctly-scaled pinch (the one gap whose flank
 * genuinely reads the ground) — this module only decides WHERE the band
 * must be visible, never HOW it is drawn there.
 *
 * Mirrors ``partitionFillV2/subTdContinuation.test.ts``'s scene 3 shape
 * (their real CS1 FAR/SHORT/DEEP columns) — a 3-column run where the
 * immediate neighbour is blind but the one beyond it reads the ground.
 */
import { describe, expect, it } from 'vitest'

import { bandContinuations } from './bandContinuation'
import type { RunBand, RunColumn, RunTie } from './constructs'

const band = (layerId: string, top: number, base: number, ci: number, x: number): RunBand => ({
  layerId,
  formationId: 'f-x',
  bodyId: null,
  top,
  base,
  ci,
  x,
})

const col = (ci: number, x: number, bands: RunBand[]): RunColumn => ({ ci, x, bands })

/** The splice for one specific band, or undefined if it never got one. */
function spliceFor(splices: ReturnType<typeof bandContinuations>, layerId: string) {
  return splices.find((s) => s.band.layerId === layerId)
}

describe('bandContinuations', () => {
  it('BC1 — FAR reads it, SHORT (ci=1) is blind: deep-veen is spliced into gap 0 only (gap 1 is its OWN gap, already handled)', () => {
    // FAR (ci=0) reads the band's window. SHORT (ci=1) is blind at it.
    // DEEP (ci=2) carries the band itself. Frame gaps: 0 = FAR|SHORT, 1 = SHORT|DEEP.
    // Gap 1 is deep-veen's OWN gap — today's existing extendsToFar already
    // handles it correctly and unchanged; the splice's job is gap 0 only.
    //
    // far-unit ALSO legitimately reaches back toward deep-veen by the SAME
    // law (its own immediate neighbour, SHORT, is blind to it too, and
    // deep-veen's window overlaps its own) — that is not a bug, it is the
    // engine's existing nearest-test-wins tie-break resolving a genuine
    // mutual reach, so this test only asserts on deep-veen's own splice.
    const run: RunColumn[] = [
      col(0, 0, [band('far-unit', 8, 4, 0, 0)]),
      col(1, 50, []),
      col(2, 100, [band('deep-veen', 7.75, 6.65, 2, 100)]),
    ]
    const splice = spliceFor(bandContinuations(run, []), 'deep-veen')
    expect(splice?.gaps).toEqual([0])
  })

  it('BC2 — the immediate neighbour already reads it: no splice needed', () => {
    const run: RunColumn[] = [
      col(0, 0, [band('near-unit', 10, 0, 0, 0)]),
      col(1, 100, [band('b', 10, 0, 1, 100)]),
    ]
    expect(spliceFor(bandContinuations(run, []), 'b')).toBeUndefined()
  })

  it('BC3 — nothing anywhere reads it: the run edge, no splice (today\'s curtain is final)', () => {
    const run: RunColumn[] = [
      col(0, 0, []),
      col(1, 50, []),
      col(2, 100, [band('b', 10, 5, 2, 100)]),
    ]
    expect(spliceFor(bandContinuations(run, []), 'b')).toBeUndefined()
  })

  it('BC4 — a TIED band never gets a splice, even with a blind immediate neighbour', () => {
    const run: RunColumn[] = [
      col(0, 0, [band('far-unit', 8, 4, 0, 0)]),
      col(1, 50, []),
      col(2, 100, [band('deep-veen', 7.75, 6.65, 2, 100)]),
    ]
    const ties: RunTie[] = [
      { key: 't', leftCi: 1, rightCi: 2, leftX: 50, rightX: 100, leftY: 7.75, rightY: 7.75 },
    ]
    expect(spliceFor(bandContinuations(run, ties), 'deep-veen')).toBeUndefined()
  })

  it('BC5 — two blind columns in a row: the band is spliced into BOTH gaps it must cross (0 and 1), gap 2 (its own) excluded', () => {
    // Frame gaps: 0 = FAR|blind1, 1 = blind1|blind2, 2 = blind2|DEEP (the
    // band's own gap — today's extendsToFar, unchanged, excluded here).
    const run: RunColumn[] = [
      col(0, 0, [band('far-unit', 8, 4, 0, 0)]),
      col(1, 50, []),
      col(2, 75, []),
      col(3, 100, [band('deep', 7, 5, 3, 100)]),
    ]
    const splice = spliceFor(bandContinuations(run, []), 'deep')
    expect(splice?.gaps).toEqual([0, 1])
  })

  it('BC6 — walking rightward (dir=1) mirrors the same law symmetrically', () => {
    const run: RunColumn[] = [
      col(0, 0, [band('near', 10, 5, 0, 0)]),
      col(1, 50, []),
      col(2, 100, [band('far-unit', 8, 4, 2, 100)]),
    ]
    const splice = spliceFor(bandContinuations(run, []), 'near')
    expect(splice?.gaps).toEqual([1])
  })
})
