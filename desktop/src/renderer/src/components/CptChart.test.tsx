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

import { render, screen, fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CptPlotResponse, CptResponse } from '../api/client'
import CptChart, { drilledIntervalsFromProvenance, injectDepthGaps } from './CptChart'
import type { CptDataPoint } from './CptChart'
import type { VirtueleBoringCatalogState } from '../hooks/useVirtueleBoringCatalog'

// Controllable stand-in for the DOV lagenmodel catalogue hook so the
// "DOV layer models unavailable" error copy can be exercised without a
// network round-trip. Tests that don't render DOV controls are
// unaffected (the value is unused). Name starts with ``mock`` so the
// hoisted vi.mock factory may close over it.
let mockDovCatalogState: VirtueleBoringCatalogState = {
  catalog: null,
  failed: false,
  status: null,
}
vi.mock('../hooks/useVirtueleBoringCatalog', () => ({
  useVirtueleBoringCatalog: () => mockDovCatalogState,
}))

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

  it('omits the pre-drill legend when pre_drill_m is zero', () => {
    // The CPT response field is `number` (the backend normalises
    // missing values to 0 via `?? 0` at the read site, so the wire
    // type is non-null). The legend hides when the value is falsy.
    render(
      <CptChart plot={makePlot()} detail={makeDetail({ pre_drill_m: 0 })} name="CPT-1" />,
    )
    expect(screen.queryByText(/Pre-drill/)).not.toBeInTheDocument()
  })

  it('does NOT render the Ic legend or SBT strip even when ic series is populated (debt #22)', () => {
    // Debt #22 resolved 2026-06-01: Ic/SBT moved to the Parameters stage
    // (today shell/stages/parameters/CptSbtDepthPanels.tsx — the original
    // CptIcSbtChart was deleted 2026-08-03). CptChart is now raw-only: the Ic
    // legend entry and the SBT zone key are absent regardless of whether
    // plot.ic is populated.
    render(
      <CptChart
        plot={makePlot({ ic: [2.0, 2.0, 2.5, 2.5, 3.0, 3.0] })}
        detail={makeDetail()}
        name="CPT-Ic"
      />,
    )
    expect(screen.queryByText('Ic (interpretation, Robertson 2015)')).not.toBeInTheDocument()
    // SBT zone labels — none should appear in the raw CptChart
    expect(screen.queryByText('Sand mix')).not.toBeInTheDocument()
    expect(screen.queryByText('Silt mix')).not.toBeInTheDocument()
    // The chart header still renders (chart is otherwise intact)
    expect(screen.getByText('CPT-Ic')).toBeInTheDocument()
    // qc legend still present — raw curves are unaffected
    expect(screen.getAllByText('qc (MPa)').length).toBeGreaterThan(0)
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

  it('accepts contactOverlays prop and renders without crashing', () => {
    // Recharts SVG <ReferenceLine label> text doesn't reliably surface
    // through testing-library queries in jsdom (no real layout), so
    // the assertion stays structural: the chart still renders its
    // header chrome when overlays are present. The pure overlay
    // builder is exhaustively tested in utils/contactOverlays.test.ts;
    // here we just pin that the prop wiring doesn't blow up the chart.
    render(
      <CptChart
        plot={makePlot()}
        detail={makeDetail()}
        name="CPT-1"
        contactOverlays={[
          {
            depth_m: 2.5,
            color: '#5fb3d6',
            label: 'Antropogeen',
            source: 'geology',
            key: 'geology:c-1',
          },
          {
            depth_m: 6.0,
            color: '#fef9c3',
            label: 'ZAND',
            source: 'litho',
            key: 'litho:c-2',
          },
        ]}
      />,
    )
    // Header chrome still renders — proves the chart body assembled.
    expect(screen.getByText(/Z = 5\.00/)).toBeInTheDocument()
  })

  it('renders unchanged when contactOverlays is omitted', () => {
    render(<CptChart plot={makePlot()} detail={makeDetail()} name="CPT-1" />)
    expect(screen.getByText(/Z = 5\.00/)).toBeInTheDocument()
  })
})

