// Behavioral net for the F3 geotechnical axis toggle in SectionsToolbar.
//
// Pinned claims:
//   BG1  A "Geotech" radio button is present in the axis toggle group.
//   BG2  When activeGeotechModel is null, the "Geotech" button is disabled.
//   BG3  When activeGeotechModel is present, clicking "Geotech" calls
//        setSectionModelAxis('geotechnical').
//   BG4  When activeGeotechModel is present and axis is 'geotechnical',
//        the "Geotech" button is aria-checked=true.
//   BG5  When axis is 'geotechnical', the "Geology" and "Litho" buttons are
//        both aria-checked=false.
//
// Rendering SectionsToolbar via ShellContext.Provider — same pattern as
// SectionsToolbar.axis.test.tsx.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShellContext } from '../../ShellContext'
import type { ShellContextValue } from '../../ShellContext'
import type {
  BoreholeListItem,
  CrossSectionResponse,
  GeologicalModelResponse,
  LithoLayerResponse,
} from '../../../api/client'
import SectionsToolbar from './SectionsToolbar'
import SectionsInspector from './SectionsInspector'
import {
  publishGeotechPreviewRender,
  resetGeotechPreviewRender,
} from '../../../utils/geotechPreviewRenderStore'

// ---------------------------------------------------------------------------
// Module mocks — same as SectionsToolbar.axis.test.tsx
// ---------------------------------------------------------------------------

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client')
  return {
    ...actual,
    setBaseUrl: vi.fn(),
    api: {
      geology: {
        validateCrossings: vi.fn().mockResolvedValue({ model_id: '', issues: [] }),
      },
      virtueleBoring: {
        getModels: vi.fn().mockResolvedValue([]),
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
// Stub context factory — mirrors the axis test's makeCtx; adds
// activeGeotechModel override.
// ---------------------------------------------------------------------------

const noopAsync = (): Promise<void> => Promise.resolve()
const noopAsyncNull = (): Promise<null> => Promise.resolve(null)

function makeGeotechModel(): GeologicalModelResponse {
  return {
    id: 'model-geotech-1',
    app_project_id: 'proj-1',
    name: 'Geotech model',
    description: null,
    kind: 'geotechnical',
    parent_model_id: 'model-litho-1',
    is_active: true,
    excluded_borehole_ids: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

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

function makeCtx(overrides: {
  activeGeotechModel?: GeologicalModelResponse | null
  activeLithoModel?: GeologicalModelResponse | null
  selectedSectionId?: string | null
  sectionModelAxis?: 'geological' | 'lithostratigraphic' | 'geotechnical'
  setSectionModelAxis?: (axis: 'geological' | 'lithostratigraphic' | 'geotechnical') => void
  handleSubdivideAllBodies?: () => Promise<void>
  handleDivideBoreholes?: () => Promise<void>
  correlateMode?: boolean
  enterCorrelateMode?: () => void
  exitCorrelateMode?: () => void
  // The three inputs `hasUndividedBoreholes` is derived from: which section is
  // open, which boreholes project into it, and which of them already carry a
  // committed geotech band.
  sections?: CrossSectionResponse[]
  visibleBoreholes?: BoreholeListItem[]
  geotechLayers?: LithoLayerResponse[]
} = {}): ShellContextValue {
  const setSectionModelAxis = overrides.setSectionModelAxis ?? vi.fn()

  return {
    project: {
      id: 'proj-1',
      name: 'Test Project',
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
    visibleBoreholes: overrides.visibleBoreholes ?? [],
    geoModel: {
      activeGeologicalModel: {
        id: 'model-geo-1',
        app_project_id: 'proj-1',
        name: 'Default model',
        description: null,
        kind: 'geological',
        parent_model_id: null,
        is_active: true,
        excluded_borehole_ids: [],
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
      models: [],
      activeLithoModel: overrides.activeLithoModel ?? null,
      activeGeotechModel: overrides.activeGeotechModel ?? null,
      handleCreateLithoModel: async () => null,
      handleActivateLithoModel: async () => {},
      lithoContacts: [],
      lithoLayers: [],
      lithoFormations: [],
      lithoSurfacesByFormationId: new Map(),
      handleCreateLithoContact: noopAsync,
      handleInlineLithoCreateFormation: noopAsyncNull,
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
      handleInlineCreateFormation: noopAsyncNull,
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
      handleToggleBoreholeInLithoModel: noopAsync,
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
      handleAcceptLithoSuggestion: noopAsyncNull,
      handleAcceptAllLithoSuggestions: noopAsync,
      handleRejectLithoSuggestion: vi.fn(),
      handleUnrejectLithoSuggestion: vi.fn(),
      clearLithoSuggestions: vi.fn(),
      handleDeleteLithoModel: noopAsync,
      backdropSurfacesByFormationId: new Map(),
      handleLoadBackdropSurfaces: noopAsync,
      lithoSolids: [],
      startLithoBuild: async () => {},
      cancelLithoBuild: () => {},
      voxelBuildState: { status: 'idle' as const },
      lithoSolidsLoading: false,
      lithoSolidsBuilding: false,
      hasLithoSolids: false,
      hasStaleLithoSolid: false,
      buildLithoSolids: noopAsync,
      setBodyColor: vi.fn(),
      hideMarkers: false,
      setHideMarkers: vi.fn(),
      geotechSolids: [],
      geotechSolidsLoading: false,
      geotechSolidsBuilding: false,
      hasGeotechSolids: false,
      hasStaleGeotechSolid: false,
      buildGeotechSolids: noopAsync,
      setGeotechBodyColor: vi.fn(),
      geotechHideMarkers: false,
      setGeotechHideMarkers: vi.fn(),
      // Debt #266 — geotech columns standing on litho that has since moved.
      staleLithoGeotechColumns: [],
      staleLithoGeotechColumnIds: new Set<string>(),
      staleLithoGeotechColumnCount: 0,
      unstampedGeotechColumnCount: 0,
      refreshGeotechLithoStaleness: vi.fn(),
      lithoStaleSurfaceCount: 0,
      handleRebuildLithoSurfaces: noopAsync,
      handleAutoCorrelate: noopAsync,
      handleClearSuggestions: noopAsync,
      lithoCrossingPinchOuts: [],
      geotechLayers: overrides.geotechLayers ?? [],
      geotechContacts: [],
      geotechFormations: [],
      // Derived by the geo-model hook; the toolbar reads it for the Subdivide
      // verb's "N columns need re-deriving" tag. This stub is cast through
      // ``unknown``, so a missing field is a runtime crash, not a tsc error.
      columnsNeedingRederive: [],
      handleCreateManualLithoGhost: vi.fn(),
      copyGhostColumn: vi.fn(),
      handleExtendLithoGhostToNearestContacts: vi.fn(() => ({ ok: true })),
      markMutated: vi.fn(),
      // F4 — "Subdivide all bodies" verb handler.
      handleSubdivideAllBodies: overrides.handleSubdivideAllBodies ?? noopAsync,
      // "Divide boreholes" verb handler.
      handleDivideBoreholes: overrides.handleDivideBoreholes ?? noopAsync,
      requestGeotechLayersRefetch: vi.fn(),
    },
    sections: {
      sections: overrides.sections ?? [],
      selectedSectionId: overrides.selectedSectionId ?? null,
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
      correlateMode: overrides.correlateMode ?? false,
      correlationSource: null,
      enterCorrelateMode: overrides.enterCorrelateMode ?? vi.fn(),
      exitCorrelateMode: overrides.exitCorrelateMode ?? vi.fn(),
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
      correlationEdgesRefetchNonce: 0,
      bodyRecomputeLithoNonce: 0,
      bodyRecomputeGeotechNonce: 0,
      requestBodyRecompute: vi.fn(),
      requestCorrelationEdgesRefetch: vi.fn(),
    },
  } as unknown as ShellContextValue
}

function renderToolbar(ctx: ShellContextValue): void {
  render(
    <ShellContext.Provider value={ctx}>
      <SectionsToolbar />
    </ShellContext.Provider>,
  )
  openPipelineMenu()
}

/** The pipeline steps live in the "Packing pipeline" dropdown (owner
 *  2026-08-05). Open it right after render so the step items are queryable —
 *  an item click auto-closes the menu, which is fine for these single-press
 *  scenes. No-op off the geotech axis (the trigger is absent there). */
function openPipelineMenu(): void {
  const trigger = screen.queryByTestId('geotech-pipeline')
  if (trigger && !(trigger as HTMLButtonElement).disabled) {
    fireEvent.click(trigger)
  }
}


/** The ghost legend moved to the right-hand inspector (owner 2026-08-05) —
 *  the BF legend scenes render the inspector, not the toolbar. */
function renderInspector(ctx: ShellContextValue): void {
  render(
    <ShellContext.Provider value={ctx}>
      <SectionsInspector />
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

describe('SectionsToolbar geotech axis toggle (F3)', () => {
  it('BG1 — a "Geotech" radio button is present in the axis group', () => {
    renderToolbar(makeCtx())
    expect(screen.getByText('Geotech')).toBeTruthy()
  })

  it('BG2 — "Geotech" is disabled when NEITHER a geotech nor a litho model exists', () => {
    // With no litho model there is nothing for the packing pipeline to
    // subdivide, so the axis has nothing to show and nothing to offer.
    renderToolbar(makeCtx({ activeGeotechModel: null, activeLithoModel: null }))
    const btn = screen.getByTestId('axis-geotech')
    expect(btn).toBeDisabled()
  })

  it('DL1 — the Display menu offers "Show litho fill", default off, and a click flips it (owner 2026-08-06)', async () => {
    // One fill at a time on the geotech axis: the litho fill is opt-in.
    renderToolbar(
      makeCtx({ activeGeotechModel: makeGeotechModel(), sectionModelAxis: 'geotechnical' }),
    )
    fireEvent.click(screen.getByTestId('geotech-display-menu'))
    const item = await screen.findByTestId('geotech-toggle-litho-fill')
    expect(item.textContent).toContain('Show litho fill')
    fireEvent.click(item)
    fireEvent.click(screen.getByTestId('geotech-display-menu'))
    const flipped = await screen.findByTestId('geotech-toggle-litho-fill')
    expect(flipped.textContent).toContain('Hide litho fill')
    // Leave the module-global store as we found it for sibling tests.
    fireEvent.click(flipped)
  })

  it('BG2b — "Geotech" is ENABLED on a clean slate with a litho model: step 1 creates the geotech model', () => {
    // Owner flow 2026-08-05: "geotech axis -> Packing pipeline -> 1 (creates
    // the model fresh)". The pipeline's entry point lives ON the geotech axis,
    // so the axis must be reachable BEFORE any geotech model exists — gating
    // it on the geotech model deadlocks the first run (the model can only be
    // created from the axis the gate locks). The litho model is the true
    // prerequisite: it is the pipeline's source.
    const setSectionModelAxis = vi.fn()
    renderToolbar(
      makeCtx({ activeGeotechModel: null, activeLithoModel: makeLithoModel(), setSectionModelAxis }),
    )
    const btn = screen.getByTestId('axis-geotech')
    expect(btn).not.toBeDisabled()
    fireEvent.click(btn)
    expect(setSectionModelAxis).toHaveBeenCalledWith('geotechnical')
  })

  it('BG3 — clicking "Geotech" calls setSectionModelAxis("geotechnical") when model exists', () => {
    const setSectionModelAxis = vi.fn()
    renderToolbar(makeCtx({ activeGeotechModel: makeGeotechModel(), setSectionModelAxis }))
    fireEvent.click(screen.getByTestId('axis-geotech'))
    expect(setSectionModelAxis).toHaveBeenCalledWith('geotechnical')
  })

  it('BG4 — when axis is "geotechnical", Geotech button is aria-checked=true', () => {
    renderToolbar(
      makeCtx({ activeGeotechModel: makeGeotechModel(), sectionModelAxis: 'geotechnical' }),
    )
    expect(screen.getByTestId('axis-geotech').getAttribute('aria-checked')).toBe('true')
  })

  it('BG5 — when axis is "geotechnical", Geology and Litho are both aria-checked=false', () => {
    renderToolbar(
      makeCtx({ activeGeotechModel: makeGeotechModel(), sectionModelAxis: 'geotechnical' }),
    )
    const geoBtn = screen.getByText('Stratigraphy').closest('button')
    const lithoBtn = screen.getByText('Litho').closest('button')
    expect(geoBtn?.getAttribute('aria-checked')).toBe('false')
    expect(lithoBtn?.getAttribute('aria-checked')).toBe('false')
  })
})

// ---------------------------------------------------------------------------
// F4 — "Subdivide all bodies" toolbar verb
// ---------------------------------------------------------------------------
//
// Pinned claims:
//   BF1  The "Subdivide all bodies" button is present on the geotech axis.
//   BF2  The button is absent on the geology and litho axes.
//   BF3  The button is disabled when activeLithoModel is null; enabled when
//        the model is present (section selection is no longer required — the
//        operation is model-wide).
//   BF4  Clicking the enabled button calls handleSubdivideAllBodies with the
//        OPEN section's id (owner ruling 2026-08-15 — the verb is section
//        scoped, and after "I didn't ask for the on all sections option ...
//        delete it and keep only on this section" that is its only scope).

describe('SectionsToolbar "Subdivide all bodies" verb (F4)', () => {
  it('BF1 — button is present when the axis is "geotechnical"', () => {
    renderToolbar(
      makeCtx({
        sectionModelAxis: 'geotechnical',
        activeLithoModel: makeLithoModel(),
        selectedSectionId: 'section-1',
      }),
    )
    expect(screen.getByTestId('geotech-subdivide-cpts')).toBeTruthy()
  })

  it('BF2 — button is absent on the geology axis', () => {
    renderToolbar(makeCtx({ sectionModelAxis: 'geological' }))
    expect(screen.queryByTestId('geotech-subdivide-cpts')).toBeNull()
  })

  it('BF2b — button is absent on the lithostratigraphic axis', () => {
    renderToolbar(
      makeCtx({
        sectionModelAxis: 'lithostratigraphic',
        activeLithoModel: makeLithoModel(),
      }),
    )
    expect(screen.queryByTestId('geotech-subdivide-cpts')).toBeNull()
  })

  it('BF3 — button is disabled when no litho model exists', () => {
    renderToolbar(
      makeCtx({
        sectionModelAxis: 'geotechnical',
        activeLithoModel: null,
        selectedSectionId: 'section-1',
      }),
    )
    expect(screen.getByTestId('geotech-subdivide-cpts')).toBeDisabled()
  })

  it('BF3b — with no section open the step is dead, and nothing stands in for it', () => {
    // RE-PINNED 2026-08-15 (twice in one day). The oldest pin read "ENABLED
    // even when no section is selected (model-wide operation)"; the second
    // added an all-sections escape beside it, which the owner then deleted
    // ("I didn't ask for the on all sections option, it's ugly and confusing").
    // Open a section, or the step does not run.
    renderToolbar(
      makeCtx({
        sectionModelAxis: 'geotechnical',
        activeLithoModel: makeLithoModel(),
        selectedSectionId: null,
      }),
    )
    expect(screen.getByTestId('geotech-subdivide-cpts')).toBeDisabled()
    expect(screen.queryByTestId('geotech-subdivide-cpts-all')).toBeNull()
  })

  it('BF4 — clicking the button subdivides the section on screen', () => {
    // RE-PINNED 2026-08-15: was "with no arguments (model-wide)".
    const handleSubdivideAllBodies = vi.fn(() => Promise.resolve())
    renderToolbar(
      makeCtx({
        sectionModelAxis: 'geotechnical',
        activeLithoModel: makeLithoModel(),
        selectedSectionId: 'section-abc',
        handleSubdivideAllBodies,
      }),
    )
    fireEvent.click(screen.getByTestId('geotech-subdivide-cpts'))
    // ``representativeStatistic`` rides along from 2026-08-15 — null here,
    // because no qc statistic was picked before the press.
    expect(handleSubdivideAllBodies).toHaveBeenCalledWith({
      deriveEdges: false,
      sectionId: 'section-abc',
      representativeStatistic: null,
      // First subdivision wins (owner 2026-08-18): no rebuild tag is
      // active in this scene, so the press imports existing bands as-is.
      rebuildExisting: false,
    })
  })
})

// ---------------------------------------------------------------------------
// C1 — re-subdivide confirmation gate (§7)
// ---------------------------------------------------------------------------
//
// Pinned claims:
//   BC1  Clicking "1 · Subdivide CPTs" on a section that ALREADY carries
//        packing bands OPENS the re-subdivide confirm dialog (the re-run
//        clears its manual packing connections) instead of running directly.
//   BC2  Clicking it when NO geotech model exists (first-ever subdivide) runs
//        directly and does NOT open the dialog.
//
// RE-PINNED 2026-08-15: the trigger is the bands the press will rebuild, not
// the existence of a geotech model — owner, "We do however get an overwrite
// popup on cs2 while there is no subdivision there yet. Now it seems like it is
// warning that i'll overwrite CS 1". A model that exists but has nothing on
// THIS section is not something this press can destroy. BC1 therefore stages a
// band on the open section; the empty-scope half lives in
// SectionsToolbar.handEditWarning.test.tsx (HS1).

describe('SectionsToolbar re-subdivide confirmation gate (C1)', () => {
  it('BC1 — opens the confirm dialog (not a direct run) when a geotech model exists', () => {
    const handleSubdivideAllBodies = vi.fn(() => Promise.resolve())
    renderToolbar(
      makeCtx({
        sectionModelAxis: 'geotechnical',
        activeLithoModel: makeLithoModel(),
        activeGeotechModel: makeGeotechModel(),
        // A section is open — the state the engineer presses step 1 from since
        // the verb became section-scoped (owner ruling 2026-08-15) — and it
        // CARRIES a packing band, which is what the press would destroy.
        sections: [makeSection()],
        selectedSectionId: 'section-1',
        visibleBoreholes: [makeBorehole('bh-1')],
        geotechLayers: [makeGeotechBand('bh-1')],
        handleSubdivideAllBodies,
      }),
    )
    // Dialog is not mounted before the click.
    expect(screen.queryByTestId('re-subdivide-confirm-dialog')).toBeNull()
    fireEvent.click(screen.getByTestId('geotech-subdivide-cpts'))
    // The re-run is gated behind the confirm dialog — it must appear, and the
    // handler must NOT have fired yet (the user has to confirm first).
    expect(screen.getByTestId('re-subdivide-confirm-dialog')).toBeTruthy()
    expect(handleSubdivideAllBodies).not.toHaveBeenCalled()
  })

  it('BC2 — first-ever subdivide (no geotech model) runs directly, no dialog', () => {
    const handleSubdivideAllBodies = vi.fn(() => Promise.resolve())
    renderToolbar(
      makeCtx({
        sectionModelAxis: 'geotechnical',
        activeLithoModel: makeLithoModel(),
        activeGeotechModel: null,
        selectedSectionId: 'section-1',
        handleSubdivideAllBodies,
      }),
    )
    fireEvent.click(screen.getByTestId('geotech-subdivide-cpts'))
    expect(screen.queryByTestId('re-subdivide-confirm-dialog')).toBeNull()
    // RE-PINNED 2026-08-15: the press carries the open section's id and the
    // pre-model qc statistic (none picked here).
    expect(handleSubdivideAllBodies).toHaveBeenCalledWith({
      deriveEdges: false,
      sectionId: 'section-1',
      representativeStatistic: null,
      // First subdivision wins (owner 2026-08-18): no rebuild tag is
      // active in this scene, so the press imports existing bands as-is.
      rebuildExisting: false,
    })
  })
})

// ---------------------------------------------------------------------------
// D — "Correlate packing" verb (manual same-class/same-body packing connect)
// ---------------------------------------------------------------------------
//
// Pinned claims:
//   BD1  The "Correlate packing" verb renders on the geotech axis.
//   BD2  Clicking it (when correlate mode is off) calls enterCorrelateMode.
//   BD3  Clicking it (when correlate mode is on) calls exitCorrelateMode, and
//        the active state is reflected (amber + "click 2 bands" label).

describe('SectionsToolbar "Correlate packing" verb (D)', () => {
  it('BD1 — verb renders on the geotech axis when a geotech model exists', () => {
    renderToolbar(
      makeCtx({
        sectionModelAxis: 'geotechnical',
        activeLithoModel: makeLithoModel(),
        activeGeotechModel: makeGeotechModel(),
      }),
    )
    expect(screen.getByTestId('geotech-correlate-packing')).toBeTruthy()
  })

  it('BD2 — clicking enters correlate mode when off', () => {
    const enterCorrelateMode = vi.fn()
    const exitCorrelateMode = vi.fn()
    renderToolbar(
      makeCtx({
        sectionModelAxis: 'geotechnical',
        activeLithoModel: makeLithoModel(),
        activeGeotechModel: makeGeotechModel(),
        correlateMode: false,
        enterCorrelateMode,
        exitCorrelateMode,
      }),
    )
    fireEvent.click(screen.getByTestId('geotech-correlate-packing'))
    expect(enterCorrelateMode).toHaveBeenCalled()
    expect(exitCorrelateMode).not.toHaveBeenCalled()
  })

  it('BD3 — clicking exits correlate mode when on, and active state is reflected', () => {
    const enterCorrelateMode = vi.fn()
    const exitCorrelateMode = vi.fn()
    renderToolbar(
      makeCtx({
        sectionModelAxis: 'geotechnical',
        activeLithoModel: makeLithoModel(),
        activeGeotechModel: makeGeotechModel(),
        correlateMode: true,
        enterCorrelateMode,
        exitCorrelateMode,
      }),
    )
    const btn = screen.getByTestId('geotech-correlate-packing')
    // Active-state cue: label switches to the in-progress prompt.
    expect(btn.textContent).toContain('click 2 bands')
    fireEvent.click(btn)
    expect(exitCorrelateMode).toHaveBeenCalled()
    expect(enterCorrelateMode).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// E — "Divide boreholes" verb
// ---------------------------------------------------------------------------
//
// Pinned claims:
//   BE1  The "Divide boreholes" button is present on the geotech axis when
//        a geotech model exists.
//   BE2  The button is disabled when activeGeotechModel is null (SAB must run
//        first to create the model and CPT geotech layers).
//   BE3  Clicking the enabled button calls handleDivideBoreholes with the OPEN
//        section's id (owner ruling 2026-08-15 — "i'm reading divide boreholes
//        (whole model), no that should also be section scoped", so step 4 is
//        scoped and gated exactly like steps 1-3, a section open included).
//   BE4  The button is absent on the geology and litho axes.

describe('SectionsToolbar "Divide boreholes" verb (E)', () => {
  it('BE1 — button is present on geotech axis when a geotech model exists', () => {
    renderToolbar(
      makeCtx({
        sectionModelAxis: 'geotechnical',
        activeLithoModel: makeLithoModel(),
        activeGeotechModel: makeGeotechModel(),
      }),
    )
    expect(screen.getByTestId('geotech-divide-boreholes')).toBeTruthy()
  })

  it('BE2 — button is disabled when activeGeotechModel is null', () => {
    renderToolbar(
      makeCtx({
        sectionModelAxis: 'geotechnical',
        activeLithoModel: makeLithoModel(),
        activeGeotechModel: null,
      }),
    )
    expect(screen.getByTestId('geotech-divide-boreholes')).toBeDisabled()
  })

  it('BE3 — clicking the enabled button divides the section on screen', () => {
    // The scene starts one press further on than BE1/BE2: the open section
    // carries packing, which since 2026-08-15 is what makes step 4 live at all
    // (owner: "when i switched to cs2 options 2 3 and 4 in the packing pipeline
    // where clickable this was not the case on the first subdivide in cs1").
    const handleDivideBoreholes = vi.fn(() => Promise.resolve())
    renderToolbar(
      makeCtx({
        sectionModelAxis: 'geotechnical',
        activeLithoModel: makeLithoModel(),
        activeGeotechModel: makeGeotechModel(),
        sections: [makeSection()],
        selectedSectionId: 'section-1',
        visibleBoreholes: [makeBorehole('bh-1')],
        geotechLayers: [makeGeotechBand('bh-1')],
        handleDivideBoreholes,
      }),
    )
    fireEvent.click(screen.getByTestId('geotech-divide-boreholes'))
    expect(handleDivideBoreholes).toHaveBeenCalledWith(expect.objectContaining({ sectionId: 'section-1' }))
  })

  it('BE3b — with no section open the step is dead, like steps 1-3', () => {
    const handleDivideBoreholes = vi.fn(() => Promise.resolve())
    renderToolbar(
      makeCtx({
        sectionModelAxis: 'geotechnical',
        activeLithoModel: makeLithoModel(),
        activeGeotechModel: makeGeotechModel(),
        selectedSectionId: null,
        handleDivideBoreholes,
      }),
    )
    expect(screen.getByTestId('geotech-divide-boreholes')).toBeDisabled()
    fireEvent.click(screen.getByTestId('geotech-divide-boreholes'))
    expect(handleDivideBoreholes).not.toHaveBeenCalled()
  })

  it('BE4 — button is absent on the geology axis', () => {
    renderToolbar(makeCtx({ sectionModelAxis: 'geological' }))
    expect(screen.queryByTestId('geotech-divide-boreholes')).toBeNull()
  })

  it('BE4b — button is absent on the lithostratigraphic axis', () => {
    renderToolbar(
      makeCtx({
        sectionModelAxis: 'lithostratigraphic',
        activeLithoModel: makeLithoModel(),
      }),
    )
    expect(screen.queryByTestId('geotech-divide-boreholes')).toBeNull()
  })
})


// ---------------------------------------------------------------------------
// F — the "hatched = preview" legend
// ---------------------------------------------------------------------------
//
// The legend exists to name what the hatched ghost bands over undivided
// boreholes are, and to say which verb commits them (owner dogfeed 2026-08-04).
// It must therefore appear under exactly the condition the ghosts appear under
// — a borehole with no committed geotech band — and carry no permanent toolbar
// weight once every borehole is divided.
//
//   BF1  Shown when a borehole on the section has no committed geotech band.
//   BF2  Hidden once that borehole carries a committed band (nothing hatched).
//   BF3  Hidden off the geotech axis.

function makeSection(): CrossSectionResponse {
  return {
    id: 'section-1',
    app_project_id: 'proj-1',
    name: 'CS1',
    start_x: 0,
    start_y: 0,
    end_x: 1000,
    end_y: 0,
    epsg: 31370,
    projection_buffer_m: 100,
    excluded_cpt_ids: [],
    excluded_borehole_ids: [],
    seeded_formation_contact_ids: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  } as unknown as CrossSectionResponse
}

function makeBorehole(id: string): BoreholeListItem {
  return {
    id,
    name: id,
    test_id: id,
    location_x: 500,
    location_y: 0,
    epsg: 31370,
    elevation_m: 5,
  } as unknown as BoreholeListItem
}

function makeGeotechBand(boreholeId: string): LithoLayerResponse {
  return {
    id: `layer-${boreholeId}`,
    model_id: 'model-geotech-1',
    formation_id: 'formation-1',
    cpt_id: null,
    borehole_id: boreholeId,
    depth_top_m: 0,
    depth_base_m: 4,
    status: 'accepted',
    source: 'segmenter',
    confidence: 'high',
    body_id: 'body-1',
  } as unknown as LithoLayerResponse
}

// The legend explains hatching, so it must track the hatching itself — not a
// toolbar-side approximation of it. The overlay publishes what it drew to
// geotechPreviewRenderStore and the legend is gated on that; these cases drive
// the store rather than the investigation list.
describe('SectionsToolbar preview legend (F)', () => {
  const GEOTECH_CTX = {
    sectionModelAxis: 'geotechnical' as const,
    sections: [makeSection()],
    selectedSectionId: 'section-1',
    visibleBoreholes: [makeBorehole('bh-1')],
    geotechLayers: [],
  }

  beforeEach(resetGeotechPreviewRender)
  afterEach(resetGeotechPreviewRender)

  it('BF1 — shown when ghosts are actually on screen', () => {
    publishGeotechPreviewRender({ columnCount: 1, bandCount: 3, clampedBandCount: 0 })
    renderInspector(
      makeCtx({
        ...GEOTECH_CTX,
        activeLithoModel: makeLithoModel(),
        activeGeotechModel: makeGeotechModel(),
      }),
    )
    expect(screen.getByTestId('geotech-preview-legend')).toBeTruthy()
  })

  it('BF2 — hidden once every borehole carries a committed band', () => {
    // The overlay draws nothing for a divided column, so it publishes nothing.
    publishGeotechPreviewRender({ columnCount: 0, bandCount: 0, clampedBandCount: 0 })
    renderInspector(
      makeCtx({
        ...GEOTECH_CTX,
        activeLithoModel: makeLithoModel(),
        activeGeotechModel: makeGeotechModel(),
        geotechLayers: [makeGeotechBand('bh-1')],
      }),
    )
    expect(screen.queryByTestId('geotech-preview-legend')).toBeNull()
  })

  it('BF3 — hidden off the geotech axis', () => {
    publishGeotechPreviewRender({ columnCount: 1, bandCount: 3, clampedBandCount: 0 })
    renderInspector(
      makeCtx({
        ...GEOTECH_CTX,
        sectionModelAxis: 'lithostratigraphic',
        activeLithoModel: makeLithoModel(),
        activeGeotechModel: makeGeotechModel(),
      }),
    )
    expect(screen.queryByTestId('geotech-preview-legend')).toBeNull()
  })

  it('BF4 — hidden when the preview drew nothing, however undivided the boreholes look', () => {
    // The old gate recomputed "is any in-corridor borehole missing a band" and
    // said "Hatched = preview" next to an empty axis whenever the overlay had
    // declined to draw — no collar elevation, still loading, or the request
    // failed and the error toast was already up.
    renderInspector(
      makeCtx({
        ...GEOTECH_CTX,
        activeLithoModel: makeLithoModel(),
        activeGeotechModel: makeGeotechModel(),
      }),
    )
    expect(screen.queryByTestId('geotech-preview-legend')).toBeNull()
  })

  it('BF5 — says so when a planned band is outside the depth window', () => {
    // A planned band with no pixels must not read as "nothing planned there".
    publishGeotechPreviewRender({ columnCount: 1, bandCount: 2, clampedBandCount: 3 })
    renderInspector(
      makeCtx({
        ...GEOTECH_CTX,
        activeLithoModel: makeLithoModel(),
        activeGeotechModel: makeGeotechModel(),
      }),
    )
    expect(screen.getByTestId('geotech-preview-clamped').textContent).toContain('3')
  })
})
