// Data stage canvas — non-section main render.
//
// Reproduces the loaded-project canvas block from App.tsx at commit 3322e04^
// verbatim, now sourcing every prop from the ShellContext bus via useShell().
//
// The selectedSection !== null → SectionPanel branch is S5 (SectionsCanvas).
// In S4 this component only handles the Data stage: Map view, CPT chart, and
// Borehole log. When a section is selected the canvas intentionally does
// nothing special — SectionsCanvas (S5) owns that branch.

import { useMemo } from 'react'
import { Map as MapIcon, BarChart2 } from 'lucide-react'

import { useShell } from '../../ShellContext'
import { LoadingState } from '../../EmptyState'
import MapView from '../../../components/MapView'
import CptChart from '../../../components/CptChart'
import BoreholeLog from '../../../components/BoreholeLog'
import DovImportProgressPanel from '../../../components/DovImportProgressPanel'
import { buildContactOverlays } from '../../../utils/contactOverlays'
import { useT } from '../../../i18n/translate'

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
    visibleCpts,
    visibleBoreholes,
    investigations: {
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
      pendingCptPins,
    },
    coordinator: {
      selectedId,
      selectedBoreholeId,
      view,
      setView,
      handleSelect,
      handleSelectBorehole,
      marqueeSelectedIds,
      setMarqueeSelectedIds,
      hoveredTestId,
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
    },
    geoModel: {
      contacts: geoContacts,
      formations: geoFormations,
      lithoContacts,
      lithoFormations,
    },
  } = useShell()

  const selectedCpt = visibleCpts.find(c => c.id === selectedId)

  // Faded depth-context overlay for the detail pane — every formation
  // contact (geology) and litho contact anchored at the selected
  // investigation, sorted by depth. Computed once per (selection,
  // contact set) change; CptChart and BoreholeLog render them as
  // ReferenceLines / SVG <line>s in the formation's colour.
  const cptContactOverlays = useMemo(() => {
    if (selectedId === null) return undefined
    return buildContactOverlays(
      geoContacts,
      geoFormations,
      lithoContacts,
      lithoFormations,
      selectedId,
      'cpt',
    )
  }, [selectedId, geoContacts, geoFormations, lithoContacts, lithoFormations])

  const boreholeContactOverlays = useMemo(() => {
    if (selectedBoreholeId === null) return undefined
    return buildContactOverlays(
      geoContacts,
      geoFormations,
      lithoContacts,
      lithoFormations,
      selectedBoreholeId,
      'borehole',
    )
  }, [selectedBoreholeId, geoContacts, geoFormations, lithoContacts, lithoFormations])
  const drawingBbox = bboxImportType !== null
  const hasSelection = selectedId !== null || selectedBoreholeId !== null

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Map / Chart view-tab switcher — only shown when something is
          selected in the non-section flow. The section panel (S5) has its
          own header strip; this tab bar is irrelevant when a section is active. */}
      {hasSelection && selectedSectionId === null && (
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
            sections={visibleSections}
            selectedSectionId={selectedSectionId}
            onSelectSection={handleSelectSection}
            initialCenter={mapCameraRef.current?.center}
            initialZoom={mapCameraRef.current?.zoom}
            onCameraChange={handleMapCameraChange}
            marqueeSelectedIds={marqueeSelectedIds}
            onMarqueeSelect={setMarqueeSelectedIds}
            hoveredTestId={hoveredTestId}
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

// ---------------------------------------------------------------------------
// View tab (map / chart switcher)
// ---------------------------------------------------------------------------

function ViewTab({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={[
        'flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors',
        active
          ? // accent border (not border-subtle) so the selected-state
            // boundary clears WCAG 2.2 1.4.11 (3:1) in dark mode —
            // surface-app on surface-card is only ~1.4:1; the accent
            // border carries the state indication at ~6:1.
            'bg-surface-app border border-accent shadow-sm text-text-primary'
          : 'text-text-secondary hover:text-text-primary',
      ].join(' ')}
    >
      {icon}
      {label}
    </button>
  )
}
