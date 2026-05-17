// Data stage canvas — non-section main render.
//
// Reproduces the loaded-project canvas block from App.tsx at commit 3322e04^
// verbatim, now sourcing every prop from the ShellContext bus via useShell().
//
// The selectedSection !== null → SectionPanel branch is S5 (SectionsCanvas).
// In S4 this component only handles the Data stage: Map view, CPT chart, and
// Borehole log. When a section is selected the canvas intentionally does
// nothing special — SectionsCanvas (S5) owns that branch.

import { Map as MapIcon, BarChart2 } from 'lucide-react'

import { useShell } from '../../ShellContext'
import { LoadingState } from '../../EmptyState'
import MapView from '../../../components/MapView'
import CptChart from '../../../components/CptChart'
import BoreholeLog from '../../../components/BoreholeLog'
import Modal from '../../../components/ui/Modal'
import DovImportProgressPanel from '../../../components/DovImportProgressPanel'

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
      sections,
      selectedSectionId,
      drawingSection,
      handleSectionLineDrawn,
      cancelSectionDraw,
      handleSelectSection,
    },
  } = useShell()

  const selectedCpt = visibleCpts.find(c => c.id === selectedId)
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
            label="Map"
            active={view === 'map'}
            onClick={() => setView('map')}
          />
          <ViewTab
            icon={<BarChart2 size={13} />}
            label="Chart"
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
            sections={sections}
            selectedSectionId={selectedSectionId}
            onSelectSection={handleSelectSection}
            initialCenter={mapCameraRef.current?.center}
            initialZoom={mapCameraRef.current?.zoom}
            onCameraChange={handleMapCameraChange}
            marqueeSelectedIds={marqueeSelectedIds}
            onMarqueeSelect={setMarqueeSelectedIds}
            hoveredTestId={hoveredTestId}
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
            />
          ) : (
            <LoadingState label="Loading borehole…" />
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
          />
        ) : (
          <LoadingState label="Loading chart…" />
        )}
      </div>

      {/* DOV import progress modal — shown while an SSE import stream is
          running, and kept open on done/error so the user can read the
          result summary or error message before dismissing.
          The modal is non-dismissable while running (busy=true) so the
          user can't accidentally cancel by pressing Esc or clicking the
          backdrop mid-import. */}
      <Modal
        open={dovImportState.status !== 'idle'}
        onCancel={resetDovImport}
        labelledBy="dov-import-progress-title"
        busy={dovImportState.status === 'running'}
        cardClassName="w-80"
      >
        <div className="px-5 py-4 flex flex-col gap-3">
          <h2
            id="dov-import-progress-title"
            className="text-sm font-semibold text-text-primary"
          >
            {dovImportState.status === 'running'
              ? dovImportState.kind === 'cpt'
                ? 'Importing CPTs from DOV…'
                : 'Importing boreholes from DOV…'
              : dovImportState.status === 'done'
              ? 'Import complete'
              : 'Import failed'}
          </h2>

          <DovImportProgressPanel state={dovImportState} />

          {/* Dismiss button — only shown once the stream has terminated so
              the user can acknowledge the result without accidentally closing
              a running import. */}
          {dovImportState.status !== 'running' && (
            <div className="flex justify-end pt-1">
              <button
                onClick={resetDovImport}
                className="px-3 py-1.5 text-xs font-medium rounded bg-surface-card text-text-primary hover:bg-border-default transition-colors"
                // reason: autoFocus is the only accessible way to let
                // keyboard users dismiss without mousing to the button.
                // The import is terminal (done/error) at this point, so
                // focus landing here is the natural next action.
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
              >
                Close
              </button>
            </div>
          )}
        </div>
      </Modal>
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
