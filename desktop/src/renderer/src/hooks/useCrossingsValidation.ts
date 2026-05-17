// Shared crossings-validation data hook (debt #18).
//
// The crossings validator runs against the cached TIN. Post the
// on-click-build pivot, per-contact edits only flip is_stale=True —
// Delaunay re-runs on Build. Validating a STALE cache produced a
// confident amber "N crossings detected" banner the user couldn't
// trust ("I rebuilt and it went away — was it ever real?"). The
// short-term 43f3864 fix appended an "as of last build" suffix; this
// is the cleaner behaviour the debt scoped:
//
//   * staleSurfaceCount > 0  → DON'T fetch (the cache can't be
//     trusted). Expose pendingBuild=true so the inspector shows a
//     neutral "Build to validate" state instead of a qualified amber
//     warning about possibly-wrong geometry.
//   * staleSurfaceCount === 0 → fetch + report real crossings.
//
// staleSurfaceCount is in the effect deps, so a Build that clears it
// (1 → 0) re-runs the effect and fetches fresh crossings
// automatically — that is the "re-validate on rebuild success" leg,
// no extra wiring in the rebuild callback.
//
// Extracted from the two inline copies (GeologyInspector +
// SectionsInspector's CrossingsBanner) so the gating lives in ONE
// place; each inspector keeps its own (divergent) banner markup.

import { useEffect, useState } from 'react'

import { api } from '../api/client'
import type { GapIssueResponse } from '../api/client'
import { log } from '../utils/log'

export interface CrossingsValidation {
  /** Real crossing issues for a FRESH model. Always empty while
   * pendingBuild is true (a stale cache is not validated). */
  crossingIssues: GapIssueResponse[]
  /** True when surfaces are stale: validation was deliberately
   * skipped and the user must Build before crossings can be trusted. */
  pendingBuild: boolean
}

/**
 * Fetch crossing issues for a model, gated on surface freshness.
 *
 * Parameters
 * ----------
 * projectId
 *     The active project id.
 * modelId
 *     The active geological model id, or ``null`` when none.
 * refreshSignal
 *     A counter that bumps on every contact mutation; re-runs the
 *     effect so the banner tracks edits.
 * staleSurfaceCount
 *     Number of formation surfaces whose cached TIN is stale. > 0
 *     suppresses the fetch (validation pending a Build).
 *
 * Returns
 * -------
 * CrossingsValidation
 *     ``crossingIssues`` (only for a fresh model) + ``pendingBuild``.
 */
export function useCrossingsValidation(
  projectId: string,
  modelId: string | null,
  refreshSignal: number,
  staleSurfaceCount: number,
): CrossingsValidation {
  const [crossingIssues, setCrossingIssues] = useState<GapIssueResponse[]>([])

  // pendingBuild is derived, not state — it is a pure function of the
  // inputs, so deriving it avoids a second render + any risk of it
  // disagreeing with crossingIssues.
  const pendingBuild = modelId !== null && staleSurfaceCount > 0

  useEffect(() => {
    if (modelId === null || staleSurfaceCount > 0) {
      // No model, or the cache is stale → never show stale-TIN
      // crossings. Clearing keeps a previous fresh result from
      // lingering once an edit makes the model stale.
      setCrossingIssues([])
      return
    }
    let cancelled = false
    api.geology
      .validateCrossings(projectId, modelId)
      .then(resp => {
        if (cancelled) return
        setCrossingIssues(resp.issues)
      })
      .catch(err => {
        log.warn('geology', `validateCrossings failed for ${modelId}`, err)
        if (!cancelled) setCrossingIssues([])
      })
    return () => {
      cancelled = true
    }
  }, [projectId, modelId, refreshSignal, staleSurfaceCount])

  return { crossingIssues, pendingBuild }
}
