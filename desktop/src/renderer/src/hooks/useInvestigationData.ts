// CPT and borehole data — list state, detail caches, import flows,
// hide/restore mechanics, and elevation edits.
//
// Selection state (selectedId / selectedBoreholeId) is owned by the
// App coordinator and injected here so this hook doesn't couple to
// the section-selection hook (which also needs those setters). The
// view-navigation signal (setView) is similarly injected.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

import {
  api,
  CptRefreshConfirmationRequiredError,
  DuplicateCptError,
} from '../api/client'
import type {
  BoreholeDetailResponse,
  BoreholeListItem,
  CptListItem,
  CptPlotResponse,
  CptRefreshDiff,
  CptResponse,
  ImportCptResponse,
} from '../api/client'
import { addAllToSet } from '../utils/sets'
import { dovBboxProblem } from '../utils/dovBbox'
import { dovSubPhaseFailures } from '../utils/dovImportFailures'
import { log } from '../utils/log'
import { t } from '../i18n/translate'
import type { UndoCommand } from './useUndoStack'
import type { MessageKey } from '../i18n/locales/en'
import type { DovImportState, PendingPin } from './useDovImportStream'
import { useDovImportStream } from './useDovImportStream'

// ---------------------------------------------------------------------------
// Kind-parameterised hide / restore / elevation helpers (audit 2026-07-12
// FE-HOOKS-11). The CPT and borehole handler pairs were the same control
// flow differing only in the review kind + which state slice they touch;
// each pair is one shared implementation with two thin wrappers in the hook
// (public API unchanged).
// ---------------------------------------------------------------------------

/** Review-row kind discriminator shared by the helpers below. */
type InvestigationKind = 'cpt' | 'borehole'

/** Log-label per kind (`hide-CPT upserts failed`, `restore-borehole ...`). */
const KIND_LOG_LABEL: Record<InvestigationKind, string> = {
  cpt: 'CPT',
  borehole: 'borehole',
}

/**
 * Clear ids from the removed-set and flip the server-side ``is_hidden`` off.
 *
 * Re-importing or re-fetching a record is an explicit "make this visible
 * again" signal. Without this a 409-duplicate import returns the existing id
 * but the sidebar's removed-filter keeps it hidden and the user sees no
 * change.
 *
 * ``touched`` is computed from the CURRENT removed-set BEFORE calling
 * setState. A React 18 functional updater is deferred to the render phase,
 * so a ``touched`` array mutated inside the updater is still empty when read
 * synchronously below — that silently skipped the is_hidden upsert, so a
 * 409-re-imported CPT came back hidden on the next project load (the exact
 * failure this logic exists to prevent). Reads state directly, mirroring
 * ``restoreAllInvestigations``.
 *
 * Parameters
 * ----------
 * ids : Iterable<string>
 *     Candidate ids to unhide (only ones actually in the removed-set count).
 * kind : InvestigationKind
 *     Review-row kind for the upsert.
 * removedIds : ReadonlySet<string>
 *     The kind's current removed-set.
 * setRemovedIds : Dispatch<SetStateAction<Set<string>>>
 *     The kind's removed-set setter.
 * projectId : string | null
 *     Active project id; the server upsert is skipped when null (the local
 *     removed-set is still updated, matching the historical behaviour).
 */
function unhideInvestigations(
  ids: Iterable<string>,
  kind: InvestigationKind,
  removedIds: ReadonlySet<string>,
  setRemovedIds: Dispatch<SetStateAction<Set<string>>>,
  projectId: string | null,
): void {
  const touched = Array.from(ids).filter(id => removedIds.has(id))
  if (touched.length === 0) return
  setRemovedIds(prev => {
    const next = new Set(prev)
    for (const id of touched) next.delete(id)
    return next
  })
  if (!projectId) return
  void Promise.allSettled(
    touched.map(id => api.review.upsert(projectId, kind, id, { is_hidden: false })),
  )
}

/**
 * Project-local hide: add ids to the removed-set, deselect the current
 * investigation when it is among them, and flip ``is_hidden`` on
 * server-side. Upsert failures are logged, not surfaced — hide is a
 * reversible action.
 *
 * Parameters
 * ----------
 * cfg.ids : string[]
 *     Ids to hide.
 * cfg.kind : InvestigationKind
 *     Review-row kind for the upsert.
 * cfg.projectId : string
 *     Active project id.
 * cfg.setRemovedIds : Dispatch<SetStateAction<Set<string>>>
 *     The kind's removed-set setter.
 * cfg.selectedId : string | null
 *     The currently selected investigation of this kind, if any.
 * cfg.deselect : () => void
 *     Clears the selection + navigates back to the map.
 */
function removeInvestigations(cfg: {
  ids: string[]
  kind: InvestigationKind
  projectId: string
  setRemovedIds: Dispatch<SetStateAction<Set<string>>>
  selectedId: string | null
  deselect: () => void
}): void {
  const { ids, kind, projectId, setRemovedIds, selectedId, deselect } = cfg
  setRemovedIds(prev => {
    const next = new Set(prev)
    for (const id of ids) next.add(id)
    return next
  })
  if (selectedId && ids.includes(selectedId)) {
    deselect()
  }
  void Promise.allSettled(
    ids.map(id => api.review.upsert(projectId, kind, id, { is_hidden: true })),
  ).then(results => {
    const failed = results.filter(r => r.status === 'rejected').length
    if (failed > 0) {
      log.warn(
        'reviews',
        `${failed}/${ids.length} hide-${KIND_LOG_LABEL[kind]} upserts failed`,
      )
    }
  })
}

/**
 * Restore every hidden id of one kind: empty the removed-set and flip
 * ``is_hidden`` off server-side for each formerly hidden row.
 *
 * Parameters
 * ----------
 * kind : InvestigationKind
 *     Review-row kind for the upsert.
 * removedIds : ReadonlySet<string>
 *     The kind's current removed-set (snapshotted before it is emptied).
 * setRemovedIds : Dispatch<SetStateAction<Set<string>>>
 *     The kind's removed-set setter.
 * projectId : string
 *     Active project id.
 */
