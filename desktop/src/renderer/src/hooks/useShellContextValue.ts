import { useMemo } from 'react'

import type { ShellContextValue } from '../shell/ShellContext'

export interface UseShellContextValueArgs {
  // project is cast non-null in the body (AppShell renders only inside the gate).
  project: ShellContextValue['project'] | null
  projectDirty: ShellContextValue['lifecycle']['projectDirty']
  newProjectOpen: ShellContextValue['lifecycle']['newProjectOpen']
  setNewProjectOpen: ShellContextValue['lifecycle']['setNewProjectOpen']
  metadataEditorOpen: ShellContextValue['lifecycle']['metadataEditorOpen']
  setMetadataEditorOpen: ShellContextValue['lifecycle']['setMetadataEditorOpen']
  closeConfirmOpen: ShellContextValue['lifecycle']['closeConfirmOpen']
  setCloseConfirmOpen: ShellContextValue['lifecycle']['setCloseConfirmOpen']
  unsavedDialogOpen: ShellContextValue['lifecycle']['unsavedDialogOpen']
  unsavedSaving: ShellContextValue['lifecycle']['unsavedSaving']
  saveProject: ShellContextValue['lifecycle']['saveProject']
  discardSessionImports: ShellContextValue['lifecycle']['discardSessionImports']
  handleCloseProjectRequest: ShellContextValue['lifecycle']['handleCloseProjectRequest']
  handleUnsavedSave: ShellContextValue['lifecycle']['handleUnsavedSave']
  handleUnsavedDiscard: ShellContextValue['lifecycle']['handleUnsavedDiscard']
  handleUnsavedCancel: ShellContextValue['lifecycle']['handleUnsavedCancel']
  stageLumping: ShellContextValue['lifecycle']['stageLumping']
  currentLumping: ShellContextValue['lifecycle']['currentLumping']
  cpts: ShellContextValue['investigations']['cpts']
  detailMap: ShellContextValue['investigations']['detailMap']
  plotMap: ShellContextValue['investigations']['plotMap']
  boreholes: ShellContextValue['investigations']['boreholes']
  boreholeDetailMap: ShellContextValue['investigations']['boreholeDetailMap']
  importing: ShellContextValue['investigations']['importing']
  bboxImportType: ShellContextValue['investigations']['bboxImportType']
  dovImporting: ShellContextValue['investigations']['dovImporting']
  dovImportState: ShellContextValue['investigations']['dovImportState']
  resetDovImport: ShellContextValue['investigations']['resetDovImport']
  removedCptIds: ShellContextValue['investigations']['removedCptIds']
  removedBoreholeIds: ShellContextValue['investigations']['removedBoreholeIds']
  refreshList: ShellContextValue['investigations']['refreshList']
  refreshBoreholeList: ShellContextValue['investigations']['refreshBoreholeList']
  loadCptDetail: ShellContextValue['investigations']['loadCptDetail']
  loadChart: ShellContextValue['investigations']['loadChart']
  loadBoreholeDetail: ShellContextValue['investigations']['loadBoreholeDetail']
  cancelBboxDraw: ShellContextValue['investigations']['cancelBboxDraw']
  unhideCpts: ShellContextValue['investigations']['unhideCpts']
  unhideBoreholes: ShellContextValue['investigations']['unhideBoreholes']
  handleRemoveCpts: ShellContextValue['investigations']['handleRemoveCpts']
  handleRemoveBoreholes: ShellContextValue['investigations']['handleRemoveBoreholes']
  handleRestoreAllCpts: ShellContextValue['investigations']['handleRestoreAllCpts']
  handleRestoreAllBoreholes: ShellContextValue['investigations']['handleRestoreAllBoreholes']
  handlePatchCptElevation: ShellContextValue['investigations']['handlePatchCptElevation']
  handlePatchBoreholeElevation: ShellContextValue['investigations']['handlePatchBoreholeElevation']
  handleImportCpt: ShellContextValue['investigations']['handleImportCpt']
  handleImportDov: ShellContextValue['investigations']['handleImportDov']
  handleImportBoreholeDov: ShellContextValue['investigations']['handleImportBoreholeDov']
  handleBboxDrawn: ShellContextValue['investigations']['handleBboxDrawn']
  pendingCptPins: ShellContextValue['investigations']['pendingCptPins']
  visibleCpts: ShellContextValue['visibleCpts']
  visibleBoreholes: ShellContextValue['visibleBoreholes']
  // Whole hook result; the body passes it as geoModel and the dep
  // array uses its destructured fields (re-destructured below).
  geo: ShellContextValue['geoModel']
  sections: ShellContextValue['sections']['sections']
  selectedSectionId: ShellContextValue['sections']['selectedSectionId']
  drawingSection: ShellContextValue['sections']['drawingSection']
  focusedContactIds: ShellContextValue['sections']['focusedContactIds']
  visibleSections: ShellContextValue['sections']['visibleSections']
  effectiveHorizontalEpsg: ShellContextValue['sections']['effectiveHorizontalEpsg']
  refreshSectionList: ShellContextValue['sections']['refreshSectionList']
  clearSectionSelection: ShellContextValue['sections']['clearSectionSelection']
  handleSectionCreated: ShellContextValue['sections']['handleSectionCreated']
  handleSectionDeleted: ShellContextValue['sections']['handleSectionDeleted']
  handleCreateSection: ShellContextValue['sections']['handleCreateSection']
  cancelSectionDraw: ShellContextValue['sections']['cancelSectionDraw']
  handleSectionLineDrawn: ShellContextValue['sections']['handleSectionLineDrawn']
  handleDeleteSection: ShellContextValue['sections']['handleDeleteSection']
  handlePatchSelectedSection: ShellContextValue['sections']['handlePatchSelectedSection']
  handleSelectSection: ShellContextValue['sections']['handleSelectSection']
  handleFocusContacts: ShellContextValue['sections']['handleFocusContacts']
  applyUpdatedSection: ShellContextValue['sections']['applyUpdatedSection']
  sectionModelAxis: ShellContextValue['sections']['sectionModelAxis']
  setSectionModelAxis: ShellContextValue['sections']['setSectionModelAxis']
  backdropModelIdOverride: ShellContextValue['sections']['backdropModelIdOverride']
  setBackdropModelIdOverride: ShellContextValue['sections']['setBackdropModelIdOverride']
  demSource: ShellContextValue['overlays']['demSource']
  demOverlay: ShellContextValue['overlays']['demOverlay']
  handleDemOverlayChange: ShellContextValue['overlays']['handleDemOverlayChange']
  virtueleBoringOverlay: ShellContextValue['overlays']['virtueleBoringOverlay']
  virtueleBoringSectionModels: ShellContextValue['overlays']['virtueleBoringSectionModels']
  virtueleBoringPredictions: ShellContextValue['overlays']['virtueleBoringPredictions']
  virtueleBoringLoading: ShellContextValue['overlays']['virtueleBoringLoading']
  virtueleBoringSkippedCount: ShellContextValue['overlays']['virtueleBoringSkippedCount']
  virtueleBoringPredictionByInvestigationId: ShellContextValue['overlays']['virtueleBoringPredictionByInvestigationId']
  cptEffectiveModels: ShellContextValue['overlays']['cptEffectiveModels']
  boreholeEffectiveModels: ShellContextValue['overlays']['boreholeEffectiveModels']
  showOverlayOnSection: ShellContextValue['overlays']['showOverlayOnSection']
  showOverlayOnCpt: ShellContextValue['overlays']['showOverlayOnCpt']
  showOverlayOnBorehole: ShellContextValue['overlays']['showOverlayOnBorehole']
  cptVirtueleBoringOverride: ShellContextValue['overlays']['cptVirtueleBoringOverride']
  boreholeVirtueleBoringOverride: ShellContextValue['overlays']['boreholeVirtueleBoringOverride']
  handleChangeVirtueleBoringPicker: ShellContextValue['overlays']['handleChangeVirtueleBoringPicker']
  handleSetShowOverlay: ShellContextValue['overlays']['handleSetShowOverlay']
  handleSetOverlayOverride: ShellContextValue['overlays']['handleSetOverlayOverride']
  toasts: ShellContextValue['toasts']['toasts']
  toast: ShellContextValue['toasts']['toast']
  undoStack: ShellContextValue['undo']
  ready: ShellContextValue['boot']['ready']
  apiError: ShellContextValue['boot']['apiError']
  mapState: ShellContextValue['mapState']
  selectedId: ShellContextValue['coordinator']['selectedId']
  selectedBoreholeId: ShellContextValue['coordinator']['selectedBoreholeId']
  setSelectedId: ShellContextValue['coordinator']['setSelectedId']
  setSelectedBoreholeId: ShellContextValue['coordinator']['setSelectedBoreholeId']
  view: ShellContextValue['coordinator']['view']
  setView: ShellContextValue['coordinator']['setView']
  handleSelect: ShellContextValue['coordinator']['handleSelect']
  handleSelectBorehole: ShellContextValue['coordinator']['handleSelectBorehole']
  handleExportSectionDxf: ShellContextValue['coordinator']['handleExportSectionDxf']
  handleExportSectionPlaxis2d: ShellContextValue['coordinator']['handleExportSectionPlaxis2d']
  outOfViewportCptIds: ShellContextValue['coordinator']['outOfViewportCptIds']
  outOfViewportBoreholeIds: ShellContextValue['coordinator']['outOfViewportBoreholeIds']
  projectFilePath: ShellContextValue['coordinator']['projectFilePath']
  manifestFormationIds: ShellContextValue['coordinator']['manifestFormationIds']
  sessionImportCptIds: ShellContextValue['coordinator']['sessionImportCptIds']
  sessionImportBoreholeIds: ShellContextValue['coordinator']['sessionImportBoreholeIds']
  sessionImportSectionIds: ShellContextValue['coordinator']['sessionImportSectionIds']
  sessionImportFormationIds: ShellContextValue['coordinator']['sessionImportFormationIds']
  marqueeSelectedIds: ShellContextValue['coordinator']['marqueeSelectedIds']
  setMarqueeSelectedIds: ShellContextValue['coordinator']['setMarqueeSelectedIds']
  hoveredTestId: ShellContextValue['coordinator']['hoveredTestId']
  setHoveredTestId: ShellContextValue['coordinator']['setHoveredTestId']
}

