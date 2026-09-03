// Behavioral net for the slice-2 (#55) axis toggle in SectionsToolbar.
//
// Claims pinned here:
//   B1  When activeLithoModel is null, the "Litho" radio button is disabled.
//       (The tooltip contract â€” title on the span wrapper, not the button â€”
//       is pinned separately in B5; B1 verifies disabled state only.)
//   B2  When activeLithoModel is present, the "Litho" radio button is enabled
//       and clicking it calls setSectionModelAxis('lithostratigraphic').
//   B3  Clicking the "Geology" button when the axis is already 'geological'
//       calls setSectionModelAxis('geological') (idempotent write; no guard).
//       When the axis is 'lithostratigraphic', clicking Geology switches back.
//   B4  (P1-C) When activeLithoModel is null the inline hint paragraph renders;
//       when a litho model exists the hint is absent.
//   B5  (P1-C) The tooltip text "Create a lithostratigraphic modelâ€¦" is on the
//       span wrapper (not the disabled button) so Chromium/Electron can surface
//       it on hover â€” verified by querying the span's title attribute.
//
// Rendering SectionsToolbar via ShellContext.Provider â€” same pattern as
// SectionsStage.test.tsx.  The non-interacting components (MapView, SectionPanel)
// are mocked so jsdom doesn't need Leaflet or SectionPanel's fetch hooks.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShellContext } from '../../ShellContext'
import type { ShellContextValue } from '../../ShellContext'
import type { GeologicalModelResponse } from '../../../api/client'
import SectionsToolbar from './SectionsToolbar'

// ---------------------------------------------------------------------------
// Module mocks â€” same set as SectionsStage.test.tsx
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
// Stub context factory
// ---------------------------------------------------------------------------

const noopAsync = (): Promise<void> => Promise.resolve()
const noopAsyncNull = (): Promise<null> => Promise.resolve(null)

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
  activeLithoModel?: GeologicalModelResponse | null
  sectionModelAxis?: 'geological' | 'lithostratigraphic' | 'geotechnical'
  setSectionModelAxis?: (axis: 'geological' | 'lithostratigraphic' | 'geotechnical') => void
  sectionFocusedColumn?: { kind: 'cpt' | 'borehole'; id: string; name: string } | null
  selectedSectionId?: string | null
  lithoStaleSurfaceCount?: number
  handleRebuildLithoSurfaces?: () => Promise<void>
  // Phase 2 of debt #77: bus exposes the unified Map + focus flag.
  // ``ghostsByAnchor`` is what consumers (SectionsToolbar) read for
  // "has suggestions" + bulk-anchor count. Tests that want a populated
  // ghost set can populate via ``ghostsByAnchor`` directly OR pass a
  // ``lithoSuggestions`` array â€” the helper wraps the array into a
  // synthetic single-anchor entry under a hard-coded id so existing
  // call sites that pre-date Phase 2 keep working.
  ghostsByAnchor?: ReadonlyMap<string, import('../../../hooks/useGeologicalModel').BulkAnchorGhost>
  focusedSuggestAnchorId?: string | null
  lithoSuggestions?: import('../../../api/client').LithoLayerSuggestion[]
  handleAcceptAllLithoSuggestions?: () => Promise<void>
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
    visibleBoreholes: [],
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
      // Phase 2 of debt #77 compat shim: ``lithoSuggestions`` override
      // wraps the array into a synthetic ghost entry so BL1-BL3 tests
      // can populate "the focused anchor has N suggestions" without
      // restating the full Map shape per test.
      ghostsByAnchor:
        overrides.ghostsByAnchor ??
        (overrides.lithoSuggestions && overrides.lithoSuggestions.length > 0
          ? new Map([
              [
                'test-focused-anchor',
                {
                  kind: 'cpt' as const,
                  suggestions: overrides.lithoSuggestions,
                  surfaceElevationM: null,
                  accepted: new Set<number>(),
                  rejected: new Set<number>(),
                  edits: new Map(),
                },
              ],
            ])
          : new Map()),
      // Recovery-only setter (docs/design/autosave-recovery.md §2, item 2).
      setGhostsByAnchor: () => {},
      focusedSuggestAnchorId:
        overrides.focusedSuggestAnchorId ??
        (overrides.lithoSuggestions && overrides.lithoSuggestions.length > 0
          ? 'test-focused-anchor'
          : null),
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
      handleAcceptAllLithoSuggestions: overrides.handleAcceptAllLithoSuggestions ?? noopAsync,
      handleRejectLithoSuggestion: vi.fn(),
      handleUnrejectLithoSuggestion: vi.fn(),
      clearLithoSuggestions: vi.fn(),
      handleDeleteLithoModel: noopAsync,
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
      geotechSolids: [],
      geotechSolidsLoading: false,
      geotechSolidsBuilding: false,
      hasGeotechSolids: false,
      hasStaleGeotechSolid: false,
      buildGeotechSolids: noopAsync,
      setGeotechBodyColor: vi.fn(),
      geotechHideMarkers: false,
      setGeotechHideMarkers: vi.fn(),
      geotechGaplessReport: null,
      // Debt #266 — geotech columns standing on litho that has since moved.
      staleLithoGeotechColumns: [],
      staleLithoGeotechColumnIds: new Set<string>(),
      staleLithoGeotechColumnCount: 0,
      unstampedGeotechColumnCount: 0,
      refreshGeotechLithoStaleness: vi.fn(),
      lithoStaleSurfaceCount: overrides.lithoStaleSurfaceCount ?? 0,
      handleRebuildLithoSurfaces: overrides.handleRebuildLithoSurfaces ?? noopAsync,
      handleAutoCorrelate: noopAsync,
      handleClearSuggestions: noopAsync,
      lithoCrossingPinchOuts: [],
      activeGeotechModel: null,
      geotechLayers: [],
      geotechLayersLoaded: true,
      geotechLayersVersion: 0,
      geotechContacts: [],
      geotechFormations: [],
      columnsNeedingRederive: [],
      handleCreateManualLithoGhost: vi.fn(),
      handleExtendLithoGhostToNearestContacts: vi.fn(() => ({ ok: true })),
      markMutated: vi.fn(),
      // F4 — stub so the interface is satisfied; not exercised in axis tests.
      handleSubdivideAllBodies: noopAsync,
      handleDivideBoreholes: noopAsync,
      requestGeotechLayersRefetch: vi.fn(),
    },
    sections: {
      sections: overrides.selectedSectionId
        ? [{ id: overrides.selectedSectionId, name: 'Section A' } as import('../../../api/client').CrossSectionResponse]
        : [],
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
      sectionFocusedColumn: overrides.sectionFocusedColumn ?? null,
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
  }
}

