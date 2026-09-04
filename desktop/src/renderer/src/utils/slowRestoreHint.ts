/**
 * slowRestoreHint.ts — tell the engineer WHY a restore may be waiting.
 *
 * A project restore takes the body-partition lock before its first write
 * (BP-5), and a running body recompute can hold that lock for up to the
 * backend's 30 s lock timeout. From the renderer that is indistinguishable
 * from a slow parse: the open dialog just sits there. Owner ruling 2026-09-04
 * ("yeah just add a small toast"): keep waiting, but after a short moment say
 * so. A restore that settles before the delay says nothing.
 */

/** How long a restore may run silently before the hint fires (ms). */
export const RESTORE_LOCK_HINT_MS = 2_000

/**
 * Await ``work``; call ``onSlow`` once if it is still pending after ``delayMs``.
 *
 * The timer is cleared however ``work`` settles, so a fast restore (or a fast
 * failure) never fires the hint.
 */
export async function withSlowRestoreHint<T>(
  work: Promise<T>,
  onSlow: () => void,
  delayMs: number = RESTORE_LOCK_HINT_MS,
): Promise<T> {
  const timer = setTimeout(onSlow, delayMs)
  try {
    return await work
  } finally {
    clearTimeout(timer)
  }
}
