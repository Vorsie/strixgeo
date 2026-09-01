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
//   * Background failures log to console only; the MANUAL verb (recomputeNow)
//     also toasts them. A 422 ``empty_recompute_payload`` is a BUG signal (the
//     assembly gate must have returned null) — console error, never a toast.

import { useCallback, useEffect, useRef } from 'react'

import { api } from '../api/client'
import { apiErrorDetail } from '../api/clients/shared'
import { log } from '../utils/log'
import type { RecomputeBodiesRequest } from '../utils/buildBodyRecomputePayload'

/** Quiet period after the last mutation before the recompute fires. */
export const BODY_RECOMPUTE_DEBOUNCE_MS = 2_500

/** Hard ceiling on staleness while the user never pauses editing. */
export const BODY_RECOMPUTE_MAX_LATENCY_MS = 15_000

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
   * Are the model inputs (layers / sections) loaded? While false, schedules and
   * manual fires do nothing — an assembly from half-loaded state would encode a
   * partial model.
   */
  dataLoaded: boolean
  /** The app toast fn (success on visible changes; errors only for the manual verb). */
  toast: (kind: 'success' | 'error', message: string) => void
}

/** What the callers get. */
export interface UseBodyRecomputeResult {
  /** Debounced schedule for one model (the mutation-path entry point). */
  scheduleRecompute: (modelId: string) => void
  /** Immediate fire for one model (the manual toolbar verb; toasts errors). */
  recomputeNow: (modelId: string) => Promise<void>
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
 *     ``scheduleRecompute`` + ``recomputeNow``.
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
  /** Bumped on every schedule/manual ask — the supersede marker POSTs compare against. */
  const genRef = useRef(new Map<string, number>())
  const inFlightRef = useRef(new Set<string>())
  const pendingRefireRef = useRef(new Set<string>())
  const mountedRef = useRef(true)

  const cancelTimers = useCallback((modelId: string): void => {
    const t = timersRef.current.get(modelId)
    if (!t) return
    if (t.debounce !== null) clearTimeout(t.debounce)
    if (t.cap !== null) clearTimeout(t.cap)
    timersRef.current.delete(modelId)
  }, [])

  const fire = useCallback(
    async (modelId: string, manual: boolean): Promise<void> => {
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
        } else if (manual) {
          // A MANUAL toolbar press is a click and must confirm it ran, even on a
          // no-op (owner ruling 2026-08-31: "yes always toast, when i click
          // something"). The BACKGROUND debounce stays change-gated above — a
          // silent recompute that changed nothing is the alarm-fatigue rule.
          optsRef.current.toast('success', 'Bodies recomputed: no changes')
        }
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
          // Background fires stay console-only (a debounce has no gesture to answer);
          // the manual verb is a click and gets its error toast.
          if (manual) optsRef.current.toast('error', 'Recompute bodies failed — see console.')
        }
      } finally {
        inFlightRef.current.delete(modelId)
        if (pendingRefireRef.current.delete(modelId) && mountedRef.current) {
          // The one queued re-fire runs as a background fire with a fresh assembly.
          void fire(modelId, false)
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
      let t = timersRef.current.get(modelId)
      if (!t) {
        t = { debounce: null, cap: null }
        timersRef.current.set(modelId, t)
      }
      if (t.debounce !== null) clearTimeout(t.debounce)
      t.debounce = setTimeout(() => void fire(modelId, false), BODY_RECOMPUTE_DEBOUNCE_MS)
      // The cap arms once per burst and is deliberately NOT reset by later
      // schedules — resetting it would turn it back into a debounce.
      if (t.cap === null) {
        t.cap = setTimeout(() => void fire(modelId, false), BODY_RECOMPUTE_MAX_LATENCY_MS)
      }
    },
    [fire],
  )

  const recomputeNow = useCallback(
    async (modelId: string): Promise<void> => {
      // A manual ask supersedes whatever is in flight (its answer is stale by
      // definition — the user wants the state as of NOW).
      genRef.current.set(modelId, (genRef.current.get(modelId) ?? 0) + 1)
      await fire(modelId, true)
    },
    [fire],
  )

  // Cancel every pending timer on unmount; in-flight POSTs resolve harmlessly
  // (mountedRef gates their pending re-fire).
  useEffect(() => {
    mountedRef.current = true
    const timers = timersRef.current
    return () => {
      mountedRef.current = false
      for (const [, t] of timers) {
        if (t.debounce !== null) clearTimeout(t.debounce)
        if (t.cap !== null) clearTimeout(t.cap)
      }
      timers.clear()
    }
  }, [])

  return { scheduleRecompute, recomputeNow }
}
