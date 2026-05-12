/**
 * Interpretation pane — sidebar surface for the geological model.
 *
 * v1 (this turn): formations vocabulary management.
 *
 *   * Lists every formation in the project, sorted by display_order
 *     then name.
 *   * "+ Add formation" button → opens FormationDialog in create
 *     mode → POST /projects/{pid}/geology/formations.
 *   * Click a row → opens FormationDialog in edit mode →
 *     PATCH /projects/{pid}/geology/formations/{fid}.
 *   * Hover-trash on each row → confirm dialog → DELETE
 *     /projects/{pid}/geology/formations/{fid}. Backend cascades
 *     to any contacts pointing at the formation, so the warning
 *     mentions that explicitly.
 *
 * State is fetched on project change, kept locally for optimistic
 * UI updates, and falls through to the server for the source of
 * truth on next mount. Bundle-portable: every change rides in
 * ``project_bundle.geological_formations`` on next File → Save.
 *
 * Coming next (Slice 2): active geological model selector +
 * cross-section contact overlay.
 */

import { useCallback, useEffect, useState } from 'react'
import { Layers, Plus, Trash2 } from 'lucide-react'

import { api } from '../../api/client'
import type {
  GeologicalFormationCreatePayload,
  GeologicalFormationResponse,
  GeologicalFormationUpdatePayload,
} from '../../api/client'
import { log } from '../../utils/log'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import FormationDialog from './FormationDialog'

interface Props {
  projectId: string | null
}

