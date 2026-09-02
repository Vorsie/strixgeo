/**
 * Activation orchestration (Electron main process) — PROTOTYPE. Debt #3.
 *
 * Glues the three activation pieces together and is the ONLY thing the IPC layer
 * in ``index.ts`` talks to:
 *
 *   issuer seam ({@link ./activationRepository})  →  the "server"
 *   local store ({@link ./activationStore})       →  the offline authority
 *   pure evaluator ({@link ./activation})         →  the state machine
 *
 * It imports nothing from Electron — ``index.ts`` injects the userData directory
 * (through the store's own ``configure`` call), the device label and the clock —
 * so the MySQL-vs-SQLite engine choice the owner deferred cannot leak in here.
 *
 * ## What is REAL vs MOCKED
 *
 * REAL: the state transitions, the offline-grace read, the clock-rollback guard,
 * the deactivate/transfer flow, and the persistence shape. MOCKED: the issuer
 * (in-memory, no network, no signature) and the device fingerprint (a generated
 * uuid). The prototype does NOT block the app on ``verdict.blocked`` — that is a
 * one-line gate a production build adds; here every state is merely *shown* so
 * the owner can react to each screen.
 */

import { evaluateActivation, type ActivationVerdict, type Licence, type LicenceState } from './activation'
import type { ActivationRepository, IssueFailureCode } from './activationRepository'
import {
  readActivationState,
  recordActivationLaunch,
  writeActivationState,
  type ActivationState,
} from './activationStore'

const DAY_MS = 24 * 60 * 60 * 1000

/** The status the renderer's licensing screen renders. */
export interface ActivationStatus {
  /** The evaluated verdict — state, blocked, day counts, reason. */
  verdict: ActivationVerdict
  /** This device's human-readable name, for the deactivate/transfer row. */
  deviceLabel: string
  /** The active key, masked to its last group; ``null`` when unactivated. */
  keyMasked: string | null
  /** True for a trial licence, so the screen can nudge toward a paid tier. */
  isTrial: boolean
}

/** Result of an activate / trial / deactivate action, for the screen to react to. */
export type ActivationActionResult =
  | { ok: true; status: ActivationStatus }
  | { ok: false; code: IssueFailureCode; message: string }

/** Everything the service needs, injected by ``index.ts`` at startup. */
export interface ActivationServiceConfig {
  /** The issuer implementation — the mock in the prototype. */
  repository: ActivationRepository
  /** This device's display name (``os.hostname()`` in production wiring). */
  deviceLabel: string
  /** Clock source; ``Date.now`` in production, pinned in tests. */
  now?: () => number
}

/**
 * Orchestrates the activation flow behind a handful of IPC-friendly methods.
 */
export class ActivationService {
  private readonly repository: ActivationRepository
  private readonly deviceLabel: string
  private readonly now: () => number

  constructor(config: ActivationServiceConfig) {
    this.repository = config.repository
    this.deviceLabel = config.deviceLabel
    this.now = config.now ?? Date.now
  }

  /** Mask a key to its last dash-group so the screen shows it without leaking it. */
  private static maskKey(key: string | null): string | null {
    if (!key) return null
    const parts = key.split('-')
    if (parts.length <= 1) return '••••'
    return `${parts.slice(0, -1).map(() => '••••').join('-')}-${parts[parts.length - 1]}`
  }

  /** Evaluate the given state and wrap it as the renderer's status DTO. */
  private toStatus(state: ActivationState, nowMs: number = this.now()): ActivationStatus {
    const highWater = state.anchor?.lastSeenMs ?? 0
    const verdict = evaluateActivation(state.licence, highWater, nowMs)
    return {
      verdict,
      deviceLabel: this.deviceLabel,
      keyMasked: ActivationService.maskKey(state.licence?.key ?? null),
      isTrial: state.licence?.isTrial ?? false,
    }
  }

  /**
   * Current activation status. Advances the monotonic anchor as a side effect
   * (same "record this launch" step the beta gate performs).
   */
  getStatus(): ActivationStatus {
    // One clock read for both the anchor advance and the verdict, so the
    // "record this launch" step and the state it is judged against agree.
    const nowMs = this.now()
    return this.toStatus(recordActivationLaunch(nowMs), nowMs)
  }

  /** Persist a freshly-issued licence, keeping the device id and anchor. */
  private persistLicence(licence: Licence): ActivationState {
    const current = readActivationState()
    const next: ActivationState = { ...current, licence }
    writeActivationState(next)
    return next
  }

  /**
   * Activate with a paid key.
   *
   * Parameters
   * ----------
   * key : string
   *     The licence key the user entered.
   */
  async activate(key: string): Promise<ActivationActionResult> {
    const { deviceId } = readActivationState()
    const result = await this.repository.activate({ key, deviceId, deviceLabel: this.deviceLabel })
    if (!result.ok) return result
    return { ok: true, status: this.toStatus(this.persistLicence(result.licence)) }
  }

  /** Start a server-issued trial (ruling 16). */
  async startTrial(): Promise<ActivationActionResult> {
    const { deviceId } = readActivationState()
    const result = await this.repository.startTrial({ deviceId, deviceLabel: this.deviceLabel })
    if (!result.ok) return result
    return { ok: true, status: this.toStatus(this.persistLicence(result.licence)) }
  }

  /** Deactivate / transfer this device: free the seat and clear the local licence. */
  async deactivate(): Promise<ActivationActionResult> {
    const { deviceId } = readActivationState()
    await this.repository.deactivate(deviceId)
    const current = readActivationState()
    const next: ActivationState = { ...current, licence: null }
    writeActivationState(next)
    return { ok: true, status: this.toStatus(next) }
  }

  /**
   * PROTOTYPE ONLY — force the store into a given state so the owner can see
   * each licensing screen without waiting out a real clock. Not a production
   * method; the design note flags it for removal.
   *
   * Parameters
   * ----------
   * state : LicenceState
   *     The state to synthesise a stored licence (and, for a rollback, anchor)
   *     for.
   */
  previewState(state: LicenceState): ActivationStatus {
    const now = this.now()
    const current = readActivationState()
    const base = (tier: Licence['tier'], isTrial: boolean, expiresAtMs: number): Licence => ({
      key: isTrial ? 'STRIX-TRIAL' : `STRIX-${tier.toUpperCase()}-DEMO`,
      tier,
      isTrial,
      deviceId: current.deviceId,
      deviceLabel: this.deviceLabel,
      issuedAtMs: now,
      expiresAtMs,
      graceWindowMs: 30 * DAY_MS,
    })

    let next: ActivationState
    switch (state) {
      case 'unactivated':
        next = { ...current, licence: null }
        break
      case 'trial':
        next = { ...current, licence: base('solo', true, now + 20 * DAY_MS) }
        break
      case 'active':
        next = { ...current, licence: base('pro', false, now + 200 * DAY_MS) }
        break
      case 'grace':
        next = { ...current, licence: base('solo', false, now - 5 * DAY_MS) }
        break
      case 'expired':
        next = { ...current, licence: base('solo', false, now - 40 * DAY_MS) }
        break
      case 'clock-rollback':
        // A wound-back clock = a high-water mark ahead of now. Keep (or mint) a
        // live licence so the guard, not an expiry, is what fires.
        next = {
          ...current,
          licence: current.licence ?? base('pro', false, now + 200 * DAY_MS),
          anchor: { firstSeenMs: now, lastSeenMs: now + 30 * DAY_MS },
        }
        break
      default:
        next = current
    }
    writeActivationState(next)
    return this.toStatus(next)
  }
}
