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
  const scriptSrc = isDev
    ? "'self' 'unsafe-eval' 'unsafe-inline'"
    : "'self'"
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
    // third-party widgets (Leaflet attribution, react-leaflet) inline
    // style attributes. ``'unsafe-inline'`` on style-src is the
    // standard escape valve for that.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    `connect-src ${connectSrc.join(' ')}`,
    "font-src 'self' data:",
    // Locks down embedded iframes (none today) and plugin objects.
    "frame-src 'none'",
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
 * in prod it's served from ``file://`` (BrowserWindow.loadFile). Any
 * other URL the renderer tries to navigate to is denied — clicking an
 * external link should go through ``setWindowOpenHandler`` /
 * ``shell.openExternal`` instead.
 */
export function isInAppNavigation(
  url: string,
  rendererBase: string | null,
): boolean {
  if (rendererBase !== null && url.startsWith(rendererBase)) return true
  // Production prod renderer loads from ``file://`` paths.
  if (url.startsWith('file://')) return true
  return false
}
