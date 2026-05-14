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
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Download,
  Drill,
  GripVertical,
  Layers,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react'

import { api } from '../../api/client'
import type {
  BoreholeListItem,
  GapIssueResponse,
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
  /** Force-recompute every formation's TIN cache in the active model.
   * Caller (App) calls the rebuild API + refetches surfaces. Hidden
   * when omitted (test-harness mounts). Reversible action — no
   * confirmation modal; the rebuild only writes derived state. */
  onRebuildSurfaces?: () => Promise<void>
  /** Export the active geological model as a runnable Plaxis 3D
   * plxscripting Python script. Caller (App) owns the fetch → save
   * dialog → file write flow. Hidden when omitted or when no
   * active model is wired. */
  onExportPlaxis3d?: () => Promise<void>
  /** Active geological model id — required to fetch the crossings
   * validator result for the banner. Banner stays hidden when null. */
  activeModelId?: string | null
  /** Refresh signal — App bumps after every contact mutation so the
   * banner re-runs the crossings validator. Opaque integer; only the
   * change matters. */
  crossingsRefreshSignal?: number
  /** Count of formations whose cached surface is stale (contacts
   * mutated since the last Build). Drives the "N unbuilt edits"
   * badge on the Build button. Undefined when the surface state
   * isn't wired (test harness). */
  staleSurfaceCount?: number
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
  onRebuildSurfaces,
  onExportPlaxis3d,
  activeModelId,
  crossingsRefreshSignal,
  staleSurfaceCount,
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
  const [rebuildBusy, setRebuildBusy] = useState(false)
  const [exportPlaxisBusy, setExportPlaxisBusy] = useState(false)
  // Drag-to-reorder state. ``draggedId`` is the formation being
  // dragged; ``dragOverId`` is the row the cursor is hovering over,
  // null when we're at the end-of-list drop zone, undefined when no
  // dragover at all. Lower ``display_order`` = older formation per
  // the geological superposition convention; reorder updates renumber
  // 0..N-1 in the new visual order.
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | 'end' | null>(null)
  const [reorderBusy, setReorderBusy] = useState(false)
  // Cross-formation crossing-validator results — refetched whenever
  // the contacts identity changes (App bumps ``crossingsRefreshSignal``).
  // Empty list = no crossings; non-empty surfaces as a banner.
  const [crossingIssues, setCrossingIssues] = useState<readonly GapIssueResponse[]>([])

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

  async function handleRebuildSurfaces(): Promise<void> {
    if (!onRebuildSurfaces || rebuildBusy) return
    setRebuildBusy(true)
    try {
      await onRebuildSurfaces()
    } finally {
      setRebuildBusy(false)
    }
  }

  async function handleExportPlaxis3d(): Promise<void> {
    if (!onExportPlaxis3d || exportPlaxisBusy) return
    setExportPlaxisBusy(true)
    try {
      await onExportPlaxis3d()
    } finally {
      setExportPlaxisBusy(false)
    }
  }

  // Commit a drag-reorder by renumbering ``visibleFormations`` in the
  // new order. ``targetId`` is the row the dragged formation lands
  // BEFORE, or 'end' when dropped past the last row. We renumber every
  // formation 0..N-1 in the new order and PATCH each row whose
  // display_order actually changed (typically a contiguous run between
  // the source and target indices). Optimistic local update first;
  // on any PATCH failure we refetch from the server to converge.
  const reorderFormations = useCallback(
    async (sourceId: string, targetId: string | 'end') => {
      if (!projectId || sourceId === targetId) return
      setReorderBusy(true)
      // Derive the visible list inline rather than reading the memoised
      // ``visibleFormations`` — that constant is declared further down
      // the component body, so closing over it would TDZ at the deps
      // line. Inputs are the same: ``formations`` filtered by the
      // manifest gate when one is wired.
      const previous =
        manifestFormationIds === undefined
          ? formations
          : formations.filter(f => manifestFormationIds.has(f.id))
      const sourceIndex = previous.findIndex(f => f.id === sourceId)
      if (sourceIndex < 0) {
        setReorderBusy(false)
        return
      }
      const without = previous.filter(f => f.id !== sourceId)
      const insertAt =
        targetId === 'end' ? without.length : without.findIndex(f => f.id === targetId)
      if (insertAt < 0) {
        setReorderBusy(false)
        return
      }
      const reordered = [
        ...without.slice(0, insertAt),
        previous[sourceIndex],
        ...without.slice(insertAt),
      ]
      // Compute the changed set BEFORE the optimistic update so
      // an aborted reorder (no actual position change) doesn't fire
      // PATCHes.
      const changes = reordered
        .map((f, i) => ({ id: f.id, oldOrder: f.display_order, newOrder: i }))
        .filter(c => c.oldOrder !== c.newOrder)
      if (changes.length === 0) {
        setReorderBusy(false)
        return
      }
      // Optimistic local update — visual snap before the network round-trip.
      setFormations(prev => {
        const byId = new Map(reordered.map((f, i) => [f.id, i]))
        return sortFormations(
          prev.map(f => {
            const idx = byId.get(f.id)
            return idx === undefined ? f : { ...f, display_order: idx }
          }),
        )
      })
      try {
        await Promise.all(
          changes.map(c =>
            api.geology.updateFormation(projectId, c.id, {
              display_order: c.newOrder,
            }),
          ),
        )
        for (const c of changes) onFormationUpdated?.(c.id)
        log.success('geology', `reorderFormations ok updates=${changes.length}`)
        // Undo: PATCH each changed formation back to its old display_order
        // + restore the local list to match. Reapply re-runs the same
        // forward PATCHes. Captured by value so a later create / delete
        // doesn't perturb the snapshot.
        const snapshot = changes.slice()
        const pid = projectId
        pushUndoCommand?.({
          description: `Reorder ${snapshot.length} formation${snapshot.length === 1 ? '' : 's'}`,
          revert: async () => {
            await Promise.all(
              snapshot.map(c =>
                api.geology.updateFormation(pid, c.id, {
                  display_order: c.oldOrder,
                }),
              ),
            )
            setFormations(prev => {
              const byId = new Map(snapshot.map(c => [c.id, c.oldOrder]))
              return sortFormations(
                prev.map(f => {
                  const ord = byId.get(f.id)
                  return ord === undefined ? f : { ...f, display_order: ord }
                }),
              )
            })
            for (const c of snapshot) onFormationUpdated?.(c.id)
          },
          reapply: async () => {
            await Promise.all(
              snapshot.map(c =>
                api.geology.updateFormation(pid, c.id, {
                  display_order: c.newOrder,
                }),
              ),
            )
            setFormations(prev => {
              const byId = new Map(snapshot.map(c => [c.id, c.newOrder]))
              return sortFormations(
                prev.map(f => {
                  const ord = byId.get(f.id)
                  return ord === undefined ? f : { ...f, display_order: ord }
                }),
              )
            })
            for (const c of snapshot) onFormationUpdated?.(c.id)
          },
        })
      } catch (err) {
        log.error('geology', 'reorderFormations failed — refetching', err)
        // Best-effort refetch on partial failure so local state matches
        // the server. The UI snaps back to whatever survived.
        try {
          const rows = await api.geology.listFormations(projectId)
          setFormations(sortFormations(rows))
        } catch (refetchErr) {
          log.warn('geology', 'reorderFormations refetch failed', refetchErr)
        }
      } finally {
        setReorderBusy(false)
      }
    },
    [projectId, formations, manifestFormationIds, onFormationUpdated, pushUndoCommand],
  )

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

  // Crossings validator — fetch when an active model is wired and
  // re-fetch whenever the contacts identity changes (App bumps
  // ``crossingsRefreshSignal`` on every contact mutation). Failures
  // stay quiet — an empty banner is better than a console spam loop.
  useEffect(() => {
    if (!projectId || !activeModelId) {
      setCrossingIssues([])
      return
    }
    let cancelled = false
    api.geology
      .validateCrossings(projectId, activeModelId)
      .then(resp => {
        if (cancelled) return
        setCrossingIssues(resp.issues)
      })
      .catch(err => {
        log.warn('geology', `validateCrossings failed for ${activeModelId}`, err)
        if (!cancelled) setCrossingIssues([])
      })
    return () => {
      cancelled = true
    }
  }, [projectId, activeModelId, crossingsRefreshSignal])

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
      // Track each successful create so a single undo can roll back
      // the entire bulk run. We need the payload (for reapply) and
      // the latest server id (for revert / next-reapply's delete).
      const bulkEntries: {
        payload: GeologicalFormationCreatePayload
        currentId: string
      }[] = []
      for (const { name, regional_ref } of toCreate) {
        const payload: GeologicalFormationCreatePayload = {
          name,
          color: hashHexColor(name),
          regional_ref,
        }
        try {
          const created = await api.geology.createFormation(projectId, payload)
          setFormations(prev => sortFormations([...prev, created]))
          onFormationCreated?.(created.id)
          createdCount += 1
          bulkEntries.push({ payload, currentId: created.id })
        } catch (err) {
          log.error('geology', `createFormation('${name}') failed`, err)
        }
      }
      // Undo: DELETE every formation created by this bulk run. Reapply
      // re-POSTs each payload and refreshes the captured id list so the
      // next revert targets the freshly-created server rows.
      if (bulkEntries.length > 0) {
        const pid = projectId
        pushUndoCommand?.({
          description: `Add ${bulkEntries.length} formation${bulkEntries.length === 1 ? '' : 's'} from boreholes`,
          revert: async () => {
            const deletedIds = bulkEntries.map(e => e.currentId)
            await Promise.all(
              deletedIds.map(id => api.geology.deleteFormation(pid, id)),
            )
            const removed = new Set(deletedIds)
            setFormations(prev => prev.filter(f => !removed.has(f.id)))
            for (const id of deletedIds) onFormationDeleted?.(id)
          },
          reapply: async () => {
            for (const entry of bulkEntries) {
              const created = await api.geology.createFormation(pid, entry.payload)
              entry.currentId = created.id
              setFormations(prev => sortFormations([...prev, created]))
              onFormationCreated?.(created.id)
            }
          },
        })
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
  }, [
    projectId,
    populateBusy,
    boreholeIds,
    excludedSet,
    visibleFormations,
    onFormationCreated,
    onFormationDeleted,
    pushUndoCommand,
  ])

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
      {/* Header row — identity only. Action buttons live below in a
          two-row layout (primary Build + secondary actions) so the
          horizontal overflow on a narrow sidebar doesn't hide the
          rare buttons behind a scroll. */}
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

      {/* Primary action — Build model. Full-width primary blue.
          On-click build pivot: this is now the ONLY way the cached
          TIN refreshes (per-contact mutations flip surfaces stale).
          Stale badge surfaces "N unbuilt edits" so the engineer
          knows the section view is showing yesterday's geometry. */}
      {onRebuildSurfaces && (
        <Button
          variant="primary"
          size="md"
          onClick={() => void handleRebuildSurfaces()}
          disabled={rebuildBusy}
          title="Compute the geological surfaces (TIN) from the current contacts. Run this after editing picks; the section view paints the slice once it's built."
          className="w-full justify-center"
        >
          <RefreshCw size={14} className="mr-1.5" />
          {rebuildBusy
            ? 'Building…'
            : staleSurfaceCount && staleSurfaceCount > 0
              ? `Build model · ${staleSurfaceCount} unbuilt edit${staleSurfaceCount === 1 ? '' : 's'}`
              : 'Build model'}
        </Button>
      )}

      {/* Secondary actions — narrower buttons, wrap when the pane
          is narrow. Order: rare (From boreholes / Dedupe) on the
          left, frequent (Add) on the right so it sits in the
          easy-to-hit corner. */}
      <div className="flex flex-wrap items-center gap-1">
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
          className="ml-auto"
        >
          <Plus size={12} className="mr-1" />
          Add
        </Button>
      </div>

      {populateResult && (
        <div className="text-[11px] text-gray-500 italic leading-snug">
          {populateResult}
        </div>
      )}

      {/* Exports — model-wide outputs. Separate row from the model-
          mutation buttons above so future DXF / GeoStudio / D-Series
          targets can join without crowding Build / Add. Hidden when
          no active model is wired. */}
      {onExportPlaxis3d && (
        <div className="flex flex-wrap items-center gap-1 border-t border-gray-100 pt-2">
          <span className="text-[10px] uppercase tracking-wide text-gray-400">
            Export
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void handleExportPlaxis3d()}
            disabled={exportPlaxisBusy}
            title="Generate a runnable plxscripting Python script that builds this geological model inside Plaxis 3D (2018+). Materials are placeholders — set parameters in Plaxis after import."
            className="ml-auto"
          >
            <Download size={12} className="mr-1" />
            {exportPlaxisBusy ? 'Exporting…' : 'Plaxis 3D'}
          </Button>
        </div>
      )}

      {crossingIssues.length > 0 && (
        // Geological superposition violation — younger formation
        // surface dips below an older one somewhere. Amber not red:
        // it's a soft warning the engineer should investigate, not a
        // hard error that blocks save.
        <div
          className="rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900"
          role="alert"
          aria-label="Surface crossing warnings"
          data-testid="crossings-banner"
        >
          <div className="flex items-center gap-1.5 font-medium">
            <AlertTriangle size={12} />
            <span>
              {crossingIssues.length} surface crossing
              {crossingIssues.length === 1 ? '' : 's'} detected
              {/* On-click build pivot: the validator runs against the
                  cached TIN. With staleSurfaceCount > 0, the cache no
                  longer reflects the current contacts — so the result
                  is qualified. Click Build to refresh the validator. */}
              {staleSurfaceCount && staleSurfaceCount > 0 ? (
                <span className="font-normal italic">
                  {' '}
                  (as of last build — click Build to refresh)
                </span>
              ) : null}
            </span>
          </div>
          <ul className="mt-1 ml-5 list-disc space-y-0.5">
            {crossingIssues.map((issue, idx) => (
              <li key={`${issue.formation_ids.join('-')}-${idx}`}>
                {issue.detail}
              </li>
            ))}
          </ul>
        </div>
      )}

      {loading && visibleFormations.length === 0 && (
        <div className="text-[11px] text-gray-400 italic">Loading…</div>
      )}
      {!loading && visibleFormations.length === 0 && (
        <div className="text-[11px] text-gray-500 leading-snug">
          No formations yet. Add a substrate unit (e.g. <em>Boom Klei</em>),
          place contacts on a cross-section, then click <strong>Build model</strong>{' '}
          to compute the surfaces.
        </div>
      )}

      {visibleFormations.length > 0 && (
        <ul className="flex flex-col gap-1">
          {visibleFormations.map(f => (
            <FormationRow
              key={f.id}
              formation={f}
              unsaved={sessionImportFormationIds?.has(f.id) ?? false}
              isDragging={draggedId === f.id}
              isDragOver={dragOverId === f.id && draggedId !== null && draggedId !== f.id}
              reorderBusy={reorderBusy}
              onEdit={() => {
                setEditing(f)
                setDialogOpen(true)
              }}
              onDelete={() => setPendingDelete(f)}
              onDragStart={() => setDraggedId(f.id)}
              onDragOver={() => setDragOverId(f.id)}
              onDragLeave={() => {
                // Only clear when the cursor leaves to a non-row area.
                // The dragenter on the next row will set its own id; we
                // just need to make sure a stale id doesn't linger.
                setDragOverId(prev => (prev === f.id ? null : prev))
              }}
              onDrop={() => {
                if (draggedId && draggedId !== f.id) {
                  void reorderFormations(draggedId, f.id)
                }
                setDraggedId(null)
                setDragOverId(null)
              }}
              onDragEnd={() => {
                setDraggedId(null)
                setDragOverId(null)
              }}
            />
          ))}
          {draggedId !== null && (
            // End-of-list drop zone — only visible while a drag is in
            // progress, so it doesn't clutter the resting list. Drop
            // here to push the dragged formation to the bottom (=
            // youngest in the stratigraphic order).
            <li
              onDragOver={e => {
                e.preventDefault()
                setDragOverId('end')
              }}
              onDrop={() => {
                if (draggedId) void reorderFormations(draggedId, 'end')
                setDraggedId(null)
                setDragOverId(null)
              }}
              className={[
                'h-3 mx-2 rounded-sm border-t-2 border-dashed transition-colors',
                dragOverId === 'end'
                  ? 'border-blue-500'
                  : 'border-gray-300',
              ].join(' ')}
              aria-label="Drop here to place at end (youngest)"
            />
          )}
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
  isDragging,
  isDragOver,
  reorderBusy,
  onEdit,
  onDelete,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
}: {
  formation: GeologicalFormationResponse
  unsaved: boolean
  isDragging: boolean
  isDragOver: boolean
  reorderBusy: boolean
  onEdit: () => void
  onDelete: () => void
  onDragStart: () => void
  onDragOver: () => void
  onDragLeave: () => void
  onDrop: () => void
  onDragEnd: () => void
}): JSX.Element {
  return (
    <li
      onDragOver={e => {
        // ``preventDefault`` is required to mark the row as a drop
        // target; without it the browser fires no drop event.
        e.preventDefault()
        onDragOver()
      }}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={[
        'group flex items-center gap-2 px-2 py-1.5 rounded transition-colors',
        // Insertion indicator — thin top border in accent blue when
        // the cursor hovers this row during a drag (= "drop to insert
        // here, before this row"). Replaces the resting border-l so
        // the layout doesn't shift.
        isDragOver
          ? 'border-t-2 border-t-blue-500 border-l-2 border-l-transparent'
          : unsaved
            ? 'border-l-4 border-l-amber-500 bg-amber-100/70 hover:bg-amber-100/90'
            : 'border-l-2 border-l-transparent hover:bg-gray-50',
        isDragging ? 'opacity-40' : '',
      ].join(' ')}
    >
      <button
        type="button"
        draggable={!reorderBusy}
        onDragStart={e => {
          // Without text/plain payload Firefox refuses to start the
          // drag at all; the value is unused — we read state for the
          // dragged id.
          e.dataTransfer.setData('text/plain', formation.id)
          e.dataTransfer.effectAllowed = 'move'
          onDragStart()
        }}
        onDragEnd={onDragEnd}
        title="Drag to reorder (lower = older)"
        className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 shrink-0 -ml-1 px-0.5"
        aria-label={`Drag to reorder ${formation.name}`}
      >
        <GripVertical size={12} />
      </button>
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
