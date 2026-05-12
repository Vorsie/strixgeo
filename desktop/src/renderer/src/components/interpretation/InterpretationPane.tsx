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

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Layers, Plus, Sparkles, Trash2 } from 'lucide-react'

import { api } from '../../api/client'
import type {
  GeologicalFormationCreatePayload,
  GeologicalFormationResponse,
  GeologicalFormationUpdatePayload,
} from '../../api/client'
import { hashHexColor } from '../../utils/hashColor'
import { log } from '../../utils/log'
import Button from '../ui/Button'
import DirtyAsterisk from '../ui/DirtyAsterisk'
import Modal from '../ui/Modal'
import FormationDialog from './FormationDialog'

// DOV observation types whose ``description`` field carries a
// formation / stratigraphy name (e.g. "Boom Klei", "Quartair").
// Mirrors the toggle keys exposed in BoreholeChannels but read
// here from the raw observation_type strings since the
// auto-populate flow walks borehole details directly.
const STRAT_OBS_TYPES = new Set(['formal_stratigraphy', 'informal_stratigraphy'])

interface Props {
  projectId: string | null
  /** Set of formation IDs that are part of the project's current
   * manifest — either restored from the saved .strix bundle or
   * created in the active session. Formations in the DB but NOT
   * in this set are treated as "unsaved from a previous session"
   * and stay invisible until the user re-creates them. */
  manifestFormationIds?: ReadonlySet<string>
  /** Set of formation IDs created in this session but not yet saved
   * to the .strix file. Drives the per-row amber visual. */
  sessionImportFormationIds?: ReadonlySet<string>
  /** Visible borehole IDs in the project — used by the
   * "Populate from boreholes" button to walk every borehole's
   * stratigraphy observations and extract unique formation names. */
  boreholeIds?: readonly string[]
  /** App-level callback fired after a successful POST so the
   * manifest + session-imports set update in lockstep with this
   * pane's local state. Without it the pane works but the project
   * doesn't flip dirty (defensive — test harnesses can mount
   * without wiring App). */
  onFormationCreated?: (id: string) => void
  /** Same shape, fired after a successful DELETE. */
  onFormationDeleted?: (id: string) => void
}

