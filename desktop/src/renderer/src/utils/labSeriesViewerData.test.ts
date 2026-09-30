// Pure data preparation for the lab-series viewer. The rules, in the owner's /
// reviewer's words (2026-09-29):
//
//  * "the t = 0 reading of a stage cannot sit on a log time axis; draw it as
//    the panel's left-edge marker" — so a stage's time series drops t <= 0
//    points from the line and hands the first one back as ``t0``.
//  * the dial re-zero duplicate "must not be counted twice in any stored
//    series ... a viewer can skip it" — indices in ``rezero_indices`` are
//    skipped, and the count of skipped readings is reported.
//  * "the end-of-stage strain vs log sigma' as its own panel beside the lab's
//    e-log sigma' pass-through" — one point per stage: (listed stress, last
//    strain); and the lab's e against the lab's Druk, straight from the
//    lab-reported rows.

import { describe, expect, it } from 'vitest'

import type { LabSeriesStage, LabSeriesTest } from '../api/client'
import {
  endOfStageStrain,
  labELogStress,
  logTicks,
  specimenCurve,
  stageTimeSeries,
} from './labSeriesViewerData'

function channel(key: string, values: (number | null)[], provenance = 'measured') {
  return {
    channel_key: key,
    source_label: key,
    unit: null,
    provenance,
    values,
    formula: null,
    derivation_inputs: null,
  }
}

function stage(overrides: Partial<LabSeriesStage> = {}): LabSeriesStage {
  return {
    stage_index: 1,
    stage_kind: 'load_step',
    direction_token: 'Belasting',
    hanger_load_kg: 3,
    target_stress_kpa: 100,
    height_at_start_mm: 20,
    lab_stage_settlement_mm: 0.5,
    lab_coefficient_label: null,
    lab_coefficient: null,
    started_at: null,
    reading_timestamps: null,
    point_numbers: null,
    rezero_indices: [],
    n_readings: 4,
    channels: [
      channel('elapsed_min', [0, 0.1, 1, 10]),
      channel('settlement_mm', [0, 0.2, 0.4, 0.5]),
      channel('vertical_strain', [0, 0.01, 0.02, 0.025], 'derived'),
    ],
    ...overrides,
  }
}

describe('stageTimeSeries', () => {
  it('drops the t = 0 reading from the log-time line and returns it as the left-edge marker', () => {
    const out = stageTimeSeries(stage(), 'settlement_mm')
    expect(out.points).toEqual([
      { x: 0.1, y: 0.2 },
      { x: 1, y: 0.4 },
      { x: 10, y: 0.5 },
    ])
    expect(out.t0).toBe(0)
  })

  it('skips a re-zero duplicate so the moment is not drawn twice', () => {
    const s = stage({
      rezero_indices: [2],
      channels: [
        channel('elapsed_min', [0, 1, 1, 5]),
        channel('settlement_mm', [0, 0.3, 0.3, 0.35]),
      ],
    })
    const out = stageTimeSeries(s, 'settlement_mm')
    expect(out.points.map(p => p.x)).toEqual([1, 5])
    expect(out.skipped).toBe(1)
  })

  it('drops unreadable (null) readings instead of inventing them', () => {
    const s = stage({
      channels: [channel('elapsed_min', [0, 1, 2]), channel('settlement_mm', [0, null, 0.3])],
    })
    expect(stageTimeSeries(s, 'settlement_mm').points).toEqual([{ x: 2, y: 0.3 }])
  })

  it('returns nothing for a channel the stage does not carry', () => {
    const out = stageTimeSeries(stage(), 'load_kg')
    expect(out.points).toEqual([])
    expect(out.t0).toBeNull()
  })
})

function oedTest(stages: LabSeriesStage[], labResults: LabSeriesTest['lab_results'] = []) {
  return {
    id: 't',
    sample_id: 's',
    kind: 'oedometer',
    test_type_token: null,
    lab_job_number: null,
    lab_sample_number: null,
    lab_borehole_name: null,
    sampling_depth_top_m: null,
    sampling_depth_base_m: null,
    visual_description: null,
    source_format: 'geosys_oed_control_listing',
    source_file_name: 'x.txt',
    source_native_file: null,
    import_issues: [],
    n_specimens: 1,
    specimens: [
      {
        specimen_label: null,
        initial_height_mm: 20,
        initial_diameter_mm: null,
        initial_wet_mass_g: null,
        dry_mass_g: null,
        initial_water_content_pct: null,
        grain_density_t_m3: null,
        strain_rate_mm_per_min: null,
        consolidation_stress_kpa: null,
        failure_description: null,
        n_points: 4,
        stages,
      },
    ],
    lab_results: labResults,
  } satisfies LabSeriesTest
}

describe('endOfStageStrain', () => {
  it('gives one point per stage: the listed stress and the last strain of the stage', () => {
    const t = oedTest([
      stage({ stage_index: 1, target_stress_kpa: 100 }),
      stage({
        stage_index: 2,
        target_stress_kpa: 200,
        channels: [channel('vertical_strain', [0.025, 0.03, null], 'derived')],
      }),
    ])
    expect(endOfStageStrain(t)).toEqual([
      { x: 100, y: 0.025, stage: 1 },
      { x: 200, y: 0.03, stage: 2 },
    ])
  })

  it('has no point for a stage without a listed stress (no stress axis to put it on)', () => {
    const t = oedTest([stage({ target_stress_kpa: null })])
    expect(endOfStageStrain(t)).toEqual([])
  })
})

describe('labELogStress', () => {
  it("pairs the lab's e with the lab's Druk per stage, skipping the zero-stress initial state", () => {
    const r = (stage_index: number, parameter: string, value: number) => ({
      specimen_label: null,
      stage_index,
      parameter,
      value_numeric: value,
      value_text: null,
      unit: null,
      provenance: 'lab_reported',
    })
    const t = oedTest(
      [],
      [r(0, 'Druk', 0), r(0, 'e', 0.682), r(1, 'Druk', 93.6), r(1, 'e', 0.62), r(2, 'e', 0.61)],
    )
    expect(labELogStress(t)).toEqual([{ x: 93.6, y: 0.62, stage: 1 }])
  })
})

describe('specimenCurve', () => {
  it('pairs two channels of the specimen stage point by point, dropping nulls', () => {
    const sp = oedTest([
      stage({
        channels: [
          channel('axial_strain_pct', [0, 0.5, 1, null]),
          channel('deviator_stress_kpa', [0, 20, 30, 40]),
        ],
      }),
    ]).specimens[0]
    expect(specimenCurve(sp, 'axial_strain_pct', 'deviator_stress_kpa')).toEqual([
      { x: 0, y: 0 },
      { x: 0.5, y: 20 },
      { x: 1, y: 30 },
    ])
  })
})

describe('logTicks', () => {
  it('puts 1-2-5 ticks on every decade the domain covers', () => {
    expect(logTicks(0.05, 30)).toEqual([0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20])
  })
})
