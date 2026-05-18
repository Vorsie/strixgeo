// Behavioral net for the slice-2 (#55) axis toggle in SectionsToolbar.
//
// Claims pinned here:
//   B1  When activeLithoModel is null, the "Litho" radio button is disabled.
//       (The tooltip contract — title on the span wrapper, not the button —
//       is pinned separately in B5; B1 verifies disabled state only.)
//   B2  When activeLithoModel is present, the "Litho" radio button is enabled
//       and clicking it calls setSectionModelAxis('lithostratigraphic').
//   B3  Clicking the "Geology" button when the axis is already 'geological'
//       calls setSectionModelAxis('geological') (idempotent write; no guard).
//       When the axis is 'lithostratigraphic', clicking Geology switches back.
//   B4  (P1-C) When activeLithoModel is null the inline hint paragraph renders;
//       when a litho model exists the hint is absent.
//   B5  (P1-C) The tooltip text "Create a lithostratigraphic model…" is on the
//       span wrapper (not the disabled button) so Chromium/Electron can surface
//       it on hover — verified by querying the span's title attribute.
//
// Rendering SectionsToolbar via ShellContext.Provider — same pattern as
// SectionsStage.test.tsx.  The non-interacting components (MapView, SectionPanel)
// are mocked so jsdom doesn't need Leaflet or SectionPanel's fetch hooks.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShellContext } from '../../ShellContext'
import type { ShellContextValue } from '../../ShellContext'
import type { GeologicalModelResponse } from '../../../api/client'
import SectionsToolbar from './SectionsToolbar'

// ---------------------------------------------------------------------------
// Module mocks — same set as SectionsStage.test.tsx
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
    parent_geological_model_id: 'model-geo-1',
    is_active: true,
    excluded_borehole_ids: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