export default function InterpretationPane({ projectId }: Props): JSX.Element {
  const [formations, setFormations] = useState<GeologicalFormationResponse[]>([])
  const [loading, setLoading] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<GeologicalFormationResponse | null>(null)
  const [pendingDelete, setPendingDelete] = useState<GeologicalFormationResponse | null>(
    null,
  )
  const [deleteBusy, setDeleteBusy] = useState(false)

  // Reload formations on project change. Failures stay quiet — an
  // empty list is the right fallback (the engineer sees the
  // "+ Add formation" button and can build from scratch).
  useEffect(() => {
    if (!projectId) {
      setFormations([])
      return
    }
    let cancelled = false
    setLoading(true)
    api.geology
      .listFormations(projectId)
      .then(rows => {
        if (cancelled) return
        setFormations(sortFormations(rows))
      })
      .catch(err => {
        log.warn('geology', `listFormations failed for ${projectId}`, err)
        if (!cancelled) setFormations([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectId])

  const handleCreate = useCallback(
    async (payload: GeologicalFormationCreatePayload | GeologicalFormationUpdatePayload) => {
      if (!projectId) return
      try {
        const created = await api.geology.createFormation(
          projectId,
          payload as GeologicalFormationCreatePayload,
        )
        setFormations(prev => sortFormations([...prev, created]))
        setDialogOpen(false)
        setEditing(null)
      } catch (err) {
        log.error('geology', 'createFormation failed', err)
      }
    },
    [projectId],
  )

  const handleUpdate = useCallback(
    async (payload: GeologicalFormationCreatePayload | GeologicalFormationUpdatePayload) => {
      if (!projectId || !editing) return
      try {
        const updated = await api.geology.updateFormation(
          projectId,
          editing.id,
          payload as GeologicalFormationUpdatePayload,
        )
        setFormations(prev =>
          sortFormations(prev.map(f => (f.id === updated.id ? updated : f))),
        )
        setDialogOpen(false)
        setEditing(null)
      } catch (err) {
        log.error('geology', 'updateFormation failed', err)
      }
    },
    [projectId, editing],
  )

  const handleDelete = useCallback(async () => {
    if (!projectId || !pendingDelete) return
    setDeleteBusy(true)
    try {
      await api.geology.deleteFormation(projectId, pendingDelete.id)
      setFormations(prev => prev.filter(f => f.id !== pendingDelete.id))
      setPendingDelete(null)
    } catch (err) {
      log.error('geology', 'deleteFormation failed', err)
    } finally {
      setDeleteBusy(false)
    }
  }, [projectId, pendingDelete])

  // No project yet — the pane is unreachable in this state because
  // the welcome screen owns the no-project view, but guard anyway.
  if (!projectId) {
    return (
      <div className="px-3 py-4 text-xs text-gray-400 italic">
        Open or create a project to manage formations.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 px-3 py-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-gray-700">
          <Layers size={14} className="text-amber-700" />
          <span className="text-xs font-medium">Formations</span>
          <span className="text-[10px] text-gray-400 tabular-nums">
            {formations.length}
          </span>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setEditing(null)
            setDialogOpen(true)
          }}
          title="Add a new formation to this project"
        >
          <Plus size={12} className="mr-1" />
          Add
        </Button>
      </div>

      {loading && formations.length === 0 && (
        <div className="text-[11px] text-gray-400 italic">Loading…</div>
      )}
      {!loading && formations.length === 0 && (
        <div className="text-[11px] text-gray-500 leading-snug">
          No formations yet. Add a substrate unit (e.g. <em>Boom Klei</em>) and
          the geological model editor lights up next.
        </div>
      )}

      {formations.length > 0 && (
        <ul className="flex flex-col gap-1">
          {formations.map(f => (
            <FormationRow
              key={f.id}
              formation={f}
              onEdit={() => {
                setEditing(f)
                setDialogOpen(true)
              }}
              onDelete={() => setPendingDelete(f)}
            />
          ))}
        </ul>
      )}

      <FormationDialog
        open={dialogOpen}
        initialValue={editing}
        onSubmit={editing ? handleUpdate : handleCreate}
        onCancel={() => {
          setDialogOpen(false)
          setEditing(null)
        }}
      />

      <Modal
        open={pendingDelete !== null}
        onCancel={() => setPendingDelete(null)}
        labelledBy="delete-formation-title"
        busy={deleteBusy}
      >
        <div className="p-5">
          <h2
            id="delete-formation-title"
            className="text-base font-semibold text-gray-800 mb-2"
          >
            Delete formation?
          </h2>
          <p className="text-xs text-gray-600 mb-4">
            <strong>{pendingDelete?.name}</strong> and every contact + geotech
            unit pointing at it will be removed from the geological model.
            This can&apos;t be undone (until File → Save the change isn&apos;t
            in the .gmproj yet — closing without saving reverts).
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              size="md"
              onClick={() => setPendingDelete(null)}
              disabled={deleteBusy}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="md"
              onClick={() => void handleDelete()}
              disabled={deleteBusy}
            >
              Delete
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function FormationRow({
  formation,
  onEdit,
  onDelete,
}: {
  formation: GeologicalFormationResponse
  onEdit: () => void
  onDelete: () => void
}): JSX.Element {
  return (
    <li className="group flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50">
      <span
        className="inline-block w-3.5 h-3.5 rounded border border-gray-300 shrink-0"
        style={{ backgroundColor: formation.color }}
        title={formation.color}
      />
      <button
        onClick={onEdit}
        className="flex-1 text-left min-w-0"
        title="Edit formation"
      >
        <div className="text-xs font-medium text-gray-800 truncate">
          {formation.name}
        </div>
        {formation.regional_ref && (
          <div className="text-[10px] text-gray-400 truncate">
            {formation.regional_ref}
          </div>
        )}
      </button>
      <button
        onClick={onDelete}
        title="Delete formation"
        className="p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <Trash2 size={11} />
      </button>
    </li>
  )
}

// Display order: ``display_order`` ascending, then case-insensitive
// name. Matches the backend list-endpoint ordering so the UI never
// shows a different sort than the bundle.
function sortFormations(
  rows: GeologicalFormationResponse[],
): GeologicalFormationResponse[] {
  return [...rows].sort((a, b) => {
    if (a.display_order !== b.display_order) return a.display_order - b.display_order
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
}
