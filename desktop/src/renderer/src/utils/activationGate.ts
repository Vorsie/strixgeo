/**
 * The packaged activation START-SCREEN gate (owner ruling A, prototype).
 *
 * Owner dictated note (CLAUDE.local.md, docs/design note): *"a startscreen with
 * beta key input before the actual app opens."* This supersedes the prototype's
 * deliberate non-blocking choice — but ONLY for a real distributed build. The
 * pure decision here is what the App render consults before it shows the
 * workspace.
 *
 * The rules it layers on top of the main-process ``blocked`` boolean:
 *
 *  * dev and the e2e harness pass straight through (the dogfeed + smoke suite are
 *    untouched; 30-day offline grace keeps active/grace verdicts open);
 *  * a BETA build passes straight through — it runs on its STAMP, not on a
 *    licence (audit C3(a); the beta-expiry gate is its authority and already
 *    refused an expired beta before this window existed);
 *  * a packaged non-beta build FAILS CLOSED — if the activation status could not
 *    be read it is treated as "no licence" and stopped at the licence screen,
 *    never fallen open into the workspace (coordinator addition);
 *  * otherwise the main-process ``blocked`` verdict decides.
 */

/** Whether to stop at the licence start screen or let the app open. */
export type GateDecision = 'block' | 'pass'

/** The facts the packaged start-screen gate weighs. */
export interface ActivationGateInputs {
  /** ``window.electron.launchFlags.packaged`` — a dev build never blocks. */
  packaged: boolean
  /** ``window.electron.launchFlags.e2e`` — the harness never blocks. */
  e2e: boolean
  /** True when this build carries a beta stamp — it runs on the stamp. */
  betaBuild: boolean
  /** True when the activation status IPC could not be read (fail closed). */
  statusReadFailed: boolean
  /** ``verdict.blocked`` from the activation status; ignored when the read failed. */
  blocked: boolean
}

/**
 * Decide whether a launch is stopped at the licence start screen.
 *
 * Parameters
 * ----------
 * input : ActivationGateInputs
 *     The packaged / e2e / beta facts, whether the status read failed, and the
 *     ``blocked`` verdict.
 *
 * Returns
 * -------
 * GateDecision
 *     ``'block'`` only for a packaged, non-e2e, non-beta build that is either
 *     blocked or whose status could not be read; ``'pass'`` otherwise.
 */
export function activationGateDecision(input: ActivationGateInputs): GateDecision {
  // Dev dogfeed is never blocked — the owner's daily flow must be untouched.
  if (!input.packaged) return 'pass'
  // The e2e harness is never blocked — a licence gate would brick the suite.
  if (input.e2e) return 'pass'
  // A beta build runs on its STAMP, not on a licence: the beta-expiry gate is its
  // authority and already refused an expired beta before this window existed.
  if (input.betaBuild) return 'pass'
  // FAIL CLOSED: a packaged non-beta build whose status could not be read is
  // treated as "no licence" — the licence screen, never an open workspace.
  if (input.statusReadFailed) return 'block'
  return input.blocked ? 'block' : 'pass'
}

/**
 * Whether ``window.electron.getBetaStatus()`` describes a BETA build.
 *
 * A build carrying a beta stamp reports a real state (``active`` / ``warning`` —
 * an ``expired`` / ``clock-rollback`` beta never reaches the renderer, the main
 * gate refused it first); a build with no stamp reports ``unstamped``. So a beta
 * build is exactly "a status object whose state is not ``unstamped``".
 *
 * Parameters
 * ----------
 * status : unknown
 *     The value ``getBetaStatus()`` resolved to (``{ state, ... } | null``).
 *
 * Returns
 * -------
 * boolean
 *     ``true`` when the status names a stamped (beta) build.
 */
export function isBetaBuild(status: unknown): boolean {
  return (
    typeof status === 'object' &&
    status !== null &&
    typeof (status as { state?: unknown }).state === 'string' &&
    (status as { state: string }).state !== 'unstamped'
  )
}
