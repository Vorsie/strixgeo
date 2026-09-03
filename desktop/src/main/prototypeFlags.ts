/**
 * Pure gates for the prototype-only launch surfaces (Electron main process).
 *
 * Kept free of Electron so vitest exercises it (see ``prototypeFlags.test.ts``);
 * ``index.ts`` feeds it ``app.isPackaged`` and the renderer mirrors the same
 * decision through ``window.electron.launchFlags.packaged``.
 */

/**
 * Whether the prototype-only "Preview a state" control is available.
 *
 * The preview jumps the activation store into any licence state so the owner can
 * SEE every screen without waiting out a clock. It is a dev-only affordance — it
 * must never ship in a packaged build (senior review SHOULD-FIX 1), so both the
 * IPC registration (``prototypeIpc.ts``) and the renderer row
 * (``LicensingDialog.tsx``) are gated on this.
 *
 * Parameters
 * ----------
 * isPackaged : boolean
 *     ``app.isPackaged``.
 *
 * Returns
 * -------
 * boolean
 *     True only for a dev (unpackaged) build.
 */
export function previewControlAllowed(isPackaged: boolean): boolean {
  return !isPackaged
}

/**
 * The value of the ``e2e`` boot flag surfaced to the renderer (audit C3(b)).
 *
 * ``STRIX_E2E=1`` tells the app it is under the Playwright harness, which lets it
 * skip the onboarding auto-open and the activation start screen so the suite is
 * not bricked. But that env var must NEVER be honoured in a PACKAGED build: a
 * customer (or an attacker) setting ``STRIX_E2E=1`` would otherwise walk straight
 * past the licence gate. The harness only ever runs an UNPACKAGED build, so
 * gating the flag on ``!isPackaged`` costs the suite nothing and closes the
 * bypass.
 *
 * Parameters
 * ----------
 * env : { STRIX_E2E?: string | undefined }
 *     ``process.env`` (or a subset), read for ``STRIX_E2E``.
 * isPackaged : boolean
 *     ``app.isPackaged``.
 *
 * Returns
 * -------
 * boolean
 *     ``true`` only for an unpackaged build with ``STRIX_E2E=1``.
 */
export function e2eLaunchFlag(env: { STRIX_E2E?: string | undefined }, isPackaged: boolean): boolean {
  return env.STRIX_E2E === '1' && !isPackaged
}
