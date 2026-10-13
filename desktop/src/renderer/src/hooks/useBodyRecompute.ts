// Debounced background body-identity recompute (slice 5).
//
// Every mutation that can move body geometry (tie edits, geotech verbs, layer
// accepts, section edits, boundary saves) schedules a recompute of the mutated
// model; the POST fires after a quiet period, with a hard staleness cap so a
// sustained editing burst still persists identity — the same debounce+cap rule
// (and the same ``optsRef`` current-values pattern) as ``useRecoveryAutosave``.
//
// Rules:
//   * ASSEMBLY AT FIRE TIME — the payload is built when the timer fires, never
//     when the mutation scheduled it, so it always encodes the current model.
//   * SINGLE-FLIGHT per model — one in-flight POST; at most ONE pending re-fire
//     queued behind it (mutations during flight coalesce into that one).
//   * SUPERSEDED RESPONSES ARE DISCARDED, toasts included: a schedule that lands
//     after a POST started means that POST's answer describes a stale model.
//   * A FAILED recompute WARNS the user (owner ruling 6, 2026-09-12): with the
//     manual "Recompute bodies" verb gone, the recompute is entirely automatic,
//     so a failure has no gesture to answer — but the user must still learn that
//     body identity did not persist. It is a WARNING toast (the bands on screen
//     are unchanged, only their durable identity did not save) carrying a REPLACE
//     KEY so a burst of failures updates one toast instead of stacking. A 422
//     ``empty_recompute_payload`` is a BUG signal (the assembly gate must have
//     returned null) — console error, never a toast.
//   * A RECOMPUTE BELONGS TO ITS PROJECT (owner dogfeed 2026-10-13): a project
//     switch drops every timer, pending re-fire and in-flight answer of the
//     previous project. Fired under the new project id, the old model id 404'd
//     on every section's correlations ("recompute skipped: 7 of 7 ...").

import { useCallback, useEffect, useRef } from 'react'

import { api } from '../api/client'
import { apiErrorDetail } from '../api/clients/shared'
import { log } from '../utils/log'
import { t } from '../i18n/translate'
import type { RecomputeBodiesRequest } from '../utils/buildBodyRecomputePayload'
import type { RecomputeBodiesResponse } from '../api/clients/geology.types'

/** Quiet period after the last mutation before the recompute fires. */
export const BODY_RECOMPUTE_DEBOUNCE_MS = 2_500

/** Hard ceiling on staleness while the user never pauses editing. */
export const BODY_RECOMPUTE_MAX_LATENCY_MS = 15_000

/**
 * Replace key for the background-failure toast, so repeated failures update one
 * toast instead of stacking (owner's no-flood rule for recurring toasts).
 */
export const BODY_RECOMPUTE_TOAST_KEY = 'body-recompute-failed'

/** Everything the recompute scheduler reads (through a ref, at fire time). */
export interface UseBodyRecomputeOptions {
  /** The app project id, or null when no project is open. */
  projectId: string | null
  /**
   * Fire-time payload assembly for one model. Returning ``null`` means "nothing
   * to send" (inputs missing, partial fetch, or empty assembly) and the fire is
   * skipped silently — the endpoint 422s on an empty payload, so the FE never
   * posts one.
   */
  buildPayload: (modelId: string) => Promise<RecomputeBodiesRequest | null>
  /**
   * Are the model inputs (layers / sections) loaded? While false, schedules do
   * nothing — an assembly from half-loaded state would encode a partial model.
   */
  dataLoaded: boolean
  /**
   * The app toast fn: success on visible changes, a WARNING (with a replace key)
   * on a failed recompute so the user learns identity did not persist.
   */
  toast: (kind: 'success' | 'error' | 'warning', message: string, replaceKey?: string) => void
  /**
   * Called once per CURRENT (not superseded) successful recompute, after its
   * toast. The shell uses it to re-read state the recompute changed server-side
   * (the 3-D solids it staled) — the recompute runs debounced AFTER the edit's
   * own re-read, so nothing else would see that change (owner 2026-10-04).
   */
  onRecomputed?: (modelId: string, result: RecomputeBodiesResponse) => void
}

/**
 * Did this recompute change something the built 3-D solids depend on?
 *
 * True when a body merged, split or lost its name, or when the server says it
 * staled the solids (``solids_stale``; absent on an older backend). A no-op
 * recompute answers false so it triggers no re-read.
 *
 * Parameters
 * ----------
 * result : RecomputeBodiesResponse
 *     The recompute's answer.
 *
 * Returns
 * -------
 * boolean
 *     Whether the model's solids state must be read again.
 */
