/**
 * The packaged activation START-SCREEN gate (owner ruling A, prototype).
 *
 * Owner dictated note (CLAUDE.local.md, docs/design note): *"a startscreen with
 * beta key input before the actual app opens."* This supersedes the prototype's
 * deliberate non-blocking choice — but ONLY for a real distributed build. The
 * pure decision here is what the App render consults before it shows the
 * workspace: a blocked verdict stops at the licence screen; dev and the e2e
 * harness pass straight through so the owner's dogfeed and the smoke suite are
 * untouched (30-day offline grace, ruling 14, keeps active/grace verdicts open).
 *
 * The verdict itself (unactivated / expired / clock-rollback → blocked) is
 * decided by ``evaluateActivation`` in the main process; this module only layers
 * the dev/e2e overrides on top of the ``blocked`` boolean it produces.
 */

/** Whether to stop at the licence start screen or let the app open. */
export type GateDecision = 'block' | 'pass'

/**
 * Decide whether a launch is stopped at the licence start screen.
 *
 * Parameters
 * ----------
 * input : { blocked: boolean; packaged: boolean; e2e: boolean }
 *     ``blocked`` is ``verdict.blocked`` from the activation status;
 *     ``packaged`` and ``e2e`` are ``window.electron.launchFlags``.
 *
 * Returns
 * -------
 * GateDecision
 *     ``'block'`` only for a packaged, non-e2e build whose verdict is blocked;
 *     ``'pass'`` for every dev build, every e2e run, and every active/grace
 *     verdict.
 */
export function activationGateDecision(input: {
  blocked: boolean
  packaged: boolean
  e2e: boolean
}): GateDecision {
  // Dev dogfeed is never blocked — the owner's daily flow must be untouched.
  if (!input.packaged) return 'pass'
  // The e2e harness is never blocked — a licence gate would brick the suite.
  if (input.e2e) return 'pass'
  return input.blocked ? 'block' : 'pass'
}
