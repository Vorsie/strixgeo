// Regression anchors for DataInspector (debt #115 sub-items 2 + 7).
//
// RI1 — the bulk-Remove button does NOT use bg-status-danger (red is for
//        irreversible actions; Remove is project-local hide = reversible).
// RI2 — the tab bar uses role="tablist" / role="tab" with aria-selected.
// RI3 — clicking the Borehole tab switches aria-selected.
//
// Uses the ShellContext.Provider pattern (same as DataStage.test.tsx) rather
// than vi.mock() — the vi.mock hoist on this heavy component graph exhausts
// the jsdom worker heap before any test runs.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellContext } from '../../ShellContext'
import type { ShellContextValue } from '../../ShellContext'
import DataInspector from './DataInspector'

// ---------------------------------------------------------------------------
// Minimal ShellContext stub — only the fields DataInspector destructures.
// ---------------------------------------------------------------------------

const handleRemoveCpts = vi.fn()
const handleRemoveBoreholes = vi.fn()

function makeCtx(overrides?: Partial<ShellContextValue>): ShellContextValue {
  const base: ShellContextValue = {
    project: null as unknown as ShellContextValue['project'],
    lifecycle: null as unknown as ShellContextValue['lifecycle'],
    geoModel: null as unknown as ShellContextValue['geoModel'],
    sections: null as unknown as ShellContextValue['sections'],
    overlays: null as unknown as ShellContextValue['overlays'],
    toasts: null as unknown as ShellContextValue['toasts'],
    undo: null as unknown as ShellContextValue['undo'],
    boot: { ready: true, apiError: false },
    visibleCpts: [
      {
        id: 'cpt-1',
        name: 'GH-01',
        cpt_type: 'CPTU',
        max_depth_m: 20.0,
        elevation_m: 5.0,
        start_date: null,
        location_x: 0,
        location_y: 0,
        epsg: 31370,
        z_epsg: 5710,
        elevation_source: 'dov',
        n_rows: 200,
      },
    ],
    visibleBoreholes: [],
    investigations: {
      cpts: [],
      boreholes: [],
      detailMap: new Map(),
      plotMap: new Map(),
      boreholeDetailMap: new Map(),
      importing: false,
      dovImporting: false,
      dovImportState: { status: 'idle' } as const,
      resetDovImport: vi.fn(),
      bboxImportType: null,
      removedCptIds: new Set(),
      removedBoreholeIds: new Set(),
      refreshList: async () => {},
      refreshBoreholeList: async () => {},
      loadCptDetail: async () => {},
      loadChart: async () => {},
      loadBoreholeDetail: async () => {},
      cancelBboxDraw: vi.fn(),
      unhideCpts: vi.fn(),
      unhideBoreholes: vi.fn(),
      handleRemoveCpts,
      handleRemoveBoreholes,
      handleRestoreAllCpts: vi.fn(),
      handleRestoreAllBoreholes: vi.fn(),
      handlePatchCptElevation: async () => {},
      handlePatchBoreholeElevation: async () => {},
      handleImportCpt: async () => {},
      handleImportDov: vi.fn(),
      handleImportBoreholeDov: vi.fn(),
      handleBboxDrawn: async () => {},
      pendingCptPins: [],
    },
    coordinator: {
      selectedId: null,
      selectedBoreholeId: null,
      setSelectedId: vi.fn(),
      setSelectedBoreholeId: vi.fn(),
      view: 'map',
      setView: vi.fn(),
      handleSelect: async () => {},
      handleSelectBorehole: async () => {},
      handleExportSectionDxf: async () => {},
      handleExportSectionPlaxis2d: async () => {},
      outOfViewportCptIds: new Set(),
      outOfViewportBoreholeIds: new Set(),
      projectFilePath: null,
      manifestFormationIds: new Set(),
      sessionImportCptIds: new Set(),
      sessionImportBoreholeIds: new Set(),
      sessionImportSectionIds: new Set(),
      sessionImportFormationIds: new Set(),
      marqueeSelectedIds: new Set(),
      setMarqueeSelectedIds: vi.fn(),
      hoveredTestId: null,
      setHoveredTestId: vi.fn(),
      geoDeepLinkTarget: null,
      setGeoDeepLinkTarget: vi.fn(),
      sectionsDeepLinkTarget: null,
      setSectionsDeepLinkTarget: vi.fn(),
      parametersDeepLinkTarget: null,
      setParametersDeepLinkTarget: vi.fn(),
      selectedParameterUnit: null,
      setSelectedParameterUnit: vi.fn(),
      parametersActiveTab: 'per-test',
      setParametersActiveTab: vi.fn(),
      correlationEdgesRefetchNonce: 0,
      bodyRecomputeLithoNonce: 0,
      bodyRecomputeGeotechNonce: 0,
      requestBodyRecompute: vi.fn(),
    handleSelectWithoutView: vi.fn(),
    markMutated: vi.fn(),
    },
    mapState: {
      hiddenCptTypes: new Set(),
      hiddenBoreholeValues: {
        drill_method: new Set<string>(),
        borehole_type: new Set<string>(),
      },
      boreholeAxis: 'drill_method',
      viewportBounds: null,
      mapCameraRef: { current: null },
      handleToggleCptType: vi.fn(),
      handleToggleBoreholeValue: vi.fn(),
      setBoreholeAxis: vi.fn(),
      handleViewportChange: vi.fn(),
      handleMapCameraChange: vi.fn(),
    },
    ...overrides,
  }
  return base
}

