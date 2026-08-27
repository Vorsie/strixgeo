// Pins for the identification-test (OKP) pooling — owner ruling R8,
// 2026-08-27, verbatim: "i want a plot with all OKP's in a layer."
//
// ID1 — a sample whose depth-interval MIDPOINT falls inside a unit's band
//       lands in the pool, at the borelog's own mTAW conversion
//       (collar elevation − depth).
// ID2 — a sample on a borehole outside the pooling population (off-section,
//       hidden or removed — all absent from the member set) is excluded.
// ID3 — a parameter with no numeric data in this unit yields NO panel — no
//       empty jars.
// ID4 — a LITHO scope pools across all packing subdivisions: the litho
//       unit's one band covers ground two geotech classes divide, and both
//       samples pool.
// ID5 — grain-size CURVES are skipped (a distribution per sieve is out of
//       scope); scalar numeric lab values, typed families included, all pool.
// ID6 — a sample on a borehole with no collar elevation cannot be placed on
//       an mTAW axis and is skipped, counted rather than silently dropped.

import { describe, expect, it } from 'vitest'

import type { BoreholeDetailResponse } from '../../../api/client'
import {
  poolIdentificationPanels,
  unitBoreholeBands,
} from './unitIdentification'

/** An accepted borehole-anchored band. */
function bhBand(id: string, formationId: string, boreholeId: string, top: number, base: number) {
  return {
    id,
    formation_id: formationId,
    cpt_id: null,
    borehole_id: boreholeId,
    depth_top_m: top,
    depth_base_m: base,
    status: 'accepted',
  }
}

/** A minimal borehole detail tree with one sample carrying the given tests. */
function detail(
  boreholeId: string,
  name: string,
  elevationM: number | null,
  samples: Partial<BoreholeDetailResponse['samples'][number]>[],
): BoreholeDetailResponse {
  return {
    id: boreholeId,
    name,
    elevation_m: elevationM,
    samples: samples.map((s, i) => ({
      id: `s-${boreholeId}-${i}`,
      depth_top_m: 0,
      depth_base_m: 1,
      description: '',
      sample_number: null,
      grain_sizes: [],
      atterberg_limits_tests: [],
      caco3_content_tests: [],
      organic_content_tests: [],
      water_content_tests: [],
      scalar_lab_tests: [],
      ...s,
    })),
  } as unknown as BoreholeDetailResponse
}

const WC = (pct: number) => ({ id: `wc-${pct}`, content_pct: pct, method: null, test_date: null })

// unitBoreholeBands is now the anchor + population filter over a scope's bands;
// the SCOPE selection (unit / body / class, twin folding) is bandsForScope's
// (parameterBodyTree.test.ts PT4, BT1). What stays here is the anchor + member.
describe('unitBoreholeBands — anchor + population filter over the scope bands', () => {
  it('ID2 — a band on a non-member borehole is excluded from the pool', () => {
    // owner ruling 2026-08-27: off-section, hidden and removed holes (absent
    // from the member set) contribute nothing.
    const bands = [bhBand('l1', 'unit-1', 'bh-on', 0, 5), bhBand('l2', 'unit-1', 'bh-off', 0, 5)]
    const out = unitBoreholeBands(bands, new Set(['bh-on']))
    expect(out.map(b => b.boreholeId)).toEqual(['bh-on'])
  })

  it('IDB1 — skips CPT-anchored and not-accepted bands (only committed borehole ground)', () => {
    const bands = [
      bhBand('l1', 'unit-1', 'bh-1', 0, 5),
      { ...bhBand('l2', 'unit-1', 'bh-x', 0, 5), status: 'pending' },
      { id: 'l3', formation_id: 'unit-1', cpt_id: 'c1', borehole_id: null, depth_top_m: 0, depth_base_m: 5, status: 'accepted' },
    ]
    const out = unitBoreholeBands(bands)
    expect(out.map(b => b.boreholeId)).toEqual(['bh-1'])
  })
})

