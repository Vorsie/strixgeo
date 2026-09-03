// Behavioural pins for the shared window guards (debt #200 / audit M6).
//
// The rule both windows now enforce through one helper: a renderer NEVER opens
// an Electron BrowserWindow (window.open is denied), a TRUSTED url is handed to
// the OS browser instead, and top-level navigation is pinned to the renderer's
// own origin — an off-origin will-navigate is cancelled, and if it is a real
// external link it is handed off, not followed in-window.
//
// A fake webContents captures the handlers so vitest invokes them with no
// Electron (the module takes only the two methods it needs + an injected
// openExternal). The decision halves are pinned in security.test.ts.

import { describe, expect, it } from 'vitest'

import { applyWindowGuards, type GuardableWebContents } from './windowGuards'

/** A fake webContents that records the two handlers applyWindowGuards attaches. */
function fakeWebContents(): {
  wc: GuardableWebContents
  openWindow: (url: string) => { action: 'deny' }
  navigateTo: (url: string) => { prevented: boolean }
} {
  let openHandler: ((d: { url: string }) => { action: 'deny' }) | null = null
  let navListener: ((e: { preventDefault: () => void }, url: string) => void) | null = null
  const wc: GuardableWebContents = {
    setWindowOpenHandler(handler) {
      openHandler = handler
    },
    on(_event, listener) {
      navListener = listener
      return wc
    },
  }
  return {
    wc,
    openWindow: url => openHandler!({ url }),
    navigateTo: url => {
      let prevented = false
      navListener!({ preventDefault: () => (prevented = true) }, url)
      return { prevented }
    },
  }
}

const DEV_BASE = 'http://localhost:5173'

describe('applyWindowGuards', () => {
  it('denies every renderer window.open, and hands a trusted https URL to the OS browser', () => {
    const opened: string[] = []
    const fake = fakeWebContents()
    applyWindowGuards(fake.wc, { rendererBase: DEV_BASE, rendererFileBase: null, openExternal: u => opened.push(u) })

    expect(fake.openWindow('https://strixgeo.com').action).toBe('deny')
    expect(opened).toEqual(['https://strixgeo.com'])
  })

  it('denies window.open to a file:// URL WITHOUT handing it to the OS', () => {
    const opened: string[] = []
    const fake = fakeWebContents()
    applyWindowGuards(fake.wc, { rendererBase: DEV_BASE, rendererFileBase: null, openExternal: u => opened.push(u) })

    expect(fake.openWindow('file:///C:/Windows/system32/calc.exe').action).toBe('deny')
    expect(opened).toEqual([])
  })

  it('allows in-app navigation (same dev origin)', () => {
    const opened: string[] = []
    const fake = fakeWebContents()
    applyWindowGuards(fake.wc, { rendererBase: DEV_BASE, rendererFileBase: null, openExternal: u => opened.push(u) })

    expect(fake.navigateTo(`${DEV_BASE}/index.html`).prevented).toBe(false)
    expect(opened).toEqual([])
  })

  it('cancels an off-origin navigation and hands an external link to the OS browser', () => {
    const opened: string[] = []
    const fake = fakeWebContents()
    applyWindowGuards(fake.wc, { rendererBase: DEV_BASE, rendererFileBase: null, openExternal: u => opened.push(u) })

    expect(fake.navigateTo('https://evil.example/phish').prevented).toBe(true)
    expect(opened).toEqual(['https://evil.example/phish'])
  })

  it('cancels an off-origin file:// navigation and does NOT hand it to the OS', () => {
    const opened: string[] = []
    const fake = fakeWebContents()
    applyWindowGuards(fake.wc, { rendererBase: DEV_BASE, rendererFileBase: null, openExternal: u => opened.push(u) })

    expect(fake.navigateTo('file:///C:/secret.txt').prevented).toBe(true)
    expect(opened).toEqual([])
  })
})
