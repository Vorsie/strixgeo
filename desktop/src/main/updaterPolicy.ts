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
 * Whether a latched updater event is worth replaying to a renderer that has
 * just finished loading.
 *
 * The launch check runs the moment the window exists, and the feed can answer
 * before the renderer has loaded and subscribed — the "available" event then
 * reached nobody (owner 2026-09-26: no prompt on startup, a manual check
 * worked). The service latches the last event and replays it on
 * ``did-finish-load``. Only phases that ask something of the engineer are
 * replayed: an offer, a finished download, or a failure. Transient and calm
 * phases are not, or every reload would re-toast "you are up to date".
 *
 * Parameters
 * ----------
 * event : { phase: string }
 *     The latched event (only its phase matters here).
 *
 * Returns
 * -------
 * boolean
 *     True for ``available``, ``downloaded`` and ``error``.
 */
export function shouldReplayOnLoad(event: { phase: string }): boolean {
  return event.phase === 'available' || event.phase === 'downloaded' || event.phase === 'error'
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
 * Which cause an updater FAILURE should name to the user.
 *
 * Not every failed check is equal: an offline machine, a corporate proxy /
 * firewall, and an unexpected server answer each want different words. Kept as a
 * discriminator (not the finished string) so the renderer owns the EN/NL copy.
 */
export type UpdaterErrorReason = 'offline' | 'blocked' | 'unexpected'

/**
 * How the app should present an ``autoUpdater`` error.
 *
 * ``no-release`` is the closed beta's NORMAL state: the releases feed reached us
 * and answered "nothing published yet". That is not a failure — the app shows a
 * calm "no update available yet" line, never "check for updates failed" (owner
 * finding (g), installer #37).
 */
export interface UpdaterErrorClassification {
  /** ``no-release`` when the feed simply has nothing published; else ``error``. */
  kind: 'no-release' | 'error'
  /** Which cause to name; present only when ``kind === 'error'``. */
  reason?: UpdaterErrorReason
}

/**
 * electron-updater GitHubProvider error codes that mean "there is no release for
 * this client yet" rather than "the check failed". Verified against
 * ``node_modules/electron-updater/out/providers/GitHubProvider.js``:
 *   * ``ERR_UPDATER_NO_PUBLISHED_VERSIONS`` — a draft-only repo (the closed beta).
 *   * ``ERR_UPDATER_LATEST_VERSION_NOT_FOUND`` — "please ensure a production release exists".
 *   * ``ERR_UPDATER_CHANNEL_FILE_NOT_FOUND`` — a release exists but its
 *     ``latest.yml`` is missing (owner named the "404 on latest.yml" case).
 */
const NO_RELEASE_CODES: ReadonlySet<string> = new Set([
  'ERR_UPDATER_NO_PUBLISHED_VERSIONS',
  'ERR_UPDATER_LATEST_VERSION_NOT_FOUND',
  'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND',
])

/** Message fragments that betray the same "no release yet" states, code-free. */
const NO_RELEASE_MESSAGE = [
  'no published versions',
  'please ensure a production release exists',
]

/** Message fragments that mean the request never reached the feed (offline). */
const OFFLINE_MESSAGE =
  /net::err_internet_disconnected|net::err_name_not_resolved|enotfound|eai_again|enetunreach|etimedout|econnrefused|econnreset|econnaborted|getaddrinfo|network is unreachable/

/** Message fragments that mean a proxy / firewall / TLS wall answered (blocked). */
const BLOCKED_MESSAGE =
  /\b40[13]\b|forbidden|unauthorized|err_proxy|err_tunnel|err_cert|self.signed|self-signed|unable to verify|err_ssl/

/**
 * Classify an ``autoUpdater`` error into a renderer-facing verdict.
 *
 * The whole point of finding (g): distinguish "the feed has nothing published
 * yet" (calm, expected for the closed beta) from a genuine failure, and — for a
 * genuine failure — name the cause. Pure and Electron-free so vitest pins it.
 *
 * Parameters
 * ----------
 * input : { message?, code? }
 *     The ``message`` and (when present) the ``.code`` electron-updater sets via
 *     ``newError(message, code)``.
 *
 * Returns
 * -------
 * UpdaterErrorClassification
 *     ``{ kind: 'no-release' }`` for an empty feed; ``{ kind: 'error', reason }``
 *     for a real failure.
 */
export function classifyUpdaterError(input: {
  message?: string | null
  code?: string | null
}): UpdaterErrorClassification {
  const code = (input.code ?? '').trim()
  const lower = (input.message ?? '').toLowerCase()

  // 1. No release published yet — the feed answered, there is just nothing to
  //    offer. Not a failure.
  if (NO_RELEASE_CODES.has(code)) return { kind: 'no-release' }
  if (NO_RELEASE_MESSAGE.some(fragment => lower.includes(fragment))) return { kind: 'no-release' }
  // A bare 404 for the update manifest is the same state (a release with no
  // latest.yml, or a repo with none).
  if (/(latest|beta|alpha)[^ ]*\.yml/.test(lower) && lower.includes('404')) {
    return { kind: 'no-release' }
  }

  // 2. Offline — the request never reached the feed.
  if (OFFLINE_MESSAGE.test(lower)) return { kind: 'error', reason: 'offline' }

  // 3. Blocked — a proxy, firewall, TLS interception or auth wall answered.
  if (BLOCKED_MESSAGE.test(lower)) return { kind: 'error', reason: 'blocked' }

  // 4. Anything else — a real failure whose cause we cannot name precisely.
  return { kind: 'error', reason: 'unexpected' }
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