export default function InterpretationPane({
  projectId,
  manifestFormationIds,
  sessionImportFormationIds,
  boreholeIds,
  onFormationCreated,
  onFormationDeleted,
}: Props): JSX.Element {
  const [populateBusy, setPopulateBusy] = useState(false)
  const [populateResult, setPopulateResult] = useState<string | null>(null)
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

  // Manifest gate — formations in the DB but NOT in the manifest
  // are treated as "unsaved from a previous session" (a kill
  // killed the manifest, the .strix file doesn't list them).
  // When ``manifestFormationIds`` is undefined (no App wiring,
  // e.g. test harness), every fetched row is visible — defensive
  // pass-through. Declared early so the handlers below can read
  // it without hitting a TDZ.
  const visibleFormations = useMemo(() => {
    if (manifestFormationIds === undefined) return formations
    return formations.filter(f => manifestFormationIds.has(f.id))
  }, [formations, manifestFormationIds])

  const handleCreate = useCallback(
    async (payload: GeologicalFormationCreatePayload | GeologicalFormationUpdatePayload) => {
      if (!projectId) return
      try {
        const created = await api.geology.createFormation(
          projectId,
          payload as GeologicalFormationCreatePayload,
        )
        setFormations(prev => sortFormations([...prev, created]))
        // Flip the project to dirty + tag the new row with the
        // amber visual until the user runs File → Save.
        onFormationCreated?.(created.id)
        setDialogOpen(false)
        setEditing(null)
      } catch (err) {
        log.error('geology', 'createFormation failed', err)
      }
    },
    [projectId, onFormationCreated],
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

  // Walk every visible borehole's formal_stratigraphy + informal_
  // stratigraphy observations, harvest the unique formation names
  // from each layer's ``description``, dedupe against existing
  // formations (case-insensitive on name), and create a row per
  // new name with a deterministic hash-based colour.
  //
  // Client-side per-borehole fetch is the v1 implementation — for
  // projects with hundreds of boreholes a dedicated backend batch
  // endpoint will become the right move. Promote on second pain
  // signal; today the per-id loop is the only viable path that
  // doesn't require a backend change.
  const handlePopulateFromBoreholes = useCallback(async (): Promise<void> => {
    if (!projectId || populateBusy) return
    const ids = boreholeIds ?? []
    if (ids.length === 0) {
      setPopulateResult('No boreholes in this project yet.')
      return
    }
    setPopulateBusy(true)
    setPopulateResult(null)
    try {
      const results = await Promise.allSettled(ids.map(id => api.borehole.get(id)))
      // Aggregate unique descriptions across every stratigraphy
      // observation. Preserve case from first occurrence for
      // user-friendly display; dedupe key is lowercase for
      // robustness against DOV's mixed-case inputs.
      const byKey = new Map<string, string>()
      let failed = 0
      for (const r of results) {
        if (r.status !== 'fulfilled') {
          failed += 1
          continue
        }
        for (const obs of r.value.observations) {
          if (!STRAT_OBS_TYPES.has(obs.observation_type)) continue
          for (const layer of obs.layers) {
            const desc = (layer.description ?? '').trim()
            if (desc === '') continue
            const key = desc.toLowerCase()
            if (!byKey.has(key)) byKey.set(key, desc)
          }
        }
      }
      // Dedupe against the names already in the manifest-visible
      // formations list (the listFormations response). Case-
      // insensitive matching so "Boom Klei" doesn't double up
      // with "boom klei".
      const existingKeys = new Set(visibleFormations.map(f => f.name.toLowerCase()))
      const newNames = Array.from(byKey.entries())
        .filter(([key]) => !existingKeys.has(key))
        .map(([, display]) => display)
      // Create the new rows, sequentially so an error on one
      // doesn't leave partial state in the optimistic local list
      // without our control of order. Hash-based colour stays
      // deterministic across reseed.
      let createdCount = 0
      for (const name of newNames) {
        try {
          const created = await api.geology.createFormation(projectId, {
            name,
            color: hashHexColor(name),
          })
          setFormations(prev => sortFormations([...prev, created]))
          onFormationCreated?.(created.id)
          createdCount += 1
        } catch (err) {
          log.error('geology', `createFormation('${name}') failed`, err)
        }
      }
      const summary =
        createdCount === 0
          ? `No new formation names found in ${ids.length - failed} borehole${
              ids.length - failed === 1 ? '' : 's'
            }.`
          : `Added ${createdCount} formation${createdCount === 1 ? '' : 's'} from ` +
            `${ids.length - failed} borehole${ids.length - failed === 1 ? '' : 's'}` +
            (failed > 0 ? ` (${failed} fetch failures)` : '') +
            `.`
      setPopulateResult(summary)
    } finally {
      setPopulateBusy(false)
    }
  }, [projectId, populateBusy, boreholeIds, visibleFormations, onFormationCreated])

  const handleDelete = useCallback(async () => {
    if (!projectId || !pendingDelete) return
    setDeleteBusy(true)
    try {
      await api.geology.deleteFormation(projectId, pendingDelete.id)
      setFormations(prev => prev.filter(f => f.id !== pendingDelete.id))
      onFormationDeleted?.(pendingDelete.id)
      setPendingDelete(null)
    } catch (err) {
      log.error('geology', 'deleteFormation failed', err)
    } finally {
      setDeleteBusy(false)
    }
  }, [projectId, pendingDelete, onFormationDeleted])

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
            {visibleFormations.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void handlePopulateFromBoreholes()}
            disabled={populateBusy || (boreholeIds?.length ?? 0) === 0}
            title="Walk every borehole's stratigraphy observations and create a formation per unique name (deduped against existing). Auto-coloured. Manual add/edit/delete still works."
          >
            <Sparkles size={12} className="mr-1" />
            {populateBusy ? 'Working…' : 'From boreholes'}
          </Button>
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
      </div>

      {populateResult && (
        <div className="text-[11px] text-gray-500 italic leading-snug">
          {populateResult}
        </div>
      )}

      {loading && visibleFormations.length === 0 && (
        <div className="text-[11px] text-gray-400 italic">Loading…</div>
      )}
      {!loading && visibleFormations.length === 0 && (
        <div className="text-[11px] text-gray-500 leading-snug">
          No formations yet. Add a substrate unit (e.g. <em>Boom Klei</em>) and
          the geological model editor lights up next.
        </div>
      )}

      {visibleFormations.length > 0 && (
        <ul className="flex flex-col gap-1">
          {visibleFormations.map(f => (
            <FormationRow
              key={f.id}
              formation={f}
              unsaved={sessionImportFormationIds?.has(f.id) ?? false}
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
  unsaved,
  onEdit,
  onDelete,
}: {
  formation: GeologicalFormationResponse
  unsaved: boolean
  onEdit: () => void
  onDelete: () => void
}): JSX.Element {
  return (
    <li
      className={[
        'group flex items-center gap-2 px-2 py-1.5 rounded transition-colors',
        unsaved
          ? 'border-l-4 border-l-amber-500 bg-amber-100/70 hover:bg-amber-100/90'
          : 'border-l-2 border-l-transparent hover:bg-gray-50',
      ].join(' ')}
    >
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
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-gray-800 truncate">
            {formation.name}
          </span>
          {unsaved && (
            <DirtyAsterisk title="Created since last save — File → Save to commit" />
          )}
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
