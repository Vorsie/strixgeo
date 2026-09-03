/**
 * Subscription-activation evaluation (Electron main process) — PROTOTYPE.
 *
 * Debt #3. This is the *decision half* of the activation system: given the
 * locally-stored licence, the monotonic clock high-water mark and the current
 * time, it answers which state the app is in and whether a real build would
 * refuse to open. It performs no I/O and imports nothing from Electron, so
 * vitest exercises every branch (see ``activation.test.ts``) — the same posture
 * as ``betaExpiry.ts``, whose monotonic anchor this module reuses.
 *
 * ## Owner rulings this encodes (CLAUDE.local.md → "Rulings 2026-08-31")
 *
 * * **14 — offline grace = 30 days.** A licence past its authoritative end keeps
 *   the app open for {@link DEFAULT_OFFLINE_GRACE_WINDOW_MS}; past that, it is
 *   ``expired`` and blocked. This is what makes a month on site a non-event.
 * * **15 — 1 device per Solo seat.** That is a *binding* rule, enforced by the
 *   issuer ({@link ActivationRepository}), not here — this module only reads the
 *   binding the licence already carries.
 * * **16 — trial = a server-issued time-limited licence on the same code path.**
 *   A trial licence is a {@link Licence} with ``isTrial: true``; every state
 *   transition below treats it identically to a paid one, differing only in the
 *   label the UI shows.
 *
 * ## What is REAL vs MOCKED here
 *
 * The state machine is real and is the shape a production build would ship. What
 * is mocked lives elsewhere: the *issuer* ({@link ActivationRepository}) is a
 * local stand-in for the strixgeo.com service, and there is no Ed25519 signature
 * check — a production licence would be a signed file this evaluator verifies
 * before trusting its dates. See ``docs/design/activation-decision-memo.md``
 * (Option C) and the prototype design note.
 */

import { CLOCK_SKEW_TOLERANCE_MS } from './betaExpiry'

/** Milliseconds in a day — every window below is expressed in days. */
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Offline grace window after a licence's authoritative end, owner ruling 14.
 *
 * Thirty days: long enough that a month-long site campaign never touches the
 * network, short enough that a cancelled subscription's abuse window is a month
 * rather than the up-to-a-year of a plain signed-file scheme.
 */
export const DEFAULT_OFFLINE_GRACE_WINDOW_MS = 30 * DAY_MS

/**
 * The three commercial tiers (CLAUDE.local.md → Commercial planning).
 *
 * A runtime tuple as well as a type so a persisted licence's tier can be checked
 * against the known set — a hand-edited ``tier: "gold"`` must not mint a seat
 * (see ``activationStore.isPlausibleLicence``).
 */
export const LICENCE_TIERS = ['solo', 'pro', 'studio'] as const
export type LicenceTier = (typeof LICENCE_TIERS)[number]

/**
 * Activation states, in the order the checks run.
 *
 * ``clock-rollback`` outranks the date states for the same reason the beta gate
 * does: when the machine clock disagrees with our own high-water mark, no date
 * arithmetic based on that clock is trustworthy.
 */
export type LicenceState =
  | 'unactivated'
  | 'trial'
  | 'active'
  | 'grace'
  | 'expired'
  | 'clock-rollback'
  | 'device-mismatch'

/**
 * The licence a device holds locally.
 *
 * In production this is a short-lived, server-issued, **signed** file (Option C
 * in the activation memo). In the prototype it is plain JSON written by the mock
 * issuer — the shape is the contract; the signature is the TODO.
 */
export interface Licence {
  /** The licence key the user activated with (or the trial token). */
  key: string
  /** Commercial tier — gates which exports a production build would allow. */
  tier: LicenceTier
  /** True for a server-issued trial (ruling 16); same code path, time-limited. */
  isTrial: boolean
  /** Opaque per-installation device id the issuer bound this licence to. */
  deviceId: string
  /** Human-readable device name, shown on the deactivate/transfer screen. */
  deviceLabel: string
  /** When the issuer minted this licence, epoch ms. */
  issuedAtMs: number
  /** Authoritative end of the paid period / trial, epoch ms. */
  expiresAtMs: number
  /** Offline grace after {@link expiresAtMs}, ms (ruling 14). */
  graceWindowMs: number
}

