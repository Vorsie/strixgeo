// Pins for the per-unit distribution statistics (owner ballot 2026-08-26 —
// "per-unit statistics plots (raincloud/box of qc, fs, Rf over a selected
// unit)").
//
// Every case below is phrased in the ENGINEER'S vocabulary, not the
// implementation's: what ground the unit covers, which samples that ground
// contains, and what the spread of those samples is. The rule each one states
// came from the ballot, from the half-open interval convention the litho column
// is built on, or from a structural absence the real data has.
//
// US1  — the samples of a unit are the samples inside its bands, pooled.
// US2  — a band is half-open [top, base): a sample on the shared contact
//        belongs to the band BELOW, never to both.
// US3  — a unit with no bands has no statistics (the empty unit).
// US4  — a single sample is a legitimate distribution: n = 1, every quantile is
//        that value, and the spread is UNKNOWN rather than zero.
// US5  — quantiles interpolate between order statistics (type 7 / PERCENTILE.INC).
// US6  — a channel the file never recorded reports n = 0 while the channels it
//        did record still report (fs absent, qc present).
// US7  — a null sample inside a recorded channel is an absence, not a zero.
// US8  — a band whose CPT has no series contributes nothing, and does not throw.
// US9  — bands are pooled ACROSS CPTs; the unit's spread is the whole unit's.
// US10 — an unclassified (skeleton) unit's bands still yield statistics: the
//        class is not an input to the arithmetic.

import { describe, expect, it } from 'vitest'

import {
  computeUnitStatistics,
  unitCptBands,
  type UnitBandInterval,
  type UnitChannelSeries,
} from './unitStatistics'

/** A CPT with one sample every metre from 1 m, qc = the depth in metres. */
function rampSeries(depths: number[], qc: (number | null)[]): UnitChannelSeries {
  return { depthsM: depths, qcMpa: qc, fsMpa: null, rfPct: null }
}

function band(cptId: string, topDepthM: number, baseDepthM: number): UnitBandInterval {
  return { cptId, topDepthM, baseDepthM }
}

/** The qc channel of a result — the one every case below asserts on. */
function qcOf(result: ReturnType<typeof computeUnitStatistics>) {
  const channel = result.channels.find(c => c.channel === 'qc')
  if (channel === undefined) throw new Error('qc channel missing from the result')
  return channel
}

describe('computeUnitStatistics — which samples the unit contains', () => {
  it('US1 — pools exactly the samples lying inside the unit\'s bands', () => {
    const series = new Map<string, UnitChannelSeries>([
      ['cpt-a', rampSeries([1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 6])],
    ])
    // The unit covers 2 m to 4 m of this hole. 4 m is the base, so the samples
    // it owns are the ones at 2 m and 3 m.
    const result = computeUnitStatistics([band('cpt-a', 2, 4)], series)

    expect(qcOf(result).samples).toEqual([2, 3])
    expect(qcOf(result).summary.n).toBe(2)
  })

  it('US2 — a sample on a shared contact belongs to the band below, not to both', () => {
    const series = new Map<string, UnitChannelSeries>([
      ['cpt-a', rampSeries([1, 2, 3, 4], [10, 20, 30, 40])],
    ])
    // Two touching bands of the SAME unit — the gap-free litho column shape.
    // The sample at exactly 3 m sits on their shared contact and must be
    // counted once, by the lower band.
    const result = computeUnitStatistics(
      [band('cpt-a', 1, 3), band('cpt-a', 3, 5)],
      series,
    )

    expect(qcOf(result).samples).toEqual([10, 20, 30, 40])
    expect(qcOf(result).summary.n).toBe(4)
  })

  it('US3 — a unit with no bands has no statistics', () => {
    const result = computeUnitStatistics([], new Map())

    const qc = qcOf(result)
    expect(qc.summary.n).toBe(0)
    expect(qc.summary.median).toBeNull()
    expect(qc.summary.mean).toBeNull()
    expect(qc.summary.min).toBeNull()
    expect(qc.summary.max).toBeNull()
    expect(qc.samples).toEqual([])
    expect(result.cptCount).toBe(0)
  })

  it('US8 — a band whose CPT has no series contributes nothing and does not throw', () => {
    // The plot batch has not landed for this hole (or the hole has no series
    // at all). The unit is still describable; it just has nothing to say yet.
    const result = computeUnitStatistics([band('cpt-missing', 0, 5)], new Map())

    expect(qcOf(result).summary.n).toBe(0)
    expect(result.bandCount).toBe(1)
    expect(result.cptCount).toBe(1)
  })

  it('US9 — the unit pools its bands across every CPT that carries it', () => {
    const series = new Map<string, UnitChannelSeries>([
      ['cpt-a', rampSeries([1, 2], [1, 2])],
      ['cpt-b', rampSeries([1, 2], [100, 200])],
    ])
    const result = computeUnitStatistics(
      [band('cpt-a', 0, 5), band('cpt-b', 0, 5)],
      series,
    )

    expect(qcOf(result).samples).toEqual([1, 2, 100, 200])
    expect(result.cptCount).toBe(2)
  })

  it('US10 — an unclassified unit\'s bands yield statistics like any other', () => {
    // A skeleton (borehole-only, nad_class null) unit is still real ground.
    // The class never enters this arithmetic, so there is nothing to special-case
    // — this pin exists so a future "skip unclassified" shortcut fails here.
    const series = new Map<string, UnitChannelSeries>([
      ['cpt-a', rampSeries([1, 2, 3], [5, 6, 7])],
    ])
    const result = computeUnitStatistics([band('cpt-a', 0, 10)], series)

    expect(qcOf(result).summary.n).toBe(3)
    expect(qcOf(result).summary.median).toBe(6)
  })
})

