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
  DuplicateCptError,
} from '../api/client'
import type {
  BoreholeDetailResponse,
  BoreholeListItem,
  CptListItem,
  CptPlotResponse,
  CptResponse,
} from '../api/client'
import { addAllToSet } from '../utils/sets'
import { log } from '../utils/log'
import type { UndoCommand } from './useUndoStack'
import type { DovImportState, PendingPin } from './useDovImportStream'
import { useDovImportStream } from './useDovImportStream'

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
   *  ``dovImporting`` is derived from this as ``dovImportState.status === 'running'``
   *  and is kept for backward compat with all existing callers. */
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
  loadBoreholeDetail: (id: string) => Promise<void>
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
}: {
  project: { id: string; name: string } | null
  ready: boolean
  toast: (type: 'success' | 'error' | 'warning', message: string) => void
  pushUndo: (cmd: UndoCommand) => void
  addToManifest: (kind: 'cpt' | 'borehole', ids: string[]) => void
  setSessionImportCptIds: Dispatch<SetStateAction<Set<string>>>
  setSessionImportBoreholeIds: Dispatch<SetStateAction<Set<string>>>
  selectedId: string | null
  setSelectedId: (id: string | null) => void
  selectedBoreholeId: string | null
  setSelectedBoreholeId: (id: string | null) => void
  setView: (view: 'map' | 'chart') => void
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

  const [importing, setImporting] = useState(false)
  const [bboxImportType, setBboxImportType] = useState<'cpt' | 'borehole' | null>(null)
  const [dovImporting, setDovImporting] = useState(false)
  const { state: dovImportState, start: startDovStream, reset: resetDovStream } =
    useDovImportStream()

  // Project-local hide sets. Re-seeded from the review API on every
  // project change so the is_hidden state survives .gmproj round-trips.
  const [removedCptIds, setRemovedCptIds] = useState<Set<string>>(new Set())
  const [removedBoreholeIds, setRemovedBoreholeIds] = useState<Set<string>>(new Set())

  // ---------------------------------------------------------------------------
  // Hidden-set reload
  // ---------------------------------------------------------------------------

  // Reload from the server whenever the project changes. The .gmproj-
  // restore path pushes saved is_hidden state into the DB before this
  // fires; the GET picks up exactly what should be hidden. Empty fallback
  // on failure so the user sees ALL rows rather than nothing.
  useEffect(() => {
    if (!project) {
      setRemovedCptIds(new Set())
      setRemovedBoreholeIds(new Set())
      return
    }
    let cancelled = false
    api.review
      .list(project.id)
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
        log.warn('reviews', `load failed for project ${project.id}`, err)
      })
    return () => {
      cancelled = true
    }
  }, [project])

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  const refreshList = useCallback(async () => {
    if (!project) return
    try {
      const list = await api.cpt.list(project.id)
      setCpts(list)
      log.debug('cpt', `refreshList: ${list.length} CPTs`)
      // No per-CPT detail fetch here: CptListItem already carries
      // location_x/y for map markers. Detail fetched lazily on select.
    } catch (err) {
      log.error('cpt', 'refreshList failed', err)
      toast('error', 'Failed to load CPT list')
    }
  }, [project])

  const refreshBoreholeList = useCallback(async () => {
    if (!project) return
    try {
      const list = await api.borehole.list(project.id)
      setBoreholes(list)
      log.debug('borehole', `refreshList: ${list.length} boreholes`)
    } catch (err) {
      log.error('borehole', 'refreshList failed', err)
      toast('error', 'Failed to load borehole list')
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
      try {
        const detail = await api.cpt.get(id, project.id)
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
      try {
        const plot = await api.cpt.plot(id, project.id)
        setPlotMap(prev => new Map(prev).set(id, plot))
      } catch (err) {
        log.error('cpt', `loadChart(${id}) failed`, err)
        toast('error', 'Failed to load chart data')
      }
    },
    // reason: project.id is a stable scalar that changes only when the
    // active project changes; including the whole project object would
    // fire an extra load on every reference re-identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plotMap, project?.id],
  )

  const loadBoreholeDetail = useCallback(
    async (id: string) => {
      if (!project) return
      if (boreholeDetailMap.has(id)) return
      try {
        const detail = await api.borehole.get(id, project.id)
        setBoreholeDetailMap(prev => new Map(prev).set(id, detail))
      } catch (err) {
        log.error('borehole', `loadDetail(${id}) failed`, err)
        toast('error', 'Failed to load borehole detail')
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

  // Re-importing or re-fetching a record is an explicit "make this
  // visible again" signal — clear its id from the removed-set and flip
  // the server-side is_hidden flag. Without this a 409-duplicate import
  // returns the existing id but the sidebar's removed-filter keeps it
  // hidden and the user sees no change.
  const unhideCpts = useCallback(
    (ids: Iterable<string>) => {
      const touched: string[] = []
      setRemovedCptIds(prev => {
        const next = new Set(prev)
        for (const id of ids) {
          if (next.delete(id)) touched.push(id)
        }
        return touched.length > 0 ? next : prev
      })
      if (!project || touched.length === 0) return
      void Promise.allSettled(
        touched.map(id => api.review.upsert(project.id, 'cpt', id, { is_hidden: false })),
      )
    },
    [project],
  )

  const unhideBoreholes = useCallback(
    (ids: Iterable<string>) => {
      const touched: string[] = []
      setRemovedBoreholeIds(prev => {
        const next = new Set(prev)
        for (const id of ids) {
          if (next.delete(id)) touched.push(id)
        }
        return touched.length > 0 ? next : prev
      })
      if (!project || touched.length === 0) return
      void Promise.allSettled(
        touched.map(id =>
          api.review.upsert(project.id, 'borehole', id, { is_hidden: false }),
        ),
      )
    },
    [project],
  )

  // selectedId / selectedBoreholeId are injected from App. When removing
  // the currently-selected investigation, deselect + navigate to map.
  const handleRemoveCpts = useCallback(
    (ids: string[]) => {
      if (ids.length === 0 || !project) return
      setRemovedCptIds(prev => {
        const next = new Set(prev)
        for (const id of ids) next.add(id)
        return next
      })
      if (selectedId && ids.includes(selectedId)) {
        setSelectedId(null)
        setView('map')
      }
      void Promise.allSettled(
        ids.map(id => api.review.upsert(project.id, 'cpt', id, { is_hidden: true })),
      ).then(results => {
        const failed = results.filter(r => r.status === 'rejected').length
        if (failed > 0) {
          log.warn('reviews', `${failed}/${ids.length} hide-CPT upserts failed`)
        }
      })
    },
    [project, selectedId, setSelectedId, setView],
  )

  const handleRemoveBoreholes = useCallback(
    (ids: string[]) => {
      if (ids.length === 0 || !project) return
      setRemovedBoreholeIds(prev => {
        const next = new Set(prev)
        for (const id of ids) next.add(id)
        return next
      })
      if (selectedBoreholeId && ids.includes(selectedBoreholeId)) {
        setSelectedBoreholeId(null)
        setView('map')
      }
      void Promise.allSettled(
        ids.map(id =>
          api.review.upsert(project.id, 'borehole', id, { is_hidden: true }),
        ),
      ).then(results => {
        const failed = results.filter(r => r.status === 'rejected').length
        if (failed > 0) {
          log.warn('reviews', `${failed}/${ids.length} hide-borehole upserts failed`)
        }
      })
    },
    [project, selectedBoreholeId, setSelectedBoreholeId, setView],
  )

  const handleRestoreAllCpts = useCallback(() => {
    if (!project) return
    const ids = Array.from(removedCptIds)
    setRemovedCptIds(new Set())
    void Promise.allSettled(
      ids.map(id => api.review.upsert(project.id, 'cpt', id, { is_hidden: false })),
    ).then(results => {
      const failed = results.filter(r => r.status === 'rejected').length
      if (failed > 0) {
        log.warn('reviews', `${failed}/${ids.length} restore-CPT upserts failed`)
      }
    })
  }, [project, removedCptIds])

  const handleRestoreAllBoreholes = useCallback(() => {
    if (!project) return
    const ids = Array.from(removedBoreholeIds)
    setRemovedBoreholeIds(new Set())
    void Promise.allSettled(
      ids.map(id =>
        api.review.upsert(project.id, 'borehole', id, { is_hidden: false }),
      ),
    ).then(results => {
      const failed = results.filter(r => r.status === 'rejected').length
      if (failed > 0) {
        log.warn('reviews', `${failed}/${ids.length} restore-borehole upserts failed`)
      }
    })
  }, [project, removedBoreholeIds])

  // ---------------------------------------------------------------------------
  // Elevation edits
  // ---------------------------------------------------------------------------

  // Both elevation handlers update three pieces of state in one go:
  // the list (so the sidebar badge clears), the detail-cache entry
  // (so the chart/borelog header reflects the new value without a
  // re-fetch), and register an undo command.
  const handlePatchCptElevation = useCallback(
    async (id: string, elevationM: number | null, zEpsg: number | null): Promise<void> => {
      if (!project) return
      // Snapshot pre-edit values from the list so undo can PATCH them
      // back even if the user has been clicking around between edits.
      const before = cpts.find(c => c.id === id)
      const beforeElev = before?.elevation_m ?? null
      const beforeZ = before?.z_epsg ?? null
      // Capture project.id in a local so the undo closures below don't
      // close over the reactive reference (avoids a stale closure if the
      // user somehow switches projects while an undo is pending).
      const pid = project.id
      const updated = await api.cpt.patchElevation(id, pid, {
        elevation_m: elevationM,
        z_epsg: zEpsg,
      })
      setDetailMap(prev => new Map(prev).set(id, updated))
      setCpts(prev =>
        prev.map(c =>
          c.id === id
            ? { ...c, elevation_m: updated.elevation_m, z_epsg: updated.z_epsg }
            : c,
        ),
      )
      log.info('cpt', `elevation patched: ${id} → ${elevationM} (z_epsg=${zEpsg})`)
      pushUndo({
        description: 'Edit CPT elevation',
        revert: async () => {
          const back = await api.cpt.patchElevation(id, pid, {
            elevation_m: beforeElev,
            z_epsg: beforeZ,
          })
          setDetailMap(prev => new Map(prev).set(id, back))
          setCpts(prev =>
            prev.map(c =>
              c.id === id
                ? { ...c, elevation_m: back.elevation_m, z_epsg: back.z_epsg }
                : c,
            ),
          )
        },
        reapply: async () => {
          const fwd = await api.cpt.patchElevation(id, pid, {
            elevation_m: elevationM,
            z_epsg: zEpsg,
          })
          setDetailMap(prev => new Map(prev).set(id, fwd))
          setCpts(prev =>
            prev.map(c =>
              c.id === id
                ? { ...c, elevation_m: fwd.elevation_m, z_epsg: fwd.z_epsg }
                : c,
            ),
          )
        },
      })
    },
    [cpts, project, pushUndo],
  )

  const handlePatchBoreholeElevation = useCallback(
    async (id: string, elevationM: number | null, zEpsg: number | null): Promise<void> => {
      if (!project) return
      const before = boreholes.find(b => b.id === id)
      const beforeElev = before?.elevation_m ?? null
      const beforeZ = before?.z_epsg ?? null
      // Capture project.id so undo closures don't close over the
      // reactive reference (mirrors the CPT elevation handler pattern).
      const pid = project.id
      const updated = await api.borehole.patchElevation(id, pid, {
        elevation_m: elevationM,
        z_epsg: zEpsg,
      })
      setBoreholes(prev =>
        prev.map(b =>
          b.id === id
            ? { ...b, elevation_m: updated.elevation_m, z_epsg: updated.z_epsg }
            : b,
        ),
      )
      // Patch the detail cache in place — the lab-test children, drill
      // segments, etc. are unchanged so a full re-fetch is wasteful.
      setBoreholeDetailMap(prev => {
        const existing = prev.get(id)
        if (!existing) return prev
        const next = new Map(prev)
        next.set(id, {
          ...existing,
          elevation_m: updated.elevation_m,
          z_epsg: updated.z_epsg,
        })
        return next
      })
      log.info('borehole', `elevation patched: ${id} → ${elevationM} (z_epsg=${zEpsg})`)
      pushUndo({
        description: 'Edit borehole elevation',
        revert: async () => {
          const back = await api.borehole.patchElevation(id, pid, {
            elevation_m: beforeElev,
            z_epsg: beforeZ,
          })
          setBoreholes(prev =>
            prev.map(b =>
              b.id === id
                ? { ...b, elevation_m: back.elevation_m, z_epsg: back.z_epsg }
                : b,
            ),
          )
          setBoreholeDetailMap(prev => {
            const existing = prev.get(id)
            if (!existing) return prev
            const next = new Map(prev)
            next.set(id, {
              ...existing,
              elevation_m: back.elevation_m,
              z_epsg: back.z_epsg,
            })
            return next
          })
        },
        reapply: async () => {
          const fwd = await api.borehole.patchElevation(id, pid, {
            elevation_m: elevationM,
            z_epsg: zEpsg,
          })
          setBoreholes(prev =>
            prev.map(b =>
              b.id === id
                ? { ...b, elevation_m: fwd.elevation_m, z_epsg: fwd.z_epsg }
                : b,
            ),
          )
          setBoreholeDetailMap(prev => {
            const existing = prev.get(id)
            if (!existing) return prev
            const next = new Map(prev)
            next.set(id, {
              ...existing,
              elevation_m: fwd.elevation_m,
              z_epsg: fwd.z_epsg,
            })
            return next
          })
        },
      })
    },
    [boreholes, project, pushUndo],
  )

  // ---------------------------------------------------------------------------
  // Import — GEF file
  // ---------------------------------------------------------------------------

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

      let imported = 0,
        warnings = 0,
        duplicates = 0,
        errors = 0
      let firstId: string | null = null
      const touchedIds: string[] = []
      // IDs created in this import (not duplicates) — tagged as session-
      // imports so the sidebar paints the amber asterisk and the project
      // becomes dirty until File → Save.
      const newIds: string[] = []

      for (const r of results) {
        if (r.status === 'fulfilled') {
          if (r.value.has_errors) warnings++
          else imported++
          firstId ??= r.value.cpt_id
          touchedIds.push(r.value.cpt_id)
          newIds.push(r.value.cpt_id)
        } else if (r.reason instanceof DuplicateCptError) {
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
        parts.push(`${ok} imported${warnings > 0 ? ` (${warnings} with warnings)` : ''}`)
      if (duplicates > 0) parts.push(`${duplicates} already existed`)
      if (errors > 0) parts.push(`${errors} failed`)
      toast(errors > 0 && ok === 0 ? 'error' : 'success', parts.join(', '))

      unhideCpts(touchedIds)
      // Append to the manifest (visibility gate) AND the session-imports
      // tracking set (drives project-level dirty + discard rollback).
      addToManifest('cpt', newIds)
      addAllToSet(setSessionImportCptIds, newIds)
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
  // post-import state updates (toast, manifest, list refresh, selection)
  // and sync ``dovImporting`` back to false. This mirrors the old
  // handleBboxDrawn's ``finally`` block but decoupled from the async
  // callback so the progress panel can render mid-stream.
  useEffect(() => {
    if (dovImportState.status === 'error') {
      log.error('import', `DOV stream error: ${dovImportState.message}`)
      toast('error', dovImportState.message)
      setDovImporting(false)
      return
    }

    if (dovImportState.status !== 'done') return
    const { kind, result } = dovImportState
    setDovImporting(false)

    if (kind === 'cpt') {
      const cptResult = result as import('./useDovImportStream').CptImportDonePayload
      const beforeIds = beforeImportIdsRef.current.cptIds
      const parts: string[] = []
      if (cptResult.imported > 0) parts.push(`${cptResult.imported} imported`)
      if (cptResult.duplicates > 0) parts.push(`${cptResult.duplicates} already existed`)
      if (cptResult.failed > 0) parts.push(`${cptResult.failed} failed`)
      toast(
        cptResult.failed > 0 && cptResult.imported === 0 ? 'error' : 'success',
        parts.join(', ') || 'No CPTs found in this area',
      )
      unhideCpts(cptResult.cpt_ids)
      addToManifest('cpt', cptResult.cpt_ids)
      addAllToSet(
        setSessionImportCptIds,
        cptResult.cpt_ids.filter(id => !beforeIds.has(id)),
      )
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
      if (bhResult.imported > 0) parts.push(`${bhResult.imported} imported`)
      if (bhResult.duplicates > 0) parts.push(`${bhResult.duplicates} already existed`)
      if (bhResult.failed > 0) parts.push(`${bhResult.failed} failed`)
      const extras: string[] = []
      if (bhResult.interpretations_attached)
        extras.push(`${bhResult.interpretations_attached} obs`)
      if (bhResult.samples_attached) extras.push(`${bhResult.samples_attached} samples`)
      if (bhResult.grain_sizes_attached)
        extras.push(`${bhResult.grain_sizes_attached} grain-size`)
      const summary = parts.join(', ') || 'No boreholes found in this area'
      const detail = extras.length > 0 ? ` (+ ${extras.join(', ')})` : ''
      toast(
        bhResult.failed > 0 && bhResult.imported === 0 ? 'error' : 'success',
        summary + detail,
      )
      unhideBoreholes(bhResult.borehole_ids)
      addToManifest('borehole', bhResult.borehole_ids)
      addAllToSet(
        setSessionImportBoreholeIds,
        bhResult.borehole_ids.filter(id => !beforeIds.has(id)),
      )
      void refreshBoreholeList().then(() => {
        if (bhResult.imported === 1 && bhResult.borehole_ids.length > 0) {
          const id = bhResult.borehole_ids[0]
          setSelectedBoreholeId(id)
          setSelectedId(null)
          void loadBoreholeDetail(id).then(() => setView('chart'))
        }
      })
    }
    // reason: toast / addToManifest / setSession* / unhide* / load* are all
    // stable callbacks; including them here would not change the effect's
    // trigger. The effect should only run when dovImportState transitions to
    // a terminal status — including every stable callback would add noise.
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
      // Snapshot pre-import ids so the completion effect can diff for
      // the session-imports dirty-tracking (only genuinely-new rows
      // should paint the amber asterisk and trigger project dirty state).
      beforeImportIdsRef.current = {
        cptIds: new Set(cpts.map(c => c.id)),
        boreholeIds: new Set(boreholes.map(b => b.id)),
      }
      setDovImporting(true)
      startDovStream({ kind: importType, bbox: { west, south, east, north }, projectId: project.id })
    },
    [project, bboxImportType, cpts, boreholes, startDovStream],
  )

  // Expose a reset so the progress panel's "Close" / "Import again"
  // button can return the stream state to idle (e.g. after a done/error).
  const resetDovImport = useCallback(() => {
    resetDovStream()
    setDovImporting(false)
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
    handleImportDov,
    handleImportBoreholeDov,
    handleBboxDrawn,
    dovImportState,
    resetDovImport,
    pendingCptPins,
  }
}
