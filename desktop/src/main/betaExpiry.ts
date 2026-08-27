/**
 * Beta-build expiry evaluation (Electron main process).
 *
 * Owner ruling (2026-08-26 ballot, `docs/commercial-direction.md` §v1.0 gate):
 * *"waterproof: beta builds must expire; a beta licence must not be usable for
 * years"*. This module is the decision half of that rule — given a build stamp,
 * a persisted clock anchor and the current time, it answers whether the app may
 * open. It performs no I/O and imports nothing from Electron, so vitest can
 * exercise every branch (see ``vitest.config.ts`` — main-process helpers stay
 * pure for exactly this reason).
 *
 * ## What this defends against
 *
 * | Attack | Defence |
 * |---|---|
 * | Keep running the beta after its date | The stamp is compiled into the build |
 * | Wind the OS clock back after expiry | The anchor records the highest instant the app ever observed |
 * | Delete the anchor file, then wind back | Corroborating timestamps (recent-projects `lastOpened`) feed the same high-water mark |
 * | Set the clock before the build existed | A build cannot legitimately run before its own `builtAtMs` |
 *
 * ## What it does NOT defend against — deliberately
 *
 * * **Unpacking the asar and editing the stamp.** Debt #5 fixes the posture:
 *   defeat casual bypass, no obfuscation, no DRM theatre. An edited bundle is
 *   past "casual".
 * * **Deleting the anchor AND every corroborating file AND winding the clock
 *   back**, on a machine that never ran the build past its date. Offline code
 *   cannot close this; only a signed, server-issued licence can. That is the
 *   subject of the activation memo, not of this module.
 * * **A malformed stamp** (our own packaging bug) is treated as *unstamped*,
 *   never as expired. Bricking a legitimate tester because our build script
 *   mis-set an env var is a worse failure than one extra week of beta.
 */

/** Milliseconds in a day — every window below is expressed in days. */
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * How far the wall clock may sit *behind* the highest instant we have ever
 * observed before we call it tampering.
 *
 * Ten minutes covers the honest causes — an NTP step after a long sleep, a
 * VM resuming from a snapshot, a laptop crossing a timezone with a
 * mis-configured RTC — while a tester winding the clock back to buy more beta
 * has to move it by days for the trick to be worth anything.
 */
export const CLOCK_SKEW_TOLERANCE_MS = 10 * 60 * 1000

/**
 * How long before the expiry date the app starts saying so.
 *
 * Seven days is the shortest window that still reaches a tester who only opens
 * the app on working days.
 */
export const EXPIRY_WARNING_WINDOW_MS = 7 * DAY_MS

/**
 * Verdict states, in the order the checks run.
 *
 * ``clock-rollback`` outranks ``expired``: when the machine clock disagrees
 * with our own high-water mark, the clock is the thing we distrust, and the
 * message the user sees should say so rather than claim a date has passed that
 * their calendar says has not.
 */
export type BetaExpiryState = 'unstamped' | 'active' | 'warning' | 'expired' | 'clock-rollback'

/**
 * The expiry facts compiled into a packaged build.
 *
 * Injected at package time (see ``buildStamp.ts``); absent in ``npm run dev``.
 */
export interface BetaBuildStamp {
  /** Human-readable build identifier, e.g. ``2026.08.26-beta``. */
  buildId: string
  /** When the build was produced, epoch ms. Nothing may run before it. */
  builtAtMs: number
  /** First instant at which the build refuses to open, epoch ms. */
  expiresAtMs: number
}

/**
 * Persisted monotonic clock anchor.
 *
 * Written on every launch (see ``betaExpiryStore.ts``). ``lastSeenMs`` only
 * ever moves forward, which is what makes a backwards clock detectable.
 */
export interface ClockAnchor {
  /** The first instant this installation was ever seen running, epoch ms. */
  firstSeenMs: number
  /** The highest instant this installation has ever observed, epoch ms. */
  lastSeenMs: number
}

/** The answer the main process acts on at startup and once a day after that. */
export interface BetaVerdict {
  /** Which rule fired. */
  state: BetaExpiryState
  /** True when the app must not open (or must close). */
  blocked: boolean
  /** Whole days left, rounded up; ``null`` when the build carries no stamp. */
  daysRemaining: number | null
  /** One line, safe to log and to show — carries no user data. */
  reason: string
  /** The expiry instant, echoed for the UI; ``null`` when unstamped. */
  expiresAtMs: number | null
}

