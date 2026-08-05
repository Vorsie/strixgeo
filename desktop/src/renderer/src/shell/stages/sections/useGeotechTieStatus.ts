/**
 * How much packing correlation is still outstanding — pipeline step 3's counter.
 *
 * The four-step packing pipeline (owner ruling 2026-08-04) gates step 4 on step
 * 3: ``divide-boreholes`` refuses with ``geotech_ties_pending`` while any tie is
 * still proposed. A button that fails when pressed teaches nothing; a button
 * that is disabled and says "12 packing ties are still proposed" teaches the
 * workflow. This hook is what lets the toolbar say it.
 *
 * ``GET .../geotech/tie-status`` takes the GEOTECHNICAL model id, so the hook is
 * inert until "1 · Subdivide CPTs" has created one — and reports ``loaded:
 * false`` rather than a confident zero, because "no ties pending" and "we have
 * not asked" must not look the same to a gate.
 *
 * Lives outside ``SectionsToolbar``, which is long past the 500-line
 * god-component threshold (debt #201).
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '../../../api/client'
import { log } from '../../../utils/log'

/** The counts the toolbar gates and labels on. */
export interface GeotechTieStatus {
  /** Proposed ties the engineer has neither accepted nor deleted. */
  pending: number
  /** Ties already accepted — what the resolver, the fill and the build read. */
  accepted: number
  /** Accepted ties a rebuild flagged for review (the violet ``!`` badges). */
  flagged: number
  /**
   * Whether these counts came from the server.
   *
   * ``false`` while there is no geotech model, while the first request is in
   * flight, and after a failed one. A gate must not read the zeros underneath
   * it as "nothing is pending".
   */
  loaded: boolean
}

const NOT_ASKED: GeotechTieStatus = { pending: 0, accepted: 0, flagged: 0, loaded: false }

/** What the hook hands back: the counts plus a way to re-ask. */
export interface UseGeotechTieStatusResult {
  status: GeotechTieStatus
  /** Re-fetch — call after every verb that can create or consume a tie. */
  refresh: () => Promise<void>
}

/**
 * Track the geotech model's pending / accepted / flagged packing-tie counts.
 *
 * Parameters
 * ----------
 * projectId : string | null
 *     Active project; ``null`` disables the hook.
 * geotechModelId : string | null
 *     Active GEOTECHNICAL model id; ``null`` until step 1 has run.
 *
 * Parameters (third)
 * ------------------
 * refreshOn : unknown, optional
 *     Re-count trigger: any value whose identity changes when a tie may have
 *     changed. The toolbar passes the geotech layer array — every per-tie
 *     accept/delete path refetches it, which is what keeps the chip and the
 *     step-4 gate honest without cross-tree plumbing (review MAJOR-1).
 *
 * Returns
 * -------
 * UseGeotechTieStatusResult
 *     The latest counts and a stable ``refresh``.
 */
export function useGeotechTieStatus(
  projectId: string | null,
  geotechModelId: string | null,
  refreshOn?: unknown,
): UseGeotechTieStatusResult {
  const [status, setStatus] = useState<GeotechTieStatus>(NOT_ASKED)
  // Guards against a late response from a model the engineer has left — the
  // counts would otherwise gate step 4 on a different model's ties.
  const requestedFor = useRef<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    if (!projectId || !geotechModelId) {
      requestedFor.current = null
      setStatus(NOT_ASKED)
      return
    }
    requestedFor.current = geotechModelId
    try {
      const result = await api.geology.geotechTieStatus(projectId, geotechModelId)
      if (requestedFor.current !== geotechModelId) return
      setStatus({
        pending: result.pending_tie_count,
        accepted: result.accepted_tie_count,
        flagged: result.flagged_tie_count,
        loaded: true,
      })
      log.debug(
        'sections',
        `geotechTieStatus: model=${geotechModelId} pending=${result.pending_tie_count} ` +
          `accepted=${result.accepted_tie_count} flagged=${result.flagged_tie_count}`,
      )
    } catch (err) {
      if (requestedFor.current !== geotechModelId) return
      // Reported, not swallowed — but the counts stay UNLOADED so the gate
      // falls back to "we do not know" rather than "nothing is pending".
      log.warn('sections', 'geotechTieStatus: failed', err)
      setStatus(NOT_ASKED)
    }
  }, [projectId, geotechModelId])

  useEffect(() => {
    void refresh()
    // reason: `refreshOn` is a pure re-count trigger (the caller passes a value
    // whose identity changes whenever a tie could have changed — e.g. the
    // geotech layer list, refetched by every accept/delete path); it is not
    // read, so the linter cannot see why it belongs here (review MAJOR-1).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, refreshOn])

  return { status, refresh }
}
