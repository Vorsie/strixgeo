/**
 * Which geotech columns are standing on litho that has since been edited (#266).
 *
 * Packing bands are derived from the litho stack under them. Until this shipped
 * nothing linked the two, so dragging a litho contact left every band in that
 * column describing ground that is no longer there — silently, and all the way
 * into a client-facing export. The backend stamps, per column, the litho it
 * built the bands from; this hook asks which of those stamps no longer hold.
 *
 * The answer is DERIVED server-side on every read, so there is nothing here to
 * clear, invalidate or acknowledge: re-pressing the named columns re-stamps
 * them and the next fetch comes back quiet.
 *
 * ``refreshOn`` is load-bearing, for the same reason it is on ``useLithoSolids``:
 * the staleness only changes when litho or bands change, and without a re-fetch
 * keyed to those writes the indicator would keep showing the answer from before
 * the edit — which is the exact bug this exists to fix.
 *
 * Its own hook rather than three more fields on ``useGeologicalModel`` (already
 * past the god-module line, debt #201).
 *
 * @module hooks/useGeotechLithoStaleness
 */
import { useCallback, useEffect, useMemo, useState } from 'react'

import { api } from '../api/client'
import type { StaleGeotechColumn } from '../api/clients/geology.types'
import { log } from '../utils/log'

export interface UseGeotechLithoStalenessResult {
  /** Columns whose litho moved after their bands were made, sorted by label. */
  staleColumns: StaleGeotechColumn[]
  /** Investigation ids of those columns — the section overlay's membership test. */
  staleColumnIds: Set<string>
  /** ``staleColumns.length`` — what the toolbar chip counts. */
  staleColumnCount: number
  /**
   * Banded columns with no record of what they were built from.
   *
   * NOT stale: unknown provenance is not evidence the ground moved. Exposed so
   * the coming export guard can tell "verified current" from "cannot say".
   */
  unstampedColumnCount: number
  /** True while a fetch is in flight; the chip stays put rather than flickering. */
  loading: boolean
  /** Force a re-read — used after a press that should have cleared columns. */
  refresh: () => void
}

/**
 * Track the geotech model's litho-provenance staleness.
 *
 * Parameters
 * ----------
 * projectId
 *     Active project, or ``null``.
 * geotechModelId
 *     The GEOTECHNICAL model id (not the litho parent — the route guards on
 *     kind and answers 422 for anything else). ``null`` before a first
 *     subdivision, which reads as "nothing is stale" because nothing exists.
 * refreshOn
 *     Optional extra dependency for the fetch, participating by identity only.
 *     Pass a counter that bumps on litho AND geotech layer writes.
 *
 * Returns
 * -------
 * UseGeotechLithoStalenessResult
 */
export function useGeotechLithoStaleness(
  projectId: string | null,
  geotechModelId: string | null,
  refreshOn?: unknown,
): UseGeotechLithoStalenessResult {
  const [staleColumns, setStaleColumns] = useState<StaleGeotechColumn[]>([])
  const [unstampedColumnCount, setUnstampedColumnCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [refetchNonce, setRefetchNonce] = useState(0)

  useEffect(() => {
    if (!projectId || !geotechModelId) {
      setStaleColumns([])
      setUnstampedColumnCount(0)
      return
    }
    let cancelled = false
    setLoading(true)

    api.geology
      .geotechLithoStaleness(projectId, geotechModelId)
      .then(result => {
        if (cancelled) return
        const columns = result.stale_columns ?? []
        if (columns.length > 0) {
          log.warn(
            'useGeotechLithoStaleness',
            `${columns.length} geotech column(s) stand on edited litho: ` +
              columns.map(c => c.label).join(', '),
          )
        } else {
          log.debug(
            'useGeotechLithoStaleness',
            `model=${geotechModelId} clean; ${result.banded_column_count ?? 0} banded, ` +
              `${result.unstamped_column_count ?? 0} without provenance`,
          )
        }
        setStaleColumns(columns)
        setUnstampedColumnCount(result.unstamped_column_count ?? 0)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        // A failed read must not invent a warning: an amber indicator the
        // engineer cannot clear is worse than no indicator. Log and stay quiet.
        log.error('useGeotechLithoStaleness', 'could not read litho staleness', err)
        setStaleColumns([])
        setUnstampedColumnCount(0)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
    // ``refreshOn`` participates by IDENTITY only — it is never read.
  }, [projectId, geotechModelId, refetchNonce, refreshOn])

  const staleColumnIds = useMemo(
    () => new Set(staleColumns.map(c => c.investigation_id)),
    [staleColumns],
  )

  const refresh = useCallback((): void => {
    setRefetchNonce(n => n + 1)
  }, [])

  return {
    staleColumns,
    staleColumnIds,
    staleColumnCount: staleColumns.length,
    unstampedColumnCount,
    loading,
    refresh,
  }
}
