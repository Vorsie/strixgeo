// Litho solid state — owns the list of built body solids, the build
// trigger, and per-body colour editing.
//
// Lifted from LithologyCanvas (Task 8, Litho 3D milestone 2) so the
// toolbar (Build button + stale badge), the canvas (bodySolids render),
// and the inspector (grouped legend) all read the same state without
// prop-drilling.
//
// Fetch gate change from the canvas version: solids are fetched whenever
// a litho model is active — NOT gated on viewMode==='solid'.  The toolbar
// stale badge and the inspector legend must reflect reality regardless of
// which 3D view (solid vs fence) is currently shown.  The GET is cheap.

import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '../api/client'
import type { LithoBodySolidResponse } from '../api/client'
import { log } from '../utils/log'

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

export interface UseLithoSolidsResult {
  /** All built body solids for the active litho model. */
  lithoSolids: LithoBodySolidResponse[]
  /** True while the initial fetch (or a post-build re-fetch) is in flight. */
  lithoSolidsLoading: boolean
  /** True while a rebuild is in progress. */
  lithoSolidsBuilding: boolean
  /**
   * True when at least one solid exists with triangles.  Drives the canvas
   * decision to suppress TIN sheets and pass solids to the 3D viewer.
   */
  hasLithoSolids: boolean
  /**
   * True when at least one solid has ``is_stale === true``.  Drives the amber
   * tint on the toolbar Build Solids button.
   */
  hasStaleLithoSolid: boolean
  /** Build / rebuild solids for the active litho model, toast the result. */
  buildLithoSolids: () => Promise<void>
  /**
   * Set or clear a per-body display colour.
   *
   * ``null`` resets to the formation's lithology colour.  Optimistic update
   * applied immediately; debounced server write at 200 ms.
   *
   * Parameters
   * ----------
   * bodyId
   *     UUID of the body solid to update.
   * color
   *     CSS hex string (``#rrggbb``) or ``null`` to reset.
   */
  setBodyColor: (bodyId: string, color: string | null) => void
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * React hook that owns litho body solid state for the active litho model.
 *
 * Fetches the list of body solids whenever ``projectId`` and
 * ``lithoModelId`` are both non-null.  The fetch re-runs when either id
 * changes or ``refetchNonce`` is bumped (after a successful build).
 *
 * Parameters
 * ----------
 * projectId
 *     Active project id, or ``null`` when no project is open.
 * lithoModelId
 *     Active lithostratigraphic model id, or ``null`` when none active.
 * toast
 *     Shell toast action — surfaces build results and errors.
 *
 * Returns
 * -------
 * UseLithoSolidsResult
 *     All solid state + build/colour handlers.
 */
export function useLithoSolids(
  projectId: string | null,
  lithoModelId: string | null,
  toast: (type: 'success' | 'error' | 'warning', message: string) => void,
): UseLithoSolidsResult {
  const [solids, setSolids] = useState<LithoBodySolidResponse[]>([])
  const [loading, setLoading] = useState(false)
  const [building, setBuilding] = useState(false)
  const [refetchNonce, setRefetchNonce] = useState(0)

  // -------------------------------------------------------------------------
  // Fetch — runs whenever project / model changes, or after a build.
  // Not gated on viewMode: toolbar + inspector need the state independently.
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!projectId || !lithoModelId) {
      setSolids([])
      return
    }
    let cancelled = false

    log.debug('useLithoSolids', `fetching solids model=${lithoModelId} nonce=${refetchNonce}`)
    setLoading(true)

