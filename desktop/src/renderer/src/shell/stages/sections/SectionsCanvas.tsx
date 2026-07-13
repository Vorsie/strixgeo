// Sections stage canvas.
//
// Reproduces the ``selectedSection !== null ? <SectionPanel .../>`` branch
// from App.tsx at commit 3322e04^ verbatim, now sourcing every prop from the
// ShellContext bus via useShell() â€” exactly the pattern DataCanvas used for
// the map/chart/borelog branch.
//
// When no section is selected the canvas shows the project map so the user
// can see where to draw a new cross-section (same affordance as the Data
// stage â€” sections are spatial objects that start on the map).  The map
// renders in "section selection" mode: drawSectionMode wires the line-draw
// interaction, and onSelectSection highlights an existing section.
//
// The no-section fallback overlays a call-to-action card that surfaces the
// "New cross-section" entry action directly on the canvas, removing the need
// to hunt for the toolbar button.  The card's pointer-events are isolated
// (pointer-events-none on the wrapper, pointer-events-auto on the card) so
// the map's draw / click / pan / zoom interactions work through the overlay.
//
// The wrapped SectionPanel receives zero internal changes â€” all its props are
// wired from the bus.  The component never gains a direct prop; it reads from
// useShell() and delegates.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Route } from 'lucide-react'

import { api } from '../../../api/client'
import type {
  AdmixtureItem,
  BodyBoundaryNode,
  BodyBoundaryResponse,
  BodyRenderStyle,
  LithoContactCorrelationEdge,
  BodyListItem,
} from '../../../api/client'
import type {
  ContactGestureState,
} from '../../../components/sections/CorrelationEdgesOverlay'
import LithoGeoSnapDialog from '../../../components/LithoGeoSnapDialog'
import { findGeoSnapCandidates } from '../../../utils/lithoGeoSnap'
import { readLithoSegmenterPrefs } from '../../../utils/lithoSegmenterPrefs'
import type { FormationContactResponse } from '../../../api/client'
import CompanionOfferDialog from '../../../components/sections/CompanionOfferDialog'
import NameBodyDialog from '../../../components/sections/NameBodyDialog'
import InspectLensBodyPanel from '../../../components/sections/InspectLensBodyPanel'
import type { InspectLensBodyTarget } from '../../../components/sections/InspectLensBodyPanel'
import { useShell } from '../../ShellContext'
import SectionPanel from '../../../components/SectionPanel'
import type { ContactCopyPayload } from '../../../components/sections/ContactsLayer'
import MapView from '../../../components/MapView'
import { sectionCrsBlockReason } from '../../../utils/horizontalCrs'
import { inCorridorInvestigationIds } from '../../../utils/sectionClassification'
import { markBoreholesStale } from '../../../utils/boreholesStaleStore'
import { log } from '../../../utils/log'