afterEach(() => {
  cleanup()
  handleRemoveCpts.mockReset()
  handleRemoveBoreholes.mockReset()
})

describe('DataInspector (debt #115)', () => {
  it('RI1 — bulk-Remove button does NOT use bg-status-danger (reversible action)', () => {
    render(
      <ShellContext.Provider value={makeCtx()}>
        <DataInspector />
      </ShellContext.Provider>,
    )

    // Select a CPT row via checkbox to trigger the bulk bar.
    const checkbox = screen.getByRole('checkbox')
    fireEvent.click(checkbox)

    // Bulk-action bar should now be visible — find the bulk bar's text-only
    // Remove button (not the per-row icon button whose title is also "Remove").
    const removeBtns = screen.getAllByRole('button', { name: /Remove/i })
    // The bulk bar Remove is the one with visible text content "Remove".
    const bulkRemoveBtn = removeBtns.find(
      b => b.textContent?.trim() === 'Remove',
    )!
    expect(bulkRemoveBtn).toBeDefined()
    expect(bulkRemoveBtn.className).not.toContain('bg-status-danger')
  })

  it('RI2 — tab bar renders CPT + Borehole as role="tab" with aria-selected', () => {
    render(
      <ShellContext.Provider value={makeCtx()}>
        <DataInspector />
      </ShellContext.Provider>,
    )
    const tabs = screen.getAllByRole('tab')
    expect(tabs.length).toBe(2)
    // CPT tab is active by default.
    const cptTab = tabs.find(t => t.textContent?.includes('CPT'))
    const bhTab = tabs.find(t => t.textContent?.includes('Borehole'))
    expect(cptTab).toBeDefined()
    expect(bhTab).toBeDefined()
    expect(cptTab!.getAttribute('aria-selected')).toBe('true')
    expect(bhTab!.getAttribute('aria-selected')).toBe('false')
  })

  it('RI3 — clicking Borehole tab switches aria-selected', () => {
    render(
      <ShellContext.Provider value={makeCtx()}>
        <DataInspector />
      </ShellContext.Provider>,
    )
    const tabs = screen.getAllByRole('tab')
    const bhTab = tabs.find(t => t.textContent?.includes('Borehole'))!
    fireEvent.click(bhTab)
    expect(bhTab.getAttribute('aria-selected')).toBe('true')
    const cptTab = tabs.find(t => t.textContent?.includes('CPT'))!
    expect(cptTab.getAttribute('aria-selected')).toBe('false')
  })
})

// M7b — the CPT/borehole lists are windowed (react-window). A project can hold
// thousands of tests; only the rows in (and just around) the viewport may mount.
function manyCpts(n: number): ShellContextValue['visibleCpts'] {
  return Array.from({ length: n }, (_, i) => ({
    id: `cpt-${i}`,
    name: `GH-${i}`,
    cpt_type: 'CPTU',
    max_depth_m: 20.0,
    elevation_m: 5.0,
    start_date: null,
    location_x: 0,
    location_y: 0,
    epsg: 31370,
    z_epsg: 5710,
    elevation_source: 'dov',
    n_rows: 200,
  })) as ShellContextValue['visibleCpts']
}

