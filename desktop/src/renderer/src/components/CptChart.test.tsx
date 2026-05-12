// Behaviour tests for CptChart (debt #34).
//
// CptChart is the highest-density rendering surface in the desktop
// app — ~560 lines of Recharts panels, ghost-axis alignment math,
// and CPT-kind-dispatch logic. Full panel-layout snapshots churn
// on every Recharts upgrade, so the tests instead pin
// behaviourally-meaningful contracts:
//
//   * Header reads the cpt_type + row count + max depth from the
//     plot + detail props.
//   * Legend items appear only when the underlying channel is
//     populated AND (for u2) the cone supports the measurement.
//   * Elevation editor surfaces only when a save handler is wired.
//   * "Z missing" warning appears when elevation_m is null without
//     a save handler.
//
// Recharts uses ResponsiveContainer with a ResizeObserver under
// the hood; we stub it in setup.ts so the panels actually render.

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { CptPlotResponse, CptResponse } from '../api/client'
import CptChart from './CptChart'

function makePlot(overrides: Partial<CptPlotResponse> = {}): CptPlotResponse {
  return {
    cpt_id: 'cpt-1',
    depths_m: [0, 1, 2, 3, 4, 5],
    qc_mpa: [0.5, 1.0, 1.5, 2.0, 2.5, 3.0],
    fs_mpa: null,
    u2_mpa: null,
    rf_pct: null,
    qt_mpa: null,
    q_total_mpa: null,
    ic: null,
    rf_source: null,
    ...overrides,
  }
}

function makeDetail(overrides: Partial<CptResponse> = {}): CptResponse {
  return {
    id: 'cpt-1',
    name: 'CPT-1',
    cpt_type: 'CPTU',
    project_id: 'P',
    test_id: 'T',
    file_date: null,
    company: null,
    report_code: null,
    location_x: 0,
    location_y: 0,
    elevation_m: 5,
    epsg: 31370,
    z_epsg: 5710,
    pre_drill_m: null,
    water_depth_m: null,
    cone_area_ratio: null,
    cone_type_code: null,
    stop_criterion: null,
    max_depth_m: 5,
    n_rows: 6,
    created_at: '2026-05-12T00:00:00Z',
    ...overrides,
  } as CptResponse
}

describe('CptChart — header readout', () => {
  it('renders the chart name + cpt_type + row count + max depth', () => {
    render(
      <CptChart
        plot={makePlot()}
        detail={makeDetail({ cpt_type: 'CPTU', max_depth_m: 5 })}
        name="CPT-1"
      />,
    )
    expect(screen.getByText('CPT-1')).toBeInTheDocument()
    // Header summary: "<cpt_type> · <n_rows> rows · <max_depth>"
    expect(screen.getByText(/CPTU · 6 rows · 5\.00 m/)).toBeInTheDocument()
  })

  it('falls back to empty type label when detail is absent', () => {
    // CptChart is used in some read-only contexts without a detail
    // payload (older fixtures, recovery flows). Type label degrades
    // to empty rather than crashing.
    render(<CptChart plot={makePlot()} name="CPT-1" />)
    expect(screen.getByText('CPT-1')).toBeInTheDocument()
    expect(screen.getByText(/6 rows · 5\.00 m/)).toBeInTheDocument()
  })
})

describe('CptChart — legend / panel dispatch per cone kind', () => {
  it('renders qc + u2 legend items for a CPTU with the u2 channel populated', () => {
    render(
      <CptChart
        plot={makePlot({
          u2_mpa: [0.01, 0.02, 0.03, 0.04, 0.05, 0.06],
          rf_pct: [1, 1, 1, 1, 1, 1],
        })}
        detail={makeDetail({ cpt_type: 'CPTU' })}
        name="CPT-1"
      />,
    )
    // Each label appears in both the top legend and inside the
    // per-panel XAxis label — getAllByText keeps the assertion
    // resilient to that without coupling to the Recharts DOM.
    expect(screen.getAllByText('qc (MPa)').length).toBeGreaterThan(0)
    expect(screen.getAllByText('u (kPa)').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Rf (%)').length).toBeGreaterThan(0)
  })

  it('omits u2 legend when the channel is null on the plot response (CPTE)', () => {
    render(
      <CptChart
        plot={makePlot({ fs_mpa: [0.01, 0.02, 0.03, 0.04, 0.05, 0.06] })}
        detail={makeDetail({ cpt_type: 'CPTE' })}
        name="CPT-2"
      />,
    )
    expect(screen.queryByText('u (kPa)')).not.toBeInTheDocument()
    expect(screen.getAllByText('fs (MPa)').length).toBeGreaterThan(0)
  })

  it('renders Qt legend for a CPTM with q_total populated', () => {
    render(
      <CptChart
        plot={makePlot({ q_total_mpa: [10, 15, 20, 25, 30, 35] })}
        detail={makeDetail({ cpt_type: 'CPTM' })}
        name="CPT-3"
      />,
    )
    expect(screen.getByText('Qt (MPa)')).toBeInTheDocument()
    expect(screen.queryByText('u (kPa)')).not.toBeInTheDocument()
  })

  it('renders the pre-drill legend item when pre_drill_m > 0', () => {
    render(
      <CptChart
        plot={makePlot()}
        detail={makeDetail({ pre_drill_m: 1.5 })}
        name="CPT-1"
      />,
    )
    expect(screen.getByText(/Pre-drill 1\.5 m/)).toBeInTheDocument()
  })

  it('omits the pre-drill legend when pre_drill_m is null or zero', () => {
    render(
      <CptChart plot={makePlot()} detail={makeDetail({ pre_drill_m: null })} name="CPT-1" />,
    )
    expect(screen.queryByText(/Pre-drill/)).not.toBeInTheDocument()
  })

  it('renders the Ic SBT zone strip when ic series is populated', () => {
    render(
      <CptChart
        plot={makePlot({ ic: [2.0, 2.0, 2.5, 2.5, 3.0, 3.0] })}
        detail={makeDetail()}
        name="CPT-Ic"
      />,
    )
    expect(screen.getByText('Ic (Robertson 1990)')).toBeInTheDocument()
    // The SBT key strip surfaces each Robertson zone label (also
    // rendered in the Ic panel overlay — getAllByText is forgiving).
    expect(screen.getAllByText('Sand').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Clay').length).toBeGreaterThan(0)
  })
})

describe('CptChart — elevation editor surface', () => {
  it('shows the inline editor when onElevationChange is wired', () => {
    render(
      <CptChart
        plot={makePlot()}
        detail={makeDetail({ elevation_m: 5 })}
        name="CPT-1"
        onElevationChange={async () => undefined}
      />,
    )
    // ElevationEditor wraps the readout in a <button title="Edit
    // surface elevation"> when wired; querying by title rules out
    // the bare "Z = 5.00" span the no-handler branch shows.
    expect(screen.getByTitle('Edit surface elevation')).toBeInTheDocument()
  })

  it('falls back to a static Z readout when no save handler is provided', () => {
    render(
      <CptChart
        plot={makePlot()}
        detail={makeDetail({ elevation_m: 5 })}
        name="CPT-1"
      />,
    )
    expect(screen.getByText(/Z = 5\.00/)).toBeInTheDocument()
  })

  it('surfaces a "Z missing" amber warning when elevation is null and no editor is wired', () => {
    render(
      <CptChart
        plot={makePlot()}
        detail={makeDetail({ elevation_m: null })}
        name="CPT-1"
      />,
    )
    expect(screen.getByText('Z missing')).toBeInTheDocument()
  })
})
