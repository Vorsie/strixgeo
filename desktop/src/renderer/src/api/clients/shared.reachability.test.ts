// The reachability signal is only as good as where it is taken from.
//
// The bug being closed is "every click failed silently for minutes". The
// near-miss version of the fix is just as bad: arm the banner on HTTP errors
// too, and a project that legitimately 409s three times tells the engineer to
// restart the app. So the seam is pinned at the transport boundary, on the real
// `request()`, with a `fetch` that rejects the way a refused connection does.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { geologyClient } from './geology'
import { request, setBaseUrl } from './shared'
import {
  CONSECUTIVE_NETWORK_FAILURES_BEFORE_UNREACHABLE as THRESHOLD,
  isBackendUnreachable,
  resetNetworkHealth,
} from '../networkHealth'

const BASE = 'http://127.0.0.1:8765'

beforeEach(() => {
  resetNetworkHealth()
  setBaseUrl(BASE)
})
afterEach(() => {
  vi.restoreAllMocks()
  resetNetworkHealth()
})

/** Swallow the rejection — these tests assert on the module state, not the throw. */
const attempt = (): Promise<unknown> => request('GET', '/x').catch(() => undefined)

describe('RE1 — a dead backend arms the condition', () => {
  it('flips to unreachable after a run of refused connections', async () => {
    // What Chromium throws for ERR_CONNECTION_REFUSED.
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))

    for (let i = 0; i < THRESHOLD; i++) await attempt()

    expect(isBackendUnreachable()).toBe(true)
  })
})

describe('RE2 — a backend that answers is never "unreachable"', () => {
  it('does not arm on HTTP errors, however many', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ detail: 'nope' }), { status: 409 }),
    )

    for (let i = 0; i < THRESHOLD + 3; i++) await attempt()

    expect(isBackendUnreachable()).toBe(false)
  })

  it('clears the condition on the first request that gets through', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new TypeError('Failed to fetch'))
    for (let i = 0; i < THRESHOLD; i++) await attempt()
    expect(isBackendUnreachable()).toBe(true)

    // The backend comes back — even a 500 proves something is listening.
    fetchMock.mockResolvedValue(new Response('{}', { status: 500 }))
    await attempt()

    expect(isBackendUnreachable()).toBe(false)
  })
})

describe('RE4 — the bare-fetch clients are on the same seam', () => {
  // Nine endpoints never went through `request()` — the litho editing gestures
  // among them (create/update contact, update/delete layer, disconnect a tie).
  // A session spent editing contacts against a dead backend could rack up
  // dozens of transport failures without the banner ever appearing.
  it('arms the condition from a bare-fetch client method', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))

    for (let i = 0; i < THRESHOLD; i++) {
      await geologyClient
        .updateContact('p1', 'm1', 'c1', { depth_top_m: 1 })
        .catch(() => undefined)
    }

    expect(isBackendUnreachable()).toBe(true)
  })

  it('clears the condition when a bare-fetch client gets an answer', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new TypeError('Failed to fetch'))
    for (let i = 0; i < THRESHOLD; i++) await attempt()
    expect(isBackendUnreachable()).toBe(true)

    fetchMock.mockResolvedValue(new Response('{}', { status: 500 }))
    await geologyClient.updateContact('p1', 'm1', 'c1', { depth_top_m: 1 }).catch(() => undefined)

    expect(isBackendUnreachable()).toBe(false)
  })
})

describe('RE3 — the app aborting its own request is not the backend dying', () => {
  it('ignores AbortError rejections', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new DOMException('The user aborted a request.', 'AbortError'),
    )

    for (let i = 0; i < THRESHOLD + 3; i++) await attempt()

    expect(isBackendUnreachable()).toBe(false)
  })
})
