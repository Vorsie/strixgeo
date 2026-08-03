// Rules for the per-launch token that proves a request came from our window.
//
// The backend keeps ``Origin: null`` in its CORS allowlist because the packaged
// renderer runs from file://. Any sandboxed iframe on the web sends that same
// origin, so the origin cannot be the identity — the token is.

import { describe, expect, it } from 'vitest'

import {
  LOCAL_CLIENT_TOKEN_ENV_VAR,
  LOCAL_CLIENT_TOKEN_HEADER,
  createTokenInjectionAudit,
  localApiRequestFilter,
  mintLocalClientToken,
} from './localClientToken'

describe('mintLocalClientToken', () => {
  it('mints a different token every launch', () => {
    // A token reused across launches is one that survives leaking into a log.
    expect(mintLocalClientToken()).not.toBe(mintLocalClientToken())
  })

  it('mints something long enough not to be guessed by a page hammering loopback', () => {
    const token = mintLocalClientToken()
    expect(token).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('localApiRequestFilter', () => {
  it('scopes the header to the local API and nothing else the renderer loads', () => {
    const { urls } = localApiRequestFilter('http://127.0.0.1:8765')
    expect(urls).toContain('http://127.0.0.1:8765/*')
    for (const pattern of urls) expect(pattern.startsWith('http://127.0.0.1')).toBe(true)
  })

  it('also matches the API host without its port', () => {
    // Chromium's match-pattern grammar has historically rejected a port in the
    // host, and a filter that matches nothing would strip the token from every
    // request — the packaged app would then be unable to reach its own backend
    // with nothing logged on the main side.
    expect(localApiRequestFilter('http://127.0.0.1:8765').urls).toContain('http://127.0.0.1/*')
  })
})

describe('the contract with the backend', () => {
  // These two strings are duplicated in
  // src/groundmodel/api/local_client_token_constants.py — the two processes
  // agree on them or the app cannot talk to its own backend. Nothing else in
  // the build would notice a rename, so pin them here.
  it('names the environment variable the uvicorn child reads', () => {
    expect(LOCAL_CLIENT_TOKEN_ENV_VAR).toBe('STRIX_API_TOKEN')
  })

  it('names the header the token travels in', () => {
    expect(LOCAL_CLIENT_TOKEN_HEADER).toBe('X-StrixGeo-Token')
  })
})

describe('a filter that matches nothing must announce itself', () => {
  // The failure this guards is silent by construction: if the URL filter matches
  // no request, the token is never attached, the backend 403s everything, and the
  // engineer sees "failed to fetch" with the reason only in a backend log he
  // cannot see in a packaged build. The absence of a log line is not a signal —
  // so the audit turns it into one.

  it('says nothing while the token is being attached', () => {
    const errors: string[] = []
    const audit = createTokenInjectionAudit(['http://127.0.0.1:8765/*'], {
      error: m => errors.push(m),
    })
    audit.noteInjection('http://127.0.0.1:8765/projects')

    audit.reportIfSilent()

    expect(errors).toEqual([])
  })

  it('reports an error naming the filter patterns when nothing was ever attached', () => {
    const errors: string[] = []
    const audit = createTokenInjectionAudit(
      ['http://127.0.0.1:8765/*', 'http://127.0.0.1/*'],
      { error: m => errors.push(m) },
    )

    audit.reportIfSilent()

    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('http://127.0.0.1:8765/*')
    expect(errors[0]).toContain('http://127.0.0.1/*')
  })

  it('reports once, not once per check', () => {
    // The renderer reloads (dev HMR, the ErrorBoundary's Reload button); a
    // repeated alarm for one condition trains the engineer to ignore it.
    const errors: string[] = []
    const audit = createTokenInjectionAudit(['http://127.0.0.1:8765/*'], {
      error: m => errors.push(m),
    })

    audit.reportIfSilent()
    audit.reportIfSilent()

    expect(errors).toHaveLength(1)
  })
})
