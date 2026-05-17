// Sections stage canvas.
//
// Reproduces the ``selectedSection !== null ? <SectionPanel .../>`` branch
// from App.tsx at commit 3322e04^ verbatim, now sourcing every prop from the
// ShellContext bus via useShell() — exactly the pattern DataCanvas used for
// the map/chart/borelog branch.
//
// When no section is selected the canvas shows the project map so the user
// can see where to draw a new cross-section (same affordance as the Data
// stage — sections are spatial objects that start on the map).  The map
// renders in "section selection" mode: drawSectionMode wires the line-draw
// interaction, and onSelectSection highlights an existing section.
//
// The no-section fallback overlays a call-to-action card that surfaces the
// "New cross-section" entry action directly on the canvas, removing the need
// to hunt for the toolbar button.  The card's pointer-events are isolated
// (pointer-events-none on the wrapper, pointer-events-auto on the card) so
// the map's draw / click / pan / zoom interactions work through the overlay.
//
// The wrapped SectionPanel receives zero internal changes — all its props are
// wired from the bus.  The component never gains a direct prop; it reads from
// useShell() and delegates.

import { useMemo, useState } from 'react'

import { useShell } from '../../ShellContext'
import SectionPanel from '../../../components/SectionPanel'
import MapView from '../../../components/MapView'
import { sectionCrsBlockReason } from '../../../utils/horizontalCrs'

/**
 * Center canvas for the Sections stage.
 *
 * Renders ``SectionPanel`` when a section is selected; falls back to
 * ``MapView`` (section-draw mode) when nothing is selected so the user can
 * pick or draw a cross-section.
 *
 * All props are sourced from the ShellContext bus — no props are accepted
 * directly (matches the ``StageDescriptor.CanvasComponent`` contract).
 *
 * Returns
 * -------
 * JSX.Element
 *     The sections canvas element.
 */
