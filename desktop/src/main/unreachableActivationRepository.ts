/**
 * The issuer for a PACKAGED build that has no activation server (Electron main
 * process). Debt #3, audit C3(a).
 *
 * When no base URL is configured, a DEV build falls back to the in-memory
 * {@link MockActivationRepository} (the dogfeed is unchanged). A PACKAGED build
 * must NOT — the mock accepts the published demo keys (``STRIX-*-DEMO`` are in the
 * contract doc), so a packaged build would "activate" on a key anyone can read.
 *
 * This repository is what a packaged build gets instead: it can activate
 * NOTHING. Every ``activate`` / ``startTrial`` answers ``unreachable`` — the same
 * code the offline path already handles — and ``deactivate`` fails loudly (there
 * is no server to release a seat, and a silent success would strand it). The
 * explicit rule this encodes (owner beta ruling): *"a beta build runs on its
 * stamp; a non-beta packaged build with no issuer cannot activate"* — a beta
 * build never reaches an activation issuer at all (its beta stamp is the
 * authority), and a real non-beta build simply cannot activate until the
 * strixgeo.com server exists and its URL is compiled in.
 */

import {
  DeactivateFailedError,
  type ActivateRequest,
  type ActivationRepository,
  type DeviceIdentity,
  type IssueResult,
} from './activationRepository'

/** The message every refusal carries — key-free, safe to log. */
const NO_ISSUER_MESSAGE = 'no activation server is configured for this build'

/**
 * An issuer that can grant nothing — the packaged-build fallback when no
 * activation URL is configured.
 */
export class UnreachableActivationRepository implements ActivationRepository {
  /** Always ``unreachable`` — a packaged build cannot mint a licence with no server. */
  async activate(_request: ActivateRequest): Promise<IssueResult> {
    return { ok: false, code: 'unreachable', message: NO_ISSUER_MESSAGE }
  }

  /** Always ``unreachable`` — no server means no trial licence either. */
  async startTrial(_device: DeviceIdentity): Promise<IssueResult> {
    return { ok: false, code: 'unreachable', message: NO_ISSUER_MESSAGE }
  }

  /**
   * Fail loudly: there is no server to release a seat against, so a
   * {@link DeactivateFailedError} with a ``null`` status is thrown — the same
   * shape a network failure uses, which makes the orchestration layer KEEP the
   * local licence rather than strand a seat half-transferred (contract §6).
   */
  async deactivate(_deviceId: string): Promise<void> {
    throw new DeactivateFailedError(null, NO_ISSUER_MESSAGE)
  }
}