function renderToolbar(ctx: ShellContextValue) {
  return render(
    <ShellContext.Provider value={ctx}>
      <SectionsToolbar />
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

describe('SectionsToolbar axis toggle (slice 2, #55)', () => {
  it('B1 â€” Litho button is disabled when activeLithoModel is null', () => {
    const ctx = makeCtx({ activeLithoModel: null })
    renderToolbar(ctx)

    const lithoBtn = screen.getByRole('radio', { name: /litho/i })
    expect(lithoBtn).toBeDisabled()

    // The tooltip text moves to the span wrapper (P1-C fix) so Chromium/Electron
    // can surface it on hover â€” disabled buttons do not fire mouse events.
    // The span-level assertion lives in B5; here we only verify disabled state.
  })

  it('B1-enabled â€” when activeLithoModel exists the button carries its own title (no span wrapper needed)', () => {
    // Symmetric counterpart to B5: when the button is enabled, Chromium CAN
    // surface a title on the element itself â€” no presentation-span wrapper is
    // needed.  We assert the button has the expected title and no ancestor span
    // holds an alternative tooltip, so the two code-paths (disabled/enabled)
    // cannot silently converge to the same DOM shape.
    const ctx = makeCtx({ activeLithoModel: makeLithoModel() })
    renderToolbar(ctx)

    const lithoBtn = screen.getByRole('radio', { name: /litho/i })
    expect(lithoBtn).not.toBeDisabled()
    expect(lithoBtn).toHaveAttribute('title', 'Edit the lithostratigraphic model contacts on this section')

    // The span wrapper (role="presentation") should NOT carry a tooltip in the
    // enabled case â€” its only job is to make the disabled-button tooltip reachable.
    const ancestorWithTitle = lithoBtn.closest('[title]')
    // Either there is no titled ancestor, or the titled element IS the button itself.
    if (ancestorWithTitle !== null) {
      expect(ancestorWithTitle).toBe(lithoBtn)
    }
  })

  it('B2 â€” Litho button is enabled and calls setSectionModelAxis when activeLithoModel exists', () => {
    const setSectionModelAxis = vi.fn()
    const ctx = makeCtx({
      activeLithoModel: makeLithoModel(),
      setSectionModelAxis,
    })
    renderToolbar(ctx)

    const lithoBtn = screen.getByRole('radio', { name: /litho/i })
    expect(lithoBtn).not.toBeDisabled()

    fireEvent.click(lithoBtn)
    expect(setSectionModelAxis).toHaveBeenCalledWith('lithostratigraphic')
  })

  it('B3 â€” Geology button calls setSectionModelAxis when litho axis is active', () => {
    const setSectionModelAxis = vi.fn()
    const ctx = makeCtx({
      activeLithoModel: makeLithoModel(),
      sectionModelAxis: 'lithostratigraphic',
      setSectionModelAxis,
    })
    renderToolbar(ctx)

    // Geology radio is NOT checked (axis is litho)
    const geoBtn = screen.getByRole('radio', { name: /geology/i })
    expect(geoBtn).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(geoBtn)
    expect(setSectionModelAxis).toHaveBeenCalledWith('geological')
  })
})

// B6-geo / B6-litho â€” moved to SectionsInspector.test.tsx (debt #97):
// Seed and Sync geology are now Model-actions row buttons in the
// inspector, not toolbar widgets. The new tests assert the same
// dispatch (autoPopulate on geology axis, loadBackdrop on litho axis)
// against the inspector surface.

describe('SectionsToolbar litho tooltip discoverability (P1-C, #55)', () => {
  it('B4 â€” inline hint renders when activeLithoModel is null; disappears when model exists', () => {
    // No litho model â†’ hint paragraph visible.
    const ctxNoModel = makeCtx({ activeLithoModel: null })
    const { unmount } = renderToolbar(ctxNoModel)

    expect(
      screen.getByText(/no lithostratigraphic model/i),
    ).toBeInTheDocument()

    unmount()

    // Litho model present â†’ hint absent.
    const ctxWithModel = makeCtx({ activeLithoModel: makeLithoModel() })
    renderToolbar(ctxWithModel)

    expect(
      screen.queryByText(/no lithostratigraphic model/i),
    ).not.toBeInTheDocument()
  })

  it('B5 â€” tooltip text is on the span wrapper so Chromium can surface it on hover over a disabled button', () => {
    // WHY: Chromium/Electron does not fire mouse events on disabled elements,
    // so a `title` on the <button disabled> is never shown. The fix wraps it
    // in a non-disabled <span role="presentation" title="â€¦"> so hover works.
    // We verify the span carries the title (not the button) so this contract
    // cannot silently regress back to the button-only form.
    const ctx = makeCtx({ activeLithoModel: null })
    renderToolbar(ctx)

    const lithoBtn = screen.getByRole('radio', { name: /litho/i })
    expect(lithoBtn).toBeDisabled()

    // The button itself must NOT carry the tooltip (it would be invisible
    // on hover in Chromium when disabled).
    expect(lithoBtn).not.toHaveAttribute('title')

    // The span wrapper must carry the tooltip text.
    // The span has role="presentation" so it is not in the accessibility
    // tree by role â€” query by its title attribute directly.
    const tooltipSpan = lithoBtn.closest('[title]')
    expect(tooltipSpan).not.toBeNull()
    expect(tooltipSpan).toHaveAttribute(
      'title',
      'Create a lithostratigraphic model in the Lithology stage first',
    )
  })
})

// ---------------------------------------------------------------------------
// Part 1: litho-axis canSuggest + handleSuggest use sectionFocusedColumn
// ---------------------------------------------------------------------------

describe('SectionsToolbar litho Suggest â€” section-focused column (Part 1)', () => {
  // S1: "Suggest litho" is DISABLED when sectionFocusedColumn is null on the
  // litho axis, even when a CPT is globally selected in the coordinator.
  it('S1 â€” Suggest is disabled when no column is focused in the section (litho axis)', () => {
    const ctx: ShellContextValue = {
      ...makeCtx({
        activeLithoModel: makeLithoModel(),
        sectionModelAxis: 'lithostratigraphic',
        sectionFocusedColumn: null,
        selectedSectionId: 'sec-1',
      }),
      // Global coordinator has a selected CPT â€” must NOT enable Suggest on litho axis.
      coordinator: {
        ...makeCtx().coordinator,
        selectedId: 'cpt-99',
        selectedBoreholeId: null,
      },
    }
    renderToolbar(ctx)
    // After the 2026-05-23 SplitToolbarButton fall-through fix, the
    // "disabled" primary acts as a click target that opens the caret
    // dropdown â€” the user can still reach the bulk variants without
    // aiming for the small â–¾. So the button is NOT truly disabled,
    // but its title carries the "click for options" hint and it
    // visually reads as muted-but-clickable.
    const suggestBtn = screen.getByTestId('litho-suggest')
    expect(suggestBtn).not.toBeDisabled()
    expect(suggestBtn).toHaveAttribute('title', expect.stringMatching(/click for options/i))
  })

  // S2: "Suggest litho" is ENABLED when a column is focused in the section on
  // the litho axis (sectionFocusedColumn is set), even when nothing is globally
  // selected in the coordinator.
  it('S2 â€” Suggest is enabled when a column is focused in the section (litho axis)', () => {
    const ctx = makeCtx({
      activeLithoModel: makeLithoModel(),
      sectionModelAxis: 'lithostratigraphic',
      sectionFocusedColumn: { kind: 'cpt', id: 'cpt-1', name: 'CPT-1' },
      selectedSectionId: 'sec-1',
    })
    renderToolbar(ctx)
    const suggestBtn = screen.getByTestId('litho-suggest')
    expect(suggestBtn).not.toBeDisabled()
  })

  // S3: clicking "Suggest litho" calls handleSuggestLitho with the SECTION-
  // FOCUSED column's kind and id (not the global coordinator selection).
  it('S3 â€” Suggest calls handleSuggestLitho with the focused column kind + id', async () => {
    const suggestLitho = vi.fn().mockResolvedValue(undefined)
    const ctx: ShellContextValue = {
      ...makeCtx({
        activeLithoModel: makeLithoModel(),
        sectionModelAxis: 'lithostratigraphic',
        sectionFocusedColumn: { kind: 'borehole', id: 'bh-42', name: 'BH-42' },
        selectedSectionId: 'sec-1',
      }),
      geoModel: {
        ...makeCtx({ activeLithoModel: makeLithoModel() }).geoModel,
        handleSuggestLitho: suggestLitho,
      },
    }
    renderToolbar(ctx)
    const suggestBtn = screen.getByTestId('litho-suggest')
    fireEvent.click(suggestBtn)
    await vi.waitFor(() => {
      expect(suggestLitho).toHaveBeenCalledWith('borehole', 'bh-42')
    })
  })

  // S4: on the GEOLOGICAL axis, canSuggest still uses the global coordinator
  // selection (selectedId / selectedBoreholeId) â€” zero regression.
  it('S4 â€” geological axis: Suggest is disabled when coordinator has no selection', () => {
    const ctx = makeCtx({
      activeLithoModel: makeLithoModel(),
      sectionModelAxis: 'geological',
      sectionFocusedColumn: { kind: 'cpt', id: 'cpt-1', name: 'CPT-1' },
      selectedSectionId: 'sec-1',
    })
    renderToolbar(ctx)
    // On the geo axis the Suggest split-button block is not rendered
    // at all (it is guarded by {isLitho && ...}).
    expect(screen.queryByTestId('litho-suggest')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Slice B: Accept all button + Build litho relocation (Phase 1 accept flow)
// ---------------------------------------------------------------------------
// Note: "Build litho" was REMOVED from SectionsToolbar in Phase 1 (it moved
// to LithologyToolbar). BL1â€“BL4 now test the "Accept all" button that
// replaced it on the litho axis when suggestions are present.
// ---------------------------------------------------------------------------

describe('SectionsToolbar Accept all button (Phase 1 litho accept flow)', () => {
  // BL1: "Accept all" is visible and enabled on the litho axis when there
  // are pending litho suggestions.
  it('BL1 â€” Accept all button is visible and enabled when suggestions present', () => {
    const ctx = makeCtx({
      activeLithoModel: makeLithoModel(),
      sectionModelAxis: 'lithostratigraphic',
      lithoSuggestions: [
        {
          depth_top_m: 0,
          depth_base_m: 2,
          suggested_lithology: 'ZAND',
          suggested_nad_class: null,
          mean_qc_mpa: null,
          dr_pct: null,
          confidence: 'medium' as const,
          source: 'robertson2015',
          suggested_admixtures: [],
          parent_formation_id: null,
          spans_boundary: false,
        },
      ],
    })
    renderToolbar(ctx)
    const acceptAllBtn = screen.getByRole('button', { name: /accept all/i })
    expect(acceptAllBtn).toBeInTheDocument()
    expect(acceptAllBtn).not.toBeDisabled()
  })

  // BL2: "Accept all" is absent when there are no suggestions (hasSuggestions=false).
  it('BL2 â€” Accept all button is absent when no suggestions', () => {
    const ctx = makeCtx({
      activeLithoModel: makeLithoModel(),
      sectionModelAxis: 'lithostratigraphic',
      lithoSuggestions: [],
    })
    renderToolbar(ctx)
    expect(screen.queryByRole('button', { name: /accept all/i })).not.toBeInTheDocument()
  })

  // BL3: Clicking "Accept all" calls handleAcceptAllLithoSuggestions.
  it('BL3 â€” clicking Accept all calls handleAcceptAllLithoSuggestions', async () => {
    const acceptAll = vi.fn().mockResolvedValue(undefined)
    const ctx = makeCtx({
      activeLithoModel: makeLithoModel(),
      sectionModelAxis: 'lithostratigraphic',
      lithoSuggestions: [
        {
          depth_top_m: 0,
          depth_base_m: 2,
          suggested_lithology: 'ZAND',
          suggested_nad_class: null,
          mean_qc_mpa: null,
          dr_pct: null,
          confidence: 'medium' as const,
          source: 'robertson2015',
          suggested_admixtures: [],
          parent_formation_id: null,
          spans_boundary: false,
        },
      ],
      handleAcceptAllLithoSuggestions: acceptAll,
    })
    renderToolbar(ctx)

    const acceptAllBtn = screen.getByRole('button', { name: /accept all/i })
    fireEvent.click(acceptAllBtn)

    await vi.waitFor(() => {
      expect(acceptAll).toHaveBeenCalledOnce()
    })
    // Regression (#57 class): the section-update callback MUST be the
    // 2nd arg, or the server-echoed seeded_formation_contact_ids is
    // dropped and the explicit-content filter hides every accepted
    // litho contact. This exact bug has recurred 3Ã— â€” pin it.
    expect(acceptAll.mock.calls[0][1]).toBe(ctx.sections.applyUpdatedSection)
  })

  // BL4: "Build litho" is absent from SectionsToolbar on the litho axis
  // (it moved to LithologyToolbar in Phase 1).
  it('BL4 â€” Build litho button is NOT in SectionsToolbar (moved to LithologyToolbar)', () => {
    const ctx = makeCtx({
      activeLithoModel: makeLithoModel(),
      sectionModelAxis: 'lithostratigraphic',
      lithoStaleSurfaceCount: 3,
    })
    renderToolbar(ctx)
    expect(screen.queryByRole('button', { name: /build litho/i })).not.toBeInTheDocument()
  })
})

describe('SectionsToolbar undo button (dogfeed 2026-05-22)', () => {
  it('U1 â€” Undo button is disabled when the undo stack is empty', () => {
    // makeCtx() defaults the undo stack to canUndo:false.
    renderToolbar(makeCtx())
    expect(screen.getByRole('button', { name: /^undo$/i })).toBeDisabled()
  })

  it('U2 â€” Undo button calls undo() when the stack has an entry', () => {
    const undo = vi.fn().mockResolvedValue(undefined)
    const ctx: ShellContextValue = {
      ...makeCtx(),
      undo: {
        push: vi.fn(),
        undo,
        redo: vi.fn(),
        clear: vi.fn(),
        canUndo: true,
        canRedo: false,
        busy: false,
      },
    }
    renderToolbar(ctx)
    const btn = screen.getByRole('button', { name: /^undo$/i })
    expect(btn).not.toBeDisabled()
    fireEvent.click(btn)
    expect(undo).toHaveBeenCalledTimes(1)
  })
})

describe('SectionsToolbar Admixtures dropdown (dogfeed 2026-05-22)', () => {
  const sampleSuggestion = {
    depth_top_m: 0,
    depth_base_m: 2,
    suggested_lithology: 'ZAND',
    suggested_nad_class: null,
    mean_qc_mpa: null,
    dr_pct: null,
    confidence: 'medium' as const,
    source: 'robertson2015',
    suggested_admixtures: [],
    parent_formation_id: null,
    spans_boundary: false,
  }

  it('A1 â€” Admixtures dropdown is disabled with no ghost suggestions', () => {
    const ctx = makeCtx({
      activeLithoModel: makeLithoModel(),
      sectionModelAxis: 'lithostratigraphic',
    })
    renderToolbar(ctx)
    expect(screen.getByRole('button', { name: /admixtures/i })).toBeDisabled()
  })

  it('A2 â€” Admixtures dropdown is enabled when ghost suggestions exist', () => {
    const ctx = makeCtx({
      activeLithoModel: makeLithoModel(),
      sectionModelAxis: 'lithostratigraphic',
      lithoSuggestions: [sampleSuggestion],
    })
    renderToolbar(ctx)
    expect(screen.getByRole('button', { name: /admixtures/i })).not.toBeDisabled()
  })

  it('A3 â€” "Strip all admixtures" calls handleStripLithoAdmixtures', () => {
    const strip = vi.fn()
    const ctx: ShellContextValue = {
      ...makeCtx({
        activeLithoModel: makeLithoModel(),
        sectionModelAxis: 'lithostratigraphic',
        lithoSuggestions: [sampleSuggestion],
      }),
      geoModel: {
        ...makeCtx({
          activeLithoModel: makeLithoModel(),
          lithoSuggestions: [sampleSuggestion],
        }).geoModel,
        handleStripLithoAdmixtures: strip,
      },
    }
    renderToolbar(ctx)
    fireEvent.click(screen.getByRole('button', { name: /admixtures/i }))
    fireEvent.click(screen.getByTestId('litho-strip-all'))
    expect(strip).toHaveBeenCalledWith('all')
  })
})

// ---------------------------------------------------------------------------
// Owner dogfeed 2026-08-26 — the axis pill read "Geology | Litho | Geote" on a
// fullscreen laptop. Root cause: the pill group carried `overflow-hidden`, and
// per CSS Flexbox §4.5 a flex item's automatic minimum size is min-content
// ONLY while its overflow is `visible` — so the pill's minimum collapsed to
// zero, flexbox picked it as the one item free to absorb the whole width
// deficit, and its own clip cut the last segment mid-word. These pins hold the
// fix and the guarantee it protects.
// ---------------------------------------------------------------------------

describe('SectionsToolbar axis pill — never truncated (owner dogfeed 2026-08-26)', () => {
  it('AP-SHRINK — the pill refuses to shrink, so flexbox can never cut a segment mid-word', () => {
    // This is THE root-cause fix. Without `shrink-0` the pill is the only
    // flex item with a zero automatic minimum, so it soaks up every pixel of
    // deficit on the row and clips itself.
    const { container } = renderToolbar(makeCtx({ activeLithoModel: makeLithoModel() }))
    const pill = container.querySelector('[role="group"][aria-label="Section model axis"]')
    expect(pill).not.toBeNull()
    expect(pill?.className, 'the axis pill must never be shrinkable').toContain('shrink-0')
  })

  it('AP-WORDS — every segment stays a whole word: no segment may wrap or be cut', () => {
    const { container } = renderToolbar(makeCtx({ activeLithoModel: makeLithoModel() }))
    const pill = container.querySelector('[role="group"][aria-label="Section model axis"]')
    const segments = [...(pill?.querySelectorAll('button') ?? [])]
    expect(segments.map(s => s.textContent)).toEqual(['Geology', 'Litho', 'Geotech'])
    for (const segment of segments) {
      expect(segment.className, `${segment.textContent ?? ''} may not wrap`).toContain(
        'whitespace-nowrap',
      )
    }
  })

  it('AP-NAME — the Geology segment keeps its full accessible name, so the short form never strands a user on "Geo"', () => {
    const { container } = renderToolbar(makeCtx({ activeLithoModel: makeLithoModel() }))
    const pill = container.querySelector('[role="group"][aria-label="Section model axis"]')
    const geology = pill?.querySelector('button')
    expect(geology?.getAttribute('aria-label')).toBe('Geology')
  })

  it('AP-REACH — every declared verb is reachable: nothing is dropped by the responsive row', () => {
    // The toolbar renders through ResponsiveToolbarRow now. In jsdom the
    // container measures 0 px, which the planner reads as "unmeasured" and
    // renders at full label — so the whole bar must still be present.
    renderToolbar(
      makeCtx({ activeLithoModel: makeLithoModel(), sectionModelAxis: 'lithostratigraphic' }),
    )
    for (const testid of [
      'sections-undo',
      'litho-suggest',
      'correlate-mode',
      'litho-bodies-dropdown',
      'litho-admixtures-dropdown',
      'suggest-tie-sections',
      'sections-toolbar-export-dropdown',
      'sections-recompute-bodies',
    ]) {
      expect(screen.queryByTestId(testid), `${testid} disappeared`).not.toBeNull()
    }
    // Nothing folded, so no ⋯ trigger.
    expect(screen.queryByTestId('toolbar-overflow-more')).toBeNull()
  })
})
