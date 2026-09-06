// Net for the debt #12 shellContextValue extraction + debt #53.
//
// This memo's failure modes are invisible to every other check:
// smoke catches mount crashes/TDZ, tsc catches missing names, the
// unit suite mocks the context. A dropped dep â†’ silently stale
// context app-wide; an unstable/extra dep â†’ recompute-every-render
// (the S7 render-loop class). This renderHook contract pins all
// three risks BEFORE the extraction wires into App.tsx:
//
//   T1 assembly  â€” every slice is nested correctly (a relocation slip
//                  mis-wiring a field fails here).
//   T2 no-stale  â€” changing one field in each slice across rerenders
//                  is reflected in the output (a dropped dep fails).
//   T3 stability â€” identical input refs â†’ identical output ref (an
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

// A full, typed ShellContextValue stub â€” tsc enforces completeness, so
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
      activeLithoModel: null,
      handleCreateLithoModel: async () => null,
      handleActivateLithoModel: async () => {},
      lithoContacts: [],
      lithoLayers: [],
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
      // Recovery-only setter (docs/design/autosave-recovery.md §2, item 2).
      setGhostsByAnchor: vi.fn(),
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
      geotechGaplessReport: null,
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
      handleSubdivideAllBodies: noopAsync,
      handleDivideBoreholes: noopAsync,
      requestGeotechLayersRefetch: vi.fn(),
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
      handleSelectWithoutView: noopAsync,
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
      markMutated: vi.fn(),
      importMenuOpen: false,
      setImportMenuOpen: vi.fn(),
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
    // Same arg object, same refs â†’ memo must NOT recompute.
    rerender(args)
    expect(result.current).toBe(first)
  })

  // T4 â€” debt #53 structural fix (auto-derived dep array).
  //
  // For EVERY key on the args object (and EVERY key on the geo sub-
  // object), changing that key's value MUST cause the memo to
  // recompute. The original T2 only exercised one leaf per slice; if a
  // dep was missing for a leaf T2 didn't pick, the bug would slip.
  // After the dep array became `Object.values(args) + Object.values(geo)`
  // this is structurally impossible, but the test proves the
  // structural claim and would loudly fail if anyone refactors the
  // dep array back to a hand-listed shape with a hole.
  it('T4 â€” every args field is wired as a dep (no silent staleness)', () => {
    const baseArgs = toArgs(makeCtx())
    // Compose the full enumerable key set: flat args minus `geo`,
    // plus every key on `geo`.
    const { geo: baseGeo, ...flatBase } = baseArgs
    const flatKeys = Object.keys(flatBase) as Array<keyof typeof flatBase>
    const geoKeys = Object.keys(baseGeo) as Array<keyof typeof baseGeo>

    // Sanity: the key sets are non-empty (a future test that ran on
    // an empty object would trivially pass and the protection would
    // be silently gone).
    expect(flatKeys.length).toBeGreaterThan(30)
    expect(geoKeys.length).toBeGreaterThan(10)

    // For each flat key, swap its value to a fresh sentinel
    // (preserving the rest), rerender, assert the memo recomputed.
    for (const key of flatKeys) {
      const { result, rerender } = renderHook(
        (a: UseShellContextValueArgs) => useShellContextValue(a),
        { initialProps: baseArgs },
      )
      const before = result.current
      const sentinel = makeSentinelFor(flatBase[key])
      const mutated: UseShellContextValueArgs = {
        ...baseArgs,
        [key]: sentinel,
      }
      rerender(mutated)
      if (result.current === before) {
        throw new Error(
          `dep-array hole: changing flat key "${String(key)}" did not recompute the memo`,
        )
      }
    }

    // Same loop, this time mutating fields inside the geo sub-object.
    // We pass a fresh geo object (the test's baseline freshens it
    // anyway) with one field swapped.
    for (const key of geoKeys) {
      const { result, rerender } = renderHook(
        (a: UseShellContextValueArgs) => useShellContextValue(a),
        { initialProps: baseArgs },
      )
      const before = result.current
      const sentinel = makeSentinelFor(baseGeo[key])
      const mutatedGeo = { ...baseGeo, [key]: sentinel }
      rerender({ ...baseArgs, geo: mutatedGeo })
      if (result.current === before) {
        throw new Error(
          `dep-array hole: changing geo key "${String(key)}" did not recompute the memo`,
        )
      }
    }
  })
})

// Sentinel-builder: returns a value of the same broad "kind" as the
// input that is guaranteed to be !== the input. Used by T4 to mutate
// each field through a rerender without breaking type expectations.
function makeSentinelFor(value: unknown): unknown {
  if (typeof value === 'function') return () => undefined
  if (typeof value === 'boolean') return !value
  if (typeof value === 'number') return value + 1
  if (typeof value === 'string') return value + '__sentinel'
  if (Array.isArray(value)) return [...value, '__sentinel']
  if (value instanceof Set) return new Set([...value, '__sentinel'])
  if (value instanceof Map) return new Map([...value, ['__sentinel', '__sentinel']])
  if (value === null) return '__sentinel'
  if (typeof value === 'object') return { __sentinel: true }
  return '__sentinel'
}

