/**
 * emitSharedContactOnlap emits the flood wedge past the onlap tip as two sub-triangles that SHARE
 * one convergence-to-apex closing edge. These tests pin the owner-level behaviour of that shared
 * edge, phrased in the reviewer's words:
 *   - a shared-contact onlap emits its (convergence-to-apex) closing curve exactly once;
 *   - a degenerate wedge (zero height at the convergence point) emits no closing curve.
 */
import { describe, expect, it } from 'vitest'

import { type IntervalUnit } from './emitIntervalLenses'
import { type LensLabel } from './emitLenses'
import { type LonePinchBracket } from './emitLonePinch'
import { emitSharedContactOnlap } from './emitSharedContactOnlap'
import { type InputCurve, type Point } from './types'

/** A minority interval unit; only its ``unit`` litho label is read (the geometry rides the brackets). */
function intervalUnit(topElev: number, baseElev: number): IntervalUnit {
  return { unit: { layerId: 'u', formationId: 'MIN', bodyId: null, topElev, baseElev }, topElev, baseElev }
}

/** An interval bracket interface (leftElev on the lone column, rightElev on the facing column). */
function bracket(leftElev: number, rightElev: number): LonePinchBracket {
  return { leftElev, rightElev, anchor: true }
}

interface RunOpts {
  loneX: number
  facingX: number
  top: LonePinchBracket
  base: LonePinchBracket
  baseTied: boolean
}

/** Run the onlap emitter for a left-side unit and return every curve it emitted. */
function run(opts: RunOpts): InputCurve[] {
  const out: InputCurve[] = []
  let fi = 0
  let ci = 0
  emitSharedContactOnlap(
    intervalUnit(opts.top.leftElev, opts.base.leftElev),
    'left',
    opts.loneX,
    opts.facingX,
    opts.top,
    opts.base,
    opts.baseTied,
    { formationId: 'MATRIX', bodyId: null },
    () => `c${ci++}`,
    () => `flood${fi++}`,
    new Map<string, LensLabel>(),
    out,
  )
  return out
}

/** The flood-wedge curves (their ids come from the ``nextFloodId`` allocator). */
function floodCurves(out: InputCurve[]): InputCurve[] {
  return out.filter((c) => c.id.startsWith('flood'))
}

/** Whether two points fall in the same 1 mm snap cell (matches the engine's degeneracy test). */
function sameCell(a: Point, b: Point): boolean {
  const S = 0.001
  return Math.round(a.x / S) === Math.round(b.x / S) && Math.round(a.y / S) === Math.round(b.y / S)
}

describe('emitSharedContactOnlap', () => {
  it('emits the convergence-to-apex closing curve exactly once', () => {
    // A real gap: the top and base sub-triangles share ONE conv->apex edge, so that closing curve
    // must appear once in the output, not once per corner.
    const out = run({ loneX: 0, facingX: 100, top: bracket(5, 4), base: bracket(1, 0), baseTied: true })
    // conv and apex, recomputed from the same geometry the emitter uses.
    const conv: Point = { x: 100, y: (4 + 0) / 2 }
    const apex: Point = { x: 0 + 0.5 * (100 - 0), y: 1 + 0.5 * (0 - 1) }
    const convToApex = floodCurves(out).filter(
      (c) => sameCell(c.points[0], conv) && sameCell(c.points[c.points.length - 1], apex),
    )
    expect(convToApex.length).toBe(1)
  })

  it('a degenerate wedge (zero height at the convergence point) emits no closing curve', () => {
    // facingTop == loneBase puts the facing convergence at the same elevation as the onlap apex,
    // and a zero-width gap puts them at the same x: conv coincides with apex, so there is no
    // vacated height past the tip and no convergence-to-apex closing (nor any zero-length curve).
    const out = run({ loneX: 0, facingX: 0, top: bracket(5, 2), base: bracket(2, 0), baseTied: true })
    const degenerate = floodCurves(out).filter((c) => sameCell(c.points[0], c.points[c.points.length - 1]))
    expect(degenerate.length).toBe(0)
  })
})