// ── injectDepthGaps — pure unit tests (no rendering needed) ──────────────────

function makePoint(depth: number, qc: number | null = 1.0): CptDataPoint {
  return { depth, qc, fs: null, rf: null, u2_kpa: null, qt: null }
}

describe('injectDepthGaps', () => {
  it('returns the original array when all steps are within threshold', () => {
    // Regular 0.02 m DOV step — no sentinels expected.
    const rows = [0, 0.02, 0.04, 0.06, 0.08].map(d => makePoint(d))
    const result = injectDepthGaps(rows)
    expect(result).toHaveLength(5)
    expect(result.map(r => r.depth)).toEqual([0, 0.02, 0.04, 0.06, 0.08])
  })

  it('inserts a null-sentinel at the midpoint of a large depth jump', () => {
    // 0 m → 5 m: CPT pushed to refusal, borehole drilled through, CPT continued.
    const rows = [makePoint(0.0), makePoint(5.0), makePoint(5.02)]
    const result = injectDepthGaps(rows)
    // Three original rows + one sentinel between 0.0 and 5.0.
    expect(result).toHaveLength(4)
    const sentinel = result[1]
    expect(sentinel.depth).toBeCloseTo(2.5)
    expect(sentinel.qc).toBeNull()
    expect(sentinel.fs).toBeNull()
    expect(sentinel.u2_kpa).toBeNull()
  })

  it('inserts no sentinel when step equals the threshold exactly', () => {
    // Step of exactly 0.20 m is NOT a gap (must be strictly greater).
    const rows = [makePoint(0.0), makePoint(0.20), makePoint(0.40)]
    const result = injectDepthGaps(rows)
    expect(result).toHaveLength(3)
  })

  it('inserts a sentinel when step is one increment above the threshold', () => {
    // S3 boundary: 0.21 m is strictly greater than 0.20 m → sentinel inserted.
    // Pins the strictly-greater-than semantics at the first value above the boundary
    // (the adjacent test asserts 0.20 m does NOT insert — this test is the upper side).
    const rows = [makePoint(0.0), makePoint(0.21)]
    const result = injectDepthGaps(rows)
    expect(result).toHaveLength(3) // two original rows + one sentinel
    const sentinel = result[1]
    expect(sentinel.qc).toBeNull()
    expect(sentinel.depth).toBeCloseTo(0.105) // midpoint of 0.0..0.21
  })

  it('inserts sentinels at every gap in a multi-gap series', () => {
    // Three gaps: 0.02→3.0 (2.98 m), 3.02→6.0 (2.98 m), 6.0→10.0 (4.0 m).
    // All three exceed the 0.20 m default threshold.
    const rows = [
      makePoint(0.0),
      makePoint(0.02),
      makePoint(3.0),   // gap after 0.02
      makePoint(3.02),
      makePoint(6.0),   // gap after 3.02
      makePoint(10.0),  // gap after 6.0
    ]
    const result = injectDepthGaps(rows)
    const sentinels = result.filter(r => r.qc === null)
    expect(sentinels).toHaveLength(3)
    expect(sentinels[0].depth).toBeCloseTo(1.51)  // midpoint of 0.02..3.0
    expect(sentinels[1].depth).toBeCloseTo(4.51)  // midpoint of 3.02..6.0
    expect(sentinels[2].depth).toBeCloseTo(8.0)   // midpoint of 6.0..10.0
  })

  it('handles a single-row input without throwing', () => {
    const rows = [makePoint(0.0)]
    expect(injectDepthGaps(rows)).toHaveLength(1)
  })

  it('handles an empty input without throwing', () => {
    expect(injectDepthGaps([])).toHaveLength(0)
  })

  it('respects a custom gapThresholdM override', () => {
    // With threshold=1.0 m, a 0.5 m jump is NOT a gap; a 1.5 m jump IS.
    const rows = [makePoint(0.0), makePoint(0.5), makePoint(2.0)]
    const result = injectDepthGaps(rows, 1.0)
    expect(result).toHaveLength(4) // one sentinel inserted between 0.5 and 2.0
    const sentinel = result[2]
    expect(sentinel.qc).toBeNull()
    expect(sentinel.depth).toBeCloseTo(1.25)
  })
})