function restoreAllInvestigations(
  kind: InvestigationKind,
  removedIds: ReadonlySet<string>,
  setRemovedIds: Dispatch<SetStateAction<Set<string>>>,
  projectId: string,
): void {
  const ids = Array.from(removedIds)
  setRemovedIds(new Set())
  void Promise.allSettled(
    ids.map(id => api.review.upsert(projectId, kind, id, { is_hidden: false })),
  ).then(results => {
    const failed = results.filter(r => r.status === 'rejected').length
    if (failed > 0) {
      log.warn(
        'reviews',
        `${failed}/${ids.length} restore-${KIND_LOG_LABEL[kind]} upserts failed`,
      )
    }
  })
}

/**
 * Shared elevation-patch skeleton: PATCH → apply → undo/redo closures.
 *
 * The per-kind ``apply`` updates the list row + detail cache — the one part
 * that genuinely differs between CPT (detail-cache entry replaced with the
 * full PATCH response) and borehole (detail patched in place so the lab-test
 * children / drill segments are untouched). The undo closures capture the
 * project id as a plain string so they don't close over the reactive
 * project reference (avoids a stale closure if the user switches projects
 * while an undo is pending).
 *
 * Parameters
 * ----------
 * cfg.id : string
 *     Investigation id.
 * cfg.projectId : string
 *     Active project id (captured into the undo closures).
 * cfg.elevationM / cfg.zEpsg
 *     The new elevation value + vertical CRS.
 * cfg.before
 *     Pre-edit list row (snapshot for undo), if present.
 * cfg.patch
 *     The kind's PATCH call (``api.cpt.patchElevation`` / borehole).
 * cfg.apply
 *     Applies a PATCH response to the kind's list + detail-cache state.
 * cfg.logKind : InvestigationKind
 *     Log channel.
 * cfg.undoDescriptionKey : MessageKey
 *     Undo-stack entry label KEY (resolved at display time, ruling 11).
 * cfg.pushUndo
 *     The undo-stack push.
 */
async function patchInvestigationElevation<R>(cfg: {
  id: string
  projectId: string
  elevationM: number | null
  zEpsg: number | null
  before: { elevation_m: number | null; z_epsg: number | null } | undefined
  patch: (
    id: string,
    projectId: string,
    body: { elevation_m: number | null; z_epsg: number | null },
  ) => Promise<R>
  apply: (id: string, resp: R) => void
  logKind: InvestigationKind
  undoDescriptionKey: MessageKey
  pushUndo: (cmd: UndoCommand) => void
}): Promise<void> {
  const { id, projectId, elevationM, zEpsg, before, patch, apply, logKind } = cfg
  // Snapshot pre-edit values from the list so undo can PATCH them back even
  // if the user has been clicking around between edits.
  const beforeElev = before?.elevation_m ?? null
  const beforeZ = before?.z_epsg ?? null
  const updated = await patch(id, projectId, { elevation_m: elevationM, z_epsg: zEpsg })
  apply(id, updated)
  log.info(logKind, `elevation patched: ${id} → ${elevationM} (z_epsg=${zEpsg})`)
  cfg.pushUndo({
    descriptionKey: cfg.undoDescriptionKey,
    revert: async () => {
      const back = await patch(id, projectId, { elevation_m: beforeElev, z_epsg: beforeZ })
      apply(id, back)
    },
    reapply: async () => {
      const fwd = await patch(id, projectId, { elevation_m: elevationM, z_epsg: zEpsg })
      apply(id, fwd)
    },
  })
}

export interface UseInvestigationDataResult {
  // CPT state
  cpts: CptListItem[]
  detailMap: Map<string, CptResponse>
  plotMap: Map<string, CptPlotResponse>
  // Borehole state
  boreholes: BoreholeListItem[]
  boreholeDetailMap: Map<string, BoreholeDetailResponse>
  // Import / load state
  importing: boolean
  bboxImportType: 'cpt' | 'borehole' | null
  dovImporting: boolean
  /** Full SSE import state — status / phase / done / total / result / error.
   *  ``dovImporting`` above is derived from this as
   *  ``dovImportState.status === 'running'`` (no parallel state). */
  dovImportState: DovImportState
  /**
   * Pending CPT pin markers emitted by the backend ``"pins"`` SSE event.
   *
   * Non-empty only while a CPT import stream is running and the WFS
   * discovery phase has completed.  Empty for borehole imports and
   * when the stream is idle / done / error.  The map renders these as
   * amber pending circles; they are discarded wholesale on ``"done"``.
   */
  pendingCptPins: PendingPin[]
  /** Reset the SSE import state back to idle (e.g. after the progress
   *  panel's Close button is clicked post-import). */
  resetDovImport: () => void
  // Removed-set counts (sidebar badges)
  removedCptIds: Set<string>
  removedBoreholeIds: Set<string>
  // Data loading
  refreshList: () => Promise<void>
  refreshBoreholeList: () => Promise<void>
  loadCptDetail: (id: string) => Promise<void>
  loadChart: (id: string) => Promise<void>
  /** Load one borehole's detail into the cache; ``force`` refetches a cached
   *  entry (after a track edit, 2026-09-29). */
  loadBoreholeDetail: (id: string, opts?: { force?: boolean }) => Promise<void>
  cancelBboxDraw: () => void
  // Hide / restore
  unhideCpts: (ids: Iterable<string>) => void
  unhideBoreholes: (ids: Iterable<string>) => void
  handleRemoveCpts: (ids: string[]) => void
  handleRemoveBoreholes: (ids: string[]) => void
  handleRestoreAllCpts: () => void
  handleRestoreAllBoreholes: () => void
  // Elevation edits
  handlePatchCptElevation: (
    id: string,
    elevationM: number | null,
    zEpsg: number | null,
  ) => Promise<void>
  handlePatchBoreholeElevation: (
    id: string,
    elevationM: number | null,
    zEpsg: number | null,
  ) => Promise<void>
  // Import
  handleImportCpt: () => Promise<void>
  /** Non-null while a GEF import is waiting for the engineer to agree that an
   * existing CPT's stored data may be replaced. The consumer renders the
   * confirmation dialog from this; the import is parked until one of
   * ``confirmRefreshImport`` / ``cancelRefreshImport`` is called. */
  refreshConfirm: { fileName: string; diff: CptRefreshDiff } | null
  /** "Replace data" — re-posts the parked file with the confirmation. */
  confirmRefreshImport: () => void
  /** Cancel — the stored CPT is left exactly as it was. */
  cancelRefreshImport: () => void
  handleImportDov: () => void
  handleImportBoreholeDov: () => void
  handleBboxDrawn: (
    west: number,
    south: number,
    east: number,
    north: number,
  ) => void
}

