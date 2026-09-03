// H3(b) — a packaged build never adopts a FOREIGN backend on :8765.
//
// The readiness probe used to accept ANY listener on the port. That is right in
// dev/e2e (a hand-started backend the harness owns), but in a packaged build an
// orphaned uvicorn from a crashed previous main process still holds :8765 with a
// DIFFERENT launch token — and adopting it means every real request 403s.
//
// The fix: when packaged, the probe carries THIS launch's token AND an
// ``Origin: null`` (the only case LocalClientTokenMiddleware guards). Our own
// backend accepts it (same token); a foreign backend answers 403 (wrong token),
// which we read as "not ours" and refuse.

import { describe, expect, it } from 'vitest'

import { LOCAL_CLIENT_TOKEN_HEADER } from './localClientToken'
import { backendProbeHeaders, classifyBackendProbe } from './backendProbe'

describe('backendProbeHeaders', () => {
  it('packaged: carries Origin: null and this launch token so a wrong-token backend 403s', () => {
    const headers = backendProbeHeaders(true, 'deadbeef')
    // Origin: null is the ONLY request shape the middleware guards, so the token
    // must ride with it or the probe is never checked.
    expect(headers['Origin']).toBe('null')
    expect(headers[LOCAL_CLIENT_TOKEN_HEADER]).toBe('deadbeef')
  })

  it('dev/e2e: sends no token so any hand-started backend on the port is adopted', () => {
    expect(backendProbeHeaders(false, 'deadbeef')).toEqual({})
  })
})

describe('classifyBackendProbe', () => {
  it('a 2xx is reachable in both modes', () => {
    expect(classifyBackendProbe(true, 200)).toBe('reachable')
    expect(classifyBackendProbe(false, 200)).toBe('reachable')
  })

  it('a packaged 403 is a FOREIGN backend — never adopted', () => {
    expect(classifyBackendProbe(true, 403)).toBe('foreign')
  })

  it('a 403 in dev is just unreachable (no token guard active there)', () => {
    // A hand-started dev backend has no token configured, so it never 403s the
    // probe; if some other service did, treating it as "not ready" is correct.
    expect(classifyBackendProbe(false, 403)).toBe('unreachable')
  })

  it('any other non-2xx is unreachable', () => {
    expect(classifyBackendProbe(true, 500)).toBe('unreachable')
    expect(classifyBackendProbe(true, 404)).toBe('unreachable')
    expect(classifyBackendProbe(false, 503)).toBe('unreachable')
  })
})
