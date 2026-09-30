// Owner dogfeed 2026-09-30: "make sure full trap is visible in plots" ("trap" =
// the oedometer load step / stage). Every stage's readings are ENTIRELY visible
// in the settlement and strain panels: from the t = 0 marker to the last reading,
// on the log-time axis and in the y range. No clipping of the first seconds, no
// clipping of the last reading — a reading drawn ON the plot frame is half cut
// off, so "visible" means strictly inside the frame, with the t = 0 marker on
// the left edge clear of the first reading.

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { LabSeriesStage } from '../../api/client'
import { chartDomain, stageTimeSeries } from '../../utils/labSeriesViewerData'
import LabSeriesChart from './LabSeriesChart'

function channel(key: string, values: (number | null)[]) {
  return {
    channel_key: key,
    source_label: key,
    unit: null,
    provenance: 'measured',
    values,
    formula: null,
    derivation_inputs: null,
  }
}

// A load step as the control listing prints it: the t = 0 reading, the first
// readings at 0.1 min, and the LAST reading (24 h) carrying the largest
// settlement of the stage.
const TIME = [0, 0.1, 0.25, 0.5, 1, 2, 4, 8, 15, 30, 60, 120, 240, 480, 1440]
const SETTLEMENT = [0, 0.05, 0.08, 0.11, 0.15, 0.2, 0.26, 0.31, 0.35, 0.38, 0.4, 0.42, 0.43, 0.44, 0.46]

function loadStep(): LabSeriesStage {
  return {
    stage_index: 3,
    stage_kind: 'load_step',
    direction_token: 'Belasting',
    hanger_load_kg: 6,
    target_stress_kpa: 200,
    height_at_start_mm: 19.5,
    lab_stage_settlement_mm: 0.46,
    lab_coefficient_label: null,
    lab_coefficient: null,
    started_at: null,
    reading_timestamps: null,
    point_numbers: null,
    rezero_indices: [],
    n_readings: TIME.length,
    channels: [channel('elapsed_min', TIME), channel('settlement_mm', SETTLEMENT)],
  }
}

describe('the full stage is visible (owner 2026-09-30)', () => {
  it('the log-time domain holds the first reading (0.1 min) and the last one (1440 min) strictly inside', () => {
    const s = stageTimeSeries(loadStep(), 'settlement_mm')
    const d = chartDomain([{ points: s.points, leftEdgeValue: s.t0 }], { xLog: true })
    expect(d).not.toBeNull()
    expect(d!.x0).toBeLessThan(0.1)
    expect(d!.x0).toBeGreaterThan(0)
    expect(d!.x1).toBeGreaterThan(1440)
  })

  it('the y range holds the t = 0 value and the last (largest) settlement strictly inside', () => {
    const s = stageTimeSeries(loadStep(), 'settlement_mm')
    const d = chartDomain([{ points: s.points, leftEdgeValue: s.t0 }], { xLog: true })!
    expect(d.y0).toBeLessThan(0)
    expect(d.y1).toBeGreaterThan(0.46)
  })

  it('the y range takes a re-zero duplicate too when it is part of the stage values', () => {
    // A re-zero duplicate is skipped from the line; were it drawn, the range
    // would still have to hold it — the range is computed from what is drawn.
    const d = chartDomain(
      [{ points: [{ x: 0.1, y: 0.05 }, { x: 1440, y: 0.46 }, { x: 60, y: 0.9 }] }],
      { xLog: true },
    )!
    expect(d.y1).toBeGreaterThan(0.9)
  })

  it('every drawn vertex of the stage lies strictly inside the plot frame, clear of the t = 0 marker', () => {
    const s = stageTimeSeries(loadStep(), 'settlement_mm')
    const { container } = render(
      <LabSeriesChart
        title="Settlement"
        xLabel="t (min)"
        yLabel="s (mm)"
        series={[{ id: '3', label: 'Stage 3', color: '#123456', points: s.points, leftEdgeValue: s.t0 }]}
        xLog
        invertY
        emptyText="none"
      />,
    )
    const frame = container.querySelector('rect')!
    const left = Number(frame.getAttribute('x'))
    const top = Number(frame.getAttribute('y'))
    const right = left + Number(frame.getAttribute('width'))
    const bottom = top + Number(frame.getAttribute('height'))
    const line = container.querySelector('g[data-series="3"] path:not([data-testid])')!
    const vertices = [...line.getAttribute('d')!.matchAll(/[ML]([-\d.]+),([-\d.]+)/g)].map(m => ({
      x: Number(m[1]),
      y: Number(m[2]),
    }))
    expect(vertices).toHaveLength(TIME.length - 1)
    for (const v of vertices) {
      expect(v.x).toBeGreaterThan(left)
      expect(v.x).toBeLessThan(right)
      expect(v.y).toBeGreaterThan(top)
      expect(v.y).toBeLessThan(bottom)
    }
    // The t = 0 marker is a 6 px triangle on the left edge: the first reading
    // sits to the right of it, not under it.
    expect(vertices[0].x).toBeGreaterThan(left + 6)
  })
})
