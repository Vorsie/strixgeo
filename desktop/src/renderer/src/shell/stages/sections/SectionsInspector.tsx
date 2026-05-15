// Sections stage inspector — section list + properties + formations +
// crossings banner + Virtuele Boring overlay picker.
//
// §4.5 contract: section properties (name/endpoints display,
// projection-buffer + vertical-exaggeration sliders), the section list
// (lifted from Sidebar.tsx's SectionList — Sidebar.tsx is NOT deleted; the
// Interpretation/geology portion stays for S7), the formation list (read-only
// ordered + staleness), the crossings banner, and the VB overlay picker
// controls.
//
// All state is sourced from useShell() — no props accepted.

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Pencil, Slash, Trash2 } from 'lucide-react'

import { useShell } from '../../ShellContext'
import { api } from '../../../api/client'
import type { CrossSectionResponse, GapIssueResponse } from '../../../api/client'
import DirtyAsterisk from '../../../components/ui/DirtyAsterisk'
import VirtueleBoringStrip from '../../../components/sections/VirtueleBoringStrip'
import { hashHexColor } from '../../../utils/hashColor'
import { log } from '../../../utils/log'

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
    sections: {
      sections,
      selectedSectionId,
      handleSelectSection,
      handleCreateSection,
      handleDeleteSection,
      handlePatchSelectedSection,
      handleFocusContacts,
    },
    geoModel: {
      activeGeologicalModel,
      formations,
      crossingsRefreshCounter,
      staleSurfaceCount,
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
    () => (selectedSectionId ? sections.find(s => s.id === selectedSectionId) ?? null : null),
    [selectedSectionId, sections],
  )

  const canCreate = (project.default_horizontal_epsg ?? null) !== null

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* ------------------------------------------------------------------ */}
      {/* Section list — uses ALL sections, not the manifest-gated           */}
      {/* visibleSections, so newly-drawn sections appear immediately in     */}
      {/* the list without waiting for the next File → Save round-trip.     */}
      {/* ------------------------------------------------------------------ */}
      <InspectorSection label="Cross-sections" count={sections.length}>
        <SectionList
          sections={sections}
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
      {/* Formation list (read-only)                                          */}
      {/* ------------------------------------------------------------------ */}
      {formations.length > 0 && (
        <InspectorSection
          label="Geological model"
          badge={staleSurfaceCount > 0 ? `${staleSurfaceCount} stale` : undefined}
          badgeAmber={staleSurfaceCount > 0}
        >
          <FormationList formations={formations} />
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

interface InspectorSectionProps {
  label: string
  count?: number
  badge?: string
  badgeAmber?: boolean
  children: React.ReactNode
}

/**
 * Labelled section of the inspector panel.
 *
 * Parameters
 * ----------
 * label
 *     Header text for this inspector section.
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
 *     The labelled section element.
 */
function InspectorSection({
  label,
  count,
  badge,
  badgeAmber,
  children,
}: InspectorSectionProps): JSX.Element {
  return (
    <div className="border-b border-border-subtle last:border-0">
      <div className="flex items-center gap-1.5 px-3 py-2 bg-surface-card">
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
      </div>
      <div className="px-3 py-2">{children}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// SectionList — lifted from Sidebar.tsx SectionList (Sidebar.tsx not deleted)
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

  const dx = section.end_x - section.start_x
  const dy = section.end_y - section.start_y
  const lengthM = Math.sqrt(dx * dx + dy * dy)

  function handleDelete(e: React.MouseEvent): void {
    e.stopPropagation()
    const ok = window.confirm(
      `Delete cross-section "${section.name}"? This can't be undone.`,
    )
    if (!ok) return
    setDeleting(true)
    void onDelete().finally(() => setDeleting(false))
  }

  return (
    <li
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
        onClick={handleDelete}
        disabled={deleting}
        title={deleting ? 'Deleting…' : 'Delete cross-section'}
        className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded text-text-muted hover:text-status-danger hover:bg-status-danger/10 opacity-0 group-hover:opacity-100 disabled:opacity-30 transition-opacity"
      >
        <Trash2 size={12} />
      </button>
    </li>
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
 * Amber warning banner listing surface-crossing issues for the active model.
 *
 * Fetches from ``GET /projects/{pid}/geology/models/{mid}/validate/crossings``
 * on mount and whenever ``refreshSignal`` changes.  Renders nothing when
 * there are no issues.
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
 *     When > 0, qualifies the banner with "(as of last build)".
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
  const [issues, setIssues] = useState<GapIssueResponse[]>([])

  useEffect(() => {
    let cancelled = false
    api.geology
      .validateCrossings(projectId, modelId)
      .then(resp => {
        if (cancelled) return
        setIssues(resp.issues)
      })
      .catch(err => {
        log.warn('geology', `validateCrossings failed for ${modelId}`, err)
        if (!cancelled) setIssues([])
      })
    return () => {
      cancelled = true
    }
  }, [projectId, modelId, refreshSignal])

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
            {staleSurfaceCount > 0 && (
              <span className="font-normal italic">
                {' '}(as of last build — click Build to refresh)
              </span>
            )}
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

