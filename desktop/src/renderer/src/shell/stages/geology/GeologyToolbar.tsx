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
// PrimaryToolbarButton / ToolbarButton now live in the shared
// shell/ToolbarPrimitives.tsx (extracted at the rule-of-three window,
// debt #46) — they carry the in-button ``busy`` spinner every long
// verb here passes.
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
import { ToolbarButton, PrimaryToolbarButton } from '../../ToolbarPrimitives'
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
    lifecycle: { writeLumpingSnapshot },
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
  // Collisions from the last discover scan — rendered in the dialog as warnings.
  // Updated live when the user edits manual groups (onManualMapChange re-runs discover).
  const [collisions, setCollisions] = useState<import('../../../hooks/useGeologicalModel').LumpingCollision[]>([])
  // boreholeIds captured at discover time — reused when re-running discover
  // after manual_map changes and when applying the confirmed selection.
  const [pendingBoreholeIds, setPendingBoreholeIds] = useState<string[]>([])
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
      const { candidates: found, collisions: cols } = await discoverBoreholeFormations(boreholeIds)
      if (found.length === 0) {
        // No stratigraphy data — opening an empty dialog would be a silent
        // dead end on the stage's primary entry action (§10.4 / debt #33).
        // Surface the reason AND the alternative path so the user isn't
        // stuck. ('error' is the only non-success toast type.)
        toast(
          'error',
          'No borehole carries interpretation data — add formations manually in the inspector instead.',
        )
        return
      }
      setCandidates(found)
      setCollisions(cols)
      setPendingBoreholeIds(boreholeIds)
      setSelectionDialogOpen(true)
    } finally {
      setDiscovering(false)
    }
  }

  // Re-run discover with the updated manual_map when the user edits groups.
  // Called by FormationSelectionDialog.onManualMapChange. Does NOT close the
  // dialog — only updates the collision panel inside it.
  async function handleManualMapChange(manualMap: Record<string, string>): Promise<void> {
    if (pendingBoreholeIds.length === 0) return
    try {
      const { collisions: cols } = await discoverBoreholeFormations(pendingBoreholeIds, manualMap)
      setCollisions(cols)
    } catch {
      // Silently ignore — the collision panel will just show stale data.
      // The error is already logged inside discoverBoreholeFormations.
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
  //    Receives stable keys (not display names) AND the manual_map at confirm
  //    time.  The SAME map used for the last preview is forwarded directly to
  //    the apply call — no re-discover between dialog confirm and the API call.
  //    This preserves the discover ≡ apply invariant the backend enforces.
  async function handleSelectionConfirm(
    selectedKeys: ReadonlySet<string>,
    manualMap: Record<string, string>,
  ): Promise<void> {
    setSelectionDialogOpen(false)
    setApplying(true)
    try {
      await applyBoreholeFormationSelection(
        selectedKeys,
        pendingBoreholeIds,
        Object.keys(manualMap).length > 0 ? manualMap : undefined,
      )
      // Atomically write the lumping snapshot into the .gmproj file so the
      // user's grouping is remembered the next time they open Fill from boreholes
      // on this project — even if they never File→Save before closing.
      // Only written when the user provided a non-empty map (no-lump path
      // produces the same contacts whether or not a snapshot is stored).
      if (Object.keys(manualMap).length > 0) {
        try {
          await writeLumpingSnapshot({
            schema_version: 1,
            applied_at: new Date().toISOString(),
            map: manualMap,
          })
        } catch {
          // Non-fatal: the apply succeeded; the lumping map just won't be
          // pre-populated next time.  Error is logged inside writeLumpingSnapshot.
        }
      }
    } catch (err) {
      // applyBoreholeFormationSelection logs + throws; toast the failure here
      // so the Geology stage surfaces it even when the error originates deep
      // in the hook (previously this path was silently swallowed).
      toast('error', 'Could not apply formation selection — check the connection.')
    } finally {
      setApplying(false)
      setPendingBoreholeIds([])
      setCollisions([])
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
        busy={discovering || applying}
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
        busy={deduping}
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
        busy={deletingModel}
        danger
        title={
          !hasModel
            ? 'No active stratigraphy'
            : 'Permanently delete the active geological model and all its formations, contacts, and surfaces'
        }
      />

      {/* Formation selection dialog — opened after a successful discovery scan.
          onManualMapChange re-runs discover with the current map so the
          collision panel inside the dialog stays live as the user edits groups. */}
      <FormationSelectionDialog
        open={selectionDialogOpen}
        candidates={candidates}
        collisions={collisions}
        currentFormations={formations}
        currentContacts={contacts}
        onManualMapChange={map => void handleManualMapChange(map)}
        onConfirm={(selectedKeys, manualMap) => void handleSelectionConfirm(selectedKeys, manualMap)}
        onCancel={() => {
          setSelectionDialogOpen(false)
          setPendingBoreholeIds([])
          setCollisions([])
        }}
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