describe('computeUnitStatistics — the shape of the spread', () => {
  it('US4 — one sample is a distribution of one: no spread is KNOWN, not zero', () => {
    const series = new Map<string, UnitChannelSeries>([
      ['cpt-a', rampSeries([1], [7.5])],
    ])
    const { summary } = qcOf(computeUnitStatistics([band('cpt-a', 0, 5)], series))

    expect(summary.n).toBe(1)
    expect(summary.min).toBe(7.5)
    expect(summary.max).toBe(7.5)
    expect(summary.median).toBe(7.5)
    expect(summary.q1).toBe(7.5)
    expect(summary.q3).toBe(7.5)
    expect(summary.mean).toBe(7.5)
    // A standard deviation needs two samples. Reporting 0 would claim the unit
    // is perfectly uniform, which one measurement cannot say.
    expect(summary.sd).toBeNull()
  })

  it('US5 — quantiles interpolate between order statistics', () => {
    const series = new Map<string, UnitChannelSeries>([
      ['cpt-a', rampSeries([1, 2, 3, 4], [1, 2, 3, 4])],
    ])
    const { summary } = qcOf(computeUnitStatistics([band('cpt-a', 0, 10)], series))

    // [1,2,3,4]: median sits between 2 and 3; Q1 a quarter of the way from 1 to
    // 2; Q3 three quarters of the way from 3 to 4.
    expect(summary.median).toBeCloseTo(2.5, 10)
    expect(summary.q1).toBeCloseTo(1.75, 10)
    expect(summary.q3).toBeCloseTo(3.25, 10)
    expect(summary.min).toBe(1)
    expect(summary.max).toBe(4)
    expect(summary.mean).toBeCloseTo(2.5, 10)
  })

  it('US5b — the standard deviation is the SAMPLE deviation (n-1)', () => {
    const series = new Map<string, UnitChannelSeries>([
      ['cpt-a', rampSeries([1, 2, 3], [2, 4, 6])],
    ])
    const { summary } = qcOf(computeUnitStatistics([band('cpt-a', 0, 10)], series))

    // mean 4; deviations -2, 0, +2; sum of squares 8; /(n-1)=4; sqrt = 2.
    expect(summary.sd).toBeCloseTo(2, 10)
  })
})

