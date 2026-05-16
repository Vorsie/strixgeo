// Geology stage toolbar — formation-definition and model-maintenance verbs.
//
// Verb order (left to right):
//   1. Fill from boreholes (primary accent) — opens FormationSelectionDialog
//      via discoverBoreholeFormations; apply calls applyBoreholeFormationSelection.
//   2. Separator.
//   3. Build 3D model — calls handleRebuildSurfaces; amber badge when stale.
//   4. Dedupe — calls handleDedupeContacts (model maintenance verb).
//   5. Separator.
//   6. Reset view — collapses split viewport + flies camera to model bounding box.
//   7. Delete stratigraphy — irreversible; confirm modal with Cancel default focus.
//
// Reset wiring: the camera fly-to and split-collapse are performed via
// module-level ref callbacks exported from GeologyCanvas (resetCameraCallback
// and resetSplitViewportCallback).  This avoids a bus extension for
// session-ephemeral view state that has no meaningful persistence requirement.
//
// The PrimaryToolbarButton / ToolbarButton internal components mirror
// SectionsToolbar.tsx (copy two). Extract to shell/ToolbarPrimitives.tsx
// on the third copy (Export stage toolbar). See CLAUDE.md extraction rule.
//
// No props accepted — all state/handlers come from useShell().

import { useState } from 'react'
import {
  Eraser,
  RefreshCw,
  Sparkles,
  Trash2,
  RotateCcw,
} from 'lucide-react'

import { useShell } from '../../ShellContext'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'
import FormationSelectionDialog from './FormationSelectionDialog'
import type { FormationCandidate } from '../../../hooks/useGeologicalModel'
import {
  resetCameraCallback,
  resetSplitViewportCallback,
} from './GeologyCanvas'

/**
 * Geology-stage toolbar verbs wired from the ShellContext bus.
 *
 * Renders the Fill-from-boreholes, Build, Dedupe, Reset, and Delete model
 * actions.  All handlers are sourced from ``useShell()``; no props accepted
 * (matches the ``StageDescriptor.ToolbarComponent`` contract).
 *
 * Returns
 * -------
 * JSX.Element
 *     The toolbar verbs element.
 */
