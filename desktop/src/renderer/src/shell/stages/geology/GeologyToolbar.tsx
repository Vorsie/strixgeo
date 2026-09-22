// Stratigraphy stage toolbar — formation-definition and model-maintenance verbs.
//
// Verb order (left to right):
//   1. Fill from boreholes (primary accent) — opens FormationSelectionDialog
//      via discoverBoreholeFormations; apply calls applyBoreholeFormationSelection.
//   2. Separator.
//   3. Build 3D model — calls handleRebuildSurfaces; amber badge when stale.
//   4. Dedupe — model maintenance verb; DB-deletes contacts, so it goes through
//      DedupeContactsConfirmDialog first (see below) and only then calls
//      handleDedupeContacts.
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

import { useMemo, useRef, useState } from 'react'
import {
  Eraser,
  RefreshCw,
  Sparkles,
  Trash2,
  RotateCcw,
} from 'lucide-react'

import { useShell } from '../../ShellContext'
import { ToolbarButton, PrimaryToolbarButton } from '../../ToolbarPrimitives'
import ResponsiveToolbarRow, { type ToolbarItemSpec } from '../../ResponsiveToolbarRow'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'
import ConfirmDialog from '../../../components/ui/ConfirmDialog'
import DedupeContactsConfirmDialog from '../../../components/DedupeContactsConfirmDialog'
import { useDedupeContactsConfirm } from '../../../hooks/useDedupeContactsConfirm'
import { countDuplicateContacts } from '../../../utils/duplicateContacts'
import { computeDoomedFormations } from '../../../utils/formationDeletionScope'
import type { DoomedFormation } from '../../../utils/formationDeletionScope'
import FormationSelectionDialog from './FormationSelectionDialog'
import type { AutoPopulateMode } from '../../../api/client'
import type { FormationCandidate } from '../../../hooks/useGeologicalModel'
import {
  resetCameraCallback,
  resetSplitViewportCallback,
} from './GeologyCanvas'
import { useT } from '../../../i18n/translate'

