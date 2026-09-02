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
