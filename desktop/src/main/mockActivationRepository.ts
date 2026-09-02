/**
 * In-memory MOCK of the activation issuer (Electron main process) — PROTOTYPE.
 *
 * Debt #3. Stands in for the strixgeo.com service so the whole activation flow
 * runs with no network and no server. It is deliberately behavioural, not
 * cryptographic: it validates keys against a fixed demo table, enforces the
 * per-tier device binding (ruling 15), and mints plain (unsigned) licences.
 *
 * ## TODO — what the real strixgeo.com implementation replaces
 *
 * * ``activate`` → POST to the activation endpoint; the server checks the Stripe
 *   subscription behind the key and returns a **signed** licence file.
 * * ``startTrial`` → the same endpoint issuing a time-limited trial licence, so
 *   the owner learns who is trialling (ruling 16's stated bonus).
 * * ``deactivate`` → the server releasing the device binding (the transfer flow).
 * * the demo key table below → a MySQL row lookup (ruling "Activation host").
 * * {@link mintLicence} → server-side minting + Ed25519 signing; the client then
 *   only *verifies*, it never mints.
 *
 * The mock persists nothing across process restarts on its own — the local
 * authority is {@link ./activationStore}. It keeps its bindings in memory so the
 * device-limit and trial-once rules are observable within one session, which is
 * all a reaction prototype needs.
 */

import {
  DEFAULT_OFFLINE_GRACE_WINDOW_MS,
  type Licence,
  type LicenceTier,
} from './activation'
import {
  DEVICE_CAP_BY_TIER,
  type ActivateRequest,
  type ActivationRepository,
  type DeviceIdentity,
  type IssueResult,
} from './activationRepository'

/** Demo keys the owner can paste into the licensing screen to see each tier. */
export const SOLO_DEMO_KEY = 'STRIX-SOLO-DEMO'
export const PRO_DEMO_KEY = 'STRIX-PRO-DEMO'
export const STUDIO_DEMO_KEY = 'STRIX-STUDIO-DEMO'

/** The demo key → tier table the real service replaces with a MySQL lookup. */
const DEMO_KEYS: Readonly<Record<string, LicenceTier>> = {
  [SOLO_DEMO_KEY]: 'solo',
  [PRO_DEMO_KEY]: 'pro',
  [STUDIO_DEMO_KEY]: 'studio',
}

/** One year of paid subscription; trials get 30 days. Prototype constants. */
const PAID_TERM_MS = 365 * 24 * 60 * 60 * 1000
const TRIAL_TERM_MS = 30 * 24 * 60 * 60 * 1000

/** A clock function so tests can pin "now" (same pattern as the recovery store). */
export type NowFn = () => number

/**
 * A fully in-memory stand-in for the activation service.
 *
 * The bindings and trial ledger live in instance fields so one session can
 * observe the device-limit and trial-once rules; a fresh instance is a fresh
 * "server".
 */
export class MockActivationRepository implements ActivationRepository {
  /** key → the set of device ids currently bound to it. */
  private readonly bindings = new Map<string, Set<string>>()

  /** device ids that have already consumed their one trial. */
  private readonly trialledDevices = new Set<string>()

  /**
   * Parameters
   * ----------
   * now : NowFn
   *     Clock source; defaults to ``Date.now`` in production wiring, pinned in
   *     tests so the minted expiry is deterministic.
   */
  constructor(private readonly now: NowFn = Date.now) {}

  /** Mint an unsigned licence — the exact step the real server does + signs. */
  private mintLicence(
    key: string,
    tier: LicenceTier,
    device: DeviceIdentity,
    isTrial: boolean,
  ): Licence {
    const issuedAtMs = this.now()
    return {
      key,
      tier,
      isTrial,
      deviceId: device.deviceId,
      deviceLabel: device.deviceLabel,
      issuedAtMs,
      expiresAtMs: issuedAtMs + (isTrial ? TRIAL_TERM_MS : PAID_TERM_MS),
      graceWindowMs: DEFAULT_OFFLINE_GRACE_WINDOW_MS,
    }
  }

  async activate(request: ActivateRequest): Promise<IssueResult> {
    const tier = DEMO_KEYS[request.key]
    if (tier === undefined) {
      // Do not echo the entered key: it is untrusted input that ends up in logs,
      // and the renderer shows a translated message keyed on ``code``, not this
      // string.
      return { ok: false, code: 'unknown_key', message: 'key not recognised' }
    }

    const bound = this.bindings.get(request.key) ?? new Set<string>()
    const alreadyBound = bound.has(request.deviceId)
    // Re-activating the same device is a refresh, never a new seat.
    if (!alreadyBound && bound.size >= DEVICE_CAP_BY_TIER[tier]) {
      return {
        ok: false,
        code: 'device_limit',
        message: `this ${tier} key is already active on ${bound.size} device(s); deactivate one to transfer`,
      }
    }

    bound.add(request.deviceId)
    this.bindings.set(request.key, bound)
    return { ok: true, licence: this.mintLicence(request.key, tier, request, false) }
  }

  async startTrial(device: DeviceIdentity): Promise<IssueResult> {
    if (this.trialledDevices.has(device.deviceId)) {
      return {
        ok: false,
        code: 'already_trialled',
        message: 'this device has already used its free trial',
      }
    }
    this.trialledDevices.add(device.deviceId)
    // A trial is a real licence; the key is a synthetic trial token so the local
    // store round-trips it identically to a paid licence (ruling 16).
    return { ok: true, licence: this.mintLicence('STRIX-TRIAL', 'solo', device, true) }
  }

  async deactivate(deviceId: string): Promise<void> {
    // Free the seat on every key this device held — the transfer path.
    for (const bound of this.bindings.values()) bound.delete(deviceId)
  }
}
