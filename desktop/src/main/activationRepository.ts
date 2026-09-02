/**
 * The activation ISSUER seam (Electron main process) — PROTOTYPE.
 *
 * Debt #3. This is the thin interface the owner explicitly asked for
 * (CLAUDE.local.md → "Activation host"): *"build the activation service against
 * a THIN REPOSITORY INTERFACE and defer the engine choice — do not let
 * MySQL-vs-SQLite-vs-Postgres assumptions leak into the service."* Everything
 * upstream of this interface is the STRIXGEO.COM service (ruled MySQL, 100 MB);
 * everything downstream ({@link ../activation.evaluateActivation}) is the local
 * offline authority.
 *
 * The prototype ships one implementation, {@link ./mockActivationRepository},
 * which stands in for that service entirely in-memory. When the real service is
 * built, it implements THIS interface and the service code below it does not
 * change.
 *
 * ## What a production implementation adds that the mock does not
 *
 * * A network round-trip to strixgeo.com, checking Stripe subscription state.
 * * An **Ed25519-signed** licence file (Option C in the activation memo) so the
 *   local evaluator can trust the dates without re-contacting the server.
 * * Real device-fingerprinting rather than a generated opaque id.
 *
 * None of that changes the shape below — which is the point of the seam.
 */

import type { Licence, LicenceTier } from './activation'

/** What the caller knows about the device asking to activate. */
export interface DeviceIdentity {
  /** Opaque, stable per-installation id (prototype: generated + persisted). */
  deviceId: string
  /** Human-readable name shown on the deactivate/transfer screen. */
  deviceLabel: string
}

/** A paid activation request — a key plus the device asking. */
export interface ActivateRequest extends DeviceIdentity {
  /** The licence key the user entered. */
  key: string
}

/**
 * The issuer's answer.
 *
 * A failure carries a machine code the UI maps to a message, never a bare
 * string, so the renderer decides the wording (and its translation).
 */
export type IssueResult =
  | { ok: true; licence: Licence }
  | { ok: false; code: IssueFailureCode; message: string }

/** Why an issue request was refused. */
export type IssueFailureCode =
  /** The key is not one the issuer recognises. */
  | 'unknown_key'
  /** The key is at its device limit (ruling 15: Solo = 1). */
  | 'device_limit'
  /** This device already consumed its one trial. */
  | 'already_trialled'
  /** A stand-in for "the issuer could not be reached" — mock never returns it. */
  | 'unreachable'

/**
 * The seam. A production build swaps the mock for a network-backed
 * implementation; the {@link ./activationService} above it is unchanged.
 */
export interface ActivationRepository {
  /**
   * Activate (or refresh) a paid licence for a device.
   *
   * Honours the per-tier device binding — see {@link IssueFailureCode.device_limit}.
   */
  activate(request: ActivateRequest): Promise<IssueResult>

  /**
   * Issue a fresh, time-limited trial licence bound to this device (ruling 16).
   */
  startTrial(device: DeviceIdentity): Promise<IssueResult>

  /**
   * Release a device's bindings so the seat can move to another machine
   * (the self-service deactivate/transfer flow ruling 15 made required).
   */
  deactivate(deviceId: string): Promise<void>
}

/** Per-tier device cap. Ruling 15 fixes Solo at 1; the rest are prototype guesses. */
export const DEVICE_CAP_BY_TIER: Readonly<Record<LicenceTier, number>> = {
  solo: 1,
  pro: 2,
  studio: 25,
}