describe('computeUnitStatistics — channels the file did not record', () => {
  it('US6 — an absent channel reports n = 0 while the recorded ones report', () => {
    // A CPTM records cone resistance and nothing else: fs and Rf are absent
    // for the whole hole, which is different from being zero there.
    const series = new Map<string, UnitChannelSeries>([
      ['cpt-a', { depthsM: [1, 2], qcMpa: [3, 5], fsMpa: null, rfPct: null }],
    ])
    const result = computeUnitStatistics([band('cpt-a', 0, 10)], series)

    const fs = result.channels.find(c => c.channel === 'fs')
    const rf = result.channels.find(c => c.channel === 'rf')
    expect(qcOf(result).summary.n).toBe(2)
    expect(fs?.summary.n).toBe(0)
    expect(rf?.summary.n).toBe(0)
  })

  it('US7 — a null sample inside a recorded channel is an absence, not a zero', () => {
    const series = new Map<string, UnitChannelSeries>([
      [
        'cpt-a',
        { depthsM: [1, 2, 3], qcMpa: [4, null, 6], fsMpa: [0.1, null, 0.3], rfPct: null },
      ],
    ])
    const result = computeUnitStatistics([band('cpt-a', 0, 10)], series)

    // Counting the null as 0 would drag the minimum to 0 and the mean down.
    expect(qcOf(result).samples).toEqual([4, 6])
    expect(qcOf(result).summary.min).toBe(4)
    const fs = result.channels.find(c => c.channel === 'fs')
    expect(fs?.samples).toEqual([0.1, 0.3])
  })

  it('US7b — a non-finite sample is dropped like a null', () => {
    const series = new Map<string, UnitChannelSeries>([
      ['cpt-a', { depthsM: [1, 2, 3], qcMpa: [4, NaN, Infinity], fsMpa: null, rfPct: null }],
    ])
    const result = computeUnitStatistics([band('cpt-a', 0, 10)], series)

    expect(qcOf(result).samples).toEqual([4])
  })
})

describe('computeUnitStatistics — the three channels are always present', () => {
  it('US11 — the result always names qc, fs and Rf in that order', () => {
    // The panel draws one row per channel and must not reorder or lose a row
    // when a hole happens to lack a channel.
    const result = computeUnitStatistics([], new Map())
    expect(result.channels.map(c => c.channel)).toEqual(['qc', 'fs', 'rf'])
  })
})

// unitCptBands is now the anchor + population filter over a scope's bands; the
// SCOPE selection (unit / body / class, twin folding) is bandsForScope's — its
// authority pins live in parameterBodyTree.test.ts (PT4, BT1). What stays here:
//
// UB1 — only ACCEPTED bands: the band list can carry any status.
// UB2 — only CPT-anchored bands: a borehole has no cone to summarise.
// UB3 — only member CPTs: a band whose CPT is off the pooling population drops.
describe('unitCptBands — anchor + population filter over the scope bands', () => {
  const bands = [
    { cpt_id: 'c1', depth_top_m: 0, depth_base_m: 2, status: 'accepted' },
    { cpt_id: 'c1', depth_top_m: 4, depth_base_m: 6, status: 'pending' },
    { cpt_id: null, depth_top_m: 0, depth_base_m: 3, status: 'accepted' },
    { cpt_id: 'c2', depth_top_m: 1, depth_base_m: 5, status: 'accepted' },
  ]

  it('UB1 — skips bands that are not accepted (a pending proposal is not ground)', () => {
    const out = unitCptBands(bands)
    expect(out.some(b => b.topDepthM === 4 && b.baseDepthM === 6)).toBe(false)
  })

  it('UB2 — skips borehole-anchored bands, which carry no cone', () => {
    const out = unitCptBands(bands)
    expect(out).toEqual([
      { cptId: 'c1', topDepthM: 0, baseDepthM: 2 },
      { cptId: 'c2', topDepthM: 1, baseDepthM: 5 },
    ])
  })

  it('UB3 — excludes a band whose CPT is not in the pooling population', () => {
    // owner ruling 2026-08-27: "Only cpt's on the sections should be in the
    // pooling so all hidden and removed should be excluded".
    const out = unitCptBands(bands, new Set(['c1']))
    expect(out.map(b => b.cptId)).toEqual(['c1'])
  })
})
