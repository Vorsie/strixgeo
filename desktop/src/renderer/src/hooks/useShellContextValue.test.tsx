// Net for the debt #12 shellContextValue extraction + debt #53.
//
// This memo's failure modes are invisible to every other check:
// smoke catches mount crashes/TDZ, tsc catches missing names, the
// unit suite mocks the context. A dropped dep → silently stale
// context app-wide; an unstable/extra dep → recompute-every-render
// (the S7 render-loop class). This renderHook contract pins all
// three risks BEFORE the extraction wires into App.tsx:
//
//   T1 assembly  — every slice is nested correctly (a relocation slip
//                  mis-wiring a field fails here).
//   T2 no-stale  — changing one field in each slice across rerenders
//                  is reflected in the output (a dropped dep fails).
//   T3 stability — identical input refs → identical output ref (an
//                  over-eager / unstable dep fails).
//
// Lightweight: renderHook only, no DOM / Cesium / Leaflet.

import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { ShellContextValue } from '../shell/ShellContext'
import {
  useShellContextValue,
  type UseShellContextValueArgs,
} from './useShellContextValue'

const noopAsync = (): Promise<void> => Promise.resolve()

// A full, typed ShellContextValue stub — tsc enforces completeness, so
// if a slice gains a field the build breaks here too (intentional).
function makeCtx(): ShellContextValue {
  return {
    project: {
      id: 'p1',
      name: 'P',
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
      activeLithoModel: null,
      handleCreateLithoModel: async () => null,
      handleActivateLithoModel: async () => {},
      lithoContacts: [],
      lithoFormations: [],
      lithoSurfacesByFormationId: new Map(),
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
      handleAutoPopulateFromStratigraphy: noopAsync,
      handleDedupeContacts: () => Promise.resolve(0),
      handleRebuildSurfaces: noopAsync,
      handleExportModelPlaxis3d: noopAsync,
      handleToggleBoreholeInModel: noopAsync,
      discardContacts: vi.fn(),
      discoverBoreholeFormations: () => Promise.resolve([]),
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
    },
    sections: {
      sections: [],
      selectedSectionId: null,
      drawingSection: false,
      focusedContactIds: [],
      visibleSections: [],
      effectiveHorizontalEpsg: 31370,
      sectionModelAxis: 'geological' as const,
      setSectionModelAxis: vi.fn(),
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

// Flatten a ShellContextValue into the hook's flat arg shape (the
// inverse of what the hook assembles). tsc verifies this satisfies
// UseShellContextValueArgs exactly.
function toArgs(c: ShellContextValue): UseShellContextValueArgs {
  return {
    project: c.project,
    ...c.lifecycle,
    ...c.investigations,
    visibleCpts: c.visibleCpts,
    visibleBoreholes: c.visibleBoreholes,
    geo: c.geoModel,
    ...c.sections,
    ...c.overlays,
    toasts: c.toasts.toasts,
    toast: c.toasts.toast,
    undoStack: c.undo,
    ready: c.boot.ready,
    apiError: c.boot.apiError,
    mapState: c.mapState,
    ...c.coordinator,
  }
}

describe('useShellContextValue (debt #12 net / #53)', () => {
  it('T1 assembles every slice with correct nesting', () => {
    const c = makeCtx()
    const { result } = renderHook(() => useShellContextValue(toArgs(c)))
    const v = result.current
    // project cast-through + whole-object passthroughs.
    expect(v.project).toBe(c.project)
    expect(v.geoModel).toBe(c.geoModel)
    expect(v.undo).toBe(c.undo)
    expect(v.mapState).toBe(c.mapState)
    // representative re-nested fields per assembled slice.
    expect(v.lifecycle.saveProject).toBe(c.lifecycle.saveProject)
    expect(v.lifecycle.handleCloseProjectRequest).toBe(
      c.lifecycle.handleCloseProjectRequest,
    )
    expect(v.investigations.handleRemoveCpts).toBe(
      c.investigations.handleRemoveCpts,
    )
    expect(v.sections.handleSelectSection).toBe(c.sections.handleSelectSection)
    expect(v.overlays.demOverlay).toBe(c.overlays.demOverlay)
    expect(v.toasts.toast).toBe(c.toasts.toast)
    expect(v.boot.ready).toBe(true)
    expect(v.coordinator.handleSelect).toBe(c.coordinator.handleSelect)
    expect(v.coordinator.setSelectedId).toBe(c.coordinator.setSelectedId)
  })

  it('T2 reflects a changed field in each major slice (no-stale)', () => {
    const c = makeCtx()
    const { result, rerender } = renderHook(
      (a: UseShellContextValueArgs) => useShellContextValue(a),
      { initialProps: toArgs(c) },
    )
    const before = result.current

    // Change one leaf per slice; pass a fresh args object whose other
    // refs are unchanged. The memo MUST recompute (these are deps).
    const c2 = makeCtx()
    c2.project = { ...c.project, name: 'RENAMED' }
    c2.lifecycle = { ...c.lifecycle, projectDirty: true }
    c2.investigations = { ...c.investigations, importing: true }
    c2.sections = { ...c.sections, selectedSectionId: 'sec-9' }
    c2.overlays = { ...c.overlays, showOverlayOnCpt: true }
    c2.boot = { ...c.boot, ready: false }
    c2.coordinator = { ...c.coordinator, selectedId: 'cpt-9' }
    rerender(toArgs(c2))

    const after = result.current
    expect(after).not.toBe(before) // recomputed
    expect(after.project?.name).toBe('RENAMED')
    expect(after.lifecycle.projectDirty).toBe(true)
    expect(after.investigations.importing).toBe(true)
    expect(after.sections.selectedSectionId).toBe('sec-9')
    expect(after.overlays.showOverlayOnCpt).toBe(true)
    expect(after.boot.ready).toBe(false)
    expect(after.coordinator.selectedId).toBe('cpt-9')
  })

  it('T3 is referentially stable when inputs are unchanged (no over-recompute)', () => {
    const args = toArgs(makeCtx())
    const { result, rerender } = renderHook(
      (a: UseShellContextValueArgs) => useShellContextValue(a),
      { initialProps: args },
    )
    const first = result.current
    // Same arg object, same refs → memo must NOT recompute.
    rerender(args)
    expect(result.current).toBe(first)
  })
})
