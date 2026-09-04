import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { CptPlotResponse } from '../api/clients/cpt'
import type { BoreholeDetailResponse } from '../api/clients/borehole'
import { ProfileDrawing } from './ProfileDrawing'
import { computeSheetGeometry } from './sheetGeometry'
import type { SheetColumn, SheetPayload } from './sheetPayload'

// The sheet's ink colour — the colour a printed column header must use so it is
// visible on the white sheet (owner finding 2026-09-04: "the header of the
// columns (what is what) is not visible, is it white on white?"). Mirrors the
// ``INK`` module constant in ProfileDrawing.tsx.
const INK = '#1f2933'

const cptPlot: CptPlotResponse = {
  cpt_id: 'c1',
  depths_m: [0, 1, 2, 3],
  qc_mpa: [4, 8, 12, 16],
  fs_mpa: null,
  u2_mpa: null,
  rf_pct: [1, 2, 3, 4],
  qt_mpa: null,
  q_total_mpa: null,
  ic: null,
  rf_source: null,
}

const boreholeDetail = {
  id: 'b1',
  name: 'GEO-16/095-B4',
  test_id: 'B4',
  project_id: 'GEO-16/095',
  location_x: 0,
  location_y: 0,
  epsg: 31370,
  elevation_m: 4,
  z_epsg: null,
  elevation_source: 'dov',
  start_date: null,
  drill_method: null,
  borehole_type: null,
  purpose: null,
  municipality: null,
  executor: null,
  total_depth_m: 18,
  water_table_depth_m: null,
  n_drill_segments: null,
  n_field_log_intervals: null,
  drill_segments: [],
  field_log_intervals: [],
  observations: [],
  samples: [],
} as unknown as BoreholeDetailResponse

const cptColumn: SheetColumn = {
  investigationId: 'c1', kind: 'cpt', name: 'GEO-16/095-S6', code: 'S6',
  projectKey: 'GEO-16/095', colourIndex: 0, alongM: 0, collarElevationM: 5,
  totalDepthM: 20, cptType: 'CPTU', plot: cptPlot, detail: null,
}
const boreholeColumn: SheetColumn = {
  investigationId: 'b1', kind: 'borehole', name: 'GEO-16/095-B4', code: 'B4',
  projectKey: 'GEO-16/095', colourIndex: 1, alongM: 200, collarElevationM: 4,
  totalDepthM: 18, cptType: null, plot: null, detail: boreholeDetail,
}

function payloadWith(columns: SheetColumn[]): SheetPayload {
  return {
    language: 'nl',
    section: { id: 's1', name: 'CS1', epsg: 31370, lengthM: 400, startX: 0, startY: 0, endX: 400, endY: 0, viewState: null },
    columns,
    regions: [],
    units: [],
    levelMaxM: 5.5, levelMinM: -15.5,
    map: { basemapId: 'osm', points: [], legend: [] },
    settings: {
      fill: 'litho', scaleMode: 'fit', hScale: null, vScale: null, vex: 5, spacing: 1,
      fields: [{ label: 'Project', value: 'X' }, { label: 'Profiel', value: 'CS1' }, { label: '', value: '' }, { label: 'Datum', value: '' }],
    },
  }
}

function renderDrawing(payload: SheetPayload, spacing = 1): void {
  const geometry = computeSheetGeometry({
    levelMaxM: payload.levelMaxM, levelMinM: payload.levelMinM,
    columns: payload.columns.map(c => ({ id: c.investigationId, alongM: c.alongM })),
    scaleMode: 'fit', hScale: null, vScale: null, vex: 5, spacing,
  })
  render(<ProfileDrawing payload={payload} geometry={geometry} mTawLabel="m TAW" />)
}

describe('ProfileDrawing — per-column scale header', () => {
  it('a CPT column renders the qc scale label (with its MPa unit) and the Rf ticks, in the ink colour', () => {
    renderDrawing(payloadWith([cptColumn, boreholeColumn]))
    // qc full-scale label — DOV default 40 MPa for this soft series.
    const qcLabel = screen.getByText('40 MPa')
    expect(qcLabel).toHaveAttribute('fill', INK)
    // qc interior reference tick + the mirrored Rf ticks — all in ink.
    expect(screen.getByText('10')).toHaveAttribute('fill', INK)
    expect(screen.getByText('2%')).toHaveAttribute('fill', INK)
    expect(screen.getByText('4%')).toHaveAttribute('fill', INK)
  })

  it('a borehole column renders no qc / Rf scale header (the strip legend explains it)', () => {
    renderDrawing(payloadWith([boreholeColumn]))
    expect(screen.queryByText('40 MPa')).toBeNull()
    expect(screen.queryByText('2%')).toBeNull()
    expect(screen.queryByText('4%')).toBeNull()
  })

  it('packed columns drop the header so the labels never overrun (columns too narrow)', () => {
    // Packed spacing drives the drawn column to its minimum width, where the
    // right-anchored "{scale} MPa" label would overrun the interior ticks — so
    // the header is dropped, mirroring the on-screen crowded-column behaviour.
    renderDrawing(payloadWith([cptColumn, boreholeColumn]), 0)
    expect(screen.queryByText('40 MPa')).toBeNull()
    expect(screen.queryByText('2%')).toBeNull()
  })
})
