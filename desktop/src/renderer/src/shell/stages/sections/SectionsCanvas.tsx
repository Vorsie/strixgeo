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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Route } from 'lucide-react'

import { api } from '../../../api/client'
import type {
  AdmixtureItem,
  LensBoundaryNode,
  LensBoundaryResponse,
  LensRenderStyle,
  LithoContactCorrelationEdge,
  LithoLensListItem,
} from '../../../api/client'
import type {
  ContactGestureState,
} from '../../../components/sections/CorrelationEdgesOverlay'
import LithoGeoSnapDialog from '../../../components/LithoGeoSnapDialog'
import { findGeoSnapCandidates } from '../../../utils/lithoGeoSnap'
import { readLithoSegmenterPrefs } from '../../../utils/lithoSegmenterPrefs'
import type { FormationContactResponse } from '../../../api/client'
import CompanionOfferDialog from '../../../components/sections/CompanionOfferDialog'
import InspectLensBodyPanel from '../../../components/sections/InspectLensBodyPanel'
import type { InspectLensBodyTarget } from '../../../components/sections/InspectLensBodyPanel'
import type { ClaimableKind } from '../../../components/sections/BodyContextMenu'
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
      lithoFormations,
      lithoSurfacesByFormationId,
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
      handleUnrejectLithoSuggestion,
      handleSuggestAllLitho,
      handleAcceptBulkLitho,
      refetchLithoContacts,
      handleAcceptAllBulkLitho,
      handleRejectBulkLitho,
      handleUnrejectBulkLitho,
      handleEditBulkLitho,
      handleInsertLithoLayer,
      handleSplitLithoLayer,
      handleMergeLithoLayers,
      handleAbsorbLithoLayer,
      handleCreateManualLithoGhost,
      handleExtendLithoGhostToNearestContacts,
      clearBulkLithoGhosts,
      pinchOutPreview,
      pinchOutLoading,
      handlePreviewPinchOut,
      handleCommitPinchOut,
      clearPinchOutPreview,
      backdropSurfacesByFormationId,
      handleLoadBackdropSurfaces,
      refetchFormations,
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
      showConfidenceFade,
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

  // CTA card dismiss state — the overlay disappears once the user has
  // started drawing or explicitly clicked "New cross-section" on the
  // card itself. Resets when the canvas mounts (i.e. the user navigates
  // to the Sections stage) so new users always see the prompt.
  const [ctaDismissed, setCtaDismissed] = useState(false)

  // Companion-offer dialog state — opened after a lens is created (Blocker 1,
  // owner directive 2026-05-22: "pop up an offer to auto-create a perpendicular
  // cross-section").  Null when the dialog is not open.
  const [companionOffer, setCompanionOffer] = useState<{
    lensId: string
    lensName: string | null
    modelId: string
  } | null>(null)

  // Inspect-lens-body panel state (#101 Blocker 1) — opened by right-clicking
  // a body chip in CorrelationEdgesOverlay → "Inspect lens body…".
  // Carries the lens list fetched lazily on open so the panel can show the
  // existing name (if any) and enable the perpendicular-companion path.
  const [inspectTarget, setInspectTarget] = useState<InspectLensBodyTarget | null>(null)
  const [inspectLenses, setInspectLenses] = useState<LithoLensListItem[]>([])

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

  // Review B1: a pinch-out preview is computed in ONE section's local
  // (along, elevation) frame. If the user switches sections without
  // confirming/dismissing, the stale ghost would render at the wrong
  // place on the new section AND Confirm would commit against the old
  // section's geometry. Clear the preview on any section switch.
  // selectedSectionId is a primitive, so this fires once per real
  // switch, not per render.
  useEffect(() => {
    clearPinchOutPreview()
  }, [selectedSectionId, clearPinchOutPreview])

  // Axis flag — defined early so both Slice 2 and Slice 4 blocks can use it.
  const isLitho = sectionModelAxis === 'lithostratigraphic'

  // Key the fetch on the model ID, not the model object: the object
  // re-identifies on unrelated mutations (e.g. a formation rename rebuilds
  // it), which would churn the contact-edge refetch unnecessarily.
  const lithoModelId = activeLithoModel?.id ?? null

  // Transient pulse state — set on a successful contact correlate, cleared
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
        // Surface the failure — silence on a failed PATCH is worse than a toast.
        log.warn('section', 'handlePropagateAdmixtures: PATCH failed', err)
        toast('error', 'Could not update the body’s admixtures — try again.')
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
        log.warn('section', 'inspectLensBody: listLenses failed — proceeding without names', err)
        setInspectLenses([])
      }
    },
    [activeLithoModel, project.id],
  )

  // #133 Phase 1 + Phase 2+3: contact-level correlation edges.
  //
  // MODEL-level (no section_id) and fetched fresh after each mutation.
  // The formation-level edge layer (Slice 4) was removed in Task 21 (#133
  // Phase 2+3); these contact edges are the sole correlation surface now.
  const [contactCorrelationEdges, setContactCorrelationEdges] = useState<
    LithoContactCorrelationEdge[]
  >([])

  // Armed contact id — the source boundary the user clicked first.
  // Null = nothing armed (idle).
  const [armedContactId, setArmedContactId] = useState<string | null>(null)
  // Sticky lens-window (debt #135): investigation id of the most recent
  // successful target while the same source is still armed.  Null when no
  // edge has committed yet in the current arm-cycle.  A subsequent click on
  // a different contact in this investigation fires another edge from the
  // still-armed source — the lens-pinch-out gesture.  Cleared whenever the
  // source is disarmed or re-armed.
  const [lastTargetTestId, setLastTargetTestId] = useState<string | null>(null)

  // Contact-correlate mode flag — mirrors the toolbar's correlate mode.
  // The boundary-to-boundary gesture is the sole correlate surface (#133
  // Phase 2+3); the formation-level body-click surface was removed in Task 21.
  const contactCorrelateMode = correlateMode

  const refetchContactEdges = useCallback(async () => {
    if (lithoModelId === null) {
      setContactCorrelationEdges([])
      return
    }
    log.debug(
      'section',
      `listContactCorrelations: GET project=${project.id} model=${lithoModelId}`,
    )
    try {
      const edges = await api.geology.listContactCorrelations(project.id, lithoModelId)
      setContactCorrelationEdges(edges)
      log.debug(
        'section',
        `listContactCorrelations: ${edges.length} edge(s) for model ${lithoModelId}`,
      )
    } catch (err) {
      log.warn('section', 'refetchContactEdges: listContactCorrelations failed', err)
    }
  }, [lithoModelId, project.id])

  useEffect(() => {
    if (!isLitho) {
      setContactCorrelationEdges([])
      return
    }
    void refetchContactEdges()
    // reason: isLitho + activeLithoModel.id + selectedSectionId are the three
    // axes that require a re-fetch; refetchContactEdges captures project.id +
    // lithoModelId in its closure so they don't need to be listed here.
    // correlationEdgesRefetchNonce (#163c) is bumped after a successful
    // auto-correlate so the new edges render without a manual reselect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLitho, activeLithoModel?.id, selectedSectionId, correlationEdgesRefetchNonce])

  // #163f Slice 2 — detected lenses + their boundary shapes for LensWedge
  // Overlay. Mirrors the contact-edge fetch (same nonce trigger: lenses are
  // derived from approved edges, so they refresh whenever edges do).
  const [lensList, setLensList] = useState<LithoLensListItem[]>([])
  const [lensBoundaries, setLensBoundaries] = useState<
    ReadonlyMap<string, LensBoundaryResponse>
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
            [l.id, await api.geology.getLensBoundary(project.id, lithoModelId, l.id)] as const,
        ),
      )
      setLensBoundaries(new Map(entries))
    } catch (err) {
      log.warn('section', 'refetchLensData: listLenses/getLensBoundary failed', err)
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

  const handleSaveLensShape = useCallback(
    async (
      lensId: string,
      upperNodes: LensBoundaryNode[],
      lowerNodes: LensBoundaryNode[],
      style: LensRenderStyle,
    ): Promise<void> => {
      if (!activeLithoModel) return
      try {
        const saved = await api.geology.saveLensBoundary(project.id, activeLithoModel.id, lensId, {
          upper_nodes: upperNodes,
          lower_nodes: lowerNodes,
          render_style: style,
        })
        setLensBoundaries(prev => {
          const next = new Map(prev)
          next.set(lensId, saved)
          return next
        })
        markMutated()
      } catch (err) {
        log.warn('section', 'handleSaveLensShape: saveLensBoundary failed', err)
        toast('error', 'Could not save lens shape — see console.')
      }
    },
    [activeLithoModel, project.id, toast, markMutated],
  )

  const handleCreateContactCorrelation = useCallback(
    async (contactAId: string, contactBId: string): Promise<void> => {
      if (!activeLithoModel) return
      const modelId = activeLithoModel.id
      const sectionIdAtPush = selectedSectionId
      log.info(
        'section',
        `contact-correlate: linking ${contactAId} ↔ ${contactBId} on model ${modelId}`,
      )
      try {
        await api.geology.createContactCorrelation(
          project.id,
          modelId,
          contactAId,
          contactBId,
          sectionIdAtPush,
        )
        await refetchContactEdges()
        markMutated()
        // Lens-aware gesture (debt #135): keep ``armedContactId`` set after
        // a successful correlation and record the target's investigation in
        // ``lastTargetTestId``.  A subsequent click on another contact in
        // the same investigation fires a second edge from the same source —
        // the lens-pinch-out topology.  The click handler in
        // CorrelationEdgesOverlay reads ``lastTargetTestId`` to decide.
        const contactA = lithoContacts.find(c => c.id === contactAId)
        const targetContact = lithoContacts.find(c => c.id === contactBId)
        const targetTestId = targetContact?.cpt_id ?? targetContact?.borehole_id ?? null
        setLastTargetTestId(targetTestId)
        // Amber pulse on both correlated bands — the immediate "your gesture
        // worked" cue before formations refetch (dogfeed 2026-05-23 #100).
        if (contactA?.formation_id && targetContact?.formation_id) {
          triggerCorrelationPulse(contactA.formation_id, targetContact.formation_id)
        }
        // Undo wiring (dogfeed 2026-05-31): a manual correlate is a
        // user-visible mutation and should peel off the stack on
        // Ctrl-Z. revert = DELETE the same edge; reapply = re-POST.
        // Both branches refetch + markMutated so the canvas + dirty
        // flag stay in sync. Captured ids/model survive the
        // SectionsCanvas remount-cycle (Refs not needed — these are
        // primitives by value).
        undoStack.push({
          description: 'Correlate contacts',
          revert: async () => {
            await api.geology.deleteContactCorrelation(
              project.id,
              modelId,
              contactAId,
              contactBId,
              sectionIdAtPush,
            )
            await refetchContactEdges()
            markMutated()
          },
          reapply: async () => {
            await api.geology.createContactCorrelation(
              project.id,
              modelId,
              contactAId,
              contactBId,
              sectionIdAtPush,
            )
            await refetchContactEdges()
            markMutated()
          },
        })
        toast('success', 'Boundary correlation added.')
        log.success(
          'section',
          `contact-correlate: edge ${contactAId} ↔ ${contactBId} created` +
            (targetTestId ? ` (sticky target=${targetTestId})` : ''),
        )
      } catch (err) {
        log.warn('section', 'handleCreateContactCorrelation: POST failed', err)
        // Reset the gesture so the user starts cleanly on the next click.
        setArmedContactId(null)
        setLastTargetTestId(null)
        toast('error', 'Could not create the boundary correlation — try again.')
      }
    },
    [activeLithoModel, project.id, selectedSectionId, refetchContactEdges, toast, lithoContacts, triggerCorrelationPulse, markMutated, undoStack],
  )

  const handleDeleteContactCorrelation = useCallback(
    async (contactAId: string, contactBId: string): Promise<void> => {
      if (!activeLithoModel) return
      const modelId = activeLithoModel.id
      const sectionIdAtPush = selectedSectionId
      log.info(
        'section',
        `contact-uncorrelate: removing ${contactAId} ↔ ${contactBId} on model ${modelId}`,
      )
      // Optimistic removal.
      setContactCorrelationEdges(prev =>
        prev.filter(
          e =>
            !(
              (e.contact_a_id === contactAId && e.contact_b_id === contactBId) ||
              (e.contact_a_id === contactBId && e.contact_b_id === contactAId)
            ),
        ),
      )
      try {
        await api.geology.deleteContactCorrelation(
          project.id,
          modelId,
          contactAId,
          contactBId,
          sectionIdAtPush,
        )
        await refetchContactEdges()
        markMutated()
        // Mirror of the create path — undo restores the edge,
        // redo removes it again. Symmetric so a Ctrl-Z + Ctrl-Y
        // round-trip leaves no drift.
        undoStack.push({
          description: 'Uncorrelate contacts',
          revert: async () => {
            await api.geology.createContactCorrelation(
              project.id,
              modelId,
              contactAId,
              contactBId,
              sectionIdAtPush,
            )
            await refetchContactEdges()
            markMutated()
          },
          reapply: async () => {
            await api.geology.deleteContactCorrelation(
              project.id,
              modelId,
              contactAId,
              contactBId,
              sectionIdAtPush,
            )
            await refetchContactEdges()
            markMutated()
          },
        })
        log.success(
          'section',
          `contact-uncorrelate: edge ${contactAId} ↔ ${contactBId} removed`,
        )
      } catch (err) {
        log.warn(
          'section',
          'handleDeleteContactCorrelation: DELETE failed — rolling back optimistic removal',
          err,
        )
        await refetchContactEdges()
      }
    },
    [activeLithoModel, project.id, selectedSectionId, refetchContactEdges, markMutated, undoStack],
  )

  // Right-click a pending correlation edge → "Accept correlation" (dogfeed
  // 2026-05-31).  Single-edge accept: flips user_approved=True on the server,
  // refetches edges + lens data so the seam ribbon, ordinal chips, and
  // wedges all reflect the new approved state.  No undo entry — the symmetric
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
        await refetchContactEdges()
        await refetchLensData()
        markMutated()
        log.success(
          'section',
          `contact-accept: edge=${edgeId} accepted=${result.edges_accepted} ` +
            `lenses_created=${result.lenses_created} lenses_removed=${result.lenses_removed} ` +
            `ordinals_changed=${result.ordinals_changed}`,
        )
      } catch (err) {
        log.warn('section', `handleAcceptContactCorrelation: POST failed for edge ${edgeId}`, err)
        toast('error', 'Could not accept the correlation. Try again or refresh.')
      }
    },
    [activeLithoModel, project.id, refetchContactEdges, refetchLensData, markMutated, toast],
  )

  // Right-click a lens wedge → dissolve the lens (dogfeed 2026-05-29).
  // A lens IS its two defining correlation edges (above↔pinch, below↔pinch);
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
      log.info('section', `delete-lens: dissolving ${aboveId}/${belowId} ↔ ${targetId}`)
      await handleDeleteContactCorrelation(aboveId, targetId)
      await handleDeleteContactCorrelation(belowId, targetId)
      void refetchLensData()
    },
    [handleDeleteContactCorrelation, refetchLensData],
  )

  // Body context menu handlers — wired from BodyContextMenu via SectionPanel.

  // Claim a user-extent on a body.  Looks up the body row from lensList to
  // supply formation_id + source_investigation_id for the POST.  409 (existing
  // user-claim from detector) surfaces a toast; Task 7.5 will promote this to
  // the provenance-conflict dialog.
  const handleClaimBodyExtent = useCallback(
    async (bodyId: string, side: 'left' | 'right', kind: ClaimableKind): Promise<void> => {
      if (!activeLithoModel) return
      const body = lensList.find(b => b.id === bodyId)
      if (!body) {
        log.warn('section', `claim-body-extent: body ${bodyId} not found in lensList`)
        return
      }
      log.info(
        'section',
        `claim-body-extent: body=${bodyId} side=${side} kind=${kind}`,
      )
      try {
        await api.geology.claimBodyExtent(project.id, activeLithoModel.id, {
          formation_id: body.formation_id,
          source_investigation_id: body.source_investigation_id,
          side,
          kind,
        })
        void refetchLensData()
        toast('success', `Extent claimed: ${side} → ${kind}`)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.includes('409') || msg.includes('Conflict')) {
          // Provenance conflict — Task 7.5 will surface a dialog here.
          toast('error', 'Extent already claimed by detector — clear it first.')
        } else {
          toast('error', 'Failed to claim extent.')
          log.warn('section', 'handleClaimBodyExtent: failed', err)
        }
      }
    },
    [activeLithoModel, project.id, lensList, refetchLensData, toast],
  )

  // Clear one side's user extent.  204 = body reaped; 200 = still alive.
  const handleClearBodyExtent = useCallback(
    async (bodyId: string, side: 'left' | 'right'): Promise<void> => {
      if (!activeLithoModel) return
      log.info('section', `clear-body-extent: body=${bodyId} side=${side}`)
      try {
        await api.geology.clearBodyExtent(project.id, activeLithoModel.id, bodyId, side)
        void refetchLensData()
        toast('success', `Extent cleared: ${side}`)
      } catch (err) {
        toast('error', 'Failed to clear extent.')
        log.warn('section', 'handleClearBodyExtent: failed', err)
      }
    },
    [activeLithoModel, project.id, refetchLensData, toast],
  )

  // Name a body via a native prompt (quick path; full rename in the
  // InspectLensBodyPanel).
  const handleNameBody = useCallback(
    async (bodyId: string): Promise<void> => {
      if (!activeLithoModel) return
      const body = lensList.find(b => b.id === bodyId)
      if (!body) {
        log.warn('section', `name-body: body ${bodyId} not found in lensList`)
        return
      }
      const newName = window.prompt('Enter a name for this body:', body.name ?? '')
      if (newName === null) return // cancelled
      const trimmed = newName.trim()
      if (trimmed === '') return
      log.info('section', `name-body: body=${bodyId} name="${trimmed}"`)
      try {
        await api.geology.nameBody(project.id, activeLithoModel.id, bodyId, {
          formation_id: body.formation_id,
          body_ordinal: body.body_ordinal,
          name: trimmed,
        })
        void refetchLensData()
        toast('success', `Body named: ${trimmed}`)
      } catch (err) {
        toast('error', 'Failed to name body.')
        log.warn('section', 'handleNameBody: failed', err)
      }
    },
    [activeLithoModel, project.id, lensList, refetchLensData, toast],
  )

  // Dissolve a body — deletes the body row and all its correlation edges.
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
      // The FK cascade on the backend also removed correlation edges —
      // refetch so the section view reflects the updated edge graph.
      void refetchContactEdges()
      void refetchLithoContacts()
    },
    [activeLithoModel, handleDeleteContact, refetchContactEdges, refetchLithoContacts],
  )

  // Build the contactGestureState passed to SectionPanel.
  // Only wired on the litho axis; absent on the geological axis.
  const contactGestureState: ContactGestureState | undefined = useMemo(() => {
    if (!isLitho) return undefined
    return {
      contactCorrelateMode,
      armedContactId,
      lastTargetTestId,
      // Arming a (new) source always resets the sticky lens window —
      // a fresh source starts a fresh arm-cycle (debt #135).
      onArmContact: (id: string) => {
        setArmedContactId(id)
        setLastTargetTestId(null)
      },
      onClearArmedContact: () => {
        setArmedContactId(null)
        setLastTargetTestId(null)
      },
      onContactCorrelate: handleCreateContactCorrelation,
      onContactUncorrelate: handleDeleteContactCorrelation,
      onRequestDeleteContact: handleRequestDeleteContactFromSection,
    }
  }, [
    isLitho,
    contactCorrelateMode,
    armedContactId,
    lastTargetTestId,
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
  // by default — Option Y: re-targeting an auto suggestion is itself a form
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
     *  CREATE a new one to the drop (the "create an extra boundary" gesture —
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
      const draggedContactId = handle === 'a' ? edge.contact_a_id : edge.contact_b_id
      const anchorContactId = handle === 'a' ? edge.contact_b_id : edge.contact_a_id
      // Resolve anchor investigation id to block same-investigation-as-anchor
      // drops. Ctrl/Cmd at drag start selects "leave + create another"
      // (duplicate → lens) vs plain "retarget the grabbed end".
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
        // Dropped on empty space — cancel.
        log.debug('section', 'edgeDrag: drop on empty space — cancelled')
        setEdgeDrag(null)
        return
      }
      if (dropContactId === edgeDrag.anchorContactId) {
        // Dropped on the anchor endpoint — no-op.
        log.debug('section', 'edgeDrag: drop on anchor — cancelled')
        setEdgeDrag(null)
        return
      }
      if (dropContactId === edgeDrag.draggedContactId) {
        // Dropped back on the same contact — no-op.
        log.debug('section', 'edgeDrag: drop on same contact — cancelled')
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
          `edgeDrag: drop on same investigation as anchor (${edgeDrag.anchorInvestigationId}) — rejected`,
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
      // the same anchor to the drop — "create an extra boundary where I drag
      // to". When the drop is the layer's OTHER boundary (anchor now connects
      // to both → 1↔2), DetectLithoLenses materialises a wedge.
      // ``createContactCorrelation`` is idempotent (re-creating an existing
      // unapproved edge would NOT approve it), so delete the original first
      // then create both fresh — both auto-approve. Direction-agnostic.
      if (capturedDrag.duplicate) {
        log.info(
          'section',
          `edgeDrag: duplicate edge=${capturedDrag.edge.id} anchor=${capturedDrag.anchorContactId} ↔ ` +
            `{${capturedDrag.draggedContactId}, ${dropContactId}}`,
        )
        try {
          await api.geology.deleteContactCorrelation(
            project.id,
            capturedDrag.edge.model_id,
            capturedDrag.edge.contact_a_id,
            capturedDrag.edge.contact_b_id,
            selectedSectionId,
          )
          // Re-create the original (now approved) + the twin to the dropped
          // boundary. The second create completes the 1↔2 and triggers the
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
          await refetchContactEdges()
          void refetchLensData()
          markMutated()
          log.success('section', 'edgeDrag: extra correlation created (anchor ↔ both targets)')
          toast('success', 'Correlation added — a wedge forms when it spans the layer.')
        } catch (err) {
          log.warn('section', 'edgeDrag: duplicate-create failed', err)
          toast('error', 'Could not create the correlation — try again.')
          void refetchContactEdges()
          void refetchLensData()
        }
        return
      }

      log.info(
        'section',
        `edgeDrag: retarget edge=${capturedDrag.edge.id} ` +
          `${capturedDrag.draggedContactId} → ${dropContactId} (anchor=${capturedDrag.anchorContactId})`,
      )

      try {
        // 1. Delete the original edge.
        await api.geology.deleteContactCorrelation(
          project.id,
          capturedDrag.edge.model_id,
          capturedDrag.edge.contact_a_id,
          capturedDrag.edge.contact_b_id,
          selectedSectionId,
        )
        // 2. Create the replacement edge (anchor + new target).
        //    source='manual' → server defaults user_approved=True (Option Y).
        await api.geology.createContactCorrelation(
          project.id,
          capturedDrag.edge.model_id,
          capturedDrag.anchorContactId,
          dropContactId,
          selectedSectionId,
        )
        // 3. Refetch so the section reflects the re-targeted edge.
        await refetchContactEdges()
        markMutated()
        log.success(
          'section',
          `edgeDrag: edge retargeted to ${capturedDrag.anchorContactId} ↔ ${dropContactId}`,
        )
        toast('success', 'Edge retargeted.')
      } catch (err) {
        log.warn('section', 'edgeDrag: retarget failed', err)
        toast('error', 'Could not retarget the edge — try again.')
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
  // SectionPanel and ContactsLayer are UNCHANGED — the prop boundary absorbs
  // the switch. Geological is the default and existing behaviour is identical.
  // (isLitho is defined above the Slice 4 block so both slices share it.)
  // Active model for the chosen axis — used for export button gating.
  const activeAxisModel = isLitho ? activeLithoModel : activeGeologicalModel
  // Contact/formation/surface sets routed by axis.
  const axisContacts = isLitho ? lithoContacts : contacts
  const axisFormations = isLitho ? lithoFormations : formations
  const axisSurfacesByFormationId = isLitho ? lithoSurfacesByFormationId : surfacesByFormationId
  const axisExcludedBoreholeIds = activeAxisModel?.excluded_borehole_ids ?? []
  // Litho axis left-click creates a ghost layer, not a committed contact.
  // The geological axis keeps the original committed-contact flow unchanged.
  const axisCreateContact = isLitho ? handleCreateLithoContact : handleCreateContact
  const axisCreateFormation = isLitho ? handleInlineLithoCreateFormation : handleInlineCreateFormation

  // Override #2 (owner): derive the default backdrop geological-model id at the
  // prop boundary via useMemo from activeLithoModel?.parent_geological_model_id.
  // When the project has more than one geological model the user can override via
  // the picker in SectionsInspector (backdropModelIdOverride from the sections
  // ShellContext slice); the effective id is the override if set, else the parent.
  const defaultBackdropModelId = useMemo(
    () => activeLithoModel?.parent_geological_model_id ?? null,
    [activeLithoModel],
  )
  // Effective backdrop model — the ShellContext override takes precedence when set.
  const effectiveBackdropModelId = backdropModelIdOverride ?? defaultBackdropModelId

  // Auto-load geological backdrop surfaces when switching to the litho axis.
  //
  // WHY: the "Sync geology" verb in SectionsToolbar loads backdrop surfaces
  // on demand, but users expect to see the geological reference immediately
  // when they switch to the litho axis — they should not have to know to
  // press a separate button first.  Auto-loading on axis-switch is cheap
  // (handleLoadBackdropSurfaces is idempotent: already-loaded surfaces are
  // skipped in useGeologicalModel) and makes the litho axis useful out of
  // the box.
  //
  // Gate: only fire when axis is litho AND a backdrop model id is known.
  // null effectiveBackdropModelId means no litho model or no parent — nothing
  // to load.
  useEffect(() => {
    if (!isLitho) return
    if (!effectiveBackdropModelId) return
    void handleLoadBackdropSurfaces(effectiveBackdropModelId)
  }, [isLitho, effectiveBackdropModelId, handleLoadBackdropSurfaces])

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

      // Litho axis left-click: no-op.  The ghost-creation flow (manual insert)
      // is triggered exclusively by the right-click "Create layer" context-menu
      // item in LithoSuggestionGhostColumns.  Left-click on the contact-pick bar
      // was wired to create a ghost (2026-05-19), but the ghost renders as a
      // zero-thickness, outline-only band that the user cannot see, making the
      // gesture invisible and confusing.  The right-click path already covers
      // the intent; this branch is deleted (dogfeed 2026-05-26).
      if (isLitho) return

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
    // reason: isLitho is listed so the early-return branch refreshes when the
    // axis switches; visibleCpts/visibleBoreholes are stable arrays during a
    // session but listed for completeness.  handleCreateManualLithoGhost is no
    // longer called here (left-click on the litho axis is a no-op per the
    // 2026-05-26 dogfeed revert above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedSection, axisCreateContact, project.id, applyUpdatedSection, isLitho],
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
  // in P2-F hides every accepted contact immediately after acceptance — the #57
  // class bug, recurred 3×.  The raw handler accepts an optional onSectionUpdated
  // callback; we wire it here at the SectionsCanvas boundary where both
  // selectedSection and applyUpdatedSection are in scope.
  // ── Debt #134 — litho ↔ geological snap prompt ──────────────────────
  //
  // When a litho-contact drag commits within tolerance of a geological
  // contact on the same investigation (or the post-accept check #134-C
  // lands a brand-new contact in the same zone), a 3-option prompt
  // opens so the user picks the direction of the snap (snap litho,
  // move geo with a rebuild cascade, or keep them separate).
  //
  // Tolerance is per-project (debt #134-A): reads from
  // ``view_state.litho_segmenter.litho_snap_tolerance_m`` with a 0.20 m
  // default that matches the original MVP.  Settings → Litho segmenter
  // exposes the field.
  const lithoSnapToleranceM = useMemo(
    () => readLithoSegmenterPrefs(project?.view_state ?? null).lithoSnapToleranceM,
    [project?.view_state],
  )

  const sectionAwareAcceptLithoSuggestion = useCallback(
    async (idx: number): Promise<void> => {
      const result = await handleAcceptLithoSuggestion(
        idx,
        selectedSection?.id ?? null,
        applyUpdatedSection,
      )
      // Debt #134-C — post-accept litho-geo snap check.  Only the
      // single-suggestion path is wired here; accept-all-focused +
      // bulk paths are tracked under follow-up work (see debt entry).
      //
      // Read the depth the user actually accepted (after any drag-
      // resize edits) from the focused-anchor ghost entry — same
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
      // to retarget — silently skip the prompt.
      const newContactId = result.created_contact_ids[0]
      if (!newContactId) return
      setLithoGeoSnapPrompt({
        lithoContactId: newContactId,
        rawDepthM: acceptedTopM,
        candidates,
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
  } | null>(null)
  const [lithoGeoSnapBusy, setLithoGeoSnapBusy] = useState(false)

  // P1b (dogfeed 2026-05-30) — live contact-depth override during a
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
  // result immediately), then — on the litho axis only — checks for any
  // geological contact within tolerance.  If one or more candidates
  // exist, opens the prompt; otherwise the wrapper is a no-op past the
  // initial PATCH.
  const handleLithoSnapAwareUpdateContactDepth = useCallback(
    async (contactId: string, newDepthM: number, snapped: boolean): Promise<void> => {
      await handleUpdateContactDepth(contactId, newDepthM, snapped)
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
        await handleUpdateContactDepth(
          lithoGeoSnapPrompt.lithoContactId,
          geo.depth_top_m,
          true,
        )
      } catch (err) {
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
      // No "in progress" toast — the dialog stays open with all buttons
      // disabled (busy=true) which already signals work-in-flight.  A
      // success / error toast lands at the end.
      try {
        await handleUpdateContactDepth(geoContactId, lithoDepth, false)
        await api.geology.rebuildSurfaces(project.id, geo.model_id)
        await handleLoadBackdropSurfaces(geo.model_id)
        toast('success', 'Geological contact moved; surfaces rebuilt.')
      } catch (err) {
        toast('error', `Move failed: ${(err as Error).message}`)
        // Best-effort rollback of the geological-contact depth.  Swallow
        // a secondary failure — the user already saw the primary error.
        try {
          await handleUpdateContactDepth(geoContactId, oldDepth, false)
        } catch {
          // intentionally empty — rollback is best-effort
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

  // Phase-1.5 manual litho composition picker — new-unit path.
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
  // #57-correct via GET) — DO NOT change it.
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
      // create-formation-only → ghost → user-accepts chain.  Two
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
      // state; the user can right-click → Remove to undo, and the
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
        //    no prior litho contacts above) — the new band simply
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
            depth_base_m: depthM + 0.21, // sentinel — only depth_top_m matters for the new contact
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
              'handleManualLithoUnitCreate: restoration acceptLithoSuggestions failed — the new layer\'s bottom boundary is missing',
              err,
            )
          }
        }

        // Refresh formations + litho contacts so the new contacts
        // land in local state — without this the
        // ``sectionContacts = axisContacts.filter(c => seeded.has(c.id))``
        // intersection in SectionsCanvas still has the OLD
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

  // Debt #151 dogfeed refinement 2026-05-27 — Existing Units tab of
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
  // investigation — zero regression on the geological axis. Reads the
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
      onUnreject: handleUnrejectLithoSuggestion,
      // Drag-resize edits — the user's depth modifications per ghost
      // index (Phase 2). LithoSuggestionGhostColumns reads `edits` at
      // render time so the ghost rect tracks the live drag commit.
      edits: entry.edits,
      onEdit: handleEditLithoSuggestion,
      // Debt #86: cross-investigation copy-composition paste — routes
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
      // Dogfeed 2026-05-25: Shift+drag absorb.
      onAbsorbLayer: (draggerIdx: number, direction: 'up' | 'down') => {
        if (focusedSuggestAnchorId === null) return
        handleAbsorbLithoLayer(focusedSuggestAnchorId, draggerIdx, direction)
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
      // drag direction — then fires onUpdateContactDepth to move the
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
      // (debt #134) still fires identically — the suggestion-drag
      // path is just another entry point to the same audit trail.
      onUpdateContactDepth: handleLithoSnapAwareUpdateContactDepth,
      // P1b — live preview callback. Updates SectionsCanvas state;
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
    handleUnrejectLithoSuggestion,
    handleEditLithoSuggestion,
    handleEditBulkLitho,
    handleInsertLithoLayer,
    handleSplitLithoLayer,
    handleMergeLithoLayers,
    handleAbsorbLithoLayer,
    handleExtendLithoGhostToNearestContacts,
    visibleCpts,
    visibleBoreholes,
    lithoContacts,
    handleLithoSnapAwareUpdateContactDepth,
    handleLithoContactLivePreview,
  ])

  // Bulk-suggest bundle (debt #73 / Phase 3) — passed to SectionPanel
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
      onUnreject: handleUnrejectBulkLitho,
      onEdit: handleEditBulkLitho,
      // Debt #86: same handler — works for any target anchor in the Map.
      onCrossColumnPaste: handleEditBulkLitho,
      // Debt #85: bulk variant takes (anchorId, afterIdx, composition).
      // SectionPanel forwards anchorId at the call site.
      onInsertLayer: handleInsertLithoLayer,
      // Debt #98: bulk variant takes (anchorId, idx).
      onSplitLayer: handleSplitLithoLayer,
      // Debt #102: bulk variant takes (anchorId, upperIdx).
      onMergeLayers: handleMergeLithoLayers,
      // Dogfeed 2026-05-25: bulk variant takes (anchorId, draggerIdx, direction).
      onAbsorbLayer: handleAbsorbLithoLayer,
      // Extend a manual ghost sentinel — bulk variant takes (anchorId, idx).
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
    handleUnrejectBulkLitho,
    handleEditBulkLitho,
    handleInsertLithoLayer,
    handleSplitLithoLayer,
    handleMergeLithoLayers,
    handleAbsorbLithoLayer,
    handleExtendLithoGhostToNearestContacts,
    visibleCpts,
    visibleBoreholes,
  ])

  // Pinch-out ghost state — wired on whichever axis is active. Backend
  // ``ExtrapolatePinchOut`` is formation-id-keyed and works for either
  // model kind; only the frontend gate needs to flip (#118). The active
  // model + its kind are threaded through ``handlePreviewPinchOut`` so
  // the commit path refreshes the right contact list (litho vs geo).
  //
  // The onPreviewPinchOut callback derives direction (defaults 'right'
  // — the UX default is toward the termination edge which is typically
  // the section's right end; useGeologicalModel.handlePreviewPinchOut
  // auto-retries the opposite direction when the requested one returns
  // a geometry-uncomputable 422, debt #62 item 2) and target formation
  // (the next formation by display_order below the pinching one). A
  // future picker overrides both heuristics; until then the auto-retry
  // is the safety net for west-pinching formations / R→L sections.
  const pinchOutGhostState = useMemo(() => {
    const axisModel = isLitho ? activeLithoModel : activeGeologicalModel
    if (!axisModel) return undefined
    const sectionId = selectedSection?.id ?? null
    if (sectionId === null) return undefined
    const modelKind: 'geological' | 'lithostratigraphic' = isLitho
      ? 'lithostratigraphic'
      : 'geological'
    return {
      preview: pinchOutPreview,
      loading: pinchOutLoading,
      formations: axisFormations,
      onPreviewPinchOut: (
        _contactId: string,
        formationId: string,
        _anchorKind: 'cpt' | 'borehole',
        _anchorId: string,
      ) => {
        // Derive target formation: the next-older (deeper) formation by
        // display_order below the pinching one. The pinching formation
        // has the highest display_order among the ones visible on this
        // section; the target is the one with display_order one step lower.
        // ``axisFormations`` is already axis-swapped (litho or geo) so
        // the same sort logic works on either model kind.
        const sorted = [...axisFormations].sort((a, b) => b.display_order - a.display_order)
        const pinchingIdx = sorted.findIndex(f => f.id === formationId)
        const targetFormation =
          pinchingIdx >= 0 && pinchingIdx + 1 < sorted.length
            ? sorted[pinchingIdx + 1]
            : null
        if (!targetFormation) {
          log.warn(
            'section',
            `pinchOut: no target formation below ${formationId} — need at least 2 formations`,
          )
          return
        }
        void handlePreviewPinchOut({
          formationId,
          targetFormationId: targetFormation.id,
          sectionId,
          modelId: axisModel.id,
          modelKind,
          direction: 'right',
        })
      },
      onConfirm: () => {
        if (!selectedSection) return
        void handleCommitPinchOut(applyUpdatedSection)
      },
      onDismiss: clearPinchOutPreview,
    }
  }, [
    isLitho,
    activeGeologicalModel,
    activeLithoModel,
    selectedSection,
    pinchOutPreview,
    pinchOutLoading,
    axisFormations,
    handlePreviewPinchOut,
    handleCommitPinchOut,
    clearPinchOutPreview,
    applyUpdatedSection,
  ])

  // -------------------------------------------------------------------------
  // Inspect-lens-body panel derived values.
  //
  // presentInvestigationIds: investigation ids that have a committed contact
  // for the inspected formation on THIS section.  Empty when the panel is
  // closed.  Built from sectionContacts (already filtered to this section).
  //
  // investigationLabels: id → human label map built from visibleCpts +
  // visibleBoreholes so the panel can show "CPT-123" instead of a UUID.
  //
  // existingLens: the LithoLensOrm row (if any) whose formation_id +
  // body_ordinal match the panel's target — pre-fills the name field.
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

  const existingLens = useMemo((): LithoLensListItem | null => {
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
    // They must render alongside SectionPanel — not only in the no-section-selected
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
          showConfidenceFade={showConfidenceFade}
          // On the litho axis, left-click must never open the formation
          // picker — the right-click ghost flow is the intended entry point
          // (dogfeed 2026-05-26). Passing undefined here prevents
          // ContactPickBar's onCommitDepth and BoreholeColumn's onCommitDepth
          // from firing handlePickCpt/handlePickBorehole, which is where the
          // picker dialog opens in useContactPicker — BEFORE the internal
          // sectionAwareCreateContact early-return guard even runs. The previous
          // guard was too late in the callback chain.
          onCreateContact={isLitho ? undefined : sectionAwareCreateContact}
          onUpdateContactDepth={handleLithoSnapAwareUpdateContactDepth}
          onDeleteContact={handleDeleteContact}
          onUnlinkLithoFromGeo={isLitho ? handleUnlinkLithoFromGeo : undefined}
          onLinkLithoToGeo={isLitho ? handleLinkLithoToGeo : undefined}
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
          bulkLithoGhostState={bulkLithoGhostState}
          pinchOutGhostState={pinchOutGhostState}
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
          // polyline that goes EXACTLY through each pick (no 3D→2D
          // projection error). The user picks each strato contact with
          // intent; the rendered backdrop honours that.
          referenceContacts={isLitho && contacts.length > 0 ? contacts : undefined}
          // Lift the section-local focused column to the shell so
          // SectionsToolbar can use it for the litho-axis Suggest button.
          onFocusedColumnChange={setSectionFocusedColumn}
          // Manual litho composition picker (Phase-1.5): the picker dialog
          // is shown instead of the geological FormationPicker when the
          // section is on the lithostratigraphic axis.
          axisMode={isLitho ? 'lithostratigraphic' : 'geological'}
          // Debt #134-B — drag-readout "↦ snap on release" hint.  Pure
          // pre-release telegraph for the same prompt the post-release
          // wrapper above (handleLithoSnapAwareUpdateContactDepth)
          // fires.  Wired only on the litho axis; ContactsLayer also
          // guards on a non-empty referenceContacts set.
          geoSnapToleranceM={isLitho ? lithoSnapToleranceM : undefined}
          onManualLithoUnitCreate={isLitho ? handleManualLithoUnitCreate : undefined}
          onLithoExistingUnitPick={isLitho ? handleLithoExistingUnitPick : undefined}
          activeLithoModelId={isLitho ? (activeLithoModel?.id ?? null) : null}
          // #133 Phase 1 + Phase 2+3: contact-level correlation edges + gesture
          // state, litho axis only.  CorrelationEdgesOverlay is mounted on the
          // litho axis (SectionPanel gates on axisMode === 'lithostratigraphic')
          // and absent on the geological axis — zero regression.
          contactEdges={isLitho ? contactCorrelationEdges : undefined}
          contactGestureState={contactGestureState}
          onUnapprovedDragStart={isLitho ? handleUnapprovedDragStart : undefined}
          unapprovedEdgeDrag={unapprovedEdgeDrag}
          // #163e: right-click a correlation edge → "Delete correlation".
          // Reuses the existing optimistic-remove + DELETE + refetch handler.
          onRequestDeleteEdge={
            isLitho
              ? edge => void handleDeleteContactCorrelation(edge.contact_a_id, edge.contact_b_id)
              : undefined
          }
          // Dogfeed 2026-05-31: right-click a pending edge → "Accept correlation".
          // The overlay suppresses the menu item for already-approved edges.
          onRequestAcceptEdge={
            isLitho ? edge => void handleAcceptContactCorrelation(edge.id) : undefined
          }
          // #163f Slice 2 — lens wedges + shaping (litho axis only).
          lenses={isLitho ? lensList : undefined}
          lensBoundaries={lensBoundaries}
          onSaveLensShape={isLitho ? handleSaveLensShape : undefined}
          onDeleteLens={isLitho ? handleDeleteLens : undefined}
          // #body-with-extent Slice 7.2 — body context menu verbs.
          onClaimBodyExtent={isLitho ? (bid, side, kind) => void handleClaimBodyExtent(bid, side, kind) : undefined}
          onClearBodyExtent={isLitho ? (bid, side) => void handleClearBodyExtent(bid, side) : undefined}
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
          // Right-click on a reference (geological backdrop) contact strip →
          // "Edit in Geology stage" → sets geoDeepLinkTarget on the coordinator.
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
        {/* Inspect-lens-body panel (#101 Blocker 1) — shared between section-selected
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
        {/* Companion-offer dialog — same: must be reachable from the section view. */}
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
        {/* Litho ↔ geological snap prompt (debt #134) — fires after a
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
      </>
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
