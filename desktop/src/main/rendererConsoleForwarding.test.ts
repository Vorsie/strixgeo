// Owner ask 2026-08-02: "make the renderer's logs show up in my terminal so a
// paste carries both halves". The two ways to get that wrong are forwarding
// DevTools' own output (which turns opening DevTools into a feedback loop) and
// double-tagging lines that already identify themselves.

import { describe, expect, it } from 'vitest'

import {
  consoleMethodForLevel,
  formatRendererMessage,
  shouldForwardRendererMessage,
  type RendererConsoleMessage,
} from './rendererConsoleForwarding'

function message(overrides: Partial<RendererConsoleMessage> = {}): RendererConsoleMessage {
  return {
    level: 'info',
    message: 'hello',
    sourceId: 'http://localhost:5173/src/renderer/src/App.tsx',
    lineNumber: 12,
    ...overrides,
  }
}

describe('RC1 — what gets forwarded', () => {
  it('forwards messages the app logged', () => {
    expect(shouldForwardRendererMessage(message())).toBe(true)
  })

  it('drops DevTools output so opening DevTools does not echo itself', () => {
    expect(
      shouldForwardRendererMessage(message({ sourceId: 'devtools://devtools/bundled/x.js' })),
    ).toBe(false)
  })

  it('drops extension output', () => {
    expect(
      shouldForwardRendererMessage(message({ sourceId: 'chrome-extension://abc/inject.js' })),
    ).toBe(false)
  })

  it('drops blank lines', () => {
    expect(shouldForwardRendererMessage(message({ message: '   ' }))).toBe(false)
  })
})

describe('RC2 — how it reads in the terminal', () => {
  it('leaves an already-tagged log-wrapper line alone', () => {
    const line = '[ui 17:59:57.093 ERROR api] POST /projects/p/build 422'
    expect(formatRendererMessage(message({ message: line }))).toBe(line)
  })

  it('tags anything else so its origin is unambiguous next to [main] and [api]', () => {
    expect(formatRendererMessage(message({ message: 'Warning: validateDOMNesting' }))).toBe(
      '[ui] Warning: validateDOMNesting',
    )
  })
})

describe('RC3 — severity survives the hop', () => {
  it('maps Electron levels onto console methods', () => {
    expect(consoleMethodForLevel('error')).toBe('error')
    expect(consoleMethodForLevel('warning')).toBe('warn')
    expect(consoleMethodForLevel('info')).toBe('log')
    expect(consoleMethodForLevel('debug')).toBe('log')
  })
})

// Demoting one per-render line to `trace` while mirroring the ENTIRE renderer
// debug stream into the same terminal trades one flood for another: `log.debug`
// is used heavily (`[api.updateContact] ←` fires on every contact edit, the
// geology/section clients log per call). So debug is opt-in, mirroring the
// renderer-side `strix.log.trace` switch; info/warning/error always come
// through, because those are what a pasted bug report needs.
describe('RC4 — a level floor, so the fix is not a new flood', () => {
  const withoutOptIn = { STRIX_FORWARD_RENDERER_DEBUG: undefined }
  const withOptIn = { STRIX_FORWARD_RENDERER_DEBUG: '1' }

  it('always forwards info, warning and error', () => {
    for (const level of ['info', 'warning', 'error'] as const) {
      expect(shouldForwardRendererMessage(message({ level }), withoutOptIn)).toBe(true)
    }
  })

  it('drops debug by default', () => {
    expect(shouldForwardRendererMessage(message({ level: 'debug' }), withoutOptIn)).toBe(false)
  })

  it('forwards debug behind STRIX_FORWARD_RENDERER_DEBUG=1', () => {
    expect(shouldForwardRendererMessage(message({ level: 'debug' }), withOptIn)).toBe(true)
  })

  it('still drops DevTools debug output even with the opt-in on', () => {
    expect(
      shouldForwardRendererMessage(
        message({ level: 'debug', sourceId: 'devtools://devtools/bundled/x.js' }),
        withOptIn,
      ),
    ).toBe(false)
  })
})
