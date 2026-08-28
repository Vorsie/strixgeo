// Behavioral net for GeotechnicalCanvas — the 3D-only geotech room
// (owner ruling 2026-08-26: the 2D ⟷ 3D pill is retired, the 2D geotech band
// view lives on the Sections stage axis picker).
//
// Claims pinned here:
//   GC1  When activeLithoModel is null → EmptyState renders with the hint
//        directing the user to the Lithology stage.
//   GC2  Litho model present but no built geotech solids → the guided Build
//        empty state renders (mirrors the litho stage's hasLithoSolids gate);
//        the 3D viewer does not.
//   GC3  Litho model + built solids → the 3D viewer renders IMMEDIATELY, with
//        no dimension toggle to click first, fed NAD-coloured formations.
//   GC4  The stage never opens the 2D section surface and never mutates the
//        shared section axis — the retired pill's two side-effects.
//   GC5  The gapless build report is readable on the EMPTY-STATE branch too.
//        This is the case that matters most: a build that produced nothing
//        lands here, and that is exactly when the engineer needs to read why.
//        It is also the branch-crossing render that proves the report wiring
//        sits above the canvas's early returns (the hook-order rule).
//   GC6  A spot the report names walks to its section.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShellContext } from '../../ShellContext'
import type { ShellContextValue } from '../../ShellContext'
import type { GeologicalModelResponse } from '../../../api/client'
import type { GaplessBuildReport } from '../../../utils/gaplessGate/types'
import { nadClassColor } from '../../../utils/nadClasses'
import GeotechnicalCanvas, {
  geotechVoxelRequestCallback,
  resetGeotechSplitViewportCallback,
} from './GeotechnicalCanvas'

// ---------------------------------------------------------------------------
// Module mocks — the canvas no longer imports SectionsCanvas (the 2D half is
// retired), but the sentinel stays mocked so GC4's "the 2D surface never opens
// here" assertion keeps its teeth if someone re-imports it: a real
// SectionsCanvas would drag Leaflet + fetch into jsdom and fail loudly.
// ---------------------------------------------------------------------------

vi.mock('../sections/SectionsCanvas', () => ({
  default: () => <div data-testid="sections-canvas" />,
}))

// Geology3DViewer imports Cesium + WebGL — mock it as a sentinel div that
// mirrors the props the geotech 3D wiring drives (body count + the first
// formation colour, so the NAD-recolour seam can be asserted without WebGL).
vi.mock('../geology/Geology3DViewer', () => ({
  default: (props: {
    bodySolids?: { length: number }
    formations?: { color: string }[]
  }) => (
    <div
      data-testid="geology-3d-viewer"
      data-body-count={String(props.bodySolids?.length ?? 0)}
      data-first-formation-color={props.formations?.[0]?.color ?? ''}
    />
  ),
}))

// api.geology stubs — resolve empty so the 3D ground-surface / edge effects
// never hang.
vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client')
  return {
    ...actual,
    api: {
      geology: {
        buildGroundSurface: vi.fn().mockResolvedValue({ vertices: [], triangles: [] }),
        listContactCorrelations: vi.fn().mockResolvedValue([]),
      },
    },
  }
})

