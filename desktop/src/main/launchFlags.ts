/**
 * Pure gates for the launch flags (Electron main process).
 *
 * Kept free of Electron so vitest exercises it (see ``launchFlags.test.ts``);
 * ``index.ts`` feeds it ``app.isPackaged`` and the renderer mirrors the same
 * decision through ``window.electron.launchFlags.packaged``.
 */

/**
 * The value of the ``e2e`` boot flag surfaced to the renderer (audit C3(b)).
 *
 * ``STRIX_E2E=1`` tells the app it is under the Playwright harness, which lets it
 * skip the onboarding auto-open and answer its own native dialogs so the suite
 * is not bricked. But that env var must NEVER be honoured in a PACKAGED build: a
 * customer setting ``STRIX_E2E=1`` would otherwise get stubbed Save / Open
 * dialogs and silenced external links. The harness only ever runs an UNPACKAGED
 * build, so gating the flag on ``!isPackaged`` costs the suite nothing.
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
