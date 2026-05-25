// Sections stage inspector — section list + properties + formations +
// crossings banner + Virtuele Boring overlay picker.
//
// §4.5 contract: section properties (name/endpoints display,
// projection-buffer + vertical-exaggeration sliders), the section list
// (originally lifted from the now-deleted Sidebar.tsx's SectionList —
// debt #12 R3), the formation list (read-only
// ordered + staleness), the crossings banner, and the VB overlay picker
// controls.
//
// All state is sourced from useShell() — no props accepted.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Eraser,
  Info,
  Pencil,
  RefreshCw,
  Slash,
  Sparkles,
  Trash2,
} from 'lucide-react'

import { useShell } from '../../ShellContext'
import type {
  BoreholeListItem,
  CrossSectionResponse,
  FormationContactResponse,
  GeologicalModelResponse,
} from '../../../api/client'
import { useCrossingsValidation } from '../../../hooks/useCrossingsValidation'
import DirtyAsterisk from '../../../components/ui/DirtyAsterisk'
import Button from '../../../components/ui/Button'
import Modal from '../../../components/ui/Modal'
import VirtueleBoringStrip from '../../../components/sections/VirtueleBoringStrip'
import { isGeologicalFormation } from '../../../utils/formationKind'
import { hashHexColor } from '../../../utils/hashColor'

// Natural sort — matches the ordering used in Sidebar.tsx's SectionList.
const NATURAL = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/**
 * Right inspector for the Sections stage.
 *
 * Four stacked sections:
 *
 * 1. Section list — pick, create, delete (lifted from Sidebar SectionList).
 * 2. Section properties — name, endpoints, buffer slider, VEX slider.
 *    Only shown when a section is selected.
 * 3. Formation list — read-only ordered list of formations in the active
 *    geological model (staleness indication on the name row).
 * 4. Crossings banner + Virtuele Boring overlay picker.
 *
 * All state and handlers are sourced from ``useShell()``.
 *
 * Returns
 * -------
 * JSX.Element
 *     The inspector panel element.
 */