/**
 * Center canvas for the Sections stage.
 *
 * Renders ``SectionPanel`` when a section is selected; falls back to
 * ``MapView`` (section-draw mode) when nothing is selected so the user can
 * pick or draw a cross-section.
 *
 * All props are sourced from the ShellContext bus â€” no props are accepted
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
      // #160: flag section-local mutations (correlation create/delete,
      // lens-shape edits) dirty so a close-without-save reverts them.
      markMutated,
      handleUnlinkLithoFromGeo,
      handleLinkLithoToGeo,
      handleBatchUpdateContacts,
      handleBatchCreateContacts,
      handleAutoPopulateFromStratigraphy,
      handleInlineCreateFormation,
      lithoContacts,
      lithoLayers,
      lithoCrossingPinchOuts,
      lithoFormations,
      lithoSurfacesByFormationId,
      // F3 â€” geotech axis: layers, contacts + formations from the bus for
      // the third section render axis.  requestGeotechLayersRefetch is called
      // after a packing-correlation mutation so body_id stamps re-render.
      activeGeotechModel,
      geotechLayers,
      geotechContacts,
      geotechFormations,
      requestGeotechLayersRefetch,
      handleCreateLithoContact,
      handleInlineLithoCreateFormation,
      // Phase 2 of debt #77: the bus exposes the unified Map +
      // focused-anchor flag; "focused" entry and "bulk subset" are
      // derived locally below.
      ghostsByAnchor,
      focusedSuggestAnchorId,
      handleEditLithoSuggestion,
      handleAcceptLithoSuggestion,
      handleRejectLithoSuggestion,
      handleSuggestAllLitho,
      handleAcceptBulkLitho,
      refetchLithoContacts,
      handleAcceptAllBulkLitho,
      handleRejectBulkLitho,
      handleEditBulkLitho,
      handleInsertLithoLayer,
      handleSplitLithoLayer,
      handleMergeLithoLayers,
      handleAbsorbLithoLayer,
      handleCreateManualLithoGhost,
      handleExtendLithoGhostToNearestContacts,
      clearBulkLithoGhosts,
      backdropSurfacesByFormationId,
      handleLoadBackdropSurfaces,
      refetchFormations,
      lithoSolids,
    },
    sections: {
      // WHY visibleSections not sections: both the map overlay and the section
      // count/CTA in SectionsCanvas must use the same manifest-gated set that
      // SectionsInspector reads.  Raw `sections` includes every DB row loaded
      // this session and would keep unsaved section polygons on the map after
      // discard, while the inspector showed 0 â€” the desync the owner reported.
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
      refreshSectionList,
      handleSectionCreated,
      backdropModelIdOverride,
      setSectionFocusedColumn,
      correlateMode,
      correlationSource,
      enterCorrelateMode,
      exitCorrelateMode,
      armCorrelationSource,
      clearCorrelationSource,
      suggestedTies,
      handleAcceptTie,
      handleRejectTie,
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
      setGeoDeepLinkTarget,
      correlationEdgesRefetchNonce,
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
    toasts: { toast },
    undo: undoStack,
  } = useShell()

  // CTA card dismiss state â€” the overlay disappears once the user has
  // started drawing or explicitly clicked "New cross-section" on the
  // card itself. Resets when the canvas mounts (i.e. the user navigates
  // to the Sections stage) so new users always see the prompt.
  const [ctaDismissed, setCtaDismissed] = useState(false)

  // Companion-offer dialog state â€” opened after a lens is created (Blocker 1,
  // owner directive 2026-05-22: "pop up an offer to auto-create a perpendicular
  // cross-section").  Null when the dialog is not open.
  const [companionOffer, setCompanionOffer] = useState<{
    lensId: string
    lensName: string | null
    modelId: string
  } | null>(null)

  // Name-body dialog state (dogfeed 2026-06-01) â€” replaces the dead-end
  // window.prompt (Electron disables prompt()). Non-null while the dialog is
  // open; carries the body id + its current name for the rename pre-fill.
  const [namingBody, setNamingBody] = useState<{ id: string; currentName: string } | null>(null)

  // Inspect-lens-body panel state (#101 Blocker 1) â€” opened by right-clicking
  // a body chip in CorrelationEdgesOverlay â†’ "Inspect lens bodyâ€¦".
  // Carries the lens list fetched lazily on open so the panel can show the
  // existing name (if any) and enable the perpendicular-companion path.
  const [inspectTarget, setInspectTarget] = useState<InspectLensBodyTarget | null>(null)
  const [inspectLenses, setInspectLenses] = useState<BodyListItem[]>([])

  // Sections need a projected METRIC horizontal CRS â€” same gate as the
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
  // Uses visibleSections (manifest-gated) â€” if a section is not saved it is
  // not selectable, consistent with the CPT/borehole pattern.
  const selectedSection = useMemo(
    () =>
      selectedSectionId ? visibleSections.find(s => s.id === selectedSectionId) ?? null : null,
    [selectedSectionId, visibleSections],
  )


  // Axis flags â€” defined early so downstream blocks can use them.
  // isGeotech: the third, view-only axis showing NAD-coloured bands.
  const isLitho = sectionModelAxis === 'lithostratigraphic'
  const isGeotech = sectionModelAxis === 'geotechnical'

  // Key the fetch on the model IDs, not the model objects: the objects
  // re-identify on unrelated mutations (e.g. a formation rename rebuilds
  // them), which would churn the contact-edge refetch unnecessarily.
  const lithoModelId = activeLithoModel?.id ?? null

  // The partition SHAPE always comes from the LITHO model (layers + edges).
  //
  // On the geotech axis (owner-locked 2026-07-06 â€” the fraction-space
  // refinement) the LITHO partition is the base: `PartitionFillOverlay` builds
  // it here, then REFINES it by NAD packing class internally (each litho region
  // subdivided by the geotech sub-bands â€” litho boundaries invariant). This
  // REPLACES the 2026-06-26 "Task-3 render swap" that ran `computeSectionFill`
  // on the geotech layers + geotech packing edges directly â€” that approach
  // could not express lens-in-pack, deformed litho boundaries, and dropped all
  // borehole-mediated connectivity (proven on the real CS1). The geotech
  // packing OVERLAY edges (`geotechPackingEdges`) stay separate â€” see below.
  const activeSectionModelId = lithoModelId
  const sectionLayers = lithoLayers

  // The contact-edge list FRAMES the partition fill (`computeSectionFill` builds
  // the connected bands from it) and the correlated-pair column spacing. It is
  // ALWAYS the LITHO model's edges now (on both axes â€” the geotech partition is
  // the litho partition refined). The geotech "Correlate packing" overlay reads
  // `geotechPackingEdges` (fetched separately from `geotechPackingModelId`);
  // nothing here feeds that overlay.
  const correlationModelId = activeSectionModelId

  // Geotech fraction-space refinement bundle (owner-locked 2026-07-06). On the
  // geotech axis PartitionFillOverlay refines the litho partition by NAD packing
  // class using these three maps: the geotech sub-band rows, the geotech
  // formation â†’ (NAD class, soil code) metadata, and the litho formation â†’ soil
  // code map (the hard soil-code guard so a sand region never carries a foreign
  // class). `undefined` off the geotech axis â†’ normal litho render.
  const geotechRefinement = useMemo(() => {
    if (!isGeotech) return undefined
    const nadMeta = new Map<string, { nadClass: number | null; soilCode: string | null }>()
    for (const f of geotechFormations) {
      nadMeta.set(f.id, { nadClass: f.nad_class ?? null, soilCode: f.litho_main_soil_code ?? null })
    }
    const lithoSoilByFormationId = new Map<string, string | null>()
    const lithoFormationColorById = new Map<string, string>()
    for (const f of lithoFormations) {
      lithoSoilByFormationId.set(f.id, f.litho_main_soil_code ?? null)
      lithoFormationColorById.set(f.id, f.color)
    }
    return { geotechLayers, nadMeta, lithoSoilByFormationId, lithoFormationColorById }
  }, [isGeotech, geotechFormations, lithoFormations, geotechLayers])

  // The geotech model id for the SEPARATE packing-edge fetch that feeds the
  // correlate OVERLAY ribbons + gesture on the geotech axis. After the
  // fraction-space refinement, `correlationModelId` is ALWAYS the litho model
  // (both axes use litho edges for the partition shape), so the packing overlay
  // fetches from a DIFFERENT model than the partition â€” kept separate on purpose
  // (reusing `contactCorrelationEdges` would pull litho edges into the geotech
  // overlay; it's not a redundant request). A string (or null) so the fetch
  // callback + effect depend on the stable id, not the object identity.
  const geotechPackingModelId = activeGeotechModel?.id ?? null

  // Transient pulse state â€” set on a successful contact correlate, cleared
  // after PULSE_MS so the two correlated bands flash amber briefly.
  // The pulse is the "your correlation succeeded" UX signal (dogfeed 2026-05-23).
  const PULSE_MS = 900
  const [pulsingFormationIds, setPulsingFormationIds] = useState<
    ReadonlySet<string>
  >(new Set())
  const pulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const triggerCorrelationPulse = useCallback(
    (formationAId: string, formationBId: string): void => {
      if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current)
      setPulsingFormationIds(new Set([formationAId, formationBId]))
      pulseTimerRef.current = setTimeout(() => {
        setPulsingFormationIds(new Set())
        pulseTimerRef.current = null
      }, PULSE_MS)
    },
    [],
  )

  // Clear the pending pulse timer on unmount so it doesn't fire after
  // the canvas closes.
  useEffect(() => {
    return () => {
      if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current)
    }
  }, [])

  const handlePropagateAdmixtures = useCallback(
    async (
      seedFormationId: string,
      admixtures: Array<{ soil_code: string; amount: string; locally: boolean }>,
    ): Promise<void> => {
      if (!activeLithoModel) return
      log.info(
        'section',
        `propagate-admixtures: seed ${seedFormationId} on model ${activeLithoModel.id}`,
      )
      try {
        const result = await api.geology.propagateCorrelatedLithoAdmixtures(
          project.id,
          activeLithoModel.id,
          seedFormationId,
          admixtures,
        )
        // Refresh the local formation cache so the inspector + section bands
        // reflect the new admixture lists immediately.
        refetchFormations()
        log.success(
          'section',
          `propagate-admixtures: updated ${result.updated_formations.length} formations (component size ${result.component_size})`,
        )
        toast(
          'success',
          `Updated admixtures on ${result.component_size} correlated unit` +
            `${result.component_size === 1 ? '' : 's'}.`,
        )
      } catch (err) {
        // Surface the failure â€” silence on a failed PATCH is worse than a toast.
        log.warn('section', 'handlePropagateAdmixtures: PATCH failed', err)
        toast('error', 'Could not update the bodyâ€™s admixtures â€” try again.')
      }
    },
    [activeLithoModel, project.id, refetchFormations, toast],
  )

  // Open the InspectLensBodyPanel for a given (formationId, bodyOrdinal) pair.
  // Fetches the lens list lazily so the panel can show/pre-fill the lens name.
  const handleOpenInspectLensBody = useCallback(
    async (formationId: string, bodyOrdinal: number): Promise<void> => {
      if (!activeLithoModel) return
      log.info(
        'section',
        `inspectLensBody: formation=${formationId} ordinal=${bodyOrdinal} ` +
          `model=${activeLithoModel.id}`,
      )
      const target: InspectLensBodyTarget = {
        formationId,
        bodyOrdinal,
        projectId: project.id,
        modelId: activeLithoModel.id,
      }
      setInspectTarget(target)
      // Fetch lenses to find an existing name for this body.
      try {
        const lenses = await api.geology.listLenses(project.id, activeLithoModel.id)
        setInspectLenses(lenses)
        log.debug(
          'section',
          `inspectLensBody: ${lenses.length} lens(es) loaded for model ${activeLithoModel.id}`,
        )
      } catch (err) {
        log.warn('section', 'inspectLensBody: listLenses failed â€” proceeding without names', err)
        setInspectLenses([])
      }
    },
    [activeLithoModel, project.id],
  )

  // #133 Phase 1 + Phase 2+3: contact-level correlation edges.
  //
  // SECTION-scoped (owner directive 2026-06-08): fetched scoped to
  // selectedSectionId so only this section's ribbons render, and refetched on
  // section switch + after each mutation. The formation-level edge layer
  // (Slice 4) was removed in Task 21 (#133 Phase 2+3); these contact edges are
  // the sole correlation surface now.
  const [contactCorrelationEdges, setContactCorrelationEdges] = useState<
    LithoContactCorrelationEdge[]
  >([])

  // Geotech "Correlate packing" overlay edges (Phase 1, 2026-06-25).
  //
  // SEPARATE state from contactCorrelationEdges ON PURPOSE. On the geotech axis
  // contactCorrelationEdges is the LITHO model's edge list (correlationModelId
  // is always lithoModelId â€” see above) that FRAMES the partition fill and the
  // correlated-pair column spacing. The geotech packing overlay needs the
  // GEOTECH model's edges; reusing one list for both pulled the litho
  // connectivity out of the fill and pinched every band to a lens (commit
  // 7329738b). So the overlay ribbons + right-click targets on the geotech axis
  // read THIS list; nothing here feeds the partition / spacing.
  const [geotechPackingEdges, setGeotechPackingEdges] = useState<
    LithoContactCorrelationEdge[]
  >([])

  // Armed contact id â€” the source boundary the user clicked first.
  // Null = nothing armed (idle).
  const [armedContactId, setArmedContactId] = useState<string | null>(null)
  // Which side of the armed contact is being correlated.  'top' = normal
  // band-click; 'base' = bottom-of-test handle.  Resets to 'top' whenever
  // the armed source is cleared so a fresh cycle starts top-by-default.
  const [armedContactSide, setArmedContactSide] = useState<'top' | 'base'>('top')
  // Sticky lens-window (debt #135): investigation id of the most recent
  // successful target while the same source is still armed.  Null when no
  // edge has committed yet in the current arm-cycle.  A subsequent click on
  // a different contact in this investigation fires another edge from the
  // still-armed source â€” the lens-pinch-out gesture.  Cleared whenever the
  // source is disarmed or re-armed.
  const [lastTargetTestId, setLastTargetTestId] = useState<string | null>(null)

  // Contact-correlate mode flag â€” mirrors the toolbar's correlate mode.
  // The boundary-to-boundary gesture is the sole correlate surface (#133
  // Phase 2+3); the formation-level body-click surface was removed in Task 21.
  const contactCorrelateMode = correlateMode

  const refetchContactEdges = useCallback(async () => {
    if (correlationModelId === null) {
      setContactCorrelationEdges([])
      return
    }
    log.debug(
      'section',
      `listContactCorrelations: GET project=${project.id} model=${correlationModelId} section=${selectedSectionId}`,
    )
    try {
      const edges = await api.geology.listContactCorrelations(
        project.id,
        correlationModelId,
        selectedSectionId,
      )
      setContactCorrelationEdges(edges)
      // INFO (not DEBUG) on purpose: the correlation count the section actually
      // received is the fastest signal for "why are no bands connecting" â€” keep
      // it visible in the default console (the 2026-06-25 wrong-DB incident).
      log.info(
        'section',
        `listContactCorrelations: ${edges.length} edge(s) for model=${correlationModelId} section=${selectedSectionId}`,
      )
    } catch (err) {
      log.warn('section', 'refetchContactEdges: listContactCorrelations failed', err)
    }
  }, [correlationModelId, project.id, selectedSectionId])

  // Fetch the GEOTECH model's packing edges for the correlate overlay (Phase 1,
  // 2026-06-25). Scoped to the active geotech model + section, mirroring
  // refetchContactEdges but pointed at activeGeotechModel.id â€” never
  // correlationModelId (which is the litho model). No-op off the geotech axis.
  const refetchGeotechPackingEdges = useCallback(async () => {
    if (!isGeotech || geotechPackingModelId === null) {
      setGeotechPackingEdges([])
      return
    }
    log.debug(
      'section',
      `listGeotechPackingCorrelations: GET project=${project.id} geotechModel=${geotechPackingModelId} section=${selectedSectionId}`,
    )
    try {
      const edges = await api.geology.listContactCorrelations(
        project.id,
        geotechPackingModelId,
        selectedSectionId,
      )
      setGeotechPackingEdges(edges)
      // INFO (not DEBUG) on purpose â€” mirrors refetchContactEdges: the geotech
      // packing-edge count is the fastest "why aren't packing ribbons drawing"
      // signal in the default console.
      log.info(
        'section',
        `listGeotechPackingCorrelations: ${edges.length} edge(s) for geotechModel=${geotechPackingModelId} section=${selectedSectionId}`,
      )
    } catch (err) {
      log.warn(
        'section',
        'refetchGeotechPackingEdges: listContactCorrelations failed',
        err,
      )
    }
  }, [isGeotech, geotechPackingModelId, project.id, selectedSectionId])

  useEffect(() => {
    void refetchGeotechPackingEdges()
    // reason: the effect's deps (isGeotech + geotechPackingModelId +
    // selectedSectionId + correlationEdgesRefetchNonce) are the same axes that
    // make refetchGeotechPackingEdges stale, so the effect fires whenever the
    // function would have changed â€” listing the function itself adds nothing but
    // churn. correlationEdgesRefetchNonce (#163c) is bumped after a successful
    // auto-correlate / subdivide so new edges render without a manual reselect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGeotech, geotechPackingModelId, selectedSectionId, correlationEdgesRefetchNonce])

  useEffect(() => {
    if (!isLitho && !isGeotech) {
      setContactCorrelationEdges([])
      return
    }
    void refetchContactEdges()
    // reason: (isLitho || isGeotech) + correlationModelId + selectedSectionId are
    // the three axes that require a re-fetch; refetchContactEdges captures project.id
    // + correlationModelId in its closure so they don't need to be listed separately.
    // correlationModelId is always the litho model now (both litho and geotech axes
    // use litho edges to frame the partition; the geotech packing overlay uses a
    // separate fetch via geotechPackingModelId), so this fetches the litho edge set.
    // correlationEdgesRefetchNonce (#163c) is bumped after a successful auto-correlate
    // so the new edges render without a manual reselect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLitho, isGeotech, correlationModelId, selectedSectionId, correlationEdgesRefetchNonce])

  // #163f Slice 2 â€” detected lenses + their boundary shapes for LensWedge
  // Overlay. Mirrors the contact-edge fetch (same nonce trigger: lenses are
  // derived from approved edges, so they refresh whenever edges do).
  const [lensList, setLensList] = useState<BodyListItem[]>([])
  const [lensBoundaries, setLensBoundaries] = useState<
    ReadonlyMap<string, BodyBoundaryResponse>
  >(new Map())

  const refetchLensData = useCallback(async () => {
    if (lithoModelId === null) {
      setLensList([])
      setLensBoundaries(new Map())
      return
    }
    try {
      const list = await api.geology.listLenses(project.id, lithoModelId)
      setLensList(list)
      // Fetch each lens's stored boundary (style + nodes). N small GETs; lenses
      // are few. A batch endpoint is a future optimisation if N grows.
      const entries = await Promise.all(
        list.map(
          async l =>
            [l.id, await api.geology.getBodyBoundary(project.id, lithoModelId, l.id)] as const,
        ),
      )
      setLensBoundaries(new Map(entries))
    } catch (err) {
      log.warn('section', 'refetchLensData: listLenses/getBodyBoundary failed', err)
    }
  }, [lithoModelId, project.id])

  useEffect(() => {
    if (!isLitho) {
      setLensList([])
      setLensBoundaries(new Map())
      return
    }
    void refetchLensData()
    // reason: same axes as the edge fetch; refetchLensData captures project.id +
    // lithoModelId in its closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLitho, activeLithoModel?.id, selectedSectionId, correlationEdgesRefetchNonce])

  // (Fill-bands sand-merge removed 2026-06-05.) It correlated host halves on
  // every Fill-bands OFFâ†’ON to fuse a lens-split lithology into one body â€” but
  // the partition fill now extracts enclosed lenses in pure geometry, so the
  // DB-edge merge is redundant, and it re-created correlation edges the user had
  // just DELETED (dogfeed 2026-06-05). The matrix stays continuous from the
  // bodies' existing correlations; the user owns the correlation graph.

  const handleSaveLensShape = useCallback(
    async (
      lensId: string,
      upperNodes: BodyBoundaryNode[],
      lowerNodes: BodyBoundaryNode[],
      style: BodyRenderStyle,
    ): Promise<void> => {
      if (!activeLithoModel) return
      try {
        const saved = await api.geology.saveBodyBoundary(
          project.id,
          activeLithoModel.id,
          lensId,
          {
            upper_nodes: upperNodes,
            lower_nodes: lowerNodes,
            render_style: style,
          },
          // Anchor section-local nodes (+ adopt as primary section for a
          // resolver-created morph lens that has none yet).
          selectedSectionId ?? undefined,
        )
        setLensBoundaries(prev => {
          const next = new Map(prev)
          next.set(lensId, saved)
          return next
        })
        markMutated()
      } catch (err) {
        log.warn('section', 'handleSaveLensShape: saveBodyBoundary failed', err)
        toast('error', 'Could not save lens shape â€” see console.')
      }
    },
    [activeLithoModel, project.id, selectedSectionId, toast, markMutated],
  )

  const handleCreateContactCorrelation = useCallback(
    async (
      layerAId: string,
      layerBId: string,
      layerASide: 'top' | 'base' = 'top',
      layerBSide: 'top' | 'base' = 'top',
    ): Promise<void> => {
      if (!activeLithoModel) return
      const modelId = activeLithoModel.id
      const sectionIdAtPush = selectedSectionId
      log.info(
        'section',
        `contact-correlate: linking ${layerAId}(${layerASide}) â†” ${layerBId}(${layerBSide}) on model ${modelId}`,
      )
      try {
        await api.geology.createContactCorrelation(
          project.id,
          modelId,
          layerAId,
          layerBId,
          sectionIdAtPush,
          layerASide,
          layerBSide,
        )
        await Promise.all([refetchContactEdges(), refetchLithoContacts()])
        markMutated()
        // Deselect BOTH contacts after a successful two-click correlate (owner
        // directive 2026-06-08). This retires the #135 sticky lens-pinch-out
        // gesture (the source staying armed for a second target) in favour of a
        // clean two-click correlate â€” re-arm the source to draw another edge.
        const contactA = lithoContacts.find(c => c.id === layerAId)
        const targetContact = lithoContacts.find(c => c.id === layerBId)
        const targetTestId = targetContact?.cpt_id ?? targetContact?.borehole_id ?? null
        setArmedContactId(null)
        setArmedContactSide('top')
        setLastTargetTestId(null)
        // Amber pulse on both correlated bands â€” the immediate "your gesture
        // worked" cue before formations refetch (dogfeed 2026-05-23 #100).
        if (contactA?.formation_id && targetContact?.formation_id) {
          triggerCorrelationPulse(contactA.formation_id, targetContact.formation_id)
        }
        // Undo wiring (dogfeed 2026-05-31): a manual correlate is a
        // user-visible mutation and should peel off the stack on
        // Ctrl-Z. revert = DELETE the same edge; reapply = re-POST.
        // Both branches refetch + markMutated so the canvas + dirty
        // flag stay in sync. Captured ids/model survive the
        // SectionsCanvas remount-cycle (Refs not needed â€” these are
        // primitives by value).
        undoStack.push({
          description: 'Correlate contacts',
          revert: async () => {
            await api.geology.deleteContactCorrelation(
              project.id,
              modelId,
              layerAId,
              layerBId,
              sectionIdAtPush,
              layerASide,
              layerBSide,
            )
            await Promise.all([refetchContactEdges(), refetchLithoContacts()])
            markMutated()
          },
          reapply: async () => {
            await api.geology.createContactCorrelation(
              project.id,
              modelId,
              layerAId,
              layerBId,
              sectionIdAtPush,
              layerASide,
              layerBSide,
            )
            await Promise.all([refetchContactEdges(), refetchLithoContacts()])
            markMutated()
          },
        })
        toast('success', 'Boundary correlation added.')
        log.success(
          'section',
          `contact-correlate: edge ${layerAId}(${layerASide}) â†” ${layerBId}(${layerBSide}) created` +
            (targetTestId ? ` (sticky target=${targetTestId})` : ''),
        )
      } catch (err) {
        log.warn('section', 'handleCreateContactCorrelation: POST failed', err)
        // Reset the gesture so the user starts cleanly on the next click.
        setArmedContactId(null)
        setArmedContactSide('top')
        setLastTargetTestId(null)
        toast('error', 'Could not create the boundary correlation â€” try again.')
      }
    },
    [activeLithoModel, project.id, selectedSectionId, refetchContactEdges, toast, lithoContacts, triggerCorrelationPulse, markMutated, undoStack],
  )

  const handleDeleteContactCorrelation = useCallback(
    async (
      layerAId: string,
      layerBId: string,
      // Sides are required to distinguish a base-tie from a top-tie on the
      // same contact pair â€” the backend uniqueness is (a_id, b_id, a_side,
      // b_side), so deleting without sides silently matches nothing for a
      // base tie (spec Â§6 bug 2).
      layerASide: 'top' | 'base' = 'top',
      layerBSide: 'top' | 'base' = 'top',
    ): Promise<void> => {
      if (!activeLithoModel) return
      const modelId = activeLithoModel.id
      const sectionIdAtPush = selectedSectionId
      log.info(
        'section',
        `contact-uncorrelate: removing ${layerAId}(${layerASide}) â†” ${layerBId}(${layerBSide}) on model ${modelId}`,
      )
      // Optimistic removal â€” filter on sides too so a top-tie on the same
      // pair is not accidentally removed when deleting a base-tie.
      setContactCorrelationEdges(prev =>
        prev.filter(
          e =>
            !(
              (e.layer_a_id === layerAId &&
                e.layer_b_id === layerBId &&
                e.layer_a_side === layerASide &&
                e.layer_b_side === layerBSide) ||
              (e.layer_a_id === layerBId &&
                e.layer_b_id === layerAId &&
                e.layer_a_side === layerBSide &&
                e.layer_b_side === layerASide)
            ),
        ),
      )
      try {
        await api.geology.deleteContactCorrelation(
          project.id,
          modelId,
          layerAId,
          layerBId,
          sectionIdAtPush,
          layerASide,
          layerBSide,
        )
        await Promise.all([refetchContactEdges(), refetchLithoContacts()])
        markMutated()
        // Mirror of the create path â€” undo restores the edge,
        // redo removes it again. Symmetric so a Ctrl-Z + Ctrl-Y
        // round-trip leaves no drift.
        undoStack.push({
          description: 'Uncorrelate contacts',
          revert: async () => {
            await api.geology.createContactCorrelation(
              project.id,
              modelId,
              layerAId,
              layerBId,
              sectionIdAtPush,
              layerASide,
              layerBSide,
            )
            await Promise.all([refetchContactEdges(), refetchLithoContacts()])
            markMutated()
          },
          reapply: async () => {
            await api.geology.deleteContactCorrelation(
              project.id,
              modelId,
              layerAId,
              layerBId,
              sectionIdAtPush,
              layerASide,
              layerBSide,
            )
            await Promise.all([refetchContactEdges(), refetchLithoContacts()])
            markMutated()
          },
        })
        log.success(
          'section',
          `contact-uncorrelate: edge ${layerAId}(${layerASide}) â†” ${layerBId}(${layerBSide}) removed`,
        )
      } catch (err) {
        log.warn(
          'section',
          'handleDeleteContactCorrelation: DELETE failed â€” rolling back optimistic removal',
          err,
        )
        await Promise.all([refetchContactEdges(), refetchLithoContacts()])
      }
    },
    [activeLithoModel, project.id, selectedSectionId, refetchContactEdges, markMutated, undoStack],
  )

  // ---------------------------------------------------------------------------
  // Geotech packing-correlation handlers (spec Â§5).
  //
  // These mirror the litho correlate handlers above but:
  //   (a) use activeGeotechModel instead of activeLithoModel,
  //   (b) call requestGeotechLayersRefetch after success so body_id stamps
  //       re-render (the geotech layer list is the body_id source, not the
  //       edges themselves).
  //   (c) do NOT touch litho state (refetchLithoContacts / undoStack pulse),
  //       keeping the geotech gesture self-contained.
  //
  // R1 directive (owner, 2026-06-25): the same-class / same-litho-body
  // canConnectPacking guard was DROPPED entirely â€” geotech packing ties are
  // now as permissive as litho's contact-correlate (no class / body /
  // lithology rejection). The litho-partition frame + the per-region
  // band/onlap/lens render keep the result sensible; an out-of-region
  // (nonsense) tie simply doesn't render, exactly like litho.
  // ---------------------------------------------------------------------------

  const handleCreateGeotechPackingCorrelation = useCallback(
    async (
      layerAId: string,
      layerBId: string,
      layerASide: 'top' | 'base' = 'top',
      layerBSide: 'top' | 'base' = 'top',
    ): Promise<void> => {
      if (!activeGeotechModel) {
        log.warn('section', 'packing-connect: no geotech model â€” run Subdivide all bodies first')
        return
      }
      const modelId = activeGeotechModel.id
      // Clear arm state regardless so the gesture always resets cleanly.
      const clearArm = () => {
        setArmedContactId(null)
        setArmedContactSide('top')
        setLastTargetTestId(null)
      }
      // Self-correlate short-circuit: a band cannot correlate to itself.
      if (layerAId === layerBId) {
        log.debug('section', 'packing-connect: self-correlate â€” no-op', { layerAId })
        clearArm()
        return
      }
      log.info(
        'section',
        `packing-connect: linking ${layerAId}(${layerASide}) â†” ${layerBId}(${layerBSide}) on geotech model ${modelId}`,
      )
      try {
        await api.geology.createContactCorrelation(
          project.id,
          modelId,
          layerAId,
          layerBId,
          selectedSectionId,
          layerASide,
          layerBSide,
        )
        clearArm()
        await refetchContactEdges()
        await refetchGeotechPackingEdges()
        requestGeotechLayersRefetch()
        markMutated()
        // Bodies changed â†’ the borehole division is now out of date (amber the
        // "Divide boreholes" button until the engineer re-divides).
        markBoreholesStale()
        toast('success', 'Packing correlation added.')
        log.success(
          'section',
          `packing-connect: edge ${layerAId}(${layerASide}) â†” ${layerBId}(${layerBSide}) created on model ${modelId}`,
        )
      } catch (err) {
        log.warn('section', 'handleCreateGeotechPackingCorrelation: POST failed', err)
        clearArm()
        // Propagate the server's detail string verbatim (post() throws
        // new Error(detail.detail) for non-2xx responses, so err.message
        // IS the server message â€” e.g. CrossLithoBodyCorrelationError).
        const message =
          err instanceof Error
            ? err.message
            : 'Could not create the packing correlation â€” try again.'
        toast('error', message)
      }
    },
    [
      activeGeotechModel,
      project.id,
      selectedSectionId,
      refetchContactEdges,
      refetchGeotechPackingEdges,
      requestGeotechLayersRefetch,
      markMutated,
      toast,
    ],
  )

  const handleDeleteGeotechPackingCorrelation = useCallback(
    async (
      layerAId: string,
      layerBId: string,
      layerASide: 'top' | 'base' = 'top',
      layerBSide: 'top' | 'base' = 'top',
    ): Promise<void> => {
      if (!activeGeotechModel) return
      const modelId = activeGeotechModel.id
      log.info(
        'section',
        `packing-disconnect: removing ${layerAId}(${layerASide}) â†” ${layerBId}(${layerBSide}) on geotech model ${modelId}`,
      )
      // Optimistic removal â€” mirror the litho handler's filter shape. The
      // overlay ribbons on the geotech axis read geotechPackingEdges, so the
      // optimistic edit removes the deleted edge from THAT list (the litho
      // contactCorrelationEdges list frames the partition and never carries a
      // geotech edge id â€” filtering it here is a harmless no-op, kept for
      // parity with the litho handler).
      const dropEdge = (
        e: LithoContactCorrelationEdge,
      ): boolean =>
        !(
          (e.layer_a_id === layerAId &&
            e.layer_b_id === layerBId &&
            e.layer_a_side === layerASide &&
            e.layer_b_side === layerBSide) ||
          (e.layer_a_id === layerBId &&
            e.layer_b_id === layerAId &&
            e.layer_a_side === layerBSide &&
            e.layer_b_side === layerASide)
        )
      setContactCorrelationEdges(prev => prev.filter(dropEdge))
      setGeotechPackingEdges(prev => prev.filter(dropEdge))
      try {
        await api.geology.deleteContactCorrelation(
          project.id,
          modelId,
          layerAId,
          layerBId,
          selectedSectionId,
          layerASide,
          layerBSide,
        )
        await refetchContactEdges()
        await refetchGeotechPackingEdges()
        requestGeotechLayersRefetch()
        markMutated()
        // Bodies changed â†’ the borehole division is now out of date.
        markBoreholesStale()
        log.success(
          'section',
          `packing-disconnect: edge ${layerAId}(${layerASide}) â†” ${layerBId}(${layerBSide}) removed`,
        )
      } catch (err) {
        log.warn(
          'section',
          'handleDeleteGeotechPackingCorrelation: DELETE failed â€” rolling back optimistic removal',
          err,
        )
        // markMutated() is intentionally NOT called here: the optimistic edit
        // is rolled back and the server state is unchanged on a failed delete,
        // so the project is not actually dirty.
        await refetchContactEdges()
        await refetchGeotechPackingEdges()
        // Refresh geotech layers too (mirrors the success path) so body_id
        // stamps stay consistent even if an intermediate mutation changed them.
        requestGeotechLayersRefetch()
      }
    },
    [
      activeGeotechModel,
      project.id,
      selectedSectionId,
      refetchContactEdges,
      refetchGeotechPackingEdges,
      requestGeotechLayersRefetch,
      markMutated,
    ],
  )

  // Right-click a pending correlation edge â†’ "Accept correlation" (dogfeed
  // 2026-05-31).  Single-edge accept: flips user_approved=True on the server,
  // refetches edges + lens data so the seam ribbon, ordinal chips, and
  // wedges all reflect the new approved state.  No undo entry â€” the symmetric
  // reverse is "delete the edge", which the same menu offers as a separate
  // action.
  const handleAcceptContactCorrelation = useCallback(
    async (edgeId: string): Promise<void> => {
      if (!activeLithoModel) return
      const modelId = activeLithoModel.id
      log.info('section', `contact-accept: edge=${edgeId} on model ${modelId}`)
      try {
        const result = await api.geology.acceptSingleContactCorrelation(
          project.id,
          modelId,
          edgeId,
        )
        await Promise.all([refetchContactEdges(), refetchLithoContacts()])
        await refetchLensData()
        markMutated()
        log.success(
          'section',
          `contact-accept: edge=${edgeId} accepted=${result.edges_accepted} ` +
            `ordinals_changed=${result.ordinals_changed}`,
        )
      } catch (err) {
        log.warn('section', `handleAcceptContactCorrelation: POST failed for edge ${edgeId}`, err)
        toast('error', 'Could not accept the correlation. Try again or refresh.')
      }
    },
    [activeLithoModel, project.id, refetchContactEdges, refetchLensData, markMutated, toast],
  )

  // Right-click a lens wedge â†’ dissolve the lens (dogfeed 2026-05-29).
  // A lens IS its two defining correlation edges (aboveâ†”pinch, belowâ†”pinch);
  // the metadata-only DELETE endpoint would leave the body in the graph and
  // the detector would re-create it.  Deleting both edges removes the #135
  // topology, so DetectLithoLenses (fired by the uncorrelate path) reconciles
  // the lens row away.  refetchLensData refreshes the wedge overlay.
  const handleDeleteLens = useCallback(
    async (aboveId: string, belowId: string, targetId: string): Promise<void> => {
      if (
        !window.confirm(
          'Delete this lens? This removes the two correlations that define it.',
        )
      ) {
        return
      }
      log.info('section', `delete-lens: dissolving ${aboveId}/${belowId} â†” ${targetId}`)
      await handleDeleteContactCorrelation(aboveId, targetId)
      await handleDeleteContactCorrelation(belowId, targetId)
      void refetchLensData()
    },
    [handleDeleteContactCorrelation, refetchLensData],
  )

  // Body context menu handlers â€” wired from BodyContextMenu via SectionPanel.

  // Name a body via a native prompt (quick path; full rename in the
  // InspectLensBodyPanel).
  // Open the name dialog for a body. (The actual PATCH happens in
  // ``submitBodyName`` on dialog submit â€” window.prompt is a dead end in
  // Electron, so naming goes through a Modal.)
  const handleNameBody = useCallback(
    (bodyId: string): void => {
      if (!activeLithoModel) return
      const body = lensList.find(b => b.id === bodyId)
      if (!body) {
        log.warn('section', `name-body: body ${bodyId} not found in lensList`)
        return
      }
      setNamingBody({ id: bodyId, currentName: body.name ?? '' })
    },
    [activeLithoModel, lensList],
  )

  // Commit the name entered in NameBodyDialog. A named body is preserved by
  // the detector reconcile + bulk "Delete all detected lenses" â€” naming is how
  // the user keeps ("accepts") a detected lens.
  const submitBodyName = useCallback(
    async (name: string): Promise<void> => {
      if (!activeLithoModel || namingBody === null) return
      const body = lensList.find(b => b.id === namingBody.id)
      if (!body) {
        setNamingBody(null)
        return
      }
      log.info('section', `name-body: body=${namingBody.id} name="${name}"`)
      try {
        await api.geology.nameBody(project.id, activeLithoModel.id, namingBody.id, {
          formation_id: body.formation_id,
          body_ordinal: body.body_ordinal,
          name,
        })
        void refetchLensData()
        toast('success', `Lens named: ${name}`)
      } catch (err) {
        toast('error', 'Failed to name lens.')
        log.warn('section', 'submitBodyName: failed', err)
      } finally {
        setNamingBody(null)
      }
    },
    [activeLithoModel, namingBody, project.id, lensList, refetchLensData, toast],
  )

  // Dissolve a body â€” deletes the body row and all its correlation edges.
  const handleDissolveBody = useCallback(
    async (bodyId: string): Promise<void> => {
      if (!activeLithoModel) return
      if (!window.confirm('Dissolve this body? This removes the body and its extent data.')) return
      log.info('section', `dissolve-body: body=${bodyId}`)
      try {
        await api.geology.deleteBody(project.id, activeLithoModel.id, bodyId)
        void refetchLensData()
        toast('success', 'Body dissolved.')
      } catch (err) {
        toast('error', 'Failed to dissolve body.')
        log.warn('section', 'handleDissolveBody: failed', err)
      }
    },
    [activeLithoModel, project.id, refetchLensData, toast],
  )


  // Right-click "Delete contact" gesture from the section overlay.
  // Presents window.confirm (irreversible action), delegates to the
  // existing handleDeleteContact from the geoModel bus (which owns
  // the undo stack + local state patch), then refetches edge state so
  // the FK-cascade-removed edges disappear from the section view.
  const handleRequestDeleteContactFromSection = useCallback(
    async (contactId: string): Promise<void> => {
      if (!activeLithoModel) return
      const ok = window.confirm(
        'Delete this contact? This removes the boundary and any correlations touching it.',
      )
      if (!ok) return
      await handleDeleteContact(contactId)
      // The geoModel bus already patched lithoContacts optimistically.
      // The FK cascade on the backend also removed correlation edges â€”
      // refetch so the section view reflects the updated edge graph.
      void refetchContactEdges()
      void refetchLithoContacts()
    },
    [activeLithoModel, handleDeleteContact, refetchContactEdges, refetchLithoContacts],
  )

  // Build the contactGestureState passed to SectionPanel.
  // Wired on the litho axis (correlate litho boundaries) and the geotech
  // axis (correlate packing bands). Absent on the geological axis.
  const contactGestureState: ContactGestureState | undefined = useMemo(() => {
    if (!isLitho && !isGeotech) return undefined
    return {
      contactCorrelateMode,
      armedContactId,
      armedContactSide,
      lastTargetTestId,
      // Arming a (new) source always resets the sticky lens window â€”
      // a fresh source starts a fresh arm-cycle (debt #135).
      // The optional ``side`` parameter lets the bottom-of-test handle
      // arm with side='base'; band clicks default to 'top'.
      onArmContact: (id: string, side: 'top' | 'base' = 'top') => {
        setArmedContactId(id)
        setArmedContactSide(side)
        setLastTargetTestId(null)
      },
      onClearArmedContact: () => {
        setArmedContactId(null)
        setArmedContactSide('top')
        setLastTargetTestId(null)
      },
      // Route create/delete handlers by axis: geotech uses the packing-connect
      // guard + geotech model; litho uses the litho model.
      onContactCorrelate: isGeotech
        ? handleCreateGeotechPackingCorrelation
        : handleCreateContactCorrelation,
      onContactUncorrelate: isGeotech
        ? handleDeleteGeotechPackingCorrelation
        : handleDeleteContactCorrelation,
      // Contact deletion (right-click "Delete contact") is a litho-only gesture;
      // geotech contacts are owned by the subdivision, not manually deleted.
      onRequestDeleteContact: isLitho ? handleRequestDeleteContactFromSection : undefined,
    }
  }, [
    isLitho,
    isGeotech,
    contactCorrelateMode,
    armedContactId,
    armedContactSide,
    lastTargetTestId,
    handleCreateGeotechPackingCorrelation,
    handleDeleteGeotechPackingCorrelation,
    handleCreateContactCorrelation,
    handleDeleteContactCorrelation,
    handleRequestDeleteContactFromSection,
  ])

  // -----------------------------------------------------------------------
  // Drag-to-retarget unapproved edge (#133 Phase 2+3 Task 26).
  //
  // The user mousedowns on a grab handle (unapproved edge endpoint), drags
  // to a different contact hit-rect on the section, and releases.  On drop:
  //   1. DELETE the original edge (old contact pair).
  //   2. POST a new edge (anchor contact + new drop-target contact).
  //   3. Refetch contact edges so the section reflects the re-targeted edge.
  //
  // The new edge uses source='manual' which the server sets to user_approved=True
  // by default â€” Option Y: re-targeting an auto suggestion is itself a form
  // of user blessing, so the resulting edge is treated as approved.  This is
  // simpler than adding a user_approved field to the create API and avoids
  // threading an extra backend change through the path.
  //
  // Coordinate system: viewport coords are stored in state; the overlay
  // converts them to SVG-local by reading ownerSVGElement.getBoundingClientRect().
  // -----------------------------------------------------------------------

  interface EdgeDragState {
    /** The edge being re-targeted. */
    edge: LithoContactCorrelationEdge
    /** Which endpoint is being dragged: 'a' or 'b'. */
    handle: 'a' | 'b'
    /** Contact id of the NON-dragged endpoint (the stable anchor). */
    anchorContactId: string
    /** Contact id of the endpoint being dragged (used to detect drop-on-self). */
    draggedContactId: string
    /** Investigation id of the anchor contact (used to reject same-investigation drops). */
    anchorInvestigationId: string | null
    /** True when Ctrl/Cmd was held at drag start: LEAVE the original edge and
     *  CREATE a new one to the drop (the "create an extra boundary" gesture â€”
     *  forms a lens when the drop is the layer's other boundary). False = plain
     *  drag = retarget the grabbed end (#31). */
    duplicate: boolean
    /** Current cursor X in viewport coords (updated on mousemove). */
    cursorViewportX: number
    /** Current cursor Y in viewport coords (updated on mousemove). */
    cursorViewportY: number
  }

  const [edgeDrag, setEdgeDrag] = useState<EdgeDragState | null>(null)

  const handleUnapprovedDragStart = useCallback(
    (
      e: React.MouseEvent,
      edge: LithoContactCorrelationEdge,
      handle: 'a' | 'b',
    ): void => {
      e.preventDefault()
      const draggedContactId = handle === 'a' ? edge.layer_a_id : edge.layer_b_id
      const anchorContactId = handle === 'a' ? edge.layer_b_id : edge.layer_a_id
      // Resolve anchor investigation id to block same-investigation-as-anchor
      // drops. Ctrl/Cmd at drag start selects "leave + create another"
      // (duplicate â†’ lens) vs plain "retarget the grabbed end".
      const anchorContact = lithoContacts.find(c => c.id === anchorContactId)
      const anchorInvestigationId = anchorContact?.cpt_id ?? anchorContact?.borehole_id ?? null
      const duplicate = e.ctrlKey || e.metaKey
      log.debug(
        'section',
        `edgeDrag: start edge=${edge.id} handle=${handle} dragged=${draggedContactId} ` +
          `anchor=${anchorContactId} duplicate=${duplicate}`,
      )
      setEdgeDrag({
        edge,
        handle,
        anchorContactId,
        draggedContactId,
        anchorInvestigationId,
        duplicate,
        cursorViewportX: e.clientX,
        cursorViewportY: e.clientY,
      })
    },
    [lithoContacts],
  )

  // Window-level mousemove + mouseup that drive the drag and commit the drop.
  useEffect(() => {
    if (edgeDrag === null) return

    function handleMouseMove(e: MouseEvent): void {
      setEdgeDrag(prev =>
        prev === null
          ? null
          : { ...prev, cursorViewportX: e.clientX, cursorViewportY: e.clientY },
      )
    }

    async function handleMouseUp(e: MouseEvent): Promise<void> {
      if (edgeDrag === null) {
        setEdgeDrag(null)
        return
      }
      // Hit-test the drop target via document.elementFromPoint (viewport coords).
      const dropEl = document.elementFromPoint(e.clientX, e.clientY)
      // Walk up the DOM to find the nearest element carrying data-contact-id.
      let el: Element | null = dropEl
      let dropContactId: string | null = null
      while (el !== null) {
        const cid = el.getAttribute('data-contact-id')
        if (cid) {
          dropContactId = cid
          break
        }
        el = el.parentElement
      }

      // Validate the drop target.
      if (dropContactId === null) {
        // Dropped on empty space â€” cancel.
        log.debug('section', 'edgeDrag: drop on empty space â€” cancelled')
        setEdgeDrag(null)
        return
      }
      if (dropContactId === edgeDrag.anchorContactId) {
        // Dropped on the anchor endpoint â€” no-op.
        log.debug('section', 'edgeDrag: drop on anchor â€” cancelled')
        setEdgeDrag(null)
        return
      }
      if (dropContactId === edgeDrag.draggedContactId) {
        // Dropped back on the same contact â€” no-op.
        log.debug('section', 'edgeDrag: drop on same contact â€” cancelled')
        setEdgeDrag(null)
        return
      }
      // Reject same-investigation: the server rejects this too, but fail early.
      const dropContact = lithoContacts.find(c => c.id === dropContactId)
      const dropInvestigationId = dropContact?.cpt_id ?? dropContact?.borehole_id ?? null
      if (
        edgeDrag.anchorInvestigationId !== null &&
        dropInvestigationId !== null &&
        dropInvestigationId === edgeDrag.anchorInvestigationId
      ) {
        log.debug(
          'section',
          `edgeDrag: drop on same investigation as anchor (${edgeDrag.anchorInvestigationId}) â€” rejected`,
        )
        setEdgeDrag(null)
        return
      }

      if (!activeLithoModel) {
        setEdgeDrag(null)
        return
      }

      // Clear drag state immediately so the UI feels responsive.
      const capturedDrag = edgeDrag
      setEdgeDrag(null)

      // Ctrl/Cmd-drag (#31): LEAVE the original edge and CREATE another from
      // the same anchor to the drop â€” "create an extra boundary where I drag
      // to". When the drop is the layer's OTHER boundary (anchor now connects
      // to both â†’ 1â†”2), DetectLithoLenses materialises a wedge.
      // ``createContactCorrelation`` is idempotent (re-creating an existing
      // unapproved edge would NOT approve it), so delete the original first
      // then create both fresh â€” both auto-approve. Direction-agnostic.
      if (capturedDrag.duplicate) {
        log.info(
          'section',
          `edgeDrag: duplicate edge=${capturedDrag.edge.id} anchor=${capturedDrag.anchorContactId} â†” ` +
            `{${capturedDrag.draggedContactId}, ${dropContactId}}`,
        )
        try {
          await api.geology.deleteContactCorrelation(
            project.id,
            capturedDrag.edge.model_id,
            capturedDrag.edge.layer_a_id,
            capturedDrag.edge.layer_b_id,
            selectedSectionId,
            capturedDrag.edge.layer_a_side,
            capturedDrag.edge.layer_b_side,
          )
          // Re-create the original (now approved) + the twin to the dropped
          // boundary. The second create completes the 1â†”2 and triggers the
          // lens materialisation server-side.
          await api.geology.createContactCorrelation(
            project.id,
            capturedDrag.edge.model_id,
            capturedDrag.anchorContactId,
            capturedDrag.draggedContactId,
            selectedSectionId,
          )
          await api.geology.createContactCorrelation(
            project.id,
            capturedDrag.edge.model_id,
            capturedDrag.anchorContactId,
            dropContactId,
            selectedSectionId,
          )
          await Promise.all([refetchContactEdges(), refetchLithoContacts()])
          void refetchLensData()
          markMutated()
          log.success('section', 'edgeDrag: extra correlation created (anchor â†” both targets)')
          toast('success', 'Correlation added â€” a wedge forms when it spans the layer.')
        } catch (err) {
          log.warn('section', 'edgeDrag: duplicate-create failed', err)
          toast('error', 'Could not create the correlation â€” try again.')
          void refetchContactEdges()
          void refetchLensData()
        }
        return
      }

      log.info(
        'section',
        `edgeDrag: retarget edge=${capturedDrag.edge.id} ` +
          `${capturedDrag.draggedContactId} â†’ ${dropContactId} (anchor=${capturedDrag.anchorContactId})`,
      )

      try {
        // 1. Delete the original edge.
        await api.geology.deleteContactCorrelation(
          project.id,
          capturedDrag.edge.model_id,
          capturedDrag.edge.layer_a_id,
          capturedDrag.edge.layer_b_id,
          selectedSectionId,
          capturedDrag.edge.layer_a_side,
          capturedDrag.edge.layer_b_side,
        )
        // 2. Create the replacement edge (anchor + new target).
        //    source='manual' â†’ server defaults user_approved=True (Option Y).
        await api.geology.createContactCorrelation(
          project.id,
          capturedDrag.edge.model_id,
          capturedDrag.anchorContactId,
          dropContactId,
          selectedSectionId,
        )
        // 3. Refetch so the section reflects the re-targeted edge.
        await Promise.all([refetchContactEdges(), refetchLithoContacts()])
        markMutated()
        log.success(
          'section',
          `edgeDrag: edge retargeted to ${capturedDrag.anchorContactId} â†” ${dropContactId}`,
        )
        toast('success', 'Edge retargeted.')
      } catch (err) {
        log.warn('section', 'edgeDrag: retarget failed', err)
        toast('error', 'Could not retarget the edge â€” try again.')
        // Restore edges from server on failure.
        void refetchContactEdges()
      }
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
    // reason: edgeDrag is the live drag object that drives both handlers;
    //   lithoContacts, activeLithoModel, project.id, selectedSectionId, the
    //   api/log/toast refs, and markMutated (a stable App useCallback) are all
    //   stable or captured in the same closure.
    //   The cleanup fn removes both listeners with the SAME named function
    //   references captured in this closure, which is correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edgeDrag])

  // The overlay prop: only populated on the litho axis while a drag is active.
  const unapprovedEdgeDrag = useMemo(() => {
    if (!isLitho || edgeDrag === null) return undefined
    return {
      anchorContactId: edgeDrag.anchorContactId,
      cursorViewportX: edgeDrag.cursorViewportX,
      cursorViewportY: edgeDrag.cursorViewportY,
    }
  }, [isLitho, edgeDrag])

  // Slice 2 (#55): axis-aware contact/formation/surface routing.
  // SectionPanel and ContactsLayer are UNCHANGED â€” the prop boundary absorbs
  // the switch. Geological is the default and existing behaviour is identical.
  // (isLitho is defined above the Slice 4 block so both slices share it.)
  // Active model for the chosen axis â€” used for export button gating.
  // Geotech axis is view-only so it doesn't own an axis model for editing;
  // fall through to the geological model so export buttons gate correctly.
  const activeAxisModel = isLitho
    ? activeLithoModel
    : isGeotech
      ? activeGeotechModel
      : activeGeologicalModel
  // Contact/formation/surface sets routed by axis.
  // Geotech uses geotechFormations (NAD-stamped) and geotechContacts from
  // the bus; surfaces are not used on the geotech axis (no TIN rendering).
  const axisContacts = isLitho ? lithoContacts : isGeotech ? geotechContacts : contacts
  const axisFormations = isLitho ? lithoFormations : isGeotech ? geotechFormations : formations
  const axisSurfacesByFormationId = isLitho ? lithoSurfacesByFormationId : surfacesByFormationId
  const axisExcludedBoreholeIds = activeAxisModel?.excluded_borehole_ids ?? []
  // Litho axis left-click creates a ghost layer, not a committed contact.
  // The geological axis keeps the original committed-contact flow unchanged.
  // Geotech axis is view-only: no contact creation (undefined â†’ disabled).
  const axisCreateContact = isLitho ? handleCreateLithoContact : isGeotech ? undefined : handleCreateContact
  const axisCreateFormation = isLitho ? handleInlineLithoCreateFormation : isGeotech ? undefined : handleInlineCreateFormation

  // Override #2 (owner): derive the default backdrop geological-model id at the
  // prop boundary via useMemo from activeLithoModel?.parent_model_id.
  // When the project has more than one geological model the user can override via
  // the picker in SectionsInspector (backdropModelIdOverride from the sections
  // ShellContext slice); the effective id is the override if set, else the parent.
  const defaultBackdropModelId = useMemo(
    () => activeLithoModel?.parent_model_id ?? null,
    [activeLithoModel],
  )
  // Effective backdrop model â€” the ShellContext override takes precedence when set.
  const effectiveBackdropModelId = backdropModelIdOverride ?? defaultBackdropModelId

  // Auto-load geological backdrop surfaces when switching to the litho axis.
  //
  // WHY: the "Sync geology" verb in SectionsToolbar loads backdrop surfaces
  // on demand, but users expect to see the geological reference immediately
  // when they switch to the litho axis â€” they should not have to know to
  // press a separate button first.  Auto-loading on axis-switch is cheap
  // (handleLoadBackdropSurfaces is idempotent: already-loaded surfaces are
  // skipped in useGeologicalModel) and makes the litho axis useful out of
  // the box.
  //
  // Gate: only fire when axis is litho AND a backdrop model id is known.
  // null effectiveBackdropModelId means no litho model or no parent â€” nothing
  // to load.
  useEffect(() => {
    if (!isLitho) return
    if (!effectiveBackdropModelId) return
    void handleLoadBackdropSurfaces(effectiveBackdropModelId)
  }, [isLitho, effectiveBackdropModelId, handleLoadBackdropSurfaces])

  // P2-F â€” explicit-content filter (owner directive 2026-05-17).
  //
  // Classification follows the test (owner directive 2026-06-08, supersedes the
  // 2026-05-17 explicit-content filter for classification): a section shows the
  // contacts/litho of EVERY test in its corridor, not only the ids it was seeded
  // with â€” so a test is classified once and appears on every section through it.
  // Correlations stay relational (unchanged). The seeded set rides the bundle for
  // compat but no longer gates rendering.
  //
  // The contacts list is loaded model-wide (correct for the Build/TIN path â€” the
  // Delaunay needs ALL anchors). The render/export gate is now "the contact's
  // anchor investigation is in this section's corridor", which the section
  // already projects. Stale-id tolerance is inherent: a contact whose anchor is
  // out of corridor (or whose anchor was removed) is simply filtered out.
  const sectionInvestigationIds = useMemo(
    () =>
      selectedSection !== null
        ? inCorridorInvestigationIds(selectedSection, visibleCpts, visibleBoreholes)
        : new Set<string>(),
    [selectedSection, visibleCpts, visibleBoreholes],
  )
  const sectionContacts = useMemo(
    () =>
      selectedSection !== null
        ? axisContacts.filter(c =>
            sectionInvestigationIds.has(c.cpt_id ?? c.borehole_id ?? ''),
          )
        : [],
    [selectedSection, sectionInvestigationIds, axisContacts],
  )

  // P2-H â€” section-aware contact draw.
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

      // Litho axis left-click: no-op.  The ghost-creation flow (manual insert)
      // is triggered exclusively by the right-click "Create layer" context-menu
      // item in LithoSuggestionGhostColumns.  Left-click on the contact-pick bar
      // was wired to create a ghost (2026-05-19), but the ghost renders as a
      // zero-thickness, outline-only band that the user cannot see, making the
      // gesture invisible and confusing.  The right-click path already covers
      // the intent; this branch is deleted (dogfeed 2026-05-26).
      // Geotech axis is view-only â€” no new contacts may be created.
      if (isLitho || isGeotech) return

      // Pass the section id so the backend seeds seeded_formation_contact_ids
      // (P2-E). Without this the create succeeds but the P2-F filter below
      // hides the new contact â€” the root cause of the "draw/copy does
      // nothing" dogfeed bug: the threading stopped here and never reached
      // the create body.
      if (!axisCreateContact) return
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
    // reason: isLitho + isGeotech are listed so the early-return branch
    // refreshes when the axis switches; axisCreateContact captures the
    // handler for the current axis.  visibleCpts/visibleBoreholes are stable
    // during a session but listed for completeness.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedSection, axisCreateContact, project.id, applyUpdatedSection, isLitho, isGeotech],
  )

  // P2-H (batch) â€” section-aware contact COPY (drag-to-next-test: one-by-one,
  // marquee batch, shift-drag all funnel through onBatchCreateContacts).
  // Mirrors sectionAwareCreateContact: thread the section id so the backend
  // seeds every copied id, then ONE section GET so P2-F's filter shows them
  // all on the next render. This was the missing wiring â€” the plain
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
  // the ghost overlay can convert depth-below-surface â†’ absolute mTAW level.
  // Searches both visible lists; null when the investigation isn't loaded yet.
  const lithoGhostSurfaceElevationM = useMemo(() => {
    if (!focusedSuggestAnchorId) return null
    const cpt = visibleCpts.find(c => c.id === focusedSuggestAnchorId)
    if (cpt) return cpt.elevation_m
    const bh = visibleBoreholes.find(b => b.id === focusedSuggestAnchorId)
    return bh?.elevation_m ?? null
  }, [focusedSuggestAnchorId, visibleCpts, visibleBoreholes])

  // Section-context-threaded accept handler (#57 invariant).
  //
  // WHY the wrapper: handleAcceptLithoSuggestion calls the bulk endpoint which
  // returns updated_section containing the freshly-seeded contact ids.  Without
  // forwarding those ids via applyUpdatedSection, the explicit-content filter
  // in P2-F hides every accepted contact immediately after acceptance â€” the #57
  // class bug, recurred 3Ã—.  The raw handler accepts an optional onSectionUpdated
  // callback; we wire it here at the SectionsCanvas boundary where both
  // selectedSection and applyUpdatedSection are in scope.
  // â”€â”€ Debt #134 â€” litho â†” geological snap prompt â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  //
  // When a litho-contact drag commits within tolerance of a geological
  // contact on the same investigation (or the post-accept check #134-C
  // lands a brand-new contact in the same zone), a 3-option prompt
  // opens so the user picks the direction of the snap (snap litho,
  // move geo with a rebuild cascade, or keep them separate).
  //
  // Tolerance is per-project (debt #134-A): reads from
  // ``view_state.litho_segmenter.litho_snap_tolerance_m`` with a 0.20 m
  // default that matches the original MVP.  Settings â†’ Litho segmenter
  // exposes the field.
  const lithoSnapToleranceM = useMemo(
    () => readLithoSegmenterPrefs(project?.view_state ?? null).lithoSnapToleranceM,
    [project?.view_state],
  )

  const openExtentLengthM = useMemo(
    () => readLithoSegmenterPrefs(project?.view_state ?? null).openExtentLengthM,
    [project?.view_state],
  )

  const sectionFillAtSectionLine = useMemo(
    () => readLithoSegmenterPrefs(project?.view_state ?? null).sectionFillAtSectionLine,
    [project?.view_state],
  )

  const sectionAwareAcceptLithoSuggestion = useCallback(
    async (idx: number): Promise<void> => {
      const result = await handleAcceptLithoSuggestion(
        idx,
        selectedSection?.id ?? null,
        applyUpdatedSection,
      )
      // Debt #134-C â€” post-accept litho-geo snap check.  Only the
      // single-suggestion path is wired here; accept-all-focused +
      // bulk paths are tracked under follow-up work (see debt entry).
      //
      // Read the depth the user actually accepted (after any drag-
      // resize edits) from the focused-anchor ghost entry â€” same
      // source the handler uses internally, so the two are guaranteed
      // to agree on what was sent.
      if (result === null || !isLitho) return
      if (focusedSuggestAnchorId === null) return
      const entry = ghostsByAnchor.get(focusedSuggestAnchorId)
      if (!entry || idx < 0 || idx >= entry.suggestions.length) return
      const raw = entry.suggestions[idx]
      const edit = entry.edits.get(idx)
      const acceptedTopM = edit?.depth_top_m ?? raw.depth_top_m
      const candidates = findGeoSnapCandidates(
        acceptedTopM,
        focusedSuggestAnchorId,
        contacts,
        lithoSnapToleranceM,
      )
      if (candidates.length === 0) return
      // ``result.created_contact_ids[0]`` is the upper-half contact for
      // the only accepted suggestion (the find-or-create loop creates
      // the upper interval first; the lower-half on a straddle follows
      // immediately after).  If nothing was actually created (idempotent
      // re-accept of an already-committed layer), there is no contact
      // to retarget â€” silently skip the prompt.
      const newContactId = result.created_contact_ids[0]
      if (!newContactId) return
      setLithoGeoSnapPrompt({
        lithoContactId: newContactId,
        rawDepthM: acceptedTopM,
        candidates,
        // The accept path snaps the new contact's TOP (acceptedTopM is the
        // top of the upper-half interval).
        field: 'top',
      })
    },
    [
      handleAcceptLithoSuggestion,
      selectedSection,
      applyUpdatedSection,
      isLitho,
      focusedSuggestAnchorId,
      ghostsByAnchor,
      contacts,
      lithoSnapToleranceM,
    ],
  )

  const [lithoGeoSnapPrompt, setLithoGeoSnapPrompt] = useState<{
    lithoContactId: string
    rawDepthM: number
    candidates: readonly FormationContactResponse[]
    // Which boundary of the litho contact the originating drag moved. The
    // snap PATCH MUST write this same edge â€” a base-edge drag that snaps to a
    // geo contact has to set depth_base_m, not depth_top_m. Required (no
    // default) so the field can never be silently dropped again.
    field: 'top' | 'base'
  } | null>(null)
  const [lithoGeoSnapBusy, setLithoGeoSnapBusy] = useState(false)

  // P1b (dogfeed 2026-05-30) â€” live contact-depth override during a
  // cross-store suggestion drag. Set on every mousemove by the
  // ``onContactLivePreview`` callback that ``useBoundaryDrag`` fires;
  // cleared on mouseup. ContactsLayer reads this prop and renders the
  // matching contact at the live depth so the committed contact
  // follows the pending edit visually until the PATCH commit refetch
  // takes over.
  const [
    lithoSuggestionContactPreview,
    setLithoSuggestionContactPreview,
  ] = useState<{ contactId: string; depthM: number } | null>(null)
  const handleLithoContactLivePreview = useCallback(
    (contactId: string | null, liveDepthM: number) => {
      if (contactId === null) {
        setLithoSuggestionContactPreview(null)
      } else {
        setLithoSuggestionContactPreview({ contactId, depthM: liveDepthM })
      }
    },
    [],
  )

  // Snap-aware wrapper around ``handleUpdateContactDepth``.  Commits the
  // litho contact at the raw drag depth first (so the user sees the drag
  // result immediately), then â€” on the litho axis only â€” checks for any
  // geological contact within tolerance.  If one or more candidates
  // exist, opens the prompt; otherwise the wrapper is a no-op past the
  // initial PATCH.
  const handleLithoSnapAwareUpdateContactDepth = useCallback(
    async (contactId: string, newDepthM: number, snapped: boolean, field: 'top' | 'base' = 'top'): Promise<void> => {
      await handleUpdateContactDepth(contactId, newDepthM, snapped, field)
      if (!isLitho) return
      const dragged = lithoContacts.find(c => c.id === contactId)
      if (!dragged) return
      const anchorId = dragged.borehole_id ?? dragged.cpt_id
      if (!anchorId) return
      const candidates = findGeoSnapCandidates(
        newDepthM,
        anchorId,
        contacts,
        lithoSnapToleranceM,
      )
      if (candidates.length === 0) return
      setLithoGeoSnapPrompt({
        lithoContactId: contactId,
        rawDepthM: newDepthM,
        candidates,
        field,
      })
    },
    [handleUpdateContactDepth, isLitho, lithoContacts, contacts, lithoSnapToleranceM],
  )

  const handleSnapLithoToGeo = useCallback(
    async (geoContactId: string): Promise<void> => {
      if (lithoGeoSnapBusy || lithoGeoSnapPrompt === null) return
      const geo = lithoGeoSnapPrompt.candidates.find(c => c.id === geoContactId)
      if (!geo) return
      setLithoGeoSnapBusy(true)
      try {
        // Second PATCH on the litho contact, snapping it to the geo depth.
        // ``snapped=true`` marks the source/confidence on the litho row.
        // Carry the originating drag's ``field`` so a base-edge snap writes
        // depth_base_m, not depth_top_m (the dropped-field wrong-boundary bug).
        await handleUpdateContactDepth(
          lithoGeoSnapPrompt.lithoContactId,
          geo.depth_top_m,
          true,
          lithoGeoSnapPrompt.field,
        )
      } catch (err) {
        log.error('section', 'handleSnapLithoToGeo: snap failed', {
          lithoContactId: lithoGeoSnapPrompt.lithoContactId,
          geoContactId,
          err,
        })
        toast('error', `Snap failed: ${(err as Error).message}`)
      } finally {
        setLithoGeoSnapBusy(false)
        setLithoGeoSnapPrompt(null)
      }
    },
    [lithoGeoSnapBusy, lithoGeoSnapPrompt, handleUpdateContactDepth, toast],
  )

  const handleMoveGeoToLitho = useCallback(
    async (geoContactId: string): Promise<void> => {
      if (lithoGeoSnapBusy || lithoGeoSnapPrompt === null) return
      const geo = lithoGeoSnapPrompt.candidates.find(c => c.id === geoContactId)
      if (!geo || !project) return
      const oldDepth = geo.depth_top_m
      const lithoDepth = lithoGeoSnapPrompt.rawDepthM
      setLithoGeoSnapBusy(true)
      // No "in progress" toast â€” the dialog stays open with all buttons
      // disabled (busy=true) which already signals work-in-flight.  A
      // success / error toast lands at the end.
      try {
        await handleUpdateContactDepth(geoContactId, lithoDepth, false)
        await api.geology.rebuildSurfaces(project.id, geo.model_id)
        await handleLoadBackdropSurfaces(geo.model_id)
        toast('success', 'Geological contact moved; surfaces rebuilt.')
      } catch (err) {
        log.error('section', 'handleMoveGeoToLitho: move failed', {
          geoContactId,
          lithoDepth: lithoGeoSnapPrompt.rawDepthM,
          err,
        })
        toast('error', `Move failed: ${(err as Error).message}`)
        // Best-effort rollback of the geological-contact depth.  Swallow
        // a secondary failure â€” the user already saw the primary error.
        try {
          await handleUpdateContactDepth(geoContactId, oldDepth, false)
        } catch {
          // intentionally empty â€” rollback is best-effort
        }
      } finally {
        setLithoGeoSnapBusy(false)
        setLithoGeoSnapPrompt(null)
      }
    },
    [
      lithoGeoSnapBusy,
      lithoGeoSnapPrompt,
      project,
      handleUpdateContactDepth,
      handleLoadBackdropSurfaces,
      toast,
    ],
  )

  const handleSnapDialogCancel = useCallback((): void => {
    if (lithoGeoSnapBusy) return
    setLithoGeoSnapPrompt(null)
  }, [lithoGeoSnapBusy])

  // Phase-1.5 manual litho composition picker â€” new-unit path.
  //
  // WHY a dedicated callback at this boundary:
  //   The "new unit" tab in LithoCompositionPickerDialog produces a main soil
  //   code + admixture list. The existing acceptLithoSuggestions endpoint is
  //   reused with a synthetic one-item payload (source='manual_pick', sentinel
  //   depth_base = depth_top + 0.01 so it never straddles). After the formation
  //   is created (the only BE path that sets litho_main_soil_code), a ghost is
  //   placed at the same depth so the user enters the ghost-extend-accept flow
  //   instead of working with a committed 0.01 m contact.
  //
  // The "existing unit" path goes through sectionAwareCreateContact (already
  // #57-correct via GET) â€” DO NOT change it.
  const handleManualLithoUnitCreate = useCallback(
    async (
      mainCode: string,
      admixtures: AdmixtureItem[],
      anchorKind: 'cpt' | 'borehole',
      anchorId: string,
      depthM: number,
    ): Promise<{ formationId: string } | null> => {
      // Debt #151 dogfeed refinement 2026-05-27 (owner): "how about we
      // don't wire it through the suggestion and it immediately
      // becomes an accepted litho layer, user can always right click
      // delete anyway".
      //
      // Direct-insert flow.  Replaces the previous
      // create-formation-only â†’ ghost â†’ user-accepts chain.  Two
      // accept-litho-suggestions calls fire in sequence:
      //
      //   1. Top contact at ``depthM`` with the user's chosen
      //      lithology + admixtures.  The new band starts here.
      //   2. Restoration contact at ``depthM + 0.20`` with the
      //      SURROUNDING band's lithology + admixtures (found via the
      //      deepest existing litho contact whose ``depth_top_m <=
      //      depthM``).  The original band continues underneath.
      //
      // Result: 3 visible bands instead of 2 (original split into
      // top + bottom pieces, new layer in between).  No pending-ghost
      // state; the user can right-click â†’ Remove to undo, and the
      // existing same-litho merge popup re-merges the surrounding
      // pieces if the user removes the new one.
      if (!activeLithoModel || !selectedSection) {
        log.warn('section', 'handleManualLithoUnitCreate: no active litho model or section')
        return null
      }

      type ManualSuggestion = {
        depth_top_m: number
        depth_base_m: number
        suggested_lithology: string
        suggested_nad_class: null
        mean_qc_mpa: null
        dr_pct: null
        confidence: 'medium'
        source: 'manual_pick'
        suggested_admixtures: AdmixtureItem[]
        parent_formation_id: null
        spans_boundary: false
      }

      // Snapshot the surrounding formation BEFORE we mutate any
      // contacts.  Surrounding = deepest existing litho contact whose
      // ``depth_top_m <= depthM`` (the band the click sits inside).
      const peers = lithoContacts
        .filter(c => (c.borehole_id ?? c.cpt_id) === anchorId)
        .slice()
        .sort((a, b) => a.depth_top_m - b.depth_top_m)
      let surroundingContact: typeof peers[number] | null = null
      for (const c of peers) {
        if (c.depth_top_m <= depthM) surroundingContact = c
        else break
      }
      const surroundingFormation = surroundingContact !== null
        ? formations.find(f => f.id === surroundingContact?.formation_id)
            ?? lithoFormations.find(f => f.id === surroundingContact?.formation_id)
            ?? null
        : null

      const topSuggestion: ManualSuggestion = {
        depth_top_m: depthM,
        depth_base_m: depthM + 0.2,
        suggested_lithology: mainCode,
        suggested_nad_class: null,
        mean_qc_mpa: null,
        dr_pct: null,
        confidence: 'medium',
        source: 'manual_pick',
        suggested_admixtures: admixtures,
        parent_formation_id: null,
        spans_boundary: false,
      }

      log.debug(
        'section',
        `handleManualLithoUnitCreate (direct-insert): litho_model=${activeLithoModel.id} ` +
          `anchor=${anchorKind}/${anchorId} depth=${depthM.toFixed(2)}m soil=${mainCode} ` +
          `surrounding=${surroundingFormation?.litho_main_soil_code ?? '(none)'}`,
      )

      try {
        // 1. Insert the user's chosen layer (top contact at depthM).
        const topResult = await api.geology.acceptLithoSuggestions(
          project.id,
          activeLithoModel.id,
          {
            [anchorKind === 'cpt' ? 'cpt_id' : 'borehole_id']: anchorId,
            section_id: selectedSection.id,
            suggestions: [topSuggestion],
          },
        )
        if (topResult.updated_section != null) {
          applyUpdatedSection(topResult.updated_section)
        }
        const formationId =
          topResult.created_formation_ids[0] ?? topResult.found_formation_ids[0] ?? null
        if (formationId === null) {
          log.warn(
            'section',
            'handleManualLithoUnitCreate: no formation id in top-insert response',
          )
          return null
        }

        // 2. Restoration contact at depthM + 0.20 carrying the
        //    surrounding band's lithology + admixtures.  Skip if no
        //    surrounding (e.g. inserting at the top of a column with
        //    no prior litho contacts above) â€” the new band simply
        //    extends downward to the next existing contact (or the
        //    test bottom), which is the right behaviour when there's
        //    nothing to restore.  Skip if the surrounding is the
        //    SAME as the user's pick (a same-litho restoration would
        //    be a no-op cosmetic duplicate).
        if (
          surroundingFormation?.litho_main_soil_code != null
          && surroundingFormation.litho_main_soil_code !== mainCode
        ) {
          const restorationSuggestion: ManualSuggestion = {
            depth_top_m: depthM + 0.2,
            depth_base_m: depthM + 0.21, // sentinel â€” only depth_top_m matters for the new contact
            suggested_lithology: surroundingFormation.litho_main_soil_code,
            suggested_nad_class: null,
            mean_qc_mpa: null,
            dr_pct: null,
            confidence: 'medium',
            source: 'manual_pick',
            suggested_admixtures: (surroundingFormation.litho_admixtures ?? []).map(a => ({
              soil_code: a.soil_code,
              amount: a.amount,
              locally: a.locally,
            })),
            parent_formation_id: null,
            spans_boundary: false,
          }
          try {
            const restoreResult = await api.geology.acceptLithoSuggestions(
              project.id,
              activeLithoModel.id,
              {
                [anchorKind === 'cpt' ? 'cpt_id' : 'borehole_id']: anchorId,
                section_id: selectedSection.id,
                suggestions: [restorationSuggestion],
              },
            )
            if (restoreResult.updated_section != null) {
              applyUpdatedSection(restoreResult.updated_section)
            }
            log.success(
              'section',
              `handleManualLithoUnitCreate restoration ok at depth=${(depthM + 0.2).toFixed(2)}m ` +
                `lithology=${surroundingFormation.litho_main_soil_code}`,
            )
          } catch (err) {
            log.warn(
              'section',
              'handleManualLithoUnitCreate: restoration acceptLithoSuggestions failed â€” the new layer\'s bottom boundary is missing',
              err,
            )
          }
        }

        // Refresh formations + litho contacts so the new contacts
        // land in local state â€” without this the in-corridor
        // ``sectionContacts`` filter in SectionsCanvas still has the OLD
        // ``lithoContacts`` and renders nothing for the new contact
        // (owner dogfeed 2026-05-27: "dialog box, select a unit but
        // nothing is being rendered").
        refetchFormations()
        refetchLithoContacts()

        log.success(
          'section',
          `handleManualLithoUnitCreate: layer committed formationId=${formationId}`,
        )
        return { formationId }
      } catch (err) {
        log.warn('section', 'handleManualLithoUnitCreate: top-insert acceptLithoSuggestions failed', err)
        return null
      }
    },
    [
      activeLithoModel,
      selectedSection,
      project.id,
      applyUpdatedSection,
      refetchFormations,
      refetchLithoContacts,
      lithoContacts,
      formations,
      lithoFormations,
    ],
  )

  // Debt #151 dogfeed refinement 2026-05-27 â€” Existing Units tab of
  // ``LithoCompositionPickerDialog`` on the litho axis.  Looks up the
  // picked formation by id and reuses ``handleManualLithoUnitCreate``
  // with its litho code + admixtures; the backend's find-or-create
  // returns the same formation row (no duplicate), and a ghost lands
  // at the click depth.
  const handleLithoExistingUnitPick = useCallback(
    async (
      anchorKind: 'cpt' | 'borehole',
      anchorId: string,
      depthM: number,
      formationId: string,
    ): Promise<void> => {
      const formation = lithoFormations.find(f => f.id === formationId)
      if (!formation?.litho_main_soil_code) {
        log.warn(
          'section',
          `handleLithoExistingUnitPick: formation ${formationId} missing litho_main_soil_code`,
        )
        return
      }
      const admixtures = (formation.litho_admixtures ?? []) as AdmixtureItem[]
      await handleManualLithoUnitCreate(
        formation.litho_main_soil_code,
        admixtures,
        anchorKind,
        anchorId,
        depthM,
      )
    },
    [lithoFormations, handleManualLithoUnitCreate],
  )

  // Build the lithoGhostState bundle passed to SectionPanel.
  // Only populated on the litho axis when suggestions are loaded for an
  // investigation â€” zero regression on the geological axis. Reads the
  // focused entry from the unified Map (debt #77 Phase 2).
  const lithoGhostState = useMemo(() => {
    if (!isLitho || focusedSuggestAnchorId === null) return undefined
    const entry = ghostsByAnchor.get(focusedSuggestAnchorId)
    if (!entry || entry.suggestions.length === 0) return undefined
    return {
      suggestions: entry.suggestions,
      investigationId: focusedSuggestAnchorId,
      surfaceElevationM: lithoGhostSurfaceElevationM,
      acceptedIndices: entry.accepted,
      rejectedIndices: entry.rejected,
      onAccept: sectionAwareAcceptLithoSuggestion,
      onReject: handleRejectLithoSuggestion,
      // Drag-resize edits â€” the user's depth modifications per ghost
      // index (Phase 2). LithoSuggestionGhostColumns reads `edits` at
      // render time so the ghost rect tracks the live drag commit.
      edits: entry.edits,
      onEdit: handleEditLithoSuggestion,
      // Debt #86: cross-investigation copy-composition paste â€” routes
      // through the bulk edit handler regardless of which anchor the
      // target belongs to (the unified ghostsByAnchor Map covers every
      // anchor including the focused one).
      onCrossColumnPaste: handleEditBulkLitho,
      // Debt #85: insert a new pending litho layer at a shared boundary.
      // The focused anchor's id is captured at SectionsCanvas level so
      // the ghost component doesn't need to know it.
      onInsertLayer: (
        afterIdx: number,
        composition: {
          suggested_lithology: string
          suggested_admixtures: readonly { soil_code: string; amount: string; locally: boolean }[]
        },
      ) => {
        if (focusedSuggestAnchorId === null) return
        handleInsertLithoLayer(focusedSuggestAnchorId, afterIdx, composition)
      },
      // Debt #98: split a pending layer at its midpoint.
      onSplitLayer: (idx: number) => {
        if (focusedSuggestAnchorId === null) return
        handleSplitLithoLayer(focusedSuggestAnchorId, idx)
      },
      // Debt #102: merge two adjacent same-lithology pending layers.
      onMergeLayers: (upperIdx: number) => {
        if (focusedSuggestAnchorId === null) return
        handleMergeLithoLayers(focusedSuggestAnchorId, upperIdx)
      },
      // Extend a manual ghost sentinel to the nearest committed contacts.
      onExtendToNearest: (idx: number) => {
        if (focusedSuggestAnchorId === null) return { ok: false, reason: 'No focused anchor.' }
        const cpt = visibleCpts.find(c => c.id === focusedSuggestAnchorId)
        const bh = cpt === undefined ? visibleBoreholes.find(b => b.id === focusedSuggestAnchorId) : undefined
        const maxDepthM =
          cpt?.max_depth_m ?? bh?.total_depth_m ?? 30
        return handleExtendLithoGhostToNearestContacts(focusedSuggestAnchorId, idx, maxDepthM)
      },
      // Slice 3 of the unified-boundary-drag work (2026-05-30): the
      // committed litho contacts for the focused anchor, filtered down
      // here so the ghost component doesn't have to know the anchor-
      // matching shape. The hook uses this list to find the contact
      // whose depth_top_m equals the pre-drag boundary depth (the
      // dragger's initialDepthM) when an accepted neighbour is on the
      // drag direction â€” then fires onUpdateContactDepth to move the
      // committed contact along with the pending edit. Pre-filter by
      // anchor so the lookup is O(N_contacts_on_this_anchor) not O(N_all).
      committedContactsForAnchor: lithoContacts.filter(
        c => c.cpt_id === focusedSuggestAnchorId || c.borehole_id === focusedSuggestAnchorId,
      ),
      // Robust-fix follow-up (dogfeed 2026-05-30): contact ids per
      // accepted suggestion idx, populated by the accept handlers
      // on the focused ghost entry. Surfaces the identity-match path
      // in ``useBoundaryDrag`` for single-suggestion accepts; multi-
      // suggestion accepts (accept-all / bulk) fall back to depth-
      // tolerance until those handlers populate the map too.
      contactIdsByAcceptedIdx: entry.contactIdsByAcceptedIdx,
      // The cross-store PATCH dispatch (Slice 3). Uses the existing
      // snap-aware wrapper so the post-PATCH litho-geo snap prompt
      // (debt #134) still fires identically â€” the suggestion-drag
      // path is just another entry point to the same audit trail.
      onUpdateContactDepth: handleLithoSnapAwareUpdateContactDepth,
      // P1b â€” live preview callback. Updates SectionsCanvas state;
      // SectionPanel forwards the resulting override to ContactsLayer
      // so the committed contact's render follows the drag live.
      onContactLivePreview: handleLithoContactLivePreview,
    }
  }, [
    isLitho,
    ghostsByAnchor,
    focusedSuggestAnchorId,
    lithoGhostSurfaceElevationM,
    sectionAwareAcceptLithoSuggestion,
    handleRejectLithoSuggestion,
    handleEditLithoSuggestion,
    handleEditBulkLitho,
    handleInsertLithoLayer,
    handleSplitLithoLayer,
    handleMergeLithoLayers,
    handleExtendLithoGhostToNearestContacts,
    visibleCpts,
    visibleBoreholes,
    lithoContacts,
    handleLithoSnapAwareUpdateContactDepth,
    handleLithoContactLivePreview,
  ])

  // Bulk-suggest bundle (debt #73 / Phase 3) â€” passed to SectionPanel
  // so it can render one LithoSuggestionGhostColumns per bulk anchor.
  // The accept handler wraps to forward the section id +
  // applyUpdatedSection for the explicit-content invariant (#57).
  const sectionAwareAcceptBulkLitho = useCallback(
    async (anchorId: string, idx: number): Promise<void> => {
      await handleAcceptBulkLitho(
        anchorId,
        idx,
        selectedSection?.id ?? null,
        applyUpdatedSection,
      )
    },
    [handleAcceptBulkLitho, selectedSection, applyUpdatedSection],
  )
  // Bulk subset = Map minus focused entry (debt #77 Phase 2). When no
  // focus, the whole Map IS the bulk set.
  const bulkAnchorGhosts = useMemo(() => {
    if (focusedSuggestAnchorId === null) return ghostsByAnchor
    if (!ghostsByAnchor.has(focusedSuggestAnchorId)) return ghostsByAnchor
    const next = new Map(ghostsByAnchor)
    next.delete(focusedSuggestAnchorId)
    return next
  }, [ghostsByAnchor, focusedSuggestAnchorId])
  const bulkLithoGhostState = useMemo(() => {
    if (!isLitho || bulkAnchorGhosts.size === 0) return undefined
    return {
      anchorGhosts: bulkAnchorGhosts,
      onAccept: sectionAwareAcceptBulkLitho,
      onReject: handleRejectBulkLitho,
      onEdit: handleEditBulkLitho,
      // Debt #86: same handler â€” works for any target anchor in the Map.
      onCrossColumnPaste: handleEditBulkLitho,
      // Debt #85: bulk variant takes (anchorId, afterIdx, composition).
      // SectionPanel forwards anchorId at the call site.
      onInsertLayer: handleInsertLithoLayer,
      // Debt #98: bulk variant takes (anchorId, idx).
      onSplitLayer: handleSplitLithoLayer,
      // Debt #102: bulk variant takes (anchorId, upperIdx).
      onMergeLayers: handleMergeLithoLayers,
      // Extend a manual ghost sentinel â€” bulk variant takes (anchorId, idx).
      onExtendToNearest: (anchorId: string, idx: number) => {
        const cpt = visibleCpts.find(c => c.id === anchorId)
        const bh = cpt === undefined ? visibleBoreholes.find(b => b.id === anchorId) : undefined
        const maxDepthM = cpt?.max_depth_m ?? bh?.total_depth_m ?? 30
        return handleExtendLithoGhostToNearestContacts(anchorId, idx, maxDepthM)
      },
    }
  }, [
    isLitho,
    bulkAnchorGhosts,
    sectionAwareAcceptBulkLitho,
    handleRejectBulkLitho,
    handleEditBulkLitho,
    handleInsertLithoLayer,
    handleSplitLithoLayer,
    handleMergeLithoLayers,
    handleExtendLithoGhostToNearestContacts,
    visibleCpts,
    visibleBoreholes,
  ])


  // -------------------------------------------------------------------------
  // Inspect-lens-body panel derived values.
  //
  // presentInvestigationIds: investigation ids that have a committed contact
  // for the inspected formation on THIS section.  Empty when the panel is
  // closed.  Built from sectionContacts (already filtered to this section).
  //
  // investigationLabels: id â†’ human label map built from visibleCpts +
  // visibleBoreholes so the panel can show "CPT-123" instead of a UUID.
  //
  // existingLens: the LithoLensOrm row (if any) whose formation_id +
  // body_ordinal match the panel's target â€” pre-fills the name field.
  // -------------------------------------------------------------------------
  const inspectPresentIds = useMemo((): readonly string[] => {
    if (inspectTarget === null) return []
    return sectionContacts
      .filter(c => c.formation_id === inspectTarget.formationId)
      .map(c => c.cpt_id ?? c.borehole_id ?? '')
      .filter(Boolean)
  }, [inspectTarget, sectionContacts])

  const investigationLabels = useMemo((): ReadonlyMap<string, string> => {
    const m = new Map<string, string>()
    for (const cpt of visibleCpts) m.set(cpt.id, cpt.name ?? cpt.id)
    for (const bh of visibleBoreholes) m.set(bh.id, bh.name ?? bh.id)
    return m
  }, [visibleCpts, visibleBoreholes])

  const existingLens = useMemo((): BodyListItem | null => {
    if (inspectTarget === null) return null
    return (
      inspectLenses.find(
        l =>
          l.formation_id === inspectTarget.formationId &&
          l.body_ordinal === inspectTarget.bodyOrdinal,
      ) ?? null
    )
  }, [inspectTarget, inspectLenses])

  if (selectedSection !== null) {
    // WHY Fragment: InspectLensBodyPanel and CompanionOfferDialog are SectionsCanvas-
    // level portals (they escape the SVG stacking context via createPortal in Modal).
    // They must render alongside SectionPanel â€” not only in the no-section-selected
    // branch. Wrapping in a Fragment keeps the early-return semantics while ensuring
    // both dialogs are reachable from the section view (#101 fix-up 2).
    return (
      <>
        <SectionPanel
          section={selectedSection}
          zEpsg={project.default_vertical_epsg}
          cpts={visibleCpts}
          boreholes={visibleBoreholes}
          onPatch={handlePatchSelectedSection}
          onClose={clearSectionSelection}
          undoStack={undoStack}
          onSelectCpt={handleSelect}
          onSelectBorehole={handleSelectBorehole}
          contacts={sectionContacts}
          focusableContacts={axisContacts}
          liveContactDepthOverride={lithoSuggestionContactPreview}
          formations={axisFormations}
          surfacesByFormationId={axisSurfacesByFormationId}
          focusedContactIds={focusedContactIds}
          excludedBoreholeIds={axisExcludedBoreholeIds}
          // On the litho axis, left-click must never open the formation
          // picker â€” the right-click ghost flow is the intended entry point
          // (dogfeed 2026-05-26). Passing undefined here prevents
          // ContactPickBar's onCommitDepth and BoreholeColumn's onCommitDepth
          // from firing handlePickCpt/handlePickBorehole, which is where the
          // picker dialog opens in useContactPicker â€” BEFORE the internal
          // sectionAwareCreateContact early-return guard even runs. The previous
          // guard was too late in the callback chain.
          onCreateContact={(isLitho || isGeotech) ? undefined : sectionAwareCreateContact}
          onUpdateContactDepth={handleLithoSnapAwareUpdateContactDepth}
          onDeleteContact={handleDeleteContact}
          onUnlinkLithoFromGeo={isLitho ? handleUnlinkLithoFromGeo : undefined}
          onLinkLithoToGeo={isLitho ? handleLinkLithoToGeo : undefined}
          // Geotech axis is view-only; geology sync not applicable.
          onBatchUpdateContacts={handleBatchUpdateContacts}
          onBatchCreateContacts={sectionAwareBatchCreateContacts}
          // Seed from stratigraphy: only available on the geological axis
          // (the litho axis has its own suggest-litho flow). On the litho
          // axis the prop is undefined and the button stays disabled.
          //
          // P2-G: pass selectedSection.id as sectionId so the router seeds
          // seeded_formation_contact_ids and returns updated_section.
          // applyUpdatedSection patches local section state from the response
          // without a refetch GET â€” the section's seeded set is immediately
          // current so P2-F's filter picks up the new contacts on the next render.
          onAutoPopulateFromStratigraphy={
            !isLitho && !isGeotech && formations.length > 0
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
          bulkLithoGhostState={bulkLithoGhostState}
          // Geological surface backdrop (#60): only on the litho axis and only
          // when at least one geological formation exists. The geological
          // ``formations`` list is already loaded by the model bootstrap; the
          // surfaces come from the user-triggered ``handleLoadBackdropSurfaces``
          // call (the rewired "Sync geology" verb in SectionsToolbar).
          referenceFormations={isLitho && formations.length > 0 ? formations : undefined}
          referenceSurfacesByFormationId={
            isLitho && backdropSurfacesByFormationId.size > 0
              ? backdropSurfacesByFormationId
              : undefined
          }
          // Snap-to-contact backdrop: on the litho axis, the geological
          // contacts are passed through so ContactsLayer can draw a
          // polyline that goes EXACTLY through each pick (no 3Dâ†’2D
          // projection error). The user picks each strato contact with
          // intent; the rendered backdrop honours that.
          referenceContacts={isLitho && contacts.length > 0 ? contacts : undefined}
          // Lift the section-local focused column to the shell so
          // SectionsToolbar can use it for the litho-axis Suggest button.
          onFocusedColumnChange={setSectionFocusedColumn}
          // Manual litho composition picker (Phase-1.5): the picker dialog
          // is shown instead of the geological FormationPicker when the
          // section is on the lithostratigraphic axis.
          axisMode={
            isGeotech
              ? 'geotechnical'
              : isLitho
                ? 'lithostratigraphic'
                : 'geological'
          }
          // Debt #134-B â€” drag-readout "â†¦ snap on release" hint.  Pure
          // pre-release telegraph for the same prompt the post-release
          // wrapper above (handleLithoSnapAwareUpdateContactDepth)
          // fires.  Wired only on the litho axis; ContactsLayer also
          // guards on a non-empty referenceContacts set.
          geoSnapToleranceM={isLitho ? lithoSnapToleranceM : undefined}
          openExtentLengthM={openExtentLengthM}
          // 3-D model fill (Task 5, litho-3D M3): feed the prebuilt body solids
          // into the 2-D section overlay so the geometric fill is consistent with
          // the 3-D viewer.  Litho axis only â€” undefined on the geological axis so
          // SectionPanel renders no ModelFillOverlay there (zero regression).
          lithoSolids={isLitho ? lithoSolids : undefined}
          sectionFillAtSectionLine={isLitho ? sectionFillAtSectionLine : undefined}
          onManualLithoUnitCreate={isLitho ? handleManualLithoUnitCreate : undefined}
          onLithoExistingUnitPick={isLitho ? handleLithoExistingUnitPick : undefined}
          activeLithoModelId={isLitho ? (activeLithoModel?.id ?? null) : null}
          // #133 Phase 1 + Phase 2+3: contact-level correlation edges + gesture
          // state, litho axis only.  CorrelationEdgesOverlay is mounted on the
          // litho axis (SectionPanel gates on axisMode === 'lithostratigraphic')
          // and absent on the geological axis â€” zero regression.
          contactEdges={(isLitho || isGeotech) ? contactCorrelationEdges : undefined}
          // Geotech "Correlate packing" overlay edges (Phase 1, 2026-06-25):
          // SEPARATE from contactEdges (which stays the litho-framed partition
          // list on both axes). The overlay reads this on the geotech axis only;
          // never feeds the partition / spacing (commit 7329738b regression).
          geotechCorrelationEdges={isGeotech ? geotechPackingEdges : undefined}
          // Auto-lens (2026-06-02): pinch-out lens candidates from the last
          // auto-correlate run, rendered as amber diamonds on the litho axis.
          crossingPinchOuts={isLitho ? lithoCrossingPinchOuts : undefined}
          contactGestureState={contactGestureState}
          onUnapprovedDragStart={isLitho ? handleUnapprovedDragStart : undefined}
          unapprovedEdgeDrag={unapprovedEdgeDrag}
          // #163e: right-click a correlation edge â†’ "Delete correlation".
          // On litho: uses the litho delete handler (undo-stack wired).
          // On geotech: uses the packing disconnect handler (no undo â€” the
          //   subdivide verb re-generates all packing correlations anyway).
          onRequestDeleteEdge={
            isLitho
              ? edge =>
                  void handleDeleteContactCorrelation(
                    edge.layer_a_id,
                    edge.layer_b_id,
                    edge.layer_a_side,
                    edge.layer_b_side,
                  )
              : isGeotech
                ? edge =>
                    void handleDeleteGeotechPackingCorrelation(
                      edge.layer_a_id,
                      edge.layer_b_id,
                      edge.layer_a_side,
                      edge.layer_b_side,
                    )
                : undefined
          }
          // Dogfeed 2026-05-31: right-click a pending edge â†’ "Accept correlation".
          // Geotech edges have no approval workflow (they are always treated as
          // approved); the menu item is suppressed on the geotech axis.
          onRequestAcceptEdge={
            isLitho ? edge => void handleAcceptContactCorrelation(edge.id) : undefined
          }
          // #163f Slice 2 â€” lens wedges + shaping (litho axis only).
          lenses={
            isLitho
              ? lensList
              : isGeotech
                ? [] // geotech axis: bodies resolved via correlations; no lens entities yet
                : undefined
          }
          // Frames the partition columns. On the litho axis these are the litho
          // layers; on the geotech axis it is ALSO the litho layers now â€” the
          // geotech partition is the litho partition REFINED by NAD packing
          // class (see `geotechRefinement`, owner-locked 2026-07-06), not a
          // direct geotech-model fill. `sectionLayers` == `lithoLayers` on both
          // axes; the refinement bundle carries the geotech sub-bands.
          lithoLayers={(isLitho || isGeotech) ? sectionLayers : undefined}
          refinement={geotechRefinement}
          lensBoundaries={lensBoundaries}
          onSaveLensShape={isLitho ? handleSaveLensShape : undefined}
          onDeleteLens={isLitho ? handleDeleteLens : undefined}
          onNameBody={isLitho ? bid => void handleNameBody(bid) : undefined}
          onDissolveBody={isLitho ? bid => void handleDissolveBody(bid) : undefined}
          pulsingFormationIds={pulsingFormationIds}
          onPropagateAdmixtures={isLitho ? handlePropagateAdmixtures : undefined}
          // Inspect-lens-body panel (#101 Blocker 1): litho axis only; absent on
          // geological axis (no correlation bodies exist there).
          onInspectLensBody={
            isLitho ? (fid, ord) => void handleOpenInspectLensBody(fid, ord) : undefined
          }
          // Geology-stage deep-link (litho axis only, dogfeed 2026-05-25).
          // Right-click on a reference (geological backdrop) contact strip â†’
          // "Edit in Geology stage" â†’ sets geoDeepLinkTarget on the coordinator.
          // AppShell watches the target and switches to the geology stage on
          // the correct section; GeologyInspector consumes + clears the payload.
          onEditInGeologyStage={
            isLitho && contacts.length > 0
              ? (contactId, _formationId) => {
                  if (!selectedSection) return
                  setGeoDeepLinkTarget({
                    sectionId: selectedSection.id,
                    contactId,
                  })
                }
              : undefined
          }
        />
        {/* Inspect-lens-body panel (#101 Blocker 1) â€” shared between section-selected
            and no-section branches; Portal via Modal escapes the SVG stacking context. */}
        {inspectTarget !== null && (
          <InspectLensBodyPanel
            target={inspectTarget}
            formations={isLitho ? lithoFormations : []}
            presentInvestigationIds={inspectPresentIds}
            investigationLabels={investigationLabels}
            existingLensId={existingLens?.id ?? null}
            existingLensName={existingLens?.name ?? null}
            onLensNamed={(lensId, wasCreated) => {
              if (activeLithoModel) {
                api.geology
                  .listLenses(project.id, activeLithoModel.id)
                  .then(lenses => setInspectLenses(lenses))
                  .catch(err =>
                    log.warn('section', 'onLensNamed: listLenses refresh failed', err),
                  )
              }
              log.success(
                'section',
                `InspectLensBodyPanel: lens ${lensId} ${wasCreated ? 'created' : 'updated'}`,
              )
            }}
            onOfferCompanion={(lensId, lensName) => {
              if (activeLithoModel) {
                setCompanionOffer({
                  lensId,
                  lensName,
                  modelId: activeLithoModel.id,
                })
              }
            }}
            onAbsenceUpdated={() => {
              log.debug('section', 'InspectLensBodyPanel: absence updated')
            }}
            onClose={() => setInspectTarget(null)}
          />
        )}
        {/* Companion-offer dialog â€” same: must be reachable from the section view. */}
        {companionOffer !== null && project !== null && (
          <CompanionOfferDialog
            open={companionOffer !== null}
            projectId={project.id}
            modelId={companionOffer.modelId}
            lensId={companionOffer.lensId}
            lensName={companionOffer.lensName}
            onSectionCreated={async (sectionId: string) => {
              await refreshSectionList()
              handleSectionCreated(sectionId)
              handleSelectSection(sectionId)
              toast('success', 'Perpendicular section created.')
            }}
            onClose={() => setCompanionOffer(null)}
          />
        )}
        {/* Litho â†” geological snap prompt (debt #134) â€” fires after a
            litho-contact drag commits within tolerance of a geological
            contact on the same investigation. */}
        <LithoGeoSnapDialog
          open={lithoGeoSnapPrompt !== null}
          candidates={lithoGeoSnapPrompt?.candidates ?? []}
          lithoDepthM={lithoGeoSnapPrompt?.rawDepthM ?? 0}
          onSnapToGeo={(id) => void handleSnapLithoToGeo(id)}
          onMoveGeoToLitho={(id) => void handleMoveGeoToLitho(id)}
          onCancel={handleSnapDialogCancel}
          busy={lithoGeoSnapBusy}
        />
        {/* Name / rename a lens (body). Replaces the dead-end window.prompt â€”
            Electron disables prompt() in the renderer. */}
        <NameBodyDialog
          open={namingBody !== null}
          initialName={namingBody?.currentName ?? ''}
          onSubmit={submitBodyName}
          onCancel={() => setNamingBody(null)}
        />
      </>
    )
  }

  // No section selected â€” show the map so the user can draw a new line
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
        suggestedTies={suggestedTies}
        tieEpsg={effectiveHorizontalEpsg}
        onAcceptTie={handleAcceptTie}
        onRejectTie={handleRejectTie}
      />

      {/* Empty-state CTA â€” pointer-events-none on the wrapper keeps
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
                      ? 'Creatingâ€¦'
                      : 'Create a new cross-section with placeholder endpoints'
                }
              >
                {ctaCreating ? (
                  <>
                    <Loader2
                      className="h-3 w-3 animate-spin"
                      aria-hidden="true"
                    />
                    Creatingâ€¦
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
