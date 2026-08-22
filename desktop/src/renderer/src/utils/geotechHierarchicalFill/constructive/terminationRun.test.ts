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

describe('terminationRun', () => {
  it('TR1 — the immediate neighbour reads the window: ordinary adjacent case', () => {
    const run: RunColumn[] = [
      col(0, 0, [band('near', 10, 0, 0, 0)]),
      col(1, 100, [band('b', 10, 0, 1, 100)]),
    ]
    const result = terminationRun(run, 1, -1, 10, 0)
    expect(result).toEqual({ columnIndex: 0, reads: true })
  })

  it('TR2 — the immediate neighbour is blind, but the NEXT one reads it: crosses the blind column', () => {
    const run: RunColumn[] = [
      col(0, 0, [band('far', 8, 4, 0, 0)]), // reads elevation 4..8, overlaps the band's own 5..10 window at [5,8]
      col(1, 50, []), // blind at that window
      col(2, 100, [band('b', 10, 5, 2, 100)]),
    ]
    const result = terminationRun(run, 2, -1, 10, 5)
    expect(result).toEqual({ columnIndex: 0, reads: true })
  })

  it('TR3 — nothing in that direction ever reads it: the run edge, reads=false', () => {
    const run: RunColumn[] = [
      col(0, 0, []),
      col(1, 50, []),
      col(2, 100, [band('b', 10, 5, 2, 100)]),
    ]
    const result = terminationRun(run, 2, -1, 10, 5)
    expect(result).toEqual({ columnIndex: 0, reads: false })
  })

  it('TR4 — walking off the run with nothing further to check (single-column run)', () => {
    const run: RunColumn[] = [col(0, 0, [band('b', 10, 5, 0, 0)])]
    const result = terminationRun(run, 0, 1, 10, 5)
    expect(result).toEqual({ columnIndex: 0, reads: false })
  })

  it('TR5 — a facing band that only PARTIALLY overlaps still counts as reading', () => {
    const run: RunColumn[] = [
      col(0, 0, [band('far', 7, 6, 0, 0)]), // overlaps [5,10] only in [6,7]
      col(1, 100, [band('b', 10, 5, 1, 100)]),
    ]
    const result = terminationRun(run, 1, -1, 10, 5)
    expect(result).toEqual({ columnIndex: 0, reads: true })
  })

  it('TR6 — a facing band that merely TOUCHES (zero-height overlap) does not count', () => {
    const run: RunColumn[] = [
      col(0, 0, [band('far', 5, 2, 0, 0)]), // top=5 exactly touches the band's own base=5, no real overlap
      col(1, 100, [band('b', 10, 5, 1, 100)]),
    ]
    const result = terminationRun(run, 1, -1, 10, 5)
    expect(result).toEqual({ columnIndex: 0, reads: false })
  })

  it('TR7 — walking right (dir=1) works symmetrically', () => {
    const run: RunColumn[] = [
      col(0, 0, [band('b', 10, 5, 0, 0)]),
      col(1, 50, []),
      col(2, 100, [band('far', 8, 4, 2, 100)]),
    ]
    const result = terminationRun(run, 0, 1, 10, 5)
    expect(result).toEqual({ columnIndex: 2, reads: true })
  })
})
