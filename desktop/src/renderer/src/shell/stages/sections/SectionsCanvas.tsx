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
import { useT } from '../../../i18n/translate'
import type {
  AdmixtureItem,
  BodyBoundaryNode,
  BodyBoundaryResponse,
  BodyRenderStyle,
  BodyUnionListItem,
  LithoContactCorrelationEdge,
  BodyListItem,
} from '../../../api/client'
import type {
  ContactGestureState,
} from '../../../components/sections/CorrelationEdgesOverlay'
import type { JoinNotice } from '../../../components/sections/joinPick'
import LithoGeoSnapDialog from '../../../components/LithoGeoSnapDialog'
import FlaggedTiesPromptDialog from '../../../components/sections/FlaggedTiesPromptDialog'
import MoveRestatedContactDialog from '../../../components/MoveRestatedContactDialog'
import { findGeoSnapCandidates } from '../../../utils/lithoGeoSnap'
import { readLithoSegmenterPrefs } from '../../../utils/lithoSegmenterPrefs'
import { readGeotechSubdivisionPrefs } from '../../../utils/geotechSubdivisionPrefs'
import { unionStaleGeotechColumns } from '../../../utils/staleGeotechColumns'
import type { FormationContactResponse } from '../../../api/client'
import CompanionOfferDialog from '../../../components/sections/CompanionOfferDialog'
import GeotechBandEditDialog from '../../../components/sections/GeotechBandEditDialog'
import NameBodyDialog from '../../../components/sections/NameBodyDialog'
import InspectLensBodyPanel from '../../../components/sections/InspectLensBodyPanel'
import type { InspectLensBodyTarget } from '../../../components/sections/InspectLensBodyPanel'
import { useShell } from '../../ShellContext'
import SectionPanel from '../../../components/SectionPanel'
import { useRosterLoadedGate } from './useRosterLoadedGate'
import type { ContactCopyPayload } from '../../../components/sections/ContactsLayer'
import {
  planGeotechContactDrag,
  RESTATED_CONTACT_TOLERANCE_M,
} from '../../../components/sections/geotechContactDrag'
import MapView from '../../../components/MapView'
import { sectionCrsBlockReason } from '../../../utils/horizontalCrs'
import { implausibleSectionCoordinates } from '../../../utils/sectionCoordinatePlausibility'
import { inCorridorInvestigationIds } from '../../../utils/sectionClassification'
import { markBoreholesStale } from '../../../utils/boreholesStaleStore'
import { log } from '../../../utils/log'
import { apiFailureMessage } from '../../../utils/apiFailureMessage'
import { buildRestatedContactUndoCommand } from './restatedContactUndo'
import { useFlaggedTiePrompt } from './useFlaggedTiePrompt'
import { useGeotechBandEdit } from './useGeotechBandEdit'
import { joinErrorToastKey } from './joinErrorToastKey'
import { useGeotechPendingTieReveal } from './useGeotechPendingTieReveal'
import { useSectionColumnRevealBridge } from './useSectionColumnRevealBridge'
import type { SectionColumnRevealFn } from '../../../components/sections/sectionColumnReveal'
import { useGeotechBoreholePreview } from './useGeotechBoreholePreview'
import { useBoreholePreviewOn } from '../../../utils/boreholePreviewOnStore'
import { bodyHomeUnitId } from '../parameters/parameterUnitBodies'
import { geotechJumpScope, lithoJumpScope } from './geotechJumpLadder'
import { useModelBodies } from '../parameters/useModelBodies'
import { shouldShowBoreholePreview } from './boreholePreviewGate'
import { useGeotechPackingCorrelation } from './useGeotechPackingCorrelation'
import { useEdgeDragRetarget } from './useEdgeDragRetarget'
import { useLithoGeoSnapDialog } from './useLithoGeoSnapDialog'
import { useManualLithoUnit } from './useManualLithoUnit'
import { SectionScopeContext } from '../../../components/sections/SectionScopeContext'
import type {
  GeotechAxisModel,
  GeotechFormationMeta,
} from '../../../components/sections/geotechAxisModel'

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
  // i18n — the body Join / Ontkoppelen toasts read the catalogue (owner
  // 2026-09-01: "toasts aren't translated either"). First so it sits above every
  // hook / early return.
  const t = useT()
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
      // geotechLayersLoaded / geotechLayersVersion disambiguate the empty
      // array: the bus clears geotechLayers to [] before every refetch and on
      // a failed load, so "[]" alone cannot be read as "nothing is committed".
      geotechLayersLoaded,
      geotechLayersVersion,
      geotechContacts,
      geotechFormations,
      // Debt #266 — the two out-of-date signals the geotech axis marks columns
      // with: the server's litho-provenance compare and the geometric fit check.
      staleLithoGeotechColumns,
      columnsNeedingRederive,
      requestGeotechLayersRefetch,
      // Ghost-accept: right-click ONE undivided borehole's ghosts -> commit
      // just that column (pipeline step 4, scoped).
      handleDivideBoreholes,
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
      geotechSolids,
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
      sectionFocusedColumn,
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
      setParametersDeepLinkTarget,
      correlationEdgesRefetchNonce,
      // Slice 5: this canvas only BUMPS the recompute nonces from its mutation
      // sites; the scheduler + nonce watch live at the shell level
      // (useProjectBodyRecompute in App).
      requestBodyRecompute,
      // F10: the unit-statistics jump reads the per-axis body rosters, which
      // must follow a recompute (F9) — the nonces key those fetches.
      bodyRecomputeLithoNonce,
      bodyRecomputeGeotechNonce,
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
      // UNFILTERED lists + the project-local hide sets. Only the pending-tie
      // reveal reads them, and only to explain why a column the canvas is NOT
      // drawing was dropped — an answer ``visibleCpts`` / ``visibleBoreholes``
      // cannot give, because those are the post-filter lists.
      cpts: projectCpts,
      boreholes: projectBoreholes,
      removedCptIds,
      removedBoreholeIds,
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

  // A section whose endpoints are not map coordinates is a DATA defect, and it
  // is invisible otherwise: the ground-surface line simply never appears while
  // the backend refuses the extent. Name it once per section so the engineer
  // can fix (or delete) the row instead of wondering where the DEM went.
  // Keyed on the section id, so re-selecting the same section does not nag and
  // a view_state PATCH (which re-identifies the row object) does not re-toast.
  const coordinateDefectWarnedRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (selectedSection === null) return
    if (coordinateDefectWarnedRef.current.has(selectedSection.id)) return
    const reason = implausibleSectionCoordinates(selectedSection)
    if (reason === null) return
    coordinateDefectWarnedRef.current.add(selectedSection.id)
    log.warn('sections', `${reason} (id=${selectedSection.id})`)
    // WARNING, not error: the section still opens and every other overlay
    // works — only the ground-surface line is unavailable. The project's own
    // level guide calls that "degraded but continuing".
    toast('warning', reason)
  }, [selectedSection, toast])


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

  // Ghost packing bands for boreholes that have not been divided yet.
  //
  // "Subdivide all bodies" writes CPT bands only and defers every
  // borehole-mediated edge to "Divide boreholes", so a borehole column is blank
  // on this axis until that verb runs — and running it is the only way to find
  // out what it does (owner dogfeed 2026-08-04). The server plans it without
  // writing, through the same planner the verb commits, and the plan is drawn
  // as ghosts.
  //
  // Refresh key = `geotechLayersVersion`, which ticks once per successful load
  // of the committed geotech rows — i.e. once after Subdivide (which
  // invalidates every planned band) and once after Divide (which turns the
  // ghosts into rows), the two verbs that can falsify a preview. Keying on the
  // `geotechLayers` ARRAY instead ran the whole planner twice per mutation,
  // because the bus clears it to [] before refilling it.
  //
  // The snap tolerance is a key too: `plan()` reads it from project view-state
  // and divides the picks by geology with it, so a ghost drawn before the
  // engineer retuned it is stale.
  const geotechSnapToleranceM = useMemo(
    () => readGeotechSubdivisionPrefs(project?.view_state ?? null).lithoSnapToleranceM,
    [project],
  )
  // The lens-suggestion size gate: a band the model itself calls "too thin to
  // keep" is thin enough to suggest absorbing (no second magic number).
  const geotechMinLayerThicknessM = useMemo(
    () => readGeotechSubdivisionPrefs(project?.view_state ?? null).minimumLayerThicknessM,
    [project],
  )
  // Ghost gate (owner ruling 2026-08-07): the preview is OPT-IN via the
  // Display menu's "Show borehole preview" — no tie state ever opens it
  // uninvited (two dogfeed rounds read the auto-appearing ghosts as "my
  // boreholes got subdivided").
  const boreholePreviewOn = useBoreholePreviewOn()
  const boreholePreview = useGeotechBoreholePreview({
    projectId: project?.id ?? null,
    lithoModelId,
    hasGeotechModel: activeGeotechModel !== null,
    enabled: isGeotech && shouldShowBoreholePreview(boreholePreviewOn),
    refreshKey: geotechLayersVersion,
    snapToleranceM: geotechSnapToleranceM,
  })

  // A preview that fails must SAY so: an empty borehole column is
  // indistinguishable from "this borehole gets no packing", which is a claim
  // about the geology nothing here is entitled to make.
  const previewError = boreholePreview.error
  useEffect(() => {
    if (previewError === null) return
    toast('error', previewError)
  }, [previewError, toast])

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
        toast('success', t('sections.canvasToast.admixturesUpdated', { n: result.component_size, word: t(result.component_size === 1 ? 'sections.canvasToast.correlatedUnitOne' : 'sections.canvasToast.correlatedUnitMany') }))
      } catch (err) {
        // Surface the failure â€” silence on a failed PATCH is worse than a toast.
        log.warn('section', 'handlePropagateAdmixtures: PATCH failed', err)
        toast('error', t('sections.canvasToast.admixturesFailed'))
      }
    },
    [activeLithoModel, project.id, refetchFormations, toast],
  )

  // Layer → Parameters jump (owner ballot 2026-08-26; litho half added by the
  // 2026-08-27 R1 ruling). The canvas does not navigate: it posts the unit
  // SCOPE onto the coordinator bus and AppShell — the only thing allowed to
  // switch stages — does the rest. Same contract as ``setGeoDeepLinkTarget``
  // above it. The kind is stamped HERE, where the axis is known: the overlays
  // report a bare formation id and cannot tell a litho row from a geotech row.
  // The BODY rides along when the clicked surface named one (owner body-scope
  // ruling 2026-08-27: "a body is only a body if it is geometrically
  // connected or if the users says…") — null keeps the pooled formation view.
  //
  // F10 — the reported UNIT follows the body: the overlays send the region's
  // formation LABEL beside a layers-resolved body, and on a body welded
  // across twin formation rows (or frame-labelled on the geotech axis) the
  // label is not where the body's row lives. ``bodyHomeUnitId`` re-points the
  // unit at the body's HOME formation from the same roster the Parameters
  // pane groups by; with no body (or an unknown one) the label stands. The
  // rosters ride the recompute nonces (F9) so a jump after a recompute reads
  // fresh homes.
  const lithoJumpRoster = useModelBodies(
    project.id,
    activeLithoModel?.id ?? null,
    bodyRecomputeLithoNonce,
  )
  const geotechJumpRoster = useModelBodies(
    project.id,
    activeGeotechModel?.id ?? null,
    bodyRecomputeGeotechNonce,
  )
  const handleShowGeotechUnitStatistics = useCallback(
    (unitId: string, bodyId?: string | null, regionLayerIds?: readonly string[]): void => {
      // F10: a resolved body reports its HOME formation (bodyHomeUnitId), so a
      // twin-labelled or frame-labelled region lands where the body's row lives.
      const homeUnitId = bodyHomeUnitId(unitId, bodyId, geotechJumpRoster)
      // The ladder (spec §2): resolved body → geotech-body; an unresolved region
      // with a unique litho parent body → geotech-class; else → geotech-unit.
      const scope = geotechJumpScope(homeUnitId, bodyId, regionLayerIds, {
        lithoLayers,
        geotechLayers,
        geotechFormations,
      })
      log.info('section', `unit statistics requested: ${JSON.stringify(scope)}`)
      setParametersDeepLinkTarget(scope)
    },
    [setParametersDeepLinkTarget, geotechJumpRoster, lithoLayers, geotechLayers, geotechFormations],
  )
  const handleShowLithoUnitStatistics = useCallback(
    (unitId: string, bodyId?: string | null): void => {
      const homeUnitId = bodyHomeUnitId(unitId, bodyId, lithoJumpRoster)
      const scope = lithoJumpScope(homeUnitId, bodyId)
      log.info('section', `unit statistics requested: ${JSON.stringify(scope)}`)
      setParametersDeepLinkTarget(scope)
    },
    [setParametersDeepLinkTarget, lithoJumpRoster],
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

  // The active geotech model, as the geotech axis reads it (owner ruling
  // 2026-08-13). PartitionFillOverlay partitions `geotechLayers` DIRECTLY - the
  // same computation the 3-D build arm runs - so this bundle no longer carries a
  // pre-filtered packing-edge list: the overlay's partition is framed by the
  // `geotechCorrelationEdges` prop below, which is this same
  // `geotechPackingEdges` state, filtered to approved inside the overlay exactly
  // as `fetchApprovedEdgesBySection` filters for the build - so a pending auto
  // proposal never silently reshapes the render before the engineer accepts it.
  //
  // What stays here is what the axis cannot read off the partition: the geotech
  // formation -> (NAD class, soil code) metadata, and the litho formation ->
  // soil code / colour maps that let an interval the packing model does not
  // cover keep its lithology. `undefined` off the geotech axis.
  const geotechAxisModel = useMemo((): GeotechAxisModel | undefined => {
    if (!isGeotech) return undefined
    const nadMeta = new Map<string, GeotechFormationMeta>()
    for (const f of geotechFormations) {
      nadMeta.set(f.id, { nadClass: f.nad_class ?? null, soilCode: f.litho_main_soil_code ?? null })
    }
    const lithoSoilByFormationId = new Map<string, string | null>()
    const lithoFormationColorById = new Map<string, string>()
    for (const f of lithoFormations) {
      lithoSoilByFormationId.set(f.id, f.litho_main_soil_code ?? null)
      lithoFormationColorById.set(f.id, f.color)
    }
    return {
      geotechLayers,
      nadMeta,
      lithoSoilByFormationId,
      lithoFormationColorById,
      // Debt #266 — merged here, from the same two signals the toolbar chip
      // counts, so the mark on the drawing and the number above it can never
      // disagree about which columns are out of date.
      staleColumnIds: new Set(
        unionStaleGeotechColumns(staleLithoGeotechColumns, columnsNeedingRederive, () =>
          undefined,
        ).map(c => c.investigation_id),
      ),
    }
  }, [
    isGeotech,
    geotechFormations,
    lithoFormations,
    geotechLayers,
    staleLithoGeotechColumns,
    columnsNeedingRederive,
  ])

  // A restated-contact drag waiting for the engineer to accept its consequences.
  //
  // The gesture reaches UP the hierarchy — it edits the litho model, and one row in three
  // also carries a geological contact — and nothing on the geotech axis says so. The owner
  // asked for the prompt in the first brainstorm and again after dogfeeding without it.
  const [pendingContactMove, setPendingContactMove] = useState<{
    upperBandId: string
    lowerBandId: string
    depthM: number
    lithoContactId: string
    movesGeology: boolean
    /** Where the contact sat before the drag — the undo command's target. */
    preDragDepthM: number
    /** Neighbours captured BEFORE the commit; a merge's inverse addresses them,
     *  and the response cannot name them (it only says what was deleted). */
    belowBandId: string | null
    aboveBandId: string | null
  } | null>(null)
  const [contactMoveBusy, setContactMoveBusy] = useState(false)

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

  // WHICH section the edges currently in state were fetched for.
  //
  // Sections SHARE investigations, so section A's edges reference layer ids that also
  // appear in section B's columns: a late A response landing after the user switched to
  // B does not look wrong to the partition — it silently draws A's bands and lenses on
  // B. Every response is therefore checked against the section that is selected NOW
  // before it is allowed to touch state, and a fetch that FAILS for a newly-selected
  // section clears the previous section's edges instead of leaving them on screen.
  // (``useSectionData`` uses the ``let cancelled`` form of this guard; these two fetches
  // are also called imperatively after a gesture, so they need a ref, not a closure.)
  const currentSectionIdRef = useRef(selectedSectionId)
  // Assigned during render on purpose (React documents against ref writes here):
  // the imperative refetches fire straight from a gesture handler and need the
  // CURRENT section id before any effect has flushed. The write is idempotent —
  // the same value on a StrictMode double-render — so it cannot tear.
  currentSectionIdRef.current = selectedSectionId
  const contactEdgesSectionIdRef = useRef<string | null>(null)
  const geotechEdgesSectionIdRef = useRef<string | null>(null)

  const refetchContactEdges = useCallback(async () => {
    if (correlationModelId === null) {
      setContactCorrelationEdges([])
      contactEdgesSectionIdRef.current = selectedSectionId
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
      if (currentSectionIdRef.current !== selectedSectionId) {
        log.info(
          'section',
          `listContactCorrelations: dropped ${edges.length} late edge(s) for section=${selectedSectionId} â€” ${currentSectionIdRef.current} is selected now`,
        )
        return
      }
      setContactCorrelationEdges(edges)
      contactEdgesSectionIdRef.current = selectedSectionId
      // INFO (not DEBUG) on purpose: the correlation count the section actually
      // received is the fastest signal for "why are no bands connecting" â€” keep
      // it visible in the default console (the 2026-06-25 wrong-DB incident).
      log.info(
        'section',
        `listContactCorrelations: ${edges.length} edge(s) for model=${correlationModelId} section=${selectedSectionId}`,
      )
    } catch (err) {
      // A failure leaves whatever is in state. That is only safe while it belongs to
      // the section on screen — if it belongs to a section we just left, drop it
      // rather than draw one section's ties on another.
      if (
        currentSectionIdRef.current === selectedSectionId &&
        contactEdgesSectionIdRef.current !== selectedSectionId
      ) {
        setContactCorrelationEdges([])
        contactEdgesSectionIdRef.current = selectedSectionId
      }
      log.error('section', 'refetchContactEdges: listContactCorrelations failed', err)
    }
  }, [correlationModelId, project.id, selectedSectionId])

  // Fetch the GEOTECH model's packing edges for the correlate overlay (Phase 1,
  // 2026-06-25). Scoped to the active geotech model + section, mirroring
  // refetchContactEdges but pointed at activeGeotechModel.id â€” never
  // correlationModelId (which is the litho model). No-op off the geotech axis.
  const refetchGeotechPackingEdges = useCallback(async (): Promise<boolean> => {
    if (!isGeotech || geotechPackingModelId === null) {
      setGeotechPackingEdges([])
      geotechEdgesSectionIdRef.current = selectedSectionId
      // Nothing to fetch is not a stale view — there are no ribbons to be
      // wrong about.
      return true
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
      // Same stale-response guard as refetchContactEdges — see the comment there.
      if (currentSectionIdRef.current !== selectedSectionId) {
        log.info(
          'section',
          `listGeotechPackingCorrelations: dropped ${edges.length} late edge(s) for section=${selectedSectionId} â€” ${currentSectionIdRef.current} is selected now`,
        )
        // The caller's section is no longer on screen, so nothing visible to
        // them is stale; the section they DID switch to loads on its own.
        return true
      }
      setGeotechPackingEdges(edges)
      geotechEdgesSectionIdRef.current = selectedSectionId
      // INFO (not DEBUG) on purpose â€” mirrors refetchContactEdges: the geotech
      // packing-edge count is the fastest "why aren't packing ribbons drawing"
      // signal in the default console.
      log.info(
        'section',
        `listGeotechPackingCorrelations: ${edges.length} edge(s) for geotechModel=${geotechPackingModelId} section=${selectedSectionId}`,
      )
    } catch (err) {
      if (
        currentSectionIdRef.current === selectedSectionId &&
        geotechEdgesSectionIdRef.current !== selectedSectionId
      ) {
        setGeotechPackingEdges([])
        geotechEdgesSectionIdRef.current = selectedSectionId
      }
      log.error(
        'section',
        'refetchGeotechPackingEdges: listContactCorrelations failed',
        err,
      )
      // Swallowing the throw keeps the section usable, but a caller that just
      // committed a write needs to know the ribbons it can see are stale —
      // otherwise a success toast sits over ties the server already deleted.
      return false
    }
    return true
  }, [isGeotech, geotechPackingModelId, project.id, selectedSectionId])

  useEffect(() => {
    // Drop the previous section's packing edges BEFORE the fetch goes out. The
    // late-response guard only stops a stale answer from landing; it leaves the
    // old section's ribbons on screen for the whole in-flight window (seconds
    // while a build is running). A section whose ties nobody has read yet shows
    // NOTHING — never another section's.
    if (geotechEdgesSectionIdRef.current !== selectedSectionId) {
      setGeotechPackingEdges([])
      geotechEdgesSectionIdRef.current = null
    }
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
    // Same rule as the geotech effect above: render nothing rather than the
    // previous section's ties while this section's own fetch is in flight.
    if (contactEdgesSectionIdRef.current !== selectedSectionId) {
      setContactCorrelationEdges([])
      contactEdgesSectionIdRef.current = null
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
  // #279 (owner "fix it now"): the body menu arms ONLY while the roster is
  // current for the active litho model. The gate resets synchronously on every
  // body-recompute nonce bump — a recompute rewrites body_id stamps, so the
  // roster in hand is stale across the recompute window and the stats menu is
  // the deliberate answer there. ``markRosterLoaded`` re-arms it after a fetch.
  const { bodiesLoaded: rosterLoaded, markLoaded: markRosterLoaded } = useRosterLoadedGate(
    isLitho ? lithoModelId : null,
    bodyRecomputeLithoNonce,
  )

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
      // The ROSTER is now current for this model — the body menu may arm (#279).
      markRosterLoaded(lithoModelId)
    } catch (err) {
      log.warn('section', 'refetchLensData: listLenses/getBodyBoundary failed', err)
      return
    }
  }, [lithoModelId, project.id, markRosterLoaded])

  useEffect(() => {
    if (!isLitho) {
      setLensList([])
      setLensBoundaries(new Map())
      return
    }
    void refetchLensData()
    // reason: same axes as the edge fetch; refetchLensData captures project.id +
    // lithoModelId in its closure. ``bodyRecomputeLithoNonce`` is here so the
    // roster refetches after every recompute (#279): the gate reset it to stale
    // on the same bump, and this refetch + markRosterLoaded re-arms the menu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isLitho,
    activeLithoModel?.id,
    selectedSectionId,
    correlationEdgesRefetchNonce,
    bodyRecomputeLithoNonce,
  ])

  // Piece B (owner ruling 2026-08-31, "shouldn't we be able to do this in the
  // geotech stage" — RULED yes): the GEOTECH body roster + standing groups, so the
  // body menu (name / statistics / Voeg samen met… / Ontkoppelen / dissolve) works
  // on the geotech axis. Parallel to the litho block above, with its OWN #279
  // arming gate on the GEOTECH recompute nonce — a geotech recompute rewrites
  // geotech ``body_id`` stamps independently, so the two gates cannot share one.
  // No boundary fetch: freedraw shaping is litho-only, so the geotech axis needs
  // only the roster (for ``bodyById``) + unions (for Ontkoppelen). Separations are
  // gone (Separate verb removed, owner 2026-09-01).
  const [geotechBodyList, setGeotechBodyList] = useState<BodyListItem[]>([])
  // Debt #278: the model's standing body UNIONS (the Join verb, geotech axis
  // only). A failure (e.g. the table not yet migrated) leaves an empty list + a
  // warn naming the call, NEVER gate-disabling the menu.
  const [geotechUnionsList, setGeotechUnionsList] = useState<BodyUnionListItem[]>([])
  const { bodiesLoaded: geotechRosterLoaded, markLoaded: markGeotechRosterLoaded } =
    useRosterLoadedGate(isGeotech ? geotechPackingModelId : null, bodyRecomputeGeotechNonce)

  const refetchGeotechBodyData = useCallback(async () => {
    if (geotechPackingModelId === null) {
      setGeotechBodyList([])
      setGeotechUnionsList([])
      return
    }
    try {
      setGeotechBodyList(await api.geology.listLenses(project.id, geotechPackingModelId))
      // Roster current for this model — the body menu may arm (#279). Marked
      // before the unions fetch so a unions failure never withholds it.
      markGeotechRosterLoaded(geotechPackingModelId)
    } catch (err) {
      log.warn('section', 'refetchGeotechBodyData: listLenses failed', err)
      return
    }
    // Standing unions (groups) — a failure is degraded-but-continuing: no
    // Ontkoppelen items, and a warn that names the call.
    try {
      setGeotechUnionsList(await api.geology.listBodyUnions(project.id, geotechPackingModelId))
    } catch (err) {
      setGeotechUnionsList([])
      log.warn('section', 'refetchGeotechBodyData: listBodyUnions failed', err)
    }
  }, [geotechPackingModelId, project.id, markGeotechRosterLoaded])

  useEffect(() => {
    if (!isGeotech) {
      setGeotechBodyList([])
      setGeotechUnionsList([])
      return
    }
    void refetchGeotechBodyData()
    // reason: the geotech roster follows the geotech recompute nonce (#279 per
    // axis), the active geotech model + section switch; refetchGeotechBodyData
    // captures project.id + geotechPackingModelId in its closure. The nonce is
    // here so the roster refetches + re-arms the menu after every recompute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isGeotech,
    geotechPackingModelId,
    selectedSectionId,
    correlationEdgesRefetchNonce,
    bodyRecomputeGeotechNonce,
  ])

  // The body menu acts on the ACTIVE axis's model (piece B): geotech on the
  // geotech axis, litho otherwise. The name / dissolve handlers read these so one
  // handler each serves both axes (POST against ``bodyMenuModel.id`` and refresh
  // through ``refetchBodyMenuData``). Join / Ontkoppelen are geotech-only and read
  // ``activeGeotechModel`` directly.
  const bodyMenuModel = isGeotech ? activeGeotechModel : activeLithoModel
  const bodyMenuRoster = isGeotech ? geotechBodyList : lensList
  const refetchBodyMenuData = isGeotech ? refetchGeotechBodyData : refetchLensData

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
        // A saved boundary reshapes the body — schedule the litho identity
        // recompute (slice 5).
        requestBodyRecompute('litho')
      } catch (err) {
        log.warn('section', 'handleSaveLensShape: saveBodyBoundary failed', err)
        toast('error', t('sections.canvasToast.lensShapeFailed'))
      }
    },
    [activeLithoModel, project.id, selectedSectionId, toast, markMutated, requestBodyRecompute],
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
        const created = await api.geology.createContactCorrelation(
          project.id,
          modelId,
          layerAId,
          layerBId,
          sectionIdAtPush,
          layerASide,
          layerBSide,
        )
        // THE TIE STANDS, BUT SAY WHAT IT CAN DO (owner order 2026-08-21, after
        // he deleted a silt↔clay packing tie that rendered as an onlap: "next
        // time flag a tie like that when it doesn't conform to the litho
        // model!"). WARNING, not error: the gesture succeeded — the tie states
        // a surface — but the litho frame will not band the two bands, and
        // that is invisible until he hunts for it on the canvas. The badge on
        // the tie carries the same message after the toast fades.
        if (created?.frame_warning) {
          log.warn('section', `contact-correlate: frame mismatch — ${created.frame_warning}`)
          toast('warning', created.frame_warning)
        }
        await Promise.all([refetchContactEdges(), refetchLithoContacts()])
        markMutated()
        // A tie create/delete moves body geometry — schedule the litho identity
        // recompute (slice 5). Mirrored in the undo closures above/below.
        requestBodyRecompute('litho')
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
            requestBodyRecompute('litho')
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
            requestBodyRecompute('litho')
          },
        })
        toast('success', t('sections.canvasToast.boundaryCorrAdded'))
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
        toast('error', t('sections.canvasToast.boundaryCorrFailed'))
      }
    },
    [activeLithoModel, project.id, selectedSectionId, refetchContactEdges, toast, lithoContacts, triggerCorrelationPulse, markMutated, undoStack, requestBodyRecompute],
  )

  // S103 correlate-on-drag persist: a stable wrapper so the boundary-drag effect's dep on
  // ``onCorrelateBoundary`` does not re-attach the window mouse listeners on every parent render
  // (S3). Ties the two upper-band layers base-base — no litho flip.
  const handleCorrelateBoundary = useCallback(
    (leftLayerId: string, rightLayerId: string): void =>
      void handleCreateContactCorrelation(leftLayerId, rightLayerId, 'base', 'base'),
    [handleCreateContactCorrelation],
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
        // A tie create/delete moves body geometry — schedule the litho identity
        // recompute (slice 5). Mirrored in the undo closures above/below.
        requestBodyRecompute('litho')
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
            requestBodyRecompute('litho')
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
            requestBodyRecompute('litho')
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
    [activeLithoModel, project.id, selectedSectionId, refetchContactEdges, markMutated, undoStack, requestBodyRecompute],
  )

  // Geotech packing-correlation handlers (spec §5) — extracted to
  // useGeotechPackingCorrelation (debt #201 round 2); behaviour unchanged.
  const {
    handleCreateGeotechPackingCorrelation,
    handleDeleteGeotechPackingCorrelation,
    handleAcceptGeotechPackingCorrelation,
    handleConfirmGeotechPackingReview,
  } = useGeotechPackingCorrelation({
    activeGeotechModel,
    projectId: project.id,
    selectedSectionId,
    refetchContactEdges,
    refetchGeotechPackingEdges,
    requestGeotechLayersRefetch,
    requestBodyRecompute,
    markMutated,
    toast,
    setArmedContactId,
    setArmedContactSide,
    setLastTargetTestId,
    setContactCorrelationEdges,
    setGeotechPackingEdges,
    undoStack,
  })

  // Hand split / merge / drag / remove of packing sub-bands (owner spec 2026-08-01 +
  // 2026-08-07 drag verb, docs/debt.md #227).
  //
  // The one deliberate hole in the geotech axis's view-only gate. Contacts here still
  // cannot be created, dragged or deleted — these verbs go through their own endpoints,
  // which re-derive the NAD class from the cone resistance over the new interval instead of
  // moving a contact. The hook previews first, commits only on a second, explicit ask, and
  // pushes every committed edit onto the section undo stack.
  // The question a hand edit raises about the correlations it broke (owner 2026-08-10).
  // Declared before the band-edit hook because that hook reports into it.
  const flaggedTiePrompt = useFlaggedTiePrompt({
    edges: geotechPackingEdges,
    deleteEdge: handleDeleteGeotechPackingCorrelation,
  })

  const geotechBandEdit = useGeotechBandEdit({
    activeGeotechModel,
    projectId: project.id,
    refetchGeotechPackingEdges,
    requestGeotechLayersRefetch,
    markMutated,
    requestBodyRecompute,
    toast,
    undoStack,
    onAcceptedTiesFlagged: flaggedTiePrompt.askAbout,
  })

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
        // An accepted tie joins bodies — schedule the litho identity recompute (slice 5).
        requestBodyRecompute('litho')
        log.success(
          'section',
          `contact-accept: edge=${edgeId} accepted=${result.edges_accepted} ` +
            `ordinals_changed=${result.ordinals_changed}`,
        )
      } catch (err) {
        log.warn('section', `handleAcceptContactCorrelation: POST failed for edge ${edgeId}`, err)
        toast('error', t('sections.canvasToast.acceptCorrFailed'))
      }
    },
    [activeLithoModel, project.id, refetchContactEdges, refetchLensData, markMutated, toast, requestBodyRecompute],
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
      if (!bodyMenuModel) return
      const body = bodyMenuRoster.find(b => b.id === bodyId)
      if (!body) {
        log.warn('section', `name-body: body ${bodyId} not found in body roster`)
        return
      }
      setNamingBody({ id: bodyId, currentName: body.name ?? '' })
    },
    [bodyMenuModel, bodyMenuRoster],
  )

  // Commit the name entered in NameBodyDialog. A named body is preserved by
  // the detector reconcile + bulk "Delete all detected lenses" â€” naming is how
  // the user keeps ("accepts") a detected lens.
  const submitBodyName = useCallback(
    async (name: string): Promise<void> => {
      if (!bodyMenuModel || namingBody === null) return
      const body = bodyMenuRoster.find(b => b.id === namingBody.id)
      if (!body) {
        setNamingBody(null)
        return
      }
      log.info('section', `name-body: body=${namingBody.id} name="${name}"`)
      try {
        await api.geology.nameBody(project.id, bodyMenuModel.id, namingBody.id, {
          formation_id: body.formation_id,
          body_ordinal: body.body_ordinal,
          name,
        })
        void refetchBodyMenuData()
        toast('success', t('sections.canvasToast.bodyNamed', { name }))
      } catch (err) {
        toast('error', t('sections.canvasToast.bodyNameFailed'))
        log.warn('section', 'submitBodyName: failed', err)
      } finally {
        setNamingBody(null)
      }
    },
    [bodyMenuModel, namingBody, project.id, bodyMenuRoster, refetchBodyMenuData, toast],
  )

  // Dissolve a body — deletes the body row only. (The correlation edges are NOT
  // touched: DELETE /bodies/{id} removes the BodyOrm row and its extent data;
  // the tie graph is the user's, kept by the resolver.)
  const handleDissolveBody = useCallback(
    async (bodyId: string): Promise<void> => {
      if (!bodyMenuModel) return
      if (!window.confirm(t('sections.canvasToast.dissolveConfirm'))) return
      log.info('section', `dissolve-body: body=${bodyId}`)
      try {
        await api.geology.deleteBody(project.id, bodyMenuModel.id, bodyId)
        void refetchBodyMenuData()
        toast('success', t('sections.canvasToast.bodyDissolved'))
      } catch (err) {
        toast('error', t('sections.canvasToast.bodyDissolveFailed'))
        log.warn('section', 'handleDissolveBody: failed', err)
      }
    },
    [bodyMenuModel, project.id, refetchBodyMenuData, toast],
  )

  // Join two bodies into ONE group (owner ruling 2026-09-01, geotech axis only) —
  // record the must-link, then re-render. The endpoint re-resolves body identity
  // server-side in the same request, so the merge is durable before this returns.
  //
  // The refresh mirrors every other geotech write path (settleContactMove, the
  // band-edit verbs): ``requestGeotechLayersRefetch`` re-fetches the bands with
  // their NEW ``body_id`` stamps, which is what re-groups the 2-D fill identity
  // AND re-scopes the Parameters-stage unit statistics; ``requestBodyRecompute``
  // schedules the durable identity recompute + re-renders the 3-D build and fence.
  // A class mismatch reports ``inert`` (the resolver backstop; the write also 422s).
  const handleJoinBodies = useCallback(
    async (anchorLayerId: string, targetAnchorLayerId: string): Promise<void> => {
      if (!activeGeotechModel) return
      log.info('section', `join-bodies: anchorA=${anchorLayerId} anchorB=${targetAnchorLayerId}`)
      try {
        const result = await api.geology.createBodyUnion(
          project.id,
          activeGeotechModel.id,
          anchorLayerId,
          targetAnchorLayerId,
        )
        void refetchGeotechBodyData()
        requestGeotechLayersRefetch()
        requestBodyRecompute('geotech')
        if (result.suppressed) {
          // Dormant path: no UI creates separations any more (Separate removed,
          // owner 2026-09-01), so a standing separation only comes from legacy
          // rows. Kept honest rather than falsely claiming success.
          toast('warning', t('sections.join.blockedSeparation'), 'join-arm-notice')
        } else if (result.inert) {
          // Defensive backstop: the write-time cross-class guard already 422s a
          // mixed join, so a CREATED-but-inert union means the resolver merged
          // nothing (an anchor whose body_id was not stamped when the guard ran),
          // NOT a class mismatch — the guard proved same-mass before the insert.
          // So this is "the join had no effect", never the cross-class copy.
          toast('warning', t('sections.join.failed'), 'join-arm-notice')
        } else {
          // Reversible action → name the undo path (docs/ux.md).
          toast('success', t('sections.join.success'))
        }
      } catch (err) {
        // A 422 carries a structured guard ``code`` — map it to a TRANSLATED
        // toast (the owner dogfeeds in Dutch, so the backend's English
        // ``detail.message`` must never show verbatim). cross-class is the only
        // live guard after the Separate verb removal; blockedSeparation is a
        // defensive fallback that no longer fires (D1).
        toast('error', t(joinErrorToastKey(err)))
        log.warn('section', 'handleJoinBodies: failed', err)
      }
    },
    [activeGeotechModel, project.id, refetchGeotechBodyData, requestGeotechLayersRefetch, requestBodyRecompute, toast, t],
  )

  // Ontkoppelen — lift a standing group / union (the Join verb's undo path). The
  // DELETE re-resolves server-side, so the two anchors fall back to whatever ties /
  // geometry still connect them; where none do, they split.
  //
  // FIX (owner bug 2026-09-01: "I clicked disjoin ... unit statistics still plots
  // as one big layer"): the DELETE re-splits the ``body_id`` stamps server-side,
  // but nothing re-fetched the geotech bands, so the fill + Parameters stats stayed
  // grouped. ``requestGeotechLayersRefetch`` — the canonical geotech-write refresh —
  // re-fetches the bands with the re-split stamps, so the 2-D fill re-splits and a
  // subsequent Unit statistics scopes to the two bodies separately.
  const handleUnjoinBody = useCallback(
    async (unionId: string): Promise<void> => {
      if (!activeGeotechModel) return
      log.info('section', `un-join-body: union=${unionId}`)
      try {
        await api.geology.deleteBodyUnion(project.id, activeGeotechModel.id, unionId)
        void refetchGeotechBodyData()
        requestGeotechLayersRefetch()
        requestBodyRecompute('geotech')
        toast('success', t('sections.unjoin.success'))
      } catch (err) {
        toast('error', t('sections.unjoin.failed'))
        log.warn('section', 'handleUnjoinBody: failed', err)
      }
    },
    [activeGeotechModel, project.id, refetchGeotechBodyData, requestGeotechLayersRefetch, requestBodyRecompute, toast, t],
  )

  // Advisory while a Join is armed: the engineer clicked the armed body itself,
  // a region that resolves to no single body, or a DIFFERENT-class body (a body
  // can only be one mass). The arm stays live; a warning (self-dismissing,
  // replace-keyed so repeats don't stack) tells them what to do. The cross-class
  // advisory pre-empts the round-trip that the backend would 422 anyway.
  const handleJoinNotice = useCallback(
    (notice: JoinNotice): void => {
      // The cross-class advisory splits by WHAT differs (owner ruling 2026-09-01),
      // sharing the two commit-toast strings: a packing difference vs a lithology
      // difference. Same copy, whether the refusal is pre-empted here (arm advisory)
      // or comes back as a 422 (joinErrorToastKey).
      const message =
        notice.kind === 'same'
          ? t('sections.join.noticeSame')
          : notice.kind === 'cross-class'
            ? notice.differ === 'packing'
              ? t('sections.join.crossPacking')
              : t('sections.join.crossLitho')
            : t('sections.join.noticeUnresolvable')
      toast('warning', message, 'join-arm-notice')
    },
    [toast, t],
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

  // Drag-to-retarget unapproved edge (#133 Phase 2+3 Task 26) — extracted to
  // useEdgeDragRetarget (debt #201 round 2); behaviour unchanged.
  const { edgeDrag, handleUnapprovedDragStart } = useEdgeDragRetarget({
    lithoContacts,
    activeLithoModel,
    projectId: project.id,
    selectedSectionId,
    refetchContactEdges,
    refetchLithoContacts,
    refetchLensData,
    markMutated,
    requestBodyRecompute,
    toast,
  })

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

  // Slot the section panel publishes its column-reveal implementation into —
  // the only way anything above the canvas can ask "is this column drawn, and
  // centre it". See ``components/sections/sectionColumnReveal.ts``.
  const columnRevealRef = useRef<SectionColumnRevealFn | null>(null)
  // Id-only projections of the two post-filter lists, so the reveal's gate walk
  // compares ids without re-deriving the filter it is explaining.
  const visibleCptIdList = useMemo(() => visibleCpts.map(c => c.id), [visibleCpts])
  const visibleBoreholeIdList = useMemo(() => visibleBoreholes.map(b => b.id), [visibleBoreholes])

  // The geotech pending-tie chip's press (owner ask 2026-08-25). Declared here,
  // AFTER every input it reads, because these are ``const`` bindings — a hook
  // call above one of them is a temporal-dead-zone ReferenceError that neither
  // tsc nor a unit test catches until the canvas actually renders.
  //
  // The panel below publishes its own reveal implementation into
  // ``columnRevealRef``; this hook asks it whether a tie is drawn, and answers
  // WHY it is not out of the shell state the panel cannot see.
  useGeotechPendingTieReveal({
    sectionId: selectedSectionId,
    section: selectedSection ?? null,
    edges: geotechPackingEdges,
    geotechLayers,
    excludedFromModelIds: axisExcludedBoreholeIds,
    projectCpts,
    projectBoreholes,
    visibleCptIds: visibleCptIdList,
    visibleBoreholeIds: visibleBoreholeIdList,
    removedCptIds,
    removedBoreholeIds,
    columnFocusOn: sectionFocusedColumn !== null,
    revealRef: columnRevealRef,
  })
  // The same panel reveal, published for the SHELL rather than the toolbar —
  // the Geotechnical stage's Build pre-flight deep-links a test here and needs
  // its column centred + pulsed after the stage switch (owner 2026-08-26).
  useSectionColumnRevealBridge(columnRevealRef)
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

  // Litho↔geo snap dialog — extracted to useLithoGeoSnapDialog (debt #201
  // round 2); behaviour unchanged. Called here (above the accept-with-snap
  // handler) so openLithoGeoSnapPrompt is in scope for the #134-C path.
  const {
    lithoGeoSnapPrompt,
    openLithoGeoSnapPrompt,
    lithoGeoSnapBusy,
    lithoSuggestionContactPreview,
    handleLithoContactLivePreview,
    handleLithoSnapAwareUpdateContactDepth,
    handleSnapLithoToGeo,
    handleMoveGeoToLitho,
    handleSnapDialogCancel,
  } = useLithoGeoSnapDialog({
    project,
    isLitho,
    // The geotech axis asks the same coupling question: its contact drag lands on the
    // litho row (see handleGeotechContactDrag below), and a third of those rows restate
    // a geological contact.
    isGeotech,
    lithoContacts,
    contacts,
    lithoSnapToleranceM,
    handleUpdateContactDepth,
    handleLoadBackdropSurfaces,
    toast,
  })

  // The geotech axis's ONE contact edit (owner ruling 2026-08-08).
  //
  // What the engineer grabs here is a geotech band's top, and moving THAT is what the
  // next "Subdivide all bodies" throws away — so the drag is only offered where the
  // boundary restates a lithostratigraphic contact, and the write lands on the litho row
  // instead. `planGeotechContactDrag` decides both halves (which row, and which packing
  // boundary the drag is allowed to reach); everything it declines is logged with the
  // reason, because a gesture that silently does nothing is the defect this replaces.
  //
  // Snapped is passed through as FALSE regardless: on the litho row `snapped` writes
  // ``source = 'observation_layer'``, which claims a borehole observation. A packing
  // boundary is cone resistance on a CPT — a hand move informed by evidence, which is
  // exactly what ``'manual'`` says.
  const handleGeotechContactDrag = useCallback(
    async (
      contactId: string,
      newDepthM: number,
      _snapped: boolean,
      field: 'top' | 'base' = 'top',
    ): Promise<void> => {
      const plan = planGeotechContactDrag({
        geotechContactId: contactId,
        toDepthM: newDepthM,
        geotechLayers,
        lithoLayers,
        lithoContacts,
      })
      switch (plan.kind) {
        case 'move': {
          log.info(
            'section',
            `geotech contact drag: contact ${plan.lithoContactId} → ${plan.depthM.toFixed(3)}m ` +
              `(grabbed geotech band ${contactId}, released at ${newDepthM.toFixed(3)}m)`,
          )
          if (geotechPackingModelId === null) return
          // ASK FIRST. Every other verb on this axis stays inside the geotechnical model;
          // this one edits the level above, and sometimes the level above that. Nothing on
          // screen says the row is shared, so the consequence is named before it happens
          // rather than reported afterwards.
          {
            // The undo command's capture, taken while the pre-merge rows still exist:
            // the pair's shared boundary, and the bands directly beyond each side.
            const upperBand = geotechLayers.find(l => l.id === plan.upperBandId)
            const lowerBand = geotechLayers.find(l => l.id === plan.lowerBandId)
            const anchor = upperBand?.cpt_id ?? upperBand?.borehole_id ?? null
            const neighbour = (at: number | undefined, side: 'top' | 'base'): string | null => {
              if (at === undefined || anchor === null) return null
              const hit = geotechLayers.find(
                l =>
                  (l.cpt_id ?? l.borehole_id) === anchor &&
                  Math.abs((side === 'top' ? l.depth_top_m : l.depth_base_m) - at) < 1e-6 &&
                  l.id !== plan.upperBandId &&
                  l.id !== plan.lowerBandId,
              )
              return hit?.id ?? null
            }
            setPendingContactMove({
              upperBandId: plan.upperBandId,
              lowerBandId: plan.lowerBandId,
              depthM: plan.depthM,
              lithoContactId: plan.lithoContactId,
              movesGeology:
                (lithoContacts.find(c => c.id === plan.lithoContactId)?.parent_geo_contact_id ??
                  null) !== null,
              preDragDepthM: lowerBand?.depth_top_m ?? plan.depthM,
              belowBandId: neighbour(lowerBand?.depth_base_m, 'top'),
              aboveBandId: neighbour(upperBand?.depth_top_m, 'base'),
            })
          }
          return
        }
        case 'unmatched':
          // Loud: parentage says this boundary restates a contact and no litho row is
          // within a millimetre of it, which means the two models disagree about the
          // column. Guessing a row would move something the engineer never pointed at.
          log.error(
            'section',
            `geotech contact drag refused: no litho contact within ${RESTATED_CONTACT_TOLERANCE_M} m of ` +
              `${plan.boundaryDepthM.toFixed(4)}m on ${plan.anchorId} (geotech band ${contactId})`,
          )
          toast('error', t('sections.canvasToast.noLithoContact'))
          return
        // Everything below declines the drag, and every one of them SAYS so. The
        // complaint this feature came from was "sometimes I can't grab the contact
        // handles any more" — a handle that moves under the cursor and then commits
        // nothing, with the reason in a log the owner will never open. Nothing here is
        // an error, so they are warnings: the gesture was legitimate, this boundary just
        // is not the one it moves. A landing drag stays silent (the boundary moving is
        // its own feedback); toasting the successes is how the refusals stop being read.
        case 'packing-boundary':
          log.debug(
            'section',
            `geotech contact drag ignored: ${contactId} is an internal packing boundary, not a litho contact`,
          )
          toast('warning', plan.anchorIsCpt ? t('sections.canvasToast.packingNotLithoCpt') : t('sections.canvasToast.packingNotLithoBorehole'))
          return
        case 'no-packing-boundaries':
          log.info(
            'section',
            `geotech contact drag ignored: ${plan.anchorId} offers no packing boundary to land on`,
          )
          toast('warning', t('sections.bands.nothingToSnap'))
          return
        case 'no-boundary-crossed':
          // Since the nudge ruling (2026-08-09) this means the release had NO travel at
          // all — a click that picked the contact or opened a menu, not a failed drag.
          // It gets no toast: the old wording told the engineer to "drag past a packing
          // boundary", which is now false advice, and it would fire on every click.
          log.debug(
            'section',
            `geotech contact drag ignored: released at its own depth (${newDepthM.toFixed(3)}m), no travel`,
          )
          return
        case 'not-a-boundary':
          // No toast: this is not a gesture the engineer can aim at. It means the id did
          // not resolve to an internal boundary of a column at all (a stale row, the top
          // of a stack), so there is nothing to explain to him about it.
          log.debug('section', `geotech contact drag ignored: ${contactId} is not an internal boundary`)
          return
      }
    },
    [geotechLayers, lithoLayers, lithoContacts, geotechPackingModelId, toast],
  )

  // Commit the restated-contact move the prompt is holding.
  //
  // ONE call, all three models. The earlier build patched only the litho row, which left
  // the packing band where it was: this axis draws the BAND, so a successful drag looked
  // like a no-op, and the NEXT drag was refused because the band and the contact had
  // stopped coinciding ("no litho contact within 0.0011 m of 16.9700m" — the owner's log).
  // The post-write fan-out the commit AND its undo share, so Ctrl+Z refreshes the
  // render exactly as the original gesture did.
  const settleContactMove = useCallback(async (): Promise<void> => {
    requestGeotechLayersRefetch()
    await refetchLithoContacts()
    await refetchGeotechPackingEdges()
    markMutated()
    // The move resizes (or absorbs) CPT packing bands and re-derives both
    // classes — the borehole division borrows exactly those bands, so amber
    // "Divide boreholes" as every other geotech write path does (audit F22).
    markBoreholesStale()
    // The three-model write moves litho rows AND packing bands, so BOTH models'
    // body geometry moved — schedule both identity recomputes (slice 5). The
    // undo command shares this fan-out, so Ctrl+Z/Ctrl+Y reschedule too.
    requestBodyRecompute('litho')
    requestBodyRecompute('geotech')
  }, [requestGeotechLayersRefetch, refetchLithoContacts, refetchGeotechPackingEdges, markMutated, requestBodyRecompute])

  const handleConfirmContactMove = useCallback(async (): Promise<void> => {
    if (pendingContactMove === null || geotechPackingModelId === null) return
    setContactMoveBusy(true)
    try {
      const moved = await api.geology.moveRestatedContact(
        project.id,
        geotechPackingModelId,
        pendingContactMove.upperBandId,
        pendingContactMove.lowerBandId,
        pendingContactMove.depthM,
      )
      log.success(
        'section',
        `contact moved in ${moved.geo_contact_id !== null ? '3' : '2'} model(s): ` +
          `bands ${moved.layer_ids.join(', ')}, litho ${moved.litho_lower_layer_id}` +
          (moved.geo_contact_id !== null ? `, geology ${moved.geo_contact_id}` : ''),
      )
      // Both models changed, so both views reload: the bands drawn on this axis, and the
      // litho rows the parentage probe reads to decide which boundaries are contacts.
      // The ties reload too — a move that lands ON the next boundary absorbs a band, and
      // the accepted ties anchored on it are re-anchored and flagged.
      await settleContactMove()
      // The dialog promises "One step on the undo stack. Ctrl+Z puts all of it back",
      // and until audit F11 nothing pushed that step — Ctrl+Z silently reverted an
      // unrelated earlier edit instead.
      const undoCommand = buildRestatedContactUndoCommand(
        {
          projectId: project.id,
          modelId: geotechPackingModelId,
          upperBandId: pendingContactMove.upperBandId,
          lowerBandId: pendingContactMove.lowerBandId,
          preDragDepthM: pendingContactMove.preDragDepthM,
          landedDepthM: pendingContactMove.depthM,
          belowBandId: pendingContactMove.belowBandId,
          aboveBandId: pendingContactMove.aboveBandId,
        },
        moved.deleted_layer_ids,
        api.geology,
        settleContactMove,
      )
      if (undoCommand !== null) {
        undoStack.push(undoCommand)
      } else {
        // A wrong undo is worse than a missing one — say which gesture is not on
        // the stack instead of silently letting Ctrl+Z hit the previous edit.
        log.warn('section', 'contact move committed without an undo entry (no anchor row)')
      }
      // Ask about what the move broke, now that the edge list matches the server.
      flaggedTiePrompt.askAbout(moved.flagged_edge_ids ?? [])
    } catch (err) {
      log.error('section', 'moveRestatedContact failed', err)
      // The server's own words when it gave any: a refused move names what it hit —
      // that landing here would delete the unit below, and where a unit does get
      // removed. The house sentence said only that nothing happened.
      toast(
        'error',
        apiFailureMessage(err, 'The contact could not be moved — nothing was changed.'),
      )
    } finally {
      setContactMoveBusy(false)
      setPendingContactMove(null)
    }
  }, [
    pendingContactMove,
    geotechPackingModelId,
    project.id,
    settleContactMove,
    undoStack,
    toast,
    flaggedTiePrompt,
  ])

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
      openLithoGeoSnapPrompt({
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


  // Manual litho-unit creation (debt #151) — extracted to useManualLithoUnit
  // (debt #201 round 2); behaviour unchanged.
  const { handleManualLithoUnitCreate, handleLithoExistingUnitPick } = useManualLithoUnit({
    activeLithoModel,
    selectedSection,
    projectId: project.id,
    applyUpdatedSection,
    refetchFormations,
    refetchLithoContacts,
    lithoContacts,
    formations,
    lithoFormations,
  })

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

  // Body-identity recompute (slice 5): the debounced scheduler, the project-open
  // trigger, and the coordinator nonce watch all live at the SHELL level now
  // (``useProjectBodyRecompute`` in App — owner ruling 2026-08-12: the initial
  // recompute fires on PROJECT OPEN, stage-independent). This canvas only BUMPS
  // the nonces from its mutation sites (``requestBodyRecompute`` calls above).

  if (selectedSection !== null) {
    // WHY Fragment: InspectLensBodyPanel and CompanionOfferDialog are SectionsCanvas-
    // level portals (they escape the SVG stacking context via createPortal in Modal).
    // They must render alongside SectionPanel â€” not only in the no-section-selected
    // branch. Wrapping in a Fragment keeps the early-return semantics while ensuring
    // both dialogs are reachable from the section view (#101 fix-up 2).
    return (
      <>
        {/* Section-scoped data slices (debt #201 round 2): a fresh object per
            render is deliberate — nothing below is React.memo, and skipping
            useMemo removes the stale-dep-array failure mode. See
            SectionScopeContext.tsx. */}
        <SectionScopeContext.Provider
          value={{
            // Phase B (debt #201): the core per-section data slices moved off
            // SectionPanel's props onto the scope. Each keeps the exact value
            // and axis gating it had as a prop.
            zEpsg: project.default_vertical_epsg,
            cpts: visibleCpts,
            boreholes: visibleBoreholes,
            contacts: sectionContacts,
            formations: axisFormations,
            axisMode: isGeotech
              ? 'geotechnical'
              : isLitho
                ? 'lithostratigraphic'
                : 'geological',
            activeLithoModelId: isLitho ? (activeLithoModel?.id ?? null) : null,
            focusableContacts: axisContacts,
            excludedBoreholeIds: axisExcludedBoreholeIds,
            surfacesByFormationId: axisSurfacesByFormationId,
            focusedContactIds,
            undoStack,
            // Geological surface backdrop (#60): litho axis only, and only when
            // at least one geological formation exists; surfaces come from the
            // user-triggered handleLoadBackdropSurfaces ("Sync geology").
            referenceFormations: isLitho && formations.length > 0 ? formations : undefined,
            referenceSurfacesByFormationId:
              isLitho && backdropSurfacesByFormationId.size > 0
                ? backdropSurfacesByFormationId
                : undefined,
            // Snap-to-contact backdrop: litho axis passes the geological
            // contacts through so ContactsLayer draws a polyline EXACTLY
            // through each pick (no 3D-to-2D projection error).
            referenceContacts: isLitho && contacts.length > 0 ? contacts : undefined,
            // Debt #134-B drag-readout "snap on release" hint - pre-release
            // telegraph for the same prompt handleLithoSnapAwareUpdateContactDepth
            // fires post-release. Litho axis only; ContactsLayer also guards on
            // a non-empty referenceContacts set.
            geoSnapToleranceM: isLitho ? lithoSnapToleranceM : undefined,
            openExtentLengthM,
            // 3-D model fill (litho-3D M3): prebuilt body solids feed the 2-D
            // section overlay so the geometric fill matches the 3-D viewer.
            // Each model axis shows ITS OWN build (owner 2026-08-26: "can we
            // show the actual 3D model on the 2d sections just like in litho
            // stage") - the geological axis has no body build to show.
            modelSolids: isLitho ? lithoSolids : isGeotech ? geotechSolids : undefined,
            sectionFillAtSectionLine:
              isLitho || isGeotech ? sectionFillAtSectionLine : undefined,
            // #133: contact-level correlation edges; CorrelationEdgesOverlay is
            // mounted on the litho/geotech axes only - zero geological regression.
            contactEdges: isLitho || isGeotech ? contactCorrelationEdges : undefined,
            // Geotech "Correlate packing" edges (2026-06-25): SEPARATE from
            // contactEdges (the litho-framed partition list on both axes); read
            // on the geotech axis only, never feeds the partition / spacing
            // (commit 7329738b regression).
            geotechCorrelationEdges: isGeotech ? geotechPackingEdges : undefined,
            // Auto-lens (2026-06-02): pinch-out candidates from the last
            // auto-correlate run, amber diamonds on the litho axis.
            crossingPinchOuts: isLitho ? lithoCrossingPinchOuts : undefined,
            // #163f Slice 2 - lens wedges + shaping (litho axis only). On the
            // geotech axis this carries the GEOTECH body roster (piece B): the
            // overlay's ``bodyById`` reads it to resolve the right-clicked
            // region's body for the body menu — the lens WEDGES/handles stay
            // litho-only (viewOnly gates them), only the roster crosses over.
            lenses: isLitho
              ? lensList
              : isGeotech
                ? geotechBodyList
                : undefined,
            // The LITHO model's layers on both axes. On the geotech axis they no
            // longer frame the partition (SectionPanel swaps in the geotech
            // model's own rows for that, owner ruling 2026-08-13) - they are the
            // source of the litho envelopes drawn OVER the packing fills, and of
            // the restated-contact / snap gestures that compare the two models.
            lithoLayers: isLitho || isGeotech ? sectionLayers : undefined,
            geotechModel: geotechAxisModel,
            // Ghost bands over undivided boreholes — geotech axis only, and
            // dropped per column the moment that column's committed bands land.
            geotechBoreholePreview: isGeotech ? boreholePreview.columns : undefined,
            // Lets the overlay tell "no borehole is divided" apart from "the
            // committed rows are mid-refetch"; without it the ghosts flicker
            // back over already-divided columns on every reload.
            geotechLayersLoaded,
            lensBoundaries,
            pulsingFormationIds,
            virtueleBoringActiveModels: virtueleBoringSectionModels,
            virtueleBoringPredictions,
            virtueleBoringModelA: virtueleBoringOverlay.modelA,
            virtueleBoringModelB: virtueleBoringOverlay.modelB,
            virtueleBoringMaxDepthM: virtueleBoringOverlay.maxDepthM,
            virtueleBoringShowOnSection: showOverlayOnSection,
          }}
        >
        <SectionPanel
          section={selectedSection}
          onPatch={handlePatchSelectedSection}
          onClose={clearSectionSelection}
          onSelectCpt={handleSelect}
          onSelectBorehole={handleSelectBorehole}
          liveContactDepthOverride={lithoSuggestionContactPreview}
          // On the litho axis, left-click must never open the formation
          // picker â€” the right-click ghost flow is the intended entry point
          // (dogfeed 2026-05-26). Passing undefined here prevents
          // ContactPickBar's onCommitDepth and BoreholeColumn's onCommitDepth
          // from firing handlePickCpt/handlePickBorehole, which is where the
          // picker dialog opens in useContactPicker â€” BEFORE the internal
          // sectionAwareCreateContact early-return guard even runs. The previous
          // guard was too late in the callback chain.
          onCreateContact={(isLitho || isGeotech) ? undefined : sectionAwareCreateContact}
          // The geotech axis is view-only, and these two are how that leaked. ContactsLayer
          // renders its drag hit-strip and its right-click delete whenever an edit handler
          // is present, with no axis check of its own, so passing them here made a geotech
          // contact draggable and deletable — and the next "Subdivide all bodies" discards
          // the edit silently, because subdivision rewrites every geotech row in the model.
          // The sibling above and onRequestDeleteContact on the correlation overlay were
          // already gated; these two were missed.
          //
          // ONE exception, and only this one (owner ruling 2026-08-08): the contact DEPTH
          // handler is wired on the geotech axis too, routed through
          // ``handleGeotechContactDrag``, which moves the LITHO row a boundary restates
          // and refuses everything else. Create, delete and the batch pair below stay
          // withheld — this is not the axis becoming editable, it is one boundary the
          // engineer is allowed to move from the screen that shows the evidence for it.
          onUpdateContactDepth={
            isGeotech ? handleGeotechContactDrag : handleLithoSnapAwareUpdateContactDepth
          }
          onDeleteContact={isGeotech ? undefined : handleDeleteContact}
          // The bounded exception to the line above (owner spec 2026-08-01). Splitting and
          // merging packing SUB-BANDS is allowed by hand on the geotech axis and nowhere
          // else: it goes through endpoints that re-derive the NAD class from qc over the
          // new interval, rather than moving a contact the next Subdivide would discard.
          // Litho has its own split/merge on ghost suggestions — these two are not it.
          onRequestGeotechSplitBand={isGeotech ? geotechBandEdit.onRequestSplitBand : undefined}
          onRequestGeotechMergeBands={isGeotech ? geotechBandEdit.onRequestMergeBands : undefined}
          onRequestGeotechMoveBoundary={
            isGeotech ? geotechBandEdit.onRequestMoveBoundary : undefined
          }
          onRequestGeotechAbsorbLens={isGeotech ? geotechBandEdit.onRequestAbsorbLens : undefined}
          onRequestGeotechSetBandClass={
            isGeotech ? geotechBandEdit.onRequestSetBandClass : undefined
          }
          onRequestGeotechClearColumn={
            isGeotech ? geotechBandEdit.onRequestClearColumn : undefined
          }
          // Each axis jumps as ITSELF (rulings R1/R2, 2026-08-27): a geotech
          // band or fill region reports a geotech unit; a litho band or body
          // reports a litho unit — whose pool spans every packing class
          // inside it. The kind is stamped in the handlers above.
          onShowGeotechUnitStatistics={
            isGeotech ? handleShowGeotechUnitStatistics : undefined
          }
          onShowLithoUnitStatistics={
            isLitho ? handleShowLithoUnitStatistics : undefined
          }
          geotechSmallLensThicknessM={geotechMinLayerThicknessM}
          onUnlinkLithoFromGeo={isLitho ? handleUnlinkLithoFromGeo : undefined}
          onLinkLithoToGeo={isLitho ? handleLinkLithoToGeo : undefined}
          // Geotech axis is view-only; geology sync not applicable.
          //
          // The batch pair commits the same contact edits as the two handlers above, only
          // for a multi-selection or a cross-column drag. They were reachable on the
          // geotech axis only through a hit-strip ContactsLayer mounts when ANY of the
          // four single-contact handlers is present — so gating those two alone left this
          // pair depending on an accident of the other, with the axis nowhere in the
          // reasoning. Gated here on the same call as its siblings.
          //
          // ``onBatchUpdateContacts`` has a SECOND consumer that is not a mutation:
          // SectionPanel's own mousedown reads its presence to decide whether Shift+drag
          // opens the contact multi-select marquee (SectionPanel.tsx, handleMouseDown).
          // Withholding the handler alone would have turned Shift+drag on the geotech
          // axis into a pan and made the selection highlight unreachable — a READ
          // affordance lost to a mutation gate. ``contactMarqueeEnabled`` below keeps
          // the two separable: the marquee stays on every axis, the batch verbs do not.
          onBatchUpdateContacts={isGeotech ? undefined : handleBatchUpdateContacts}
          onBatchCreateContacts={isGeotech ? undefined : sectionAwareBatchCreateContacts}
          contactMarqueeEnabled
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
          onChangeVirtueleBoringPicker={handleChangeVirtueleBoringPicker}
          onChangeVirtueleBoringShowOnSection={next =>
            handleSetShowOverlay('section', next)
          }
          lithoGhostState={lithoGhostState}
          bulkLithoGhostState={bulkLithoGhostState}
          // Lift the section-local focused column to the shell so
          // SectionsToolbar can use it for the litho-axis Suggest button.
          onFocusedColumnChange={setSectionFocusedColumn}
          columnRevealRef={columnRevealRef}
          // Manual litho composition picker (Phase-1.5): the picker dialog
          // is shown instead of the geological FormationPicker when the
          // section is on the lithostratigraphic axis (axisMode, now on the
          // scope, gates it).
          onManualLithoUnitCreate={isLitho ? handleManualLithoUnitCreate : undefined}
          onLithoExistingUnitPick={isLitho ? handleLithoExistingUnitPick : undefined}
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
          // On litho: promotes the pending contact edge on the litho model.
          // On geotech: promotes the pending PACKING tie on the geotech model. The
          //   geotech axis used to be excluded here because every geotech edge was
          //   written approved; the standalone geotech auto-correlate proposes them
          //   unapproved, so the review gesture has to exist on this axis too.
          onRequestAcceptEdge={
            isLitho
              ? edge => void handleAcceptContactCorrelation(edge.id)
              : isGeotech
                ? edge => void handleAcceptGeotechPackingCorrelation(edge.id)
                : undefined
          }
          // The geotech axis names this object a packing TIE everywhere else
          // ("3 · Accept all ties", the pending chip, the gate's refusal), so the
          // per-tie row says the same word as the bulk verb.
          acceptEdgeLabel={isGeotech ? 'Accept tie' : undefined}
          // A flagged tie is a geotech-only state: only the re-subdivide raises it,
          // and only the geotech model carries one.
          onRequestConfirmEdgeReview={
            isGeotech ? edge => void handleConfirmGeotechPackingReview(edge.id) : undefined
          }
          // Right-click a ghosted borehole -> "Accept these bands (divide this
          // borehole)". The same verb the toolbar's step 4 runs, scoped to one
          // column, so the ghosts the engineer agreed with become rows without
          // rebuilding the ones he did not. Geotech axis only — the ghosts only
          // exist there.
          onDivideBoreholeFromPreview={
            isGeotech
              ? boreholeId => void handleDivideBoreholes({ boreholeIds: [boreholeId] })
              : undefined
          }
          onSaveLensShape={isLitho ? handleSaveLensShape : undefined}
          // S103 correlate-on-drag: a drag on an UN-correlated two-band boundary creates the
          // section-scoped tie (upper band base-base — no litho flip), reusing the manual
          // contact-correlate path. Litho axis only. Stable ``handleCorrelateBoundary`` (S3).
          onCorrelateBoundary={isLitho ? handleCorrelateBoundary : undefined}
          onDeleteLens={isLitho ? handleDeleteLens : undefined}
          // Body menu on BOTH the litho and geotech axes (piece B, owner
          // 2026-08-31). The handlers are axis-aware (they POST against
          // ``bodyMenuModel.id``); on the geotech axis they act on the geotech
          // model. Contact editing stays view-only there — only the menu crosses.
          onNameBody={isLitho || isGeotech ? bid => void handleNameBody(bid) : undefined}
          onDissolveBody={isLitho || isGeotech ? bid => void handleDissolveBody(bid) : undefined}
          // Join / Ontkoppelen (debt #278) — GEOTECH axis ONLY. Owner ruled
          // 2026-09-01 the body verbs are stripped to these two (Separate / Rejoin
          // removed); he would not use Join on litho, and the no-affordance rule
          // (no handler → no "Voeg samen met…" item) keeps it geotech-only.
          onJoinBodies={isGeotech ? (a, b) => void handleJoinBodies(a, b) : undefined}
          onDisjoinBody={isGeotech ? uid => void handleUnjoinBody(uid) : undefined}
          unions={isGeotech ? geotechUnionsList : undefined}
          onJoinNotice={isGeotech ? handleJoinNotice : undefined}
          // #279: the body menu arms only while the roster is current for the
          // active model, and goes stale (stats menu is the deliberate answer)
          // across every recompute window — see useRosterLoadedGate. Per-axis
          // gate: the geotech gate follows the geotech recompute nonce.
          bodiesLoaded={isGeotech ? geotechRosterLoaded : rosterLoaded}
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
        </SectionScopeContext.Provider>
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
              toast('success', t('sections.canvasToast.perpCreated'))
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
        {/* Names what a restated-contact drag will move, before it moves it. */}
        <MoveRestatedContactDialog
          open={pendingContactMove !== null}
          depthM={pendingContactMove?.depthM ?? 0}
          movesGeology={pendingContactMove?.movesGeology ?? false}
          busy={contactMoveBusy}
          onCancel={() => setPendingContactMove(null)}
          onConfirm={() => void handleConfirmContactMove()}
        />
        {/* Name / rename a lens (body). Replaces the dead-end window.prompt â€”
            Electron disables prompt() in the renderer. */}
        <NameBodyDialog
          open={namingBody !== null}
          initialName={namingBody?.currentName ?? ''}
          onSubmit={submitBodyName}
          onCancel={() => setNamingBody(null)}
        />
        {/* What a hand split / merge of packing bands would do, before it is written
            (owner ruling 6). Advisory: the action stays enabled whatever it says, because
            the owner overrules the qc — he just does not get to be surprised by it. */}
        {geotechBandEdit.plan !== null && (
          <GeotechBandEditDialog
            open
            plan={geotechBandEdit.plan}
            busy={geotechBandEdit.busy}
            onConfirm={geotechBandEdit.confirm}
            onCancel={geotechBandEdit.cancel}
          />
        )}
        {/* Raised AFTER an edit lands, not before it: the question is about what the
            edit turned out to break, and the ids are resolved against the refetched
            edge list. Its own count gates it, so it renders unconditionally. */}
        <FlaggedTiesPromptDialog
          count={flaggedTiePrompt.flaggedCount}
          busy={flaggedTiePrompt.busy}
          onKeep={flaggedTiePrompt.keep}
          onDelete={() => void flaggedTiePrompt.deleteAll()}
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
            <p className="text-sm font-medium text-text-primary mb-1">{t('sections.none')}</p>
            <p className="text-xs text-text-secondary mb-3">{t('sections.emptyBlurb')}</p>
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
                    : ctaCreating ? t('sections.busy.creating') : t('sections.canvas.newSectionTitle')
                }
              >
                {ctaCreating ? (
                  <>
                    <Loader2
                      className="h-3 w-3 animate-spin"
                      aria-hidden="true"
                    />
                    {t('sections.busy.creating')}
                  </>
                ) : (
                  t('sections.newPlus')
                )}
              </button>
              <button
                type="button"
                onClick={() => setCtaDismissed(true)}
                className="text-xs text-text-muted hover:text-text-secondary transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >{t('common.dismiss')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