/**
 * React hook that owns CPT and borehole data state and all import /
 * load / hide / elevation-edit flows.
 *
 * Selection state (selectedId / selectedBoreholeId) is intentionally
 * NOT owned here — it is injected from the App coordinator so the
 * hook avoids coupling to ``useSections``, which also reads those
 * setters.  ``handleRemoveCpts`` / ``handleRemoveBoreholes`` receive
 * the current selection ids as parameters so they can deselect.
 *
 * Parameters
 * ----------
 * project
 *     Active project.  When ``null`` state resets to empty.
 * ready
 *     From ``useAppBoot`` — data loading waits until the API is up.
 * toast
 *     Stable action from ``useToasts``.
 * pushUndo
 *     Stable action from ``useUndoStack``.
 * addToManifest
 *     From ``useProject`` — gates row visibility in the sidebar.
 * setSessionImportCptIds
 *     ``usePersistedSet`` setter for session-level CPT dirty tracking.
 * setSessionImportBoreholeIds
 *     ``usePersistedSet`` setter for session-level borehole dirty tracking.
 * selectedId
 *     Currently selected CPT id (App-owned state).
 * setSelectedId
 *     Setter for the CPT selection (App-owned state).
 * selectedBoreholeId
 *     Currently selected borehole id (App-owned state).
 * setSelectedBoreholeId
 *     Setter for the borehole selection (App-owned state).
 * setView
 *     App-level view-tab setter injected so this hook can navigate to
 *     the chart tab after import / detail load.
 *
 * Returns
 * -------
 * UseInvestigationDataResult
 *     All CPT + borehole state and action callbacks.
 */