describe('DataInspector windowing (M7b)', () => {
  it('W1 — a 5000-CPT list mounts only a small window of DOM rows', () => {
    render(
      <ShellContext.Provider value={makeCtx({ visibleCpts: manyCpts(5000) })}>
        <DataInspector />
      </ShellContext.Provider>,
    )
    // Every row carries exactly one remove button (data-row-remove). Without
    // virtualisation this would be 5000; windowed, it is a few dozen.
    const rows = screen.getAllByTestId('data-row-remove')
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.length).toBeLessThan(60)
  })

  it('W2 — selecting a windowed row still fires handleSelect with its id', () => {
    const ctx = makeCtx({ visibleCpts: manyCpts(5000) })
    const selectSpy = vi.fn()
    ctx.coordinator.handleSelect = selectSpy
    render(
      <ShellContext.Provider value={ctx}>
        <DataInspector />
      </ShellContext.Provider>,
    )
    // The first row is in the initial window; clicking its name button selects.
    fireEvent.click(screen.getByText('GH-0'))
    expect(selectSpy).toHaveBeenCalledWith('cpt-0')
  })

  it('W3 — hovering a windowed row still drives the map-ring signal', () => {
    const ctx = makeCtx({ visibleCpts: manyCpts(5000) })
    const hoverSpy = vi.fn()
    ctx.coordinator.setHoveredTestId = hoverSpy
    render(
      <ShellContext.Provider value={ctx}>
        <DataInspector />
      </ShellContext.Provider>,
    )
    const rowRoot = screen.getByText('GH-0').closest('div.group')
    expect(rowRoot).not.toBeNull()
    fireEvent.mouseEnter(rowRoot!)
    expect(hoverSpy).toHaveBeenCalledWith('cpt-0')
  })
})

// Owner dogfeed 2026-09-30: "add mechanical test icon to test in the borehole
// overview" — a borehole row that carries at least one raw lab test (oedometer /
// triaxial series) shows a small marker with the count as its tooltip; a
// borehole without one shows none.
function boreholeRow(id: string, name: string, labSeriesCount?: number | null) {
  return {
    id,
    name,
    test_id: name,
    location_x: 0,
    location_y: 0,
    epsg: 31370,
    elevation_m: 5,
    z_epsg: 5710,
    elevation_source: 'dov',
    drill_method: null,
    borehole_type: null,
    total_depth_m: 20,
    start_date: null,
    n_drill_segments: 0,
    n_field_log_intervals: 0,
    lab_series_count: labSeriesCount,
  }
}

describe('DataInspector — lab test marker on borehole rows', () => {
  function openBoreholeTab(boreholes: ReturnType<typeof boreholeRow>[]): void {
    render(
      <ShellContext.Provider
        value={makeCtx({ visibleBoreholes: boreholes as ShellContextValue['visibleBoreholes'] })}
      >
        <DataInspector />
      </ShellContext.Provider>,
    )
    const bhTab = screen.getAllByRole('tab').find(t => t.textContent?.includes('Borehole'))!
    fireEvent.click(bhTab)
  }

  it('LM1 — a borehole with lab tests shows the marker, titled "N lab tests"', () => {
    openBoreholeTab([boreholeRow('bh-1', 'GEO-25/022-B17', 3)])
    const marker = screen.getByTestId('borehole-lab-marker')
    expect(marker).toHaveAttribute('title', '3 lab tests')
    expect(marker).toHaveAttribute('aria-label', '3 lab tests')
  })

  it('LM2 — one lab test reads in the singular', () => {
    openBoreholeTab([boreholeRow('bh-1', 'GEO-25/022-B17', 1)])
    expect(screen.getByTestId('borehole-lab-marker')).toHaveAttribute('title', '1 lab test')
  })

  it('LM3 — no lab test (0, or not counted) means no marker', () => {
    openBoreholeTab([boreholeRow('bh-1', 'GEO-25/022-B1', 0), boreholeRow('bh-2', 'GEO-25/022-B2')])
    expect(screen.getByText('GEO-25/022-B1')).toBeInTheDocument()
    expect(screen.queryByTestId('borehole-lab-marker')).toBeNull()
  })
})