export default function SectionsCanvas(): JSX.Element {
  const {
    project,
    visibleCpts,
    visibleBoreholes,
    geoModel: {
      activeGeologicalModel,
      activeLithoModel,
      formations,
      contacts,
      surfacesByFormationId,
      handleCreateContact,
      handleUpdateContactDepth,
      handleDeleteContact,
      handleBatchUpdateContacts,
      handleBatchCreateContacts,
      handleAutoPopulateFromStratigraphy,
      handleInlineCreateFormation,
      lithoContacts,
      lithoFormations,
      lithoSurfacesByFormationId,
      handleCreateLithoContact,
      handleInlineLithoCreateFormation,
      lithoSuggestions,
      lithoSuggestionInvestigationId,
      lithoSuggestionAccepted,
      lithoSuggestionRejected,
      handleAcceptLithoSuggestion,
      handleRejectLithoSuggestion,
    },
    sections: {
      sections,
      selectedSectionId,
      drawingSection,
      focusedContactIds,
      effectiveHorizontalEpsg,
      sectionModelAxis,
      clearSectionSelection,
      handlePatchSelectedSection,
      handleSectionLineDrawn,
      cancelSectionDraw,
      handleSelectSection,
      handleCreateSection,
    },
    overlays: {
      virtueleBoringSectionModels,
      virtueleBoringPredictions,
      virtueleBoringOverlay,
      showOverlayOnSection,
      handleChangeVirtueleBoringPicker,
      handleSetShowOverlay,
      demSource,
      demOverlay,
      handleDemOverlayChange,
    },
    coordinator: {
      selectedId,
      selectedBoreholeId,
      handleSelect,
      handleSelectBorehole,
      handleExportSectionDxf,
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
    investigations: {
      bboxImportType,
      cancelBboxDraw,
      handleBboxDrawn,
    },
  } = useShell()

  // CTA card dismiss state — the overlay disappears once the user has
  // started drawing or explicitly clicked "New cross-section" on the
  // card itself. Resets when the canvas mounts (i.e. the user navigates
  // to the Sections stage) so new users always see the prompt.
  const [ctaDismissed, setCtaDismissed] = useState(false)

  // Sections need a projected METRIC horizontal CRS — same gate as the
  // toolbar (debt #31). Degrees (EPSG:4326) would silently produce
  // garbage along-section geometry, so gate on the supported-CRS
  // allowlist, not merely "a CRS is set".
  const crsBlockReason = sectionCrsBlockReason(effectiveHorizontalEpsg)
  const canCreate = crsBlockReason === null
  const [ctaCreating, setCtaCreating] = useState(false)

  async function handleCtaNew(): Promise<void> {
    if (!canCreate || ctaCreating) return
    setCtaDismissed(true)
    setCtaCreating(true)
    try {
      const created = await handleCreateSection()
      if (created) handleSelectSection(created.id)
    } finally {
      setCtaCreating(false)
    }
  }

  // Resolve the currently-selected section object from the id + list.
  // Mirrors the ``selectedSection`` memo in App.tsx at 3322e04^.
  const selectedSection = useMemo(
    () =>
      selectedSectionId ? sections.find(s => s.id === selectedSectionId) ?? null : null,
    [selectedSectionId, sections],
  )

  // Slice 2 (#55): axis-aware contact/formation/surface routing.
  // SectionPanel and ContactsLayer are UNCHANGED — the prop boundary absorbs
  // the switch. Geological is the default and existing behaviour is identical.
  const isLitho = sectionModelAxis === 'lithostratigraphic'
  // Active model for the chosen axis — used for export button gating.
  const activeAxisModel = isLitho ? activeLithoModel : activeGeologicalModel
  // Contact/formation/surface sets routed by axis.
  const axisContacts = isLitho ? lithoContacts : contacts
  const axisFormations = isLitho ? lithoFormations : formations
  const axisSurfacesByFormationId = isLitho ? lithoSurfacesByFormationId : surfacesByFormationId
  const axisExcludedBoreholeIds = activeAxisModel?.excluded_borehole_ids ?? []
  const axisCreateContact = isLitho ? handleCreateLithoContact : handleCreateContact
  const axisCreateFormation = isLitho ? handleInlineLithoCreateFormation : handleInlineCreateFormation

  // Slice 3 (#55): resolve the surface elevation for the suggestion target so
  // the ghost overlay can convert depth-below-surface → absolute mTAW level.
  // Searches both visible lists; null when the investigation isn't loaded yet.
  const lithoGhostSurfaceElevationM = useMemo(() => {
    if (!lithoSuggestionInvestigationId) return null
    const cpt = visibleCpts.find(c => c.id === lithoSuggestionInvestigationId)
    if (cpt) return cpt.elevation_m
    const bh = visibleBoreholes.find(b => b.id === lithoSuggestionInvestigationId)
    return bh?.elevation_m ?? null
  }, [lithoSuggestionInvestigationId, visibleCpts, visibleBoreholes])

  // Build the lithoGhostState bundle passed to SectionPanel.
  // Only populated on the litho axis when suggestions are loaded for an
  // investigation — zero regression on the geological axis.
  const lithoGhostState = useMemo(() => {
    if (!isLitho || lithoSuggestions.length === 0 || !lithoSuggestionInvestigationId) return undefined
    return {
      suggestions: lithoSuggestions,
      investigationId: lithoSuggestionInvestigationId,
      surfaceElevationM: lithoGhostSurfaceElevationM,
      acceptedIndices: lithoSuggestionAccepted,
      rejectedIndices: lithoSuggestionRejected,
      onAccept: handleAcceptLithoSuggestion,
      onReject: handleRejectLithoSuggestion,
    }
  }, [
    isLitho,
    lithoSuggestions,
    lithoSuggestionInvestigationId,
    lithoGhostSurfaceElevationM,
    lithoSuggestionAccepted,
    lithoSuggestionRejected,
    handleAcceptLithoSuggestion,
    handleRejectLithoSuggestion,
  ])

  if (selectedSection !== null) {
    return (
      <SectionPanel
        section={selectedSection}
        zEpsg={project.default_vertical_epsg}
        cpts={visibleCpts}
        boreholes={visibleBoreholes}
        onPatch={handlePatchSelectedSection}
        onClose={clearSectionSelection}
        onSelectCpt={handleSelect}
        onSelectBorehole={handleSelectBorehole}
        contacts={axisContacts}
        formations={axisFormations}
        surfacesByFormationId={axisSurfacesByFormationId}
        focusedContactIds={focusedContactIds}
        excludedBoreholeIds={axisExcludedBoreholeIds}
        onCreateContact={axisCreateContact}
        onUpdateContactDepth={handleUpdateContactDepth}
        onDeleteContact={handleDeleteContact}
        onBatchUpdateContacts={handleBatchUpdateContacts}
        onBatchCreateContacts={handleBatchCreateContacts}
        // Seed from stratigraphy: only available on the geological axis
        // (the litho axis has its own suggest-litho flow). On the litho
        // axis the prop is undefined and the button stays disabled.
        onAutoPopulateFromStratigraphy={
          !isLitho && formations.length > 0 ? handleAutoPopulateFromStratigraphy : undefined
        }
        onCreateFormation={axisCreateFormation}
        onExportDxf={
          activeAxisModel
            ? () =>
                handleExportSectionDxf(
                  project.id,
                  selectedSection.id,
                  selectedSection.name,
                  activeAxisModel.id,
                )
            : undefined
        }
        virtueleBoringActiveModels={virtueleBoringSectionModels}
        virtueleBoringPredictions={virtueleBoringPredictions}
        virtueleBoringModelA={virtueleBoringOverlay.modelA}
        virtueleBoringModelB={virtueleBoringOverlay.modelB}
        virtueleBoringMaxDepthM={virtueleBoringOverlay.maxDepthM}
        virtueleBoringShowOnSection={showOverlayOnSection}
        onChangeVirtueleBoringPicker={handleChangeVirtueleBoringPicker}
        onChangeVirtueleBoringShowOnSection={next =>
          handleSetShowOverlay('section', next)
        }
        lithoGhostState={lithoGhostState}
      />
    )
  }

  // No section selected — show the map so the user can draw a new line
  // or click an existing section marker.  Bbox-draw props are threaded
  // through so DOV imports also work from the Sections stage.
  //
  // The CTA card overlays the map and is dismissed once a section exists
  // or the user explicitly clicks "New cross-section" on it. The wrapper
  // div is pointer-events-none so the map remains fully interactive; only
  // the card itself receives pointer events (pointer-events-auto).
  const drawingBbox = bboxImportType !== null
  const showCta = !ctaDismissed && sections.length === 0 && !drawingSection && !drawingBbox

  return (
    <div className="relative h-full w-full">
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
      />

      {/* Empty-state CTA — pointer-events-none on the wrapper keeps
          the map interactive; pointer-events-auto on the card itself
          lets the user click "New cross-section" without fighting the
          map's pan/zoom handlers. Hides automatically once a section
          exists or once the user draws / imports. */}
      {showCta && (
        <div className="absolute inset-0 flex items-end justify-center pb-12 pointer-events-none z-[500]">
          <div
            className="pointer-events-auto bg-surface-overlay border border-border-default rounded-lg shadow-lg px-5 py-4 max-w-sm text-center"
          >
            <p className="text-sm font-medium text-text-primary mb-1">
              No cross-sections yet
            </p>
            <p className="text-xs text-text-secondary mb-3">
              Draw a line on the map to define a section, or create one with placeholder endpoints to start.
            </p>
            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => void handleCtaNew()}
                disabled={!canCreate || ctaCreating}
                className={[
                  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                  !canCreate || ctaCreating
                    ? 'bg-accent/40 text-text-on-accent cursor-not-allowed'
                    : 'bg-accent text-text-on-accent hover:bg-accent-muted',
                ].join(' ')}
                title={
                  crsBlockReason !== null
                    ? crsBlockReason
                    : ctaCreating
                      ? 'Creating…'
                      : 'Create a new cross-section with placeholder endpoints'
                }
              >
                + New cross-section
              </button>
              <button
                type="button"
                onClick={() => setCtaDismissed(true)}
                className="text-xs text-text-muted hover:text-text-secondary transition-colors"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
