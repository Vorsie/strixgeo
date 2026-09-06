// Bed-override state for the Data stage (owner ruling 2026-09-06).
//
// Owns the project's manual bed-level polygons plus the draw / form flow that
// creates them: the "Bed level" tool on the Data-stage map draws a polygon, the
// finished ring is held pending until the engineer types a bed elevation, and
// on submit it is POSTed. The list, with per-row edit / delete, is rendered by
// the Data inspector. The result is exposed on the shell bus so both the map
// (draw + render) and the inspector (list + form) read one source of truth, and
// so the tutorial can derive a ``bedOverrideExists`` fact from it.
//
// The returned object is memoised: it is a single field on the shell bus, whose
// memo recomputes when this object's identity changes, so a fresh object per
// render would defeat the bus memo (the S7 render-loop class).

import { useCallback, useEffect, useMemo, useState } from 'react'

import { api, type BedOverrideResponse, type BedOverrideVertex } from '../api/client'
import type { ProjectResponse } from '../api/client'
import { t } from '../i18n/translate'
import { log } from '../utils/log'
import { wgs84ToProjected } from './useWgs84'

/** A drawn map point in WGS84, as react-leaflet reports it. */
export interface LatLngPoint {
  lat: number
  lng: number
}

export interface UseBedOverridesResult {
  /** The project's bed overrides, newest first. */
  overrides: BedOverrideResponse[]
  /** True while the initial list is loading. */
  loading: boolean
  /** True while the "Bed level" draw tool is armed on the map. */
  drawing: boolean
  /** A finished-but-unsaved polygon ring (project CRS), awaiting a bed level. */
  pendingPolygon: BedOverrideVertex[] | null
  /** The id of the override whose level / label is being edited, if any. */
  editingId: string | null
  /** Arm the draw tool. */
  startDrawing: () => void
  /** Disarm the draw tool and drop any pending polygon. */
  cancelDrawing: () => void
  /** Called by the map drawer when a polygon is finished: projects the WGS84
   *  ring to the project CRS, stores it as ``pendingPolygon``, disarms drawing. */
  handlePolygonDrawn: (ring: LatLngPoint[]) => void
  /** Begin editing an existing override's label / level. */
  startEdit: (overrideId: string) => void
  /** Close the create / edit form without saving. */
  cancelForm: () => void
  /** Create (from ``pendingPolygon``) or update (``editingId``) with the form
   *  values. Resolves ``true`` on success, ``false`` on failure. */
  submit: (label: string, levelM: number) => Promise<boolean>
  /** Delete a bed override. */
  remove: (overrideId: string) => Promise<boolean>
  /** Reload the list from the server. */
  refresh: () => void
}

/** Arguments for {@link useBedOverrides}. */
export interface UseBedOverridesArgs {
  project: ProjectResponse | null
  /** The project's horizontal EPSG — the CRS the polygon ring is stored in. */
  epsg: number | null
  toast: (type: 'success' | 'error' | 'warning', message: string, replaceKey?: string) => void
}

/**
 * Manage the project's bed overrides and the draw / form flow.
 *
 * @param args  Active project, its horizontal EPSG, and the toast action.
 * @returns The bed-override slice for the shell bus.
 */
export function useBedOverrides(args: UseBedOverridesArgs): UseBedOverridesResult {
  const { project, epsg, toast } = args
  const projectId = project?.id ?? null

  const [overrides, setOverrides] = useState<BedOverrideResponse[]>([])
  const [loading, setLoading] = useState(false)
  const [drawing, setDrawing] = useState(false)
  const [pendingPolygon, setPendingPolygon] = useState<BedOverrideVertex[] | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [reloadNonce, setReloadNonce] = useState(0)

  // Load the list whenever the project changes (or an explicit refresh).
  useEffect(() => {
    if (projectId == null) {
      setOverrides([])
      return
    }
    let cancelled = false
    setLoading(true)
    api.bedOverrides
      .list(projectId)
      .then(rows => {
        if (cancelled) return
        setOverrides(rows)
        log.debug('bedOverrides', `loaded ${rows.length} bed override(s)`)
      })
      .catch(err => {
        if (cancelled) return
        log.warn('bedOverrides', 'failed to load bed overrides', err)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, reloadNonce])

  const refresh = useCallback(() => setReloadNonce(n => n + 1), [])

  const startDrawing = useCallback(() => {
    setPendingPolygon(null)
    setEditingId(null)
    setDrawing(true)
  }, [])

  const cancelDrawing = useCallback(() => {
    setDrawing(false)
    setPendingPolygon(null)
  }, [])

  const handlePolygonDrawn = useCallback(
    (ring: LatLngPoint[]) => {
      setDrawing(false)
      if (epsg == null || ring.length < 3) {
        setPendingPolygon(null)
        return
      }
      const vertices: BedOverrideVertex[] = ring.map(p => wgs84ToProjected(p.lat, p.lng, epsg))
      setEditingId(null)
      setPendingPolygon(vertices)
    },
    [epsg],
  )

  const startEdit = useCallback((overrideId: string) => {
    setPendingPolygon(null)
    setDrawing(false)
    setEditingId(overrideId)
  }, [])

  const cancelForm = useCallback(() => {
    setPendingPolygon(null)
    setEditingId(null)
  }, [])

  const submit = useCallback(
    async (label: string, levelM: number): Promise<boolean> => {
      if (projectId == null || epsg == null) return false
      try {
        if (editingId != null) {
          const updated = await api.bedOverrides.update(projectId, editingId, {
            label,
            level_m: levelM,
          })
          setOverrides(prev => prev.map(o => (o.id === updated.id ? updated : o)))
          setEditingId(null)
          toast('success', t('bedOverride.updated'))
          return true
        }
        if (pendingPolygon != null) {
          const created = await api.bedOverrides.create(projectId, {
            label,
            level_m: levelM,
            epsg,
            vertices: pendingPolygon,
          })
          setOverrides(prev => [created, ...prev])
          setPendingPolygon(null)
          toast('success', t('bedOverride.created'))
          return true
        }
        return false
      } catch (err) {
        log.warn('bedOverrides', 'failed to save bed override', err)
        toast('error', t('bedOverride.saveFailed'))
        return false
      }
    },
    [projectId, epsg, editingId, pendingPolygon, toast],
  )

  const remove = useCallback(
    async (overrideId: string): Promise<boolean> => {
      if (projectId == null) return false
      try {
        await api.bedOverrides.delete(projectId, overrideId)
        setOverrides(prev => prev.filter(o => o.id !== overrideId))
        if (editingId === overrideId) setEditingId(null)
        toast('success', t('bedOverride.deleted'))
        return true
      } catch (err) {
        log.warn('bedOverrides', 'failed to delete bed override', err)
        toast('error', t('bedOverride.saveFailed'))
        return false
      }
    },
    [projectId, editingId, toast],
  )

  return useMemo(
    (): UseBedOverridesResult => ({
      overrides,
      loading,
      drawing,
      pendingPolygon,
      editingId,
      startDrawing,
      cancelDrawing,
      handlePolygonDrawn,
      startEdit,
      cancelForm,
      submit,
      remove,
      refresh,
    }),
    [
      overrides,
      loading,
      drawing,
      pendingPolygon,
      editingId,
      startDrawing,
      cancelDrawing,
      handlePolygonDrawn,
      startEdit,
      cancelForm,
      submit,
      remove,
      refresh,
    ],
  )
}
