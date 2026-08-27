// Pure pooling of grain-size (PSD — korrelverdeling) curves from the borehole
// samples inside a unit's bands (owner ruling S5, 2026-08-27, verbatim: "i'm
// missing all PSD's on one graph").
//
// The scatter panels (``unitIdentification.ts``) pool SCALAR values; this
// module pools the CURVES the same samples carry — one cumulative
// distribution per grain-size test, assembled by ``psdCurvePoints`` (the same
// maths the section's sample hover card draws with, so the two surfaces
// cannot disagree about a curve). Samples pool by the SAME midpoint-in-band
// rule.
//
// A test with fewer than 2 usable points cannot draw a curve — it is skipped
// and COUNTED, never silently thinned.

import type { BoreholeDetailResponse } from '../../../api/client'
import { psdCurvePoints, type PsdPoint } from '../../../utils/psdCurve'
import { midpointInBand, type UnitBoreholeBandInterval } from './unitIdentification'

/** One pooled grain-size curve, with what the hover needs to name it. */
export interface UnitPsdCurve {
  /** The grain-size test id — unique across the pool. */
  key: string
  /** Cumulative points, ascending diameter, % finer (``psdCurvePoints``). */
  points: PsdPoint[]
  /** The hole the sample came from. */
  boreholeName: string
  /** Sample number when the lab recorded one. */
  sampleNumber: string | null
  /** Sample interval top, metres below the collar. */
  depthTopM: number
  /** Sample interval base, metres below the collar. */
  depthBaseM: number
}

/** The pooled curves plus what could NOT be drawn. */
export interface UnitPsdPool {
  /** Every drawable curve, in arrival order. */
  curves: UnitPsdCurve[]
  /** Grain-size tests skipped because fewer than 2 points were usable. */
  skippedCurves: number
}

/**
 * Pool every grain-size curve inside the unit's borehole bands.
 *
 * Parameters
 * ----------
 * bands
 *     The unit's borehole bands (already member-filtered by the caller —
 *     the same list the scatter panels pool from).
 * detailsByBorehole
 *     Full borehole trees per id; a band whose hole is absent contributes
 *     nothing (the batch may not have landed yet).
 *
 * Returns
 * -------
 * UnitPsdPool
 *     Drawable curves plus the count of tests too thin to draw.
 */
export function poolUnitPsdCurves(
  bands: readonly UnitBoreholeBandInterval[],
  detailsByBorehole: ReadonlyMap<string, BoreholeDetailResponse>,
): UnitPsdPool {
  const bandsByBorehole = new Map<string, UnitBoreholeBandInterval[]>()
  for (const band of bands) {
    const existing = bandsByBorehole.get(band.boreholeId)
    if (existing === undefined) bandsByBorehole.set(band.boreholeId, [band])
    else existing.push(band)
  }

  const curves: UnitPsdCurve[] = []
  let skippedCurves = 0

  for (const [boreholeId, holeBands] of bandsByBorehole) {
    const bh = detailsByBorehole.get(boreholeId)
    if (bh === undefined) continue
    for (const sample of bh.samples) {
      const midM = (sample.depth_top_m + sample.depth_base_m) / 2
      if (!holeBands.some(band => midpointInBand(midM, band))) continue
      for (const test of sample.grain_sizes) {
        const points = psdCurvePoints(test)
        // One sieve is a dot, not a distribution — skip it, count it.
        if (points.length < 2) {
          skippedCurves += 1
          continue
        }
        curves.push({
          key: test.id,
          points,
          boreholeName: bh.name,
          sampleNumber: sample.sample_number,
          depthTopM: sample.depth_top_m,
          depthBaseM: sample.depth_base_m,
        })
      }
    }
  }

  return { curves, skippedCurves }
}