/**
 * Assemble the ShellContextValue memo (debt #12 net-first extraction).
 *
 * VERBATIM relocation of the former App.tsx ``shellContextValue``
 * useMemo: the memo body + dependency array below are byte-identical
 * to the inline original. ``geo`` is passed whole and re-destructured
 * here so every dep identifier resolves to the SAME reference it did
 * in App scope — behaviour is provably unchanged by construction, and
 * tsc proves no binding was missed (a dropped name = compile error).
 *
 * Net: useShellContextValue.test.tsx pins the three failure modes —
 * assembly shape, no-stale propagation, referential stability — so a
 * future dep-array slip (debt #53) fails loudly instead of silently
 * serving stale context app-wide.
 */
export function useShellContextValue(
  args: UseShellContextValueArgs,
): ShellContextValue {
  const {
    project, projectDirty, newProjectOpen, setNewProjectOpen, metadataEditorOpen, setMetadataEditorOpen,
    closeConfirmOpen, setCloseConfirmOpen, unsavedDialogOpen, unsavedSaving, saveProject, discardSessionImports,
    handleCloseProjectRequest, handleUnsavedSave, handleUnsavedDiscard, handleUnsavedCancel, stageLumping, currentLumping, cpts, detailMap,
    plotMap, boreholes, boreholeDetailMap, importing, bboxImportType, dovImporting,
    dovImportState, resetDovImport,
    removedCptIds, removedBoreholeIds, refreshList, refreshBoreholeList, loadCptDetail, loadChart,
    loadBoreholeDetail, cancelBboxDraw, unhideCpts, unhideBoreholes, handleRemoveCpts, handleRemoveBoreholes,
    handleRestoreAllCpts, handleRestoreAllBoreholes, handlePatchCptElevation, handlePatchBoreholeElevation, handleImportCpt, handleImportDov,
    handleImportBoreholeDov, handleBboxDrawn, pendingCptPins, visibleCpts, visibleBoreholes, geo, sections,
    selectedSectionId, drawingSection, focusedContactIds, visibleSections, effectiveHorizontalEpsg, refreshSectionList,
    clearSectionSelection, handleSectionCreated, handleSectionDeleted, handleCreateSection, cancelSectionDraw, handleSectionLineDrawn,
    handleDeleteSection, handlePatchSelectedSection, handleSelectSection, handleFocusContacts, applyUpdatedSection, sectionModelAxis, setSectionModelAxis, backdropModelIdOverride, setBackdropModelIdOverride, demSource, demOverlay,
    handleDemOverlayChange, virtueleBoringOverlay, virtueleBoringSectionModels, virtueleBoringPredictions, virtueleBoringLoading, virtueleBoringSkippedCount,
    virtueleBoringPredictionByInvestigationId, cptEffectiveModels, boreholeEffectiveModels, showOverlayOnSection, showOverlayOnCpt, showOverlayOnBorehole,
    cptVirtueleBoringOverride, boreholeVirtueleBoringOverride, handleChangeVirtueleBoringPicker, handleSetShowOverlay, handleSetOverlayOverride, toasts,
    toast, undoStack, ready, apiError, mapState, selectedId,
    selectedBoreholeId, setSelectedId, setSelectedBoreholeId, view, setView, handleSelect,
    handleSelectBorehole, handleExportSectionDxf, handleExportSectionPlaxis2d, outOfViewportCptIds, outOfViewportBoreholeIds, projectFilePath,
    manifestFormationIds, sessionImportCptIds, sessionImportBoreholeIds, sessionImportSectionIds, sessionImportFormationIds, marqueeSelectedIds,
    setMarqueeSelectedIds, hoveredTestId, setHoveredTestId,
  } = args

  // Re-destructure geo so the dep array stays byte-identical to the
  // old App.tsx memo (these refs are geo.X — same identities).
  const {
    activeGeologicalModel, formations, formationsRefreshCounter, contacts, surfacesByFormationId, crossingsRefreshCounter,
    staleSurfaceCount, handleFormationCreated, handleFormationUpdated, handleFormationDeleted, handleInlineCreateFormation, refetchFormations,
    handleCreateContact, handleUpdateContactDepth, handleBatchCreateContacts, handleBatchUpdateContacts, handleDeleteContact, handleAutoPopulateFromStratigraphy,
    handleDedupeContacts, handleRebuildSurfaces, handleExportModelPlaxis3d, handleToggleBoreholeInModel, discardContacts,
  } = geo

  return useMemo((): ShellContextValue => ({
    // project is non-null here — AppShell is only rendered inside the
    // project gate below. The loaded-project branch asserts project is truthy.
    project: project!,
    lifecycle: {
      projectDirty,
      newProjectOpen,
      setNewProjectOpen,
      metadataEditorOpen,
      setMetadataEditorOpen,
      closeConfirmOpen,
      setCloseConfirmOpen,
      unsavedDialogOpen,
      unsavedSaving,
      saveProject,
      discardSessionImports,
      handleCloseProjectRequest,
      handleUnsavedSave,
      handleUnsavedDiscard,
      handleUnsavedCancel,
      stageLumping,
      currentLumping,
    },
    investigations: {
      cpts,
      detailMap,
      plotMap,
      boreholes,
      boreholeDetailMap,
      importing,
      bboxImportType,
      dovImporting,
      dovImportState,
      resetDovImport,
      removedCptIds,
      removedBoreholeIds,
      refreshList,
      refreshBoreholeList,
      loadCptDetail,
      loadChart,
      loadBoreholeDetail,
      cancelBboxDraw,
      unhideCpts,
      unhideBoreholes,
      handleRemoveCpts,
      handleRemoveBoreholes,
      handleRestoreAllCpts,
      handleRestoreAllBoreholes,
      handlePatchCptElevation,
      handlePatchBoreholeElevation,
      handleImportCpt,
      handleImportDov,
      handleImportBoreholeDov,
      handleBboxDrawn,
      pendingCptPins,
    },
    visibleCpts,
    visibleBoreholes,
    // Whole hook result, passed through untouched. R4 (debt #12):
    // visibleFormations is now computed INSIDE useGeologicalModel
    // (it takes manifestFormationIds), so the old ``{ ...geo,
    // visibleFormations }`` spread is gone — no App-level
    // post-processing of the geo slice, and no risk of the spread
    // dropping a hook field (the bug the prior comment warned about).
    geoModel: geo,
    sections: {
      sections,
      selectedSectionId,
      drawingSection,
      focusedContactIds,
      visibleSections,
      effectiveHorizontalEpsg,
      sectionModelAxis,
      setSectionModelAxis,
      backdropModelIdOverride,
      setBackdropModelIdOverride,
      refreshSectionList,
      clearSectionSelection,
      handleSectionCreated,
      handleSectionDeleted,
      handleCreateSection,
      cancelSectionDraw,
      handleSectionLineDrawn,
      handleDeleteSection,
      handlePatchSelectedSection,
      handleSelectSection,
      handleFocusContacts,
      applyUpdatedSection,
    },
    overlays: {
      demSource,
      demOverlay,
      handleDemOverlayChange,
      virtueleBoringOverlay,
      virtueleBoringSectionModels,
      virtueleBoringPredictions,
      virtueleBoringLoading,
      virtueleBoringSkippedCount,
      virtueleBoringPredictionByInvestigationId,
      cptEffectiveModels,
      boreholeEffectiveModels,
      showOverlayOnSection,
      showOverlayOnCpt,
      showOverlayOnBorehole,
      cptVirtueleBoringOverride,
      boreholeVirtueleBoringOverride,
      handleChangeVirtueleBoringPicker,
      handleSetShowOverlay,
      handleSetOverlayOverride,
    },
    toasts: { toasts, toast },
    undo: undoStack,
    boot: { ready, apiError },
    mapState,
    coordinator: {
      selectedId,
      selectedBoreholeId,
      setSelectedId,
      setSelectedBoreholeId,
      view,
      setView,
      handleSelect,
      handleSelectBorehole,
      handleExportSectionDxf,
      handleExportSectionPlaxis2d,
      outOfViewportCptIds,
      outOfViewportBoreholeIds,
      projectFilePath,
      manifestFormationIds,
      sessionImportCptIds,
      sessionImportBoreholeIds,
      sessionImportSectionIds,
      sessionImportFormationIds,
      marqueeSelectedIds,
      setMarqueeSelectedIds,
      hoveredTestId,
      setHoveredTestId,
    },
  }), [
    project,
    // lifecycle fields
    projectDirty, newProjectOpen, setNewProjectOpen,
    metadataEditorOpen, setMetadataEditorOpen,
    closeConfirmOpen, setCloseConfirmOpen,
    unsavedDialogOpen, unsavedSaving,
    saveProject, discardSessionImports, handleCloseProjectRequest,
    handleUnsavedSave, handleUnsavedDiscard, handleUnsavedCancel, stageLumping, currentLumping,
    // investigation fields
    cpts, detailMap, plotMap, boreholes, boreholeDetailMap,
    importing, bboxImportType, dovImporting, dovImportState, resetDovImport,
    removedCptIds, removedBoreholeIds,
    refreshList, refreshBoreholeList,
    loadCptDetail, loadChart, loadBoreholeDetail,
    cancelBboxDraw, unhideCpts, unhideBoreholes,
    handleRemoveCpts, handleRemoveBoreholes,
    handleRestoreAllCpts, handleRestoreAllBoreholes,
    handlePatchCptElevation, handlePatchBoreholeElevation,
    handleImportCpt, handleImportDov, handleImportBoreholeDov, handleBboxDrawn,
    pendingCptPins,
    visibleCpts, visibleBoreholes,
    // geological model fields
    activeGeologicalModel, formations, formationsRefreshCounter,
    contacts, surfacesByFormationId, crossingsRefreshCounter, staleSurfaceCount,
    handleFormationCreated, handleFormationUpdated, handleFormationDeleted,
    handleInlineCreateFormation, refetchFormations,
    handleCreateContact, handleUpdateContactDepth,
    handleBatchCreateContacts, handleBatchUpdateContacts, handleDeleteContact,
    handleAutoPopulateFromStratigraphy, handleDedupeContacts,
    handleRebuildSurfaces, handleExportModelPlaxis3d,
    handleToggleBoreholeInModel, discardContacts,
    // sections fields
    sections, selectedSectionId, drawingSection, focusedContactIds, visibleSections,
    sectionModelAxis, setSectionModelAxis,
    refreshSectionList, clearSectionSelection,
    handleSectionCreated, handleSectionDeleted,
    handleCreateSection, cancelSectionDraw, handleSectionLineDrawn,
    handleDeleteSection, handlePatchSelectedSection,
    handleSelectSection, handleFocusContacts, applyUpdatedSection,
    // overlay fields
    demSource, demOverlay, handleDemOverlayChange,
    virtueleBoringOverlay, virtueleBoringSectionModels,
    virtueleBoringPredictions, virtueleBoringLoading, virtueleBoringSkippedCount,
    virtueleBoringPredictionByInvestigationId,
    cptEffectiveModels, boreholeEffectiveModels,
    showOverlayOnSection, showOverlayOnCpt, showOverlayOnBorehole,
    cptVirtueleBoringOverride, boreholeVirtueleBoringOverride,
    handleChangeVirtueleBoringPicker, handleSetShowOverlay, handleSetOverlayOverride,
    // toast + undo + boot
    toasts, toast,
    undoStack,
    ready, apiError,
    // mapState — object rebuilt each render when layer-visibility changes;
    // include it so context updates when the user toggles a CPT type or moves the map.
    mapState,
    // coordinator slice — all are either useState values or stable useCallback refs.
    selectedId, selectedBoreholeId, setSelectedId, setSelectedBoreholeId,
    view, setView,
    handleSelect, handleSelectBorehole, handleExportSectionDxf,
    handleExportSectionPlaxis2d,
    outOfViewportCptIds, outOfViewportBoreholeIds,
    projectFilePath, manifestFormationIds,
    sessionImportCptIds, sessionImportBoreholeIds, sessionImportSectionIds,
    sessionImportFormationIds,
    marqueeSelectedIds, setMarqueeSelectedIds,
    hoveredTestId, setHoveredTestId,
  ])
}
