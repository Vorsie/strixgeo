// Fetch + compute the distribution statistics of one geotech unit.
//
// Extracted from ``ParametersInspector`` rather than written inside it: the
// pane was already at the 500-line god-component gate (debt #201), and the
// "which holes does this unit stand on, are their series here yet, what is the
// spread" question is a coherent piece with its own lifecycle.
//
// The arithmetic lives one level down in ``unitStatistics.ts`` (pure, no
// React). This hook owns only the fetching and the caching decisions.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { api } from '../../../api/client'
import type { CptPlotResponse, LithoLayerResponse } from '../../../api/client'
import { log } from '../../../utils/log'
import {
  computeUnitStatistics,
  unitCptBands,
  type UnitChannelSeries,
  type UnitStatistics,
} from './unitStatistics'

/** What the inspector needs to draw a unit's distributions. */
export interface UseUnitStatisticsResult {
  /** Pooled measurements + summaries; an empty result when no unit is chosen. */
  statistics: UnitStatistics
  /** True while this unit's missing series are in flight. */
  loading: boolean
  /** Why the fetch failed, or ``null``. */
  error: string | null
  /**
   * How many of the unit's CPTs still have no series.
   *
   * Named so the panel can say the picture is incomplete rather than letting a
   * partial box read as the whole unit — a batch response drops ids it has no
   * series for instead of failing, so "some holes never arrive" is a normal
   * outcome, not an error.
   */
  pendingCptCount: number
  /**
   * The CPT ids the pool stands on, sorted + deduplicated (after the
   * membership filter). The population header counts sections through this —
   * a section contributes when one of THESE holes is its member.
   */
  pooledCptIds: readonly string[]
  /** Re-run the fetch after a failure. */
  retry: () => void
}

/**
 * Statistics for the currently-scoped Parameters node.
 *
 * Parameters
 * ----------
 * scopeBands
 *     The scoped node's accepted bands from ``bandsForScope`` — the single
 *     band-selection authority. An empty list means no node is scoped, so the
 *     hook does no work and reports an empty result. The hook narrows these to
 *     their CPT-anchored, member-filtered subset for the arithmetic.
 * plotMap
 *     The shell's shared per-CPT plot cache. Consulted FIRST so a hole the
 *     engineer already opened is never re-fetched.
 * projectId
 *     Scope for the plot request.
 * memberInvestigationIds
 *     The pooling population — the canonical section-membership union over
 *     the app's VISIBLE lists (owner ruling 2026-08-27: only CPTs on the
 *     sections pool; hidden and removed are excluded). ``null`` skips the
 *     filter.
 *
 * Returns
 * -------
 * UseUnitStatisticsResult
 *     Statistics plus the loading / error / incompleteness state.
 */
export function useUnitStatistics(
  scopeBands: readonly LithoLayerResponse[],
  plotMap: ReadonlyMap<string, CptPlotResponse>,
  projectId: string,
  memberInvestigationIds: ReadonlySet<string> | null = null,
): UseUnitStatisticsResult {
  const bands = useMemo(
    () => unitCptBands(scopeBands, memberInvestigationIds),
    [scopeBands, memberInvestigationIds],
  )

  // Sorted + de-duplicated so the fetch key below is stable under any band
  // ordering: a band edit that reshuffles the array without changing WHICH
  // holes it names must not refire the request.
  const cptIds = useMemo(
    () => Array.from(new Set(bands.map(b => b.cptId))).sort(),
    [bands],
  )
  const cptIdsKey = cptIds.join(',')

  const [fetched, setFetched] = useState<Map<string, CptPlotResponse>>(new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retryNonce, setRetryNonce] = useState(0)

  // The shared cache reachable from the effect WITHOUT being a dependency: it
  // re-identifies on every unrelated CPT fetch, and re-running this request
  // for those would be pure churn (the same reason ParametersInspector keeps
  // its own ``plotMapRef``).
  const plotMapRef = useRef(plotMap)
  plotMapRef.current = plotMap

  useEffect(() => {
    if (cptIds.length === 0) {
      setFetched(new Map())
      setLoading(false)
      setError(null)
      return
    }
    const missing = cptIds.filter(id => !plotMapRef.current.has(id))
    if (missing.length === 0) {
      setFetched(new Map())
      setLoading(false)
      setError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        // ONE round-trip for the whole unit. A unit can span dozens of holes,
        // and ``plot-batch`` exists precisely so a per-hole loop is not what
        // the engineer waits through.
        log.debug('cpt', `unit statistics: plot-batch for ${missing.length} cpt(s)`)
        const plots = await api.cpt.plotBatch(missing, projectId)
        if (cancelled) return
        log.debug('cpt', `unit statistics: ${plots.length}/${missing.length} series returned`)
        setFetched(new Map(plots.map(p => [p.cpt_id, p])))
        setLoading(false)
      } catch (err) {
        if (cancelled) return
        log.error('cpt', `unit statistics plot-batch(${missing.length} cpts) failed`, err)
        setError(
          err instanceof Error && err.message
            ? `Could not load the measurements for this unit: ${err.message}`
            : 'Could not load the measurements for this unit.',
        )
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // reason: ``cptIdsKey`` is the stable projection of ``cptIds`` — depending
    // on the array itself refires on every re-identification even when it
    // names the same holes. ``plotMapRef`` is a ref by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cptIdsKey, projectId, retryNonce])

  const seriesByCpt = useMemo<Map<string, UnitChannelSeries>>(() => {
    const out = new Map<string, UnitChannelSeries>()
    for (const id of cptIds) {
      const plot = plotMap.get(id) ?? fetched.get(id)
      if (plot === undefined) continue
      out.set(id, {
        depthsM: plot.depths_m,
        qcMpa: plot.qc_mpa,
        fsMpa: plot.fs_mpa,
        rfPct: plot.rf_pct,
      })
    }
    return out
  }, [cptIds, plotMap, fetched])

  const statistics = useMemo(
    () => computeUnitStatistics(bands, seriesByCpt),
    [bands, seriesByCpt],
  )

  const retry = useCallback(() => setRetryNonce(n => n + 1), [])

  return {
    statistics,
    loading,
    error,
    pendingCptCount: cptIds.length - seriesByCpt.size,
    pooledCptIds: cptIds,
    retry,
  }
}
