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
import { apiErrorDetail } from '../api/clients/shared'
import type { VoxelBuildRequest } from '../utils/buildVoxelRequest'
import type { GaplessBuildReport } from '../utils/gaplessGate/types'
import { log } from '../utils/log'
import { t } from '../i18n/translate'
import { VoxelBuildInputsError } from '../utils/voxelBuildInputsError'

// ---------------------------------------------------------------------------
// Failure copy
// ---------------------------------------------------------------------------

/**
 * The sentence shown when a build does not complete.
 *
 * Three failures are genuinely different and must not read alike:
 *
 * * **Inputs refused** (``VoxelBuildInputsError``) — the builder stopped
 *   before POSTing; its message already names the sections that failed to
 *   load, so it is shown verbatim.
 * * **Grid budget refused** (HTTP 422, ``code='voxel_grid_too_large'``) — the
 *   server declined a spacing that would not fit in memory and sent back the
 *   spacing to retry at *as a number*. Live on 2026-08-02 this arrived as
 *   "ApiError: [object Object]" and the engineer had no way to know the model
 *   was untouched or what to change. The retry spacing is stated because the
 *   backend went to the trouble of computing it.
 * * **Anything else** — an unexpected failure, where "check the connection" is
 *   still the honest guess.
 *
 * Parameters
 * ----------
 * err : unknown
 *     The caught rejection from the build attempt.
 *
 * Returns
 * -------
 * string
 *     Toast copy for the engineer.
 */
