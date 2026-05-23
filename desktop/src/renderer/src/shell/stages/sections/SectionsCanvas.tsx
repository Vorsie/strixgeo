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

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Route } from 'lucide-react'

import { api } from '../../../api/client'
import type { AdmixtureItem, LithoCorrelationEdge } from '../../../api/client'
import type { CorrelateGestureState } from '../../../components/sections/CorrelationEdgesOverlay'
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

  // Slice 4 (#55): litho correlation edges — fetch + gesture callbacks.
  //
  // Edges are MODEL-level only (no section_id) and must be fetched fresh
  // after every edge mutation (correlate / uncorrelate) to keep ordinals
  // in sync with the inspector stale badge. The effect re-runs whenever
  // the active litho model or selected section changes — model changes swap
  // the edge set; section changes can expose different visible formations.
  const [correlationEdges, setCorrelationEdges] = useState<LithoCorrelationEdge[]>([])

  // Key the fetch on the model ID, not the model object (review S2): the
  // object re-identifies on unrelated mutations (e.g. a formation rename
  // rebuilds it), which would churn refetchEdges + the whole gesture-state
  // chain AND leave the effect (keyed on the id) out of sync — stale edges
  // after a same-id rebuild. The primitive id is the true identity.
  const lithoModelId = activeLithoModel?.id ?? null

  const refetchEdges = useCallback(async () => {
    if (lithoModelId === null) {
      setCorrelationEdges([])
      return
    }
    log.debug('section', `listCorrelations: GET project=${project.id} model=${lithoModelId}`)
    try {
      const edges = await api.geology.listCorrelations(project.id, lithoModelId)
      setCorrelationEdges(edges)
      log.debug('section', `listCorrelations: ${edges.length} edge(s) for model ${lithoModelId}`)
    } catch (err) {
      log.warn('section', 'refetchEdges: listCorrelations failed', err)
    }
  }, [lithoModelId, project.id])

  useEffect(() => {
    if (!isLitho) {
      setCorrelationEdges([])
      return
    }
    void refetchEdges()
    // reason: isLitho + activeLithoModel + selectedSectionId are the axes
    // that change when the user switches model or section; refetchEdges
    // already captures project.id + activeLithoModel.id via closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLitho, activeLithoModel?.id, selectedSectionId])

  const handleCorrelate = useCallback(
    async (formationAId: string, formationBId: string): Promise<void> => {
      if (!activeLithoModel) return
      log.info(
        'section',
        `correlate: linking ${formationAId} ↔ ${formationBId} on model ${activeLithoModel.id}`,
      )
      try {
        await api.geology.correlate(project.id, activeLithoModel.id, formationAId, formationBId)
        // The correlate endpoint resolves ordinals + commits internally
        // (CorrelateLithoUnits.run_resolver, folded in at the Slice-0+1
        // review) — a separate resolveLithoInstances call here is a
        // redundant idempotent no-op round-trip (Phase-2 span audit
        // should-fix). Just refetch the edges for the overlay; no toast
        // on success (owner-decided: the edge line + badge ARE the cue).
        await refetchEdges()
        // Clear armed state so the user can arm the next source.
        clearCorrelationSource()
        log.success('section', `correlate: edge ${formationAId} ↔ ${formationBId} created`)
      } catch (err) {
        log.warn('section', 'handleCorrelate: POST failed', err)
        // The armed source is deliberately NOT cleared (review spec: stay
        // armed so the user can retry / pick a different target). Surface
        // the failure — silence on a failed POST is worse than a toast
        // (review S1; the cross-group case is pre-empted client-side so
        // this is a genuine 422 race or a network error).
        toast('error', 'Could not create the correlation — try again.')
      }
    },
    [activeLithoModel, project.id, refetchEdges, clearCorrelationSource, toast],
  )

  const handleUncorrelate = useCallback(
    async (formationAId: string, formationBId: string): Promise<void> => {
      if (!activeLithoModel) return
      log.info(
        'section',
        `uncorrelate: removing ${formationAId} ↔ ${formationBId} on model ${activeLithoModel.id}`,
      )
      // Optimistic removal from local state before the DELETE resolves
      setCorrelationEdges(prev =>
        prev.filter(
          e =>
            !(
              (e.formation_a_id === formationAId && e.formation_b_id === formationBId) ||
              (e.formation_a_id === formationBId && e.formation_b_id === formationAId)
            ),
        ),
      )
      try {
        await api.geology.uncorrelate(project.id, activeLithoModel.id, formationAId, formationBId)
        // UncorrelateLithoUnits re-runs the resolver + commits internally;
        // a separate resolveLithoInstances call is a redundant no-op
        // round-trip (Phase-2 span audit should-fix).
        await refetchEdges()
        log.success('section', `uncorrelate: edge ${formationAId} ↔ ${formationBId} removed`)
      } catch (err) {
        log.warn('section', 'handleUncorrelate: DELETE failed — rolling back optimistic removal', err)
        await refetchEdges()
      }
    },
    [activeLithoModel, project.id, refetchEdges],
  )

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
        // A save action must not fail silently — mirror handleCorrelate.
        log.warn('section', 'handlePropagateAdmixtures: PATCH failed', err)
        toast('error', 'Could not update the body’s admixtures — try again.')
      }
    },
    [activeLithoModel, project.id, refetchFormations, toast],
  )

  // Build the correlateGestureState passed to SectionPanel.
  // Only wired on the litho axis; absent on the geological axis.
  const correlateGestureState: CorrelateGestureState | undefined = useMemo(() => {
    if (!isLitho) return undefined
    return {
      correlateMode,
      correlationSource,
      onArm: armCorrelationSource,
      onClearArmed: clearCorrelationSource,
      onExitMode: exitCorrelateMode,
      onCorrelate: handleCorrelate,
      onUncorrelate: handleUncorrelate,
      onPropagateAdmixtures: handlePropagateAdmixtures,
    }
  }, [
    isLitho,
    correlateMode,
    correlationSource,
    armCorrelationSource,
    clearCorrelationSource,
    exitCorrelateMode,
    handleCorrelate,
    handleUncorrelate,
    handlePropagateAdmixtures,
  ])

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
  const sectionAwareAcceptLithoSuggestion = useCallback(
    async (idx: number): Promise<void> => {
      await handleAcceptLithoSuggestion(idx, selectedSection?.id ?? null, applyUpdatedSection)
    },
    [handleAcceptLithoSuggestion, selectedSection, applyUpdatedSection],
  )

  // Phase-1.5 manual litho composition picker — new-unit path.
  //
  // WHY a dedicated callback at this boundary:
  //   The "new unit" tab in LithoCompositionPickerDialog produces a main soil
  //   code + admixture list. The existing acceptLithoSuggestions endpoint is
  //   reused with a synthetic one-item payload (source='manual_pick', sentinel
  //   depth_base = depth_top + 0.01 so it never straddles). The response carries
  //   updated_section which MUST be forwarded via applyUpdatedSection (#57
  //   invariant). Returning the created/found formation id lets SectionPanel's
  //   useContactPicker chain into handlePickerSelect to create the contact.
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
      if (!activeLithoModel || !selectedSection) {
        log.warn('section', 'handleManualLithoUnitCreate: no active litho model or section')
        return null
      }

      // Synthetic one-item payload. depth_base = depth_top + 0.01 is the sentinel
      // that guarantees the suggestion never straddles (the use case splits on
      // boundaries within [top, base] — a 1 cm window cannot span a formation
      // boundary in practice). The server still resolves parent_formation_id from
      // the geology TIN at the investigation's (x, y, depth_top).
      const payload = {
        [anchorKind === 'cpt' ? 'cpt_id' : 'borehole_id']: anchorId,
        section_id: selectedSection.id,
        suggestions: [
          {
            depth_top_m: depthM,
            depth_base_m: depthM + 0.01,
            suggested_lithology: mainCode,
            suggested_nad_class: null,
            mean_qc_mpa: null,
            dr_pct: null,
            confidence: 'medium' as const,
            source: 'manual_pick',
            suggested_admixtures: admixtures,
            parent_formation_id: null,
            spans_boundary: false,
          },
        ],
      }

      log.debug(
        'section',
        `handleManualLithoUnitCreate: litho_model=${activeLithoModel.id} ` +
          `anchor=${anchorKind}/${anchorId} depth=${depthM.toFixed(2)}m soil=${mainCode}`,
      )

      try {
        const result = await api.geology.acceptLithoSuggestions(
          project.id,
          activeLithoModel.id,
          payload,
        )

        // #57 invariant: forward updated_section directly from the response echo —
        // no GET. The endpoint returns the section with the new contact ids already
        // unioned into seeded_formation_contact_ids.
        if (result.updated_section) {
          applyUpdatedSection(result.updated_section)
          log.debug(
            'section',
            `handleManualLithoUnitCreate: applyUpdatedSection(section=${selectedSection.id})`,
          )
        } else {
          log.warn(
            'section',
            'handleManualLithoUnitCreate: no updated_section in response — seeded set may be stale',
          )
        }

        // Return the first created or found formation id so SectionPanel's
        // useContactPicker can chain into onSelect → contact creation.
        const formationId =
          result.created_formation_ids[0] ?? result.found_formation_ids[0] ?? null
        if (formationId === null) {
          log.warn(
            'section',
            'handleManualLithoUnitCreate: no formation id in response (created=[], found=[])',
          )
          return null
        }

        log.debug('section', `handleManualLithoUnitCreate: formationId=${formationId}`)
        // Refetch litho contacts so the section view picks up the new
        // contact immediately. Without this the contact is in the DB
        // but local lithoContacts stays stale and the user sees
        // "nothing happened" (dogfeed bug 2026-05-20 — same class as
        // the earlier handleAcceptLithoSuggestion fix).
        refetchLithoContacts()
        return { formationId }
      } catch (err) {
        log.warn('section', 'handleManualLithoUnitCreate: acceptLithoSuggestions failed', err)
        return null
      }
    },
    // toast intentionally NOT used / not a dep: the catch returns null so
    // the picker simply stays open on failure (no error toast — intended
    // UX). If a future edit adds toast() into the catch, add it here too
    // or it becomes a stale-closure bug (review C3).
    [activeLithoModel, selectedSection, project.id, applyUpdatedSection, refetchLithoContacts],
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
  ])

  // Pinch-out ghost state — wired on the geological axis only (same
  // axis that owns the formation contacts the user right-clicks on).
  // The onPreviewPinchOut callback derives direction (defaults 'right'
  // — the UX default is toward the termination edge which is typically
  // the section's right end; useGeologicalModel.handlePreviewPinchOut
  // auto-retries the opposite direction when the requested one returns
  // a geometry-uncomputable 422, debt #62 item 2) and target formation
  // (the next formation by display_order below the pinching one). A
  // future picker overrides both heuristics; until then the auto-retry
  // is the safety net for west-pinching formations / R→L sections.
  const pinchOutGhostState = useMemo(() => {
    if (isLitho || !activeGeologicalModel) return undefined
    const sectionId = selectedSection?.id ?? null
    if (sectionId === null) return undefined
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
          modelId: activeGeologicalModel.id,
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
    selectedSection,
    pinchOutPreview,
    pinchOutLoading,
    axisFormations,
    handlePreviewPinchOut,
    handleCommitPinchOut,
    clearPinchOutPreview,
    applyUpdatedSection,
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
        showConfidenceFade={showConfidenceFade}
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
        onManualLithoUnitCreate={isLitho ? handleManualLithoUnitCreate : undefined}
        // Slice 4 (#55): correlation edges + gesture state, litho axis only.
        // On the geological axis both props are undefined → CorrelationEdgesOverlay
        // is not mounted (no regression, no stale edge data).
        correlationEdges={isLitho ? correlationEdges : undefined}
        correlateGestureState={correlateGestureState}
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