export function recomputeTouchedSolids(result: RecomputeBodiesResponse): boolean {
  return (
    result.solids_stale === true ||
    result.bodies_merged + result.bodies_split + result.renamed.length > 0
  )
}

/** What the callers get. */
export interface UseBodyRecomputeResult {
  /** Debounced schedule for one model (the mutation-path entry point). */
  scheduleRecompute: (modelId: string) => void
}

/** Per-model timer pair. */
interface ModelTimers {
  debounce: ReturnType<typeof setTimeout> | null
  cap: ReturnType<typeof setTimeout> | null
}

/**
 * Schedule debounced body-identity recomputes per model.
 *
 * Mount once where the model inputs are reachable (the Sections canvas); feed
 * mutations through ``scheduleRecompute`` and the toolbar verb through
 * ``recomputeNow``.
 *
 * Parameters
 * ----------
 * opts : UseBodyRecomputeOptions
 *     Live values, read through a ref at fire time (never captured at schedule).
 *
 * Returns
 * -------
 * UseBodyRecomputeResult
 *     ``scheduleRecompute`` — the automatic mutation-path entry point.
 */
export function useBodyRecompute(opts: UseBodyRecomputeOptions): UseBodyRecomputeResult {
  // Fire-time reads go through the ref so a timer armed two seconds ago posts
  // the CURRENT model, not the one captured at schedule (useRecoveryAutosave's
  // optsRef pattern).
  const optsRef = useRef(opts)
  useEffect(() => {
    optsRef.current = opts
  })

  const timersRef = useRef(new Map<string, ModelTimers>())
  /** Bumped on every schedule — the supersede marker POSTs compare against. */
  const genRef = useRef(new Map<string, number>())
  const inFlightRef = useRef(new Set<string>())
  const pendingRefireRef = useRef(new Set<string>())
  /** The project each model's recompute was scheduled in (fire-time guard). */
  const scheduledProjectRef = useRef(new Map<string, string>())
  const mountedRef = useRef(true)

  const cancelTimers = useCallback((modelId: string): void => {
    // ``timers`` not ``t`` — ``t`` is the module-level translator here.
    const timers = timersRef.current.get(modelId)
    if (!timers) return
    if (timers.debounce !== null) clearTimeout(timers.debounce)
    if (timers.cap !== null) clearTimeout(timers.cap)
    timersRef.current.delete(modelId)
  }, [])

  const fire = useCallback(
    async (modelId: string): Promise<void> => {
      cancelTimers(modelId)
      if (!mountedRef.current) return
      if (inFlightRef.current.has(modelId)) {
        // Single-flight: coalesce into ONE pending re-fire behind the running POST.
        pendingRefireRef.current.add(modelId)
        return
      }
      const current = optsRef.current
      if (!current.projectId || !current.dataLoaded) {
        log.debug('body-recompute', `skip fire for ${modelId} — inputs not loaded`)
        return
      }
      if (scheduledProjectRef.current.get(modelId) !== current.projectId) {
        // Scheduled in another project: its model id means nothing here.
        log.debug('body-recompute', `skip fire for ${modelId} — scheduled in another project`)
        return
      }
      const projectId = current.projectId
      const firedGen = genRef.current.get(modelId) ?? 0
      inFlightRef.current.add(modelId)
      try {
        // Assembly happens HERE, at fire time.
        const payload = await current.buildPayload(modelId)
        if (payload === null) {
          log.debug('body-recompute', `skip fire for ${modelId} — assembly returned nothing`)
          return
        }
        log.debug(
          'body-recompute',
          `POST bodies/recompute model=${modelId} sections=${payload.sections.length}`,
        )
        const result = await api.geology.recomputeBodies(projectId, modelId, payload)
        if ((genRef.current.get(modelId) ?? 0) !== firedGen) {
          // A newer schedule landed after this POST started — its answer describes
          // a stale model. Discard, TOAST INCLUDED; the pending re-fire reports.
          log.debug('body-recompute', `superseded response for ${modelId} discarded`)
          return
        }
        log.info(
          'body-recompute',
          `recomputed ${modelId}: facts=${result.facts_written} ` +
            `stale_dropped=${result.facts_dropped_stale} merged=${result.bodies_merged} ` +
            `split=${result.bodies_split} renamed=${result.renamed.length}`,
        )
        const visibleChanges =
          result.bodies_merged + result.bodies_split + result.renamed.length
        if (visibleChanges > 0) {
          optsRef.current.toast(
            'success',
            `Bodies recomputed: ${result.bodies_merged} merged, ${result.bodies_split} split` +
              (result.renamed.length > 0 ? `, names displaced: ${result.renamed.length}` : ''),
          )
        }
        // A no-op recompute stays silent (the alarm-fatigue rule) — with the
        // manual verb gone there is no click to confirm.
        optsRef.current.onRecomputed?.(modelId, result)
      } catch (err) {
        const detail = apiErrorDetail(err)
        if (detail?.code === 'empty_recompute_payload') {
          // The FE gate exists precisely so this status can never happen — reaching
          // it means the assembly emptiness check and the backend's disagree. Bug.
          log.error(
            'body-recompute',
            `BUG: posted an empty recompute payload for ${modelId} — the null-assembly ` +
              'gate should have skipped this fire',
            err,
          )
        } else {
          log.error('body-recompute', `recompute failed for ${modelId}`, err)
          // The recompute is automatic now (owner ruling 6): a failure has no
          // gesture to answer, but the user must still learn identity did not
          // persist. WARNING (the bands on screen are unchanged) with a replace
          // key so a burst of failures updates one toast rather than stacking.
          optsRef.current.toast(
            'warning',
            t('sections.recompute.backgroundFailed'),
            BODY_RECOMPUTE_TOAST_KEY,
          )
        }
      } finally {
        inFlightRef.current.delete(modelId)
        if (pendingRefireRef.current.delete(modelId) && mountedRef.current) {
          // The one queued re-fire runs with a fresh assembly.
          void fire(modelId)
        }
      }
    },
    [cancelTimers],
  )

  const scheduleRecompute = useCallback(
    (modelId: string): void => {
      const current = optsRef.current
      if (!current.projectId || !current.dataLoaded) {
        log.debug('body-recompute', `skip schedule for ${modelId} — inputs not loaded`)
        return
      }
      genRef.current.set(modelId, (genRef.current.get(modelId) ?? 0) + 1)
      scheduledProjectRef.current.set(modelId, current.projectId)
      // ``timers`` not ``t`` — ``t`` is the module-level translator here.
      let timers = timersRef.current.get(modelId)
      if (!timers) {
        timers = { debounce: null, cap: null }
        timersRef.current.set(modelId, timers)
      }
      if (timers.debounce !== null) clearTimeout(timers.debounce)
      timers.debounce = setTimeout(() => void fire(modelId), BODY_RECOMPUTE_DEBOUNCE_MS)
      // The cap arms once per burst and is deliberately NOT reset by later
      // schedules — resetting it would turn it back into a debounce.
      if (timers.cap === null) {
        timers.cap = setTimeout(() => void fire(modelId), BODY_RECOMPUTE_MAX_LATENCY_MS)
      }
    },
    [fire],
  )

  // A project switch (or close) drops everything the previous project queued:
  // its timers, its one pending re-fire, and — by bumping every generation —
  // the answer of a POST still in flight, toast included. Declared before the
  // callers' trigger effects (this hook runs first), so the new project's
  // open-recompute schedules land AFTER the purge on the switch commit.
  const lastProjectIdRef = useRef(opts.projectId)
  useEffect(() => {
    if (lastProjectIdRef.current === opts.projectId) return
    const previous = lastProjectIdRef.current
    lastProjectIdRef.current = opts.projectId
    const dropped = [...timersRef.current.keys()]
    for (const modelId of dropped) cancelTimers(modelId)
    pendingRefireRef.current.clear()
    scheduledProjectRef.current.clear()
    for (const [modelId, gen] of genRef.current) genRef.current.set(modelId, gen + 1)
    log.debug(
      'body-recompute',
      `project ${previous ?? 'none'} -> ${opts.projectId ?? 'none'}: dropped ` +
        `${dropped.length} scheduled recompute(s)`,
    )
  }, [opts.projectId, cancelTimers])

  // Cancel every pending timer on unmount; in-flight POSTs resolve harmlessly
  // (mountedRef gates their pending re-fire).
  useEffect(() => {
    mountedRef.current = true
    const timers = timersRef.current
    return () => {
      mountedRef.current = false
      for (const [, modelTimers] of timers) {
        if (modelTimers.debounce !== null) clearTimeout(modelTimers.debounce)
        if (modelTimers.cap !== null) clearTimeout(modelTimers.cap)
      }
      timers.clear()
    }
  }, [])

  return { scheduleRecompute }
}
