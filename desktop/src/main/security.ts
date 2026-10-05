/**
 * Pure security helpers for the Electron main process (debt #36, #37).
 *
 * Lives separate from ``index.ts`` so the logic can be unit-tested
 * without spinning up Electron — every function here is a pure
 * transform with no DOM, no Electron, no I/O.
 *
 * Two surfaces:
 *
 *   * ``buildContentSecurityPolicy`` — returns the CSP header string the
 *     main process injects via ``onHeadersReceived``. Strict in
 *     production; relaxed in dev so Vite's HMR can use ``eval`` for
 *     fast-refresh.
 *   * ``decideExternalOpen`` — the deny-by-default
 *     ``webContents.setWindowOpenHandler`` callback shape. Allowed
 *     external schemes (``http``/``https``/``mailto``) get marked for
 *     ``shell.openExternal``; everything else (``javascript:`` /
 *     ``file:`` / ``data:``) is denied so a renderer XSS can't
 *     escalate to opening an Electron window or running script via a
 *     ``javascript:`` URL.
 *
 * The functions are deliberately tiny — the value is in the unit
 * tests next to them, not in the implementation.
 */

import { resolve, sep } from 'path'

const API_PORT = 8765

/**
 * Canonicalises a filesystem path for membership checks in an
 * "authorised paths" set (debt #37).
 *
 * Returns the absolute path with normalised separators, with
 * trailing separator stripped, lowercased on win32 so the set
 * lookup is case-insensitive (NTFS is case-insensitive by default).
 * Returns ``null`` for inputs that can't be normalised (empty
 * string, non-string).
 *
 * The function deliberately ``resolve()``s — ``"."`` / ``".."``
 * segments collapse, so a renderer that tries
 * ``project:write-file("C:\\authorised\\..\\..\\evil")`` cannot
 * smuggle through with a path that looks safe by string match but
 * resolves elsewhere.
 */
export function normalizePathForCompare(input: unknown): string | null {
  if (typeof input !== 'string' || input.length === 0) return null
  let resolved: string
  try {
    resolved = resolve(input)
  } catch {
    return null
  }
  // Strip trailing separator so "C:\\x" and "C:\\x\\" are the same.
  const trimmed = resolved.endsWith(sep) && resolved.length > sep.length
    ? resolved.slice(0, -sep.length)
    : resolved
  return process.platform === 'win32' ? trimmed.toLowerCase() : trimmed
}

/**
 * Reduce a renderer-supplied save-dialog ``defaultPath`` to a bare filename
 * (debt #37, audit H4).
 *
 * ``dialog.showSaveDialog`` pre-fills its filename field from ``defaultPath``.
 * That value comes from the renderer (the project name, a section name) and is
 * therefore untrusted: a crafted name like ``..\\..\\Windows\\evil.strix`` would
 * pre-select a path outside the directory the user expects. Stripping every
 * directory component — separators in either style, a Windows drive prefix — and
 * any control characters leaves only a filename suggestion; the real target path
 * is still whatever the user then picks in the dialog (and only that path is
 * authorised for writing).
 *
 * Parameters
 * ----------
 * name : unknown
 *     The renderer-supplied default name. Non-strings are treated as absent.
 *
 * Returns
 * -------
 * string | undefined
 *     A separator-free filename, or ``undefined`` when nothing usable remains
 *     (so the caller lets the dialog choose its own default).
 */
export function sanitizeSaveDialogDefault(name: unknown): string | undefined {
  if (typeof name !== 'string') return undefined
  // Drop a Windows drive prefix (``C:``) so ``C:bar`` / ``C:\dir\bar`` both
  // reduce to the filename rather than a drive-relative path.
  let base = name.replace(/^[A-Za-z]:/, '')
  // Keep only what follows the last separator, whichever style the renderer used.
  const lastSep = Math.max(base.lastIndexOf('/'), base.lastIndexOf('\\'))
  if (lastSep >= 0) base = base.slice(lastSep + 1)
  // Strip any residual separators plus control characters (NUL included) that a
  // crafted name could smuggle past the split.
  // eslint-disable-next-line no-control-regex
  base = base.replace(/[/\\\x00-\x1f]/g, '').trim()
  return base.length > 0 ? base : undefined
}

