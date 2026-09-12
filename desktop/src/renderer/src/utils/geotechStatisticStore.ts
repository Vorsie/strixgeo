/**
 * The representative-qc statistic the geotech toolbar is showing, published for
 * the Sections inspector.
 *
 * Owner ruling 5 (2026-09-12): "yes show it in the inspector, especially if we
 * are only showing it once." The inspector must show the SAME statistic value
 * the toolbar's qc dropdown shows — not an approximation. The authoritative
 * value lives in ``useGeotechStatistic`` (in the toolbar): it folds the model's
 * ``representative_statistic``, the post-write bridge answer, and the pre-model
 * pending choice into one token. Re-deriving that in the inspector from the
 * model row alone would disagree in two windows — before the first subdivide
 * (the pending choice is renderer-only) and between a statistic write and the
 * next model refresh (the bridge) — which is exactly why the original inspector
 * note deliberately showed no value. So the toolbar hook PUBLISHES its derived
 * token here and the inspector READS it; the two can never disagree.
 *
 * Mirrors ``geotechPreviewRenderStore`` / ``geotechFillStore``: a module-global
 * value shared between sibling components via ``useSyncExternalStore``, the
 * lightest correct way with no shared props path. The toolbar and the inspector
 * co-mount on the Sections stage, so the published value is always fresh when
 * the inspector reads it.
 *
 * Module-global, never persisted: there is one section view at a time and the
 * value describes the current toolbar, not the project. The toolbar republishes
 * on every project / model change, so a stale value self-heals on the next
 * toolbar render.
 */

import { useSyncExternalStore } from 'react'

import { DEFAULT_GEOTECH_STATISTIC } from './geotechStatistic'

let value: string = DEFAULT_GEOTECH_STATISTIC
const listeners = new Set<() => void>()

function notify(): void {
  listeners.forEach(listener => listener())
}

/**
 * Subscribe to changes in the published statistic.
 *
 * Parameters
 * ----------
 * callback : () => void
 *     Invoked whenever the published token changes.
 *
 * Returns
 * -------
 * () => void
 *     Unsubscribe function.
 */
export function subscribeGeotechStatistic(callback: () => void): () => void {
  listeners.add(callback)
  return () => {
    listeners.delete(callback)
  }
}

/**
 * Read the current published statistic without subscribing.
 *
 * Returns
 * -------
 * string
 *     The last published token, or the backend default.
 */
export function getGeotechStatistic(): string {
  return value
}

/**
 * Publish the statistic the toolbar is currently showing.
 *
 * No-ops when unchanged, so ``useSyncExternalStore`` consumers do not re-render
 * on a repeat (a plain string compares by value).
 *
 * Parameters
 * ----------
 * next : string
 *     The statistic token the toolbar's qc dropdown shows.
 */
export function publishGeotechStatistic(next: string): void {
  if (next === value) return
  value = next
  notify()
}

/**
 * Reactive hook — re-renders the caller when the published statistic changes.
 *
 * Returns
 * -------
 * string
 *     The current statistic token.
 */
export function useGeotechStatisticValue(): string {
  return useSyncExternalStore(subscribeGeotechStatistic, getGeotechStatistic)
}