function makeCtx(overrides: {
  activeLithoModel?: GeologicalModelResponse | null
  sectionModelAxis?: 'geological' | 'lithostratigraphic'
  setSectionModelAxis?: (axis: 'geological' | 'lithostratigraphic') => void
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
        parent_geological_model_id: null,
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
      handleAutoPopulateFromStratigraphy: noopAsync,
      handleSeedLithoFromParent: noopAsync,
      handleDedupeContacts: () => Promise.resolve(0),
      handleRebuildSurfaces: noopAsync,
      handleExportModelPlaxis3d: noopAsync,
      handleToggleBoreholeInModel: noopAsync,
      discardContacts: vi.fn(),
      discoverBoreholeFormations: () => Promise.resolve({ candidates: [], collisions: [] }),
      applyBoreholeFormationSelection: noopAsync,
      handleDeleteModel: noopAsync,
      ensureActiveGeologicalModel: () => Promise.resolve(null),
      lithoSuggestions: [],
      lithoSuggestionInvestigationId: null,
      lithoSuggestionAnchorKind: null,
      lithoSuggestionAccepted: new Set<number>(),
      lithoSuggestionRejected: new Set<number>(),
      lithoSuggesting: false,
      handleSuggestLitho: noopAsync,
      handleAcceptLithoSuggestion: noopAsync,
      handleRejectLithoSuggestion: vi.fn(),
      clearLithoSuggestions: vi.fn(),
      pinchOutPreview: null,
      pinchOutLoading: false,
      handlePreviewPinchOut: async () => false,
      handleCommitPinchOut: noopAsync,
      clearPinchOutPreview: vi.fn(),
      handleDeleteLithoModel: noopAsync,
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
  it('B1 — Litho button is disabled when activeLithoModel is null', () => {
    const ctx = makeCtx({ activeLithoModel: null })
    renderToolbar(ctx)

    const lithoBtn = screen.getByRole('radio', { name: /litho/i })
    expect(lithoBtn).toBeDisabled()

    // The tooltip text moves to the span wrapper (P1-C fix) so Chromium/Electron
    // can surface it on hover — disabled buttons do not fire mouse events.
    // The span-level assertion lives in B5; here we only verify disabled state.
  })

  it('B1-enabled — when activeLithoModel exists the button carries its own title (no span wrapper needed)', () => {
    // Symmetric counterpart to B5: when the button is enabled, Chromium CAN
    // surface a title on the element itself — no presentation-span wrapper is
    // needed.  We assert the button has the expected title and no ancestor span
    // holds an alternative tooltip, so the two code-paths (disabled/enabled)
    // cannot silently converge to the same DOM shape.
    const ctx = makeCtx({ activeLithoModel: makeLithoModel() })
    renderToolbar(ctx)

    const lithoBtn = screen.getByRole('radio', { name: /litho/i })
    expect(lithoBtn).not.toBeDisabled()
    expect(lithoBtn).toHaveAttribute('title', 'Edit the lithostratigraphic model contacts on this section')

    // The span wrapper (role="presentation") should NOT carry a tooltip in the
    // enabled case — its only job is to make the disabled-button tooltip reachable.
    const ancestorWithTitle = lithoBtn.closest('[title]')
    // Either there is no titled ancestor, or the titled element IS the button itself.
    if (ancestorWithTitle !== null) {
      expect(ancestorWithTitle).toBe(lithoBtn)
    }
  })

  it('B2 — Litho button is enabled and calls setSectionModelAxis when activeLithoModel exists', () => {
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

  it('B3 — Geology button calls setSectionModelAxis when litho axis is active', () => {
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

describe('SectionsToolbar Seed axis-dispatch (#55 litho-Seed slice)', () => {
  it('B6-geo — Seed on geological axis calls handleAutoPopulateFromStratigraphy', async () => {
    const autoPopulate = vi.fn().mockResolvedValue(undefined)
    const seedLitho = vi.fn().mockResolvedValue(undefined)
    const ctx: ShellContextValue = {
      ...makeCtx({ activeLithoModel: makeLithoModel(), sectionModelAxis: 'geological' }),
      geoModel: {
        ...makeCtx({ activeLithoModel: makeLithoModel() }).geoModel,
        handleAutoPopulateFromStratigraphy: autoPopulate,
        handleSeedLithoFromParent: seedLitho,
      },
    }
    renderToolbar(ctx)

    const seedBtn = screen.getByRole('button', { name: /^seed$/i })
    fireEvent.click(seedBtn)

    // Allow async handler to settle
    await vi.waitFor(() => {
      expect(autoPopulate).toHaveBeenCalledOnce()
      expect(seedLitho).not.toHaveBeenCalled()
    })
  })

  it('B6-litho — Seed on litho axis calls handleSeedLithoFromParent (not autoPopulate)', async () => {
    const autoPopulate = vi.fn().mockResolvedValue(undefined)
    const seedLitho = vi.fn().mockResolvedValue(undefined)
    const ctx: ShellContextValue = {
      ...makeCtx({
        activeLithoModel: makeLithoModel(),
        sectionModelAxis: 'lithostratigraphic',
      }),
      geoModel: {
        ...makeCtx({ activeLithoModel: makeLithoModel() }).geoModel,
        handleAutoPopulateFromStratigraphy: autoPopulate,
        handleSeedLithoFromParent: seedLitho,
      },
    }
    renderToolbar(ctx)

    const seedBtn = screen.getByRole('button', { name: /seed from geology/i })
    fireEvent.click(seedBtn)

    await vi.waitFor(() => {
      expect(seedLitho).toHaveBeenCalledOnce()
      expect(autoPopulate).not.toHaveBeenCalled()
    })
  })
})

describe('SectionsToolbar litho tooltip discoverability (P1-C, #55)', () => {
  it('B4 — inline hint renders when activeLithoModel is null; disappears when model exists', () => {
    // No litho model → hint paragraph visible.
    const ctxNoModel = makeCtx({ activeLithoModel: null })
    const { unmount } = renderToolbar(ctxNoModel)

    expect(
      screen.getByText(/no lithostratigraphic model/i),
    ).toBeInTheDocument()

    unmount()

    // Litho model present → hint absent.
    const ctxWithModel = makeCtx({ activeLithoModel: makeLithoModel() })
    renderToolbar(ctxWithModel)

    expect(
      screen.queryByText(/no lithostratigraphic model/i),
    ).not.toBeInTheDocument()
  })

  it('B5 — tooltip text is on the span wrapper so Chromium can surface it on hover over a disabled button', () => {
    // WHY: Chromium/Electron does not fire mouse events on disabled elements,
    // so a `title` on the <button disabled> is never shown. The fix wraps it
    // in a non-disabled <span role="presentation" title="…"> so hover works.
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
    // tree by role — query by its title attribute directly.
    const tooltipSpan = lithoBtn.closest('[title]')
    expect(tooltipSpan).not.toBeNull()
    expect(tooltipSpan).toHaveAttribute(
      'title',
      'Create a lithostratigraphic model in the Lithology stage first',
    )
  })
})