/**
 * Returns the Content-Security-Policy header value the main process
 * should inject on every document response.
 *
 * In **production**:
 *   * ``script-src 'self'`` — no inline scripts, no eval. Defends against
 *     XSS even when an attacker manages to inject HTML.
 *   * ``connect-src`` whitelisted to the local API plus DOV / DEM
 *     endpoints we actually hit; everything else (``evil.com``) is
 *     blocked.
 *   * ``img-src`` allows ``https:`` for the OSM tile server (we don't
 *     pre-know every tile origin) and ``data:`` / ``blob:`` for SVG
 *     soil patterns and exported images.
 *
 * In **dev** (``isDev=true``): ``script-src`` adds ``'unsafe-eval'``
 * and ``'unsafe-inline'`` because Vite's fast-refresh client uses
 * ``new Function()``; ``connect-src`` adds the Vite HMR websocket. The
 * dev relaxation is acceptable because the dev build doesn't ship to
 * users.
 */
export function buildContentSecurityPolicy(isDev: boolean): string {
  // Production allows ``'wasm-unsafe-eval'`` — CesiumJS (the 3D geo viewer)
  // instantiates a WebAssembly module, which a bare ``script-src 'self'``
  // blocks (``CompileError: ... violates ... script-src 'self'``). This token
  // permits WASM compilation ONLY; it does NOT enable general JS eval (that is
  // the separate, still-forbidden ``'unsafe-eval'``), so the XSS defence is
  // intact. Dev additionally needs ``'unsafe-eval'`` + ``'unsafe-inline'`` for
  // Vite's fast-refresh client.
  const scriptSrc = isDev
    ? "'self' 'unsafe-eval' 'unsafe-inline'"
    : "'self' 'wasm-unsafe-eval'"
  const connectSrc = [
    "'self'",
    `http://127.0.0.1:${API_PORT}`,
    // DOV WFS + per-permkey XML downloads
    'https://www.dov.vlaanderen.be',
    // DHMVII DEM raster service
    'https://geo.api.vlaanderen.be',
    // OSM tile server for the map basemap
    'https://*.tile.openstreetmap.org',
  ]
  if (isDev) {
    // Vite HMR websocket — dev only.
    connectSrc.push('ws://localhost:*')
  }
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    // Tailwind generates utility classes at build time, but a few
    // third-party widgets (Leaflet attribution, the streaflet map) inline
    // style attributes. ``'unsafe-inline'`` on style-src is the
    // standard escape valve for that.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    `connect-src ${connectSrc.join(' ')}`,
    "font-src 'self' data:",
    // Locks down embedded iframes (none today) and plugin objects.
    // 'self' (not 'none'): the cross-section PDF sheet renders sheet.html — the
    // app's own second renderer entry — inside a same-origin iframe for the live
    // preview (docs/superpowers/specs/2026-09-02-section-pdf-sheet-design.md).
    // Foreign frames stay blocked.
    "frame-src 'self'",
    "object-src 'none'",
    // Modern UA hardening — prevent base-target hijacking and
    // form posting to other origins.
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')
}

/**
 * The shape Electron's ``webContents.setWindowOpenHandler`` callback
 * decides — either deny the renderer's attempt to open a new window
 * entirely, or send the URL to the OS via ``shell.openExternal``.
 *
 * Callers wire this up as:
 *   win.webContents.setWindowOpenHandler(({ url }) => {
 *     const d = decideExternalOpen(url)
 *     if (d.external) shell.openExternal(url)
 *     return { action: 'deny' }
 *   })
 *
 * The single return value ``{ action: 'deny' }`` is intentional — we
 * never let an Electron BrowserWindow open from renderer-issued
 * ``window.open`` even for trusted URLs. Trusted URLs hand off to the
 * OS browser instead.
 */
export interface ExternalOpenDecision {
  /** True when the URL is safe to hand to ``shell.openExternal``. */
  external: boolean
}

export function decideExternalOpen(url: string): ExternalOpenDecision {
  // Whitelist-only: only well-known web/email schemes are safe to hand
  // to the OS. ``file:`` / ``javascript:`` / ``data:`` are rejected —
  // ``shell.openExternal`` on a file:// URL could pop a local file in
  // an arbitrary app; on javascript: it would do nothing on most OSes
  // but is a red flag worth shutting down explicitly.
  return {
    external: /^(?:https?|mailto):/i.test(url),
  }
}

