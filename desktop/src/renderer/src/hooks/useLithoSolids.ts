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
import type { VoxelBuildRequest } from '../utils/buildVoxelRequest'
import type { GaplessBuildReport } from '../utils/gaplessGate/types'
import { log } from '../utils/log'
import { t } from '../i18n/translate'
import { applyVoxelBuildResult } from './applyVoxelBuildResult'
// The build-failure copy lives in its own module so the streaming build path
// (useVoxelBuildStream) can share the grid-too-large formatter without an import
// cycle (debt #282).
import { buildFailureMessage } from './buildFailureMessage'
import { ProjectClosedError, abandonIfProjectClosed } from '../utils/openProjectGuard'
import { useVoxelBuildStream } from './useVoxelBuildStream'
import type { VoxelBuildState } from './useVoxelBuildStream'

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
   * Build via a BACKGROUND JOB that streams phase + per-column progress and can
   * be cancelled (debt #282). Same payload assembly + guards as
   * ``buildLithoSolids``; the outcome is applied identically. While it runs,
   * ``voxelBuildState.status === 'running'`` and the toolbar shows a progress bar
   * + Cancel in place of the Build button.
   */
  startLithoBuild: (
    voxelRequestBuilder?: () => Promise<VoxelBuildRequest | null>,
  ) => Promise<void>
  /** Ask the running streaming build to stop; the model is left unchanged. */
  cancelLithoBuild: () => void
  /** Live state of the streaming build (idle / running / done / cancelled / error). */
  voxelBuildState: VoxelBuildState
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

  // Streaming build (debt #282): the background-job path that reports phase +
  // per-column progress and can be cancelled. Declared unconditionally at the
  // top so hook order is stable across every render.
  const {
    state: voxelBuildState,
    start: startVoxelBuildStream,
    cancel: cancelVoxelBuildStream,
    reset: resetVoxelBuildStream,
  } = useVoxelBuildStream()
  // Shadow ref so the build trigger can guard "already running" without listing
  // the live state in its dep array (which would re-identify it each tick).
  const voxelBuildStateRef = useRef(voxelBuildState)
  voxelBuildStateRef.current = voxelBuildState

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
        // Bound to the project it was started on (utils/openProjectGuard): a
        // payload assembled for a project closed meanwhile is never POSTed.
        if (abandonIfProjectClosed(projectId, 'useLithoSolids', 'voxel build')) return
        if (!request || request.sections.length === 0) {
          toast('warning', t('litho.nothingToBuild'))
          return
        }

        const result = await api.geology.buildVoxelLithoModel(projectId, lithoModelId, request)
        // Refresh solids + verdict, mark dirty, and toast — the SAME apply the
        // streaming build path (``useVoxelBuildStream``) runs on its `done`
        // event, so both paths land identically (debt #282).
        applyVoxelBuildResult(result, { setSolids, setGaplessReport, toast, onMutated })
      } catch (err) {
        // The project closed while the payload assembled: a stop, not a failure.
        if (err instanceof ProjectClosedError) {
          log.info('useLithoSolids', 'voxel build abandoned: project closed')
          return
        }
        log.error('useLithoSolids', 'build voxel solids failed', err)
        toast('error', buildFailureMessage(err))
      } finally {
        setBuilding(false)
      }
    },
    [projectId, lithoModelId, toast],
  )

  // -------------------------------------------------------------------------
  // Streaming build (debt #282): Build → background job with progress + cancel.
  //
  // Same assembly + guards as ``buildLithoSolids`` (nothing-to-build toasts, the
  // canvas-assembled payload), then hand off to the SSE hook. The terminal
  // states are applied by the effect below so the done/cancelled/error handling
  // lives in one place regardless of which render the transition lands on.
  // -------------------------------------------------------------------------

  const startLithoBuild = useCallback(
    async (
      voxelRequestBuilder?: () => Promise<VoxelBuildRequest | null>,
    ): Promise<void> => {
      if (!projectId || !lithoModelId) return
      if (voxelBuildStateRef.current.status === 'running') return

      if (!voxelRequestBuilder) {
        toast('warning', t('litho.nothingToBuildYet'))
        return
      }
      let request: VoxelBuildRequest | null
      try {
        request = await voxelRequestBuilder()
      } catch (err) {
        if (err instanceof ProjectClosedError) {
          log.info('useLithoSolids', 'streaming build abandoned: project closed')
          return
        }
        // Input assembly failed (a section correlation / boundary fetch) —
        // surface it exactly as the synchronous path does, before any job runs.
        log.error('useLithoSolids', 'streaming build input assembly failed', err)
        toast('error', buildFailureMessage(err))
        return
      }
      if (abandonIfProjectClosed(projectId, 'useLithoSolids', 'streaming build')) return
      if (!request || request.sections.length === 0) {
        toast('warning', t('litho.nothingToBuild'))
        return
      }
      log.info('useLithoSolids', `starting streaming build model=${lithoModelId}`)
      startVoxelBuildStream({ projectId, modelId: lithoModelId, request })
    },
    [projectId, lithoModelId, toast, startVoxelBuildStream],
  )

  // Apply the terminal state once, then reset to idle so the Build button
  // reverts. Reset → idle means this effect cannot double-apply the same result.
  useEffect(() => {
    if (voxelBuildState.status === 'done') {
      applyVoxelBuildResult(voxelBuildState.result, {
        setSolids,
        setGaplessReport,
        toast,
        onMutated,
      })
      resetVoxelBuildStream()
    } else if (voxelBuildState.status === 'cancelled') {
      log.info('useLithoSolids', 'streaming build cancelled — model left unchanged')
      toast('warning', t('litho.buildCancelled'))
      resetVoxelBuildStream()
    } else if (voxelBuildState.status === 'error') {
      log.error('useLithoSolids', `streaming build failed: ${voxelBuildState.message}`)
      toast('error', voxelBuildState.message)
      resetVoxelBuildStream()
    }
  }, [voxelBuildState, resetVoxelBuildStream, toast, onMutated])

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
    startLithoBuild,
    cancelLithoBuild: cancelVoxelBuildStream,
    voxelBuildState,
    setBodyColor,
    hideMarkers,
    setHideMarkers,
    gaplessReport,
  }
}
