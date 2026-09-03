/**
 * Pure updater policy (Electron main process) — PROTOTYPE. Debt #6.
 *
 * The decision + shaping half of the auto-updater, kept free of Electron and of
 * ``electron-updater`` so vitest can exercise it (see ``updaterPolicy.test.ts``).
 * The side-effecting half — wiring ``autoUpdater`` events and downloading — lives
 * in {@link ./updaterService}.
 *
 * ## The gate the brief fixes
 *
 * Everything auto is gated on ``app.isPackaged`` so ``npm run dev`` never talks
 * to an update feed. {@link shouldAutoCheckOnLaunch} is that gate expressed once,
 * as a pure function, so the service reads as intent rather than as an inline
 * ``if``.
 */

/** A renderer-safe summary of an available update. Strings or null, never richer. */
export interface UpdateAvailableNotice {
  /** The version on offer, e.g. ``1.4.0``. Always present. */
  version: string
  /** Human release name, when the feed carried one. */
  releaseName: string | null
  /** Plain-text release notes, when the feed carried a string. */
  releaseNotes: string | null
}

/**
 * The shape ``electron-updater`` hands to ``update-available`` — only the fields
 * the prototype reads, all optional except ``version``.
 */
export interface RawUpdateInfo {
  version: string
  releaseName?: string | null
  /** A string, or an array of release-note blocks, or absent. */
  releaseNotes?: string | Array<{ version: string; note: string | null }> | null
}

/**
 * Whether a launch should silently check for updates.
 *
 * Parameters
 * ----------
 * isPackaged : boolean
 *     ``app.isPackaged``. Only a packaged build has an ``app-update.yml`` and a
 *     real feed; a dev run has neither, so it never checks.
 *
 * Returns
 * -------
 * boolean
 *     True only for a packaged build.
 */
export function shouldAutoCheckOnLaunch(isPackaged: boolean): boolean {
  return isPackaged
}

/**
 * Whether an update may be installed automatically when the app quits.
 *
 * ``electron-updater``'s ``autoInstallOnAppQuit`` swaps the downloaded installer
 * in on the next quit with no further prompt. For an UNSIGNED build that is a
 * silent replacement whose only trust is TLS to GitHub plus one publishing
 * account — so it stays off until the code-signing cert lands (audit H6, debt
 * #6). The renderer's "Install now" (``updater:quit-and-install``) remains the
 * explicit path in the meantime.
 *
 * Parameters
 * ----------
 * isSigned : boolean
 *     Whether this build is code-signed.
 *
 * Returns
 * -------
 * boolean
 *     True only for a signed build.
 */
export function autoInstallOnQuit(isSigned: boolean): boolean {
  return isSigned
}

/**
 * Reduce a raw ``UpdateInfo`` to the renderer-safe notice.
 *
 * Parameters
 * ----------
 * info : RawUpdateInfo
 *     The blob ``electron-updater`` emits with ``update-available``.
 *
 * Returns
 * -------
 * UpdateAvailableNotice
 *     ``version`` always; ``releaseName`` / ``releaseNotes`` only when they
 *     arrived as plain strings (an array of note blocks is dropped to ``null``
 *     rather than forwarded raw).
 */
export function summariseUpdateInfo(info: RawUpdateInfo): UpdateAvailableNotice {
  return {
    version: info.version,
    releaseName: typeof info.releaseName === 'string' ? info.releaseName : null,
    releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : null,
  }
}
