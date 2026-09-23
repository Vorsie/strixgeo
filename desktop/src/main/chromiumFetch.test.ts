// The activation client and the diagnostics uploader must reach strixgeo.com
// through Chromium's network stack, not Node's: a company proxy and TLS
// inspection let the browser reach https://strixgeo.com/api/activation while
// the app reported it unreachable (owner's work PC and a coworker's,
// 2026-09-23). Chromium applies the Windows proxy settings and trusts the OS
// certificate store; Node's global fetch does neither.
//
// No Electron import: the adapter takes the ``net`` module as a parameter so it
// stays a pure src/main helper.
import { describe, expect, it, vi } from 'vitest'

import { chromiumFetch } from './chromiumFetch'

describe('chromiumFetch — main-process HTTP goes through Electron net', () => {
  it('N1 — forwards the URL and the request init to net.fetch and returns its response', async () => {
    const response = new Response('{"ok":true}', { status: 200 })
    const netFetch = vi.fn().mockResolvedValue(response)
    const fetchImpl = chromiumFetch({ fetch: netFetch })
    const init = { method: 'POST', body: '{}', headers: { accept: 'application/json' } }
    const got = await fetchImpl('https://strixgeo.com/api/activation/activate', init)
    expect(got).toBe(response)
    expect(netFetch).toHaveBeenCalledTimes(1)
    expect(netFetch).toHaveBeenCalledWith('https://strixgeo.com/api/activation/activate', init)
  })

  it('N2 — never touches the global fetch', async () => {
    const globalSpy = vi.fn()
    const saved = globalThis.fetch
    globalThis.fetch = globalSpy as unknown as typeof fetch
    try {
      const netFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
      await chromiumFetch({ fetch: netFetch })('https://strixgeo.com/api/activation/refresh')
      expect(globalSpy).not.toHaveBeenCalled()
      expect(netFetch).toHaveBeenCalledTimes(1)
    } finally {
      globalThis.fetch = saved
    }
  })

  it('N3 — binds lazily: net.fetch is read at call time, so it may become available after app ready', async () => {
    const net: { fetch: (input: string, init?: RequestInit) => Promise<Response> } = {
      fetch: () => Promise.reject(new Error('not ready')),
    }
    const fetchImpl = chromiumFetch(net)
    net.fetch = vi.fn().mockResolvedValue(new Response('', { status: 200 }))
    const got = await fetchImpl('https://strixgeo.com/api/activation/trial')
    expect(got.status).toBe(200)
  })
})