describe('poolIdentificationPanels — the OKP pool', () => {
  it('ID1 — a sample inside a band pools at collar elevation minus midpoint depth', () => {
    const bands = unitBoreholeBands([bhBand('l1', 'unit-1', 'bh-1', 2, 4)])
    const details = new Map([
      [
        'bh-1',
        detail('bh-1', 'B1', 10, [
          // Midpoint 2.5 m — inside the 2–4 m band. Collar +10 → mTAW +7.5.
          { depth_top_m: 2, depth_base_m: 3, water_content_tests: [WC(34.5)] },
          // Midpoint 5 m — outside the band; contributes nothing.
          { depth_top_m: 4.5, depth_base_m: 5.5, water_content_tests: [WC(99)] },
        ]),
      ],
    ])
    const { panels } = poolIdentificationPanels(bands, details)

    const wc = panels.find(p => p.label === 'Water content')
    expect(wc).toBeDefined()
    expect(wc!.points).toHaveLength(1)
    expect(wc!.points[0].value).toBeCloseTo(34.5, 6)
    expect(wc!.points[0].elevationM).toBeCloseTo(7.5, 6)
    expect(wc!.points[0].boreholeName).toBe('B1')
  })

  it('ID3 — a parameter with no data yields no panel', () => {
    const bands = unitBoreholeBands([bhBand('l1', 'unit-1', 'bh-1', 0, 5)])
    const details = new Map([
      ['bh-1', detail('bh-1', 'B1', 10, [{ depth_top_m: 1, depth_base_m: 2, water_content_tests: [WC(20)] }])],
    ])
    const { panels } = poolIdentificationPanels(bands, details)

    expect(panels.map(p => p.label)).toEqual(['Water content'])
  })

  it('ID4 — a litho unit band pools across ground the geotech model subdivides', () => {
    // The litho band covers 0–8 m; two samples sit in what the geotech model
    // calls two different packing classes. Both pool — "regardless of packing
    // density".
    const bands = unitBoreholeBands([bhBand('ll1', 'litho-1', 'bh-1', 0, 8)])
    const details = new Map([
      [
        'bh-1',
        detail('bh-1', 'B1', 0, [
          { depth_top_m: 0.5, depth_base_m: 1.5, water_content_tests: [WC(18)] },
          { depth_top_m: 6, depth_base_m: 7, water_content_tests: [WC(42)] },
        ]),
      ],
    ])
    const { panels } = poolIdentificationPanels(bands, details)
    const wc = panels.find(p => p.label === 'Water content')
    expect(wc!.points.map(p => p.value).sort((a, b) => a - b)).toEqual([18, 42])
  })

  it('ID5 — grain-size curves are skipped; scalar numeric values pool with English labels', () => {
    const bands = unitBoreholeBands([bhBand('l1', 'unit-1', 'bh-1', 0, 5)])
    const details = new Map([
      [
        'bh-1',
        detail('bh-1', 'B1', 10, [
          {
            depth_top_m: 1,
            depth_base_m: 2,
            grain_sizes: [
              { id: 'gs1', diameters_mm: [2, 0.063], pct_larger: [10, 80], method: null, test_date: null, lime_removed: null, organics_removed: null },
            ],
            scalar_lab_tests: [
              {
                id: 'sc1',
                parameter_group: 'Volumemassa-watergehalte',
                parameter: 'Korrelvolumemassa (korrelvolumemassa)',
                value_numeric: 2.65,
                value_text: null,
                unit: 't/m³',
                method: null,
                test_date: null,
                detection_condition: null,
              },
              {
                // Non-numeric (ASTM code) — nothing to plot.
                id: 'sc2',
                parameter_group: 'Onderkenning-grondsoort',
                parameter: 'Grondsoort volgens ASTM, de code',
                value_numeric: null,
                value_text: 'CL',
                unit: null,
                method: null,
                test_date: null,
                detection_condition: null,
              },
            ],
          },
        ]),
      ],
    ])
    const { panels } = poolIdentificationPanels(bands, details)

    const labels = panels.map(p => p.label)
    expect(labels).toContain('Grain density')
    // No grain-size panel, no ASTM-code panel.
    expect(labels.join(' ')).not.toMatch(/grain-size|ASTM/i)
    const gd = panels.find(p => p.label === 'Grain density')
    // The raw Dutch token survives for the tooltip (presentation-boundary rule).
    expect(gd!.rawParameter).toContain('Korrelvolumemassa')
    expect(gd!.unit).toBe('t/m³')
  })

  it('ID6 — a sample on a collar-less borehole is skipped and counted', () => {
    const bands = unitBoreholeBands([
      bhBand('l1', 'unit-1', 'bh-1', 0, 5),
      bhBand('l2', 'unit-1', 'bh-2', 0, 5),
    ])
    const details = new Map([
      ['bh-1', detail('bh-1', 'B1', 10, [{ depth_top_m: 1, depth_base_m: 2, water_content_tests: [WC(20)] }])],
      ['bh-2', detail('bh-2', 'B2', null, [{ depth_top_m: 1, depth_base_m: 2, water_content_tests: [WC(30)] }])],
    ])
    const { panels, skippedNoElevation } = poolIdentificationPanels(bands, details)

    const wc = panels.find(p => p.label === 'Water content')
    expect(wc!.points).toHaveLength(1)
    expect(skippedNoElevation).toBe(1)
  })
})
