// CPT and borehole data — list state, detail caches, import flows,
// hide/restore mechanics, and elevation edits.
//
// Selection state (selectedId / selectedBoreholeId) is owned by the
// App coordinator and injected here so this hook doesn't couple to
// the section-selection hook (which also needs those setters). The
// view-navigation signal (setView) is similarly injected.

import { useCallback, useEffect, useState } from 'react'

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
  ) => Promise<void>
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
  toast: (type: 'success' | 'error', message: string) => void
  pushUndo: (cmd: UndoCommand) => void
  addToManifest: (kind: 'cpt' | 'borehole', ids: string[]) => void
  setSessionImportCptIds: (updater: (prev: Set<string>) => Set<string>) => void
  setSessionImportBoreholeIds: (updater: (prev: Set<string>) => Set<string>) => void
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
      if (detailMap.has(id)) return
      try {
        const detail = await api.cpt.get(id)
        setDetailMap(prev => new Map(prev).set(id, detail))
      } catch (err) {
        log.error('cpt', `loadCptDetail(${id}) failed`, err)
        // Non-fatal: the chart renders without detail (elevation header
        // shows fallback placeholder values).
      }
    },
    [detailMap],
  )

  const loadChart = useCallback(
    async (id: string) => {
      if (plotMap.has(id)) return
      try {
        const plot = await api.cpt.plot(id)
        setPlotMap(prev => new Map(prev).set(id, plot))
      } catch (err) {
        log.error('cpt', `loadChart(${id}) failed`, err)
        toast('error', 'Failed to load chart data')
      }
    },
    [plotMap],
  )

  const loadBoreholeDetail = useCallback(
    async (id: string) => {
      if (boreholeDetailMap.has(id)) return
      try {
        const detail = await api.borehole.get(id)
        setBoreholeDetailMap(prev => new Map(prev).set(id, detail))
      } catch (err) {
        log.error('borehole', `loadDetail(${id}) failed`, err)
        toast('error', 'Failed to load borehole detail')
      }
    },
    [boreholeDetailMap],
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
      // Snapshot pre-edit values from the list so undo can PATCH them
      // back even if the user has been clicking around between edits.
      const before = cpts.find(c => c.id === id)
      const beforeElev = before?.elevation_m ?? null
      const beforeZ = before?.z_epsg ?? null
      const updated = await api.cpt.patchElevation(id, {
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
          const back = await api.cpt.patchElevation(id, {
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
          const fwd = await api.cpt.patchElevation(id, {
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
    [cpts, pushUndo],
  )

  const handlePatchBoreholeElevation = useCallback(
    async (id: string, elevationM: number | null, zEpsg: number | null): Promise<void> => {
      const before = boreholes.find(b => b.id === id)
      const beforeElev = before?.elevation_m ?? null
      const beforeZ = before?.z_epsg ?? null
      const updated = await api.borehole.patchElevation(id, {
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
          const back = await api.borehole.patchElevation(id, {
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
          const fwd = await api.borehole.patchElevation(id, {
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
    [boreholes, pushUndo],
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

  // ``bboxImportType`` is read inside the async body. Reading from state
  // in an async callback can see a stale value if the state mutates while
  // the async code is suspended. Here we snapshot it immediately (first
  // line of the function body) before any await — safe.
  const handleBboxDrawn = useCallback(
    async (west: number, south: number, east: number, north: number) => {
      if (!project) return
      const importType = bboxImportType
      setBboxImportType(null)
      if (!importType) return // defensive — shouldn't happen
      setDovImporting(true)
      try {
        if (importType === 'cpt') {
          // Snapshot ids BEFORE the API call so we can diff for the
          // session-imports tagging. ``result.cpt_ids`` includes both
          // newly-imported and pre-existing rows; we only want the new.
          const beforeIds = new Set(cpts.map(c => c.id))
          const result = await api.cpt.importDov({ west, south, east, north }, project.id)
          const parts: string[] = []
          if (result.imported > 0) parts.push(`${result.imported} imported`)
          if (result.duplicates > 0) parts.push(`${result.duplicates} already existed`)
          if (result.failed > 0) parts.push(`${result.failed} failed`)
          toast(
            result.failed > 0 && result.imported === 0 ? 'error' : 'success',
            parts.join(', ') || 'No CPTs found in this area',
          )
          unhideCpts(result.cpt_ids)
          // Every CPT returned by DOV (new or duplicate) needs to be
          // visible — add them all to the manifest. Session-imports
          // tracking only flags the genuinely-new ones so a re-import
          // of an already-saved area doesn't re-dirty the project.
          addToManifest('cpt', result.cpt_ids)
          addAllToSet(
            setSessionImportCptIds,
            result.cpt_ids.filter(id => !beforeIds.has(id)),
          )
          await refreshList()
          if (result.imported === 1 && result.cpt_ids.length > 0) {
            const id = result.cpt_ids[0]
            setSelectedId(id)
            setSelectedBoreholeId(null)
            await loadChart(id)
            setView('chart')
          }
        } else {
          const beforeIds = new Set(boreholes.map(b => b.id))
          const result = await api.borehole.importDov(
            { west, south, east, north },
            project.id,
          )
          const parts: string[] = []
          if (result.imported > 0) parts.push(`${result.imported} imported`)
          if (result.duplicates > 0) parts.push(`${result.duplicates} already existed`)
          if (result.failed > 0) parts.push(`${result.failed} failed`)
          const extras: string[] = []
          if (result.interpretations_attached)
            extras.push(`${result.interpretations_attached} obs`)
          if (result.samples_attached) extras.push(`${result.samples_attached} samples`)
          if (result.grain_sizes_attached)
            extras.push(`${result.grain_sizes_attached} grain-size`)
          const summary = parts.join(', ') || 'No boreholes found in this area'
          const detail = extras.length > 0 ? ` (+ ${extras.join(', ')})` : ''
          toast(
            result.failed > 0 && result.imported === 0 ? 'error' : 'success',
            summary + detail,
          )
          unhideBoreholes(result.borehole_ids)
          addToManifest('borehole', result.borehole_ids)
          addAllToSet(
            setSessionImportBoreholeIds,
            result.borehole_ids.filter(id => !beforeIds.has(id)),
          )
          await refreshBoreholeList()
          if (result.imported === 1 && result.borehole_ids.length > 0) {
            const id = result.borehole_ids[0]
            setSelectedBoreholeId(id)
            setSelectedId(null)
            await loadBoreholeDetail(id)
            setView('chart')
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'DOV import failed'
        log.error('import', `DOV bbox import failed: ${msg}`, err)
        toast('error', msg)
      } finally {
        setDovImporting(false)
      }
    },
    [
      project,
      bboxImportType,
      cpts,
      boreholes,
      refreshList,
      refreshBoreholeList,
      loadChart,
      loadBoreholeDetail,
      unhideCpts,
      unhideBoreholes,
      addToManifest,
      setSessionImportCptIds,
      setSessionImportBoreholeIds,
      setSelectedId,
      setSelectedBoreholeId,
      setView,
    ],
  )

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
  }
}
