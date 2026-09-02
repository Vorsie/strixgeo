/**
 * First-launch "seen onboarding" flag (prototype, debt #93).
 *
 * Per-device UI chrome — it records whether THIS installation has shown the
 * onboarding overlay, so it belongs in ``localStorage``, not in the ``.strix``
 * bundle (project_decisions_in_bundle.md: localStorage = per-user UI chrome
 * only; the bundle carries engineering decisions).
 *
 * Every accessor degrades to "not seen" and never throws: a browser/Electron
 * profile with storage disabled must still boot, and showing the overlay one
 * extra time is a far better failure than a crash on the start path.
 */

/** The localStorage key. Versioned so a future overlay redesign can re-show. */
export const ONBOARDING_SEEN_KEY = 'strix.onboarding.seen.v1'

/** The value written when the overlay has been completed or skipped. */
const SEEN_VALUE = '1'

/**
 * Whether this installation has already seen onboarding.
 *
 * Returns
 * -------
 * boolean
 *     True once {@link markOnboardingSeen} has run; false on a fresh install or
 *     when storage is unavailable.
 */
export function hasSeenOnboarding(): boolean {
  try {
    return globalThis.localStorage?.getItem(ONBOARDING_SEEN_KEY) === SEEN_VALUE
  } catch {
    return false
  }
}

/** Record that the overlay was completed or skipped, so it does not re-fire. */
export function markOnboardingSeen(): void {
  try {
    globalThis.localStorage?.setItem(ONBOARDING_SEEN_KEY, SEEN_VALUE)
  } catch {
    // Storage unavailable — the overlay simply shows again next launch, which is
    // harmless for a prototype and never worth a throw on the boot path.
  }
}

/**
 * Whether the first-launch overlay should auto-open on mount.
 *
 * Auto-opens only on a genuine first launch: it fires when onboarding has not
 * been seen AND the app is not under the e2e harness. The e2e term is the
 * BLOCKER fix — the harness's userData directory persists across a run and
 * nothing seeds the "seen" flag, so an ungated auto-open would raise the z-max
 * onboarding modal over every spec and fail ~130 of them on an intercepted click.
 *
 * Parameters
 * ----------
 * opts : { seen: boolean; e2e: boolean }
 *     ``seen`` is {@link hasSeenOnboarding}; ``e2e`` is
 *     ``window.electron.launchFlags.e2e``.
 *
 * Returns
 * -------
 * boolean
 *     True only for a fresh, non-e2e launch.
 */
export function shouldAutoOpenOnboarding(opts: { seen: boolean; e2e: boolean }): boolean {
  return !opts.seen && !opts.e2e
}