export default function GeologyToolbar(): JSX.Element {
  const {
    visibleBoreholes,
    toasts: { toast },
    geoModel: {
      activeGeologicalModel,
      formations,
      contacts,
      staleSurfaceCount,
      handleRebuildSurfaces,
      handleDedupeContacts,
      handleDeleteModel,
      discoverBoreholeFormations,
      applyBoreholeFormationSelection,
    },
  } = useShell()

  // ---------------------------------------------------------------------------
  // Local state
  // ---------------------------------------------------------------------------

  const [discovering, setDiscovering] = useState(false)
  const [selectionDialogOpen, setSelectionDialogOpen] = useState(false)
  const [candidates, setCandidates] = useState<FormationCandidate[]>([])
  const [applying, setApplying] = useState(false)

  const [rebuilding, setRebuilding] = useState(false)
  const [deduping, setDeduping] = useState(false)

  // Delete model confirm state.
  const [deleteModelConfirmOpen, setDeleteModelConfirmOpen] = useState(false)
  const [deletingModel, setDeletingModel] = useState(false)

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  // 1. Fill from boreholes — discover candidates, then open the selection
  //    dialog. Empty candidate list → toast-level feedback only (caller
  //    doesn't open the dialog).
  //
  //    discoverBoreholeFormations now calls ensureActiveGeologicalModel
  //    internally, so we do NOT gate on !activeGeologicalModel here.
  //    The Fill button is always enabled when boreholes are visible.
  async function handleFillFromBoreholes(): Promise<void> {
    if (discovering || applying) return
    const boreholeIds = visibleBoreholes.map(b => b.id)
    if (boreholeIds.length === 0) return
    setDiscovering(true)
    try {
      const result = await discoverBoreholeFormations(boreholeIds)
      if (result.length === 0) {
        // No stratigraphy data — opening an empty dialog would be a silent
        // dead end on the stage's primary entry action (§10.4). Surface the
        // reason explicitly. ('error' is the only non-success toast type.)
        toast('error', 'No boreholes carry stratigraphy data.')
        return
      }
      setCandidates(result)
      setSelectionDialogOpen(true)
    } finally {
      setDiscovering(false)
    }
  }

  // 2. Build model.
  async function handleBuild(): Promise<void> {
    if (rebuilding || !activeGeologicalModel) return
    setRebuilding(true)
    try {
      await handleRebuildSurfaces()
    } finally {
      setRebuilding(false)
    }
  }

  // 3. Dedupe contacts.
  async function handleDedupe(): Promise<void> {
    if (deduping || !activeGeologicalModel) return
    setDeduping(true)
    try {
      await handleDedupeContacts()
    } finally {
      setDeduping(false)
    }
  }

  // 4. Confirm handler for FormationSelectionDialog.
  //    Receives stable keys (not display names) from the dialog.
  async function handleSelectionConfirm(
    selectedKeys: ReadonlySet<string>,
  ): Promise<void> {
    setSelectionDialogOpen(false)
    setApplying(true)
    try {
      const boreholeIds = visibleBoreholes.map(b => b.id)
      await applyBoreholeFormationSelection(selectedKeys, boreholeIds)
    } catch (err) {
      // applyBoreholeFormationSelection logs + throws; toast the failure here
      // so the Geology stage surfaces it even when the error originates deep
      // in the hook (previously this path was silently swallowed).
      toast('error', 'Could not apply formation selection — check the connection.')
    } finally {
      setApplying(false)
    }
  }

  // 5. Confirm delete model.
  async function confirmDeleteModel(): Promise<void> {
    if (deletingModel) return
    setDeletingModel(true)
    try {
      await handleDeleteModel()
    } finally {
      setDeletingModel(false)
      setDeleteModelConfirmOpen(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  const hasModel = activeGeologicalModel !== null
  // Fill is enabled when boreholes are present and no operation is in flight.
  // No model is required — discoverBoreholeFormations creates the Default
  // model on demand via ensureActiveGeologicalModel.
  const canFill =
    !discovering && !applying && visibleBoreholes.length > 0
  const staleLabel =
    staleSurfaceCount > 0
      ? `Build 3D model · ${staleSurfaceCount} stale`
      : 'Build 3D model'

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex items-center gap-1">
      {/* Fill from boreholes — primary accent entry action. Opens the
          curated FormationSelectionDialog after a read-only discovery scan.
          Matches the §10 design: does NOT call auto-populate directly. */}
      <PrimaryToolbarButton
        icon={<Sparkles size={13} />}
        label={
          discovering
            ? 'Scanning…'
            : applying
              ? 'Applying…'
              : 'Fill from boreholes'
        }
        onClick={() => void handleFillFromBoreholes()}
        disabled={!canFill}
        title={
          visibleBoreholes.length === 0
            ? 'No boreholes visible in this project'
            : discovering
              ? 'Scanning borehole stratigraphy…'
              : applying
                ? 'Applying selection…'
                : 'Discover formation names from borehole stratigraphy and select which to keep'
        }
      />

      {/* Separator */}
      <div className="w-px h-4 bg-border-subtle mx-0.5" aria-hidden="true" />

      {/* Build 3D model — amber badge when surfaces are stale */}
      <ToolbarButton
        icon={<RefreshCw size={13} className={rebuilding ? 'animate-spin' : ''} />}
        label={rebuilding ? 'Building…' : staleLabel}
        onClick={() => void handleBuild()}
        disabled={rebuilding || !hasModel}
        amber={staleSurfaceCount > 0 && !rebuilding}
        title={
          !hasModel
            ? 'No active stratigraphy — create formations and contacts first'
            : rebuilding
              ? 'Building 3D model…'
              : staleSurfaceCount > 0
                ? `${staleSurfaceCount} formation surface${staleSurfaceCount === 1 ? '' : 's'} need rebuilding — click to compute TINs`
                : 'Rebuild TIN surfaces from current contacts'
        }
      />

      {/* Dedupe contacts — maintenance verb */}
      <ToolbarButton
        icon={<Eraser size={13} />}
        label={deduping ? 'Cleaning…' : 'Dedupe'}
        onClick={() => void handleDedupe()}
        disabled={!hasModel || deduping}
        title={
          !hasModel
            ? 'No active stratigraphy'
            : deduping
              ? 'Cleaning…'
              : 'Remove duplicate (anchor, formation) contacts — keeps the most-recent pick in each group'
        }
      />

      {/* Separator */}
      <div className="w-px h-4 bg-border-subtle mx-0.5" aria-hidden="true" />

      {/* Reset view — collapses split viewport + flies camera to model bounds.
          Calls the module-level callbacks exported by GeologyCanvas rather
          than routing through the bus (session-ephemeral view state). */}
      <ToolbarButton
        icon={<RotateCcw size={13} />}
        label="Reset view"
        onClick={() => {
          resetSplitViewportCallback.current?.()
          resetCameraCallback.current?.()
        }}
        disabled={!hasModel}
        title={
          !hasModel
            ? 'No active stratigraphy'
            : 'Reset to single 3D view and fly camera to model bounding box'
        }
      />

      {/* Delete stratigraphy — irreversible; opens a confirm modal */}
      <ToolbarButton
        icon={<Trash2 size={13} />}
        label={deletingModel ? 'Deleting…' : 'Delete stratigraphy'}
        onClick={() => {
          if (!hasModel || deletingModel) return
          setDeleteModelConfirmOpen(true)
        }}
        disabled={!hasModel || deletingModel}
        danger
        title={
          !hasModel
            ? 'No active stratigraphy'
            : 'Permanently delete the active geological model and all its formations, contacts, and surfaces'
        }
      />

      {/* Formation selection dialog — opened after a successful discovery scan */}
      <FormationSelectionDialog
        open={selectionDialogOpen}
        candidates={candidates}
        currentFormations={formations}
        currentContacts={contacts}
        onConfirm={selectedNames => void handleSelectionConfirm(selectedNames)}
        onCancel={() => setSelectionDialogOpen(false)}
      />

      {/* Delete model confirm modal — irreversible; default focus on Cancel */}
      <Modal
        open={deleteModelConfirmOpen}
        onCancel={() => {
          if (!deletingModel) setDeleteModelConfirmOpen(false)
        }}
        labelledBy="delete-model-title"
        busy={deletingModel}
        cardClassName="w-80"
      >
        <div className="p-5">
          <h2
            id="delete-model-title"
            className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-1"
          >
            Delete geological model?
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
            <span className="font-medium text-gray-700 dark:text-gray-200">
              {activeGeologicalModel?.name ?? 'This model'}
            </span>{' '}
            and all its formations, contacts, and cached surfaces will be
            permanently deleted. This cannot be undone.
          </p>
          <div className="flex justify-end gap-2">
            {/* Cancel has default focus — safe default for an irreversible confirm
                dialog. See docs/ux.md: "default-focus on Cancel". */}
            <Button
              variant="secondary"
              size="md"
              // reason: autoFocus on Cancel is the safe default for a
              // destructive-confirm modal — the user must actively choose
              // the destructive action, not accidentally confirm it.
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              onClick={() => setDeleteModelConfirmOpen(false)}
              disabled={deletingModel}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="md"
              onClick={() => void confirmDeleteModel()}
              disabled={deletingModel}
            >
              {deletingModel ? 'Deleting…' : 'Delete geological model'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Plaxis 3D export is NOT here — stays in SectionsToolbar until
          the Export stage ships. See docs/geology-stage-architecture.md §3.3. */}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Internal helpers — copy 2 of Sections toolbar primitives.
// Extract to shell/ToolbarPrimitives.tsx on the third copy (Export stage).
// ---------------------------------------------------------------------------

interface PrimaryToolbarButtonProps {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  title?: string
}

/**
 * Accent-filled toolbar button for the primary entry action.
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
 *     Tooltip text.
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
 * Compact toolbar button for the Geology stage verbs.
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
 *     Tooltip text.
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
