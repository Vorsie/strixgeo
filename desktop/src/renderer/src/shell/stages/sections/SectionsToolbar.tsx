// Sections stage toolbar — section-specific verbs wired from the ShellContext bus.
//
// Collects the section actions (Build model, Auto-populate, Dedupe, Export DXF,
// Export Plaxis 3D, New cross-section, Delete section) into one place for the
// Sections stage.  All handlers are sourced from useShell() — no props accepted
// (matches the StageDescriptor.ToolbarComponent contract).

import { useCallback, useMemo, useState } from 'react'
import { Trash2, FileOutput, FileText, Cpu, Sparkles, Eraser, Plus, GitMerge, Undo2, FlaskConical, Zap, CheckCheck, Layers, PaintBucket, Network, Eye, EyeOff, SplitSquareVertical } from 'lucide-react'
import ReportMetadataDialog from '../../../components/sections/ReportMetadataDialog'
import ReCorrelateConfirmDialog from '../../../components/ReCorrelateConfirmDialog'
import ReSubdivideConfirmDialog from '../../../components/ReSubdivideConfirmDialog'
import ConfirmDialog from '../../../components/ui/ConfirmDialog'

import { api } from '../../../api/client'
import { useShell } from '../../ShellContext'
import { ToolbarButton, ToolbarDropdown, PrimaryToolbarButton, SplitToolbarButton } from '../../ToolbarPrimitives'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'
import { sectionCrsBlockReason } from '../../../utils/horizontalCrs'
import { investigationsOnSection } from '../../../utils/sectionProjection'
import { filterAnchorsWithNoLithoContacts } from '../../../utils/newTestFilter'
import { inCorridorInvestigationIds } from '../../../utils/sectionClassification'
import type { SectionModelAxis } from '../../../hooks/useSections'
import { log } from '../../../utils/log'
import { toggleBandFill, useBandFillVisible } from '../../../utils/bandFillStore'
import {
  toggleCorrelationOverlay,
  useCorrelationOverlayVisible,
} from '../../../utils/correlationOverlayStore'
import { toggleFormationFill, useFormationFillVisible } from '../../../utils/formationFillStore'
import { toggleGeotechFill, useGeotechFillVisible } from '../../../utils/geotechFillStore'
import {
  toggleLithoFillOnGeotech,
  useLithoFillOnGeotech,
} from '../../../utils/lithoFillOnGeotechStore'
import {
  toggleBoreholePreviewOn,
  useBoreholePreviewOn,
} from '../../../utils/boreholePreviewOnStore'
import { useBoreholesStale } from '../../../utils/boreholesStaleStore'
import { countGeotechHandEdits } from '../../../utils/geotechHandEdits'
import { useGeotechCorrelationVerbs } from './useGeotechCorrelationVerbs'
import { useGeotechTieStatus } from './useGeotechTieStatus'

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
  const lithoFillOnGeotech = useLithoFillOnGeotech()
  const boreholePreviewOn = useBoreholePreviewOn()
  const boreholesStale = useBoreholesStale()
  // The representative-qc statistic (rulings 7+8). The server answer is held
  // locally per model until the next refreshModels naturally refreshes the
  // model row; staleness is DERIVED (classified_with != representative) and
  // never stored. Ruling 8: changing the choice re-derives NOTHING - the tag
  // on step 1 is how the debt surfaces.
  const [statisticState, setStatisticState] = useState<{
    modelId: string
    statistic: string
    classifiedWith: string | null
  } | null>(null)
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
    },
    toasts: { toast },
  } = useShell()
  const geotechStatistic =
    (statisticState?.modelId === activeGeotechModel?.id ? statisticState?.statistic : undefined) ??
    activeGeotechModel?.representative_statistic ??
    'median'
  const geotechClassifiedWith =
    statisticState !== null && statisticState.modelId === activeGeotechModel?.id
      ? statisticState.classifiedWith
      : (activeGeotechModel?.classified_with_statistic ?? null)
  const geotechBandsStale =
    geotechClassifiedWith !== null && geotechClassifiedWith !== geotechStatistic
  const handleSetGeotechStatistic = useCallback(
    (statistic: 'median' | 'arithmetic' | 'harmonic' | 'geometric'): void => {
      if (!project || !activeGeotechModel) return
      void api.geology
        .setGeotechStatistic(project.id, activeGeotechModel.id, statistic)
        .then(result => {
          setStatisticState({
            modelId: activeGeotechModel.id,
            statistic: result.representative_statistic,
            classifiedWith: result.classified_with_statistic,
          })
          markMutated()
          toast(
            'success',
            result.bands_stale
              ? `Representative statistic set to ${statistic} — press "1 · Subdivide CPTs" to re-classify the bands under it.`
              : `Representative statistic set to ${statistic}.`,
          )
        })
        .catch((err: unknown) => {
          toast('error', err instanceof Error ? err.message : 'Could not set the statistic.')
        })
    },
    [project, activeGeotechModel, markMutated, toast],
  )

  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // Delete confirm modal state — replaces window.confirm() per UX rules:
  // irreversible actions require a Modal with default-focus on Cancel and a
  // button labelled with the action name (not "OK"). See docs/ux.md.
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [exportingPlaxis, setExportingPlaxis] = useState(false)
  const [exportingDxf, setExportingDxf] = useState(false)
  const [acceptingAll, setAcceptingAll] = useState(false)
  const [acceptingAllTies, setAcceptingAllTies] = useState(false)
  // Bulk-suggest (debt #73 / Phase 3) — confirmation modal + accept-all state.
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false)
  const [acceptingAllBulk, setAcceptingAllBulk] = useState(false)
  const [autoCorrelating, setAutoCorrelating] = useState(false)
  const [acceptingCorrelations, setAcceptingCorrelations] = useState(false)
  // Re-correlate dialog (Slice 4 Half-A): shown when the user clicks
  // Auto-correlate and source='auto' edges already exist.
  const [reCorrelateConfirmOpen, setReCorrelateConfirmOpen] = useState(false)
  const [reCorrelateAutoEdgeCount, setReCorrelateAutoEdgeCount] = useState(0)
  // F4 — "Subdivide all bodies" busy flag (geotech axis).
  const [subdividingBodies, setSubdividingBodies] = useState(false)
  // "Divide boreholes" busy flag (geotech axis).
  const [dividingBoreholes, setDividingBoreholes] = useState(false)
  // C1 (connecting-geotech-units §7) — confirm before a RE-subdivide, which
  // wipes + regenerates all geotech packing connections (manual ones lost).
  const [reSubdivideConfirmOpen, setReSubdivideConfirmOpen] = useState(false)
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

  // Owner ruling B (2026-08-01) — "Subdivide all bodies" rebuilds every packing
  // band, so it destroys every band the engineer split or merged by hand. The
  // confirm dialog has to name how many BEFORE it opens; no round trip is
  // needed because ``geotechLayers`` is already the active geotech model's
  // full layer list, model-wide, with each row's ``source``.
  const geotechHandEditCount = useMemo(
    () => countGeotechHandEdits(geotechLayers),
    [geotechLayers],
  )

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

  // Re-correlate flow (Slice 4 Half-A):
  //   1. GET the model's correlation edges.
  //   2. Count source='auto' edges.
  //   3. If 0 → fire handleAutoCorrelate immediately (no dialog, first-time users).
  //   4. If >0 → open the ReCorrelateConfirmDialog.
  async function handleAutoCorrelateWithCheck(): Promise<void> {
    if (!project || !activeLithoModel) return
    log.info('sections', 'autoCorrelate check start')
    setAutoCorrelating(true)
    let openedDialog = false
    try {
      // Section-scoped (debt #3): count only THIS section's auto edges, not the
      // whole model's — so re-correlating section A doesn't report section B's
      // suggestions (the confusing "57 edges but I didn't correlate here" bug).
      const edges = await api.geology.listContactCorrelations(
        project.id,
        activeLithoModel.id,
        selectedSectionId,
      )
      // Count only UNAPPROVED auto suggestions — the edges re-correlate would
      // actually delete. Accepted auto-correlations (source='auto' but
      // user_approved=true) are committed and survive a re-run, so warning about
      // them pops a spurious "overwrite?" dialog on a section the user already
      // accepted / never suggested on (dogfeed 2026-06-08).
      const autoCount = edges.filter(
        (e: { source: string; user_approved?: boolean }) =>
          e.source === 'auto' && !e.user_approved,
      ).length
      if (autoCount === 0) {
        // No pending auto suggestions — fire immediately (no dialog).
        // Pass the section so adjacency follows its column order, not map-plane RNG.
        await handleAutoCorrelate(selectedSectionId)
      } else {
        // Existing auto edges found — ask the user what to do.
        // autoCorrelating stays true while the dialog is open so the button
        // remains disabled; the dialog close handlers clear it.
        setReCorrelateAutoEdgeCount(autoCount)
        setReCorrelateConfirmOpen(true)
        openedDialog = true
      }
    } catch (err) {
      log.error('sections', 'autoCorrelate pre-check failed', err)
      toast('error', 'Auto-correlate pre-check failed — see console.')
    } finally {
      // Clear the busy state only when we did NOT open the dialog.
      // The dialog close handlers (cancel/skip/reCorrelate) own the cleanup
      // when openedDialog is true.
      if (!openedDialog) setAutoCorrelating(false)
    }
  }

  // C1 (connecting-geotech-units §7) — run the actual subdivide. Extracted
  // from the button onClick so both the first-ever run and the confirmed
  // re-run share one code path.
  function runSubdivideAllBodies(): void {
    setSubdividingBodies(true)
    // Pipeline STEP 1 (owner ruling 2026-08-04): subdivide the CPTs into
    // packing bands and propose NOTHING. Auto-correlate is the engineer's next
    // press, so the machine's ties arrive as suggestions he reviews rather than
    // as accepted work he never sanctioned.
    void handleSubdivideAllBodies({ deriveEdges: false }).finally(() => {
      setSubdividingBodies(false)
      // A rebuild re-anchors accepted ties and can flag some of them, so the
      // counts step 4 gates on have moved even though nothing was proposed.
      void refreshTieStatus()
    })
  }

  function handleReSubdivideCancel(): void {
    setReSubdivideConfirmOpen(false)
  }

  function handleReSubdivideConfirm(): void {
    setReSubdivideConfirmOpen(false)
    runSubdivideAllBodies()
  }

  function handleReCorrelateCancel(): void {
    setReCorrelateConfirmOpen(false)
    setAutoCorrelating(false)
  }

  function handleReCorrelateSkip(): void {
    setReCorrelateConfirmOpen(false)
    setAutoCorrelating(false)
  }

  async function handleReCorrelateConfirm(): Promise<void> {
    if (!project || !activeLithoModel) return
    setReCorrelateConfirmOpen(false)
    log.info(
      'sections',
      `reCorrelate: deleting ${reCorrelateAutoEdgeCount} auto edge(s) then re-running`,
    )
    try {
      // Section-scoped delete (debt #3): clear only THIS section's auto edges,
      // never a neighbouring section's (the cross-section data-loss bug).
      const del = await api.geology.deleteAutoCorrelations(
        project.id,
        activeLithoModel.id,
        selectedSectionId,
      )
      toast(
        'success',
        `Cleared ${del.deleted} auto edge${del.deleted === 1 ? '' : 's'}; re-running…`,
      )
      await handleAutoCorrelate(selectedSectionId)
    } catch (err) {
      log.error('sections', 'reCorrelate failed', err)
      toast('error', 'Re-correlate failed — see console.')
    } finally {
      setAutoCorrelating(false)
    }
  }

  // Accept correlations (#133 Task 19): approve all unapproved contact-level
  // correlation edges in the active section, commit lens bodies, recompute
  // ordinals.  Scoped to the active section so only the engineer's current
  // working section is affected.  SectionsCanvas refreshes contact edges on
  // the next axis / section switch; contact edges are also re-fetched
  // automatically when the section re-mounts.
  const handleAcceptCorrelations = useCallback(async (): Promise<void> => {
    if (!activeLithoModel || !selectedSectionId || acceptingCorrelations) return
    log.info('sections', `acceptCorrelations: section=${selectedSectionId} model=${activeLithoModel.id}`)
    setAcceptingCorrelations(true)
    try {
      const result = await api.geology.acceptContactCorrelations(
        project.id,
        activeLithoModel.id,
        selectedSectionId,
      )
      // The toast only reports the accept count.  Engineer runs
      // "Detect lenses" separately when they actually want lens rows
      // materialised (explicit-detect switch, 2026-05-31).
      log.success(
        'sections',
        `acceptCorrelations: ${result.edges_accepted} accepted`,
      )
      // The edges flipped to approved server-side; force the canvas to re-GET
      // them so they render as solid ribbons instead of stale dashed
      // suggestions (the canvas's edge state is otherwise only refreshed on a
      // section reselect or auto-correlate). Without this the user sees the
      // suggestion unchanged even though the accept succeeded.
      requestCorrelationEdgesRefetch?.()
      toast(
        'success',
        `Accepted ${result.edges_accepted} correlation${result.edges_accepted === 1 ? '' : 's'}.`,
      )
    } catch (err) {
      log.error('sections', 'acceptCorrelations: failed', err)
      toast('error', 'Accept failed — try again.')
    } finally {
      setAcceptingCorrelations(false)
    }
  }, [
    activeLithoModel,
    selectedSectionId,
    acceptingCorrelations,
    project.id,
    toast,
    requestCorrelationEdgesRefetch,
  ])

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
  }, [activeLithoModel, resettingBoundaries, project.id, requestCorrelationEdgesRefetch, toast])

  /**
   * The model whose contacts a section export must contain.
   *
   * One selector for both export verbs so DXF and PDF cannot disagree about
   * which model level the engineer is looking at.
   *
   * Returns
   * -------
   * GeologicalModelResponse | null
   *     The active model for the current axis, or null when that level has no
   *     active model (the export items are disabled in that case).
   */
  function axisModelForExport(): typeof activeGeologicalModel {
    if (isLitho) return activeLithoModel
    if (isGeotech) return activeGeotechModel
    return activeGeologicalModel
  }

  async function handleExportDxf(): Promise<void> {
    // Axis-aware: export the model level the section is CURRENTLY showing.
    // The geotech branch used to fall through to the geological model, so an
    // engineer on the NAD axis silently got a geological DXF (audit
    // 2026-08-02). The snapshot builder is kind-agnostic — it takes a
    // model_id — so routing the id is the whole fix.
    const axisModel = axisModelForExport()
    if (!selectedSection || !axisModel || exportingDxf) return
    setExportingDxf(true)
    try {
      await handleExportSectionDxf(
        project.id,
        selectedSection.id,
        selectedSection.name,
        axisModel.id,
      )
    } finally {
      setExportingDxf(false)
    }
  }

  async function handleExportPlaxis(): Promise<void> {
    if (!activeGeologicalModel || exportingPlaxis) return
    setExportingPlaxis(true)
    try {
      await handleExportModelPlaxis3d()
    } finally {
      setExportingPlaxis(false)
    }
  }

  // Debt #52 slice 1: PDF metadata dialog + handler. The Export
  // dropdown's "Section PDF" item opens this dialog (title / author /
  // notes); on Generate, the App-level handleExportSectionPdf owns
  // the save-dialog + file-write flow.
  const [pdfDialogOpen, setPdfDialogOpen] = useState(false)
  const [exportingPdf, setExportingPdf] = useState(false)
  const pdfDefaultTitle = useMemo(
    () => (selectedSection ? `Cross-section: ${selectedSection.name}` : 'Cross-section'),
    [selectedSection],
  )
  async function handleExportPdf(metadata: {
    title: string
    author: string
    notes: string
  }): Promise<void> {
    const axisModel = axisModelForExport()
    if (!selectedSection || !axisModel || exportingPdf) return
    setExportingPdf(true)
    try {
      await handleExportSectionPdf(
        project.id,
        selectedSection.id,
        selectedSection.name,
        axisModel.id,
        metadata,
      )
      setPdfDialogOpen(false)
    } finally {
      setExportingPdf(false)
    }
  }

  const hasSection = selectedSection !== null
  // Axis-aware model presence: each axis uses ITS OWN active model —
  // geological / lithostratigraphic / geotechnical. Build/Seed/Dedupe/Export
  // buttons are gated on the ACTIVE model for the chosen axis. (The geotech
  // branch used to read the geological model, which left the section exports
  // enabled and silently writing the wrong level — audit 2026-08-02.)
  const isLitho = sectionModelAxis === 'lithostratigraphic'
  const isGeotech = sectionModelAxis === 'geotechnical'

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
  // Suggest litho — fetches Robertson-2015/borehole segmenter suggestions
  // for the focused column in the active section. On the litho axis the
  // source is the section-local focused column (right-click → Focus in the
  // section canvas), NOT the global coordinator selection which is only set
  // by map/data-stage clicks. This is the workflow: right-click a column in
  // the section to focus it, then click "Suggest litho" in the toolbar.
  const focusedAnchorKind: 'cpt' | 'borehole' | null = isLitho
    ? (sectionFocusedColumn?.kind ?? null)
    : selectedId
      ? 'cpt'
      : selectedBoreholeId
        ? 'borehole'
        : null
  const focusedAnchorId: string | null = isLitho
    ? (sectionFocusedColumn?.id ?? null)
    : (selectedId ?? selectedBoreholeId ?? null)
  const canSuggest = isLitho && activeLithoModel !== null && hasSection && focusedAnchorId !== null
  // Phase 2 of debt #77: derive "has focused suggestions" from the
  // unified Map. True when a focused anchor is set AND its entry has
  // at least one suggestion (segmenter returned ≥1 layer).
  const hasSuggestions =
    focusedSuggestAnchorId !== null &&
    (ghostsByAnchor.get(focusedSuggestAnchorId)?.suggestions.length ?? 0) > 0
  // Bulk anchor count = Map size minus the focused entry. Drives the
  // "Accept all (N bulk)" button's enable state + label.
  const bulkAnchorCount =
    ghostsByAnchor.size -
    (focusedSuggestAnchorId !== null && ghostsByAnchor.has(focusedSuggestAnchorId)
      ? 1
      : 0)

  // Ghost-suggestion counts by anchor kind — drive the Admixtures
  // dropdown's per-scope enable state (dogfeed 2026-05-22).
  const cptGhostCount = useMemo(
    () =>
      Array.from(ghostsByAnchor.values()).filter(
        g => g.kind === 'cpt' && g.suggestions.length > 0,
      ).length,
    [ghostsByAnchor],
  )
  const boreholeGhostCount = useMemo(
    () =>
      Array.from(ghostsByAnchor.values()).filter(
        g => g.kind === 'borehole' && g.suggestions.length > 0,
      ).length,
    [ghostsByAnchor],
  )

  async function handleSuggest(): Promise<void> {
    if (!canSuggest || lithoSuggesting || !focusedAnchorKind || !focusedAnchorId) return
    await handleSuggestLitho(focusedAnchorKind, focusedAnchorId)
  }

  // Accept all non-rejected litho suggestion layers in one bulk call.
  // Threads the section id + applyUpdatedSection so the explicit-content
  // filter includes the seeded contacts immediately (#57 invariant).
  async function handleAcceptAll(): Promise<void> {
    if (!hasSuggestions || acceptingAll) return
    setAcceptingAll(true)
    try {
      await handleAcceptAllLithoSuggestions(
        selectedSectionId ?? null,
        applyUpdatedSection,
      )
    } finally {
      setAcceptingAll(false)
    }
  }

  // Bulk-suggest (debt #73 / Phase 3) — derive the anchors list from
  // investigations that ACTUALLY land on this section (within its
  // span + projection_buffer_m), minus the section's exclusion sets.
  // Skips anchors with no elevation (the ghost overlay needs surface Z
  // to position layers). On click the confirmation dialog has already
  // fired; this kicks off the fan-out.
  //
  // Bug history: earlier this iterated all visible project CPTs +
  // boreholes filtered only by the exclusion sets, so a section with
  // 8 in-corridor tests reported "will run for 68 investigations" —
  // the project's full count, not the section's. Route through
  // ``investigationsOnSection`` the same way SectionOverlays and
  // useSectionData do.
  const bulkAnchors = useMemo(() => {
    if (!selectedSection) return [] as {
      kind: 'cpt' | 'borehole'
      id: string
      surfaceElevationM: number | null
    }[]
    const excludedCptIds = new Set(selectedSection.excluded_cpt_ids ?? [])
    const excludedBhIds = new Set(selectedSection.excluded_borehole_ids ?? [])
    const out: {
      kind: 'cpt' | 'borehole'
      id: string
      surfaceElevationM: number | null
    }[] = []
    for (const p of investigationsOnSection(selectedSection, visibleCpts, excludedCptIds)) {
      if (p.item.elevation_m == null) continue
      out.push({ kind: 'cpt', id: p.item.id, surfaceElevationM: p.item.elevation_m })
    }
    for (const p of investigationsOnSection(selectedSection, visibleBoreholes, excludedBhIds)) {
      if (p.item.elevation_m == null) continue
      out.push({ kind: 'borehole', id: p.item.id, surfaceElevationM: p.item.elevation_m })
    }
    return out
  }, [selectedSection, visibleCpts, visibleBoreholes])

  async function handleBulkSuggestConfirm(): Promise<void> {
    setBulkConfirmOpen(false)
    if (bulkAnchors.length === 0) return
    await handleSuggestAllLitho(bulkAnchors)
  }

  // Debt #92: "Suggest for new tests" — same fan-out as "Suggest all"
  // but scoped to anchors that have ZERO contacts in the active litho
  // model. Lets the engineer add new investigations to an already-
  // accepted project without re-running the segmenter on every
  // already-handled CPT/borehole.
  const newTestAnchors = useMemo(() => {
    if (!activeLithoModel) return [] as typeof bulkAnchors
    return filterAnchorsWithNoLithoContacts(bulkAnchors, lithoContacts)
  }, [bulkAnchors, lithoContacts, activeLithoModel])

  async function handleSuggestNewTests(): Promise<void> {
    // Defensive guard — button is disabled at zero count (per ux-review
    // recommendation 2026-05-21: disabled+tooltip beats stay-and-toast
    // because the user sees the empty state at a glance, not after a
    // wasted click).
    if (newTestAnchors.length === 0) return
    await handleSuggestAllLitho(newTestAnchors)
  }

  async function handleAcceptAllBulk(): Promise<void> {
    if (bulkAnchorCount === 0 || acceptingAllBulk) return
    setAcceptingAllBulk(true)
    try {
      await handleAcceptAllBulkLitho(
        selectedSectionId ?? null,
        applyUpdatedSection,
      )
    } finally {
      setAcceptingAllBulk(false)
    }
  }

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

  // Step 4's gate. Only a LOADED count may block: an unanswered request must
  // not disable the button, or a tie-status endpoint that 404s (or a backend
  // that predates it) would lock the engineer out of dividing entirely. The
  // server enforces the same rule regardless, so falling open here costs a 422
  // at worst and never a dead button.
  const tiesBlockDivide = tieStatus.loaded && tieStatus.pending > 0

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
  const suggestPrimaryMode: 'focused' | 'all' | 'disabled' = canSuggest
    ? 'focused'
    : isLitho &&
        activeLithoModel !== null &&
        hasSection &&
        bulkAnchors.length > 0
      ? 'all'
      : 'disabled'

  return (
    <div className="flex items-center gap-1">
      {/* Undo — the model-edit undo stack is keyboard-wired (Ctrl+Z)
          but otherwise invisible. This button surfaces it. Covers every
          undoable mutation, incl. accept-litho (dogfeed 2026-05-22). */}
      <ToolbarButton
        icon={<Undo2 size={13} />}
        label="Undo"
        onClick={() => void undoStack.undo()}
        disabled={!undoStack.canUndo || undoStack.busy}
        title={
          undoStack.canUndo
            ? 'Undo the last model edit (Ctrl+Z)'
            : 'Nothing to undo'
        }
        data-testid="sections-undo"
      />
      <div className="w-px h-4 bg-border-subtle mx-0.5" aria-hidden="true" />

      {/* Geology ↔ Lithology segmented toggle (slice 2, #55).
          Disabled on the litho segment when no litho model exists yet.
          Reads/writes sectionModelAxis from the sections slice. Uses
          border-default + surface-card / accent semantic tokens only.

          WHY the span wrapper on the disabled Litho button:
          Chromium/Electron does not fire mouse events (including hover)
          on `disabled` elements, so a `title` attribute on the button
          itself is never surfaced to the user — they see only the
          not-allowed cursor with no guidance. Wrapping in a non-disabled
          <span role="presentation"> lets the browser attach the tooltip
          to the span instead, restoring the expected UX. The span is
          purely presentational (role="presentation", no tabIndex) so it
          does not break the radiogroup/radio semantics or keyboard nav. */}
      <div
        role="group"
        aria-label="Section model axis"
        className="flex items-center rounded border border-border-default overflow-hidden text-xs"
      >
        <button
          type="button"
          role="radio"
          aria-checked={!isLitho && !isGeotech}
          onClick={() => handleAxisChange('geological')}
          className={[
            'px-2 py-1 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            !isLitho && !isGeotech
              ? 'bg-accent text-text-on-accent'
              : 'bg-surface-card text-text-secondary hover:text-text-primary',
          ].join(' ')}
          title="Edit the geological model contacts on this section"
        >
          Geology
        </button>
        {/* Span wrapper surfaces the tooltip on hover when the button is
            disabled — Chromium suppresses mouse events (incl. title) on
            disabled elements.  role="presentation" keeps this invisible
            to screen readers; the button's own aria-disabled conveys state. */}
        <span
          role="presentation"
          title={
            activeLithoModel === null
              ? 'Create a lithostratigraphic model in the Lithology stage first'
              : undefined
          }
        >
          <button
            type="button"
            role="radio"
            aria-checked={isLitho}
            disabled={activeLithoModel === null}
            onClick={() => handleAxisChange('lithostratigraphic')}
            className={[
              'px-2 py-1 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              isLitho
                ? 'bg-accent text-text-on-accent'
                : activeLithoModel === null
                  ? 'bg-surface-card text-text-muted cursor-not-allowed'
                  : 'bg-surface-card text-text-secondary hover:text-text-primary',
            ].join(' ')}
            title={
              activeLithoModel !== null
                ? 'Edit the lithostratigraphic model contacts on this section'
                : undefined
            }
          >
            Litho
          </button>
        </span>
        {/* Geotech segment — enabled when a geotech model exists OR a litho
            model does. The litho model is the real prerequisite: the packing
            pipeline's "1 · Subdivide CPTs" (which CREATES the geotech model)
            lives on this axis, so gating the axis on the geotech model would
            deadlock every clean-slate run. Same span-wrapper pattern as
            Litho: Chromium suppresses title on disabled elements, so the
            tooltip rides the presentational span. */}
        <span
          role="presentation"
          title={
            activeGeotechModel === null && activeLithoModel === null
              ? 'Create a lithostratigraphic model first — packing subdivides litho bodies'
              : undefined
          }
        >
          <button
            type="button"
            role="radio"
            aria-checked={isGeotech}
            disabled={activeGeotechModel === null && activeLithoModel === null}
            onClick={() => handleAxisChange('geotechnical')}
            data-testid="axis-geotech"
            className={[
              'px-2 py-1 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              isGeotech
                ? 'bg-accent text-text-on-accent'
                : activeGeotechModel === null && activeLithoModel === null
                  ? 'bg-surface-card text-text-muted cursor-not-allowed'
                  : 'bg-surface-card text-text-secondary hover:text-text-primary',
            ].join(' ')}
            title={
              activeGeotechModel !== null
                ? 'View geotechnical subdivision (NAD packing classes) on this section'
                : activeLithoModel !== null
                  ? 'No geotech model yet — “Packing pipeline → 1 · Subdivide CPTs” creates it'
                  : undefined
            }
          >
            Geotech
          </button>
        </span>
      </div>

      {/* Inline hint — shown only when no litho model exists so the user
          understands why the Litho segment is disabled without hovering.
          Disappears as soon as a model exists (no permanent toolbar weight —
          debt #23 toolbar crowding).  text-text-muted is a verified semantic
          token (defined in index.css as --color-text-muted, used in
          SectionsInspector, GeologyInspector, EmptyState, etc.). */}
      {activeLithoModel === null && (
        <p className="text-xs text-text-muted">
          No lithostratigraphic model — create one in the Lithology stage.
        </p>
      )}

      {/* Separator */}
      <div className="w-px h-4 bg-border-subtle mx-0.5" aria-hidden="true" />

      {/* Suggest split-button (debt #97). Primary action = single-anchor
          Suggest litho on the focused column; caret menu items = the
          bulk variants (all in section / for new tests). Collapses the
          previous Suggest×3 widgets into one toolbar slot — the most
          common verb stays one click away, the variants are one
          additional click. Pending-state pills (Accept all / Clear)
          stay as transient widgets that only render while ghosts
          exist. */}
      {isLitho && (
        <>
          <SplitToolbarButton
            icon={<Sparkles size={13} />}
            label={
              lithoSuggesting || bulkLithoSuggesting
                ? 'Suggesting…'
                : suggestPrimaryMode === 'all'
                  ? `Suggest all${bulkAnchors.length > 0 ? ` (${bulkAnchors.length})` : ''}`
                  : 'Suggest'
            }
            onClick={
              suggestPrimaryMode === 'all'
                ? () => setBulkConfirmOpen(true)
                : () => void handleSuggest()
            }
            disabled={
              suggestPrimaryMode === 'disabled' ||
              lithoSuggesting ||
              bulkLithoSuggesting
            }
            busy={lithoSuggesting || bulkLithoSuggesting}
            title={
              !activeLithoModel
                ? 'Create a lithostratigraphic model first'
                : !hasSection
                  ? 'Open a cross-section to use Suggest'
                  : lithoSuggesting
                    ? 'Fetching suggestions…'
                    : suggestPrimaryMode === 'all'
                      ? `Right-click a column to focus one, or click to suggest layers for every investigation in this section (${bulkAnchors.length})`
                      : suggestPrimaryMode === 'disabled'
                        ? 'Right-click a column in the section to focus a CPT or borehole, then Suggest'
                        : `Suggest lithostratigraphic layers for ${sectionFocusedColumn?.name ?? 'the focused investigation'}`
            }
            testid="litho-suggest"
            items={[
              {
                label: `Suggest all in this section${
                  bulkAnchors.length > 0 ? ` (${bulkAnchors.length})` : ''
                }`,
                icon: <Sparkles size={12} />,
                onClick: () => setBulkConfirmOpen(true),
                disabled:
                  !activeLithoModel ||
                  !hasSection ||
                  bulkLithoSuggesting ||
                  lithoSuggesting,
                title:
                  !activeLithoModel
                    ? 'Create a lithostratigraphic model first'
                    : !hasSection
                      ? 'Open a cross-section first'
                      : bulkLithoSuggesting
                        ? 'Running segmenter on every investigation in this section…'
                        : 'Suggest lithostratigraphic layers for every investigation in this section at once',
                testid: 'litho-suggest-all',
              },
              {
                label: activeLithoModel
                  ? `Suggest for new tests (${newTestAnchors.length})`
                  : 'Suggest for new tests',
                icon: <Sparkles size={12} />,
                onClick: () => void handleSuggestNewTests(),
                disabled:
                  !activeLithoModel ||
                  bulkLithoSuggesting ||
                  lithoSuggesting ||
                  newTestAnchors.length === 0,
                title:
                  !activeLithoModel
                    ? 'Create a lithostratigraphic model first'
                    : bulkLithoSuggesting
                      ? 'Running segmenter…'
                      : newTestAnchors.length === 0
                        ? 'All visible investigations already have litho contacts — import new tests to use this'
                        : `Suggest layers for the ${newTestAnchors.length} investigation${newTestAnchors.length === 1 ? '' : 's'} with no litho contacts yet`,
                testid: 'litho-suggest-new-tests',
              },
            ]}
          />
          {hasSuggestions && (
            <>
              {/* Accept all pending (non-rejected) layers in one bulk call. */}
              <ToolbarButton
                icon={<Sparkles size={13} />}
                label={acceptingAll ? 'Accepting…' : 'Accept all'}
                onClick={() => void handleAcceptAll()}
                disabled={acceptingAll}
                busy={acceptingAll}
                testid="litho-accept-all"
                title={
                  acceptingAll
                    ? 'Committing all suggestion layers…'
                    : 'Accept all non-rejected suggestion layers as lithostratigraphic contacts'
                }
              />
              <ToolbarButton
                icon={<Eraser size={13} />}
                label="Clear"
                onClick={clearLithoSuggestions}
                title="Dismiss the current litho suggestion overlay"
              />
            </>
          )}
          {bulkAnchorCount > 0 && (
            <>
              <ToolbarButton
                icon={<Sparkles size={13} />}
                label={acceptingAllBulk ? 'Accepting…' : 'Accept all (bulk)'}
                onClick={() => void handleAcceptAllBulk()}
                disabled={acceptingAllBulk}
                busy={acceptingAllBulk}
                testid="litho-accept-all-bulk"
                title={
                  acceptingAllBulk
                    ? 'Committing all bulk suggestion layers…'
                    : `Accept every non-rejected suggestion across all ${bulkAnchorCount} bulk-ghost investigation${bulkAnchorCount === 1 ? '' : 's'}`
                }
              />
              <ToolbarButton
                icon={<Eraser size={13} />}
                label="Clear bulk"
                onClick={clearBulkLithoGhosts}
                title="Dismiss the bulk-suggest ghost overlays for every investigation"
              />
            </>
          )}
          {/* Correlation triad collapsed into a SplitToolbarButton
              (#141 dogfeed 2026-05-27).  Primary verb = Correlate mode
              toggle (single click to enter/exit — preserves the existing
              ergonomics CT4/CT5 pin).  Caret items = Auto-correlate +
              Accept correlations.  Three buttons → one toolbar slot.
              The mode-active affordance (amber tint when correlateMode
              is on) stays on the primary half so the user always sees
              "you're in correlate mode" without opening the menu. */}
          <SplitToolbarButton
            icon={<GitMerge size={13} />}
            label={correlateMode ? 'Correlate · click 2 bands' : 'Correlate'}
            onClick={() => (correlateMode ? exitCorrelateMode() : enterCorrelateMode())}
            // While correlate mode is on, keep the primary clickable so
            // the user can exit even with 0 contacts on the section
            // (debt #139 CT8); otherwise the only escape is Esc, which
            // isn't discoverable.
            disabled={
              !activeLithoModel
              || !hasSection
              || (!correlateMode && !sectionHasLithoContacts)
            }
            title={
              !activeLithoModel
                ? 'Create a lithostratigraphic model first'
                : !hasSection
                  ? 'Open a cross-section to correlate units'
                  : !correlateMode && !sectionHasLithoContacts
                    ? 'Accept litho suggestions to enable correlation — 0 accepted contacts on this section'
                    : correlateMode
                      ? 'Exit correlate mode (Esc)'
                      : 'Enter correlate mode — click a unit band on one investigation, then a matching unit on another to link them'
            }
            amber={correlateMode}
            testid="correlate-mode"
            items={[
              {
                icon: <Zap size={13} />,
                label: autoCorrelating ? 'Correlating…' : 'Auto-correlate',
                onClick: () => { void handleAutoCorrelateWithCheck() },
                disabled:
                  !activeLithoModel
                  || autoCorrelating
                  || !sectionHasLithoContacts,
                title:
                  !activeLithoModel
                    ? 'Create a lithostratigraphic model first'
                    : !sectionHasLithoContacts
                      ? 'Accept litho suggestions to enable correlation — 0 accepted contacts on this section'
                      : autoCorrelating
                        ? 'Running auto-correlate…'
                        : 'Auto-correlate: match contacts at neighbouring investigations within a depth + distance tolerance — inserts unapproved edges across the whole model. Use "Accept correlations" to approve.',
                testid: 'litho-auto-correlate',
              },
              {
                icon: <CheckCheck size={13} />,
                label: acceptingCorrelations ? 'Accepting…' : 'Accept correlations',
                onClick: () => { void handleAcceptCorrelations() },
                disabled:
                  !activeLithoModel
                  || !hasSection
                  || acceptingCorrelations
                  || !sectionHasLithoContacts,
                title:
                  !activeLithoModel
                    ? 'Create a lithostratigraphic model first'
                    : !hasSection
                      ? 'Open a cross-section to accept correlations'
                      : !sectionHasLithoContacts
                        ? 'Accept litho suggestions to enable correlation — 0 accepted contacts on this section'
                        : acceptingCorrelations
                          ? 'Accepting correlations…'
                          : 'Accept all unapproved contact-level correlation edges in this section — commits lens bodies and recomputes ordinals',
                testid: 'litho-accept-correlations',
              },
              {
                // Clear correlation suggestions (#179, moved under the
                // Correlate caret per dogfeed 2026-05-29). Gated only on the
                // model — NOT on section contacts — so the user can clear
                // model-wide / off-section stale suggestions even when the
                // current section has none. Because this item stays enabled
                // when the section has 0 contacts, the Correlate primary then
                // acts as a caret-fallback (opens this menu) rather than being
                // fully disabled. Reversible via Auto-correlate.
                icon: <Trash2 size={13} />,
                label: 'Clear correlation suggestions',
                onClick: () => {
                  void handleClearSuggestions()
                },
                disabled: !activeLithoModel,
                title: !activeLithoModel
                  ? 'Create a lithostratigraphic model first'
                  : 'Remove all unapproved correlation suggestions across the model (keeps approved correlations). Reversible — re-run Auto-correlate to regenerate.',
                testid: 'litho-clear-suggestions',
              },
            ]}
          />
          {/* Bodies dropdown (dogfeed 2026-06-01) — congregates every body /
              lens action under one trigger to keep the toolbar uncluttered:
              Detect lenses, Suggest pinch-outs, and the bulk "Delete all
              detected lenses". Each item keeps its
              original testid + busy-aware label; the destructive delete opens
              a confirmation modal (irreversible). */}
          <ToolbarDropdown
            icon={<Layers size={13} />}
            label="Bodies"
            disabled={!activeLithoModel}
            title={
              !activeLithoModel
                ? 'Create a lithostratigraphic model first'
                : 'Detect, suggest, materialise, or clear body (lens) wedges'
            }
            testid="litho-bodies-dropdown"
            items={[
              {
                // Explicit, finish-then-click verb — colour every body's closed
                // loop with its lithology. Do this AFTER correlating + pinch-outs;
                // it never auto-draws (owner directive 2026-06-03). Toggles on/off.
                label: bandsVisible ? 'Hide bands' : 'Fill bands',
                icon: <PaintBucket size={12} />,
                onClick: () => toggleBandFill(),
                testid: 'litho-fill-bands',
                title:
                  'Colour every body’s closed loop with its lithology, across the section. Do this once correlations + pinch-outs are done. Toggles on / off.',
              },
              {
                // Show / hide the CorrelationEdgesOverlay (the ribbons + lines
                // that visualise the user's correlations). Pure 2-D chrome —
                // no link to the 3-D model. Defaults to shown.
                label: correlationsVisible ? 'Hide correlations' : 'Show correlations',
                icon: <Network size={12} />,
                onClick: () => toggleCorrelationOverlay(),
                testid: 'litho-toggle-correlations',
                title:
                  'Show or hide the correlation ribbons + lines drawn across the section. A 2-D visualisation of your correlations only — it has no link to the 3-D model. Toggles on / off.',
              },
              {
                // Show / hide the ModelFillOverlay — the cross-section fill
                // sampled from the built 3-D solids. Appears once the 3-D
                // litho model has been built (Build button). Litho axis only;
                // the geological cross-section keeps its own formation fill.
                // Eye/EyeOff icon conveys the action + avoids the Layers
                // dropdown-trigger collision.
                label: formationFillVisible ? 'Hide model fill' : 'Show model fill',
                icon: formationFillVisible ? <EyeOff size={12} /> : <Eye size={12} />,
                onClick: () => toggleFormationFill(),
                testid: 'litho-toggle-model-fill',
                title:
                  'Show or hide the cross-section fill sampled from the built 3-D solids. Toggles on / off.',
              },
              {
                // Reset manual points — clear every hand-drawn body boundary
                // override so all bodies return to their engine-computed shape.
                // Irreversible (DB delete): opens a ConfirmDialog first.
                label: resettingBoundaries ? 'Resetting…' : 'Reset manual points',
                icon: <Eraser size={12} />,
                onClick: () => setResetBoundariesConfirmOpen(true),
                disabled: !activeLithoModel || resettingBoundaries,
                testid: 'litho-reset-manual-points',
                title: !activeLithoModel
                  ? 'Create a lithostratigraphic model first'
                  : 'Clear every hand-drawn body boundary point on this model. Bodies return to their computed shape. Cannot be undone.',
              },
            ]}
          />
          {/* Admixtures dropdown (dogfeed 2026-05-22) — strip / reseed
              admixtures on the ghost suggestions before accepting. The
              CPT segmenter's admixtures are noisier than the borehole
              observation-log ones, so "strip all → reseed boreholes" is
              a common cleanup. Operates on ghost state only. */}
          <ToolbarDropdown
            icon={<FlaskConical size={13} />}
            label="Admixtures"
            disabled={cptGhostCount === 0 && boreholeGhostCount === 0}
            title={
              cptGhostCount === 0 && boreholeGhostCount === 0
                ? 'Suggest litho layers first — admixture edits act on ghost suggestions'
                : 'Strip or reseed admixtures on the current ghost suggestions'
            }
            testid="litho-admixtures-dropdown"
            items={[
              {
                label: `Strip CPT admixtures${cptGhostCount > 0 ? ` (${cptGhostCount})` : ''}`,
                icon: <Eraser size={12} />,
                onClick: () => handleStripLithoAdmixtures('cpt'),
                disabled: cptGhostCount === 0,
                title:
                  cptGhostCount === 0
                    ? 'No CPT ghost suggestions'
                    : 'Clear admixtures from every CPT ghost suggestion',
                testid: 'litho-strip-cpt',
              },
              {
                label: `Strip borehole admixtures${boreholeGhostCount > 0 ? ` (${boreholeGhostCount})` : ''}`,
                icon: <Eraser size={12} />,
                onClick: () => handleStripLithoAdmixtures('borehole'),
                disabled: boreholeGhostCount === 0,
                title:
                  boreholeGhostCount === 0
                    ? 'No borehole ghost suggestions'
                    : 'Clear admixtures from every borehole ghost suggestion',
                testid: 'litho-strip-borehole',
              },
              {
                label: 'Strip all admixtures',
                icon: <Eraser size={12} />,
                onClick: () => handleStripLithoAdmixtures('all'),
                disabled: cptGhostCount === 0 && boreholeGhostCount === 0,
                title: 'Clear admixtures from every ghost suggestion',
                testid: 'litho-strip-all',
              },
              {
                label: 'Reseed borehole admixtures',
                icon: <Sparkles size={12} />,
                onClick: () => handleReseedLithoAdmixtures(),
                disabled: boreholeGhostCount === 0,
                title:
                  boreholeGhostCount === 0
                    ? 'No borehole ghost suggestions'
                    : 'Restore the segmenter’s admixtures on borehole ghosts (undo a strip)',
                testid: 'litho-reseed-borehole',
              },
            ]}
          />
          {/* Separator after litho-specific actions */}
          <div className="w-px h-4 bg-border-subtle mx-0.5" aria-hidden="true" />
        </>
      )}

      {/* Geotechnical axis verbs — visible only when the geotech axis is
          active.  "Subdivide all bodies" is the headline verb: it creates
          the geotechnical model (if none exists) and materialises NAD
          packing-class bodies from the litho layer stack.  Gated on the
          litho model (the source) and a selected section (scope), NOT on
          activeGeotechModel — the verb must be reachable on the first run
          before any geotech model exists. */}
      {isGeotech && (
        <>
          {/* THE FOUR-STEP PIPELINE, folded into one dropdown (owner dogfeed
              2026-08-05 — the four inline buttons crowded the bar, debt #23).
              The pending chip stays OUTSIDE the menu: it is the number step 4
              is gated on and must be visible without opening anything. Gate
              info that used to live in hover tooltips moves onto visible tag
              pills — a disabled menu item cannot show a title in Chromium. */}
          <ToolbarDropdown
            icon={<SplitSquareVertical size={13} />}
            label={
              subdividingBodies
                ? 'Subdividing…'
                : autoCorrelatingGeotech
                  ? 'Correlating…'
                  : acceptingGeotechCorrelations
                    ? 'Accepting…'
                    : dividingBoreholes
                      ? 'Dividing…'
                      : 'Packing pipeline'
            }
            title={
              'The four-step packing flow: 1 subdivide the CPTs, 2 propose ties, ' +
              '3 review and accept them, 4 divide the boreholes. Step 4 stays ' +
              'locked while ties are still proposed.'
            }
            testid="geotech-pipeline"
            items={[
              {
                label: subdividingBodies ? 'Subdividing…' : '1 · Subdivide CPTs',
                icon: <SplitSquareVertical size={13} />,
                // Ruling 8: a statistic change never silently re-derives - this
                // tag is where the debt surfaces until the re-subdivide runs.
                tag: geotechBandsStale ? `re-run under ${geotechStatistic}` : undefined,
                disabled: subdividingBodies || !activeLithoModel,
                title: !activeLithoModel
                  ? 'Create a lithostratigraphic model in the Lithology stage first'
                  : 'Step 1 of 4 — derive NAD packing classes (1–31) on the CPTs. Correlates nothing: “2 · Auto-correlate” proposes the packing ties next. Creates the geotechnical model on first run.',
                testid: 'geotech-subdivide-cpts',
                onClick: () => {
                  if (subdividingBodies || !activeLithoModel) return
                  // A geotech model only exists AFTER a first subdivide, so its
                  // presence is the proxy for "this is a re-run" — re-runs wipe +
                  // regenerate all packing connections (manual ones lost), so we
                  // confirm first; the first-ever subdivide skips the prompt (§7).
                  if (activeGeotechModel !== null) {
                    setReSubdivideConfirmOpen(true)
                    return
                  }
                  runSubdivideAllBodies()
                },
              },
              {
                label: autoCorrelatingGeotech ? 'Correlating…' : '2 · Auto-correlate',
                icon: <Zap size={13} />,
                disabled: activeGeotechModel === null || autoCorrelatingGeotech,
                title:
                  activeGeotechModel === null
                    ? 'Run “1 · Subdivide CPTs” first to create packing bands'
                    : 'Step 2 of 4 — derive the same-class packing ties inside each correlated litho unit, on EVERY section of the model, jumping across borehole columns that carry no packing yet. Derived ties arrive ACCEPTED — the litho correlations they sit inside are ones you already approved. Hand-drawn correlations are never touched.',
                testid: 'geotech-auto-correlate',
                onClick: () => {
                  void runAutoCorrelateGeotech()
                },
              },
              {
                label: acceptingGeotechCorrelations ? 'Accepting…' : '3 · Accept all ties',
                icon: <CheckCheck size={13} />,
                disabled: activeGeotechModel === null || acceptingGeotechCorrelations,
                tag:
                  tieStatus.loaded && tieStatus.pending > 0
                    ? `${tieStatus.pending} pending`
                    : undefined,
                // The review WORKFLOW, not just the verb (owner dogfeed
                // 2026-08-05): reject first, bulk-accept second, hand-tie last.
                title:
                  activeGeotechModel === null
                    ? 'Run “1 · Subdivide CPTs” first to create packing bands'
                    : 'Step 3 of 4 — review, then approve. First DELETE the faulty proposals (right-click a tie → Delete) and accept the ones you want to check off singly (right-click → Accept tie). Then press this to accept every remaining proposal in the model. Afterwards, hand-connect anything auto-correlate missed with “Correlate packing”.',
                testid: 'geotech-accept-correlations',
                onClick: () => {
                  void runAcceptGeotechCorrelations()
                },
              },
              {
                label: dividingBoreholes ? 'Dividing…' : '4 · Divide boreholes',
                icon: <Layers size={13} />,
                disabled:
                  dividingBoreholes || activeGeotechModel === null || tiesBlockDivide,
                // Visible tag instead of a hover title: a disabled menu item
                // fires no mouse events, so the gate must SHOW its reason.
                tag: tiesBlockDivide
                  ? `accept ${tieStatus.pending} first`
                  : boreholesStale
                    ? 'stale — re-divide'
                    : undefined,
                title:
                  activeGeotechModel === null
                    ? 'Run “1 · Subdivide CPTs” first to create the geotech model'
                    : tiesBlockDivide
                      ? `${tieStatus.pending} packing tie${tieStatus.pending === 1 ? '' : 's'} still proposed — accept or delete them first`
                      : boreholesStale
                        ? 'Bodies or correlations changed — re-divide the boreholes to match'
                        : 'Step 4 of 4 — TIN-divide every borehole column into packing bands, using the CPT transition surfaces and the ties you accepted. Right-click one borehole’s ghost bands to divide just that column.',
                testid: 'geotech-divide-boreholes',
                onClick: () => {
                  if (dividingBoreholes || activeGeotechModel === null || tiesBlockDivide) return
                  setDividingBoreholes(true)
                  void handleDivideBoreholes().finally(() => {
                    setDividingBoreholes(false)
                  })
                },
              },
            ]}
          />
          {/* The pending chip — OUTSIDE the menu on purpose: it is the number
              step 4 is gated on and must be visible without opening anything. */}
          {tieStatus.loaded && tieStatus.pending > 0 && (
            <span
              data-testid="geotech-pending-tie-chip"
              className="px-1.5 py-0.5 rounded text-[10px] font-semibold text-status-amber border border-status-amber/40"
              title={`${tieStatus.pending} packing tie${tieStatus.pending === 1 ? '' : 's'} proposed and not yet accepted (${tieStatus.accepted} accepted)`}
            >
              {tieStatus.pending} pending
            </span>
          )}
          {/* The hatched-ghost legend + clamped-band notice moved to the
              right-hand inspector (owner dogfeed 2026-08-05) — prose was
              overflowing the toolbar. See SectionsInspector's Borehole
              preview section. */}
          {/* "Correlate packing" — manual same-class/same-body packing connection.
              Reuses the litho correlate state machine (correlateMode) on the geotech
              axis so clicking a packing band arms a source; clicking a neighbour's
              same-class-same-body band connects them. Right-click a connection to
              disconnect (Disconnect verb in the correlation-edge context menu).
              Gated on activeGeotechModel: the geotech model must exist (i.e. the
              user has run "Subdivide all bodies" at least once) for there to be
              packing bands to correlate. */}
          <ToolbarButton
            icon={<GitMerge size={13} />}
            label={correlateMode ? 'Correlate · click 2 bands' : 'Correlate packing'}
            onClick={() => (correlateMode ? exitCorrelateMode() : enterCorrelateMode())}
            // Keep clickable while correlateMode is on so the user can exit even
            // when no packing contacts exist on the section (mirrors litho CT8).
            disabled={activeGeotechModel === null && !correlateMode}
            title={
              activeGeotechModel === null
                ? 'Run “1 · Subdivide CPTs” first to create packing bands'
                : correlateMode
                  ? 'Exit packing-correlate mode (Esc)'
                  : 'Connect same-class packing bands across investigations within the same litho body — the hand correlation the pipeline’s step 2 automates'
            }
            amber={correlateMode}
            testid="geotech-correlate-packing"
          />
          {/* The representative-qc statistic (rulings 7+8): a per-model choice,
              part of its provenance. Changing it marks the bands stale (the
              step-1 tag) and re-derives nothing. */}
          <ToolbarDropdown
            icon={<FlaskConical size={13} />}
            label="qc statistic"
            title={
              'Which representative qc the NAD classifier reads: median (spike-robust default), ' +
              'arithmetic, harmonic (conservative - weighted toward the low values that govern ' +
              'bearing and settlement) or geometric. Changing it marks the bands stale; ' +
              '"1 · Subdivide CPTs" re-classifies under the new choice.'
            }
            testid="geotech-statistic-menu"
            items={(['median', 'arithmetic', 'harmonic', 'geometric'] as const).map(token => ({
              label: token,
              tag: token === geotechStatistic ? 'current' : undefined,
              disabled: activeGeotechModel === null,
              title:
                token === 'harmonic'
                  ? 'Conservative: weighted toward the low qc values that govern bearing and settlement.'
                  : token === 'median'
                    ? 'The spike-robust default.'
                    : undefined,
              testid: `geotech-statistic-${token}`,
              onClick: () => handleSetGeotechStatistic(token),
            }))}
          />
          {/* View toggles folded into one Display dropdown (owner dogfeed
              2026-08-05 — two standing toggle buttons were toolbar weight for
              verbs used occasionally). Same testids, same behaviour. */}
          <ToolbarDropdown
            icon={<Eye size={13} />}
            label="Display"
            title="Show or hide layers of the section view"
            testid="geotech-display-menu"
            items={[
              {
                label: geotechFillVisible ? 'Hide fill' : 'Show fill',
                icon: geotechFillVisible ? <EyeOff size={13} /> : <Eye size={13} />,
                onClick: () => toggleGeotechFill(),
                title:
                  'Show or hide the NAD packing-band fill, so you can inspect the correlation ribbons underneath.',
                testid: 'geotech-toggle-fill',
              },
              {
                label: lithoFillOnGeotech ? 'Hide litho fill' : 'Show litho fill',
                icon: lithoFillOnGeotech ? <EyeOff size={13} /> : <Eye size={13} />,
                onClick: () => toggleLithoFillOnGeotech(),
                title:
                  'Swap the lithostratigraphic fill in for the NAD packing fill — one fill renders at a time, never both.',
                testid: 'geotech-toggle-litho-fill',
              },
              {
                // Owner ruling 2026-08-07: the divide-boreholes preview is
                // OPT-IN — auto-appearing ghosts kept reading as "my boreholes
                // got subdivided" at whatever verb last drained the tie count.
                label: boreholePreviewOn ? 'Hide borehole preview' : 'Show borehole preview',
                icon: boreholePreviewOn ? <EyeOff size={13} /> : <Eye size={13} />,
                onClick: () => toggleBoreholePreviewOn(),
                title:
                  'Preview the packing bands "4 · Divide boreholes" would commit, hatched over the borehole columns. Nothing is written.',
                testid: 'geotech-toggle-borehole-preview',
              },
              {
                label: correlationsVisible ? 'Hide correlations' : 'Show correlations',
                icon: <Network size={13} />,
                onClick: () => toggleCorrelationOverlay(),
                title:
                  'Show or hide the correlation ribbons drawn across the section (2-D visualisation only).',
                testid: 'geotech-toggle-correlations',
              },
            ]}
          />
          {/* Separator after geotech-specific actions */}
          <div className="w-px h-4 bg-border-subtle mx-0.5" aria-hidden="true" />
        </>
      )}

      {/* New cross-section — primary entry action, visually distinct from
          the secondary verbs so first-time users can find it immediately.
          Accent-filled button separates it from the grey text-only verbs
          that follow. */}
      <PrimaryToolbarButton
        icon={<Plus size={13} />}
        label={creating ? 'Creating…' : 'New cross-section'}
        onClick={handleNew}
        disabled={!canCreate || creating}
        busy={creating}
        title={
          crsBlockReason !== null
            ? crsBlockReason
            : creating
              ? 'Creating…'
              : 'Create a new cross-section (placeholder endpoints)'
        }
      />

      {/* Tie-sections collapsed into one SplitToolbarButton (dogfeed
          2026-06-10). Primary = Suggest ↔ Clear toggle (amber while ghosts
          are pending so the user always sees there are suggestions to act
          on, and always has a visible way to dismiss them). Caret =
          Accept all ties. Three verbs → one toolbar slot, mirroring the
          correlation triad. */}
      <SplitToolbarButton
        icon={<Network size={13} />}
        label={suggestedTies.length > 0 ? 'Clear tie suggestions' : 'Suggest tie-sections'}
        onClick={() =>
          suggestedTies.length > 0
            ? handleClearTieSuggestions()
            : handleSuggestTies(visibleCpts, visibleBoreholes)
        }
        disabled={sections.length < 2}
        title={
          sections.length < 2
            ? 'Need at least 2 sections to tie together'
            : suggestedTies.length > 0
              ? 'Clear the current tie-section suggestions'
              : 'Suggest perpendicular connector sections between existing sections (no crossings, no shared tests)'
        }
        amber={suggestedTies.length > 0}
        testid="suggest-tie-sections"
        items={[
          {
            icon: <Sparkles size={13} />,
            label: acceptingAllTies ? 'Accepting…' : 'Accept all ties',
            onClick: () =>
              void (async () => {
                setAcceptingAllTies(true)
                try {
                  await handleAcceptAllTies()
                } finally {
                  setAcceptingAllTies(false)
                }
              })(),
            disabled: suggestedTies.length === 0 || acceptingAllTies,
            title:
              suggestedTies.length === 0
                ? 'Run "Suggest tie-sections" first'
                : acceptingAllTies
                  ? 'Creating cross-sections for all proposed ties…'
                  : 'Create a cross-section for every proposed tie',
            testid: 'tie-accept-all',
          },
        ]}
      />

      {/* Separator — visually groups the entry action from the
          section-scoped destructive verb */}
      <div className="w-px h-4 bg-border-subtle mx-0.5" aria-hidden="true" />

      {/* Delete section — only active when one is selected */}
      <ToolbarButton
        icon={<Trash2 size={13} />}
        label={deleting ? 'Deleting…' : 'Delete'}
        onClick={handleDelete}
        disabled={!hasSection || deleting}
        busy={deleting}
        danger
        title={
          !hasSection
            ? 'Select a cross-section to delete it'
            : deleting
              ? 'Deleting…'
              : `Delete "${selectedSection.name}"`
        }
      />

      {/* Separator */}
      <div className="w-px h-4 bg-border-subtle mx-0.5" aria-hidden="true" />

      {/* Debt #93: Export DXF + Plaxis 3D collapsed under one "Export ▾"
          dropdown to declutter the main toolbar.  Both verbs are still
          one click away (trigger + item) but the toolbar no longer
          dedicates two slots to them.  The trigger disables when
          neither item would be reachable. */}
      <ToolbarDropdown
        icon={<FileOutput size={13} />}
        label="Export"
        disabled={
          (!hasSection || !hasModel || exportingDxf) &&
          (geoVerbDisabled || exportingPlaxis)
        }
        title={
          exportingDxf || exportingPlaxis ? 'Exporting…' : 'Export the model or this section'
        }
        testid="sections-toolbar-export-dropdown"
        items={[
          {
            label: exportingDxf ? 'Exporting DXF…' : 'Section DXF',
            icon: <FileOutput size={12} />,
            onClick: () => void handleExportDxf(),
            disabled: !hasSection || !hasModel || exportingDxf,
            title:
              !hasSection
                ? 'Select a section to export'
                : !hasModel
                  ? `No active ${axisLevelLabel} model — contacts must exist first`
                  : exportingDxf
                    ? 'Exporting…'
                    : `Export this section's ${axisLevelLabel} model as DXF`,
            testid: 'export-section-dxf',
          },
          {
            label: exportingPlaxis ? 'Exporting Plaxis…' : 'Plaxis 3D script',
            icon: <Cpu size={12} />,
            onClick: () => void handleExportPlaxis(),
            disabled: geoVerbDisabled || exportingPlaxis,
            title:
              geoVerbHint ??
              (activeGeologicalModel === null
                ? 'No active geological model'
                : exportingPlaxis
                  ? 'Exporting…'
                  : 'Export the geological model as a Plaxis 3D plxscripting Python script'),
            testid: 'export-plaxis-3d',
          },
          {
            // Debt #52 slice 1: section PDF report.
            label: exportingPdf ? 'Generating PDF…' : 'Section PDF report',
            icon: <FileText size={12} />,
            onClick: () => setPdfDialogOpen(true),
            disabled: !hasSection || !hasModel || exportingPdf,
            title:
              !hasSection
                ? 'Select a section to export'
                : !hasModel
                  ? `No active ${axisLevelLabel} model — define one first`
                  : exportingPdf
                    ? 'Generating PDF…'
                    : `Generate a PDF report of this section's ${axisLevelLabel} model`,
            testid: 'export-section-pdf',
          },
        ]}
      />
      <ReportMetadataDialog
        open={pdfDialogOpen}
        defaultTitle={pdfDefaultTitle}
        defaultAuthor=""
        onSubmit={handleExportPdf}
        onCancel={() => setPdfDialogOpen(false)}
        busy={exportingPdf}
      />

      {/* Model-management verbs (Build / Sync geology / Seed / Dedupe)
          moved to ``SectionsInspector`` (debt #97) — they act on the
          model, not on a section, and now live next to the model rows
          in the right-hand inspector. The toolbar stops being the
          dumping ground; the Geotech-stage verbs that will land next
          have an obvious home from the start. */}

      {/* Delete-confirm modal — replaces window.confirm(). Per docs/ux.md
          irreversible-vs-reversible rule: destructive actions need a Modal
          with default focus on Cancel and a button that names the action.
          ``busy`` is set while the delete request is in-flight so Esc /
          backdrop-click don't dismiss mid-request. */}
      <Modal
        open={deleteConfirmOpen}
        onCancel={() => setDeleteConfirmOpen(false)}
        labelledBy="delete-section-title"
        busy={deleting}
        cardClassName="w-80"
      >
        <div className="p-5">
          <h2
            id="delete-section-title"
            className="text-sm font-semibold text-text-primary mb-1"
          >
            Delete cross-section?
          </h2>
          <p className="text-xs text-text-muted mb-4">
            <span className="font-medium text-text-secondary">
              {selectedSection?.name ?? 'This section'}
            </span>{' '}
            will be permanently deleted. Formation contacts placed on it are also removed.
            This cannot be undone.
          </p>
          <div className="flex justify-end gap-2">
            {/* Cancel has default focus (autoFocus) — the safe default
                for an irreversible confirm dialog per docs/ux.md. */}
            <Button
              variant="secondary"
              size="md"
              // reason: autoFocus on the Cancel button is the safe default
              // for a destructive-confirm modal — the user should actively
              // choose the destructive action, not accidentally confirm it.
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              onClick={() => setDeleteConfirmOpen(false)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="md"
              onClick={() => void confirmDelete()}
              disabled={deleting}
            >
              {deleting ? 'Deleting…' : 'Delete cross-section'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Bulk-suggest confirmation (debt #73 / Phase 3). Replaces
          existing bulk ghosts wholesale, so the dialog warns + names
          the count. Cancel has default focus per the dialog rules
          (not destructive in the DB sense, but does wipe pending
          bulk preview state — worth confirming). */}
      <Modal
        open={bulkConfirmOpen}
        onCancel={() => setBulkConfirmOpen(false)}
        labelledBy="bulk-suggest-title"
        cardClassName="w-96"
      >
        <div className="p-5">
          <h2
            id="bulk-suggest-title"
            className="text-sm font-semibold text-text-primary mb-1"
          >
            Suggest lithos for all tests?
          </h2>
          <p className="text-xs text-text-muted mb-4">
            The lithology segmenter will run for{' '}
            <span className="font-medium text-text-secondary">
              {bulkAnchors.length} investigation{bulkAnchors.length === 1 ? '' : 's'}
            </span>{' '}
            in this section. Any existing bulk-suggest ghosts will be replaced.
            Already-committed contacts on the section stay untouched.
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              size="md"
              // reason: Cancel has default focus on a state-wiping
              // confirmation modal — user must actively pick the action.
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              onClick={() => setBulkConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={() => void handleBulkSuggestConfirm()}
              disabled={bulkAnchors.length === 0}
            >
              {bulkAnchors.length === 0
                ? 'No investigations'
                : `Suggest all (${bulkAnchors.length})`}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Re-correlate confirmation (Slice 4 Half-A) — shown when the user
          clicks Auto-correlate and source='auto' edges already exist.
          Three choices: Cancel (default focus), Skip, Re-correlate.
          Manual edges are never deleted. */}
      <ReCorrelateConfirmDialog
        open={reCorrelateConfirmOpen}
        existingAutoEdgeCount={reCorrelateAutoEdgeCount}
        onCancel={handleReCorrelateCancel}
        onSkip={handleReCorrelateSkip}
        onReCorrelate={() => { void handleReCorrelateConfirm() }}
        busy={autoCorrelating && !reCorrelateConfirmOpen}
      />

      {/* Re-subdivide confirmation (C1, connecting-geotech-units §7) — shown
          before a re-run of "Subdivide all bodies" when a geotech model
          already exists, because the re-run wipes + regenerates all geotech
          packing connections (manual connections are lost) AND rebuilds every
          band, destroying the engineer's hand splits/merges (owner ruling B). */}
      <ReSubdivideConfirmDialog
        open={reSubdivideConfirmOpen}
        onCancel={handleReSubdivideCancel}
        onConfirm={handleReSubdivideConfirm}
        busy={subdividingBodies}
        handEditCount={geotechHandEditCount}
      />

      {/* Reset manual points confirmation — clearing every hand-drawn body
          boundary is an irreversible DB delete, so per docs/ux.md the gesture
          confirms first: Cancel (default focus) + an action-named danger
          button ("Reset points", never "OK"). */}
      <ConfirmDialog
        open={resetBoundariesConfirmOpen}
        labelledBy="reset-manual-points-title"
        testid="reset-manual-points-dialog"
        cardClassName="w-[28rem]"
        cancelTestid="reset-manual-points-cancel"
        onCancel={() => setResetBoundariesConfirmOpen(false)}
        busy={resettingBoundaries}
        title="Reset all manual points?"
        body={
          <p>
            Every hand-drawn boundary point on this model will be cleared and the bodies will
            return to their computed shape. This cannot be undone.
          </p>
        }
        confirm={{
          label: 'Reset points',
          onClick: () => {
            void handleResetManualBoundaries()
          },
          variant: 'danger',
          testid: 'reset-manual-points-confirm',
        }}
      />
    </div>
  )
}