/** The answer the main process acts on and the renderer displays. */
export interface ActivationVerdict {
  /** Which rule fired. */
  state: LicenceState
  /** True when a production build would refuse to open (prototype: display only). */
  blocked: boolean
  /** The licence tier, or ``null`` when unactivated. */
  tier: LicenceTier | null
  /** True while a trial licence is the authority. */
  isTrial: boolean
  /** Whole days until {@link Licence.expiresAtMs}, rounded up; ``null`` off the active/trial path. */
  daysRemaining: number | null
  /** Whole days left in the offline grace window; ``null`` outside ``grace``. */
  graceDaysRemaining: number | null
  /** The authoritative end instant, echoed for the UI; ``null`` when unactivated. */
  expiresAtMs: number | null
  /** When offline grace runs out, epoch ms; ``null`` when unactivated. */
  graceEndsAtMs: number | null
  /** One line, safe to log and to show — carries no secret. */
  reason: string
}

/** True for a number we are willing to compare against a clock. */
function isUsableInstant(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Decide the activation state for this launch.
 *
 * Parameters
 * ----------
 * licence : Licence | null
 *     The locally-stored licence, or ``null`` when the app has never been
 *     activated.
 * storeDeviceId : string
 *     This installation's own device id (from ``activationStore``). A licence
 *     whose ``deviceId`` differs was activated on another machine — a copied
 *     ``activation.json`` — and is blocked with a ``device_mismatch`` reason
 *     (owner ruling 15: one device per Solo seat; audit C3(c)).
 * highWaterMs : number
 *     The highest instant this installation has ever observed (the monotonic
 *     anchor's ``lastSeenMs``; see ``betaExpiryStore.ts``). Used to detect a
 *     wound-back clock.
 * nowMs : number
 *     Current wall-clock time, epoch ms.
 *
 * Returns
 * -------
 * ActivationVerdict
 *     The state, whether a production build would block, the counts the UI
 *     shows, and a loggable reason.
 */
export function evaluateActivation(
  licence: Licence | null | undefined,
  storeDeviceId: string,
  highWaterMs: number,
  nowMs: number,
): ActivationVerdict {
  if (!licence) {
    return {
      state: 'unactivated',
      blocked: true,
      tier: null,
      isTrial: false,
      daysRemaining: null,
      graceDaysRemaining: null,
      expiresAtMs: null,
      graceEndsAtMs: null,
      reason: 'no licence on this device — activation required',
    }
  }

  const graceEndsAtMs = licence.expiresAtMs + licence.graceWindowMs

  // Device binding runs before any date arithmetic (owner ruling 15, audit
  // C3(c)): a licence carries the device it was activated on, so a copied
  // ``activation.json`` on another machine — a store device id that differs from
  // the licence's — is blocked outright, whatever its dates say. Only compared
  // when both ids are present; a store that never seeded an id cannot mint a
  // false mismatch.
  if (storeDeviceId && licence.deviceId && licence.deviceId !== storeDeviceId) {
    return {
      state: 'device-mismatch',
      blocked: true,
      tier: licence.tier,
      isTrial: licence.isTrial,
      daysRemaining: null,
      graceDaysRemaining: null,
      expiresAtMs: licence.expiresAtMs,
      graceEndsAtMs,
      reason: 'licence activated on another device (device_mismatch) — activate this machine',
    }
  }

  // The clock check runs first, exactly as in the beta gate: a machine that
  // disagrees with what we have already observed cannot be trusted to date the
  // licence. Reuses the beta primitive's tolerance so the two gates behave
  // identically against the same tampering.
  if (isUsableInstant(highWaterMs) && nowMs < highWaterMs - CLOCK_SKEW_TOLERANCE_MS) {
    return {
      state: 'clock-rollback',
      blocked: true,
      tier: licence.tier,
      isTrial: licence.isTrial,
      daysRemaining: null,
      graceDaysRemaining: null,
      expiresAtMs: licence.expiresAtMs,
      graceEndsAtMs,
      reason: `system clock is ${Math.round((highWaterMs - nowMs) / DAY_MS)} day(s) behind this installation's own history`,
    }
  }

  if (nowMs < licence.expiresAtMs) {
    // Rounded UP so a licence with four hours left reports "1 day", never "0".
    const daysRemaining = Math.ceil((licence.expiresAtMs - nowMs) / DAY_MS)
    const state: LicenceState = licence.isTrial ? 'trial' : 'active'
    return {
      state,
      blocked: false,
      tier: licence.tier,
      isTrial: licence.isTrial,
      daysRemaining,
      graceDaysRemaining: null,
      expiresAtMs: licence.expiresAtMs,
      graceEndsAtMs,
      reason: `${state} ${licence.tier} licence — ${daysRemaining} day(s) remaining`,
    }
  }

  if (nowMs < graceEndsAtMs) {
    const graceDaysRemaining = Math.ceil((graceEndsAtMs - nowMs) / DAY_MS)
    return {
      state: 'grace',
      blocked: false,
      tier: licence.tier,
      isTrial: licence.isTrial,
      daysRemaining: 0,
      graceDaysRemaining,
      expiresAtMs: licence.expiresAtMs,
      graceEndsAtMs,
      reason: `licence lapsed — ${graceDaysRemaining} day(s) of offline grace left; reconnect to renew`,
    }
  }

  return {
    state: 'expired',
    blocked: true,
    tier: licence.tier,
    isTrial: licence.isTrial,
    daysRemaining: 0,
    graceDaysRemaining: 0,
    expiresAtMs: licence.expiresAtMs,
    graceEndsAtMs,
    reason: 'licence expired and the offline grace window has closed',
  }
}

/** The facts a main-side launch gate weighs (audit C3(d)). */
export interface ActivationLaunchInputs {
  /** ``app.isPackaged`` — a dev build never blocks. */
  packaged: boolean
  /** True under the e2e harness (already gated on ``!packaged`` at its source). */
  e2e: boolean
  /** The evaluated activation verdict; only ``blocked`` is consulted. */
  verdict: { blocked: boolean }
}

/**
 * Whether a PACKAGED build should refuse to open (and skip spawning the backend)
 * because of activation — the main-side counterpart to the renderer start-screen
 * gate (audit C3(d)).
 *
 * The rule: a packaged build opens only once a licence verdict is not blocked;
 * the beta stamp is a separate, earlier gate (expiry), not a licence:
 *
 * * a dev build NEVER blocks (the daily dogfeed is untouched);
 * * the e2e harness NEVER blocks (a licence gate would brick the suite);
 * * a BETA build blocks like any packaged build (owner 2026-09-03): the stamp
 *   bounds its life, the key is still required before the engine starts;
 * * only a packaged, non-e2e build with a blocked verdict is stopped.
 *
 * Pure, so vitest exercises every branch; ``index.ts`` calls it before
 * ``startApi()`` (the session main wires the one call site).
 *
 * Parameters
 * ----------
 * input : ActivationLaunchInputs
 *     The packaged / e2e / beta facts and the activation verdict.
 *
 * Returns
 * -------
 * boolean
 *     ``true`` only when a packaged, non-e2e build has a blocked verdict.
 */
export function activationBlocksLaunch(input: ActivationLaunchInputs): boolean {
  // Dev dogfeed is never blocked — the owner's daily flow must be untouched.
  if (!input.packaged) return false
  // The e2e harness is never blocked — a licence gate would brick the suite.
  if (input.e2e) return false
  // A beta build is NOT exempt (owner 2026-09-03, "require Beta-key before
  // API"): the stamp bounds the build's life through the beta-expiry gate that
  // ran first, but a tester still enters a key before the engine starts — that
  // is how the beta cohort shows up in the who-is-testing readout.
  return input.verdict.blocked
}
