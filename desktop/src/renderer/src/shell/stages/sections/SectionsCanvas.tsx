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

import { useCallback, useMemo, useState } from 'react'
import { Loader2, Route } from 'lucide-react'

import { api } from '../../../api/client'
import { useShell } from '../../ShellContext'
import SectionPanel from '../../../components/SectionPanel'
import type { ContactCopyPayload } from '../../../components/sections/ContactsLayer'
import MapView from '../../../components/MapView'
import { sectionCrsBlockReason } from '../../../utils/horizontalCrs'
import { log } from '../../../utils/log'

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
      // WHY visibleSections not sections: both the map overlay and the section
      // count/CTA in SectionsCanvas must use the same manifest-gated set that
      // SectionsInspector reads.  Raw `sections` includes every DB row loaded
      // this session and would keep unsaved section polygons on the map after
      // discard, while the inspector showed 0 — the desync the owner reported.
      visibleSections,
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
      applyUpdatedSection,
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
  // Uses visibleSections (manifest-gated) — if a section is not saved it is
  // not selectable, consistent with the CPT/borehole pattern.
  const selectedSection = useMemo(
    () =>
      selectedSectionId ? visibleSections.find(s => s.id === selectedSectionId) ?? null : null,
    [selectedSectionId, visibleSections],
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

  // P2-F — explicit-content filter (owner directive 2026-05-17).
  //
  // WHY filter at this data-boundary:
  //   The contacts list is loaded model-wide (all contacts in the active
  //   geological/litho model), which is correct for the Build/TIN path
  //   (Delaunay needs ALL anchors across the model). The section render
  //   and export path must only show contacts the user explicitly placed on
  //   THIS section via Seed or manual draw — stored in
  //   seeded_formation_contact_ids. Without this filter every contact in
  //   the model renders on every section, violating the owner directive:
  //   "nothing on a section without the user clicking a button on that section".
  //
  // Stale-id tolerance mirrors Option (b) from the snapshot rule: a contact
  // deleted from the model after being seeded is simply absent from axisContacts
  // — filtering by id-membership naturally skips it, no crash.
  const sectionContactIds = useMemo(
    () => new Set(selectedSection?.seeded_formation_contact_ids ?? []),
    [selectedSection],
  )
  const sectionContacts = useMemo(
    () =>
      selectedSection !== null && sectionContactIds.size > 0
        ? axisContacts.filter(c => sectionContactIds.has(c.id))
        : [],
    [selectedSection, sectionContactIds, axisContacts],
  )

  // P2-H — section-aware contact draw.
  //
  // The plain axisCreateContact passes no section context.  This wrapper
  // passes section_id so the backend (P2-E) seeds seeded_formation_contact_ids,
  // then fetches the updated section row and calls applyUpdatedSection so P2-F's
  // filter immediately reflects the new contact on this render cycle.
  //
  // WHY a GET after draw (not optimistic): handleCreateContact does not
  // expose the created contact id to its caller (returns void); the backend
  // seeds the section in the same request (union pattern), so one GET is the
  // authoritative post-draw state.  For a single manual draw this is cheap.
  const sectionAwareCreateContact = useCallback(
    async (
      anchorKind: 'cpt' | 'borehole',
      anchorId: string,
      depth_m: number,
      formationId: string,
      snapped: boolean,
    ): Promise<void> => {
      if (selectedSection === null) return
      // Pass the section id so the backend seeds seeded_formation_contact_ids
      // (P2-E). Without this the create succeeds but the P2-F filter below
      // hides the new contact — the root cause of the "draw/copy does
      // nothing" dogfeed bug: the threading stopped here and never reached
      // the create body.
      await axisCreateContact(
        anchorKind,
        anchorId,
        depth_m,
        formationId,
        snapped,
        selectedSection.id,
      )
      // Fetch the authoritative section row so seeded_formation_contact_ids
      // includes the contact that was just drawn (backend seeded it in P2-E).
      try {
        const refreshed = await api.section.get(project.id, selectedSection.id)
        applyUpdatedSection(refreshed)
        log.debug(
          'section',
          `sectionAwareCreateContact: section ${selectedSection.id} seeded set refreshed`,
        )
      } catch (err) {
        // Non-fatal: the contact exists in the model; only the section's
        // rendered contact list is stale.  A Seed or page refresh corrects it.
        log.warn('section', 'sectionAwareCreateContact: section refresh after draw failed', err)
      }
    },
    [selectedSection, axisCreateContact, project.id, applyUpdatedSection],
  )

  // P2-H (batch) — section-aware contact COPY (drag-to-next-test: one-by-one,
  // marquee batch, shift-drag all funnel through onBatchCreateContacts).
  // Mirrors sectionAwareCreateContact: thread the section id so the backend
  // seeds every copied id, then ONE section GET so P2-F's filter shows them
  // all on the next render. This was the missing wiring — the plain
  // handleBatchCreateContacts created contacts the filter then dropped.
  const sectionAwareBatchCreateContacts = useCallback(
    async (creates: readonly ContactCopyPayload[]): Promise<void> => {
      if (selectedSection === null) return
      await handleBatchCreateContacts(creates, selectedSection.id)
      try {
        const refreshed = await api.section.get(project.id, selectedSection.id)
        applyUpdatedSection(refreshed)
        log.debug(
          'section',
          `sectionAwareBatchCreateContacts: section ${selectedSection.id} seeded set refreshed`,
        )
      } catch (err) {
        log.warn(
          'section',
          'sectionAwareBatchCreateContacts: section refresh after copy failed',
          err,
        )
      }
    },
    [selectedSection, handleBatchCreateContacts, project.id, applyUpdatedSection],
  )

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
        contacts={sectionContacts}
        formations={axisFormations}
        surfacesByFormationId={axisSurfacesByFormationId}
        focusedContactIds={focusedContactIds}
        excludedBoreholeIds={axisExcludedBoreholeIds}
        onCreateContact={sectionAwareCreateContact}
        onUpdateContactDepth={handleUpdateContactDepth}
        onDeleteContact={handleDeleteContact}
        onBatchUpdateContacts={handleBatchUpdateContacts}
        onBatchCreateContacts={sectionAwareBatchCreateContacts}
        // Seed from stratigraphy: only available on the geological axis
        // (the litho axis has its own suggest-litho flow). On the litho
        // axis the prop is undefined and the button stays disabled.
        //
        // P2-G: pass selectedSection.id as sectionId so the router seeds
        // seeded_formation_contact_ids and returns updated_section.
        // applyUpdatedSection patches local section state from the response
        // without a refetch GET — the section's seeded set is immediately
        // current so P2-F's filter picks up the new contacts on the next render.
        onAutoPopulateFromStratigraphy={
          !isLitho && formations.length > 0
            ? (boreholeIds) =>
                handleAutoPopulateFromStratigraphy(
                  boreholeIds,
                  selectedSection.id,
                  applyUpdatedSection,
                )
            : undefined
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
  const showCta = !ctaDismissed && visibleSections.length === 0 && !drawingSection && !drawingBbox

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
        sections={visibleSections}
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
            <Route
              className="h-5 w-5 text-text-muted mx-auto mb-2"
              aria-hidden="true"
            />
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
                {ctaCreating ? (
                  <>
                    <Loader2
                      className="h-3 w-3 animate-spin"
                      aria-hidden="true"
                    />
                    Creating…
                  </>
                ) : (
                  '+ New cross-section'
                )}
              </button>
              <button
                type="button"
                onClick={() => setCtaDismissed(true)}
                className="text-xs text-text-muted hover:text-text-secondary transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
