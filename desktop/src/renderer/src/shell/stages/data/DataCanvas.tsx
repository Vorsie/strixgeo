// Data stage canvas — non-section main render.
//
// Reproduces the loaded-project canvas block from App.tsx at commit 3322e04^
// verbatim, now sourcing every prop from the ShellContext bus via useShell().
//
// The selectedSection !== null → SectionPanel branch is S5 (SectionsCanvas).
// In S4 this component only handles the Data stage: Map view, CPT chart, and
// Borehole log. When a section is selected the canvas intentionally does
// nothing special — SectionsCanvas (S5) owns that branch.

import { useMemo, useCallback } from 'react'
import { Map as MapIcon, BarChart2 } from 'lucide-react'

import { useShell } from '../../ShellContext'
import { LoadingState } from '../../EmptyState'
import MapView from '../../../components/MapView'
import CptChart from '../../../components/CptChart'
import BoreholeLog from '../../../components/BoreholeLog'
import DovImportProgressPanel from '../../../components/DovImportProgressPanel'
import ViewTab from '../../../components/ui/ViewTab'
import { buildContactOverlays, filterContactOverlays } from '../../../utils/contactOverlays'
import { useContactOverlayVisibility } from '../../../hooks/useContactOverlayVisibility'
import { useT } from '../../../i18n/translate'
import { useBoreholeTrackEdits } from '../../../hooks/useBoreholeTrackEdits'
import type { LabSeriesTestSummary } from '../../../api/client'

/**
 * Center canvas for the Data stage.
 *
 * Renders one of three sub-views depending on coordinator state:
 *
 * - No selection or map-view: ``MapView`` (the default landing state).
 * - CPT selected + chart view: ``CptChart``.
 * - Borehole selected + chart view: ``BoreholeLog``.
 *
 * All props are sourced from the ShellContext bus (``useShell()``) — no
 * props are accepted directly.  This matches the ``StageDescriptor``
 * contract where ``CanvasComponent`` is called with no props.
 *
 * Returns
 * -------
 * JSX.Element
 *     The data canvas element.
 */
