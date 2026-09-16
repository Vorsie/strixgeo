/**
 * Fetches the "Divide boreholes" dry run that feeds the geotech ghost bands.
 *
 * Why a preview exists at all: ``Subdivide all bodies`` writes CPT packing
 * bands only and defers every borehole-mediated edge to ``Divide boreholes``,
 * so a borehole column on the geotech axis stays blank until that verb is
 * pressed — and pressing it rebuilds every borehole band. The engineer was
 * being asked to commit blind (owner dogfeed 2026-08-04). This hook asks the
 * server what the verb would do, using the SAME planner the verb runs.
 *
 * When it fetches
 * ---------------
 * Only while the geotech axis is showing and a geotech model exists (before
 * that, the endpoint has nothing to plan against and 404s by design).
 *
 * It refetches when ``refreshKey`` changes VALUE. The key must be a scalar that
 * moves once per mutation — the caller passes ``useGeologicalModel``'s geotech
 * load counter, which ticks after every Subdivide (which invalidates every
 * planned band) and every Divide (which turns the ghosts into rows), so the two
 * verbs that can falsify a preview are exactly the two that refresh it. It is
 * deliberately NOT the committed layer array: ``useGeologicalModel`` clears that
 * to a fresh ``[]`` before each refetch, so keying on its identity ran the whole
 * planner — TIN interpolation included — twice per mutation.
 *
 * ``snapToleranceM`` is in the dep list because ``plan()`` reads it (the geotech
 * geo↔litho snap tolerance, from project view-state) and divides the picks by
 * geology with it. Ghosts drawn before the engineer retuned it are stale.
 *
 * Failures are loud
 * -----------------
 * A failed preview returns an ``error`` the caller toasts. Silently rendering
 * an empty column would be indistinguishable from "this borehole gets nothing",
 * which is a statement about the geology this hook is in no position to make.
 * The ONE silent case is the 404 whose structured detail carries
 * ``code = "geotech_model_not_found"``: that one means ``Subdivide all bodies``
 * has not run, which is a state, not a failure. Every other 404 — a broken
 * litho-model reference 404s with a plain-string detail from
 * ``load_scoped_or_raise`` — is reported like any other error.
 */
import { useEffect, useState } from 'react'

import { api } from '../../../api/client'
import type { DivideBoreholePreviewColumn } from '../../../api/client'
import { apiErrorDetail, isApiStatus } from '../../../api/clients/shared'
import { log } from '../../../utils/log'

/**
 * Server ``detail.code`` meaning "the geotech model does not exist yet".
 *
 * Emitted by ``DivideBoreholes.plan`` when no geotechnical child model hangs
 * off the litho model. Matched verbatim against the backend constant in
 * ``application/divide_boreholes.py``.
 */
const NO_GEOTECH_MODEL_CODE = 'geotech_model_not_found'

/** What the hook hands back to the canvas. */
export interface GeotechBoreholePreview {
  /** Per-borehole planned bands; empty while loading, on error, or when idle. */
  columns: readonly DivideBoreholePreviewColumn[]
  /** A request is in flight. */
  loading: boolean
  /** Human-readable failure, or null. Cleared on the next successful fetch. */
  error: string | null
  /** Accepted borehole ties a commit would carry (includes the flagged ones). */
  carriedTieCount: number
  /** Accepted borehole ties a commit could NOT carry — the engineer redraws these. */
  lostTieCount: number
}

/** Everything the hook needs to decide whether, and what, to fetch. */
export interface GeotechBoreholePreviewArgs {
  /** Active project id, or null when no project is open. */
  projectId: string | null
  /**
   * The LITHO model id — the preview endpoint takes the litho parent, exactly
   * like ``divideBoreholes`` itself.
   */
  lithoModelId: string | null
  /** Whether ``Subdivide all bodies`` has run. False → nothing to preview. */
  hasGeotechModel: boolean
  /** Whether the geotech axis is showing. False → no request, no state. */
  enabled: boolean
  /**
   * Scalar that changes ONCE per mutation that can falsify the preview. A
   * counter or a version string — never an object or array, whose identity
   * changes more often than its meaning does.
   */
  refreshKey: string | number
  /** The planner's geo↔litho snap tolerance (m); a change re-plans. */
  snapToleranceM: number
}

/** The idle value — also what a disabled hook reports. */
const EMPTY: GeotechBoreholePreview = {
  columns: [],
  loading: false,
  error: null,
  carriedTieCount: 0,
  lostTieCount: 0,
}

/**
 * Load the borehole packing preview for the active geotech model.
 *
 * Parameters
 * ----------
 * args : GeotechBoreholePreviewArgs
 *     Scope, gating and invalidation inputs — see the interface.
 *
 * Returns
 * -------
 * GeotechBoreholePreview
 *     The planned columns plus loading / error / tie-carry state.
 */
export function useGeotechBoreholePreview({
  projectId,
  lithoModelId,
  hasGeotechModel,
  enabled,
  refreshKey,
  snapToleranceM,
}: GeotechBoreholePreviewArgs): GeotechBoreholePreview {
  const [state, setState] = useState<GeotechBoreholePreview>(EMPTY)

  const active = enabled && hasGeotechModel && projectId !== null && lithoModelId !== null

  useEffect(() => {
    if (!active || projectId === null || lithoModelId === null) {
      setState(EMPTY)
      return
    }
    let cancelled = false
    setState(prev => ({ ...prev, loading: true, error: null }))
    ;(async () => {
      try {
        const result = await api.geology.previewDivideBoreholes(projectId, lithoModelId)
        if (cancelled) return
        log.info(
          'geology',
          `divide-boreholes preview: ${result.columns.length} borehole(s), ` +
            `${result.layer_count} planned band(s), ` +
            `ties carried=${result.carried_tie_count} lost=${result.lost_tie_count}`,
        )
        setState({
          columns: result.columns,
          loading: false,
          error: null,
          carriedTieCount: result.carried_tie_count,
          lostTieCount: result.lost_tie_count,
        })
      } catch (err) {
        if (cancelled) return
        // The ONLY silent case: "Subdivide all bodies has not run". There is
        // genuinely nothing to preview and the toolbar already says so. It is
        // matched on the server's machine-readable code, not on the status —
        // a broken model reference also 404s, and swallowing that one would
        // leave an empty borehole column that looks like an answer.
        const detail = apiErrorDetail(err)
        if (isApiStatus(err, 404) && detail?.code === NO_GEOTECH_MODEL_CODE) {
          log.debug('geology', 'divide-boreholes preview: no geotech model yet')
          setState(EMPTY)
          return
        }
        log.error('geology', 'divide-boreholes preview failed', err)
        setState({
          columns: [],
          loading: false,
          error: 'Could not preview the borehole packing. See console.',
          carriedTieCount: 0,
          lostTieCount: 0,
        })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [active, projectId, lithoModelId, refreshKey, snapToleranceM])

  return state
}
