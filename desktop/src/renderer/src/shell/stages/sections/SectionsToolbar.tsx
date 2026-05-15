// Sections stage toolbar — section-specific verbs wired from the ShellContext bus.
//
// Collects the section actions that were previously scattered across
// InterpretationPane (Build model, Auto-populate, Dedupe) and SectionPanel's
// header (Export DXF, Export Plaxis 3D) into one place for the Sections stage.
// New cross-section and Delete section live here too (previously in Sidebar's
// SectionList).
//
// All handlers are sourced from useShell() — no props accepted (matches the
// StageDescriptor.ToolbarComponent contract).

import { useState } from 'react'
import { Trash2, FileOutput, Cpu, RefreshCw, Sparkles, Eraser, Plus } from 'lucide-react'

import { useShell } from '../../ShellContext'

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
    sections: {
      selectedSectionId,
      sections,
      handleSelectSection,
      handleCreateSection,
      handleDeleteSection,
    },
    geoModel: {
      activeGeologicalModel,
      staleSurfaceCount,
      handleRebuildSurfaces,
      handleAutoPopulateFromStratigraphy,
      handleDedupeContacts,
      handleExportModelPlaxis3d,
    },
    coordinator: {
      handleExportSectionDxf,
    },
    visibleBoreholes,
  } = useShell()

  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [rebuilding, setRebuilding] = useState(false)
  const [populating, setPopulating] = useState(false)
  const [deduping, setDeduping] = useState(false)
  const [exportingPlaxis, setExportingPlaxis] = useState(false)
  const [exportingDxf, setExportingDxf] = useState(false)

  const selectedSection = sections.find(s => s.id === selectedSectionId) ?? null

  // Project needs a horizontal EPSG to create sections (endpoints need a CRS).
  const canCreate = (project.default_horizontal_epsg ?? null) !== null

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

  async function handleDelete(): Promise<void> {
    if (!selectedSection || deleting) return
    const ok = window.confirm(
      `Delete cross-section "${selectedSection.name}"? This can't be undone.`,
    )
    if (!ok) return
    setDeleting(true)
    try {
      await handleDeleteSection(selectedSection.id)
    } finally {
      setDeleting(false)
    }
  }

  async function handleExportDxf(): Promise<void> {
    if (!selectedSection || !activeGeologicalModel || exportingDxf) return
    setExportingDxf(true)
    try {
      await handleExportSectionDxf(
        project.id,
        selectedSection.id,
        selectedSection.name,
        activeGeologicalModel.id,
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

  async function handleBuild(): Promise<void> {
    // Guard on model presence too — the Build button is always rendered
    // but is meaningless without an active geological model.
    if (rebuilding || !activeGeologicalModel) return
    setRebuilding(true)
    try {
      await handleRebuildSurfaces()
    } finally {
      setRebuilding(false)
    }
  }

  async function handleAutoPopulate(): Promise<void> {
    if (!activeGeologicalModel || populating) return
    setPopulating(true)
    try {
      // Scope to visible boreholes — matches the InterpretationPane behaviour
      // where ``boreholeIds`` was the list of currently-visible boreholes.
      await handleAutoPopulateFromStratigraphy(visibleBoreholes.map(b => b.id))
    } finally {
      setPopulating(false)
    }
  }

  async function handleDedupe(): Promise<void> {
    if (!activeGeologicalModel || deduping) return
    setDeduping(true)
    try {
      await handleDedupeContacts()
    } finally {
      setDeduping(false)
    }
  }

  const hasSection = selectedSection !== null
  const hasModel = activeGeologicalModel !== null
  const staleLabel =
    staleSurfaceCount > 0
      ? `Build · ${staleSurfaceCount} stale`
      : 'Build model'

  return (
    <div className="flex items-center gap-1">
      {/* New cross-section — primary entry action, visually distinct from
          the secondary verbs so first-time users can find it immediately.
          Accent-filled button separates it from the grey text-only verbs
          that follow. */}
      <PrimaryToolbarButton
        icon={<Plus size={13} />}
        label={creating ? 'Creating…' : 'New cross-section'}
        onClick={handleNew}
        disabled={!canCreate || creating}
        title={
          !canCreate
            ? 'Set a Default horizontal CRS in Project metadata to create sections'
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

      {/* Export DXF — requires a section + active model */}
      <ToolbarButton
        icon={<FileOutput size={13} />}
        label={exportingDxf ? 'Exporting…' : 'Export DXF'}
        onClick={handleExportDxf}
        disabled={!hasSection || !hasModel || exportingDxf}
        title={
          !hasSection
            ? 'Select a section to export'
            : !hasModel
              ? 'No active geological model — contacts must exist first'
              : exportingDxf
                ? 'Exporting…'
                : 'Export this section as DXF'
        }
      />

      {/* Export Plaxis 3D — model-level, not section-scoped */}
      <ToolbarButton
        icon={<Cpu size={13} />}
        label={exportingPlaxis ? 'Exporting…' : 'Plaxis 3D'}
        onClick={handleExportPlaxis}
        disabled={!hasModel || exportingPlaxis}
        title={
          !hasModel
            ? 'No active geological model'
            : exportingPlaxis
              ? 'Exporting…'
              : 'Export the geological model as a Plaxis 3D plxscripting Python script'
        }
      />

      {/* Separator */}
      <div className="w-px h-4 bg-border-subtle mx-0.5" aria-hidden="true" />

      {/* Build model — amber badge when surfaces are stale */}
      <ToolbarButton
        icon={<RefreshCw size={13} className={rebuilding ? 'animate-spin' : ''} />}
        label={rebuilding ? 'Building…' : staleLabel}
        onClick={handleBuild}
        disabled={rebuilding || !hasModel}
        amber={staleSurfaceCount > 0 && !rebuilding}
        title={
          !hasModel
            ? 'No active geological model — create formations and contacts first'
            : rebuilding
            ? 'Building surfaces…'
            : staleSurfaceCount > 0
              ? `${staleSurfaceCount} formation surface${staleSurfaceCount === 1 ? '' : 's'} need rebuilding — click to compute TINs`
              : 'Rebuild TIN surfaces from current contacts'
        }
      />

      {/* Auto-populate from stratigraphy */}
      <ToolbarButton
        icon={<Sparkles size={13} />}
        label={populating ? 'Working…' : 'From boreholes'}
        onClick={handleAutoPopulate}
        disabled={!hasModel || populating || visibleBoreholes.length === 0}
        title={
          !hasModel
            ? 'No active geological model'
            : visibleBoreholes.length === 0
              ? 'No boreholes visible — import boreholes first'
              : populating
                ? 'Working…'
                : 'Seed formation contacts from borehole stratigraphy observations'
        }
      />

      {/* Dedupe contacts */}
      <ToolbarButton
        icon={<Eraser size={13} />}
        label={deduping ? 'Cleaning…' : 'Dedupe'}
        onClick={handleDedupe}
        disabled={!hasModel || deduping}
        title={
          !hasModel
            ? 'No active geological model'
            : deduping
              ? 'Cleaning…'
              : 'Remove duplicate (anchor, formation) contacts — keeps the most-recent pick in each group'
        }
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface PrimaryToolbarButtonProps {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  title?: string
}

/**
 * Accent-filled toolbar button for the primary entry action (New cross-section).
 *
 * Visually separated from the secondary ``ToolbarButton`` verbs so new users
 * can identify the entry action at a glance. Uses the semantic accent colour
 * (blue-600 / dark: blue-400 via CSS vars) rather than a hard-coded hex so
 * both themes work correctly.
 *
 * Parameters
 * ----------
 * icon
 *     Lucide icon element (13 px).
 * label
 *     Short text label rendered next to the icon.
 * onClick
 *     Action handler.
 * disabled
 *     When true, the button is non-interactive and dimmed.
 * title
 *     Tooltip text (full action description).
 *
 * Returns
 * -------
 * JSX.Element
 *     The accent-filled button element.
 */
function PrimaryToolbarButton({
  icon,
  label,
  onClick,
  disabled,
  title,
}: PrimaryToolbarButtonProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={[
        'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        disabled
          ? 'bg-accent/40 text-text-on-accent cursor-not-allowed'
          : 'bg-accent text-text-on-accent hover:bg-accent-muted',
      ].join(' ')}
    >
      {icon}
      {label}
    </button>
  )
}

interface ToolbarButtonProps {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  title?: string
  /** Render with amber tint (stale-surface badge affordance). */
  amber?: boolean
  /** Render with red tint (destructive action affordance). */
  danger?: boolean
}

/**
 * Compact toolbar button for the Sections stage verbs.
 *
 * Parameters
 * ----------
 * icon
 *     Lucide icon element (13 px).
 * label
 *     Short text label rendered next to the icon.
 * onClick
 *     Action handler.
 * disabled
 *     When true, the button is non-interactive.
 * title
 *     Tooltip text (full action description).
 * amber
 *     Highlights the button in amber (stale-surface badge affordance).
 * danger
 *     Highlights the button in red (destructive action affordance).
 *
 * Returns
 * -------
 * JSX.Element
 *     The button element.
 */
function ToolbarButton({
  icon,
  label,
  onClick,
  disabled,
  title,
  amber,
  danger,
}: ToolbarButtonProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={[
        'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        disabled
          ? 'text-text-muted cursor-not-allowed'
          : danger
            ? 'text-status-danger hover:bg-surface-app'
            : amber
              ? 'text-status-amber hover:bg-surface-app'
              : 'text-text-secondary hover:bg-surface-app hover:text-text-primary',
      ].join(' ')}
    >
      {icon}
      {label}
    </button>
  )
}