/** True for a number we are willing to compare against a clock. */
function isUsableInstant(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * A stamp we can act on, or ``null``.
 *
 * A stamp missing either instant, or claiming it expires before it was built,
 * is our own packaging bug — see the module docstring for why that degrades to
 * "unstamped" rather than to "expired".
 */
function usableStamp(stamp: BetaBuildStamp | null | undefined): BetaBuildStamp | null {
  if (!stamp) return null
  if (!isUsableInstant(stamp.builtAtMs) || !isUsableInstant(stamp.expiresAtMs)) return null
  if (stamp.expiresAtMs <= stamp.builtAtMs) return null
  return stamp
}

/**
 * Highest instant this installation is known to have observed.
 *
 * Sources, all of which the app itself wrote at a moment it was genuinely
 * running: the build's own creation date (nothing can predate it), the
 * persisted anchor, and any corroborating timestamps the caller passes —
 * today the ``lastOpened`` entries of ``recent-projects.json``.
 *
 * Corroboration is what makes deleting one file insufficient. It raises the
 * cost of the rollback trick; it does not close it (module docstring).
 */
function observedHighWaterMs(
  stamp: BetaBuildStamp,
  anchor: ClockAnchor | null,
  corroboratingMs: readonly number[],
): number {
  let highest = stamp.builtAtMs
  if (anchor && isUsableInstant(anchor.lastSeenMs) && anchor.lastSeenMs > highest) {
    highest = anchor.lastSeenMs
  }
  for (const candidate of corroboratingMs) {
    if (isUsableInstant(candidate) && candidate > highest) highest = candidate
  }
  return highest
}

/**
 * Decide whether this build may open right now.
 *
 * Parameters
 * ----------
 * stamp : BetaBuildStamp | null
 *     Expiry facts compiled into the build; ``null`` for an unstamped build
 *     (dev runs, and any package built without the stamp env vars).
 * anchor : ClockAnchor | null
 *     Persisted monotonic anchor; ``null`` on a first launch or when the file
 *     is missing / unreadable.
 * nowMs : number
 *     Current wall-clock time, epoch ms.
 * corroboratingMs : readonly number[], optional
 *     Timestamps the app wrote elsewhere while running (recent-projects
 *     ``lastOpened``). Folded into the same high-water mark as the anchor.
 *
 * Returns
 * -------
 * BetaVerdict
 *     The state, whether to block, days remaining and a loggable reason.
 */
export function evaluateBetaExpiry(
  stamp: BetaBuildStamp | null | undefined,
  anchor: ClockAnchor | null | undefined,
  nowMs: number,
  corroboratingMs: readonly number[] = [],
): BetaVerdict {
  const usable = usableStamp(stamp)
  if (!usable) {
    return {
      state: 'unstamped',
      blocked: false,
      daysRemaining: null,
      reason: 'build carries no beta expiry stamp',
      expiresAtMs: null,
    }
  }

  const highWater = observedHighWaterMs(usable, anchor ?? null, corroboratingMs)

  // The clock check runs first: when the machine disagrees with what we have
  // already observed, no date arithmetic based on that clock is trustworthy.
  if (nowMs < highWater - CLOCK_SKEW_TOLERANCE_MS) {
    return {
      state: 'clock-rollback',
      blocked: true,
      daysRemaining: 0,
      reason: `system clock is ${Math.round((highWater - nowMs) / DAY_MS)} day(s) behind this installation's own history`,
      expiresAtMs: usable.expiresAtMs,
    }
  }

  if (nowMs >= usable.expiresAtMs) {
    return {
      state: 'expired',
      blocked: true,
      daysRemaining: 0,
      reason: `beta build ${usable.buildId} expired`,
      expiresAtMs: usable.expiresAtMs,
    }
  }

  const remainingMs = usable.expiresAtMs - nowMs
  // Rounded UP so a build with four hours left reports "1 day", never "0 days
  // left" on a build that still opens.
  const daysRemaining = Math.ceil(remainingMs / DAY_MS)
  const warning = remainingMs <= EXPIRY_WARNING_WINDOW_MS

  return {
    state: warning ? 'warning' : 'active',
    blocked: false,
    daysRemaining,
    reason: `beta build ${usable.buildId} expires in ${daysRemaining} day(s)`,
    expiresAtMs: usable.expiresAtMs,
  }
}

/**
 * Move the anchor forward to ``nowMs``.
 *
 * Never rewinds: a launch on a backdated clock leaves ``lastSeenMs`` where it
 * was, which is precisely the memory {@link evaluateBetaExpiry} reads. A first
 * launch seeds both fields from the same instant.
 *
 * Parameters
 * ----------
 * anchor : ClockAnchor | null
 *     The anchor read from disk, or ``null`` on a first launch.
 * nowMs : number
 *     Current wall-clock time, epoch ms.
 *
 * Returns
 * -------
 * ClockAnchor
 *     The anchor to persist.
 */
export function advanceAnchor(anchor: ClockAnchor | null | undefined, nowMs: number): ClockAnchor {
  if (!anchor || !isUsableInstant(anchor.firstSeenMs) || !isUsableInstant(anchor.lastSeenMs)) {
    return { firstSeenMs: nowMs, lastSeenMs: nowMs }
  }
  return {
    firstSeenMs: Math.min(anchor.firstSeenMs, nowMs),
    lastSeenMs: Math.max(anchor.lastSeenMs, nowMs),
  }
}
