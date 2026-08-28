// Sections stage toolbar — section-specific verbs wired from the ShellContext bus.
//
// Collects the section actions (Build model, Auto-populate, Dedupe, Export DXF,
// Export Plaxis 3D, New cross-section, Delete section) into one place for the
// Sections stage.  All handlers are sourced from useShell() — no props accepted
// (matches the StageDescriptor.ToolbarComponent contract).
//
// The verbs are declared as ``ToolbarItemSpec``s rather than rendered
// straight into a flex row, so ``ResponsiveToolbarRow`` can decide what fits
// (owner dogfeed 2026-08-26: the axis pill read "Geology | Litho | Geote" on
// a fullscreen laptop). Each spec states a priority, how to render at each
// presentation, and the rows it contributes to the ⋯ More menu when it folds
// — for a dropdown that is simply its own menu, so a folded dropdown loses
// nothing. See ``shell/toolbarOverflow.ts`` for the ladder and its rationale.

import { useCallback, useMemo, useState } from 'react'
import { Undo2 } from 'lucide-react'

import { api } from '../../../api/client'
import { useShell } from '../../ShellContext'
import { ToolbarButton } from '../../ToolbarPrimitives'
import ResponsiveToolbarRow, { type ToolbarItemSpec } from '../../ResponsiveToolbarRow'
import { AXIS_PILL_COMPACT_PX, AXIS_PILL_FULL_PX } from './sectionsToolbar_constants'
import { sectionCrsBlockReason } from '../../../utils/horizontalCrs'
import { inCorridorInvestigationIds } from '../../../utils/sectionClassification'
import type { SectionModelAxis } from '../../../hooks/useSections'
import { log } from '../../../utils/log'
import { useBandFillVisible } from '../../../utils/bandFillStore'
import { useCorrelationOverlayVisible } from '../../../utils/correlationOverlayStore'
import { useFormationFillVisible } from '../../../utils/formationFillStore'
import { useGeotechFillVisible } from '../../../utils/geotechFillStore'
import { useGeotechModelFillVisible } from '../../../utils/geotechModelFillStore'
import { useLithoFillOnGeotech } from '../../../utils/lithoFillOnGeotechStore'
import { useBoreholePreviewOn } from '../../../utils/boreholePreviewOnStore'
import { useSampleMarkersOn } from '../../../utils/sampleMarkersOnStore'
import { usePsdPreviewOn } from '../../../utils/psdPreviewOnStore'
import { useSampleMarkersHotkey } from './useSampleMarkersHotkey'
import { useLithoFillHotkey } from './useLithoFillHotkey'
import { useGeotechFillHotkey } from './useGeotechFillHotkey'
import {
  GEOTECH_FILL_TOAST_KEY,
  LITHO_FILL_TOAST_KEY,
  SAMPLE_MARKERS_TOAST_KEY,
  geotechFillToastMessage,
  lithoFillToastMessage,
  sampleMarkersToastMessage,
} from './displayToggleToast'
import { useBoreholesStale } from '../../../utils/boreholesStaleStore'
import { countGeotechHandEdits, geotechBandsInScope } from '../../../utils/geotechHandEdits'
import { useGeotechCorrelationVerbs } from './useGeotechCorrelationVerbs'
import { sectionsBodyRecomputeCallback } from '../../../hooks/useProjectBodyRecompute'
import { useGeotechTieStatus } from './useGeotechTieStatus'
import { useGeotechStatistic } from './useGeotechStatistic'
import { useLithoSuggestVerbs } from './useLithoSuggestVerbs'
import { useSectionExportVerbs } from './useSectionExportVerbs'
import { useLithoCorrelateVerbs } from './useLithoCorrelateVerbs'
import { useGeotechSubdivideVerbs } from './useGeotechSubdivideVerbs'
import { summarisePendingTies } from '../../../utils/geotechPendingScope'
import {
  PENDING_TIE_NONE_HERE,
  PENDING_TIE_NO_CANVAS,
  PENDING_TIE_TOAST_KEY,
} from '../../../utils/pendingTieReveal_constants'
import { unionStaleGeotechColumns } from '../../../utils/staleGeotechColumns'
import { sectionsRevealPendingTieCallback } from './pendingTieRevealBridge'
import type { PendingTieRevealOutcome } from './useGeotechPendingTieReveal'
import SectionsAxisPill from './SectionsAxisPill'
import SectionsToolbarDialogs from './SectionsToolbarDialogs'
import { buildLithoToolbarItems } from './sectionsLithoToolbarItems'
import { buildGeotechToolbarItems } from './sectionsGeotechToolbarItems'
import { buildTailToolbarItems } from './sectionsTailToolbarItems'

/**
 * Section-specific verb buttons for the Sections stage toolbar.
 *
 * Renders in the left zone of ``StageToolbar`` when the Sections stage is
 * active.  All state and handlers are read from the ShellContext bus via
 * ``useShell()``.
 *
 * Returns
 * -------
 * JSX.Element
 *     The toolbar verb buttons element.
 */