vi.mock('../../../utils/log', () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const noopAsync = (): Promise<void> => Promise.resolve()

function makeLithoModel(): GeologicalModelResponse {
  return {
    id: 'model-litho-1',
    app_project_id: 'proj-1',
    name: 'Litho model',
    description: null,
    kind: 'lithostratigraphic',
    parent_model_id: 'model-geo-1',
    is_active: true,
    excluded_borehole_ids: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

/**
 * Build a minimal ShellContextValue that satisfies the interface.
 *
 * Only the two fields GeotechnicalCanvas reads are meaningful here:
 * ``geoModel.activeLithoModel`` and
 * ``sections.{sectionModelAxis, setSectionModelAxis}``.
 */
function makeCtx(overrides: {
  activeLithoModel?: GeologicalModelResponse | null
  sectionModelAxis?: 'geological' | 'lithostratigraphic' | 'geotechnical'
  setSectionModelAxis?: (axis: 'geological' | 'lithostratigraphic' | 'geotechnical') => void
  hasGeotechSolids?: boolean
  geotechSolids?: unknown[]
  geotechFormations?: unknown[]
  geotechGaplessReport?: GaplessBuildReport | null
  setSectionsDeepLinkTarget?: (target: unknown) => void
} = {}): ShellContextValue {
  const setSectionModelAxis = overrides.setSectionModelAxis ?? vi.fn()

  return {
    project: {
      id: 'proj-1',
      name: 'Test',
      project_number: null,
      client: null,
      site_label: null,
      description: null,
      tags: [],
      default_horizontal_epsg: 31370,
      default_vertical_epsg: 5710,
      phase: 'design',
      status: 'active',
      view_state: {},
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      archived_at: null,
    },
    lifecycle: {
      projectDirty: false,
      newProjectOpen: false,
      setNewProjectOpen: vi.fn(),
      metadataEditorOpen: false,
      setMetadataEditorOpen: vi.fn(),
      closeConfirmOpen: false,
      setCloseConfirmOpen: vi.fn(),
      unsavedDialogOpen: false,
      unsavedSaving: false,
      saveProject: () => Promise.resolve(true),
      discardSessionImports: vi.fn(),
      handleCloseProjectRequest: vi.fn(),
      handleUnsavedSave: noopAsync,
      handleUnsavedDiscard: vi.fn(),
      handleUnsavedCancel: vi.fn(),
      stageLumping: vi.fn(),
      currentLumping: null,
    },
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
      refreshList: noopAsync,
      refreshBoreholeList: noopAsync,
      loadCptDetail: noopAsync,
      loadChart: noopAsync,
      loadBoreholeDetail: noopAsync,
      cancelBboxDraw: vi.fn(),
      unhideCpts: vi.fn(),
      unhideBoreholes: vi.fn(),
      handleRemoveCpts: vi.fn(),
      handleRemoveBoreholes: vi.fn(),
      handleRestoreAllCpts: vi.fn(),
      handleRestoreAllBoreholes: vi.fn(),
      handlePatchCptElevation: noopAsync,
      handlePatchBoreholeElevation: noopAsync,
      handleImportCpt: noopAsync,
      handleImportDov: vi.fn(),
      handleImportBoreholeDov: vi.fn(),
      handleBboxDrawn: noopAsync,
      pendingCptPins: [],
    },
    visibleCpts: [],
    visibleBoreholes: [],
    geoModel: {
      activeGeologicalModel: null,
      models: [],
      activeLithoModel: overrides.activeLithoModel ?? null,
      activeGeotechModel: null,
      handleCreateLithoModel: async () => null,
      handleActivateLithoModel: noopAsync,
      handleDeleteLithoModel: noopAsync,
      lithoContacts: [],
      lithoLayers: [],
      lithoFormations: [],
      lithoSurfacesByFormationId: new Map(),
      lithoStaleSurfaceCount: 0,
      handleRebuildLithoSurfaces: noopAsync,
      handleAutoCorrelate: noopAsync,
      handleClearSuggestions: noopAsync,
      lithoCrossingPinchOuts: [],
      geotechLayers: [],
      geotechContacts: [],
      geotechFormations: overrides.geotechFormations ?? [],
      handleCreateManualLithoGhost: vi.fn(),
      handleExtendLithoGhostToNearestContacts: vi.fn(() => ({ ok: true })),
      markMutated: vi.fn(),
      handleSubdivideAllBodies: noopAsync,
      requestGeotechLayersRefetch: vi.fn(),
      handleCreateLithoContact: noopAsync,
      handleInlineLithoCreateFormation: () => Promise.resolve(null),
      formations: [],
      visibleFormations: [],
      formationsRefreshCounter: 0,
      contacts: [],
      surfacesByFormationId: new Map(),
      crossingsRefreshCounter: 0,
      staleSurfaceCount: 0,
      handleFormationCreated: vi.fn(),
      handleFormationUpdated: vi.fn(),
      handleFormationDeleted: vi.fn(),
      handleInlineCreateFormation: () => Promise.resolve(null),
      refetchFormations: vi.fn(),
      handleCreateContact: noopAsync,
      handleUpdateContactDepth: noopAsync,
      handleBatchCreateContacts: noopAsync,
      handleBatchUpdateContacts: noopAsync,
      handleDeleteContact: noopAsync,
      handleUnlinkLithoFromGeo: noopAsync,
      handleLinkLithoToGeo: noopAsync,
      handleAutoPopulateFromStratigraphy: noopAsync,
      handleDedupeContacts: () => Promise.resolve(0),
      handleRebuildSurfaces: noopAsync,
      handleExportModelPlaxis3d: noopAsync,
      handleToggleBoreholeInModel: noopAsync,
      discardContacts: vi.fn(),
      discoverBoreholeFormations: () => Promise.resolve({ candidates: [], collisions: [] }),
      applyBoreholeFormationSelection: noopAsync,
      handleDeleteModel: noopAsync,
      ensureActiveGeologicalModel: () => Promise.resolve(null),
      ghostsByAnchor: new Map(),
      focusedSuggestAnchorId: null,
      handleEditLithoSuggestion: () => {},
      bulkLithoSuggesting: false,
      handleSuggestAllLitho: async () => {},
      handleAcceptBulkLitho: async () => {},
      handleAcceptAllBulkLitho: async () => {},
      handleRejectBulkLitho: () => {},
      handleUnrejectBulkLitho: () => {},
      handleEditBulkLitho: () => {},
      handleInsertLithoLayer: vi.fn(),
      handleSplitLithoLayer: vi.fn(),
      handleMergeLithoLayers: vi.fn(),
      handleAbsorbLithoLayer: vi.fn(),
      clearBulkLithoGhosts: () => {},
      handleStripLithoAdmixtures: () => {},
      handleReseedLithoAdmixtures: () => {},
      handleClearLithoModel: noopAsync,
      refetchLithoContacts: () => {},
      lithoSuggesting: false,
      handleSuggestLitho: noopAsync,
      handleAcceptLithoSuggestion: () => Promise.resolve(null),
      handleAcceptAllLithoSuggestions: noopAsync,
      handleRejectLithoSuggestion: vi.fn(),
      handleUnrejectLithoSuggestion: vi.fn(),
      clearLithoSuggestions: vi.fn(),
      backdropSurfacesByFormationId: new Map(),
      handleLoadBackdropSurfaces: noopAsync,
      lithoSolids: [],
      lithoSolidsLoading: false,
      lithoSolidsBuilding: false,
      hasLithoSolids: false,
      hasStaleLithoSolid: false,
      buildLithoSolids: noopAsync,
      setBodyColor: vi.fn(),
      hideMarkers: false,
      setHideMarkers: vi.fn(),
      geotechSolids: overrides.geotechSolids ?? [],
      geotechSolidsLoading: false,
      geotechSolidsBuilding: false,
      hasGeotechSolids: overrides.hasGeotechSolids ?? false,
      hasStaleGeotechSolid: false,
      buildGeotechSolids: noopAsync,
      setGeotechBodyColor: vi.fn(),
      geotechHideMarkers: false,
      setGeotechHideMarkers: vi.fn(),
      // The stub is cast, so tsc does NOT enforce completeness here — this
      // field is written by hand precisely because omitting it would hand the
      // banner ``undefined`` where its type promises ``GaplessBuildReport |
      // null``, which is a lie the tests would then be built on.
      geotechGaplessReport: overrides.geotechGaplessReport ?? null,
    },
    sections: {
      sections: [],
      selectedSectionId: null,
      drawingSection: false,
      focusedContactIds: [],
      visibleSections: [],
      effectiveHorizontalEpsg: 31370,
      sectionModelAxis: overrides.sectionModelAxis ?? 'geological',
      setSectionModelAxis,
      backdropModelIdOverride: null,
      setBackdropModelIdOverride: vi.fn(),
      refreshSectionList: noopAsync,
      clearSectionSelection: vi.fn(),
      handleSectionCreated: vi.fn(),
      handleSectionDeleted: vi.fn(),
      handleCreateSection: () => Promise.resolve(null),
      cancelSectionDraw: vi.fn(),
      handleSectionLineDrawn: noopAsync,
      handleDeleteSection: noopAsync,
      handlePatchSelectedSection: noopAsync,
      handleSelectSection: vi.fn(),
      handleFocusContacts: vi.fn(),
      applyUpdatedSection: vi.fn(),
      sectionFocusedColumn: null,
      setSectionFocusedColumn: vi.fn(),
      correlateMode: false,
      correlationSource: null,
      enterCorrelateMode: vi.fn(),
      exitCorrelateMode: vi.fn(),
      armCorrelationSource: vi.fn(),
      clearCorrelationSource: vi.fn(),
      suggestedTies: [],
      handleSuggestTies: vi.fn(),
      handleAcceptTie: vi.fn(),
      handleAcceptAllTies: vi.fn(),
      handleRejectTie: vi.fn(),
      handleClearTieSuggestions: vi.fn(),
    },
    overlays: {
      demSource: null,
      demOverlay: { enabled: false, opacity: 0.6 },
      handleDemOverlayChange: noopAsync,
      virtueleBoringOverlay: { modelA: null, modelB: null, maxDepthM: null },
      virtueleBoringSectionModels: [],
      virtueleBoringPredictions: [],
      virtueleBoringLoading: false,
      virtueleBoringSkippedCount: 0,
      virtueleBoringPredictionByInvestigationId: new Map(),
      cptEffectiveModels: [],
      boreholeEffectiveModels: [],
      showOverlayOnSection: false,
      showOverlayOnCpt: false,
      showOverlayOnBorehole: false,
      cptVirtueleBoringOverride: '',
      boreholeVirtueleBoringOverride: '',
      handleChangeVirtueleBoringPicker: noopAsync,
      handleSetShowOverlay: vi.fn(),
      handleSetOverlayOverride: vi.fn(),
      showConfidenceFade: true,
      handleSetShowConfidenceFade: vi.fn(),
    },
    toasts: { toasts: [], toast: vi.fn() },
    undo: {
      push: vi.fn(),
      undo: noopAsync,
      redo: noopAsync,
      clear: vi.fn(),
      canUndo: false,
      canRedo: false,
      busy: false,
    },
    boot: { ready: true, apiError: false },
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
    coordinator: {
      selectedId: null,
      selectedBoreholeId: null,
      setSelectedId: vi.fn(),
      setSelectedBoreholeId: vi.fn(),
      view: 'map',
      setView: vi.fn(),
      handleSelect: noopAsync,
      handleSelectBorehole: noopAsync,
      handleExportSectionDxf: noopAsync,
      handleExportSectionPlaxis2d: noopAsync,
      handleExportSectionPdf: vi.fn(),
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
      setSectionsDeepLinkTarget: overrides.setSectionsDeepLinkTarget ?? vi.fn(),
      correlationEdgesRefetchNonce: 0,
      bodyRecomputeLithoNonce: 0,
      bodyRecomputeGeotechNonce: 0,
      requestBodyRecompute: vi.fn(),
      requestCorrelationEdgesRefetch: vi.fn(),
    },
  } as unknown as ShellContextValue
}

function renderCanvas(ctx: ShellContextValue) {
  return render(
    <ShellContext.Provider value={ctx}>
      <GeotechnicalCanvas />
    </ShellContext.Provider>,
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let consoleErrorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  consoleErrorSpy.mockRestore()
  vi.restoreAllMocks()
})

describe('GeotechnicalCanvas (the 3D-only geotech room)', () => {
  it('GC1 — no litho model: EmptyState renders with the Lithology-stage hint', () => {
    renderCanvas(makeCtx({ activeLithoModel: null }))
    // EmptyState title
    expect(screen.getByText('No lithostratigraphic model yet')).toBeTruthy()
    expect(screen.queryByTestId('geology-3d-viewer')).toBeNull()
  })

  it('GC2 — litho model but nothing built: the guided Build empty state, not the viewer', () => {
    // activeGeotechModel is null by default in makeCtx — the canvas must NOT
    // gate on it; the user who still has to run "Subdivide all bodies" gets
    // the Build hint, not a blank stage.
    renderCanvas(makeCtx({ activeLithoModel: makeLithoModel(), hasGeotechSolids: false }))
    expect(screen.getByText('No geotech body model yet')).toBeTruthy()
    expect(screen.queryByTestId('geology-3d-viewer')).toBeNull()
  })

  it('GC3 — built solids: the 3D viewer renders straight away, NAD-coloured', () => {
    // A geotech formation stores its inherited LITHOLOGY colour (#123456); the
    // 3D pane must recolour it by NAD class (nadColoredFormations) before
    // handing it to the viewer — proving the geotech NAD-colour seam is wired.
    // No dimension toggle is clicked first: the stage IS the 3D room.
    const geotechFormations = [{ id: 'g-1', nad_class: 6, color: '#123456' }]
    const geotechSolids = [{ body_id: 'b-1', is_flagged: false }]
    renderCanvas(
      makeCtx({
        activeLithoModel: makeLithoModel(),
        hasGeotechSolids: true,
        geotechSolids,
        geotechFormations,
      }),
    )
    const viewer = screen.getByTestId('geology-3d-viewer')
    expect(viewer).toBeTruthy()
    // bodySolids forwarded.
    expect(viewer.getAttribute('data-body-count')).toBe('1')
    // Formation colour is the NAD-class colour, NOT the inherited litho colour.
    expect(viewer.getAttribute('data-first-formation-color')).toBe(nadClassColor(6))
    expect(viewer.getAttribute('data-first-formation-color')).not.toBe('#123456')
  })

  it('GC4 — never opens the 2D section surface and never mutates the section axis', () => {
    // The retired pill did both: it rendered SectionsCanvas in its 2D half and
    // forced sectionModelAxis to 'geotechnical' on mount. A stage that no
    // longer owns the 2D view must not reach across and reprogram the Sections
    // stage's axis picker behind the user's back.
    const setSectionModelAxis = vi.fn()
    renderCanvas(
      makeCtx({
        activeLithoModel: makeLithoModel(),
        hasGeotechSolids: true,
        geotechSolids: [{ body_id: 'b-1', is_flagged: false }],
        geotechFormations: [{ id: 'g-1', nad_class: 6, color: '#123456' }],
        sectionModelAxis: 'geological',
        setSectionModelAxis,
      }),
    )
    expect(setSectionModelAxis).not.toHaveBeenCalled()
    expect(screen.queryByTestId('sections-canvas')).toBeNull()
    // The dimension pill itself is gone.
    expect(screen.queryByTestId('geotech-view-2d')).toBeNull()
    expect(screen.queryByTestId('geotech-view-3d')).toBeNull()
  })

  it('GC5 — the build verdict is readable on the empty-state branch, not only beside a model', () => {
    const report: GaplessBuildReport = {
      verdict: 'fail',
      generated_at: '2026-08-26T02:00:00Z',
      clauses: [
        {
          key: 'column-totality',
          number: 5,
          title: 'Every column inside the model footprint carries material',
          status: 'fail',
          entries: [{ label: '412 columns inside the footprint carry no material' }],
        },
      ],
    }
    // hasGeotechSolids false → the guided Build empty state, i.e. the branch
    // that used to return before anything else could render.
    renderCanvas(
      makeCtx({
        activeLithoModel: makeLithoModel(),
        hasGeotechSolids: false,
        geotechGaplessReport: report,
      }),
    )
    expect(screen.getByText('No geotech body model yet')).toBeTruthy()
    const banner = screen.getByTestId('geotech-build-report-banner')
    expect(banner.textContent).toMatch(/Every column inside the model footprint carries material/)
  })

  /** A one-broken-clause report whose only entry stands on Tie-section 7. */
  function spotReport(
    entry: GaplessBuildReport['clauses'][number]['entries'][number],
  ): GaplessBuildReport {
    return {
      verdict: 'fail',
      generated_at: '2026-08-26T02:00:00Z',
      clauses: [
        {
          key: 'cause-closure',
          number: 3,
          title: 'Every patch of unclassed ground has a known cause',
          status: 'fail',
          entries: [entry],
        },
      ],
    }
  }

  /** Open the disclosure and press the single "Show me". */
  function pressShowMe(report: GaplessBuildReport, setSectionsDeepLinkTarget: () => void): void {
    renderCanvas(
      makeCtx({
        activeLithoModel: makeLithoModel(),
        hasGeotechSolids: true,
        geotechSolids: [{ body_id: 'b-1', is_flagged: false }],
        geotechFormations: [{ id: 'g-1', nad_class: 6, color: '#123456' }],
        geotechGaplessReport: report,
        setSectionsDeepLinkTarget,
      }),
    )
    fireEvent.click(screen.getByTestId('geotech-build-report-disclosure'))
    fireEvent.click(screen.getByTestId('geotech-build-report-visit'))
  }

  it('GC6 — a named spot walks to its section AND to the gap itself', () => {
    // Owner dogfeed 2026-08-28: *"the show me button opens section but doesn't
    // zoom to issue"*. The deep-link now carries the gap's own two columns, so
    // the section panel centres between them through its OWN column list — the
    // gap index never crosses this boundary (it indexes the litho frame's list
    // and is a different gap on the geotech axis).
    const setSectionsDeepLinkTarget = vi.fn()
    pressShowMe(
      spotReport({
        label: 'Tie-section 7, gap 12: ground left unclassed with no known cause',
        section_id: 'tie7',
        section_name: 'Tie-section 7',
        gap_index: 12,
        gap_investigation_ids: ['S4', 'B6'],
      }),
      setSectionsDeepLinkTarget,
    )
    expect(setSectionsDeepLinkTarget).toHaveBeenCalledWith({
      sectionId: 'tie7',
      contactIds: [],
      revealInvestigationIds: ['S4', 'B6'],
    })
  })

  it('GC7 — a spot that cannot name its columns still opens the section', () => {
    const setSectionsDeepLinkTarget = vi.fn()
    pressShowMe(
      spotReport({
        label: 'Tie-section 7, gap 12: ground left unclassed with no known cause',
        section_id: 'tie7',
        section_name: 'Tie-section 7',
        gap_index: 12,
      }),
      setSectionsDeepLinkTarget,
    )
    // Exactly what the press did before this change — no reveal request at all,
    // rather than one the shell would have to guess a target for.
    expect(setSectionsDeepLinkTarget).toHaveBeenCalledWith({
      sectionId: 'tie7',
      contactIds: [],
    })
  })
})

// ---------------------------------------------------------------------------
// Module-ref cleanup on unmount (debt #276)
//
// The geotech canvas ⟷ toolbar bridges are module-level refs written every
// render. Debt #276: most were never nulled on unmount, so "a toolbar click
// that fires after the canvas unmounted [ran] against a destroyed view". The
// voxel + split refs are written ABOVE the early returns, so the guided
// Build-empty-state branch populates them too — no built solids needed here.
// ---------------------------------------------------------------------------

describe('GeotechnicalCanvas module-ref cleanup on unmount (#276)', () => {
  // GU1 — the split-viewport ref (never nulled before this fix). A Reset click
  // after a stage switch must not run against a destroyed view.
  it('GU1 — split-viewport ref is null after the canvas unmounts', () => {
    const r = renderCanvas(makeCtx({ activeLithoModel: makeLithoModel() }))
    expect(resetGeotechSplitViewportCallback.current).not.toBeNull()
    r.unmount()
    expect(resetGeotechSplitViewportCallback.current).toBeNull()
  })

  // GU2 — the voxel-build ref. A "Build model" click after unmount must not
  // build a destroyed view's partition.
  it('GU2 — voxel-request ref is null after the canvas unmounts', () => {
    const r = renderCanvas(makeCtx({ activeLithoModel: makeLithoModel() }))
    expect(geotechVoxelRequestCallback.current).not.toBeNull()
    r.unmount()
    expect(geotechVoxelRequestCallback.current).toBeNull()
  })

  // GU3 — the mount-order guard. Mount A, mount B, unmount A → the ref must
  // still hold B's callback.
  it('GU3 — an older canvas unmount does not wipe a ref the newer canvas claimed', () => {
    const rA = renderCanvas(makeCtx({ activeLithoModel: makeLithoModel() }))
    const aBuilder = geotechVoxelRequestCallback.current
    const rB = renderCanvas(makeCtx({ activeLithoModel: makeLithoModel() }))
    const bBuilder = geotechVoxelRequestCallback.current
    expect(bBuilder).not.toBe(aBuilder)
    rA.unmount()
    expect(geotechVoxelRequestCallback.current).toBe(bBuilder)
    rB.unmount()
    expect(geotechVoxelRequestCallback.current).toBeNull()
  })
})
