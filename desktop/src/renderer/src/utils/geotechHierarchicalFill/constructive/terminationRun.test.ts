/**
 * Mirrors ``partitionFillV2/emitContinuation.ts``'s ``terminationRun`` for
 * the geotech constructive arm's own ``RunColumn``/``RunBand`` model — see
 * the module header there for the law: a column that read nothing at a
 * band's own levels is not a boundary; walk past it to the first column
 * that DID read that ground, or to the run's own edge if none ever did.
 */
import { describe, expect, it } from 'vitest'

import { terminationRun } from './terminationRun'
import type { RunBand, RunColumn } from './constructs'

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

/**
 * The section-wide stack of a run where this family is the ONLY one on the
 * section — every column's stack is exactly its run bands, so each pin below
 * keeps the meaning it was written with. TR8 is the one case that hands a
 * column MORE than its run carries.
 */
const stacksOf = (run: readonly RunColumn[]): Map<number, readonly RunBand[]> =>
  new Map(run.map((c) => [c.ci, c.bands]))

describe('terminationRun', () => {
  it('TR1 — the immediate neighbour reads the window: ordinary adjacent case', () => {
    const run: RunColumn[] = [
      col(0, 0, [band('near', 10, 0, 0, 0)]),
      col(1, 100, [band('b', 10, 0, 1, 100)]),
    ]
    const result = terminationRun(run, 1, -1, 10, 0, stacksOf(run))
    expect(result).toEqual({ columnIndex: 0, reads: true })
  })

  it('TR2 — the immediate neighbour is blind, but the NEXT one reads it: crosses the blind column', () => {
    const run: RunColumn[] = [
      col(0, 0, [band('far', 8, 4, 0, 0)]), // reads elevation 4..8, overlaps the band's own 5..10 window at [5,8]
      col(1, 50, []), // blind at that window
      col(2, 100, [band('b', 10, 5, 2, 100)]),
    ]
    const result = terminationRun(run, 2, -1, 10, 5, stacksOf(run))
    expect(result).toEqual({ columnIndex: 0, reads: true })
  })

  it('TR3 — nothing in that direction ever reads it: the run edge, reads=false', () => {
    const run: RunColumn[] = [
      col(0, 0, []),
      col(1, 50, []),
      col(2, 100, [band('b', 10, 5, 2, 100)]),
    ]
    const result = terminationRun(run, 2, -1, 10, 5, stacksOf(run))
    expect(result).toEqual({ columnIndex: 0, reads: false })
  })

  it('TR4 — walking off the run with nothing further to check (single-column run)', () => {
    const run: RunColumn[] = [col(0, 0, [band('b', 10, 5, 0, 0)])]
    const result = terminationRun(run, 0, 1, 10, 5, stacksOf(run))
    expect(result).toEqual({ columnIndex: 0, reads: false })
  })

  it('TR5 — a facing band that only PARTIALLY overlaps still counts as reading', () => {
    const run: RunColumn[] = [
      col(0, 0, [band('far', 7, 6, 0, 0)]), // overlaps [5,10] only in [6,7]
      col(1, 100, [band('b', 10, 5, 1, 100)]),
    ]
    const result = terminationRun(run, 1, -1, 10, 5, stacksOf(run))
    expect(result).toEqual({ columnIndex: 0, reads: true })
  })

  it('TR6 — a facing band that merely TOUCHES (zero-height overlap) does not count', () => {
    const run: RunColumn[] = [
      col(0, 0, [band('far', 5, 2, 0, 0)]), // top=5 exactly touches the band's own base=5, no real overlap
      col(1, 100, [band('b', 10, 5, 1, 100)]),
    ]
    const result = terminationRun(run, 1, -1, 10, 5, stacksOf(run))
    expect(result).toEqual({ columnIndex: 0, reads: false })
  })

  it('TR7 — walking right (dir=1) works symmetrically', () => {
    const run: RunColumn[] = [
      col(0, 0, [band('b', 10, 5, 0, 0)]),
      col(1, 50, []),
      col(2, 100, [band('far', 8, 4, 2, 100)]),
    ]
    const result = terminationRun(run, 0, 1, 10, 5, stacksOf(run))
    expect(result).toEqual({ columnIndex: 2, reads: true })
  })

  it('TR8 — a column blind to THIS FAMILY but whose own stack read the levels stops the walk there', () => {
    // TR2's run — the middle column carries no band of this family — except
    // that its own column stack read the window as another family's soil.
    // Owner ruling 2026-08-25: the walk stops at any column that measured this
    // ground, so the termination is the MIDDLE column, not the far one.
    const run: RunColumn[] = [
      col(0, 0, [band('far', 8, 4, 0, 0)]),
      col(1, 50, []),
      col(2, 100, [band('b', 10, 5, 2, 100)]),
    ]
    const stacks = new Map<number, readonly RunBand[]>([
      [0, run[0].bands],
      [1, [band('other-family', 9, 6, 1, 50)]],
      [2, run[2].bands],
    ])
    const result = terminationRun(run, 2, -1, 10, 5, stacks)
    expect(result).toEqual({ columnIndex: 1, reads: true })
  })
})