export function buildFailureMessage(err: unknown): string {
  if (err instanceof VoxelBuildInputsError) return err.message

  const detail = apiErrorDetail(err)
  if (detail?.code === 'voxel_grid_too_large') {
    const reason =
      typeof detail.message === 'string' && detail.message.length > 0
        ? detail.message
        : t('litho.gridTooLargeDefault')
    const suggested = detail.suggested_horizontal_m
    // Nothing was written server-side on this path, and saying so stops the
    // engineer hunting for a half-built model before retrying.
    const untouched = t('litho.storedModelUnchanged')
    return typeof suggested === 'number'
      ? t('litho.gridTooLargeRetry', { reason, suggested, untouched })
      : t('litho.gridTooLargeNoRetry', { reason, untouched })
  }

  return t('litho.buildFailedGeneric')
}

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
  /**
   * Build solids for the active litho model from the VOXEL partition payload,
   * then toast the result.
   *
   * The Build path POSTs the frontend's validated ``computeSectionFill``
   * partitions to ``buildVoxelLithoModel`` (the source-of-truth voxel build).
   * The payload is assembled by the canvas (where the per-section partition data
   * lives) and supplied via ``voxelRequestBuilder`` — an async builder that
   * fetches the section-scoped correlation edges fresh and returns the request,
   * or ``null`` when there is nothing to build.
   *
   * When ``voxelRequestBuilder`` is absent or resolves to ``null`` the build is
   * a no-op with a "nothing to build" toast — the voxel POST needs the
   * canvas-assembled payload, so there is no fallback build path.
   *
   * Parameters
   * ----------
   * voxelRequestBuilder
   *     Async builder for the ``VoxelBuildRequest``; resolves to ``null`` when
   *     no payload is available (no sections / no model).
   */
  buildLithoSolids: (
    voxelRequestBuilder?: () => Promise<VoxelBuildRequest | null>,
  ) => Promise<void>
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
  /**
   * When ``true``, the 3D viewer and the inspector legend both suppress
   * under-constrained marker bodies (``is_flagged === true``).
   * Default ``false`` — all built solids are visible.
   */
  hideMarkers: boolean
  /** Toggle the ``hideMarkers`` flag. */
  setHideMarkers: (value: boolean) => void
  /**
   * The seven-clause gapless gate for the LAST build of this model, or ``null``
   * when there is no verdict to show — never built, or last built by a version
   * that predates the gate.
   *
   * Loaded from the stored build generation on open and replaced in place by
   * every build, so what the banner shows always belongs to the solids on
   * screen. ``null`` is shown as "no verdict", never as a pass: the whole point
   * of the gate is that an unmeasured guarantee is not a kept one.
   */
  gaplessReport: GaplessBuildReport | null
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
 * refreshOn
 *     Optional extra dependency for the list fetch. The backend stamps
 *     ``is_stale`` on solids when their model's layers change (e.g. a hand
 *     band edit), but the amber Build badge only sees it after a re-fetch —
 *     pass a version counter that bumps on those writes (the geotech
 *     instance passes ``geotechLayersVersion``) and the badge ambers
 *     without waiting for the next build.
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
  refreshOn?: unknown,
  onMutated?: () => void,
): UseLithoSolidsResult {
  // hideMarkers must be declared BEFORE the useEffect / useRef calls below
  // so hook order is stable across every render path (including early returns
  // in consumers that wrap this hook).
  const [hideMarkers, setHideMarkers] = useState(false)

  const [solids, setSolids] = useState<LithoBodySolidResponse[]>([])
  const [loading, setLoading] = useState(false)
  const [building, setBuilding] = useState(false)
  const [refetchNonce, setRefetchNonce] = useState(0)
  const [gaplessReport, setGaplessReport] = useState<GaplessBuildReport | null>(null)

  // -------------------------------------------------------------------------
  // Fetch — runs whenever project / model changes, or after a build.
  // Not gated on viewMode: toolbar + inspector need the state independently.
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!projectId || !lithoModelId) {
      setSolids([])
      setGaplessReport(null)
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

    // The last build's gapless verdict, so reopening a project shows the
    // guarantee that belongs to the solids on screen instead of a blank.
    // Deliberately NOT chained onto the solid fetch and NOT part of
    // ``loading``: the 3-D model must render on time whether or not its report
    // arrives, and a report that fails to load must never look like a report
    // that passed — the catch clears it to "no verdict".
    api.geology
      .getGaplessBuildReport(projectId, lithoModelId)
      .then(report => {
        if (cancelled) return
        log.info(
          'useLithoSolids',
          report === null
            ? `no stored gapless report for model=${lithoModelId} (never built, or built before the gate)`
            : `stored gapless report: verdict=${report.verdict}, ` +
                `${report.clauses.filter(c => c.status === 'fail').length} clause(s) failed`,
        )
        setGaplessReport(report)
      })
      .catch(err => {
        if (cancelled) return
        log.error('useLithoSolids', 'failed to fetch the gapless build report', err)
        setGaplessReport(null)
      })

    return () => {
      cancelled = true
      setLoading(false)
    }
    // ``refreshOn`` participates by IDENTITY only — it is never read.
  }, [projectId, lithoModelId, refetchNonce, refreshOn])

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

  const buildLithoSolids = useCallback(
    async (
      voxelRequestBuilder?: () => Promise<VoxelBuildRequest | null>,
    ): Promise<void> => {
      if (!projectId || !lithoModelId || buildingRef.current) return

      // The voxel path needs the per-section partition payload, which the
      // canvas assembles.  Without a builder there is nothing to build (the
      // retired implicit rebuild path was deleted with #237).
      if (!voxelRequestBuilder) {
        toast('warning', t('litho.nothingToBuildYet'))
        return
      }

      setBuilding(true)
      log.info('useLithoSolids', `building voxel body solids model=${lithoModelId}`)
      try {
        const request = await voxelRequestBuilder()
        if (!request || request.sections.length === 0) {
          toast('warning', t('litho.nothingToBuild'))
          return
        }

        const result = await api.geology.buildVoxelLithoModel(projectId, lithoModelId, request)
        log.success(
          'useLithoSolids',
          `built ${result.bodies_built} voxel body solid(s), flagged=${result.bodies_flagged}`,
        )
        // Build response already carries the updated solids list — apply
        // directly.  No nonce bump needed: the fetch effect re-runs only when
        // the nonce changes, and re-fetching here would overwrite identical data
        // with an extra round-trip.
        setSolids(result.solids)
        // The verdict belongs to THESE solids, so it lands with them. A
        // response with no report clears the previous one rather than leaving
        // it standing: a stale verdict beside a fresh model is worse than no
        // verdict, because it reads as a guarantee about ground it never saw.
        setGaplessReport(result.gapless_report ?? null)
        if (result.gapless_report) {
          const failed = result.gapless_report.clauses.filter(c => c.status === 'fail')
          const unmeasured = result.gapless_report.clauses.filter(
            c => c.status === 'not-evaluated',
          )
          const line =
            `gapless gate: ${result.gapless_report.verdict} ` +
            `(${failed.length} failed, ${unmeasured.length} not evaluated)`
          // The gate fails the REPORT, never the build — so a failed verdict is
          // a warning beside a successful build, not an error.
          if (result.gapless_report.verdict === 'pass') log.info('useLithoSolids', line)
          else log.warn('useLithoSolids', `${line} — ${failed.map(c => c.title).join('; ')}`)
        } else {
          log.warn(
            'useLithoSolids',
            'build returned no gapless report — the model carries no verdict for this build',
          )
        }
        // A build is an unsaved change like any other. ``litho_solids`` rides in the
        // .strix bundle, so building genuinely changes what a save would write — and
        // the close prompt gates on the project's dirty flag. Without this the build
        // fell out of the save story entirely: no prompt on close, and nothing to
        // discard against (owner, 2026-08-10).
        //
        // AFTER the call lands, never before: a refused build changes nothing, and
        // marking it dirty would make every failed attempt look like an edit.
        onMutated?.()

        const builtMsg = t('litho.builtBodies', {
          n: result.bodies_built,
          bodyWord: result.bodies_built === 1 ? t('litho.bodyWordOne') : t('litho.bodyWordMany'),
        })
        // A build that produced NOTHING also cleared the stored 3-D model — the
        // backend's empty path orphan-deletes every solid row and commits. Its
        // counts are identical to a happy build of zero bodies, so without the
        // reason the only reading available here was a green "Built 0 bodies"
        // over a model that had just been erased. Say what happened instead.
        if (result.empty_reason) {
          log.warn('useLithoSolids', `build produced nothing: ${result.empty_reason}`)
          toast('warning', t('litho.nothingCouldBeBuilt', { reason: result.empty_reason }))
          return
        }
        // Severity is DERIVED from what the build reported, not fixed at
        // 'success': a build that modelled only part of the project succeeded
        // technically and failed the engineer.  ``uncovered_test_ids`` is the
        // harder of the two — those investigations have no 3-D model at all —
        // so it leads the message.
        const uncovered = result.uncovered_test_ids ?? []
        const problems: string[] = []
        if (uncovered.length > 0) {
          const named = uncovered.slice(0, 3).join(', ')
          const rest =
            uncovered.length > 3 ? t('litho.moreCount', { n: uncovered.length - 3 }) : ''
          problems.push(
            t('litho.uncoveredInvestigations', {
              n: uncovered.length,
              investigationWord:
                uncovered.length === 1
                  ? t('litho.investigationWordOne')
                  : t('litho.investigationWordMany'),
              named,
              rest,
            }),
          )
          log.warn(
            'useLithoSolids',
            `build left ${uncovered.length} investigation(s) outside the footprint: ${uncovered.join(', ')}`,
          )
        }
        if (result.bodies_flagged > 0) {
          problems.push(
            t('litho.underConstrainedBodies', {
              n: result.bodies_flagged,
              bodyWord:
                result.bodies_flagged === 1 ? t('litho.bodyWordOne') : t('litho.bodyWordMany'),
            }),
          )
        }
        if (problems.length > 0) {
          toast('warning', `${builtMsg} — ${problems.join('; ')}`)
        } else {
          toast('success', builtMsg)
        }
      } catch (err) {
        log.error('useLithoSolids', 'build voxel solids failed', err)
        toast('error', buildFailureMessage(err))
      } finally {
        setBuilding(false)
      }
    },
    [projectId, lithoModelId, toast],
  )

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
            toast('error', t('litho.saveBodyColourFailed'))
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
    hideMarkers,
    setHideMarkers,
    gaplessReport,
  }
}