describe('CptChart — Rf axis inversion (owner ruling 2026-09-05)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('offers no Rf-invert toggle when the chart has no Rf channel', () => {
    // Default plot has rf_pct === null → no Rf panel, so no toggle.
    render(<CptChart plot={makePlot()} detail={makeDetail()} name="CPT-1" />)
    expect(screen.queryByLabelText('Invert Rf axis')).not.toBeInTheDocument()
  })

  it('toggles the Rf axis orientation and persists the choice per user', () => {
    render(
      <CptChart
        plot={makePlot({ rf_pct: [1, 2, 3, 4, 5, 6] })}
        detail={makeDetail()}
        name="CPT-1"
      />,
    )
    const btn = screen.getByLabelText('Invert Rf axis')
    // Default matches today's orientation: not inverted.
    expect(btn).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(btn)
    expect(btn).toHaveAttribute('aria-pressed', 'true')
    expect(localStorage.getItem('groundmodel.cptchart.rf_inverted')).toBe('true')
  })

  it('restores the inverted state from localStorage on mount', () => {
    localStorage.setItem('groundmodel.cptchart.rf_inverted', 'true')
    render(
      <CptChart
        plot={makePlot({ rf_pct: [1, 2, 3, 4, 5, 6] })}
        detail={makeDetail()}
        name="CPT-1"
      />,
    )
    expect(screen.getByLabelText('Invert Rf axis')).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('CptChart — DOV catalogue unavailable copy (owner dogfeed 2026-09-05)', () => {
  beforeEach(() => {
    mockDovCatalogState = { catalog: null, failed: false, status: null }
  })

  function renderWithDovControls() {
    render(
      <CptChart
        plot={makePlot()}
        detail={makeDetail()}
        name="CPT-1"
        onToggleVirtueleBoringVisible={() => {}}
        virtueleBoringActiveModels={[]}
        onChangeVirtueleBoringOverrideModel={() => {}}
      />,
    )
  }

  it('says what happened, with the HTTP status, when the catalogue fetch failed', () => {
    mockDovCatalogState = { catalog: null, failed: true, status: 503 }
    renderWithDovControls()
    expect(screen.getByText(/DOV layer models unavailable \(503\)/)).toBeInTheDocument()
  })

  it('shows the unavailable copy without a status when none is known', () => {
    mockDovCatalogState = { catalog: null, failed: true, status: null }
    renderWithDovControls()
    expect(screen.getByText('DOV layer models unavailable')).toBeInTheDocument()
  })

  it('shows no unavailable copy while the catalogue is merely loading', () => {
    mockDovCatalogState = { catalog: null, failed: false, status: null }
    renderWithDovControls()
    expect(screen.queryByText(/DOV layer models unavailable/)).not.toBeInTheDocument()
  })
})

describe('CptChart — DOV overlay toggle enable rule (owner dogfeed 2026-09-06)', () => {
  beforeEach(() => {
    mockDovCatalogState = { catalog: null, failed: false, status: null }
  })

  it('disables the DOV toggle with a pick-a-model hint when no model is active in this pane', () => {
    render(
      <CptChart
        plot={makePlot()}
        detail={makeDetail()}
        name="CPT-1"
        onToggleVirtueleBoringVisible={() => {}}
        virtueleBoringActiveModels={[]}
        virtueleBoringOverrideModel=""
        onChangeVirtueleBoringOverrideModel={() => {}}
      />,
    )
    const btn = screen.getByRole('button', {
      name: 'Toggle DOV Virtuele Boring overlay',
    }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    // The disabled state is explained — the hint names where to pick a model.
    expect(btn.title).toMatch(/Pick a DOV model/)
  })

  it('enables the DOV toggle when a layer model is active (inherited from the section)', () => {
    render(
      <CptChart
        plot={makePlot()}
        detail={makeDetail()}
        name="CPT-1"
        onToggleVirtueleBoringVisible={() => {}}
        virtueleBoringActiveModels={['hcovv2_S']}
        virtueleBoringOverrideModel=""
        onChangeVirtueleBoringOverrideModel={() => {}}
      />,
    )
    const btn = screen.getByRole('button', {
      name: 'Toggle DOV Virtuele Boring overlay',
    }) as HTMLButtonElement
    expect(btn.disabled).toBe(false)
  })

  it('enables the DOV toggle when THIS pane has a model picked in its own dropdown, even with no inherited active models', () => {
    // The owner picked a model in the chart's own override dropdown ("on the
    // right").  The toggle must enable as soon as a model is active in the
    // place the user picks it — not stay greyed waiting on section models.
    render(
      <CptChart
        plot={makePlot()}
        detail={makeDetail()}
        name="CPT-1"
        onToggleVirtueleBoringVisible={() => {}}
        virtueleBoringActiveModels={[]}
        virtueleBoringOverrideModel="hcovv2_S"
        onChangeVirtueleBoringOverrideModel={() => {}}
      />,
    )
    const btn = screen.getByRole('button', {
      name: 'Toggle DOV Virtuele Boring overlay',
    }) as HTMLButtonElement
    expect(btn.disabled).toBe(false)
  })
})

// Owner ruling "a" (2026-10-04): "a drilled interval stays a gap ... the chart
// MUST show a visible break, never a straight line". A PDF-digitised CPT stores
// no row inside a drilled stretch and lists the stretches in its import
// provenance (``drilled_intervals_m``); the chart breaks there even when the
// stretch is narrower than the generic 0.20 m jump rule.
describe('injectDepthGaps: drilled intervals from the import provenance', () => {
  it('D1: a drilled stretch narrower than 0.20 m still breaks the line', () => {
    const rows = [makePoint(4.16), makePoint(4.178), makePoint(4.341), makePoint(4.36)]
    const result = injectDepthGaps(rows, 0.20, [[4.178, 4.341]])
    expect(result).toHaveLength(5)
    expect(result[2].qc).toBeNull()
    expect(result[2].depth).toBeCloseTo((4.178 + 4.341) / 2)
  })

  it('D2: a drilled stretch wider than 0.20 m breaks once, not twice', () => {
    const rows = [makePoint(30.405), makePoint(31.177)]
    const result = injectDepthGaps(rows, 0.20, [[30.405, 31.177]])
    expect(result.filter(r => r.qc === null)).toHaveLength(1)
  })

  it('D3: consecutive scans outside every drilled stretch stay joined', () => {
    const rows = [makePoint(1.0), makePoint(1.02), makePoint(1.04)]
    expect(injectDepthGaps(rows, 0.20, [[4.178, 4.341]])).toHaveLength(3)
  })
})

describe('drilledIntervalsFromProvenance', () => {
  it('D4: reads drilled_intervals_m of a PDF-digitised CPT', () => {
    expect(
      drilledIntervalsFromProvenance({ source: 'pdf-digitised', drilled_intervals_m: [[32.0, 32.3], [40.1, 40.9]] }),
    ).toEqual([[32.0, 32.3], [40.1, 40.9]])
  })

  it('D5: a GEF / DOV CPT (no provenance) or a malformed value has none', () => {
    expect(drilledIntervalsFromProvenance(null)).toEqual([])
    expect(drilledIntervalsFromProvenance(undefined)).toEqual([])
    expect(drilledIntervalsFromProvenance({ drilled_intervals_m: 'x' })).toEqual([])
    expect(drilledIntervalsFromProvenance({ drilled_intervals_m: [[1, 'a'], [2]] })).toEqual([])
  })
})