export default function DataCanvas(): JSX.Element {
  const t = useT()
  const {
    project,
    undo,
    visibleCpts,
    visibleBoreholes,
    // Bed overrides (owner ruling 2026-09-06) — optional on the bus; the Data
    // stage always has it, but read defensively.
    bedOverrides,
    toasts,
    investigations: {
      refreshBoreholeList,
      detailMap,
      plotMap,
      boreholeDetailMap,
      bboxImportType,
      dovImportState,
      resetDovImport,
      cancelBboxDraw,
      handleBboxDrawn,
      handlePatchCptElevation,
      handlePatchBoreholeElevation,
      loadBoreholeDetail,
      pendingCptPins,
    },
    coordinator: {
      setSectionsDeepLinkTarget,
      selectedId,
      selectedBoreholeId,
      view,
      setView,
      handleSelect,
      handleSelectBorehole,
      marqueeSelectedIds,
      setMarqueeSelectedIds,
      hoveredTestId,
      markMutated,
    },
    mapState: {
      hiddenCptTypes,
      hiddenBoreholeValues,
      boreholeAxis,
      mapCameraRef,
      handleToggleCptType,
      handleToggleBoreholeValue,
      setBoreholeAxis,
      handleViewportChange,
      handleMapCameraChange,
    },
    overlays: {
      demSource,
      demOverlay,
      handleDemOverlayChange,
      virtueleBoringOverlay,
      virtueleBoringPredictionByInvestigationId,
      virtueleBoringLoading,
      cptEffectiveModels,
      boreholeEffectiveModels,
      showOverlayOnCpt,
      showOverlayOnBorehole,
      cptVirtueleBoringOverride,
      boreholeVirtueleBoringOverride,
      handleSetShowOverlay,
      handleSetOverlayOverride,
    },
    sections: {
      // WHY visibleSections not sections: the map overlay must mirror the
      // right-pane list exactly.  Raw `sections` includes every DB row fetched
      // this session; `visibleSections` is the manifest-gated set — sections the
      // user has saved (or drawn in this session without discarding).  Feeding
      // raw sections here while the list reads visibleSections caused the
      // reported desync: unsaved sections remained on the map after project
      // close / discard even though the list showed 0.
      visibleSections,
      selectedSectionId,
      drawingSection,
      handleSectionLineDrawn,
      cancelSectionDraw,
      handleSelectSection,
      // The project's effective horizontal CRS — MapView projects project-owned
      // CPT / borehole rows through it so a 28992 project's markers land in the
      // Netherlands, not read as Belgium Lambert-72 (Codex 2).
      effectiveHorizontalEpsg,
    },
    geoModel: {
      contacts: geoContacts,
      formations: geoFormations,
      lithoContacts,
      lithoFormations,
    },
  } = useShell()

  const selectedCpt = visibleCpts.find(c => c.id === selectedId)
  // Per-user stratigraphic / lithological boundary switches (owner
  // 2026-10-04); the overlays below drop the switched-off source.
  const contactOverlayVisibility = useContactOverlayVisibility()

  // Borehole Tracks panel (owner 2026-09-29): add / change / delete a track.
  // The undo push + mutated mark are read lazily (only on a save) so a stage
  // test bus without them still renders.
  const pushTrackUndo = useCallback((cmd: Parameters<typeof undo.push>[0]) => undo.push(cmd), [undo])
  const markTrackMutated = useCallback(() => markMutated(), [markMutated])
  const reloadBoreholeDetail = useCallback(
    (id: string) => loadBoreholeDetail(id, { force: true }),
    [loadBoreholeDetail],
  )
  const trackEditing = useBoreholeTrackEdits({
    projectId: project?.id ?? null,
    pushUndo: pushTrackUndo,
    markMutated: markTrackMutated,
    reloadBoreholeDetail,
  })

  // Faded depth-context overlay for the detail pane — every formation
  // contact (geology) and litho contact anchored at the selected
  // investigation, sorted by depth. Computed once per (selection,
  // contact set) change; CptChart and BoreholeLog render them as
  // ReferenceLines / SVG <line>s in the formation's colour.
  const cptContactOverlays = useMemo(() => {
    if (selectedId === null) return undefined
    return filterContactOverlays(
      buildContactOverlays(
        geoContacts,
        geoFormations,
        lithoContacts,
        lithoFormations,
        selectedId,
        'cpt',
      ),
      contactOverlayVisibility.visibility,
    )
  }, [
    selectedId,
    geoContacts,
    geoFormations,
    lithoContacts,
    lithoFormations,
    contactOverlayVisibility.visibility,
  ])

  const boreholeContactOverlays = useMemo(() => {
    if (selectedBoreholeId === null) return undefined
    return filterContactOverlays(
      buildContactOverlays(
        geoContacts,
        geoFormations,
        lithoContacts,
        lithoFormations,
        selectedBoreholeId,
        'borehole',
      ),
      contactOverlayVisibility.visibility,
    )
  }, [
    selectedBoreholeId,
    geoContacts,
    geoFormations,
    lithoContacts,
    lithoFormations,
    contactOverlayVisibility.visibility,
  ])
  const drawingBbox = bboxImportType !== null
  const hasSelection = selectedId !== null || selectedBoreholeId !== null
  // A lab test deleted from the borehole's Lab tests list (owner 2026-10-04).
  // The delete wrote to the database: the project is dirty until File > Save
  // writes the .strix without the test (else the reopen restores it from the
  // old file), and the Data list re-reads the lab-test counts (flask icon).
  const handleLabTestDeleted = useCallback(
    (deleted: LabSeriesTestSummary): void => {
      markMutated?.()
      toasts.toast('success', t('labSeries.toast.deleted', { file: deleted.source_file_name }))
      void refreshBoreholeList?.()
    },
    [markMutated, toasts, t, refreshBoreholeList],
  )
  const handleOpenSectionFromMap = useCallback(
    (sectionId: string): void => {
      handleSelectSection(sectionId)
      setSectionsDeepLinkTarget({ sectionId, contactIds: [] })
    },
    [handleSelectSection, setSectionsDeepLinkTarget],
  )

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Map / Chart view-tab switcher — shown whenever a detail is open.
          It used to hide while a cross-section was selected (a leftover of
          the S5 era, when the section panel lived on this canvas), so a
          detail opened FROM a section — double-click a column, right-click
          → Open detail — had no way back to the map: Esc lands on the
          section. Owner 2026-09-10: "there is a chart/map button, it should
          always be clickable." */}
      {hasSelection && (
        <div className="flex items-center gap-1 px-3 py-1 border-b border-border-subtle bg-surface-card">
          <ViewTab
            icon={<MapIcon size={13} />}
            label={t('data.canvas.map')}
            active={view === 'map'}
            onClick={() => setView('map')}
          />
          <ViewTab
            icon={<BarChart2 size={13} />}
            label={t('data.canvas.chart')}
            active={view === 'chart'}
            onClick={() => setView('chart')}
          />
        </div>
      )}

      <div className="flex-1 overflow-hidden">
        {view === 'map' || !hasSelection ? (
          <MapView
            cpts={visibleCpts}
            boreholes={visibleBoreholes}
            selectedCptId={selectedId}
            selectedBoreholeId={selectedBoreholeId}
            onSelectCpt={handleSelect}
            onSelectBorehole={handleSelectBorehole}
            hiddenCptTypes={hiddenCptTypes}
            hiddenBoreholeValues={hiddenBoreholeValues}
            boreholeAxis={boreholeAxis}
            onToggleCptType={handleToggleCptType}
            onToggleBoreholeValue={handleToggleBoreholeValue}
            onChangeBoreholeAxis={setBoreholeAxis}
            drawMode={drawingBbox}
            onBboxDrawn={handleBboxDrawn}
            onCancelDraw={cancelBboxDraw}
            onViewportChange={handleViewportChange}
            demSource={demSource}
            demOverlay={demOverlay}
            onDemOverlayChange={handleDemOverlayChange}
            drawSectionMode={drawingSection}
            onSectionLineDrawn={handleSectionLineDrawn}
            onCancelSectionDraw={cancelSectionDraw}
            drawBedMode={bedOverrides?.drawing ?? false}
            onBedPolygonDrawn={bedOverrides?.handlePolygonDrawn}
            onCancelBedDraw={bedOverrides?.cancelDrawing}
            bedOverrides={bedOverrides?.overrides}
            sections={visibleSections}
            selectedSectionId={selectedSectionId}
            // A click on a section line OPENS the section (owner 2026-09-04):
            // select it here, and ask the shell for the Sections stage through
            // the deep link AppShell already consumes (stage switch + select).
            onSelectSection={handleOpenSectionFromMap}
            initialCenter={mapCameraRef.current?.center}
            initialZoom={mapCameraRef.current?.zoom}
            onCameraChange={handleMapCameraChange}
            marqueeSelectedIds={marqueeSelectedIds}
            onMarqueeSelect={setMarqueeSelectedIds}
            hoveredTestId={hoveredTestId}
            projectEpsg={effectiveHorizontalEpsg}
            pendingCptPins={pendingCptPins}
          />
        ) : selectedBoreholeId ? (
          boreholeDetailMap.has(selectedBoreholeId) ? (
            <BoreholeLog
              borehole={boreholeDetailMap.get(selectedBoreholeId)!}
              onElevationChange={(elevationM, zEpsg) =>
                handlePatchBoreholeElevation(selectedBoreholeId, elevationM, zEpsg)
              }
              virtueleBoringPrediction={
                virtueleBoringPredictionByInvestigationId.get(selectedBoreholeId) ?? null
              }
              virtueleBoringActiveModels={boreholeEffectiveModels}
              virtueleBoringMaxDepthM={virtueleBoringOverlay.maxDepthM}
              virtueleBoringVisible={showOverlayOnBorehole}
              onToggleVirtueleBoringVisible={() =>
                handleSetShowOverlay('borehole', !showOverlayOnBorehole)
              }
              virtueleBoringOverrideModel={boreholeVirtueleBoringOverride}
              onChangeVirtueleBoringOverrideModel={next =>
                handleSetOverlayOverride('borehole', next)
              }
              virtueleBoringLoading={virtueleBoringLoading}
              contactOverlays={boreholeContactOverlays}
              contactOverlayVisibility={contactOverlayVisibility.visibility}
              onToggleContactOverlay={contactOverlayVisibility.toggle}
              trackEditing={trackEditing}
              projectId={project?.id}
              onLabTestDeleted={handleLabTestDeleted}
            />
          ) : (
            <LoadingState label={t('data.canvas.loadingBorehole')} />
          )
        ) : selectedCpt && plotMap.has(selectedId!) ? (
          <CptChart
            plot={plotMap.get(selectedId!)!}
            name={selectedCpt.name}
            detail={detailMap.get(selectedId!)}
            onElevationChange={(elevationM, zEpsg) =>
              handlePatchCptElevation(selectedId!, elevationM, zEpsg)
            }
            virtueleBoringPrediction={
              virtueleBoringPredictionByInvestigationId.get(selectedId!) ?? null
            }
            virtueleBoringActiveModels={cptEffectiveModels}
            virtueleBoringMaxDepthM={virtueleBoringOverlay.maxDepthM}
            virtueleBoringVisible={showOverlayOnCpt}
            onToggleVirtueleBoringVisible={() =>
              handleSetShowOverlay('cpt', !showOverlayOnCpt)
            }
            virtueleBoringOverrideModel={cptVirtueleBoringOverride}
            onChangeVirtueleBoringOverrideModel={next =>
              handleSetOverlayOverride('cpt', next)
            }
            virtueleBoringLoading={virtueleBoringLoading}
            contactOverlays={cptContactOverlays}
            contactOverlayVisibility={contactOverlayVisibility.visibility}
            onToggleContactOverlay={contactOverlayVisibility.toggle}
          />
        ) : (
          <LoadingState label={t('data.canvas.loadingChart')} />
        )}
      </div>

      {/* DOV import status — NON-blocking, bottom-centre. The import runs
          as a background job (architect Phase 2); this is a status report
          only. Deliberately NOT a Modal: no backdrop, no pointer-events
          overlay, no role="dialog", no focus steal — the user can pan the
          map and inspect other tests while the import streams. Shown while
          running and kept up after done/error until the user dismisses so
          they can read the summary. Pins still render on the map behind
          it. z-[1100] matches the toast-notification convention. */}
      {dovImportState.status !== 'idle' && (
        <div
          // role=status + the panel's own aria-live regions announce
          // progress/result without trapping focus — correct semantics
          // for a non-blocking status, unlike the prior role=dialog.
          role="status"
          aria-label={t('data.import.status')}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[1100] w-80 bg-surface-overlay border border-border-default text-text-primary rounded-lg shadow-lg px-5 py-4 flex flex-col gap-3"
        >
          <h2 className="text-sm font-semibold text-text-primary">
            {dovImportState.status === 'running'
              ? dovImportState.kind === 'cpt'
                ? t('data.import.importingCpts')
                : t('data.import.importingBoreholes')
              : dovImportState.status === 'done'
              ? t('data.import.complete')
              : t('data.import.importFailed')}
          </h2>

          <DovImportProgressPanel state={dovImportState} />

          {/* Dismiss only once terminal so the running import can't be
              closed by a stray click; no autoFocus — a non-blocking
              status must never steal focus from the map/list. */}
          {dovImportState.status !== 'running' && (
            <div className="flex justify-end pt-1">
              <button
                onClick={resetDovImport}
                className="px-3 py-1.5 text-xs font-medium rounded bg-surface-card text-text-primary hover:bg-border-default transition-colors"
              >
                {t('common.close')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// The Map / Chart view tab lives in ``components/ui/ViewTab`` since 2026-09-10 —
// the Sections stage shows the same strip (Map | Section).
