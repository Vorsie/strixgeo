// Pins for the per-unit PSD pooling — owner ruling S5, 2026-08-27, verbatim:
// "i'm missing all PSD's on one graph."
//
// PS1 — every grain-size curve of the unit's pooled samples is collected;
//       samples pool by the same midpoint-in-band rule as the scatter panels.
// PS2 — a curve with fewer than 2 usable points is skipped AND counted.
// PS3 — the curve is the cumulative distribution in ascending diameter order,
//       % passing = 100 − pct_larger (assembled from the stored per-sieve
//       arrays whatever order the lab wrote them in).
// PS4 — a band whose borehole detail has not arrived contributes nothing.
// PS5 — each curve names its borehole + sample + depth, for the hover.
// PS6 — each curve carries the SAMPLE id (the colour key shared with the
//       scatter dots, owner 2026-08-28) and the BOREHOLE id (so a right-click
//       can navigate to the sample on a cross-section, owner 2026-08-28).

import { describe, expect, it } from 'vitest'

import type { BoreholeDetailResponse } from '../../../api/client'
import { poolUnitPsdCurves } from './unitPsd'

function grainSize(id: string, diameters: number[], pctLarger: number[]) {
  return {
    id,
    diameters_mm: diameters,
    pct_larger: pctLarger,
    method: null,
    test_date: null,
    lime_removed: null,
    organics_removed: null,
  }
}

function sample(
  id: string,
  top: number,
  base: number,
  grainSizes: ReturnType<typeof grainSize>[],
  sampleNumber: string | null = null,
) {
  return {
    id,
    depth_top_m: top,
    depth_base_m: base,
    description: '',
    sample_number: sampleNumber,
    grain_sizes: grainSizes,
    atterberg_limits_tests: [],
    caco3_content_tests: [],
    organic_content_tests: [],
    water_content_tests: [],
    scalar_lab_tests: [],
  }
}

function detail(id: string, name: string, samples: unknown[]): BoreholeDetailResponse {
  return { id, name, elevation_m: 10, samples } as unknown as BoreholeDetailResponse
}

const BAND = { boreholeId: 'bh-1', topDepthM: 0, baseDepthM: 10 }

describe('poolUnitPsdCurves — all PSDs of the unit on one graph', () => {
  it('PS1 — pools curves by the midpoint-in-band rule', () => {
    const details = new Map([
      [
        'bh-1',
        detail('bh-1', 'B1', [
          // Midpoint 1.25 m — inside the 0–10 band.
          sample('s-in', 1, 1.5, [grainSize('g1', [0.002, 0.063, 2], [90, 60, 10])]),
          // Midpoint 12 m — OUTSIDE the band; its curve must not pool.
          sample('s-out', 11.5, 12.5, [grainSize('g2', [0.002, 2], [80, 5])]),
        ]),
      ],
    ])
    const pool = poolUnitPsdCurves([BAND], details)
    expect(pool.curves).toHaveLength(1)
    expect(pool.curves[0].points).toHaveLength(3)
  })

  it('PS2 — a curve with fewer than 2 points is skipped and counted', () => {
    const details = new Map([
      [
        'bh-1',
        detail('bh-1', 'B1', [
          sample('s-1', 1, 2, [
            grainSize('g-ok', [0.063, 2], [60, 10]),
            grainSize('g-thin', [0.063], [60]), // one sieve — no curve
          ]),
        ]),
      ],
    ])
    const pool = poolUnitPsdCurves([BAND], details)
    expect(pool.curves).toHaveLength(1)
    expect(pool.skippedCurves).toBe(1)
  })

  it('PS3 — the curve is cumulative, ascending diameter, % passing', () => {
    const details = new Map([
      [
        'bh-1',
        detail('bh-1', 'B1', [
          // The lab wrote the sieve stack coarse-first — the curve must still
          // come out fine-first with % passing = 100 − % larger.
          sample('s-1', 1, 2, [grainSize('g1', [2, 0.063, 0.002], [10, 60, 90])]),
        ]),
      ],
    ])
    const pool = poolUnitPsdCurves([BAND], details)
    const pts = pool.curves[0].points
    expect(pts.map(p => p.diameterMm)).toEqual([0.002, 0.063, 2])
    expect(pts.map(p => p.pctFiner)).toEqual([10, 40, 90])
  })

  it('PS4 — a band whose borehole detail is absent contributes nothing', () => {
    const pool = poolUnitPsdCurves([BAND], new Map())
    expect(pool.curves).toHaveLength(0)
    expect(pool.skippedCurves).toBe(0)
  })

  it('PS5 — each curve names borehole + sample + depth for the hover', () => {
    const details = new Map([
      [
        'bh-1',
        detail('bh-1', 'B1', [
          sample('s-1', 1.2, 1.7, [grainSize('g1', [0.063, 2], [60, 10])], '5'),
        ]),
      ],
    ])
    const pool = poolUnitPsdCurves([BAND], details)
    const curve = pool.curves[0]
    expect(curve.boreholeName).toBe('B1')
    expect(curve.sampleNumber).toBe('5')
    expect(curve.depthTopM).toBe(1.2)
    expect(curve.depthBaseM).toBe(1.7)
  })

  it('PS6 — each curve carries its sample id (colour key) and borehole id (nav)', () => {
    const details = new Map([
      [
        'bh-1',
        detail('bh-1', 'B1', [
          sample('sample-42', 1, 2, [grainSize('g1', [0.063, 2], [60, 10])], '5'),
        ]),
      ],
    ])
    const pool = poolUnitPsdCurves([BAND], details)
    const curve = pool.curves[0]
    // The colour key is the SAMPLE, not the grain-size test id or the index.
    expect(curve.sampleId).toBe('sample-42')
    // The borehole id lets a right-click resolve the section to navigate to.
    expect(curve.boreholeId).toBe('bh-1')
  })
})
