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
  // Optional like its bus field (partial shells omit it); App always passes it,
  // so the auto-derived dep array keeps a stable length.
  handleImportBoreholeXml?: ShellContextValue['investigations']['handleImportBoreholeXml']
  handleImportCptPdf?: ShellContextValue['investigations']['handleImportCptPdf']
  handleImportBoreholePdf?: ShellContextValue['investigations']['handleImportBoreholePdf']
  handleBboxDrawn: ShellContextValue['investigations']['handleBboxDrawn']
  pendingCptPins: ShellContextValue['investigations']['pendingCptPins']
  // Required KEY (value may be undefined in partial shells): the lab import's
  // DOV-fetched borehole reaches the list only through this; omitting it at the
  // App call site silently dropped the refresh (owner dogfeed 2026-10-04).
  adoptImportedBoreholes: ShellContextValue['investigations']['adoptImportedBoreholes']
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
  sectionFocusedColumn: ShellContextValue['sections']['sectionFocusedColumn']
  setSectionFocusedColumn: ShellContextValue['sections']['setSectionFocusedColumn']
  sectionModelAxis: ShellContextValue['sections']['sectionModelAxis']
  setSectionModelAxis: ShellContextValue['sections']['setSectionModelAxis']
  backdropModelIdOverride: ShellContextValue['sections']['backdropModelIdOverride']
  setBackdropModelIdOverride: ShellContextValue['sections']['setBackdropModelIdOverride']
  correlateMode: ShellContextValue['sections']['correlateMode']
  correlationSource: ShellContextValue['sections']['correlationSource']
  enterCorrelateMode: ShellContextValue['sections']['enterCorrelateMode']
  exitCorrelateMode: ShellContextValue['sections']['exitCorrelateMode']
  armCorrelationSource: ShellContextValue['sections']['armCorrelationSource']
  clearCorrelationSource: ShellContextValue['sections']['clearCorrelationSource']
  suggestedTies: ShellContextValue['sections']['suggestedTies']
  handleSuggestTies: ShellContextValue['sections']['handleSuggestTies']
  handleAcceptTie: ShellContextValue['sections']['handleAcceptTie']
  handleAcceptAllTies: ShellContextValue['sections']['handleAcceptAllTies']
  handleRejectTie: ShellContextValue['sections']['handleRejectTie']
  handleClearTieSuggestions: ShellContextValue['sections']['handleClearTieSuggestions']
  // Whole bed-override slice (owner ruling 2026-09-06) — passed as one memoised
  // object (like ``geo``), so the auto-derived dep array tracks its identity.
  // Optional so the fully-typed test fixtures need not fabricate it.
  bedOverrides?: ShellContextValue['bedOverrides']
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
  showConfidenceFade: ShellContextValue['overlays']['showConfidenceFade']
  handleSetShowConfidenceFade: ShellContextValue['overlays']['handleSetShowConfidenceFade']
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
  detailOpenSeq?: ShellContextValue['coordinator']['detailOpenSeq']
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
  geoDeepLinkTarget: ShellContextValue['coordinator']['geoDeepLinkTarget']
  setGeoDeepLinkTarget: ShellContextValue['coordinator']['setGeoDeepLinkTarget']
  sectionsDeepLinkTarget: ShellContextValue['coordinator']['sectionsDeepLinkTarget']
  setSectionsDeepLinkTarget: ShellContextValue['coordinator']['setSectionsDeepLinkTarget']
  parametersDeepLinkTarget: ShellContextValue['coordinator']['parametersDeepLinkTarget']
  setParametersDeepLinkTarget: ShellContextValue['coordinator']['setParametersDeepLinkTarget']
  // Optional for the same fixture reason as importMenuOpen below (the Coordinator's
  // own export deep-link fields are optional). App always passes them.
  exportDeepLinkTarget?: ShellContextValue['coordinator']['exportDeepLinkTarget']
  setExportDeepLinkTarget?: ShellContextValue['coordinator']['setExportDeepLinkTarget']
  selectedParameterUnit: ShellContextValue['coordinator']['selectedParameterUnit']
  setSelectedParameterUnit: ShellContextValue['coordinator']['setSelectedParameterUnit']
  parametersActiveTab: ShellContextValue['coordinator']['parametersActiveTab']
  setParametersActiveTab: ShellContextValue['coordinator']['setParametersActiveTab']
  correlationEdgesRefetchNonce: ShellContextValue['coordinator']['correlationEdgesRefetchNonce']
  bodyRecomputeLithoNonce: ShellContextValue['coordinator']['bodyRecomputeLithoNonce']
  bodyRecomputeGeotechNonce: ShellContextValue['coordinator']['bodyRecomputeGeotechNonce']
  requestBodyRecompute: ShellContextValue['coordinator']['requestBodyRecompute']
  handleSelectWithoutView: ShellContextValue['coordinator']['handleSelectWithoutView']
  markMutated: ShellContextValue['coordinator']['markMutated']
  // Optional so the fully-typed ShellContextValue test fixtures (which spread a
  // Coordinator whose importMenuOpen is itself optional) still satisfy this
  // shape without each fixture adding the field. App always passes it.
  importMenuOpen?: ShellContextValue['coordinator']['importMenuOpen']
  setImportMenuOpen?: ShellContextValue['coordinator']['setImportMenuOpen']
  // Draft CRS / datum from the open project-settings dialog (owner ruling 1,
  // 2026-09-06). Optional for the same fixture reason as importMenuOpen above.
  metadataDraftHorizontalEpsg?: ShellContextValue['coordinator']['metadataDraftHorizontalEpsg']
  metadataDraftVerticalEpsg?: ShellContextValue['coordinator']['metadataDraftVerticalEpsg']
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
  // Split the geo entry out of args (debt #53 dep-array fix): the
  // auto-derived dep array below depends on the FLAT args fields plus
  // ``geo``'s INDIVIDUAL fields. If we left ``geo`` inside args for the
  // dep array, the memo would recompute every render — useGeologicalModel
  // returns a fresh object identity per render even when its values
  // didn't change.
  const { geo, ...argsWithoutGeo } = args
  const {
    project, projectDirty, newProjectOpen, setNewProjectOpen, metadataEditorOpen, setMetadataEditorOpen,
    closeConfirmOpen, setCloseConfirmOpen, unsavedDialogOpen, unsavedSaving, saveProject, discardSessionImports,
    handleCloseProjectRequest, handleUnsavedSave, handleUnsavedDiscard, handleUnsavedCancel, stageLumping, currentLumping, cpts, detailMap,
    plotMap, boreholes, boreholeDetailMap, importing, bboxImportType, dovImporting,
    dovImportState, resetDovImport,
    removedCptIds, removedBoreholeIds, refreshList, refreshBoreholeList, loadCptDetail, loadChart,
    loadBoreholeDetail, cancelBboxDraw, unhideCpts, unhideBoreholes, handleRemoveCpts, handleRemoveBoreholes,
    handleRestoreAllCpts, handleRestoreAllBoreholes, handlePatchCptElevation, handlePatchBoreholeElevation, handleImportCpt, handleImportDov,
    handleImportBoreholeDov, handleImportBoreholeXml, handleImportCptPdf, handleImportBoreholePdf, handleBboxDrawn, pendingCptPins, adoptImportedBoreholes, visibleCpts, visibleBoreholes, sections,
    selectedSectionId, drawingSection, focusedContactIds, visibleSections, effectiveHorizontalEpsg, refreshSectionList,
    clearSectionSelection, handleSectionCreated, handleSectionDeleted, handleCreateSection, cancelSectionDraw, handleSectionLineDrawn,
    handleDeleteSection, handlePatchSelectedSection, handleSelectSection, handleFocusContacts, applyUpdatedSection, sectionFocusedColumn, setSectionFocusedColumn, sectionModelAxis, setSectionModelAxis, backdropModelIdOverride, setBackdropModelIdOverride,
    correlateMode, correlationSource, enterCorrelateMode, exitCorrelateMode, armCorrelationSource, clearCorrelationSource,
    suggestedTies, handleSuggestTies, handleAcceptTie, handleAcceptAllTies, handleRejectTie, handleClearTieSuggestions, bedOverrides, demSource, demOverlay,
    handleDemOverlayChange, virtueleBoringOverlay, virtueleBoringSectionModels, virtueleBoringPredictions, virtueleBoringLoading, virtueleBoringSkippedCount,
    virtueleBoringPredictionByInvestigationId, cptEffectiveModels, boreholeEffectiveModels, showOverlayOnSection, showOverlayOnCpt, showOverlayOnBorehole,
    cptVirtueleBoringOverride, boreholeVirtueleBoringOverride, handleChangeVirtueleBoringPicker, handleSetShowOverlay, handleSetOverlayOverride, showConfidenceFade, handleSetShowConfidenceFade, toasts,
    toast, undoStack, ready, apiError, mapState, selectedId,
    selectedBoreholeId, setSelectedId, setSelectedBoreholeId, view, setView, detailOpenSeq, handleSelect,
    handleSelectBorehole, handleExportSectionDxf, handleExportSectionPlaxis2d, outOfViewportCptIds, outOfViewportBoreholeIds, projectFilePath,
    manifestFormationIds, sessionImportCptIds, sessionImportBoreholeIds, sessionImportSectionIds, sessionImportFormationIds, marqueeSelectedIds,
    setMarqueeSelectedIds, hoveredTestId, setHoveredTestId, geoDeepLinkTarget, setGeoDeepLinkTarget,
    sectionsDeepLinkTarget, setSectionsDeepLinkTarget,
    parametersDeepLinkTarget, setParametersDeepLinkTarget,
    exportDeepLinkTarget, setExportDeepLinkTarget,
    selectedParameterUnit, setSelectedParameterUnit,
    parametersActiveTab, setParametersActiveTab,
    correlationEdgesRefetchNonce, bodyRecomputeLithoNonce, bodyRecomputeGeotechNonce,
    requestBodyRecompute, handleSelectWithoutView, markMutated,
    importMenuOpen, setImportMenuOpen,
    metadataDraftHorizontalEpsg, metadataDraftVerticalEpsg,
  } = argsWithoutGeo

  // Re-destructure geo so the dep array stays byte-identical to the
  // old App.tsx memo (these refs are geo.X — same identities).
  const {
    activeGeologicalModel, formations, formationsRefreshCounter, contacts, surfacesByFormationId, crossingsRefreshCounter,
    staleSurfaceCount, handleFormationCreated, handleFormationUpdated, handleFormationDeleted, handleInlineCreateFormation, refetchFormations,
    handleCreateContact, handleUpdateContactDepth, handleBatchCreateContacts, handleBatchUpdateContacts, handleDeleteContact, handleAutoPopulateFromStratigraphy,
    handleDedupeContacts, handleRebuildSurfaces, handleExportModelPlaxis3d, handleToggleBoreholeInModel, discardContacts,
    lithoStaleSurfaceCount, handleRebuildLithoSurfaces,
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
      handleImportBoreholeXml,
      handleImportCptPdf,
      handleImportBoreholePdf,
      handleBboxDrawn,
      pendingCptPins,
      adoptImportedBoreholes,
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
      sectionFocusedColumn,
      setSectionFocusedColumn,
      correlateMode,
      correlationSource,
      enterCorrelateMode,
      exitCorrelateMode,
      armCorrelationSource,
      clearCorrelationSource,
      suggestedTies,
      handleSuggestTies,
      handleAcceptTie,
      handleAcceptAllTies,
      handleRejectTie,
      handleClearTieSuggestions,
    },
    bedOverrides,
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
      showConfidenceFade,
      handleSetShowConfidenceFade,
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
      detailOpenSeq,
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
      geoDeepLinkTarget,
      setGeoDeepLinkTarget,
      sectionsDeepLinkTarget,
      setSectionsDeepLinkTarget,
      parametersDeepLinkTarget,
      setParametersDeepLinkTarget,
      exportDeepLinkTarget,
      setExportDeepLinkTarget,
      selectedParameterUnit,
      setSelectedParameterUnit,
      parametersActiveTab,
      setParametersActiveTab,
      correlationEdgesRefetchNonce,
      bodyRecomputeLithoNonce,
      bodyRecomputeGeotechNonce,
      requestBodyRecompute,
      handleSelectWithoutView,
      markMutated,
      importMenuOpen,
      setImportMenuOpen,
      metadataDraftHorizontalEpsg,
      metadataDraftVerticalEpsg,
    },
  }),
  // Auto-derived dep array (debt #53, 2026-05-21). The prior shape was
  // ~120 hand-listed names — every new field on the bus required
  // adding a matching entry, and a slip silently served stale context
  // app-wide (the S7 render-loop class). Now we spread the args' own
  // values directly: every field that exists on the args object
  // automatically becomes a dep, by construction. ``args.geo`` is
  // excluded so we drive on its INDIVIDUAL fields instead of the
  // (re-identifying-per-render) hook return — otherwise the memo
  // would recompute every render. Adding a field to
  // ``UseShellContextValueArgs`` or to ``UseGeologicalModelResult``
  // now means it is tracked automatically: the dep array cannot
  // drift behind the body.
  //
  // ESLint react-hooks/exhaustive-deps would flag the spread (it only
  // analyses static array literals); the spread is the load-bearing
  // safety mechanism here, so the disable is correct.
  // reason: dep array is intentionally auto-derived to prevent silent
  // drift between body and deps (debt #53 structural fix); the rule
  // expects a static literal which is exactly what we've replaced.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [...Object.values(argsWithoutGeo), ...Object.values(geo)])
}
