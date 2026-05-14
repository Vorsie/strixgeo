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
import { ChevronDown, ChevronRight, Drill, Layers, Plus, Sparkles, Trash2 } from 'lucide-react'

import { api } from '../../api/client'
import type {
  BoreholeListItem,
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
  /** Name of the project's active geological model. Surfaced as a
   * small subtitle in the pane header so the user knows which
   * model their formation picks belong to. v1 auto-bootstraps a
   * "Default" model per project so this is rarely null. */
  activeModelName?: string | null
  /** Visible boreholes in the project — the "Boreholes in model"
   * sub-section lists every one of these with a checkbox. */
  modelBoreholes?: readonly BoreholeListItem[]
  /** Borehole IDs the active model EXCLUDES from contact rendering /
   * placement. A row's checkbox shows checked when the borehole's
   * id is NOT in this set. */
  excludedBoreholeIds?: readonly string[]
  /** Fires when the user flips a borehole's checkbox. Caller
   * (App.tsx) PATCHes the model with the new exclusion list. */
  onToggleBoreholeInModel?: (
    boreholeId: string,
    included: boolean,
  ) => void | Promise<void>
  /** App-level callback fired after a successful POST so the
   * manifest + session-imports set update in lockstep with this
   * pane's local state. Without it the pane works but the project
   * doesn't flip dirty (defensive — test harnesses can mount
   * without wiring App). */
  onFormationCreated?: (id: string) => void
  /** Same shape, fired after a successful DELETE. */
  onFormationDeleted?: (id: string) => void
  /** Fires after a successful PATCH (rename / recolour). App
   * resyncs its cached formations list so SectionPanel's picker
   * + ContactsLayer pick up the change without a reload. */
  onFormationUpdated?: (id: string) => void
  /** Refresh signal — when the integer increases the pane refetches
   * its formations list from the API. App bumps it after server-
   * side mutations that the pane wouldn't otherwise see (e.g. the
   * "Seed from stratigraphy" auto-populate creating new formations
   * outside the pane's own create-edit-delete flow). The integer
   * value is opaque; only the change matters. */
  refreshSignal?: number
  /** Push an UndoCommand onto the App-level undo stack after a
   * successful create / update / delete here. Optional so test-
   * harness mounts work without an undo provider. */
  pushUndoCommand?: (cmd: import('../../hooks/useUndoStack').UndoCommand) => void
  /** Fire the one-shot dedupe of legacy duplicate contacts.
   * Caller (App) calls the dedupe API + refreshes local state.
   * Resolves with the duplicates-removed count for the toast.
   * Hidden when omitted (test-harness mounts). */
  onDedupeContacts?: () => Promise<number>
}