/**
 * Stratigraphy-stage toolbar verbs wired from the ShellContext bus.
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
    lifecycle: { currentLumping },
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
  const t = useT()

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
  // A confirmed selection waiting on the add-vs-overwrite answer. Non-null
  // ONLY when the selection would remove something; a pure addition never
  // parks here. Carries the doomed units so the copy can name them.
  const [pendingApply, setPendingApply] = useState<{
    selectedKeys: ReadonlySet<string>
    manualMap: Record<string, string>
    doomed: DoomedFormation[]
  } | null>(null)
  // True while a map-change re-discover is in flight — drives the "Updating…"
  // label on the collision panel so the user sees feedback during the debounce
  // window and the subsequent network round-trip.
  const [updatingCollisions, setUpdatingCollisions] = useState(false)
  // Debounce timer for handleManualMapChange re-discovers.  A new group edit
  // cancels any pending timer before scheduling a fresh one, so rapid typing
  // fires at most one discover per 300 ms trailing edge.
  const mapChangeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Monotonic request counter for last-write-wins: if a slow response arrives
  // after a newer one has already set state, it is discarded.
  const discoverRequestIdRef = useRef(0)

  const [rebuilding, setRebuilding] = useState(false)

  // Dedupe deletes rows, so the button opens a confirmation instead of calling
  // the cleanup. The hook owns the dialog-open + in-flight pair; the Sections
  // inspector offers the same verb and uses the same one.
  const { confirmOpen, deduping, requestDedupe, cancelDedupe, confirmDedupe } =
    useDedupeContactsConfirm(handleDedupeContacts, activeGeologicalModel !== null)
  // What the run is expected to cost, from the contacts already loaded here —
  // the same model-wide list the server groups, so the dialog can name a number
  // instead of asking the engineer to trust a verb.
  const duplicates = useMemo(() => countDuplicateContacts(contacts), [contacts])

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
      // WHY initial-discover-carries-persisted-map: the dialog opens with
      // the persisted aliases already applied so the collision panel and
      // candidate list are immediately consistent.  Without this, the first
      // discover computes candidates/collisions WITHOUT the map, the dialog
      // opens in a transient wrong state, and the dialog's own useEffect
      // re-discovers with the restored map after a ~300 ms debounce — a
      // visible stale-collision window the user can see.  Passing the map
      // here makes the initial preview ≡ the post-useEffect preview.
      const persistedMap =
        currentLumping?.map && Object.keys(currentLumping.map).length > 0
          ? currentLumping.map
          : undefined
      const { candidates: found, collisions: cols } = await discoverBoreholeFormations(
        boreholeIds,
        persistedMap,
      )
      if (found.length === 0) {
        // No stratigraphy data — opening an empty dialog would be a silent
        // dead end on the stage's primary entry action (§10.4 / debt #33).
        // Surface the reason AND the alternative path so the user isn't
        // stuck. ('error' is the only non-success toast type.)
        toast('error', t('geology.noInterpretationData'))
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
  //
  // Debounced (300 ms trailing edge) so that rapid group edits (rename + add
  // member in quick succession) fire at most one network round-trip per burst.
  // Last-write-wins via discoverRequestIdRef: if a slow response arrives after
  // a newer one has already updated state, the stale response is discarded
  // rather than overwriting fresh data with phantom collisions.
  function handleManualMapChange(manualMap: Record<string, string>): void {
    if (pendingBoreholeIds.length === 0) return
    // Cancel any pending debounce timer from an earlier edit in the same burst.
    if (mapChangeDebounceRef.current !== null) {
      clearTimeout(mapChangeDebounceRef.current)
    }
    // Show "Updating…" immediately so the user sees the dialog is reacting to
    // their edit, even before the debounce window elapses.
    setUpdatingCollisions(true)
    mapChangeDebounceRef.current = setTimeout(() => {
      mapChangeDebounceRef.current = null
      const requestId = ++discoverRequestIdRef.current
      void discoverBoreholeFormations(pendingBoreholeIds, manualMap)
        .then(({ collisions: cols }) => {
          // Discard stale responses — a newer request has already resolved.
          if (requestId !== discoverRequestIdRef.current) return
          setCollisions(cols)
        })
        .catch(() => {
          // Silently ignore — the collision panel will just show stale data.
          // The error is already logged inside discoverBoreholeFormations.
        })
        .finally(() => {
          if (requestId === discoverRequestIdRef.current) {
            setUpdatingCollisions(false)
          }
        })
    }, 300)
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

  // 3. Dedupe contacts — see the useDedupeContactsConfirm wiring above.

  // 4. Confirm handler for FormationSelectionDialog.
  //    Receives stable keys (not display names) AND the manual_map at confirm
  //    time.  The SAME map used for the last preview is forwarded directly to
  //    the apply call — no re-discover between dialog confirm and the API call.
  //    This preserves the discover ≡ apply invariant the backend enforces.
  //
  //    Apply is where the 2026-08-03 data loss happened: a run meant to ADD one
  //    unit removed four saved ones, because a selection was, by itself, an
  //    instruction to delete everything else.  So Apply now asks — but ONLY
  //    when something would actually be removed.  A pure addition is harmless
  //    and gets no dialog; putting one there would train the engineer to click
  //    through the prompt that matters.
  function handleSelectionConfirm(
    selectedKeys: ReadonlySet<string>,
    manualMap: Record<string, string>,
  ): void {
    setSelectionDialogOpen(false)
    // Cancel any pending debounce timer — the dialog is closing; stale
    // collision updates arriving after this point would be discarded by the
    // requestId guard anyway, but cancelling the timer avoids the network call.
    if (mapChangeDebounceRef.current !== null) {
      clearTimeout(mapChangeDebounceRef.current)
      mapChangeDebounceRef.current = null
    }
    setUpdatingCollisions(false)
    const doomed = computeDoomedFormations(formations, contacts, selectedKeys)
    if (doomed.length === 0) {
      void runApply(selectedKeys, manualMap, 'add')
      return
    }
    setPendingApply({ selectedKeys, manualMap, doomed })
  }

  // Fire the actual apply once the mode is settled — either because nothing
  // would be removed, or because the user answered the prompt.
  async function runApply(
    selectedKeys: ReadonlySet<string>,
    manualMap: Record<string, string>,
    mode: AutoPopulateMode,
  ): Promise<void> {
    setPendingApply(null)
    setApplying(true)
    try {
      await applyBoreholeFormationSelection(
        selectedKeys,
        pendingBoreholeIds,
        Object.keys(manualMap).length > 0 ? manualMap : undefined,
        mode,
      )
      // Stage-on-apply is handled inside applyBoreholeFormationSelection:
      // it calls stageLumping (injected into useGeologicalModel from App.tsx)
      // which marks the project dirty so File→Save persists the alias map.
      // No duplicate write here.
    } catch (err) {
      // applyBoreholeFormationSelection logs + throws; toast the failure here
      // so the Stratigraphy stage surfaces it even when the error originates deep
      // in the hook (previously this path was silently swallowed).
      toast('error', t('geology.applyFailed'))
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
    } catch (err) {
      // The server's 409 guard ("delete the dependent litho/geotech model
      // first") arrives as the Error message — show it instead of letting
      // it become a silent uncaught rejection.
      toast('error', err instanceof Error ? err.message : t('geology.deleteFailed'))
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
      ? t('geology.buildStale', { n: staleSurfaceCount })
      : t('geology.build3d')

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const fillLabel = discovering
    ? t('geology.scanning')
    : applying
      ? t('geology.applying')
      : t('geology.fillFromBoreholes')

  const resetView = (): void => {
    resetSplitViewportCallback.current?.()
    resetCameraCallback.current?.()
  }

  const requestDeleteModel = (): void => {
    if (!hasModel || deletingModel) return
    setDeleteModelConfirmOpen(true)
  }

  // Priority order, same rationale as the sections bar (see
  // ``shell/toolbarOverflow.ts``): the two verbs a geology session is built
  // around — Fill from boreholes and Build 3D model — hold their labels
  // longest; Dedupe and Reset view are occasional; the destructive Delete
  // never becomes a bare icon.
  const toolbarItems: ToolbarItemSpec[] = [
    /* Fill from boreholes — primary accent entry action. Opens the
        curated FormationSelectionDialog after a read-only discovery scan.
        Matches the §10 design: does NOT call auto-populate directly. */
    {
      id: 'geology-fill-from-boreholes-button',
      priority: 'high',
      kind: 'button',
      label: fillLabel,
      overflowItems: [
        {
          label: t('geology.fillFromBoreholes'),
          icon: <Sparkles size={12} />,
          onClick: () => void handleFillFromBoreholes(),
          disabled: !canFill,
        },
      ],
      render: p => (
        <PrimaryToolbarButton
          iconOnly={p === 'icon'}
          icon={<Sparkles size={13} />}
          label={fillLabel}
          onClick={() => void handleFillFromBoreholes()}
          disabled={!canFill}
          busy={discovering || applying}
          testid="geology-fill-from-boreholes-button"
          title={
            visibleBoreholes.length === 0
              ? t('geology.noBoreholesVisible')
              : discovering
                ? t('geology.scanningStratigraphy')
                : applying
                  ? t('geology.applyingSelection')
                  : t('geology.fillTitle')
          }
        />
      ),
    },

    /* Build 3D model — amber badge when surfaces are stale.
        Debt #94: gate on contact presence too. With zero contacts the
        Delaunay pass has nothing to triangulate; clicking is a no-op
        that confuses dogfeed users. Tooltip points to the cross-
        section view as the place to place contacts. */
    {
      id: 'geology-build-model-button',
      priority: 'high',
      kind: 'button',
      label: rebuilding ? t('geology.building') : staleLabel,
      separatorBefore: true,
      overflowItems: [
        {
          label: t('geology.build3d'),
          icon: <RefreshCw size={12} />,
          onClick: () => void handleBuild(),
          disabled: rebuilding || !hasModel || contacts.length === 0,
        },
      ],
      render: p => (
        <ToolbarButton
          iconOnly={p === 'icon'}
          icon={<RefreshCw size={13} className={rebuilding ? 'animate-spin' : ''} />}
          label={rebuilding ? t('geology.building') : staleLabel}
          onClick={() => void handleBuild()}
          disabled={rebuilding || !hasModel || contacts.length === 0}
          amber={staleSurfaceCount > 0 && !rebuilding && contacts.length > 0}
          testid="geology-build-model-button"
          title={
            !hasModel
              ? t('geology.buildNoModel')
              : contacts.length === 0
                ? t('geology.buildNoContacts')
                : rebuilding
                  ? t('geology.building3d')
                  : staleSurfaceCount > 0
                    ? t(
                        staleSurfaceCount === 1
                          ? 'geology.surfacesNeedRebuildOne'
                          : 'geology.surfacesNeedRebuildMany',
                        { n: staleSurfaceCount },
                      )
                    : t('geology.rebuildTins')
          }
        />
      ),
    },

    /* Dedupe contacts — maintenance verb */
    {
      id: 'geology-dedupe',
      priority: 'low',
      kind: 'button',
      label: deduping ? t('geology.cleaning') : t('geology.dedupe'),
      overflowItems: [
        {
          label: t('geology.dedupeContacts'),
          icon: <Eraser size={12} />,
          onClick: requestDedupe,
          disabled: !hasModel || deduping,
        },
      ],
      render: p => (
        <ToolbarButton
          iconOnly={p === 'icon'}
          icon={<Eraser size={13} />}
          label={deduping ? t('geology.cleaning') : t('geology.dedupe')}
          onClick={requestDedupe}
          disabled={!hasModel || deduping}
          busy={deduping}
          testid="geology-dedupe"
          title={
            !hasModel
              ? t('geology.noActiveStratigraphy')
              : deduping
                ? t('geology.cleaning')
                : t('geology.dedupeTitle')
          }
        />
      ),
    },

    /* Reset view — collapses split viewport + flies camera to model bounds.
        Calls the module-level callbacks exported by GeologyCanvas rather
        than routing through the bus (session-ephemeral view state). */
    {
      id: 'geology-reset-view',
      priority: 'low',
      kind: 'button',
      label: t('geology.resetView'),
      separatorBefore: true,
      overflowItems: [
        {
          label: t('geology.reset3dView'),
          icon: <RotateCcw size={12} />,
          onClick: resetView,
          disabled: !hasModel,
        },
      ],
      render: p => (
        <ToolbarButton
          iconOnly={p === 'icon'}
          icon={<RotateCcw size={13} />}
          label={t('geology.resetView')}
          onClick={resetView}
          disabled={!hasModel}
          title={
            !hasModel
              ? t('geology.noActiveStratigraphy')
              : t('geology.resetViewTitle')
          }
        />
      ),
    },

    /* Delete stratigraphy — irreversible; opens a confirm modal.
        ``iconOnly: false`` per docs/ux.md — this deletes the whole model,
        every formation, contact and surface. A bare trash icon is not an
        acceptable presentation for that. */
    {
      id: 'geology-delete-stratigraphy',
      priority: 'medium',
      kind: 'button',
      label: deletingModel ? t('geology.deleting') : t('geology.deleteStratigraphyShort'),
      iconOnly: false,
      overflowItems: [
        {
          label: t('geology.deleteStratigraphy'),
          icon: <Trash2 size={12} />,
          onClick: requestDeleteModel,
          disabled: !hasModel || deletingModel,
        },
      ],
      render: () => (
        <ToolbarButton
          icon={<Trash2 size={13} />}
          label={deletingModel ? t('geology.deleting') : t('geology.deleteStratigraphyShort')}
          onClick={requestDeleteModel}
          disabled={!hasModel || deletingModel}
          busy={deletingModel}
          danger
          testid="geology-delete-stratigraphy"
          title={
            !hasModel
              ? t('geology.noActiveStratigraphy')
              : t('geology.deleteStratigraphyTitle')
          }
        />
      ),
    },
  ]

  return (
    <>
      <ResponsiveToolbarRow items={toolbarItems} overflowMenuLabel={t('geology.moreActions')} />

      {/* Dedupe confirmation — the gate the maintenance verb never had. */}
      <DedupeContactsConfirmDialog
        open={confirmOpen}
        duplicateContacts={duplicates.contacts}
        duplicatePairs={duplicates.pairs}
        busy={deduping}
        onCancel={cancelDedupe}
        onConfirm={confirmDedupe}
      />

      {/* Formation selection dialog — opened after a successful discovery scan.
          onManualMapChange re-runs discover with the current map so the
          collision panel inside the dialog stays live as the user edits groups. */}
      <FormationSelectionDialog
        open={selectionDialogOpen}
        candidates={candidates}
        // Bug 3 fix: prefill the row reassignment dropdowns from the last
        // persisted lumping snapshot so the user sees their prior aliases
        // when they reopen "Fill from boreholes" on an already-applied project.
        initialReassignments={currentLumping?.map}
        collisions={collisions}
        currentFormations={formations}
        currentContacts={contacts}
        collisionsUpdating={updatingCollisions}
        onManualMapChange={handleManualMapChange}
        onConfirm={handleSelectionConfirm}
        onCancel={() => {
          setSelectionDialogOpen(false)
          setPendingBoreholeIds([])
          setCollisions([])
          setUpdatingCollisions(false)
          if (mapChangeDebounceRef.current !== null) {
            clearTimeout(mapChangeDebounceRef.current)
            mapChangeDebounceRef.current = null
          }
        }}
      />

      {/* Add-vs-overwrite prompt (2026-08-03 data-loss ruling).
          Shown ONLY when the selection would remove existing units — a pure
          addition applies without asking.  Cancel is default-focused and
          leftmost (docs/ux.md irreversible-action rules); the destructive
          option is the middle button and names every unit it would remove, so
          the choice is made against facts rather than a count. */}
      <ConfirmDialog
        open={pendingApply !== null}
        labelledBy="fill-mode-title"
        testid="fill-mode-confirm-dialog"
        cardClassName="w-[26rem]"
        title={t('geology.addOrReplace')}
        body={
          <>
            <p>
              {t('geology.selectionExcludePrefix')}{' '}
              <span className="font-medium text-text-primary">
                {t('geology.unitCount', {
                  n: pendingApply?.doomed.length ?? 0,
                  unit: t(
                    (pendingApply?.doomed.length ?? 0) === 1
                      ? 'geology.unitWordOne'
                      : 'geology.unitWordMany',
                  ),
                })}
              </span>{' '}
              {t('geology.selectionExcludeSuffix')}
            </p>
            <p className="mt-2">
              <span className="font-medium text-text-primary">{t('geology.addToModel')}</span>{' '}
              {t('geology.addToModelExplain')}
            </p>
            <p className="mt-1 text-status-danger">
              <span className="font-medium">{t('geology.overwriteModel')}</span>{' '}
              {t('geology.overwriteExplainPrefix', {
                n: pendingApply?.doomed.length ?? 0,
                unit: t(
                  (pendingApply?.doomed.length ?? 0) === 1
                    ? 'geology.unitWordOne'
                    : 'geology.unitWordMany',
                ),
              })}{' '}
              {(pendingApply?.doomed ?? []).map(f => f.name).join(', ')}
              {', '}
              {t('geology.overwriteExplainSuffix')}
            </p>
          </>
        }
        secondary={{
          label: t('geology.overwriteModel'),
          variant: 'danger',
          testid: 'fill-mode-overwrite',
          onClick: () => {
            if (pendingApply === null) return
            void runApply(pendingApply.selectedKeys, pendingApply.manualMap, 'overwrite')
          },
        }}
        confirm={{
          label: t('geology.addToModel'),
          variant: 'primary',
          testid: 'fill-mode-add',
          onClick: () => {
            if (pendingApply === null) return
            void runApply(pendingApply.selectedKeys, pendingApply.manualMap, 'add')
          },
        }}
        cancelTestid="fill-mode-cancel"
        onCancel={() => {
          // Cancel abandons the whole Apply — nothing is created and nothing is
          // removed. The selection dialog is already closed; reopening Fill
          // restores it from the persisted lumping snapshot.
          setPendingApply(null)
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
            {t('geology.deleteModelConfirm')}
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
            <span className="font-medium text-gray-700 dark:text-gray-200">
              {activeGeologicalModel?.name ?? t('geology.thisModel')}
            </span>{' '}
            {t('geology.deleteModelBody')}
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
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              size="md"
              onClick={() => void confirmDeleteModel()}
              disabled={deletingModel}
            >
              {deletingModel ? t('geology.deleting') : t('geology.deleteModelButton')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Plaxis 3D export is NOT here — stays in SectionsToolbar until
          the Export stage ships. See docs/geology-stage-architecture.md §3.3. */}
    </>
  )
}
