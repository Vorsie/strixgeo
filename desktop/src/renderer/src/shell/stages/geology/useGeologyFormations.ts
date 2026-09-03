// Geology inspector — formation roster CRUD + drag-reorder state block.
//
// Extracted verbatim from GeologyInspector.tsx (debt #201 god-component
// decomposition round). This custom hook OWNS the formation-list block the
// orchestrator used to hold inline: the local ``formations`` mirror, the
// bus-sync effect, the create/edit/delete dialog state, the drag-reorder
// state, and the mutation handlers (each pushing its own undo command). The
// orchestrator now calls it once and threads the returned state + handlers into
// the presentational siblings. The intricate reorder logic lives in
// ``reorderFormationsCommand.ts`` (file-cap split); the hook keeps a thin
// wrapper.
//
// Behaviour is unchanged — the local ``formations`` mirror is still the
// optimistic-update target, while the render reads the bus ``visibleFormations``
// (so a mutation shows on screen only once the bus refreshes, as before).

import { useCallback, useEffect, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

import { api } from '../../../api/client'
import type {
  GeologicalFormationCreatePayload,
  GeologicalFormationResponse,
  GeologicalFormationUpdatePayload,
} from '../../../api/client'
import { log } from '../../../utils/log'
import type { UndoCommand } from '../../../hooks/useUndoStack'
import { reorderFormationsCommand, sortFormations } from './reorderFormationsCommand'

/** Inputs the hook needs from the shell bus (all sourced by the orchestrator's
 *  ``useShell()`` destructure). */
export interface UseGeologyFormationsArgs {
  /** Active project id — every mutation is project-scoped. */
  projectId: string
  /** The bus formation list — seeds + re-syncs the local mirror. */
  busFormations: GeologicalFormationResponse[]
  /** Bumps whenever a mutation bypasses the local state; re-seeds the mirror. */
  formationsRefreshCounter: number
  /** Visible-formation manifest — reorder derives its visible list from it. */
  manifestFormationIds: ReadonlySet<string>
  /** Bus notifier fired after a formation is created (id). */
  handleFormationCreated: (id: string) => void
  /** Bus notifier fired after a formation is updated. */
  handleFormationUpdated: () => void
  /** Bus notifier fired after a formation is deleted (id). */
  handleFormationDeleted: (id: string) => void
  /** Re-fetches the formation list from the server (reorder failure recovery). */
  refetchFormations: () => Promise<void>
  /** Pushes an undo command onto the shell undo stack. */
  pushUndoCommand: (cmd: UndoCommand) => void
}

/** The state + handlers the hook exposes to the orchestrator and its siblings. */
export interface UseGeologyFormationsResult {
  dialogOpen: boolean
  setDialogOpen: Dispatch<SetStateAction<boolean>>
  editing: GeologicalFormationResponse | null
  setEditing: Dispatch<SetStateAction<GeologicalFormationResponse | null>>
  pendingDelete: GeologicalFormationResponse | null
  setPendingDelete: Dispatch<SetStateAction<GeologicalFormationResponse | null>>
  deleteBusy: boolean
  draggedId: string | null
  setDraggedId: Dispatch<SetStateAction<string | null>>
  dragOverId: string | 'end' | null
  setDragOverId: Dispatch<SetStateAction<string | 'end' | null>>
  reorderBusy: boolean
  reorderFormations: (sourceId: string, targetId: string | 'end') => Promise<void>
  handleCreate: (
    payload: GeologicalFormationCreatePayload | GeologicalFormationUpdatePayload,
  ) => Promise<void>
  handleUpdate: (
    payload: GeologicalFormationCreatePayload | GeologicalFormationUpdatePayload,
  ) => Promise<void>
  handleUpdateFormationColor: (
    formation: GeologicalFormationResponse,
    newColor: string,
  ) => Promise<void>
  handleDelete: () => Promise<void>
}

/**
 * Owns the geology inspector's formation-roster CRUD + drag-reorder block.
 *
 * Every state slice and handler here was lifted verbatim from
 * ``GeologyInspector`` (debt #201); the hook exists so the orchestrator stays a
 * thin composer of presentational siblings.
 *
 * Parameters
 * ----------
 * args
 *     Bus state + notifiers the handlers read (see {@link UseGeologyFormationsArgs}).
 *
 * Returns
 * -------
 * UseGeologyFormationsResult
 *     Dialog / drag state, their setters, and the mutation handlers.
 */
export function useGeologyFormations(
  args: UseGeologyFormationsArgs,
): UseGeologyFormationsResult {
  const {
    projectId,
    busFormations,
    formationsRefreshCounter,
    manifestFormationIds,
    handleFormationCreated,
    handleFormationUpdated,
    handleFormationDeleted,
    refetchFormations,
    pushUndoCommand,
  } = args

  // Local formation list — sorted copy of the bus formations.
  // Initialised from the bus; kept in sync via formationsRefreshCounter effect.
  const [formations, setFormations] = useState<GeologicalFormationResponse[]>(() =>
    sortFormations(busFormations),
  )

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<GeologicalFormationResponse | null>(null)
  const [pendingDelete, setPendingDelete] = useState<GeologicalFormationResponse | null>(
    null,
  )
  const [deleteBusy, setDeleteBusy] = useState(false)

  // Drag-to-reorder state.
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | 'end' | null>(null)
  const [reorderBusy, setReorderBusy] = useState(false)

  // ---------------------------------------------------------------------------
  // Sync from bus on formationsRefreshCounter change.
  // This covers auto-populate runs and any mutation that bypasses the local
  // state. The initial seed above covers the first mount.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    setFormations(sortFormations(busFormations))
  }, [busFormations, formationsRefreshCounter])

  // ---------------------------------------------------------------------------
  // reorderFormations — thin wrapper over the pure command (file-cap split).
  // The deps array + eslint-disable are preserved verbatim from the original.
  // ---------------------------------------------------------------------------
  const reorderFormations = useCallback(
    (sourceId: string, targetId: string | 'end') =>
      reorderFormationsCommand(
        {
          projectId,
          formations,
          manifestFormationIds,
          setFormations,
          setReorderBusy,
          handleFormationUpdated,
          pushUndoCommand,
          refetchFormations,
        },
        sourceId,
        targetId,
      ),
    // reason: manifestFormationIds is stable across renders within the same
    // project; it changes only when the manifest is persisted. Including it
    // here is correct — reorderFormations reads it to derive the visible list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectId, formations, manifestFormationIds, handleFormationUpdated, pushUndoCommand, refetchFormations],
  )

  // ---------------------------------------------------------------------------
  // Create / update handlers
  // ---------------------------------------------------------------------------

  const handleCreate = useCallback(
    async (
      payload: GeologicalFormationCreatePayload | GeologicalFormationUpdatePayload,
    ) => {
      try {
        const created = await api.geology.createFormation(
          projectId,
          payload as GeologicalFormationCreatePayload,
        )
        setFormations(prev => sortFormations([...prev, created]))
        handleFormationCreated(created.id)
        setDialogOpen(false)
        setEditing(null)
        let currentId = created.id
        pushUndoCommand({
          description: 'Create formation',
          revert: async () => {
            await api.geology.deleteFormation(projectId, currentId)
            setFormations(prev => prev.filter(f => f.id !== currentId))
            handleFormationDeleted(currentId)
          },
          reapply: async () => {
            const recreated = await api.geology.createFormation(
              projectId,
              payload as GeologicalFormationCreatePayload,
            )
            currentId = recreated.id
            setFormations(prev => sortFormations([...prev, recreated]))
            handleFormationCreated(recreated.id)
          },
        })
      } catch (err) {
        log.error('geology', 'createFormation failed', err)
      }
    },
    [projectId, handleFormationCreated, handleFormationDeleted, pushUndoCommand],
  )

  const handleUpdate = useCallback(
    async (
      payload: GeologicalFormationCreatePayload | GeologicalFormationUpdatePayload,
    ) => {
      if (!editing) return
      try {
        const before = editing
        const updated = await api.geology.updateFormation(
          projectId,
          editing.id,
          payload as GeologicalFormationUpdatePayload,
        )
        setFormations(prev =>
          sortFormations(prev.map(f => (f.id === updated.id ? updated : f))),
        )
        handleFormationUpdated()
        setDialogOpen(false)
        setEditing(null)
        const beforePayload: GeologicalFormationUpdatePayload = {
          name: before.name,
          color: before.color,
          code: before.code,
          regional_ref: before.regional_ref,
          description: before.description,
          display_order: before.display_order,
        }
        pushUndoCommand({
          description: 'Edit formation',
          revert: async () => {
            const back = await api.geology.updateFormation(
              projectId,
              before.id,
              beforePayload,
            )
            setFormations(prev =>
              sortFormations(prev.map(f => (f.id === back.id ? back : f))),
            )
            handleFormationUpdated()
          },
          reapply: async () => {
            const fwd = await api.geology.updateFormation(
              projectId,
              before.id,
              payload as GeologicalFormationUpdatePayload,
            )
            setFormations(prev =>
              sortFormations(prev.map(f => (f.id === fwd.id ? fwd : f))),
            )
            handleFormationUpdated()
          },
        })
      } catch (err) {
        log.error('geology', 'updateFormation failed', err)
      }
    },
    [projectId, editing, handleFormationUpdated, pushUndoCommand],
  )

  // ---------------------------------------------------------------------------
  // Inline colour swatch override.
  //
  // The list-row swatch is a clickable label wrapping a native colour input;
  // changing it commits a one-field PATCH against ``formation.color`` and
  // pushes an undo command that restores the previous colour. No new
  // persistence layer — the override rides on the existing project-scoped
  // ``GeologicalFormation.color`` field, so it flows through to the section
  // editor, 3D viewer, and DXF/Plaxis exports automatically and ships in the
  // .gmproj bundle on next save. See
  // ``docs/superpowers/specs/2026-05-30-formation-color-swatch-override-design.md``.
  // ---------------------------------------------------------------------------
  const handleUpdateFormationColor = useCallback(
    async (
      formation: GeologicalFormationResponse,
      newColor: string,
    ): Promise<void> => {
      const oldColor = formation.color
      if (newColor === oldColor) return
      try {
        const updated = await api.geology.updateFormation(
          projectId,
          formation.id,
          { color: newColor },
        )
        setFormations(prev =>
          sortFormations(prev.map(f => (f.id === updated.id ? updated : f))),
        )
        handleFormationUpdated()
        pushUndoCommand({
          description: 'Recolor formation',
          revert: async () => {
            const back = await api.geology.updateFormation(
              projectId,
              formation.id,
              { color: oldColor },
            )
            setFormations(prev =>
              sortFormations(prev.map(f => (f.id === back.id ? back : f))),
            )
            handleFormationUpdated()
          },
          reapply: async () => {
            const fwd = await api.geology.updateFormation(
              projectId,
              formation.id,
              { color: newColor },
            )
            setFormations(prev =>
              sortFormations(prev.map(f => (f.id === fwd.id ? fwd : f))),
            )
            handleFormationUpdated()
          },
        })
      } catch (err) {
        log.error('geology', 'updateFormation (color) failed', err)
      }
    },
    [projectId, handleFormationUpdated, pushUndoCommand],
  )

  // ---------------------------------------------------------------------------
  // Delete handler
  // ---------------------------------------------------------------------------

  const handleDelete = useCallback(async () => {
    if (!pendingDelete) return
    setDeleteBusy(true)
    try {
      const snapshot = pendingDelete
      await api.geology.deleteFormation(projectId, snapshot.id)
      setFormations(prev => prev.filter(f => f.id !== snapshot.id))
      handleFormationDeleted(snapshot.id)
      setPendingDelete(null)
      const recreatePayload: GeologicalFormationCreatePayload = {
        name: snapshot.name,
        color: snapshot.color,
        code: snapshot.code ?? undefined,
        regional_ref: snapshot.regional_ref ?? undefined,
        description: snapshot.description ?? undefined,
        display_order: snapshot.display_order,
      }
      let currentId: string | null = null
      pushUndoCommand({
        description: 'Delete formation',
        revert: async () => {
          const recreated = await api.geology.createFormation(
            projectId,
            recreatePayload,
          )
          currentId = recreated.id
          setFormations(prev => sortFormations([...prev, recreated]))
          handleFormationCreated(recreated.id)
        },
        reapply: async () => {
          if (!currentId) return
          await api.geology.deleteFormation(projectId, currentId)
          const deletedId = currentId
          setFormations(prev => prev.filter(f => f.id !== deletedId))
          handleFormationDeleted(deletedId)
          currentId = null
        },
      })
    } catch (err) {
      log.error('geology', 'deleteFormation failed', err)
    } finally {
      setDeleteBusy(false)
    }
  }, [
    projectId,
    pendingDelete,
    handleFormationCreated,
    handleFormationDeleted,
    pushUndoCommand,
  ])

  return {
    dialogOpen,
    setDialogOpen,
    editing,
    setEditing,
    pendingDelete,
    setPendingDelete,
    deleteBusy,
    draggedId,
    setDraggedId,
    dragOverId,
    setDragOverId,
    reorderBusy,
    reorderFormations,
    handleCreate,
    handleUpdate,
    handleUpdateFormationColor,
    handleDelete,
  }
}