/**
 * The shape of an ``in-app`` navigation check. Returns whether a
 * ``will-navigate`` URL should be allowed to proceed.
 *
 * In dev the renderer is served from ``http://localhost:<port>`` (Vite);
 * in prod it's served from a ``file://`` path under the packaged renderer
 * directory (BrowserWindow.loadFile). Any other URL the renderer tries to
 * navigate to is denied — clicking an external link should go through
 * ``setWindowOpenHandler`` / ``shell.openExternal`` instead.
 *
 * Audit #15: the production branch used to allow ANY ``file://`` URL, so a
 * compromised renderer could ``will-navigate`` to an arbitrary local file
 * (``file:///C:/Windows/...``). It is now confined to the renderer
 * directory prefix, exactly like the dev base is confined to the Vite origin.
 *
 * @param url - The navigation target Electron reports.
 * @param rendererBase - The dev renderer origin (Vite), or null in prod.
 * @param rendererFileBase - The packaged renderer directory ``file://``
 *   prefix (prod), or null in dev. A navigation is allowed only when it
 *   starts with this prefix.
 */
export function isInAppNavigation(
  url: string,
  rendererBase: string | null,
  rendererFileBase: string | null,
): boolean {
  if (rendererBase !== null && url.startsWith(rendererBase)) return true
  // Production: only file:// paths under the packaged renderer directory.
  // Normalise through the URL parser first so a ``..`` traversal segment
  // (``renderer/../../Windows/...``) collapses BEFORE the prefix check —
  // a raw startsWith on the unresolved string would let it through.
  if (rendererFileBase !== null) {
    try {
      const resolved = new URL(url).href
      if (resolved.startsWith(rendererFileBase)) return true
    } catch {
      // Malformed URL — deny.
      return false
    }
  }
  return false
}

// Per-field length caps on recent-projects entries (debt #41). A
// corrupted or hand-edited ``recent-projects.json`` could ship a
// 100-MB ``name`` and freeze the menu rebuild. The values are well
// above any plausible real project name / Windows path length.
const RECENT_PROJECT_NAME_MAX_LEN = 200
const RECENT_PROJECT_PATH_MAX_LEN = 1024
const RECENT_PROJECT_ISO_MAX_LEN = 64

/**
 * Whether the "Open log folder" menu item — which reveals the RAW,
 * un-redacted ``backend.log`` in the OS file browser — should exist.
 *
 * ``backend.log`` is the backend's own stdout: it carries the asyncpg DSN
 * (password included) and raw project / data-file paths. The crash-bundle
 * path redacts it line by line before it can leave the machine
 * (``crashBundle.ts`` → ``diagnosticsRedaction.ts``); the raw-log shortcut
 * does not. Offering both next to each other under Help invites a
 * bug-reporter to grab the un-redacted file — the exact leak the redaction
 * exists to prevent.
 *
 * So a **packaged** (customer) build never gets the shortcut: its only
 * supported way to hand over logs is the redacted "Save diagnostics
 * bundle…". A **development** build keeps it — dev runs on the developer's
 * own machine, so the raw log is a convenience, not a third-party leak. This
 * mirrors the dev-only gating already applied to Reload / DevTools in the
 * View menu.
 *
 * @param isPackaged - Electron's ``app.isPackaged``.
 * @returns ``true`` only in development.
 */
export function rawBackendLogAffordanceEnabled(isPackaged: boolean): boolean {
  return !isPackaged
}

/**
 * Validates one entry from ``recent-projects.json`` (debt #41).
 *
 * Beyond type-shape (the existing ``isRecentProject``), also caps
 * field lengths so a corrupted file can't blow up the menu render.
 * Returns ``true`` for entries that should be kept; the caller
 * filters the array.
 */
export function isValidRecentProjectEntry(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.path === 'string' &&
    v.path.length > 0 &&
    v.path.length <= RECENT_PROJECT_PATH_MAX_LEN &&
    typeof v.name === 'string' &&
    v.name.length <= RECENT_PROJECT_NAME_MAX_LEN &&
    typeof v.lastOpened === 'string' &&
    v.lastOpened.length <= RECENT_PROJECT_ISO_MAX_LEN
  )
}