export default function SectionsToolbar(): JSX.Element {
  // Band-fill visibility — shared with SectionPanel via the bandFill store so
  // the Bodies-dropdown toggle and the overlay stay in sync.
  const bandsVisible = useBandFillVisible()
  // Correlation-overlay visibility — the CorrelationEdgesOverlay ribbons/lines
  // are a 2-D visualisation of the user's correlations (no link to the 3-D
  // model); this lets the user hide them to read the columns + model cleanly.
  const correlationsVisible = useCorrelationOverlayVisible()
  // Litho model-fill visibility — gates the solids-derived ModelFillOverlay (the
  // cross-section fill sampled from the built 3-D body solids) on the litho axis;
  // lets the user hide it to read the columns + contacts cleanly. (Store keeps
  // its historical formationFill name — see formationFillStore.)
  const formationFillVisible = useFormationFillVisible()
  const geotechFillVisible = useGeotechFillVisible()
  // The same overlay as ``formationFillVisible``, on the geotech axis: the
  // section fill cut out of the built 3-D GEOTECH solids. Its own switch so
  // hiding one axis's model never blanks the other's.
  const geotechModelFillVisible = useGeotechModelFillVisible()
  const lithoFillOnGeotech = useLithoFillOnGeotech()
  const boreholePreviewOn = useBoreholePreviewOn()
  // Lab-sample view toggles — the markers and their grain-size hover card draw
  // on BOTH the litho and geotech axes, so both menus below offer the pair.
  const sampleMarkersOn = useSampleMarkersOn()
  const psdPreviewOn = usePsdPreviewOn()
  const boreholesStale = useBoreholesStale()
  const {
    project,
    visibleBoreholes,
    undo: undoStack,
    sections: {
      selectedSectionId,
      sections,
      effectiveHorizontalEpsg,
      sectionModelAxis,
      setSectionModelAxis,
      handleSelectSection,
      handleCreateSection,
      handleDeleteSection,
      applyUpdatedSection,
      sectionFocusedColumn,
      correlateMode,
      enterCorrelateMode,
      exitCorrelateMode,
      suggestedTies,
      handleSuggestTies,
      handleAcceptAllTies,
      handleClearTieSuggestions,
    },
    geoModel: {
      activeGeologicalModel,
      activeLithoModel,
      // F3: geotech axis toggle needs to know whether a geotech model exists.
      activeGeotechModel,
      // Debt #266 — columns whose litho moved after their bands were made.
      staleLithoGeotechColumns,
      staleLithoGeotechColumnCount,
      handleExportModelPlaxis3d,
      lithoSuggesting,
      // Phase 2 of debt #77: bus exposes the unified Map + focus flag.
      // Derived below: hasSuggestions, bulkAnchorCount.
      ghostsByAnchor,
      focusedSuggestAnchorId,
      handleSuggestLitho,
      handleAcceptAllLithoSuggestions,
      clearLithoSuggestions,
      bulkLithoSuggesting,
      handleSuggestAllLitho,
      handleAcceptAllBulkLitho,
      clearBulkLithoGhosts,
      handleStripLithoAdmixtures,
      handleReseedLithoAdmixtures,
      handleAutoCorrelate,
      handleClearSuggestions,
      // #163c nonce bump — forces SectionsCanvas to re-list bodies after the
      // toolbar's "Delete all detected lenses" bulk delete.
      requestCorrelationEdgesRefetch,
      // Debt #92 "new tests" filter: scope the Suggest split-button's
      // "for new tests" item to anchors not yet in the active litho
      // model's contact set. Build / Dedupe / Sync moved with their
      // verbs to ``SectionsInspector`` (#97).
      lithoContacts,
      // F4 — "Subdivide all bodies" toolbar verb on the geotech axis.
      handleSubdivideAllBodies,
      // "Divide boreholes" toolbar verb — post-SAB borehole TIN-division.
      handleDivideBoreholes,
      // The active geotech model's layer rows (model-wide). Read here only for
      // the hand-edit count in the re-subdivide confirmation — the rows carry
      // ``source``, so the warning needs no extra fetch.
      geotechLayers,
      // Derived, never stored: the CPT columns whose packing bands no longer
      // sit inside the litho parent they were derived against (the engineer
      // dragged the contact since). Surfaces as a tag on the Subdivide verb —
      // the verb that re-derives them.
      columnsNeedingRederive,
      // Geotech correlation triad: accepting a packing tie moves body_id stamps
      // (requestGeotechLayersRefetch) and dirties the project (markMutated).
      requestGeotechLayersRefetch,
      markMutated,
    },
    visibleCpts,
    coordinator: {
      selectedId,
      selectedBoreholeId,
      handleExportSectionDxf,
      handleExportSectionPdf,
      // Slice 5: mutation verbs bump the mutated axis's body-identity recompute.
      requestBodyRecompute,
    },
    toasts: { toast },
  } = useShell()
  // Bare P mirrors the "Show samples" menu item (owner 2026-08-14: the hotkey
  // hides the MARKERS when they are in the way; the PSD preview stays a menu
  // toggle). The menu's own label flips too, but nobody sees that with the
  // menu closed — so the accelerator says out loud which way it went. Placed
  // AFTER the useShell destructure because it reads ``toast``; hoisting it up
  // with the other store hooks would be a temporal-dead-zone crash that no
  // type check catches.
  //
  // Both announcements carry a REPLACE KEY (owner 2026-08-15: "when i
  // repeatedly press l the toast just kind of stack on the right ... you can
  // just immediately replace it and don't need to flood the screen"), so
  // hammering either key updates one toast in place instead of stacking.
  useSampleMarkersHotkey(nowOn =>
    toast('success', sampleMarkersToastMessage(nowOn), SAMPLE_MARKERS_TOAST_KEY),
  )
  // Bare L mirrors the litho-fill item of whichever axis is open (owner
  // 2026-08-15: "a hide litho fill hotkey would be nice too, toggling quite
  // often when doing step 1"). The toast names the fill the way that axis's
  // menu does, so the announcement and the menu item agree. Same TDZ caveat as
  // the P hotkey above — it reads ``toast``, so it stays below the destructure.
  useLithoFillHotkey(sectionModelAxis, nowOn => {
    toast('success', lithoFillToastMessage(sectionModelAxis, nowOn), LITHO_FILL_TOAST_KEY)
  })
  // Bare F is the packing fill's own key (owner 2026-08-15: "Turn the fill on
  // (l this is for litho fill so this wouldn't work)"). Geotech axis only, and
  // its OWN replace key so hammering F cannot wipe the line L just wrote. Same
  // TDZ caveat as the two hotkeys above — it reads ``toast``.
  useGeotechFillHotkey(sectionModelAxis, nowOn => {
    toast('success', geotechFillToastMessage(nowOn), GEOTECH_FILL_TOAST_KEY)
  })
  // Representative-qc statistic state machine (bridge + pending choice +
  // reconciliation effects), extracted to keep this component under the god-
  // component threshold (debt #201).
  const { geotechStatistic, geotechBandsStale, pendingStatistic, handleSetGeotechStatistic } =
    useGeotechStatistic({ project, activeGeotechModel, markMutated, toast })

  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // Delete confirm modal state — replaces window.confirm() per UX rules:
  // irreversible actions require a Modal with default-focus on Cancel and a
  // button labelled with the action name (not "OK"). See docs/ux.md.
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [acceptingAllTies, setAcceptingAllTies] = useState(false)
  // "Divide boreholes" busy flag (geotech axis).
  const [dividingBoreholes, setDividingBoreholes] = useState(false)
  // "Reset manual points" — confirm before clearing ALL hand-drawn body
  // boundary overrides for the litho model (irreversible DB delete → the
  // ConfirmDialog is the only protection, per docs/ux.md).
  const [resetBoundariesConfirmOpen, setResetBoundariesConfirmOpen] = useState(false)
  const [resettingBoundaries, setResettingBoundaries] = useState(false)

  const selectedSection = sections.find(s => s.id === selectedSectionId) ?? null

  // Debt #139 — the Correlate gesture needs ≥1 litho contact visible on the
  // section to have anything clickable.  CorrelationEdgesOverlay paints no
  // hit-rects when ``contacts`` is empty, so entering the mode on a freshly-
  // drawn section silently does nothing.  Block entry at the toolbar and let
  // the section-canvas hint pill explain why.  Classification follows the
  // test (owner directive 2026-06-08): a litho contact is "on this section"
  // iff its anchor projects into the corridor — the same in-corridor gate
  // SectionsCanvas now applies at render-time (not the seeded set).
  const sectionHasLithoContacts = useMemo(() => {
    if (!selectedSection) return false
    const invIds = inCorridorInvestigationIds(selectedSection, visibleCpts, visibleBoreholes)
    return lithoContacts.some(c => invIds.has(c.cpt_id ?? c.borehole_id ?? ''))
  }, [selectedSection, lithoContacts, visibleCpts, visibleBoreholes])

  // Debt #266 — every column whose packing bands are out of date, from BOTH
  // signals: the geometric fit check (CPT-only, sees a unit that shrank) and
  // the server's provenance compare (all columns, sees a unit that grew, was
  // re-classified, or was deleted). Merged here because the engineer's action
  // is the same either way and two amber warnings about one column is the
  // alarm fatigue this feature exists to avoid.
  const staleGeotechColumns = useMemo(
    () =>
      unionStaleGeotechColumns(staleLithoGeotechColumns, columnsNeedingRederive, id => {
        const cpt = visibleCpts.find(c => c.id === id)
        if (cpt) return cpt.name
        return visibleBoreholes.find(b => b.id === id)?.name
      }),
    [staleLithoGeotechColumns, columnsNeedingRederive, visibleCpts, visibleBoreholes],
  )

  // What pressing "1 · Subdivide CPTs" will actually destroy.
  //
  // Owner ruling B (2026-08-01) gave the dialog a hand-edit count; the owner's
  // 2026-08-15 dogfeed scoped it — *"We do however get an overwrite popup on
  // cs2 while there is no subdivision there yet. Now it seems like it is
  // warning that i'll overwrite CS 1"*. Step 1 rebuilds the OPEN section's
  // columns, so the bands at risk are the ones anchored on that section's
  // members — the same membership rule the verb itself applies. No round trip:
  // ``geotechLayers`` is the model's full layer list with each row's anchor
  // and ``source``, and the corridor projection is local arithmetic.
  const subdivideScope = useMemo(() => {
    const memberIds =
      selectedSection === null
        ? null
        : inCorridorInvestigationIds(selectedSection, visibleCpts, visibleBoreholes)
    const bands = geotechBandsInScope(geotechLayers, memberIds)
    // The model-wide count feeds the STATISTIC re-run dialog, whose blast
    // radius is every section (owner 2026-08-18); the section count feeds the
    // ordinary one.
    const allBands = geotechBandsInScope(geotechLayers, null)
    return {
      bandCount: bands.length,
      handEditCount: countGeotechHandEdits(bands),
      modelBandCount: allBands.length,
      modelHandEditCount: countGeotechHandEdits(allBands),
    }
  }, [selectedSection, visibleCpts, visibleBoreholes, geotechLayers])

  // Do steps 2, 3 and 4 have anything ON SCREEN to work on?
  //
  // Owner (dogfeed 2026-08-15): *"when i switched to cs2 options 2 3 and 4 in
  // the packing pipeline where clickable this was not the case on the first
  // subdivide in cs1"*. All four steps act on the open section, so their gate
  // has to be the open section too. The three of them used to ask whether a
  // geotech MODEL exists — a question that answers correctly exactly once, on
  // the first press of all, and from then on leaves every unsubdivided section
  // offering three presses that can only no-op.
  //
  // Same reading of "does this section have bands" the re-subdivide
  // confirmation uses — ``subdivideScope`` above, no second notion. The model
  // check is belt-and-braces: ``geotechLayers`` is emptied when no geotech
  // model is active (useGeologicalModel G4), so bands imply a model, but the
  // verbs below dereference the model id and must never be reachable without
  // one.
  const sectionHasPackingBands =
    activeGeotechModel !== null && selectedSection !== null && subdivideScope.bandCount > 0

  // Sections need a projected METRIC horizontal CRS — along-distance is
  // a Euclidean distance in CRS units, so degrees (EPSG:4326) silently
  // produce garbage geometry (debt #31). Gate on the supported-CRS
  // allowlist, not merely "a CRS is set".
  const crsBlockReason = sectionCrsBlockReason(effectiveHorizontalEpsg)
  const canCreate = crsBlockReason === null

  async function handleNew(): Promise<void> {
    if (!canCreate || creating) return
    setCreating(true)
    try {
      const created = await handleCreateSection()
      // Auto-select so the canvas immediately opens the new section,
      // matching the inspector's SectionList.handleCreate behaviour
      // (both affordances trigger the same action — keep them consistent).
      if (created) handleSelectSection(created.id)
    } finally {
      setCreating(false)
    }
  }

  // Open the confirmation modal. The actual delete fires only after the
  // user clicks "Delete cross-section" inside the modal.
  function handleDelete(): void {
    if (!selectedSection || deleting) return
    setDeleteConfirmOpen(true)
  }

  async function confirmDelete(): Promise<void> {
    if (!selectedSection || deleting) return
    setDeleteConfirmOpen(false)
    setDeleting(true)
    try {
      await handleDeleteSection(selectedSection.id)
    } finally {
      setDeleting(false)
    }
  }

  // "Reset manual points" — clear every hand-drawn body boundary override for
  // the litho model, so all bodies return to their engine-computed shape.
  // Irreversible (DB delete): the ConfirmDialog gates it (default-focus Cancel,
  // action-named button). On success the correlation-edges refetch nonce is
  // bumped, which also re-runs SectionsCanvas's boundary refetch (its effect
  // deps on that nonce), so the overlay re-renders from the engine default
  // without a manual section reselect.
  const handleResetManualBoundaries = useCallback(async (): Promise<void> => {
    if (!activeLithoModel || resettingBoundaries) return
    setResetBoundariesConfirmOpen(false)
    setResettingBoundaries(true)
    log.info('sections', `resetManualBoundaries: model=${activeLithoModel.id}`)
    try {
      const result = await api.geology.resetManualBoundaries(project.id, activeLithoModel.id)
      log.success('sections', `resetManualBoundaries: cleared ${result.shapes_deleted} shape(s)`)
      // Force the canvas to re-GET body boundaries so the overlay drops the
      // now-deleted overrides and re-renders the clean engine partition.
      requestCorrelationEdgesRefetch?.()
      // Deleted boundary shapes reshape bodies — schedule the litho identity
      // recompute (slice 5).
      if (result.shapes_deleted > 0) requestBodyRecompute('litho')
      toast(
        'success',
        result.shapes_deleted > 0
          ? `Reset ${result.shapes_deleted} hand-drawn boundary${result.shapes_deleted === 1 ? '' : 's'} — bodies returned to their computed shape.`
          : 'No hand-drawn boundaries to reset.',
      )
    } catch (err) {
      log.error('sections', 'resetManualBoundaries: failed', err)
      toast('error', 'Reset manual points failed — see console.')
    } finally {
      setResettingBoundaries(false)
    }
  }, [activeLithoModel, resettingBoundaries, project.id, requestCorrelationEdgesRefetch, requestBodyRecompute, toast])

  const hasSection = selectedSection !== null
  // Axis-aware model presence: each axis uses ITS OWN active model —
  // geological / lithostratigraphic / geotechnical. Build/Seed/Dedupe/Export
  // buttons are gated on the ACTIVE model for the chosen axis. (The geotech
  // branch used to read the geological model, which left the section exports
  // enabled and silently writing the wrong level — audit 2026-08-02.)
  const isLitho = sectionModelAxis === 'lithostratigraphic'
  const isGeotech = sectionModelAxis === 'geotechnical'

  // Manual "Recompute bodies" verb (slice 5): fires the ACTIVE axis's model
  // through the shell scheduler's ref (module-ref bridge — the debounced
  // scheduler lives in useProjectBodyRecompute, mounted in App, which owns the
  // model/layer state). ``recomputeNow`` toasts its own errors (manual fires
  // do; background debounce fires stay console-only).
  const [recomputingBodies, setRecomputingBodies] = useState(false)
  const recomputeModelId = isGeotech
    ? (activeGeotechModel?.id ?? null)
    : isLitho
      ? (activeLithoModel?.id ?? null)
      : null
  const handleRecomputeBodies = useCallback(async (): Promise<void> => {
    if (recomputeModelId === null || recomputingBodies) return
    const run = sectionsBodyRecomputeCallback.current
    if (run === null) {
      // Unreachable while a project is open (the shell hook assigns the ref
      // every App render) — fail loud rather than silently doing nothing.
      log.error('sections', 'recompute-bodies: shell scheduler ref is empty')
      toast('error', 'Recompute bodies is unavailable — reopen the project.')
      return
    }
    setRecomputingBodies(true)
    try {
      await run(recomputeModelId)
    } finally {
      setRecomputingBodies(false)
    }
  }, [recomputeModelId, recomputingBodies, toast])

  const hasModel = isLitho
    ? activeLithoModel !== null
    : isGeotech
      ? activeGeotechModel !== null
      : activeGeologicalModel !== null
  // B-2 (senior-review): Build / Seed / Dedupe / Plaxis-3D are
  // GEOLOGICAL-model operations — their handlers act on
  // activeGeologicalModel regardless of axis. On the litho axis
  // hasModel reads the LITHO model, which would leave them enabled
  // and silently writing to the geological model. Gate them on the
  // geological model + the geology axis explicitly; the litho axis's
  // equivalent build flow is Suggest/accept, not these verbs.
  const geoVerbDisabled = isLitho || isGeotech || activeGeologicalModel === null
  // Names the model level in the export tooltips so the engineer can see WHICH
  // of the three levels a file will contain before clicking.
  const axisLevelLabel = isLitho ? 'lithostratigraphic' : isGeotech ? 'geotechnical' : 'geological'
  const geoVerbHint =
    isLitho || isGeotech
      ? 'Switch to the Geology axis — Build / Seed / Dedupe / Plaxis-3D act on the geological model'
      : null
  // Section-export verbs (DXF / Plaxis / PDF busy flags + handlers, the PDF
  // metadata dialog state and the D-Series items), extracted to keep this
  // component under the god-component threshold (debt #201).
  const {
    exportingDxf,
    exportingPlaxis,
    exportingPdf,
    pdfDialogOpen,
    setPdfDialogOpen,
    pdfDefaultTitle,
    handleExportDxf,
    handleExportPlaxis,
    handleExportPdf,
    dseriesExportItems,
  } = useSectionExportVerbs({
    isLitho,
    isGeotech,
    activeLithoModel,
    activeGeotechModel,
    activeGeologicalModel,
    selectedSection,
    project,
    axisLevelLabel,
    handleExportSectionDxf,
    handleExportSectionPdf,
    handleExportModelPlaxis3d,
  })
  // Litho Suggest / Accept verbs (focused-anchor derivation, ghost counts,
  // bulk anchors, the three busy flags + five handlers), extracted to keep this
  // component under the god-component threshold (debt #201).
  const {
    canSuggest,
    hasSuggestions,
    bulkAnchorCount,
    cptGhostCount,
    boreholeGhostCount,
    acceptingAll,
    acceptingAllBulk,
    bulkConfirmOpen,
    setBulkConfirmOpen,
    bulkAnchors,
    newTestAnchors,
    handleSuggest,
    handleAcceptAll,
    handleBulkSuggestConfirm,
    handleSuggestNewTests,
    handleAcceptAllBulk,
  } = useLithoSuggestVerbs({
    isLitho,
    hasSection,
    activeLithoModel,
    sectionFocusedColumn,
    selectedId,
    selectedBoreholeId,
    focusedSuggestAnchorId,
    ghostsByAnchor,
    lithoSuggesting,
    lithoContacts,
    handleSuggestLitho,
    handleAcceptAllLithoSuggestions,
    handleSuggestAllLitho,
    handleAcceptAllBulkLitho,
    selectedSectionId,
    applyUpdatedSection,
    selectedSection,
    visibleCpts,
    visibleBoreholes,
  })

  // Handler for the axis toggle — validate the target axis before
  // switching so a disabled segment can't be clicked.
  function handleAxisChange(axis: SectionModelAxis): void {
    if (axis === 'lithostratigraphic' && activeLithoModel === null) return
    // The geotech axis needs only the litho model (its source): the packing
    // pipeline's step 1, which creates the geotech model, lives ON this axis.
    if (axis === 'geotechnical' && activeGeotechModel === null && activeLithoModel === null) return
    setSectionModelAxis(axis)
  }

  // Pipeline step 3's counter. Step 4 is GATED on it (owner ruling
  // 2026-08-04): dividing boreholes off unreviewed proposals throws away the
  // evidence an accepted tie would have supplied. The count is what lets the
  // button be disabled AND say why, instead of failing with a 422 when pressed.
  const { status: tieStatus, refresh: refreshTieStatus } = useGeotechTieStatus(
    project.id,
    activeGeotechModel?.id ?? null,
    // Review MAJOR-1 (2026-08-05): the per-tie accept and delete live under
    // SectionsCanvas and never see this hook — but every one of those paths
    // refetches the geotech layers, so the refreshed array identity is the
    // shared signal that re-counts the pending ties here.
    geotechLayers,
  )

  // Model total / open section / how many sections are still dirty — the three
  // numbers every pending sentence below is phrased from (owner 2026-08-15:
  // all four steps follow the open section, and the chip still has to say the
  // model is not finished when only the neighbour is dirty).
  //
  // Declared BEFORE the gate that reads it: this is a const, so a gate above it
  // is a temporal-dead-zone ReferenceError that no type check and no unit test
  // catches until the toolbar actually renders.
  const pendingScope = useMemo(
    () =>
      summarisePendingTies({
        modelPending: tieStatus.pending,
        pendingBySection: tieStatus.pendingBySection,
        activeSectionId: selectedSectionId,
      }),
    [tieStatus.pending, tieStatus.pendingBySection, selectedSectionId],
  )

  // Step 4's gate, on the ties of the section it divides (owner ruling
  // 2026-08-15: "i'm reading divide boreholes (whole model), no that should
  // also be section scoped"). The neighbour's proposals are the neighbour's
  // problem — the whole point is finishing one section while another is still
  // under review.
  //
  // Only a LOADED count may block: an unanswered request must not disable the
  // button, or a tie-status endpoint that 404s (or a backend that predates it)
  // would lock the engineer out of dividing entirely. Where the backend sent
  // no per-section breakdown the model total is the honest fallback — better
  // to over-gate than to send a press the server will 422. The server enforces
  // the same rule regardless, so falling open costs a 422 at worst.
  const dividePending = pendingScope.sectionPending ?? pendingScope.modelPending
  const tiesBlockDivide = tieStatus.loaded && dividePending > 0

  // Pressing the pending chip (owner ask 2026-08-25: *"now i get a one pending
  // notification but i don't see any pending ties? Why don't we make that
  // clickable so it highlights the tie?"*).
  //
  // The canvas does the work — it owns the edges, the columns and the pan — and
  // hands back an outcome. Everything this has to decide is what to SAY, and
  // the one case that must never be silent is ``undrawable``: that is the state
  // the owner was staring at, a count with nothing on screen behind it.
  //
  // Reversible action, so it fires immediately with no confirmation
  // (docs/ux.md). The replace key keeps a hammered chip to ONE toast that
  // updates in place rather than a column of them.
  const handleRevealPendingTie = useCallback(() => {
    // An unregistered bridge and an unmounted panel are the same answer to the
    // engineer — "there is no section on screen" — so they take the same door.
    const outcome: PendingTieRevealOutcome = sectionsRevealPendingTieCallback.current?.() ?? {
      kind: 'unavailable',
    }
    log.debug('sections', `revealPendingTie: ${outcome.kind}`)
    switch (outcome.kind) {
      case 'undrawable':
        toast('warning', outcome.message, PENDING_TIE_TOAST_KEY)
        break
      case 'none':
        toast('warning', PENDING_TIE_NONE_HERE, PENDING_TIE_TOAST_KEY)
        break
      case 'unavailable':
        toast('warning', PENDING_TIE_NO_CANVAS, PENDING_TIE_TOAST_KEY)
        break
      case 'revealed':
        // Silent on purpose: the pan and the pulse already answered on screen,
        // and a toast on top of them would only cover the thing just revealed.
        break
    }
  }, [toast])

  // Geotech correlation triad (auto-correlate + accept) — the geotech axis's
  // equivalent of the litho Correlate caret items. Extracted to its own hook
  // because this component is long past the 500-line threshold (debt #201).
  const {
    autoCorrelating: autoCorrelatingGeotech,
    acceptingCorrelations: acceptingGeotechCorrelations,
    runAutoCorrelate: runAutoCorrelateGeotech,
    runAcceptCorrelations: runAcceptGeotechCorrelations,
  } = useGeotechCorrelationVerbs({
    projectId: project.id,
    activeGeotechModel,
    toast,
    markMutated,
    requestCorrelationEdgesRefetch,
    requestGeotechLayersRefetch,
    requestBodyRecompute,
    refreshTieStatus,
  })

  // Suggest split-button — what should the primary half do?
  //   'focused'  → run single-anchor Suggest on the focused column
  //   'all'      → fall back to bulk "Suggest all in this section" so the
  //                button isn't greyed out when nothing is focused yet
  //                (else it looks broken — Robin dogfeed 2026-05-24).
  //                Stays one click away from a useful action; the caret
  //                still offers the "Suggest for new tests" variant.
  //   'disabled' → no model / no section / no bulk anchors → genuinely
  //                nothing to do, grey it out.
  // Litho correlation review flow (auto-correlate pre-check, re-correlate
  // dialog, accept correlations), extracted to keep this component under the
  // god-component threshold (debt #201).
  const {
    autoCorrelating,
    acceptingCorrelations,
    reCorrelateConfirmOpen,
    reCorrelateAutoEdgeCount,
    handleAutoCorrelateWithCheck,
    handleReCorrelateCancel,
    handleReCorrelateSkip,
    handleReCorrelateConfirm,
    handleAcceptCorrelations,
  } = useLithoCorrelateVerbs({
    project,
    activeLithoModel,
    selectedSectionId,
    toast,
    handleAutoCorrelate,
    requestCorrelationEdgesRefetch,
    requestBodyRecompute,
  })

  // Geotech pipeline step 1 (subdivide CPTs) + its re-subdivide dialog,
  // extracted to keep this component under the god-component threshold
  // (debt #201).
  const {
    subdividingBodies,
    reSubdivideConfirmOpen,
    pressSubdivide,
    handleReSubdivideCancel,
    handleReSubdivideConfirm,
  } = useGeotechSubdivideVerbs({
    activeLithoModel,
    geotechBandsStale,
    pendingStatistic,
    columnsNeedingRederive,
    handleSubdivideAllBodies,
    refreshTieStatus,
    subdivideScope,
  })

  const suggestPrimaryMode: 'focused' | 'all' | 'disabled' = canSuggest
    ? 'focused'
    : isLitho &&
        activeLithoModel !== null &&
        hasSection &&
        bulkAnchors.length > 0
      ? 'all'
      : 'disabled'

  const undoTitle = undoStack.canUndo
    ? 'Undo the last model edit (Ctrl+Z)'
    : 'Nothing to undo'

  // Declared in render order; assembled at the bottom of this function.
  // Keeping the three axis blocks as separate consts avoids a temporal-dead-
  // zone read — each is defined before the array that spreads it.
  const headItems: ToolbarItemSpec[] = [
    // Undo — the model-edit undo stack is keyboard-wired (Ctrl+Z) but
    // otherwise invisible. This button surfaces it. Covers every undoable
    // mutation, incl. accept-litho (dogfeed 2026-05-22).
    //
    // 'medium', and the FIRST verb to give up its label: the gesture already
    // has a keyboard binding, so the button is a discoverability aid rather
    // than the primary path, and a curved arrow is the most self-explanatory
    // icon on the bar.
    {
      id: 'sections-undo',
      priority: 'medium',
      kind: 'button',
      label: 'Undo',
      overflowItems: [
        {
          label: 'Undo last model edit',
          icon: <Undo2 size={12} />,
          onClick: () => void undoStack.undo(),
          disabled: !undoStack.canUndo || undoStack.busy,
          title: undoTitle,
        },
      ],
      render: p => (
        <ToolbarButton
          icon={<Undo2 size={13} />}
          label="Undo"
          iconOnly={p === 'icon'}
          onClick={() => void undoStack.undo()}
          disabled={!undoStack.canUndo || undoStack.busy}
          title={undoTitle}
          testid="sections-undo"
        />
      ),
    },

    // The stage/axis pill — 'pinned'. Everything else on this bar changes
    // MEANING with it, so it can never fold and can never be reduced to an
    // icon; its only concession is the designed short form ("Geo | Litho |
    // Geotech" — the last segment is spelled out at every width, because
    // truncating it was the reported bug).
    {
      id: 'sections-axis-pill',
      priority: 'pinned',
      kind: 'custom',
      label: 'Section model axis',
      separatorBefore: true,
      // Three segments at px-2 plus the group's 1 px border on each side.
      // Explicit because the estimator models icon+label controls, not a
      // segmented group.
      widthPx: { full: AXIS_PILL_FULL_PX, compact: AXIS_PILL_COMPACT_PX },
      overflowItems: [],
      render: p => (
        <SectionsAxisPill
          short={p === 'compact'}
          isLitho={isLitho}
          isGeotech={isGeotech}
          activeLithoModel={activeLithoModel}
          activeGeotechModel={activeGeotechModel}
          onAxisChange={handleAxisChange}
        />
      ),
    },
  ]

  // -- Litho-axis verbs -----------------------------------------------------
  const lithoItems = buildLithoToolbarItems({
    isLitho,
    hasSection,
    activeLithoModel,
    lithoSuggesting,
    bulkLithoSuggesting,
    suggestPrimaryMode,
    bulkAnchors,
    newTestAnchors,
    bulkAnchorCount,
    hasSuggestions,
    acceptingAll,
    acceptingAllBulk,
    autoCorrelating,
    acceptingCorrelations,
    correlateMode,
    sectionHasLithoContacts,
    sectionFocusedColumn,
    bandsVisible,
    correlationsVisible,
    formationFillVisible,
    resettingBoundaries,
    sampleMarkersOn,
    psdPreviewOn,
    cptGhostCount,
    boreholeGhostCount,
    setBulkConfirmOpen,
    setResetBoundariesConfirmOpen,
    handleSuggest,
    handleSuggestNewTests,
    handleAcceptAll,
    handleAcceptAllBulk,
    handleAutoCorrelateWithCheck,
    handleAcceptCorrelations,
    clearLithoSuggestions,
    clearBulkLithoGhosts,
    handleClearSuggestions,
    handleStripLithoAdmixtures,
    handleReseedLithoAdmixtures,
    enterCorrelateMode,
    exitCorrelateMode,
  })

  // -- Geotech-axis verbs ---------------------------------------------------
  const geotechItems = buildGeotechToolbarItems({
    isGeotech,
    activeLithoModel,
    activeGeotechModel,
    selectedSectionId,
    geotechStatistic,
    geotechBandsStale,
    columnsNeedingRederive,
    subdividingBodies,
    dividingBoreholes,
    autoCorrelatingGeotech,
    acceptingGeotechCorrelations,
    sectionHasPackingBands,
    tiesBlockDivide,
    boreholesStale,
    correlateMode,
    geotechFillVisible,
    geotechModelFillVisible,
    lithoFillOnGeotech,
    boreholePreviewOn,
    correlationsVisible,
    sampleMarkersOn,
    psdPreviewOn,
    pendingScope,
    tieStatus,
    staleGeotechColumns,
    setDividingBoreholes,
    handleSetGeotechStatistic,
    pressSubdivide,
    runAutoCorrelateGeotech,
    runAcceptGeotechCorrelations,
    handleDivideBoreholes,
    handleRevealPendingTie,
    enterCorrelateMode,
    exitCorrelateMode,
  })

  // -- Verbs shared by every axis -------------------------------------------
  const tailItems = buildTailToolbarItems({
    isLitho,
    isGeotech,
    hasSection,
    hasModel,
    axisLevelLabel,
    creating,
    deleting,
    canCreate,
    crsBlockReason,
    selectedSection,
    sections,
    visibleCpts,
    visibleBoreholes,
    suggestedTies,
    acceptingAllTies,
    exportingDxf,
    exportingPlaxis,
    exportingPdf,
    geoVerbDisabled,
    geoVerbHint,
    activeGeologicalModel,
    dseriesExportItems,
    recomputingBodies,
    recomputeModelId,
    setAcceptingAllTies,
    setPdfDialogOpen,
    handleNew,
    handleDelete,
    handleExportDxf,
    handleExportPlaxis,
    handleRecomputeBodies,
    handleAcceptAllTies,
    handleSuggestTies,
    handleClearTieSuggestions,
  })

  return (
    <>
      <ResponsiveToolbarRow
        items={[...headItems, ...lithoItems, ...geotechItems, ...tailItems]}
        overflowMenuLabel="More section actions"
      />
      <SectionsToolbarDialogs
        pdfDialogOpen={pdfDialogOpen}
        pdfDefaultTitle={pdfDefaultTitle}
        exportingPdf={exportingPdf}
        onExportPdf={handleExportPdf}
        onPdfCancel={() => setPdfDialogOpen(false)}
        deleteConfirmOpen={deleteConfirmOpen}
        deleting={deleting}
        selectedSection={selectedSection}
        onDeleteCancel={() => setDeleteConfirmOpen(false)}
        onDeleteConfirm={() => void confirmDelete()}
        bulkConfirmOpen={bulkConfirmOpen}
        bulkAnchors={bulkAnchors}
        onBulkCancel={() => setBulkConfirmOpen(false)}
        onBulkConfirm={() => void handleBulkSuggestConfirm()}
        reCorrelateConfirmOpen={reCorrelateConfirmOpen}
        reCorrelateAutoEdgeCount={reCorrelateAutoEdgeCount}
        autoCorrelating={autoCorrelating}
        onReCorrelateCancel={handleReCorrelateCancel}
        onReCorrelateSkip={handleReCorrelateSkip}
        onReCorrelateConfirm={() => {
          void handleReCorrelateConfirm()
        }}
        reSubdivideConfirmOpen={reSubdivideConfirmOpen}
        subdividingBodies={subdividingBodies}
        geotechBandsStale={geotechBandsStale}
        subdivideScope={subdivideScope}
        geotechStatistic={geotechStatistic}
        onReSubdivideCancel={handleReSubdivideCancel}
        onReSubdivideConfirm={handleReSubdivideConfirm}
        resetBoundariesConfirmOpen={resetBoundariesConfirmOpen}
        resettingBoundaries={resettingBoundaries}
        onResetBoundariesCancel={() => setResetBoundariesConfirmOpen(false)}
        onResetBoundariesConfirm={() => {
          void handleResetManualBoundaries()
        }}
      />
    </>
  )
}
