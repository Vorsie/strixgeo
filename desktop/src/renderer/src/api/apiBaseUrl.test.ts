// Tester finding 2026-10-12: the packaged engine may listen on a port other
// than 8765, chosen by main at boot. The renderer learns the API base from main
// (``window.electron.getApiBaseUrl``); when that bridge is missing, fails or
// answers nonsense (a dev browser, an old preload), it falls back to the dev
// default http://127.0.0.1:8765.

import { afterEach, describe, expect, it } from 'vitest'

import { resolveApiBaseUrl } from './apiBaseUrl'
import { DEFAULT_API_BASE_URL, getBaseUrl, setBaseUrl } from './clients/shared'

describe('resolveApiBaseUrl - learn the engine origin from main, else 8765', () => {
  it('AB1 - the dev default is http://127.0.0.1:8765', () => {
    expect(DEFAULT_API_BASE_URL).toBe('http://127.0.0.1:8765')
  })

  it('AB2 - uses the base main reports', async () => {
    const bridge = { getApiBaseUrl: async () => 'http://127.0.0.1:8767' }
    expect(await resolveApiBaseUrl(bridge)).toBe('http://127.0.0.1:8767')
  })

  it('AB3 - no bridge, or a bridge without the getter: the default', async () => {
    expect(await resolveApiBaseUrl(undefined)).toBe(DEFAULT_API_BASE_URL)
    expect(await resolveApiBaseUrl({})).toBe(DEFAULT_API_BASE_URL)
  })

  it('AB4 - a getter that rejects or answers a non-URL: the default', async () => {
    expect(await resolveApiBaseUrl({ getApiBaseUrl: async () => Promise.reject(new Error('x')) })).toBe(
      DEFAULT_API_BASE_URL,
    )
    expect(await resolveApiBaseUrl({ getApiBaseUrl: async () => '' })).toBe(DEFAULT_API_BASE_URL)
    expect(
      await resolveApiBaseUrl({ getApiBaseUrl: async () => 42 as unknown as string }),
    ).toBe(DEFAULT_API_BASE_URL)
    expect(await resolveApiBaseUrl({ getApiBaseUrl: async () => 'not a url' })).toBe(
      DEFAULT_API_BASE_URL,
    )
  })
})

describe('getBaseUrl - every client reads the base at call time', () => {
  afterEach(() => setBaseUrl(DEFAULT_API_BASE_URL))

  it('AB5 - reflects setBaseUrl', () => {
    setBaseUrl('http://127.0.0.1:8767')
    expect(getBaseUrl()).toBe('http://127.0.0.1:8767')
  })
})
