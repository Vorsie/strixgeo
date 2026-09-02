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