export function useInvestigationData({
  project,
  ready,
  toast,
  pushUndo,
  addToManifest,
  setSessionImportCptIds,
  setSessionImportBoreholeIds,
  selectedId,
  setSelectedId,
  selectedBoreholeId,
  setSelectedBoreholeId,
  setView,
  markMutated,
}: {
  project: { id: string; name: string } | null
  ready: boolean
  // ``replaceKey`` groups repeatable announcements (see useToasts): a caller
  // that can fire the same message over and over passes a stable key so the
  // live toast is swapped in place instead of stacking. The DOV import path
  // uses it so a persistent import error / a mis-drawn box never floods the
  // screen with identical toasts.
  toast: (type: 'success' | 'error' | 'warning', message: string, replaceKey?: string) => void
  pushUndo: (cmd: UndoCommand) => void
  addToManifest: (kind: 'cpt' | 'borehole', ids: string[]) => void
  setSessionImportCptIds: Dispatch<SetStateAction<Set<string>>>
  setSessionImportBoreholeIds: Dispatch<SetStateAction<Set<string>>>
  selectedId: string | null
  setSelectedId: (id: string | null) => void
  selectedBoreholeId: string | null
  setSelectedBoreholeId: (id: string | null) => void
  setView: (view: 'map' | 'chart') => void
  /** Project-level dirty flag from App (``markMutated``). Used for changes to
   * rows that were ALREADY in the project — a CPT refresh replaces stored data
   * without any new id joining the project, so the session-import set (which
   * drives discard-on-close deletion) is the wrong lever for it. Optional so
   * existing test mounts keep working. */
  markMutated?: () => void
}): UseInvestigationDataResult {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  const [cpts, setCpts] = useState<CptListItem[]>([])
  const [detailMap, setDetailMap] = useState<Map<string, CptResponse>>(new Map())
  const [plotMap, setPlotMap] = useState<Map<string, CptPlotResponse>>(new Map())

  const [boreholes, setBoreholes] = useState<BoreholeListItem[]>([])
  const [boreholeDetailMap, setBoreholeDetailMap] = useState<
    Map<string, BoreholeDetailResponse>
  >(new Map())

  // Project-switch generation guard (Codex 3). Bumped on every project change
  // (see the clear-on-switch effect below). Every list / detail / plot fetch
  // snapshots this at call time and, when it resolves, refuses to write state if
  // the generation has moved on — so a slow request for project A can never
  // overwrite project B's data, and an in-flight A response cannot repopulate a
  // cache after the switch. A ref, not state: it must read the LATEST value at
  // resolution time and it never drives a render.
  const loadGenerationRef = useRef(0)

  const [importing, setImporting] = useState(false)
  const [bboxImportType, setBboxImportType] = useState<'cpt' | 'borehole' | null>(null)
  const { state: dovImportState, start: startDovStream, reset: resetDovStream } =
    useDovImportStream()
  // Derived, not parallel state (audit FE-HOOKS-10): start() sets
  // status:'running' synchronously and every terminal transition leaves it,
  // so the old manually-synced useState + 4 setter sites are redundant.
  const dovImporting = dovImportState.status === 'running'

  // Project-local hide sets. Re-seeded from the review API on every
  // project change so the is_hidden state survives .gmproj round-trips.
  const [removedCptIds, setRemovedCptIds] = useState<Set<string>>(new Set())
  const [removedBoreholeIds, setRemovedBoreholeIds] = useState<Set<string>>(new Set())

  // ---------------------------------------------------------------------------
  // Hidden-set reload
  // ---------------------------------------------------------------------------

  // Reload from the server whenever the project OPENS — keyed on the id, not
  // the object. The .gmproj-restore path pushes saved is_hidden state into the
  // DB before this fires; the GET picks up exactly what should be hidden.
  // Empty fallback on failure so the user sees ALL rows rather than nothing.
  //
  // WHY the id: every PATCH of the project (view state, metadata, a new
  // section) re-identifies the project object. Keyed on the object this
  // effect re-ran on each of them and REPLACED the hidden set with the
  // server's answer — a seed fetched before the hide upserts had landed put
  // the boreholes the engineer had just removed straight back on the section
  // (owner 2026-09-11: "i added boreholes, deleted some, made a section and
  // the deleted boreholes showed up on the section").
  const projectId = project?.id ?? null
  useEffect(() => {
    if (projectId === null) {
      setRemovedCptIds(new Set())
      setRemovedBoreholeIds(new Set())
      return
    }
    let cancelled = false
    api.review
      .list(projectId)
      .then(reviews => {
        if (cancelled) return
        const cptHidden = new Set<string>()
        const bhHidden = new Set<string>()
        for (const r of reviews) {
          if (!r.is_hidden) continue
          if (r.target_kind === 'cpt') cptHidden.add(r.target_id)
          else if (r.target_kind === 'borehole') bhHidden.add(r.target_id)
        }
        setRemovedCptIds(cptHidden)
        setRemovedBoreholeIds(bhHidden)
      })
      .catch(err => {
        log.warn('reviews', `load failed for project ${projectId}`, err)
      })
    return () => {
      cancelled = true
    }
  }, [projectId])

  // Drop every project-scoped cache the instant the active project changes
  // (Codex 3). Without this, project A's list rows, detail and plot caches
  // lingered into project B — the map painted A's markers, and a detail lookup
  // could hit A's cached entry. Bumping the generation here is what lets the
  // in-flight fetch guards below discard a superseded A response. Runs on open,
  // switch AND close (``project?.id`` → a new id or ``undefined``). Declared
  // BEFORE the auto-load effect so the bump lands before the fresh fetch snaps
  // the new generation.
  useEffect(() => {
    loadGenerationRef.current += 1
    setCpts([])
    setBoreholes([])
    setDetailMap(new Map())
    setPlotMap(new Map())
    setBoreholeDetailMap(new Map())
  }, [project?.id])

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  const refreshList = useCallback(async () => {
    if (!project) return
    const generation = loadGenerationRef.current
    try {
      const list = await api.cpt.list(project.id)
      // A project switch during the fetch supersedes this result — writing it
      // would show project A's CPTs in project B.
      if (generation !== loadGenerationRef.current) return
      setCpts(list)
      log.debug('cpt', `refreshList: ${list.length} CPTs`)
      // No per-CPT detail fetch here: CptListItem already carries
      // location_x/y for map markers. Detail fetched lazily on select.
    } catch (err) {
      log.error('cpt', 'refreshList failed', err)
      toast('error', t('data.load.cptListFailed'))
    }
  }, [project])

  const refreshBoreholeList = useCallback(async () => {
    if (!project) return
    const generation = loadGenerationRef.current
    try {
      const list = await api.borehole.list(project.id)
      if (generation !== loadGenerationRef.current) return
      setBoreholes(list)
      log.debug('borehole', `refreshList: ${list.length} boreholes`)
    } catch (err) {
      log.error('borehole', 'refreshList failed', err)
      toast('error', t('data.load.boreholeListFailed'))
    }
  }, [project])

  // Auto-load CPTs + boreholes whenever the API is ready and a project
  // is open. ``project?.id`` in the dep array means each project switch
  // re-fetches its own scope.
  useEffect(() => {
    if (ready && project) {
      void refreshList()
      void refreshBoreholeList()
    }
    // reason: refreshList / refreshBoreholeList are stable callbacks whose
    // identity changes only when project changes, already captured via
    // project?.id. Including them would fire an extra fetch on every
    // unrelated dep change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, project?.id])

  const loadCptDetail = useCallback(
    async (id: string) => {
      if (!project) return
      if (detailMap.has(id)) return
      const generation = loadGenerationRef.current
      try {
        const detail = await api.cpt.get(id, project.id)
        // A project switch during the fetch supersedes this — an A detail must
        // not land in B's freshly-cleared cache (Codex 3).
        if (generation !== loadGenerationRef.current) return
        setDetailMap(prev => new Map(prev).set(id, detail))
      } catch (err) {
        log.error('cpt', `loadCptDetail(${id}) failed`, err)
        // Non-fatal: the chart renders without detail (elevation header
        // shows fallback placeholder values).
      }
    },
    // reason: project.id is a stable scalar that changes only when the
    // active project changes; including the whole project object would
    // fire an extra load on every reference re-identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [detailMap, project?.id],
  )

  const loadChart = useCallback(
    async (id: string) => {
      if (!project) return
      if (plotMap.has(id)) return
      const generation = loadGenerationRef.current
      try {
        const plot = await api.cpt.plot(id, project.id)
        // Discard an A plot that resolves after a switch to B (Codex 3).
        if (generation !== loadGenerationRef.current) return
        setPlotMap(prev => new Map(prev).set(id, plot))
      } catch (err) {
        log.error('cpt', `loadChart(${id}) failed`, err)
        toast('error', t('data.load.chartFailed'))
      }
    },
    // reason: project.id is a stable scalar that changes only when the
    // active project changes; including the whole project object would
    // fire an extra load on every reference re-identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plotMap, project?.id],
  )

  const loadBoreholeDetail = useCallback(
    async (id: string, opts?: { force?: boolean }) => {
      if (!project) return
      if (boreholeDetailMap.has(id) && !opts?.force) return
      const generation = loadGenerationRef.current
      try {
        const detail = await api.borehole.get(id, project.id)
        // Discard an A borehole detail that resolves after a switch (Codex 3).
        if (generation !== loadGenerationRef.current) return
        setBoreholeDetailMap(prev => new Map(prev).set(id, detail))
      } catch (err) {
        log.error('borehole', `loadDetail(${id}) failed`, err)
        toast('error', t('data.load.boreholeDetailFailed'))
      }
    },
    // reason: project.id is a stable scalar that changes only when the
    // active project changes; including the whole project object would
    // fire an extra load on every reference re-identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [boreholeDetailMap, project?.id],
  )

  // ---------------------------------------------------------------------------
  // Hide / restore
  // ---------------------------------------------------------------------------

  // Thin per-kind wrappers over the shared kind-parameterised helpers above
  // (audit FE-HOOKS-11) — public API unchanged.

  const unhideCpts = useCallback(
    (ids: Iterable<string>) => {
      unhideInvestigations(ids, 'cpt', removedCptIds, setRemovedCptIds, project?.id ?? null)
    },
    [project, removedCptIds],
  )

  const unhideBoreholes = useCallback(
    (ids: Iterable<string>) => {
      unhideInvestigations(
        ids,
        'borehole',
        removedBoreholeIds,
        setRemovedBoreholeIds,
        project?.id ?? null,
      )
    },
    [project, removedBoreholeIds],
  )

  // selectedId / selectedBoreholeId are injected from App. When removing
  // the currently-selected investigation, deselect + navigate to map.
  const handleRemoveCpts = useCallback(
    (ids: string[]) => {
      if (ids.length === 0 || !project) return
      removeInvestigations({
        ids,
        kind: 'cpt',
        projectId: project.id,
        setRemovedIds: setRemovedCptIds,
        selectedId,
        deselect: () => {
          setSelectedId(null)
          setView('map')
        },
      })
    },
    [project, selectedId, setSelectedId, setView],
  )

  const handleRemoveBoreholes = useCallback(
    (ids: string[]) => {
      if (ids.length === 0 || !project) return
      removeInvestigations({
        ids,
        kind: 'borehole',
        projectId: project.id,
        setRemovedIds: setRemovedBoreholeIds,
        selectedId: selectedBoreholeId,
        deselect: () => {
          setSelectedBoreholeId(null)
          setView('map')
        },
      })
    },
    [project, selectedBoreholeId, setSelectedBoreholeId, setView],
  )

  const handleRestoreAllCpts = useCallback(() => {
    if (!project) return
    restoreAllInvestigations('cpt', removedCptIds, setRemovedCptIds, project.id)
  }, [project, removedCptIds])

  const handleRestoreAllBoreholes = useCallback(() => {
    if (!project) return
    restoreAllInvestigations(
      'borehole',
      removedBoreholeIds,
      setRemovedBoreholeIds,
      project.id,
    )
  }, [project, removedBoreholeIds])

  // The DOV-import undo command is built ONCE, when the import completes, but its
  // revert / reapply run later (when the user presses Ctrl+Z / Ctrl+Y). Capturing
  // the hide / unhide verbs into the command would freeze the removed-set they
  // close over, so the redo's unhide would then match nothing. Mirror the CURRENT
  // verbs into refs and let the command drive whatever they are at press time.
  const handleRemoveCptsRef = useRef(handleRemoveCpts)
  handleRemoveCptsRef.current = handleRemoveCpts
  const handleRemoveBoreholesRef = useRef(handleRemoveBoreholes)
  handleRemoveBoreholesRef.current = handleRemoveBoreholes
  const unhideCptsRef = useRef(unhideCpts)
  unhideCptsRef.current = unhideCpts
  const unhideBoreholesRef = useRef(unhideBoreholes)
  unhideBoreholesRef.current = unhideBoreholes

  // ---------------------------------------------------------------------------
  // Elevation edits
  // ---------------------------------------------------------------------------

  // Both elevation handlers update three pieces of state in one go:
  // the list (so the sidebar badge clears), the detail-cache entry
  // (so the chart/borelog header reflects the new value without a
  // re-fetch), and register an undo command. The skeleton is the shared
  // patchInvestigationElevation (FE-HOOKS-11); only the per-kind ``apply``
  // differs.
  const handlePatchCptElevation = useCallback(
    async (id: string, elevationM: number | null, zEpsg: number | null): Promise<void> => {
      if (!project) return
      // The CPT PATCH returns the full detail, so the cache entry is
      // replaced outright.
      const apply = (cptId: string, resp: CptResponse): void => {
        setDetailMap(prev => new Map(prev).set(cptId, resp))
        setCpts(prev =>
          prev.map(c =>
            c.id === cptId
              ? { ...c, elevation_m: resp.elevation_m, z_epsg: resp.z_epsg }
              : c,
          ),
        )
      }
      await patchInvestigationElevation({
        id,
        projectId: project.id,
        elevationM,
        zEpsg,
        before: cpts.find(c => c.id === id),
        patch: (i, pid, body) => api.cpt.patchElevation(i, pid, body),
        apply,
        logKind: 'cpt',
        undoDescriptionKey: 'undo.editCptElevation',
        pushUndo,
      })
    },
    [cpts, project, pushUndo],
  )

  const handlePatchBoreholeElevation = useCallback(
    async (id: string, elevationM: number | null, zEpsg: number | null): Promise<void> => {
      if (!project) return
      const apply = (
        bhId: string,
        resp: { elevation_m: number | null; z_epsg: number | null },
      ): void => {
        setBoreholes(prev =>
          prev.map(b =>
            b.id === bhId
              ? { ...b, elevation_m: resp.elevation_m, z_epsg: resp.z_epsg }
              : b,
          ),
        )
        // Patch the detail cache in place — the lab-test children, drill
        // segments, etc. are unchanged so a full re-fetch is wasteful.
        setBoreholeDetailMap(prev => {
          const existing = prev.get(bhId)
          if (!existing) return prev
          const next = new Map(prev)
          next.set(bhId, {
            ...existing,
            elevation_m: resp.elevation_m,
            z_epsg: resp.z_epsg,
          })
          return next
        })
      }
      await patchInvestigationElevation({
        id,
        projectId: project.id,
        elevationM,
        zEpsg,
        before: boreholes.find(b => b.id === id),
        patch: (i, pid, body) => api.borehole.patchElevation(i, pid, body),
        apply,
        logKind: 'borehole',
        undoDescriptionKey: 'undo.editBoreholeElevation',
        pushUndo,
      })
    },
    [boreholes, project, pushUndo],
  )

  // ---------------------------------------------------------------------------
  // Import — GEF file
  // ---------------------------------------------------------------------------

  // --- Refresh confirmation (one file at a time) -----------------------------
  //
  // The import parks on a promise the dialog resolves. A ref holds the resolver
  // rather than state because it is a continuation, not something to render;
  // the RENDERED half is ``refreshConfirm``.
  const [refreshConfirm, setRefreshConfirm] = useState<{
    fileName: string
    diff: CptRefreshDiff
  } | null>(null)
  const refreshConfirmResolveRef = useRef<((agreed: boolean) => void) | null>(null)

  const askRefreshConfirmation = useCallback(
    (fileName: string, diff: CptRefreshDiff): Promise<boolean> =>
      new Promise<boolean>(resolve => {
        refreshConfirmResolveRef.current = resolve
        setRefreshConfirm({ fileName, diff })
      }),
    [],
  )

  const settleRefreshConfirm = useCallback((agreed: boolean) => {
    const resolve = refreshConfirmResolveRef.current
    refreshConfirmResolveRef.current = null
    setRefreshConfirm(null)
    resolve?.(agreed)
  }, [])

  const confirmRefreshImport = useCallback(
    () => settleRefreshConfirm(true),
    [settleRefreshConfirm],
  )
  const cancelRefreshImport = useCallback(
    () => settleRefreshConfirm(false),
    [settleRefreshConfirm],
  )

  const handleImportCpt = useCallback(async () => {
    if (!project) return
    const filePaths = await window.electron.openFiles([
      { name: 'GEF Files', extensions: ['gef'] },
      { name: 'All Files', extensions: ['*'] },
    ])
    if (filePaths.length === 0) return

    setImporting(true)
    try {
      const results = await Promise.allSettled(
        filePaths.map(fp => api.cpt.import(fp, project.id)),
      )

      // Files whose CPT is already in the project come back refused with the
      // old-vs-new diff and NOTHING written. Replacing a stored series is
      // irreversible, so each one is put to the engineer on its numbers
      // (docs/ux.md "Reversible vs irreversible") and only then re-posted.
      // Asked sequentially: two dialogs at once is not a question, it is a
      // pile-up.
      const declinedNames: string[] = []
      for (let i = 0; i < results.length; i++) {
        const r = results[i]
        if (r.status !== 'rejected') continue
        if (!(r.reason instanceof CptRefreshConfirmationRequiredError)) continue
        const diff = r.reason.diff
        const fileName = filePaths[i].split(/[\\/]/).pop() ?? filePaths[i]
        const agreed = await askRefreshConfirmation(fileName, diff)
        if (!agreed) {
          declinedNames.push(diff.name)
          log.info('import', `refresh declined for ${diff.name} — row left untouched`)
          continue
        }
        results[i] = await api.cpt
          .import(filePaths[i], project.id, true)
          .then(value => ({ status: 'fulfilled', value }) as PromiseSettledResult<ImportCptResponse>)
          .catch(reason => ({ status: 'rejected', reason }) as PromiseSettledResult<ImportCptResponse>)
      }

      let imported = 0,
        warnings = 0,
        refreshed = 0,
        duplicates = 0,
        errors = 0
      let firstId: string | null = null
      const touchedIds: string[] = []
      // IDs created in this import (not refreshes) — tagged as session-
      // imports so the sidebar paints the amber asterisk and the project
      // becomes dirty until File → Save. A refreshed CPT is already in the
      // manifest: its row was updated in place, no new id joined the project.
      const newIds: string[] = []
      // Display names of the CPTs that were refreshed rather than created —
      // the toast names them so the user can see WHICH file replaced WHAT.
      const refreshedNames: string[] = []

      for (const r of results) {
        if (r.status === 'fulfilled') {
          firstId ??= r.value.cpt_id
          touchedIds.push(r.value.cpt_id)
          if (r.value.refreshed) {
            refreshed++
            refreshedNames.push(r.value.name || r.value.cpt_id)
          } else {
            if (r.value.has_errors) warnings++
            else imported++
            newIds.push(r.value.cpt_id)
          }
        } else if (r.reason instanceof DuplicateCptError) {
          // Only reachable against a backend that predates refresh-on-reimport.
          duplicates++
          firstId ??= r.reason.cptId
          touchedIds.push(r.reason.cptId)
        } else {
          errors++
        }
      }

      const ok = imported + warnings
      const parts: string[] = []
      if (ok > 0)
        parts.push(
          warnings > 0
            ? t('data.import.importedWithWarnings', { ok, warnings })
            : t('data.import.countImported', { n: ok }),
        )
      if (refreshed === 1)
        parts.push(t('data.import.refreshedOne', { name: refreshedNames[0] }))
      else if (refreshed > 1) parts.push(t('data.import.refreshedMany', { n: refreshed }))
      if (duplicates > 0) parts.push(t('data.import.countAlreadyExisted', { n: duplicates }))
      if (declinedNames.length === 1)
        parts.push(t('data.import.leftUnchangedOne', { name: declinedNames[0] }))
      else if (declinedNames.length > 1)
        parts.push(t('data.import.leftUnchangedMany', { n: declinedNames.length }))
      if (errors > 0) parts.push(t('data.import.countFailed', { n: errors }))
      toast(errors > 0 && ok === 0 && refreshed === 0 ? 'error' : 'success', parts.join(', '))

      unhideCpts(touchedIds)
      // Append to the manifest (visibility gate) AND the session-imports
      // tracking set (drives project-level dirty + discard rollback).
      addToManifest('cpt', newIds)
      // Guarded: a refresh-only import has no new ids, and the session-imports
      // set must stay untouched then — see the comment below.
      if (newIds.length > 0) addAllToSet(setSessionImportCptIds, newIds)
      // A refresh changed stored data without any new id joining the project,
      // so it must dirty the project through the project-level flag — NOT by
      // joining the session-imports set, whose discard-on-close path would then
      // DELETE a CPT that was in the project before this session started.
      if (refreshed > 0) markMutated?.()
      await refreshList()
      if (firstId) {
        setSelectedId(firstId)
        await loadChart(firstId)
        if (filePaths.length === 1) setView('chart')
      }
    } finally {
      setImporting(false)
    }
  }, [
    project,
    refreshList,
    loadChart,
    unhideCpts,
    addToManifest,
    setSessionImportCptIds,
    setSelectedId,
    setView,
    askRefreshConfirmation,
    markMutated,
    toast,
  ])

  // ---------------------------------------------------------------------------
  // Import — DOV bbox
  // ---------------------------------------------------------------------------

  const cancelBboxDraw = useCallback(() => {
    setBboxImportType(null)
  }, [])

  const handleImportDov = useCallback(() => {
    setView('map')
    setBboxImportType('cpt')
  }, [setView])

  const handleImportBoreholeDov = useCallback(() => {
    setView('map')
    setBboxImportType('borehole')
  }, [setView])

  // Snapshot of ids present BEFORE a DOV import starts so we can diff
  // for session-imports tagging (only genuinely-new rows dirty the project).
  // Stored in a ref so the completion effect can read it without being in
  // the dep array (it never changes the ids — just reads them once).
  const beforeImportIdsRef = useRef<{ cptIds: Set<string>; boreholeIds: Set<string> }>({
    cptIds: new Set(),
    boreholeIds: new Set(),
  })

  // Effect: when the SSE stream transitions to done/error, run the
  // post-import state updates (toast, manifest, list refresh, selection).
  // This mirrors the old handleBboxDrawn's ``finally`` block but decoupled
  // from the async callback so the progress panel can render mid-stream.
  // (``dovImporting`` needs no syncing — it derives from the stream state.)
  useEffect(() => {
    if (dovImportState.status === 'error') {
      log.error('import', `DOV stream error: ${dovImportState.message}`)
      // Share the ``dov-import`` replace key with the local bbox refusal so a
      // recurring server error replaces the live toast instead of stacking a
      // column of identical sticky errors (the "60 HTTP 422" flood).
      toast('error', dovImportState.message, 'dov-import')
      return
    }

    if (dovImportState.status !== 'done') return
    const { kind, result } = dovImportState

    if (kind === 'cpt') {
      const cptResult = result as import('./useDovImportStream').CptImportDonePayload
      const beforeIds = beforeImportIdsRef.current.cptIds
      const parts: string[] = []
      if (cptResult.imported > 0)
        parts.push(t('data.import.countImported', { n: cptResult.imported }))
      if (cptResult.duplicates > 0)
        parts.push(t('data.import.countAlreadyExisted', { n: cptResult.duplicates }))
      if (cptResult.failed > 0) parts.push(t('data.import.countFailed', { n: cptResult.failed }))
      toast(
        cptResult.failed > 0 && cptResult.imported === 0 ? 'error' : 'success',
        parts.join(', ') || t('data.import.noCptsInArea'),
      )
      // Only the tests this box NEWLY added — a refreshed existing CPT was
      // already in the project, so it is not "imported by this box".
      const newCptIds = cptResult.cpt_ids.filter(id => !beforeIds.has(id))
      unhideCpts(cptResult.cpt_ids)
      addToManifest('cpt', cptResult.cpt_ids)
      addAllToSet(setSessionImportCptIds, newCptIds)
      // One undo step for the whole import: Ctrl+Z removes exactly those tests
      // from the project the way "Remove from project" does — a project-local
      // hide (removed-set + is_hidden upsert), NEVER a DB delete, so the import
      // cache stays warm. Ctrl+Y unhides the same ids. A box that added nothing
      // (or a refused import, which returns above) pushes nothing.
      if (newCptIds.length > 0) {
        pushUndo({
          descriptionKey: 'undo.dovImport',
          revert: async () => {
            handleRemoveCptsRef.current(newCptIds)
          },
          reapply: async () => {
            unhideCptsRef.current(newCptIds)
          },
        })
      }
      void refreshList().then(() => {
        if (cptResult.imported === 1 && cptResult.cpt_ids.length > 0) {
          const id = cptResult.cpt_ids[0]
          setSelectedId(id)
          setSelectedBoreholeId(null)
          void loadChart(id).then(() => setView('chart'))
        }
      })
    } else {
      const bhResult = result as import('./useDovImportStream').BoreholeImportDonePayload
      const beforeIds = beforeImportIdsRef.current.boreholeIds
      const parts: string[] = []
      if (bhResult.imported > 0) parts.push(t('data.import.countImported', { n: bhResult.imported }))
      if (bhResult.duplicates > 0)
        parts.push(t('data.import.countAlreadyExisted', { n: bhResult.duplicates }))
      if (bhResult.failed > 0) parts.push(t('data.import.countFailed', { n: bhResult.failed }))
      const extras: string[] = []
      if (bhResult.interpretations_attached)
        extras.push(t('data.import.countObs', { n: bhResult.interpretations_attached }))
      if (bhResult.samples_attached)
        extras.push(t('data.import.countSamples', { n: bhResult.samples_attached }))
      if (bhResult.grain_sizes_attached)
        extras.push(t('data.import.countGrainSize', { n: bhResult.grain_sizes_attached }))
      const summary = parts.join(', ') || t('data.import.noBoreholesInArea')
      const detail = extras.length > 0 ? ` (+ ${extras.join(', ')})` : ''
      // A dead sub-phase (the interpretaties WFS is routinely down) comes back
      // as a COUNTER, not an error — so the severity has to be derived from it
      // or 40 boreholes with every driller's log missing toast exactly like a
      // clean import, and the engineer never re-runs (audit 2026-08-02).
      const subPhaseFailures = dovSubPhaseFailures(bhResult)
      // Labels are used verbatim — one of them contains "DOV", which
      // lowercasing turned into "dov". The retry advice is gated on a real
      // FAILURE: a WFS gap is DOV contradicting its own catalogue, and
      // re-running fetches the same nothing, so telling the engineer to retry
      // would send them round a loop.
      const retryable = subPhaseFailures.some(f => f.retryable)
      const failureDetail =
        subPhaseFailures.length > 0
          ? t('data.import.subPhaseMissing', {
              items: subPhaseFailures.map(f => `${f.count} × ${f.label}`).join(', '),
            }) + (retryable ? t('data.import.subPhaseRetry') : '')
          : ''
      const severity =
        bhResult.failed > 0 && bhResult.imported === 0
          ? 'error'
          : subPhaseFailures.length > 0
            ? 'warning'
            : 'success'
      toast(severity, summary + detail + failureDetail)
      // Only the boreholes this box NEWLY added (see the CPT branch).
      const newBoreholeIds = bhResult.borehole_ids.filter(id => !beforeIds.has(id))
      unhideBoreholes(bhResult.borehole_ids)
      addToManifest('borehole', bhResult.borehole_ids)
      addAllToSet(setSessionImportBoreholeIds, newBoreholeIds)
      // One undo step: Ctrl+Z hides exactly those boreholes (project-local,
      // never a DB delete); Ctrl+Y unhides them. Nothing added → nothing pushed.
      if (newBoreholeIds.length > 0) {
        pushUndo({
          descriptionKey: 'undo.dovImport',
          revert: async () => {
            handleRemoveBoreholesRef.current(newBoreholeIds)
          },
          reapply: async () => {
            unhideBoreholesRef.current(newBoreholeIds)
          },
        })
      }
      void refreshBoreholeList().then(() => {
        if (bhResult.imported === 1 && bhResult.borehole_ids.length > 0) {
          const id = bhResult.borehole_ids[0]
          setSelectedBoreholeId(id)
          setSelectedId(null)
          void loadBoreholeDetail(id).then(() => setView('chart'))
        }
      })
    }
    // reason: toast / addToManifest / setSession* / unhide* / load* / pushUndo
    // are all stable callbacks (the hide / unhide verbs the undo command drives
    // are read through refs, not deps); including them here would not change the
    // effect's trigger. The effect should only run when dovImportState
    // transitions to a terminal status — listing every stable callback adds
    // noise and would re-fire the whole post-import block on unrelated renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dovImportState])

  // ``bboxImportType`` is read and snapshotted at the very top of the
  // callback body before any state mutation so it can't go stale.
  const handleBboxDrawn = useCallback(
    (west: number, south: number, east: number, north: number) => {
      if (!project) return
      const importType = bboxImportType
      setBboxImportType(null)
      if (!importType) return // defensive — shouldn't happen
      // A degenerate box (a click without a drag hands BboxDrawer identical
      // corners), an out-of-range box, or one larger than the 25 km import
      // limit would only come back 422 from the server. Refuse it here with a
      // sentence the engineer can act on and never spawn the import — the
      // request goes out only for a box the schema would accept. The stable
      // ``dov-import`` replace key keeps repeated mis-clicks to one toast.
      const bboxProblem = dovBboxProblem({ west, south, east, north })
      if (bboxProblem) {
        toast(
          'warning',
          t(bboxProblem === 'too_large' ? 'data.import.bboxTooLarge' : 'data.import.drawABox'),
          'dov-import',
        )
        return
      }
      // Snapshot pre-import ids so the completion effect can diff for
      // the session-imports dirty-tracking (only genuinely-new rows
      // should paint the amber asterisk and trigger project dirty state).
      beforeImportIdsRef.current = {
        cptIds: new Set(cpts.map(c => c.id)),
        boreholeIds: new Set(boreholes.map(b => b.id)),
      }
      startDovStream({ kind: importType, bbox: { west, south, east, north }, projectId: project.id })
    },
    [project, bboxImportType, cpts, boreholes, startDovStream, toast],
  )

  // Expose a reset so the progress panel's "Close" / "Import again"
  // button can return the stream state to idle (e.g. after a done/error).
  const resetDovImport = useCallback(() => {
    resetDovStream()
  }, [resetDovStream])

  // Derive pending pins from the running state — only present for CPT imports.
  const pendingCptPins: PendingPin[] =
    dovImportState.status === 'running' && dovImportState.kind === 'cpt'
      ? dovImportState.pendingPins
      : []

  return {
    cpts,
    detailMap,
    plotMap,
    boreholes,
    boreholeDetailMap,
    importing,
    bboxImportType,
    dovImporting,
    removedCptIds,
    removedBoreholeIds,
    refreshList,
    refreshBoreholeList,
    loadCptDetail,
    loadChart,
    loadBoreholeDetail,
    cancelBboxDraw,
    unhideCpts,
    unhideBoreholes,
    handleRemoveCpts,
    handleRemoveBoreholes,
    handleRestoreAllCpts,
    handleRestoreAllBoreholes,
    handlePatchCptElevation,
    handlePatchBoreholeElevation,
    handleImportCpt,
    refreshConfirm,
    confirmRefreshImport,
    cancelRefreshImport,
    handleImportDov,
    handleImportBoreholeDov,
    handleBboxDrawn,
    dovImportState,
    resetDovImport,
    pendingCptPins,
  }
}