export default function SectionsInspector(): JSX.Element {
  const {
    project,
    visibleBoreholes,
    sections: {
      sections,
      visibleSections,
      selectedSectionId,
      handleSelectSection,
      handleCreateSection,
      handleDeleteSection,
      handlePatchSelectedSection,
      handleFocusContacts,
      applyUpdatedSection,
      sectionModelAxis,
      backdropModelIdOverride,
      setBackdropModelIdOverride,
    },
    geoModel: {
      activeGeologicalModel,
      activeLithoModel,
      models,
      formations,
      contacts,
      crossingsRefreshCounter,
      staleSurfaceCount,
      handleRebuildSurfaces,
      handleDedupeContacts,
      handleAutoPopulateFromStratigraphy,
      handleLoadBackdropSurfaces,
    },
    overlays: {
      virtueleBoringOverlay,
      showOverlayOnSection,
      handleChangeVirtueleBoringPicker,
      handleSetShowOverlay,
    },
    coordinator: {
      sessionImportSectionIds,
    },
  } = useShell()

  // sessionImportSectionIds is now sourced from the coordinator slice
  // of the ShellContext bus (debt #25 resolution). Previously a stub
  // empty set because the value was not exposed on the bus; now wired
  // so section rows in this inspector show the amber unsaved-marker at
  // parity with CPT and borehole rows in DataInspector.

  const selectedSection = useMemo(
    () =>
      selectedSectionId
        ? (visibleSections.find(s => s.id === selectedSectionId) ?? null)
        : null,
    [selectedSectionId, visibleSections],
  )

  const canCreate = (project.default_horizontal_epsg ?? null) !== null

  // Sections inspector shows the GEOLOGICAL-MODEL vocabulary only —
  // lithostratigraphic + geotech units belong in their own stage
  // inspectors. Without this filter the list leaks every litho unit
  // (KLEI / SILT / ZAND / …) into the geology panel here. Uses the
  // shared ``isGeologicalFormation`` discriminator (litho_main_soil_code
  // + nad_class) so orphan litho units (parent_formation_id=null,
  // litho_main_soil_code set) are correctly excluded — see
  // utils/formationKind.ts for the dogfeed bug that motivated the
  // discriminator change (2026-05-21).
  const geologicalFormations = useMemo(
    () => formations.filter(isGeologicalFormation),
    [formations],
  )

  // Geological models from the full project model list, used for the backdrop
  // picker. Only shown when multiple geological models exist (rare — most
  // projects have one geological backbone; the picker surfaces only when the
  // user has created scenario variants).
  const geoModels = useMemo(
    () => models.filter(m => m.kind === 'geological' || m.kind == null),
    [models],
  )
  // Effective backdrop model id: the user's override if set, else the active
  // litho model's parent. Mirrors the derivation in SectionsCanvas / SectionsToolbar.
  const effectiveBackdropModelId =
    backdropModelIdOverride ?? activeLithoModel?.parent_geological_model_id ?? null

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* ------------------------------------------------------------------ */}
      {/* Section list — manifest-gated via visibleSections, matching the   */}
      {/* badge count in SectionsStage.ts. Newly drawn sections appear       */}
      {/* immediately because handleSectionCreated adds the id to the        */}
      {/* manifest synchronously on create (same guarantee as Geology).      */}
      {/* ------------------------------------------------------------------ */}
      <InspectorSection label="Cross-sections" count={visibleSections.length}>
        <SectionList
          sections={visibleSections}
          selectedId={selectedSectionId}
          onSelect={handleSelectSection}
          onCreate={handleCreateSection}
          onDelete={handleDeleteSection}
          canCreate={canCreate}
          sessionImportSectionIds={sessionImportSectionIds}
        />
      </InspectorSection>

      {/* ------------------------------------------------------------------ */}
      {/* Section properties (only when a section is selected)               */}
      {/* ------------------------------------------------------------------ */}
      {selectedSection !== null && (
        <InspectorSection label="Section properties">
          <SectionProperties
            section={selectedSection}
            onPatch={handlePatchSelectedSection}
          />
        </InspectorSection>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Model actions — Build / Sync geology / Seed / Dedupe (debt #97).   */}
      {/* These verbs act on the model and used to live in the Sections      */}
      {/* toolbar; per owner directive 2026-05-22 they belong next to the   */}
      {/* model they manage. Axis-aware: litho axis shows Build/Sync/Dedupe; */}
      {/* geological axis shows Build/Seed/Seed-for-new-tests/Dedupe.       */}
      {/* ------------------------------------------------------------------ */}
      {(activeGeologicalModel !== null || activeLithoModel !== null) && (
        <InspectorSection label="Model actions">
          <ModelActions
            axis={sectionModelAxis}
            activeGeologicalModel={activeGeologicalModel}
            activeLithoModel={activeLithoModel}
            staleSurfaceCount={staleSurfaceCount}
            backdropModelIdOverride={backdropModelIdOverride}
            selectedSectionId={selectedSectionId}
            visibleBoreholes={visibleBoreholes}
            contacts={contacts}
            onRebuildSurfaces={handleRebuildSurfaces}
            onDedupeContacts={handleDedupeContacts}
            onAutoPopulate={handleAutoPopulateFromStratigraphy}
            onLoadBackdropSurfaces={handleLoadBackdropSurfaces}
            applyUpdatedSection={applyUpdatedSection}
          />
        </InspectorSection>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Formation list (read-only)                                          */}
      {/* ------------------------------------------------------------------ */}
      {geologicalFormations.length > 0 && (
        <InspectorSection
          label="Geological model"
          badge={staleSurfaceCount > 0 ? `${staleSurfaceCount} stale` : undefined}
          badgeAmber={staleSurfaceCount > 0}
        >
          <FormationList formations={geologicalFormations} />
        </InspectorSection>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Geological backdrop picker — only when the project has more than   */}
      {/* one geological model. Single-model projects skip the picker.       */}
      {/* ------------------------------------------------------------------ */}
      {activeLithoModel !== null && geoModels.length > 1 && (
        <InspectorSection label="Geology backdrop (litho axis)">
          <div className="px-2 pb-2 pt-1">
            <label
              htmlFor="backdrop-model-picker"
              className="block text-xs text-text-secondary mb-1"
            >
              Reference geological model
            </label>
            <select
              id="backdrop-model-picker"
              value={effectiveBackdropModelId ?? ''}
              onChange={e => {
                const val = e.target.value
                // Selecting the parent's model id with no override set is
                // equivalent to clearing the override — keep the state tidy.
                const parentId = activeLithoModel.parent_geological_model_id
                setBackdropModelIdOverride(val === parentId ? null : val || null)
              }}
              className="w-full text-xs rounded border border-border-default bg-surface-card text-text-primary px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-accent"
            >
              {geoModels.map(m => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-text-muted mt-1">
              Shown as a faint reference layer when the litho axis is active.
              Click&nbsp;<em>Sync geology</em> in Model actions to load.
            </p>
          </div>
        </InspectorSection>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Crossings banner                                                    */}
      {/* ------------------------------------------------------------------ */}
      {activeGeologicalModel !== null && (
        <CrossingsBanner
          projectId={project.id}
          modelId={activeGeologicalModel.id}
          refreshSignal={crossingsRefreshCounter}
          staleSurfaceCount={staleSurfaceCount}
          onFocusContacts={handleFocusContacts}
        />
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Virtuele Boring overlay picker                                      */}
      {/* ------------------------------------------------------------------ */}
      <InspectorSection label="Virtuele Boring overlay">
        <VirtueleBoringStrip
          modelA={virtueleBoringOverlay.modelA}
          modelB={virtueleBoringOverlay.modelB}
          maxDepthM={virtueleBoringOverlay.maxDepthM}
          showOnSection={showOverlayOnSection}
          onChangePicker={handleChangeVirtueleBoringPicker}
          onChangeShowOnSection={next => handleSetShowOverlay('section', next)}
        />
      </InspectorSection>
    </div>
  )
}

// ---------------------------------------------------------------------------
// InspectorSection — collapsible section header + content slot
// ---------------------------------------------------------------------------

// localStorage key pattern: sections-inspector-collapse:<label-slug>
// Value: 'open' | 'closed'. Default is 'open' for first-time users.
function inspectorCollapseKey(label: string): string {
  return `sections-inspector-collapse:${label.toLowerCase().replace(/\s+/g, '-')}`
}

function loadCollapseState(label: string): boolean {
  // Returns true = open, false = closed. Default open.
  try {
    const raw = localStorage.getItem(inspectorCollapseKey(label))
    if (raw === 'closed') return false
  } catch {
    // localStorage unavailable — default open.
  }
  return true
}

interface InspectorSectionProps {
  label: string
  count?: number
  badge?: string
  badgeAmber?: boolean
  children: React.ReactNode
}

/**
 * Collapsible labelled section of the Sections-stage inspector panel.
 *
 * The chevron header toggles content visibility; collapse state is
 * persisted to localStorage keyed by ``label`` so the user's choices
 * survive page refreshes.  Default state is open (first-time users see
 * everything).
 *
 * The header is a ``<button>`` with ``aria-expanded`` + ``aria-controls``
 * so keyboard users can toggle with Space / Enter and screen readers
 * announce the open/closed state.
 *
 * Parameters
 * ----------
 * label
 *     Header text for this inspector section (also used as the
 *     localStorage key discriminator — keep it unique per section).
 * count
 *     Optional count shown after the label.
 * badge
 *     Optional status badge text (e.g. "3 stale").
 * badgeAmber
 *     Whether the badge renders in amber (stale/warning intent).
 * children
 *     Content rendered below the header.
 *
 * Returns
 * -------
 * JSX.Element
 *     The labelled collapsible section element.
 */
function InspectorSection({
  label,
  count,
  badge,
  badgeAmber,
  children,
}: InspectorSectionProps): JSX.Element {
  const [open, setOpen] = useState<boolean>(() => loadCollapseState(label))
  const panelId = `sections-inspector-panel-${label.toLowerCase().replace(/\s+/g, '-')}`

  const toggle = useCallback(() => {
    setOpen(prev => {
      const next = !prev
      try {
        localStorage.setItem(inspectorCollapseKey(label), next ? 'open' : 'closed')
      } catch {
        // localStorage unavailable — no-op.
      }
      return next
    })
  }, [label])

  const Chevron = open ? ChevronDown : ChevronRight

  return (
    <div className="border-b border-border-subtle last:border-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
        className="w-full flex items-center gap-1.5 px-3 py-2 bg-surface-card hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent text-left transition-colors"
      >
        <Chevron
          size={12}
          className="text-text-muted shrink-0"
          aria-hidden="true"
        />
        <span className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">
          {label}
        </span>
        {count !== undefined && (
          <span className="text-[10px] text-text-muted tabular-nums">({count})</span>
        )}
        {badge && (
          <span
            className={[
              'ml-auto text-[9px] font-medium px-1.5 py-0.5 rounded-full',
              badgeAmber
                ? 'bg-status-amber/20 text-status-amber'
                : 'bg-border-subtle text-text-muted',
            ].join(' ')}
          >
            {badge}
          </span>
        )}
      </button>
      {open && (
        <div id={panelId} className="px-3 py-2">
          {children}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SectionList — originally lifted from Sidebar.tsx's SectionList
// (Sidebar.tsx deleted in debt #12 R3; this is now the sole owner)
// ---------------------------------------------------------------------------

interface SectionListProps {
  sections: CrossSectionResponse[]
  selectedId: string | null
  onSelect: (id: string) => void
  onCreate: () => Promise<CrossSectionResponse | null>
  onDelete: (id: string) => Promise<void>
  canCreate: boolean
  sessionImportSectionIds: ReadonlySet<string>
}

/**
 * Ordered list of cross-sections with create / select / delete affordances.
 *
 * Mirrors the SectionList component in Sidebar.tsx.  Sidebar.tsx is NOT
 * deleted — it still renders the section list in the legacy sidebar tab for
 * the transition period between S5 and S7.  When S7 lands (Geology stage
 * migration) the Sidebar.tsx section tab can be removed.
 *
 * Parameters
 * ----------
 * sections
 *     The visible sections to render.
 * selectedId
 *     Id of the currently-selected section, or ``null``.
 * onSelect
 *     Called when the user clicks a section row.
 * onCreate
 *     Called when the user clicks "+ New section".
 * onDelete
 *     Called when the user confirms deleting a section.
 * canCreate
 *     When false, the create button is disabled (no horizontal CRS).
 * sessionImportSectionIds
 *     IDs created in this session but not yet saved (amber marker).
 *
 * Returns
 * -------
 * JSX.Element
 *     The section list element.
 */
function SectionList({
  sections,
  selectedId,
  onSelect,
  onCreate,
  onDelete,
  canCreate,
  sessionImportSectionIds,
}: SectionListProps): JSX.Element {
  const [creating, setCreating] = useState(false)

  const ordered = useMemo(
    () =>
      [...sections].sort((a, b) => {
        const order = a.display_order - b.display_order
        if (order !== 0) return order
        return NATURAL.compare(a.name, b.name)
      }),
    [sections],
  )

  async function handleCreate(): Promise<void> {
    if (!canCreate || creating) return
    setCreating(true)
    try {
      const created = await onCreate()
      if (created) onSelect(created.id)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="flex flex-col gap-1">
      {/* Create button */}
      <button
        onClick={() => void handleCreate()}
        disabled={!canCreate || creating}
        title={
          !canCreate
            ? 'Set a Default horizontal CRS in Project metadata first'
            : creating
              ? 'Creating…'
              : 'Create a new cross-section'
        }
        className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[11px] rounded border border-border-subtle text-text-secondary hover:bg-surface-card hover:text-text-primary disabled:text-text-muted disabled:cursor-not-allowed transition-colors"
      >
        {creating ? 'Creating…' : '+ New cross-section'}
      </button>

      {/* Section rows */}
      {ordered.length === 0 ? (
        <p className="text-[11px] text-text-muted italic py-1">
          {canCreate ? 'No cross-sections yet' : 'Set a CRS to create sections'}
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {ordered.map(s => (
            <SectionRow
              key={s.id}
              section={s}
              selected={s.id === selectedId}
              unsaved={sessionImportSectionIds.has(s.id)}
              onClick={() => onSelect(s.id)}
              onDelete={() => onDelete(s.id)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SectionRow — individual row in the section list
// ---------------------------------------------------------------------------

interface SectionRowProps {
  section: CrossSectionResponse
  selected: boolean
  unsaved: boolean
  onClick: () => void
  onDelete: () => Promise<void>
}

/**
 * A single cross-section row with click-to-select and hover-to-delete.
 *
 * Parameters
 * ----------
 * section
 *     The cross-section data.
 * selected
 *     Whether this section is currently selected.
 * unsaved
 *     Whether this section was created in the current session (amber marker).
 * onClick
 *     Called when the row is clicked.
 * onDelete
 *     Called after user confirms the deletion.
 *
 * Returns
 * -------
 * JSX.Element
 *     The section row element.
 */
function SectionRow({
  section,
  selected,
  unsaved,
  onClick,
  onDelete,
}: SectionRowProps): JSX.Element {
  const [deleting, setDeleting] = useState(false)
  // Delete confirm modal state — replaces window.confirm() per UX rules:
  // irreversible actions require a Modal with default-focus on Cancel and a
  // button labelled with the action name (not "OK"). See docs/ux.md.
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)

  const dx = section.end_x - section.start_x
  const dy = section.end_y - section.start_y
  const lengthM = Math.sqrt(dx * dx + dy * dy)

  function handleDeleteClick(e: React.MouseEvent): void {
    e.stopPropagation()
    if (deleting) return
    setDeleteConfirmOpen(true)
  }

  async function confirmDelete(): Promise<void> {
    setDeleteConfirmOpen(false)
    setDeleting(true)
    try {
      await onDelete()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <li
        data-testid={`section-row-${section.id}`}
        className={[
          'group relative flex items-center rounded transition-colors',
          unsaved ? 'border-l-2 border-l-status-amber pl-1' : 'pl-2',
          selected
            ? 'bg-accent/10 text-accent'
            : 'hover:bg-surface-card text-text-secondary',
        ].join(' ')}
      >
        <button
          onClick={onClick}
          className="flex-1 text-left py-1.5 pr-7 min-w-0"
        >
          <div className="flex items-center gap-1.5">
            <Slash size={11} className="flex-shrink-0 opacity-70" />
            <span className="text-xs font-medium truncate">{section.name}</span>
            {unsaved && (
              <DirtyAsterisk title="Created since last save — File → Save to commit" />
            )}
          </div>
          <div className="flex items-center gap-1.5 pl-4 text-[10px] text-text-muted">
            <span>{lengthM.toFixed(0)} m</span>
            <span>·</span>
            <span title="Lateral projection buffer">
              ±{section.projection_buffer_m.toFixed(0)} m
            </span>
          </div>
        </button>

        <button
          onClick={handleDeleteClick}
          disabled={deleting}
          title={deleting ? 'Deleting…' : 'Delete cross-section'}
          className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded text-text-muted hover:text-status-danger hover:bg-status-danger/10 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-30 transition-opacity"
          data-testid={`section-row-delete-${section.id}`}
        >
          <Trash2 size={12} />
        </button>
      </li>

      {/* Delete-confirm modal — replaces window.confirm(). Per docs/ux.md
          irreversible-vs-reversible rule: destructive actions need a Modal
          with default focus on Cancel and a button that names the action.
          ``busy`` set while the delete request is in-flight prevents
          Esc / backdrop-click from dismissing mid-request. */}
      <Modal
        open={deleteConfirmOpen}
        onCancel={() => setDeleteConfirmOpen(false)}
        labelledBy={`delete-section-row-title-${section.id}`}
        busy={deleting}
        cardClassName="w-80"
      >
        <div className="p-5">
          <h2
            id={`delete-section-row-title-${section.id}`}
            className="text-sm font-semibold text-text-primary mb-1"
          >
            Delete cross-section?
          </h2>
          <p className="text-xs text-text-muted mb-4">
            <span className="font-medium text-text-secondary">{section.name}</span>{' '}
            will be permanently deleted. Formation contacts placed on it are also removed.
            This cannot be undone.
          </p>
          <div className="flex justify-end gap-2">
            {/* Cancel has default focus (autoFocus) — the safe default
                for an irreversible confirm dialog per docs/ux.md. */}
            <Button
              variant="secondary"
              size="md"
              // reason: autoFocus on the Cancel button is the safe default for
              // a destructive-confirm modal — the user must actively choose the
              // destructive action, not accidentally confirm it on Enter.
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
              data-testid={`section-row-delete-confirm-${section.id}`}
            >
              {deleting ? 'Deleting…' : 'Delete cross-section'}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}

// ---------------------------------------------------------------------------
// SectionProperties — slider controls for the selected section
// ---------------------------------------------------------------------------

interface SectionPropertiesProps {
  section: CrossSectionResponse
  onPatch: (patch: {
    name?: string
    projection_buffer_m?: number
    vertical_exaggeration?: number
  }) => Promise<void>
}

/**
 * Editable display properties for the selected cross-section.
 *
 * Shows the section name as an inline-editable field (click to edit,
 * commit on blur/Enter, cancel on Esc), plus two slider controls
 * (projection buffer, vertical exaggeration) that patch on release.
 *
 * Parameters
 * ----------
 * section
 *     The currently-selected cross-section.
 * onPatch
 *     Async patch handler — called on blur/Enter for name and on
 *     slider release for buffer/VEX.
 *
 * Returns
 * -------
 * JSX.Element
 *     The properties panel element.
 */
function SectionProperties({
  section,
  onPatch,
}: SectionPropertiesProps): JSX.Element {
  const [bufferM, setBufferM] = useState(section.projection_buffer_m)
  const [vex, setVex] = useState(section.vertical_exaggeration)

  // Keep local slider state in sync when the selected section changes.
  useEffect(() => {
    setBufferM(section.projection_buffer_m)
    setVex(section.vertical_exaggeration)
    // reason: reset local slider state only when the SELECTED SECTION
    // changes, not when the server echoes the same section back after a
    // PATCH. Depending on projection_buffer_m / vertical_exaggeration
    // would re-run this on every onMouseUp→PATCH round-trip and make the
    // slider flicker back to the last-committed value mid-drag-release.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section.id])

  // Inline name edit state — mirrors the ux.md inline-edit pattern:
  // click-to-edit, commit on blur/Enter, cancel on Esc, trim blanks,
  // fall back to prior name when the field is cleared.
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState(section.name)
  const nameInputRef = useRef<HTMLInputElement>(null)

  // Keep draft in sync when the server round-trip updates section.name
  // (e.g. after a PATCH the parent replaces the section object). Reset
  // only when the section identity changes — not on every server echo —
  // for the same "avoid flickering" reason as the slider states above.
  useEffect(() => {
    setDraftName(section.name)
    setEditing(false)
    // reason: reset draft/editing ONLY when the section identity changes
    // (switching sections), NOT when the server echoes the same id with a
    // patched name — re-running on echo would clobber an in-progress edit.
    // The draft is (re)snapshotted from section.name on entering edit mode
    // in handleNameClick, so it never goes stale across a rename round-trip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section.id])

  function handleNameClick(): void {
    setDraftName(section.name)
    setEditing(true)
  }

  function commitName(): void {
    const trimmed = draftName.trim()
    setEditing(false)
    // Fall back to prior name when the field is blank (ux.md: don't
    // allow blank names).
    if (trimmed === '' || trimmed === section.name) {
      setDraftName(section.name)
      return
    }
    setDraftName(trimmed)
    void onPatch({ name: trimmed })
  }

  function handleNameKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter') {
      e.currentTarget.blur()
    } else if (e.key === 'Escape') {
      // Cancel — restore prior name without patching.
      setDraftName(section.name)
      setEditing(false)
    }
  }

  // Auto-focus the input when edit mode opens.
  useEffect(() => {
    if (editing) nameInputRef.current?.select()
  }, [editing])

  const dx = section.end_x - section.start_x
  const dy = section.end_y - section.start_y
  const lengthM = Math.sqrt(dx * dx + dy * dy)

  return (
    <div className="flex flex-col gap-3">
      {/* Name — inline-edit on click (ux.md inline-edit pattern). */}
      <div>
        {editing ? (
          <input
            ref={nameInputRef}
            type="text"
            value={draftName}
            onChange={e => setDraftName(e.target.value)}
            onBlur={commitName}
            onKeyDown={handleNameKeyDown}
            className="w-full text-xs font-medium text-text-primary bg-surface-card border border-accent rounded px-1.5 py-0.5 focus:outline-none focus:ring-2 focus:ring-accent"
            aria-label="Section name"
          />
        ) : (
          <button
            type="button"
            onClick={handleNameClick}
            title="Click to rename this cross-section"
            className="group flex items-center gap-1 w-full text-left"
          >
            <span className="text-xs font-medium text-text-primary truncate">
              {section.name}
            </span>
            <Pencil
              size={10}
              className="flex-shrink-0 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity"
              aria-hidden="true"
            />
          </button>
        )}
        <p className="text-[10px] text-text-muted mt-0.5">
          {lengthM.toFixed(0)} m · EPSG:{section.epsg}
        </p>
      </div>

      {/* Projection buffer */}
      <div>
        <label className="flex items-center justify-between text-[11px] text-text-secondary mb-1">
          <span>Projection buffer</span>
          <span className="tabular-nums text-text-primary">{bufferM.toFixed(0)} m</span>
        </label>
        <input
          type="range"
          min={5}
          max={500}
          step={5}
          value={bufferM}
          onChange={e => setBufferM(Number(e.target.value))}
          onMouseUp={() => void onPatch({ projection_buffer_m: bufferM })}
          onKeyUp={() => void onPatch({ projection_buffer_m: bufferM })}
          className="w-full accent-accent"
          title="Lateral distance from the section line within which investigations are projected"
        />
      </div>

      {/* Vertical exaggeration */}
      <div>
        <label className="flex items-center justify-between text-[11px] text-text-secondary mb-1">
          <span>Vertical exaggeration</span>
          <span className="tabular-nums text-text-primary">×{vex.toFixed(1)}</span>
        </label>
        <input
          type="range"
          min={1}
          max={20}
          step={0.5}
          value={vex}
          onChange={e => setVex(Number(e.target.value))}
          onMouseUp={() => void onPatch({ vertical_exaggeration: vex })}
          onKeyUp={() => void onPatch({ vertical_exaggeration: vex })}
          className="w-full accent-accent"
          title="Vertical exaggeration applied to the section view (1 = no exaggeration, 10 = 10× stretched)"
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// FormationList — read-only ordered formation list for the inspector
// ---------------------------------------------------------------------------

interface FormationListProps {
  formations: Array<{
    id: string
    name: string
    color: string
    display_order: number
  }>
}

/**
 * Read-only ordered list of geological formations.
 *
 * Presentation order: DESCENDING by ``display_order`` — youngest
 * (highest order number, surface / near-surface) at the top, oldest
 * (order 0, deepest) at the bottom.  This matches how a geologist
 * reads a stratigraphic column or borelog: surface material at the top.
 *
 * IMPORTANT: this is a PRESENTATIONAL sort only.
 * - ``display_order`` semantics are unchanged (lower = older).
 * - The section renderer still iterates formations ASCENDING so that
 *   older formations paint first and younger formations render on top
 *   (geological superposition rule; see CLAUDE.md "Stratigraphic order").
 * - The InterpretationPane drag-and-drop reorder also uses ascending
 *   order for its visual stack.
 * None of those are affected by reversing the list here.
 *
 * Parameters
 * ----------
 * formations
 *     The formations to render (from ``useShell().geoModel.formations``).
 *     Per-formation staleness is not on the list item — the header badge
 *     (rendered by the caller) carries the stale count.
 *
 * Returns
 * -------
 * JSX.Element
 *     The formation list element.
 */
function FormationList({ formations }: FormationListProps): JSX.Element {
  // Descending so youngest / shallowest formation sits at the top of
  // the list — matches how a geologist reads a borehole log or the
  // DOV "Beschrijving van de grond" (surface-to-depth convention).
  const sorted = useMemo(
    () => [...formations].sort((a, b) => b.display_order - a.display_order),
    [formations],
  )

  return (
    <ul className="flex flex-col gap-0.5">
      {sorted.map(f => {
        const swatch = f.color ?? hashHexColor(f.name)
        return (
          <li key={f.id} className="flex items-center gap-2 py-1 text-xs">
            <span
              className="w-3 h-3 flex-shrink-0 rounded-sm border border-border-subtle"
              style={{ backgroundColor: swatch }}
              aria-hidden="true"
            />
            <span className="truncate text-text-primary" title={f.name}>
              {f.name}
            </span>
            <span className="ml-auto text-[9px] text-text-muted tabular-nums">
              {f.display_order}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// CrossingsBanner — fetches and renders surface-crossing issues
// ---------------------------------------------------------------------------

interface CrossingsBannerProps {
  projectId: string
  modelId: string
  refreshSignal: number
  staleSurfaceCount: number
  /** Highlight the offending contacts in the section view when a crossing
   *  row is clicked (debt #9 flow — same contract as InterpretationPane). */
  onFocusContacts: (contactIds: readonly string[]) => void
}

/**
 * Surface-crossing banner for the active model.
 *
 * Validation is stale-gated (debt #18) via ``useCrossingsValidation``:
 * when ``staleSurfaceCount`` > 0 the cached TIN is NOT validated and a
 * neutral "Build to validate" line is shown; once Build clears the
 * stale flag the hook re-fetches and the amber warning (if any)
 * appears. Renders nothing when the model is fresh and clean.
 *
 * Parameters
 * ----------
 * projectId
 *     The active project UUID.
 * modelId
 *     The active geological model UUID.
 * refreshSignal
 *     Bumped by ``useGeologicalModel`` after every contact mutation.
 * staleSurfaceCount
 *     When > 0, validation is suppressed and the pending-build line
 *     is shown instead (debt #18).
 *
 * Returns
 * -------
 * JSX.Element | null
 *     The crossings banner element, or null when there are no issues.
 */
function CrossingsBanner({
  projectId,
  modelId,
  refreshSignal,
  staleSurfaceCount,
  onFocusContacts,
}: CrossingsBannerProps): JSX.Element | null {
  // Stale-gated fetch (debt #18): a stale cache is not validated; the
  // hook exposes pendingBuild so we show a neutral "Build to check"
  // line instead of an untrustworthy amber warning, and re-validates
  // automatically once Build clears staleSurfaceCount.
  const { crossingIssues: issues, pendingBuild } = useCrossingsValidation(
    projectId,
    modelId,
    refreshSignal,
    staleSurfaceCount,
  )

  if (pendingBuild) {
    return (
      <div className="px-3 py-2 border-b border-border-subtle">
        <div
          className="rounded border border-border-subtle bg-surface-app px-2 py-1.5 text-[11px] text-text-muted"
          role="status"
          aria-label="Surface validation pending"
        >
          <div className="flex items-center gap-1.5">
            <Info size={12} />
            <span>
              Surface crossings not checked — Build the 3D model to
              validate.
            </span>
          </div>
        </div>
      </div>
    )
  }

  if (issues.length === 0) return null

  return (
    <div className="px-3 py-2 border-b border-border-subtle">
      <div
        // S5 review: light-mode amber-on-amber-tint failed WCAG AA at
        // 11px (~3:1). Body text uses text-primary in light (high
        // contrast on the amber tint) and the amber token only in dark
        // (passes ~6:1). The amber border + tint still signal "warning".
        className="rounded border border-status-amber/40 bg-status-amber/10 px-2 py-1.5 text-[11px] text-text-primary dark:text-status-amber"
        role="alert"
        aria-label="Surface crossing warnings"
      >
        <div className="flex items-center gap-1.5 font-medium">
          <AlertTriangle size={12} />
          <span>
            {issues.length} surface crossing{issues.length === 1 ? '' : 's'} detected
          </span>
        </div>
        <ul className="mt-1 ml-5 list-disc space-y-0.5">
          {issues.map((issue, idx) => {
            // Click a row to highlight the offending contacts in the
            // section view (debt #9). Rows with no contact_ids stay
            // inert text — same canFocus guard as InterpretationPane.
            const canFocus = issue.contact_ids.length > 0
            return (
              <li key={`${issue.formation_ids.join('-')}-${idx}`}>
                {canFocus ? (
                  <button
                    type="button"
                    className="w-full cursor-pointer rounded px-1 py-0.5 text-left hover:bg-status-amber/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-status-amber"
                    onClick={() => onFocusContacts(issue.contact_ids)}
                    title="Highlight the offending contacts in the section view"
                  >
                    {issue.detail}
                  </button>
                ) : (
                  issue.detail
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ModelActions — Build / Sync geology / Seed / Dedupe (debt #97)
// ---------------------------------------------------------------------------

interface ModelActionsProps {
  axis: 'geological' | 'lithostratigraphic'
  activeGeologicalModel: GeologicalModelResponse | null
  activeLithoModel: GeologicalModelResponse | null
  staleSurfaceCount: number
  backdropModelIdOverride: string | null
  selectedSectionId: string | null
  visibleBoreholes: readonly BoreholeListItem[]
  contacts: readonly FormationContactResponse[]
  // Return types intentionally ``unknown`` — these handlers return
  // counts / status info the inspector does not consume. Avoids
  // brittle prop-type bumps when the underlying bus signatures grow
  // a return value (e.g. handleDedupeContacts returns ``Promise<number>``).
  onRebuildSurfaces: () => Promise<unknown>
  onDedupeContacts: () => Promise<unknown>
  onAutoPopulate: (
    boreholeIds: readonly string[],
    sectionId?: string | null,
    onSectionUpdated?: (updated: CrossSectionResponse) => void,
  ) => Promise<unknown>
  onLoadBackdropSurfaces: (modelId: string) => Promise<unknown>
  applyUpdatedSection: (updated: CrossSectionResponse) => void
}

/**
 * Model-action verbs that used to live in the Sections-stage toolbar
 * (debt #97). Per the owner directive 2026-05-22, "model-management
 * verbs leave the toolbar for the inspector" — they act on a model
 * and now sit next to the model they manage.
 *
 * Axis-aware row:
 *
 *   - Geological axis: Build · Seed · Seed for new tests · Dedupe
 *   - Lithostratigraphic axis: Build · Sync geology · Dedupe
 *
 * Each verb mirrors its prior toolbar behaviour exactly — same gates,
 * same handlers, same async affordances. Build's amber "stale" badge
 * follows ``staleSurfaceCount`` (geology axis only; on the litho axis
 * the geology backdrop's TINs are read-only and stale-counting is
 * meaningless from here). Visual style matches the inspector's
 * existing pills (the Clear + Resolve in LithologyInspector); small
 * text-button row with leading icon.
 */
function ModelActions({
  axis,
  activeGeologicalModel,
  activeLithoModel,
  staleSurfaceCount,
  backdropModelIdOverride,
  selectedSectionId,
  visibleBoreholes,
  contacts,
  onRebuildSurfaces,
  onDedupeContacts,
  onAutoPopulate,
  onLoadBackdropSurfaces,
  applyUpdatedSection,
}: ModelActionsProps): JSX.Element {
  const isLitho = axis === 'lithostratigraphic'
  const [rebuilding, setRebuilding] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const [deduping, setDeduping] = useState(false)

  // Build / Dedupe / Plaxis-3D act on the GEOLOGICAL model regardless
  // of axis (litho TINs are derived). The litho axis exposes Build as
  // a no-op-when-no-litho-model gate; in practice the user will Build
  // from the geology axis. Match the prior toolbar guard.
  const geoVerbDisabled = isLitho || activeGeologicalModel === null
  const geoVerbHint = isLitho
    ? 'Switch to the Geology axis — Build / Dedupe act on the geological model'
    : null

  // Litho-axis Sync geology — load the parent geological model's TIN
  // surfaces as a read-only backdrop reference. Disabled when no
  // backdrop is resolved (no litho parent + no override).
  const effectiveBackdropModelId =
    backdropModelIdOverride ?? activeLithoModel?.parent_geological_model_id ?? null

  // Newly-imported boreholes — those without ANY contact in the active
  // geological model. The Seed-for-new-tests verb scopes the seed to
  // them so re-running after a fresh import doesn't touch already-
  // accepted boreholes.
  const newTestBoreholeIds = useMemo(() => {
    if (!activeGeologicalModel) return [] as string[]
    const seen = new Set<string>()
    for (const c of contacts) {
      if (c.borehole_id !== null) seen.add(c.borehole_id)
    }
    return visibleBoreholes.filter(b => !seen.has(b.id)).map(b => b.id)
  }, [contacts, visibleBoreholes, activeGeologicalModel])

  async function handleBuild(): Promise<void> {
    if (rebuilding || !activeGeologicalModel) return
    setRebuilding(true)
    try {
      await onRebuildSurfaces()
    } finally {
      setRebuilding(false)
    }
  }

  async function handleSync(): Promise<void> {
    if (seeding || !effectiveBackdropModelId) return
    setSeeding(true)
    try {
      await onLoadBackdropSurfaces(effectiveBackdropModelId)
    } finally {
      setSeeding(false)
    }
  }

  async function handleSeed(): Promise<void> {
    if (seeding || !activeGeologicalModel) return
    setSeeding(true)
    try {
      await onAutoPopulate(
        visibleBoreholes.map(b => b.id),
        selectedSectionId,
        applyUpdatedSection,
      )
    } finally {
      setSeeding(false)
    }
  }

  async function handleSeedNewTests(): Promise<void> {
    if (seeding || newTestBoreholeIds.length === 0) return
    setSeeding(true)
    try {
      await onAutoPopulate(newTestBoreholeIds, selectedSectionId, applyUpdatedSection)
    } finally {
      setSeeding(false)
    }
  }

  async function handleDedupe(): Promise<void> {
    if (deduping || !activeGeologicalModel) return
    setDeduping(true)
    try {
      await onDedupeContacts()
    } finally {
      setDeduping(false)
    }
  }

  const btnClass =
    'flex items-center gap-1 text-[11px] text-text-secondary hover:text-text-primary disabled:opacity-40 transition-colors'
  const buildAmber = staleSurfaceCount > 0 && !isLitho && !rebuilding

  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1.5">
      <button
        type="button"
        onClick={() => void handleBuild()}
        disabled={rebuilding || geoVerbDisabled}
        className={[
          btnClass,
          buildAmber ? 'text-status-amber hover:text-status-amber' : '',
        ].join(' ')}
        title={
          geoVerbHint ??
          (activeGeologicalModel === null
            ? 'No active geological model — create formations and contacts first'
            : rebuilding
              ? 'Building surfaces…'
              : staleSurfaceCount > 0
                ? `${staleSurfaceCount} formation surface${staleSurfaceCount === 1 ? '' : 's'} need rebuilding — click to compute TINs`
                : 'Rebuild TIN surfaces from current contacts')
        }
        data-testid="inspector-build"
      >
        <RefreshCw
          size={11}
          className={rebuilding ? 'animate-spin' : ''}
          aria-hidden="true"
        />
        {rebuilding
          ? 'Building…'
          : staleSurfaceCount > 0 && !isLitho
            ? `Build · ${staleSurfaceCount} stale`
            : 'Build model'}
      </button>

      {isLitho ? (
        <button
          type="button"
          onClick={() => void handleSync()}
          disabled={
            seeding ||
            activeLithoModel === null ||
            effectiveBackdropModelId === null
          }
          className={btnClass}
          title={
            activeLithoModel === null
              ? 'Create a lithostratigraphic model in the Lithology stage first'
              : effectiveBackdropModelId === null
                ? 'No parent geological model linked'
                : seeding
                  ? 'Loading geological surfaces…'
                  : 'Load the parent geological model\'s surfaces as a read-only backdrop reference on this section'
          }
          data-testid="inspector-sync-geology"
        >
          <Sparkles size={11} aria-hidden="true" />
          {seeding ? 'Syncing…' : 'Sync geology'}
        </button>
      ) : (
        <>
          <button
            type="button"
            onClick={() => void handleSeed()}
            disabled={seeding || geoVerbDisabled}
            className={btnClass}
            title={
              geoVerbHint ??
              (activeGeologicalModel === null
                ? 'Define formations in the Geology stage first — Seed places contacts for already-defined layers'
                : seeding
                  ? 'Seeding contacts from borehole stratigraphy…'
                  : 'Place contacts from borehole observations for formations already defined in the model — run Dedupe if duplicates appear')
            }
            data-testid="inspector-seed"
          >
            <Sparkles size={11} aria-hidden="true" />
            {seeding ? 'Seeding…' : 'Seed'}
          </button>
          <button
            type="button"
            onClick={() => void handleSeedNewTests()}
            disabled={
              seeding || geoVerbDisabled || newTestBoreholeIds.length === 0
            }
            className={btnClass}
            title={
              geoVerbHint ??
              (activeGeologicalModel === null
                ? 'Define formations in the Geology stage first'
                : seeding
                  ? 'Seeding contacts from borehole stratigraphy…'
                  : newTestBoreholeIds.length === 0
                    ? 'All boreholes in scope already have geology contacts — import new tests to use this'
                    : `Place contacts from stratigraphy for the ${newTestBoreholeIds.length} borehole${newTestBoreholeIds.length === 1 ? '' : 's'} with no geology contacts yet`)
            }
            data-testid="inspector-seed-new-tests"
          >
            <Sparkles size={11} aria-hidden="true" />
            {seeding
              ? 'Seeding…'
              : activeGeologicalModel
                ? `Seed for new tests (${newTestBoreholeIds.length})`
                : 'Seed for new tests'}
          </button>
        </>
      )}

      <button
        type="button"
        onClick={() => void handleDedupe()}
        disabled={deduping || geoVerbDisabled}
        className={btnClass}
        title={
          geoVerbHint ??
          (activeGeologicalModel === null
            ? 'No active geological model'
            : deduping
              ? 'Cleaning…'
              : 'Remove duplicate (anchor, formation) contacts — keeps the most-recent pick in each group')
        }
        data-testid="inspector-dedupe"
      >
        <Eraser size={11} aria-hidden="true" />
        {deduping ? 'Cleaning…' : 'Dedupe'}
      </button>
    </div>
  )
}

