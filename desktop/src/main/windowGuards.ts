/**
 * Navigation / window-open guards shared by every BrowserWindow (Electron main
 * process). Debt #200 / audit M6.
 *
 * The main window has always denied renderer-issued ``window.open`` (handing a
 * trusted URL to the OS browser instead) and pinned ``will-navigate`` to the
 * renderer's own origin. The hidden sheet-PDF window (``sheetPdf.ts``) renders
 * ``.strix`` content and had NEITHER guard — so both windows now attach the SAME
 * pair through this one helper, and there is a single place to reason about it.
 *
 * The decision halves (``decideExternalOpen`` / ``isInAppNavigation``) live in
 * {@link ./security} and are already unit-tested; this module is only the wiring
 * that attaches them to a webContents, kept Electron-free (it takes the two
 * methods it needs structurally + an injected ``openExternal``) so vitest
 * exercises it with a fake webContents.
 */

import { decideExternalOpen, isInAppNavigation } from './security'

/** Where in-app navigation is allowed to, and how a trusted link leaves the app. */
export interface NavigationGuardConfig {
  /** The dev renderer origin (Vite), or ``null`` in a packaged build. */
  rendererBase: string | null
  /** The packaged renderer directory ``file://`` prefix, or ``null`` in dev. */
  rendererFileBase: string | null
  /** Hand a trusted (http/https/mailto) URL to the OS browser — ``shell.openExternal``. */
  openExternal: (url: string) => void
}

/**
 * The minimal slice of Electron's ``WebContents`` these guards attach to — just
 * enough that a fake satisfies it in tests, and a real ``WebContents`` is
 * assignable to it.
 */
export interface GuardableWebContents {
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' }): void
  on(event: 'will-navigate', listener: (event: { preventDefault: () => void }, url: string) => void): unknown
}

/**
 * Attach the deny-by-default window-open handler and the in-app navigation pin.
 *
 * Parameters
 * ----------
 * webContents : GuardableWebContents
 *     The window's ``webContents``.
 * config : NavigationGuardConfig
 *     The in-app bases and the ``openExternal`` sink.
 */
export function applyWindowGuards(webContents: GuardableWebContents, config: NavigationGuardConfig): void {
  // Deny every renderer-issued window.open. A trusted URL is handed to the OS
  // browser; an Electron BrowserWindow (same preload + IPC surface) is never
  // opened from renderer content.
  webContents.setWindowOpenHandler(({ url }) => {
    if (decideExternalOpen(url).external) config.openExternal(url)
    return { action: 'deny' }
  })

  // Pin top-level navigation to the renderer's own origin. Anything else —
  // a link in user-supplied content — is cancelled; if it looks like an external
  // link the user meant to follow, it is handed to the OS browser instead.
  webContents.on('will-navigate', (event, url) => {
    if (!isInAppNavigation(url, config.rendererBase, config.rendererFileBase)) {
      event.preventDefault()
      if (decideExternalOpen(url).external) config.openExternal(url)
    }
  })
}
