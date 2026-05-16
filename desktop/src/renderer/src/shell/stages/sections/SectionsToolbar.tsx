// Sections stage toolbar — section-specific verbs wired from the ShellContext bus.
//
// Collects the section actions (Build model, Auto-populate, Dedupe, Export DXF,
// Export Plaxis 3D, New cross-section, Delete section) into one place for the
// Sections stage.  All handlers are sourced from useShell() — no props accepted
// (matches the StageDescriptor.ToolbarComponent contract).

import { useState } from 'react'
import { Trash2, FileOutput, Cpu, RefreshCw, Sparkles, Eraser, Plus } from 'lucide-react'

import { useShell } from '../../ShellContext'
import { ToolbarButton, PrimaryToolbarButton } from '../../ToolbarPrimitives'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'
import { sectionCrsBlockReason } from '../../../utils/horizontalCrs'

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
    sections: {
      selectedSectionId,
      sections,
      effectiveHorizontalEpsg,
      handleSelectSection,
      handleCreateSection,
      handleDeleteSection,
    },
    geoModel: {
      activeGeologicalModel,
      staleSurfaceCount,
      handleRebuildSurfaces,
      handleDedupeContacts,
      handleExportModelPlaxis3d,
      handleAutoPopulateFromStratigraphy,
    },
    coordinator: {
      handleExportSectionDxf,
    },
  } = useShell()

  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [seeding, setSeeding] = useState(false)
  // Delete confirm modal state — replaces window.confirm() per UX rules:
  // irreversible actions require a Modal with default-focus on Cancel and a
  // button labelled with the action name (not "OK"). See docs/ux.md.
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [rebuilding, setRebuilding] = useState(false)
  const [deduping, setDeduping] = useState(false)
  const [exportingPlaxis, setExportingPlaxis] = useState(false)
  const [exportingDxf, setExportingDxf] = useState(false)

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

  // Seed from stratigraphy — un-gated now that the Geology stage owns
  // formation definition ("Fill from boreholes").  The Geology stage
  // creates the formation rows (the source of truth); Sections Seed
  // only places contacts for formations that ALREADY EXIST in the model.
  // It does NOT create formations and does NOT trigger a Delaunay build.
  // Risk 4 (geology-stage-architecture.md §8.1): if duplicates appear,
  // run Dedupe — the tooltip below surfaces this guidance to the user.
  async function handleSeed(): Promise<void> {
    if (!activeGeologicalModel || seeding) return
    setSeeding(true)
    try {
      await handleAutoPopulateFromStratigraphy(visibleBoreholes.map(b => b.id))
    } finally {
      setSeeding(false)
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

      {/* Export DXF — requires a section + active model */}
      <ToolbarButton
        icon={<FileOutput size={13} />}
        label={exportingDxf ? 'Exporting…' : 'Export DXF'}
        onClick={handleExportDxf}
        disabled={!hasSection || !hasModel || exportingDxf}
        busy={exportingDxf}
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
        busy={exportingPlaxis}
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

      {/* Seed from stratigraphy — places contacts at borehole observation
          boundaries for formations that already exist in the active model.
          Contract: Geology stage owns "Fill from boreholes" (creates formation
          rows). Sections Seed only creates CONTACTS — it never creates
          formations and never triggers a Delaunay/TIN build.
          Risk 4 (geology-stage-architecture.md §8.1): run Dedupe afterwards
          if this places duplicate contacts alongside existing ones. */}
      <ToolbarButton
        icon={<Sparkles size={13} />}
        label={seeding ? 'Seeding…' : 'Seed'}
        onClick={() => void handleSeed()}
        disabled={!hasModel || seeding}
        busy={seeding}
        title={
          !hasModel
            ? 'Define formations in the Geology stage first — Seed places contacts for already-defined layers'
            : seeding
              ? 'Seeding contacts from borehole stratigraphy…'
              : 'Place contacts from borehole observations for formations already defined in the model — run Dedupe if duplicates appear'
        }
      />

      {/* Dedupe contacts */}
      <ToolbarButton
        icon={<Eraser size={13} />}
        label={deduping ? 'Cleaning…' : 'Dedupe'}
        onClick={handleDedupe}
        disabled={!hasModel || deduping}
        busy={deduping}
        title={
          !hasModel
            ? 'No active geological model'
            : deduping
              ? 'Cleaning…'
              : 'Remove duplicate (anchor, formation) contacts — keeps the most-recent pick in each group'
        }
      />

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
    </div>
  )
}
