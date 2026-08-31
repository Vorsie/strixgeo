// The geotech partition is assembled on the LITHO FRAME's column axis, so an
// undivided borehole cannot make the two models' gap indices drift apart.
//
// Owner dogfeed 2026-08-15: "clearly the litho model isn't the base of the
// geotech fill because it mismatches a ton" / "what are those weird polygons
// between the boreholes?" / "i don't see the hashed fallback nowhere".
//
// Pinned claims:
//   FA1  A frame column the model has no bands for still occupies its place,
//        carrying an EMPTY stack — it is never dropped, never re-indexed away.
//   FA2  Runs stop AT an un-banded column: no run ever contains one, so the
//        engine can never draw geometry across it.
//   FA3  A lone banded column between two un-banded ones spans no gap and
//        yields no run.
//   FA4  A run's regions come back on the FRAME's gap axis.
//   FA5  Every column banded ⇒ exactly one run at offset 0, and the shift is
//        an identity — the litho axis's render is untouched.

import { describe, expect, it } from 'vitest'

import {
  frameAlignedColumns,
  frameGapRuns,
  shiftGapIndexed,
  shiftRegionGaps,
} from './frameAlignedPartition'
import type { PartitionColumn, SectionRegion } from './sectionPartition'

function col(inv: string, unitCount = 1): PartitionColumn {
  return {
    investigationId: inv,
    surfaceElevM: 10,
    units: Array.from({ length: unitCount }, (_, i) => ({
      topDepthM: i,
      baseDepthM: i + 1,
      formationId: `f-${inv}`,
      bodyId: `b-${inv}`,
      layerId: `l-${inv}-${i}`,
    })),
  }
}

function region(gapIndex: number, formationId = 'f'): SectionRegion {
  return {
    gapIndex,
    formationId,
    bodyId: null,
    kind: 'quad',
    polygon: [
      { fraction: 0, elevation: 1 },
      { fraction: 1, elevation: 1 },
      { fraction: 1, elevation: 0 },
      { fraction: 0, elevation: 0 },
    ],
  }
}

const FRAME = [col('L'), col('M'), col('B'), col('R')]
const ALONG = [0, 100, 200, 300]

describe('frameAlignedColumns', () => {
  it('FA1 — an un-banded frame column keeps its place with an empty stack', () => {
    const banded = new Map([
      ['L', col('L', 3)],
      ['M', col('M', 3)],
      ['R', col('R', 3)],
    ])
    const out = frameAlignedColumns(FRAME, banded)
    expect(out.map((c) => c.investigationId)).toEqual(['L', 'M', 'B', 'R'])
    expect(out.map((c) => c.units.length)).toEqual([3, 3, 0, 3])
    // The collar comes from the frame, so the empty column still has a place
    // in elevation as well as in x.
    expect(out[2].surfaceElevM).toBe(10)
  })

  it('FA1b — a model column supersedes the frame column verbatim', () => {
    const mine = col('M', 5)
    const out = frameAlignedColumns(FRAME, new Map([['M', mine]]))
    expect(out[1]).toBe(mine)
  })
})

describe('frameGapRuns', () => {
  it('FA2 — runs stop at an un-banded column, never span it', () => {
    const columns = frameAlignedColumns(
      FRAME,
      new Map([
        ['L', col('L')],
        ['M', col('M')],
        ['R', col('R')],
      ]),
    )
    const runs = frameGapRuns(columns, ALONG)
    // L..M is the only run: R stands alone on the far side of the borehole.
    expect(runs.map((r) => r.offset)).toEqual([0])
    expect(runs[0].columns.map((c) => c.investigationId)).toEqual(['L', 'M'])
    expect(runs[0].alongM).toEqual([0, 100])
    for (const run of runs) {
      expect(run.columns.every((c) => c.units.length > 0)).toBe(true)
    }
  })

  it('FA3 — a lone banded column between un-banded ones yields no run', () => {
    const columns = frameAlignedColumns(FRAME, new Map([['M', col('M')]]))
    expect(frameGapRuns(columns, ALONG)).toEqual([])
  })

  it('FA3b — a run after the un-banded column carries its frame offset', () => {
    const frame = [col('A'), col('B'), col('C'), col('D'), col('E')]
    const columns = frameAlignedColumns(
      frame,
      new Map([
        ['A', col('A')],
        ['C', col('C')],
        ['D', col('D')],
        ['E', col('E')],
      ]),
    )
    const runs = frameGapRuns(columns, [0, 10, 20, 30, 40])
    expect(runs.map((r) => r.offset)).toEqual([2])
    expect(runs[0].columns.map((c) => c.investigationId)).toEqual(['C', 'D', 'E'])
    expect(runs[0].alongM).toEqual([20, 30, 40])
  })

  it('FA5 — every column banded is ONE run at offset 0', () => {
    const runs = frameGapRuns(FRAME, ALONG)
    expect(runs).toHaveLength(1)
    expect(runs[0].offset).toBe(0)
    expect(runs[0].columns).toHaveLength(4)
  })
})

describe('shiftRegionGaps / shiftGapIndexed', () => {
  it('FA4 — a run at offset 2 reports its gaps on the frame axis', () => {
    const shifted = shiftRegionGaps([region(0), region(1)], 2)
    expect(shifted.map((r) => r.gapIndex)).toEqual([2, 3])
    // Nothing but the index moves.
    expect(shifted[0].polygon).toEqual(region(0).polygon)
  })

  it('FA5b — offset 0 is the identity, objects included', () => {
    const input = [region(0), region(1)]
    expect(shiftRegionGaps(input, 0)).toBe(input)
    const flags = [{ gapIndex: 0, layerId: 'x', side: 'left' as const }]
    expect(shiftGapIndexed(flags, 0)).toBe(flags)
  })

  it('FA4b — conflicts and review flags shift the same way', () => {
    const flags = [{ gapIndex: 1, layerId: 'x', side: 'left' as const }]
    expect(shiftGapIndexed(flags, 3)).toEqual([{ gapIndex: 4, layerId: 'x', side: 'left' }])
  })
})