export default function InterpretationPane({
  projectId,
  manifestFormationIds,
  sessionImportFormationIds,
  boreholeIds,
  activeModelName,
  modelBoreholes,
  excludedBoreholeIds,
  onToggleBoreholeInModel,
  onFormationCreated,
  onFormationDeleted,
  onFormationUpdated,
  refreshSignal,
  pushUndoCommand,
  onDedupeContacts,
}: Props): JSX.Element {
  const [populateBusy, setPopulateBusy] = useState(false)
  const [populateResult, setPopulateResult] = useState<string | null>(null)
  // Collapse the borehole scope sub-section by default — engineers
  // who don't care about scope shouldn't see a long list pushing
  // the formations off-screen. Show it expanded only when the user
  // has explicitly hidden at least one borehole.
  const [scopeOpen, setScopeOpen] = useState(false)
  const excludedSet = useMemo(
    () => new Set(excludedBoreholeIds ?? []),
    [excludedBoreholeIds],
  )
  const [formations, setFormations] = useState<GeologicalFormationResponse[]>([])
  const [loading, setLoading] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<GeologicalFormationResponse | null>(null)
  const [pendingDelete, setPendingDelete] = useState<GeologicalFormationResponse | null>(
    null,
  )
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [dedupeBusy, setDedupeBusy] = useState(false)
  const [pendingDedupe, setPendingDedupe] = useState(false)

  async function handleDedupe(): Promise<void> {
    if (!onDedupeContacts || dedupeBusy) return
    setDedupeBusy(true)
    try {
      await onDedupeContacts()
    } finally {
      setDedupeBusy(false)
      setPendingDedupe(false)
    }
  }

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
    // ``refreshSignal`` in the deps re-runs the effect on App
    // bumping the counter — covers server-side formation creates
    // (e.g. auto-populate from stratigraphy) that bypass the
    // pane's own create-edit-delete flow.
  }, [projectId, refreshSignal])

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
        const createPayload = payload as GeologicalFormationCreatePayload
        const created = await api.geology.createFormation(projectId, createPayload)
        setFormations(prev => sortFormations([...prev, created]))
        // Flip the project to dirty + tag the new row with the
        // amber visual until the user runs File → Save.
        onFormationCreated?.(created.id)
        setDialogOpen(false)
        setEditing(null)
        // Undo: DELETE the created row. Redo: re-POST and capture
        // the new server id for subsequent reverts.
        let currentId = created.id
        pushUndoCommand?.({
          description: 'Create formation',
          revert: async () => {
            await api.geology.deleteFormation(projectId, currentId)
            setFormations(prev => prev.filter(f => f.id !== currentId))
            onFormationDeleted?.(currentId)
          },
          reapply: async () => {
            const recreated = await api.geology.createFormation(
              projectId,
              createPayload,
            )
            currentId = recreated.id
            setFormations(prev => sortFormations([...prev, recreated]))
            onFormationCreated?.(recreated.id)
          },
        })
      } catch (err) {
        log.error('geology', 'createFormation failed', err)
      }
    },
    [projectId, onFormationCreated, onFormationDeleted, pushUndoCommand],
  )

  const handleUpdate = useCallback(
    async (payload: GeologicalFormationCreatePayload | GeologicalFormationUpdatePayload) => {
      if (!projectId || !editing) return
      try {
        const before = editing
        const updatePayload = payload as GeologicalFormationUpdatePayload
        const updated = await api.geology.updateFormation(
          projectId,
          editing.id,
          updatePayload,
        )
        setFormations(prev =>
          sortFormations(prev.map(f => (f.id === updated.id ? updated : f))),
        )
        // Resync App's cached formations so renames + recolours
        // land in the section picker + ContactsLayer without a
        // reload.
        onFormationUpdated?.(updated.id)
        setDialogOpen(false)
        setEditing(null)
        // Undo: PATCH back to the snapshot's name/color/code/etc.
        // Redo: re-PATCH the user's update payload.
        const beforePayload: GeologicalFormationUpdatePayload = {
          name: before.name,
          color: before.color,
          code: before.code,
          regional_ref: before.regional_ref,
          description: before.description,
          display_order: before.display_order,
        }
        pushUndoCommand?.({
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
            onFormationUpdated?.(back.id)
          },
          reapply: async () => {
            const fwd = await api.geology.updateFormation(
              projectId,
              before.id,
              updatePayload,
            )
            setFormations(prev =>
              sortFormations(prev.map(f => (f.id === fwd.id ? fwd : f))),
            )
            onFormationUpdated?.(fwd.id)
          },
        })
      } catch (err) {
        log.error('geology', 'updateFormation failed', err)
      }
    },
    [projectId, editing, onFormationUpdated, pushUndoCommand],
  )

  // Walk every visible borehole's informal_stratigraphy observation
  // and pair each layer with the formal_stratigraphy layer covering
  // its midpoint depth. The FORMAL description is the unique anchor
  // — each formal stratigraphy appears at most once in the
  // resulting formations list (mirroring the DOV chart: one
  // formation per formal stratigraphic unit).
  //
  // Within each formal group, multiple informal descriptions may
  // exist (different boreholes describe the same formal unit with
  // varying wording — e.g. "klei" vs "stijve klei van het lid van
  // Boom"). The LONGEST informal wins as the formation NAME, since
  // longer descriptions carry more useful context for the engineer
  // building the model. Tiebreakers: highest pair-count, then
  // alphabetical.
  //
  // Re-run idempotency: skip formal descriptions already present
  // as a ``regional_ref`` on an existing formation. Hash-based
  // colour stays deterministic.
  //
  // Client-side per-borehole fetch is the v1 implementation. A
  // backend batch endpoint becomes the right call when projects
  // routinely carry hundreds of boreholes.
  const handlePopulateFromBoreholes = useCallback(async (): Promise<void> => {
    if (!projectId || populateBusy) return
    // Respect the active model's scope — boreholes the user
    // unchecked under "Boreholes in model" do NOT contribute their
    // stratigraphy to the auto-populate. The user's expectation is
    // that the model scope filter applies everywhere, not just to
    // the section overlay's contact rendering.
    const ids = (boreholeIds ?? []).filter(id => !excludedSet.has(id))
    if (ids.length === 0) {
      setPopulateResult(
        (boreholeIds?.length ?? 0) === 0
          ? 'No boreholes in this project yet.'
          : 'No boreholes selected for the active model.',
      )
      return
    }
    setPopulateBusy(true)
    setPopulateResult(null)
    try {
      const results = await Promise.allSettled(ids.map(id => api.borehole.get(id)))
      // Per formal stratigraphy (case-insensitive key):
      //   * formalDisplay — first-seen display casing
      //   * informals     — Map<informal-key, {display, count}>
      type InformalCandidate = { display: string; count: number }
      type FormalGroup = {
        formalDisplay: string
        informals: Map<string, InformalCandidate>
      }
      const byFormal = new Map<string, FormalGroup>()
      let failed = 0
      for (const r of results) {
        if (r.status !== 'fulfilled') {
          failed += 1
          continue
        }
        const informalObs = r.value.observations.find(
          o => o.observation_type === 'informal_stratigraphy',
        )
        if (!informalObs || informalObs.layers.length === 0) continue
        const formalLayers =
          r.value.observations.find(o => o.observation_type === 'formal_stratigraphy')
            ?.layers ?? []
        for (const inf of informalObs.layers) {
          const infDisplay = (inf.description ?? '').trim()
          if (infDisplay === '') continue
          // Find the formal layer covering the informal layer's
          // midpoint. Layers in DOV aren't synchronised between
          // streams, so midpoint lookup is the simplest robust
          // match.
          const mid = (inf.top_m + inf.base_m) / 2
          const formal = formalLayers.find(
            fl => fl.top_m <= mid && mid <= fl.base_m,
          )
          const formalDisplay = (formal?.description ?? '').trim()
          if (formalDisplay === '') continue
          const formalKey = formalDisplay.toLowerCase()
          if (!byFormal.has(formalKey)) {
            byFormal.set(formalKey, {
              formalDisplay,
              informals: new Map(),
            })
          }
          const group = byFormal.get(formalKey)!
          const infKey = infDisplay.toLowerCase()
          const existing = group.informals.get(infKey)
          if (existing) {
            existing.count += 1
          } else {
            group.informals.set(infKey, { display: infDisplay, count: 1 })
          }
        }
      }
      // Idempotency dedupe: skip formals already present as a
      // regional_ref on an existing formation (case-insensitive).
      // Also dedupe informal-name collisions so the user can't end
      // up with two rows sharing the same display name.
      const existingFormalKeys = new Set(
        visibleFormations
          .map(f => (f.regional_ref ?? '').toLowerCase())
          .filter(k => k !== ''),
      )
      const existingNameKeys = new Set(
        visibleFormations.map(f => f.name.toLowerCase()),
      )
      // Pick the longest informal display per formal group. Length
      // tiebreaker = higher pair-count, then alphabetical.
      function pickBestInformal(group: FormalGroup): InformalCandidate | null {
        let best: InformalCandidate | null = null
        for (const cand of group.informals.values()) {
          const beats =
            best === null ||
            cand.display.length > best.display.length ||
            (cand.display.length === best.display.length && cand.count > best.count) ||
            (cand.display.length === best.display.length &&
              cand.count === best.count &&
              cand.display.localeCompare(best.display) < 0)
          if (beats) best = cand
        }
        return best
      }
      const toCreate: { name: string; regional_ref: string }[] = []
      for (const [formalKey, group] of byFormal) {
        if (existingFormalKeys.has(formalKey)) continue
        const best = pickBestInformal(group)
        if (best === null) continue
        if (existingNameKeys.has(best.display.toLowerCase())) continue
        toCreate.push({ name: best.display, regional_ref: group.formalDisplay })
      }
      // Create them sequentially so a failure mid-loop leaves us
      // with a consistent optimistic state.
      let createdCount = 0
      for (const { name, regional_ref } of toCreate) {
        try {
          const created = await api.geology.createFormation(projectId, {
            name,
            color: hashHexColor(name),
            regional_ref,
          })
          setFormations(prev => sortFormations([...prev, created]))
          onFormationCreated?.(created.id)
          createdCount += 1
        } catch (err) {
          log.error('geology', `createFormation('${name}') failed`, err)
        }
      }
      const scanned = ids.length - failed
      const summary =
        createdCount === 0
          ? `No new formal-stratigraphy units found in ${scanned} borehole${
              scanned === 1 ? '' : 's'
            }.`
          : `Added ${createdCount} formation${createdCount === 1 ? '' : 's'} from ` +
            `${scanned} borehole${scanned === 1 ? '' : 's'}` +
            (failed > 0 ? ` (${failed} fetch failures)` : '') +
            `.`
      setPopulateResult(summary)
    } finally {
      setPopulateBusy(false)
    }
  }, [projectId, populateBusy, boreholeIds, excludedSet, visibleFormations, onFormationCreated])

  const handleDelete = useCallback(async () => {
    if (!projectId || !pendingDelete) return
    setDeleteBusy(true)
    try {
      const snapshot = pendingDelete
      await api.geology.deleteFormation(projectId, snapshot.id)
      setFormations(prev => prev.filter(f => f.id !== snapshot.id))
      onFormationDeleted?.(snapshot.id)
      setPendingDelete(null)
      // Undo: re-POST an equivalent formation with the snapshot's
      // fields. Server assigns a new id (captured in closure for
      // redo's subsequent delete).
      const recreatePayload: GeologicalFormationCreatePayload = {
        name: snapshot.name,
        color: snapshot.color,
        code: snapshot.code ?? undefined,
        regional_ref: snapshot.regional_ref ?? undefined,
        description: snapshot.description ?? undefined,
        display_order: snapshot.display_order,
      }
      let currentId: string | null = null
      pushUndoCommand?.({
        description: 'Delete formation',
        revert: async () => {
          const recreated = await api.geology.createFormation(
            projectId,
            recreatePayload,
          )
          currentId = recreated.id
          setFormations(prev => sortFormations([...prev, recreated]))
          onFormationCreated?.(recreated.id)
        },
        reapply: async () => {
          if (!currentId) return
          await api.geology.deleteFormation(projectId, currentId)
          const deletedId = currentId
          setFormations(prev => prev.filter(f => f.id !== deletedId))
          onFormationDeleted?.(deletedId)
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
    onFormationDeleted,
    onFormationCreated,
    pushUndoCommand,
  ])

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
        <div className="flex flex-col gap-0.5 text-gray-700 min-w-0">
          <div className="flex items-center gap-2">
            <Layers size={14} className="text-amber-700" />
            <span className="text-xs font-medium">Formations</span>
            <span className="text-[10px] text-gray-400 tabular-nums">
              {visibleFormations.length}
            </span>
          </div>
          {activeModelName && (
            <div
              className="text-[10px] text-gray-400 pl-5 truncate"
              title="Active geological model — every formation pick belongs to this model"
            >
              Model: <span className="text-gray-600">{activeModelName}</span>
            </div>
          )}
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
          {onDedupeContacts && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPendingDedupe(true)}
              disabled={dedupeBusy}
              title="One-shot cleanup: removes duplicate (anchor, formation) contacts left over from before the per-anchor uniqueness rule landed. Keeps the manual pick / most-recent row in each duplicate group."
            >
              <Sparkles size={12} className="mr-1" />
              {dedupeBusy ? 'Cleaning…' : 'Dedupe'}
            </Button>
          )}
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

      {/* Boreholes in model — collapsible sub-section. Toggling a
          checkbox PATCHes the active model's excluded_borehole_ids.
          Excluded boreholes still render lithology on the section,
          but their contacts get filtered out of ContactsLayer (so
          they don't anchor formation tops). Re-including a borehole
          immediately restores its contacts. */}
      {modelBoreholes && modelBoreholes.length > 0 && onToggleBoreholeInModel && (
        <div className="border-t border-gray-100 pt-3 mt-1">
          <button
            onClick={() => setScopeOpen(prev => !prev)}
            className="flex items-center gap-1.5 w-full text-left text-gray-700 hover:text-gray-900"
            title="Show / hide the per-borehole scope toggles"
          >
            {scopeOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <Drill size={12} className="text-gray-500" />
            <span className="text-xs font-medium">Boreholes in model</span>
            <span className="text-[10px] text-gray-400 tabular-nums ml-auto">
              {modelBoreholes.length - excludedSet.size}/{modelBoreholes.length}
            </span>
          </button>
          {scopeOpen && (
            <ul className="flex flex-col mt-2 max-h-64 overflow-y-auto pr-1">
              {modelBoreholes.map(b => {
                const included = !excludedSet.has(b.id)
                return (
                  <li
                    key={b.id}
                    className={[
                      'flex items-center gap-2 px-1 py-1 rounded text-xs transition-colors',
                      included
                        ? 'text-gray-700 hover:bg-gray-50'
                        : 'text-gray-400 hover:bg-gray-50',
                    ].join(' ')}
                  >
                    <input
                      type="checkbox"
                      checked={included}
                      onChange={e =>
                        void onToggleBoreholeInModel(b.id, e.target.checked)
                      }
                      className="cursor-pointer shrink-0"
                      aria-label={`${b.name} in model`}
                    />
                    <span
                      className={[
                        'truncate flex-1',
                        included ? '' : 'line-through',
                      ].join(' ')}
                      title={b.name}
                    >
                      {b.name}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
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
      <Modal
        open={pendingDedupe}
        onCancel={() => setPendingDedupe(false)}
        labelledBy="dedupe-contacts-title"
        busy={dedupeBusy}
      >
        <div className="p-5">
          <h2
            id="dedupe-contacts-title"
            className="text-base font-semibold text-gray-800 mb-2"
          >
            Clean up duplicate contacts?
          </h2>
          <p className="text-xs text-gray-600 mb-4">
            Walks every (borehole, formation) pair on the active model
            and keeps ONE contact per pair. Survivor priority: manual
            picks beat auto-derived; rows with provenance beat rows
            without; most recent breaks ties. Idempotent — re-running
            on a clean model removes nothing. Counts surface in a
            toast.
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              size="md"
              onClick={() => setPendingDedupe(false)}
              disabled={dedupeBusy}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="md"
              onClick={() => void handleDedupe()}
              disabled={dedupeBusy}
            >
              Dedupe
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
