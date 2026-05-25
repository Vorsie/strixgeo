// Sections stage toolbar — section-specific verbs wired from the ShellContext bus.
//
// Collects the section actions (Build model, Auto-populate, Dedupe, Export DXF,
// Export Plaxis 3D, New cross-section, Delete section) into one place for the
// Sections stage.  All handlers are sourced from useShell() — no props accepted
// (matches the StageDescriptor.ToolbarComponent contract).

import { useMemo, useState } from 'react'
import { Trash2, FileOutput, FileText, Cpu, Sparkles, Eraser, Plus, GitMerge, Undo2, FlaskConical, Zap } from 'lucide-react'
import ReportMetadataDialog from '../../../components/sections/ReportMetadataDialog'

import { useShell } from '../../ShellContext'
import { ToolbarButton, ToolbarDropdown, PrimaryToolbarButton, SplitToolbarButton } from '../../ToolbarPrimitives'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'
import { sectionCrsBlockReason } from '../../../utils/horizontalCrs'
import type { SectionModelAxis } from '../../../hooks/useSections'

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
    },
    geoModel: {
      activeGeologicalModel,
      activeLithoModel,
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
      // Debt #92 "new tests" filter: scope the Suggest split-button's
      // "for new tests" item to anchors not yet in the active litho
      // model's contact set. Build / Dedupe / Sync moved with their
      // verbs to ``SectionsInspector`` (#97).
      lithoContacts,
    },
    visibleCpts,
    coordinator: {
      selectedId,
      selectedBoreholeId,
      handleExportSectionDxf,
      handleExportSectionPdf,
    },
  } = useShell()

  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // Delete confirm modal state — replaces window.confirm() per UX rules:
  // irreversible actions require a Modal with default-focus on Cancel and a
  // button labelled with the action name (not "OK"). See docs/ux.md.
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [exportingPlaxis, setExportingPlaxis] = useState(false)
  const [exportingDxf, setExportingDxf] = useState(false)
  const [acceptingAll, setAcceptingAll] = useState(false)
  // Bulk-suggest (debt #73 / Phase 3) — confirmation modal + accept-all state.
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false)
  const [acceptingAllBulk, setAcceptingAllBulk] = useState(false)
  const [autoCorrelating, setAutoCorrelating] = useState(false)

  const selectedSection = sections.find(s => s.id === selectedSectionId) ?? null

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

  async function handleExportDxf(): Promise<void> {
    // Axis-aware: use the active model for the chosen axis.
    const axisModel = isLitho ? activeLithoModel : activeGeologicalModel
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
    const axisModel = isLitho ? activeLithoModel : activeGeologicalModel
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
  // Axis-aware model presence: geological axis uses the geological model,
  // lithostratigraphic axis uses the litho model. Build/Seed/Dedupe/Export
  // buttons are gated on the ACTIVE model for the chosen axis.
  const isLitho = sectionModelAxis === 'lithostratigraphic'
  const hasModel = isLitho
    ? activeLithoModel !== null
    : activeGeologicalModel !== null
  // B-2 (senior-review): Build / Seed / Dedupe / Plaxis-3D are
  // GEOLOGICAL-model operations — their handlers act on
  // activeGeologicalModel regardless of axis. On the litho axis
  // hasModel reads the LITHO model, which would leave them enabled
  // and silently writing to the geological model. Gate them on the
  // geological model + the geology axis explicitly; the litho axis's
  // equivalent build flow is Suggest/accept, not these verbs.
  const geoVerbDisabled = isLitho || activeGeologicalModel === null
  const geoVerbHint = isLitho
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
  // visible CPTs + boreholes, filtered by the section's exclusion sets.
  // Skips anchors with no elevation (the ghost overlay needs surface Z
  // to position layers). On click the confirmation dialog has already
  // fired; this kicks off the fan-out.
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
    for (const c of visibleCpts) {
      if (excludedCptIds.has(c.id)) continue
      if (c.elevation_m == null) continue
      out.push({ kind: 'cpt', id: c.id, surfaceElevationM: c.elevation_m })
    }
    for (const b of visibleBoreholes) {
      if (excludedBhIds.has(b.id)) continue
      if (b.elevation_m == null) continue
      out.push({ kind: 'borehole', id: b.id, surfaceElevationM: b.elevation_m })
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
    const lithoSeenAnchorIds = new Set<string>()
    for (const c of lithoContacts) {
      if (c.cpt_id !== null) lithoSeenAnchorIds.add(c.cpt_id)
      if (c.borehole_id !== null) lithoSeenAnchorIds.add(c.borehole_id)
    }
    return bulkAnchors.filter(a => !lithoSeenAnchorIds.has(a.id))
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
  // switching so a disabled "Litho" segment can't be clicked.
  function handleAxisChange(axis: SectionModelAxis): void {
    if (axis === 'lithostratigraphic' && activeLithoModel === null) return
    setSectionModelAxis(axis)
  }

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
          aria-checked={!isLitho}
          onClick={() => handleAxisChange('geological')}
          className={[
            'px-2 py-1 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            !isLitho
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
          {/* Correlate mode toggle — arms the two-click connect gesture.
              Enabled iff a litho model is active AND a section is open.
              Active state rendered with accent background.
              Clears correlate mode + armed source on axis switch (via
              setSectionModelAxis which now wraps the raw setter). */}
          <ToolbarButton
            icon={<GitMerge size={13} />}
            label={correlateMode ? 'Correlate · click 2 bands' : 'Correlate'}
            onClick={() => (correlateMode ? exitCorrelateMode() : enterCorrelateMode())}
            disabled={!activeLithoModel || !hasSection}
            title={
              !activeLithoModel
                ? 'Create a lithostratigraphic model first'
                : !hasSection
                  ? 'Open a cross-section to correlate units'
                  : correlateMode
                    ? 'Exit correlate mode (Esc)'
                    : 'Enter correlate mode — click a unit band on one investigation, then a matching unit on another to link them'
            }
            // reason: correlateMode active = visually distinct from idle.
            // We repurpose the amber style (which reads as "attention needed"
            // here, not "unsaved") because it makes the active mode obvious
            // without adding a new token. Amber = ongoing action in progress.
            amber={correlateMode}
          />
          {/* Auto-correlate — #127: fire the domain algorithm across the
              whole model; inserts source='auto' edges in bulk. Enabled
              iff a litho model is active; does NOT require an open
              section (model-level operation). */}
          <ToolbarButton
            icon={<Zap size={13} />}
            label={autoCorrelating ? 'Correlating…' : 'Auto-correlate'}
            onClick={() => {
              setAutoCorrelating(true)
              void handleAutoCorrelate().finally(() => setAutoCorrelating(false))
            }}
            disabled={!activeLithoModel || autoCorrelating}
            busy={autoCorrelating}
            testid="litho-auto-correlate"
            title={
              !activeLithoModel
                ? 'Create a lithostratigraphic model first'
                : autoCorrelating
                  ? 'Running auto-correlate…'
                  : 'Auto-correlate: run the bottom-up dip-transfer algorithm across the whole model — inserts edges between matching litho units at neighbouring investigations'
            }
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
                  ? 'No active geological model — contacts must exist first'
                  : exportingDxf
                    ? 'Exporting…'
                    : 'Export this section as DXF',
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
                  ? 'No active model — define formations or a litho model first'
                  : exportingPdf
                    ? 'Generating PDF…'
                    : 'Generate a PDF report of this section with title + author + notes',
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
    </div>
  )
}