    api.geology
      .listLithoSolids(projectId, lithoModelId)
      .then(result => {
        if (cancelled) return
        log.info('useLithoSolids', `fetched ${result.length} body solid(s)`)
        setSolids(result)
      })
      .catch(err => {
        if (cancelled) return
        log.error('useLithoSolids', 'failed to fetch body solids', err)
        setSolids([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
      setLoading(false)
    }
  }, [projectId, lithoModelId, refetchNonce])

  // -------------------------------------------------------------------------
  // Build / rebuild
  //
  // ``buildingRef`` shadows the ``building`` state so that ``buildLithoSolids``
  // can guard against concurrent calls without listing ``building`` in its
  // useCallback dep array.  A stale closure over ``building`` would re-identify
  // the callback on every build completion — fragile if a future consumer puts
  // it in an effect dep.
  // -------------------------------------------------------------------------

  const buildingRef = useRef(building)
  useEffect(() => {
    buildingRef.current = building
  }, [building])

  const buildLithoSolids = useCallback(async (): Promise<void> => {
    if (!projectId || !lithoModelId || buildingRef.current) return
    setBuilding(true)
    log.info('useLithoSolids', `building body solids model=${lithoModelId}`)
    try {
      const result = await api.geology.rebuildLithoSolids(projectId, lithoModelId)
      log.success(
        'useLithoSolids',
        `built ${result.bodies_built} body solid(s), flagged=${result.bodies_flagged}`,
      )
      // Build response already carries the updated solids list — apply
      // directly.  No nonce bump needed: the fetch effect re-runs only when
      // the nonce changes, and re-fetching here would overwrite identical data
      // with an extra round-trip.
      setSolids(result.solids)

      const builtMsg = `Built ${result.bodies_built} bod${result.bodies_built === 1 ? 'y' : 'ies'}`
      if (result.bodies_flagged > 0) {
        toast(
          'warning',
          `${builtMsg} — ${result.bodies_flagged} under-constrained bod${result.bodies_flagged === 1 ? 'y' : 'ies'} (fewer than 3 CPT/borehole traces — slab approximation)`,
        )
      } else {
        toast('success', builtMsg)
      }
    } catch (err) {
      log.error('useLithoSolids', 'build solids failed', err)
      toast('error', 'Could not build body solids — check the connection.')
    } finally {
      setBuilding(false)
    }
  }, [projectId, lithoModelId, toast])

  // -------------------------------------------------------------------------
  // Per-body colour — optimistic + debounced
  // -------------------------------------------------------------------------

  const colorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Cancel any pending colour-debounce timer on unmount so a 200 ms callback
  // cannot fire after the component tree is torn down.
  useEffect(() => () => {
    if (colorTimeoutRef.current !== null) clearTimeout(colorTimeoutRef.current)
  }, [])

  const setBodyColor = useCallback(
    (bodyId: string, color: string | null): void => {
      if (!projectId || !lithoModelId) return

      // Optimistic: reflect immediately without waiting for the server.
      setSolids(prev => prev.map(s => (s.body_id === bodyId ? { ...s, display_color: color } : s)))

      // Debounce rapid colour-wheel drags — send only the final colour.
      if (colorTimeoutRef.current !== null) {
        clearTimeout(colorTimeoutRef.current)
      }
      colorTimeoutRef.current = setTimeout(() => {
        colorTimeoutRef.current = null
        log.debug('useLithoSolids', `setting body colour body=${bodyId} color=${color ?? 'null'}`)
        api.geology
          .setBodyColor(projectId, lithoModelId, bodyId, color)
          .then(() => {
            log.success('useLithoSolids', `body colour persisted body=${bodyId}`)
            // Optimistic update already applied — no re-fetch needed on success.
          })
          .catch(err => {
            log.error('useLithoSolids', 'failed to persist body colour', err)
            toast('error', 'Could not save body colour — try again.')
            // Re-fetch to restore server state after a failed persist.
            setRefetchNonce(n => n + 1)
          })
      }, 200)
    },
    [projectId, lithoModelId, toast],
  )

  // -------------------------------------------------------------------------
  // Derived flags
  // -------------------------------------------------------------------------

  const hasLithoSolids = solids.some(s => s.triangles.length > 0)
  const hasStaleLithoSolid = solids.some(s => s.is_stale === true)

  return {
    lithoSolids: solids,
    lithoSolidsLoading: loading,
    lithoSolidsBuilding: building,
    hasLithoSolids,
    hasStaleLithoSolid,
    buildLithoSolids,
    setBodyColor,
  }
}
