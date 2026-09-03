// Behavioural pins for the activation issuer choice (debt #3, audit C3(a) + the
// HTTPS-only rule).
//
// Rules the owner's dogfeed and the beta ship depend on:
//  * the DEFAULT in DEV is the mock, and the dev env var never leaks into a
//    packaged build (unchanged);
//  * a PACKAGED build with no issuer URL does NOT fall back to the mock — the
//    mock's published demo keys would let it "activate" (audit C3(a)). It gets an
//    issuer that can activate nothing (UnreachableActivationRepository);
//  * a configured issuer URL is refused unless it is https:// — the licence key
//    is a credential in the request body. The one exception is the dev stub on
//    http://127.0.0.1 / http://localhost, and only when NOT packaged.
//
// No Electron, no network — vitest runs it under src/main/**.

import { describe, expect, it } from 'vitest'

import {
  ACTIVATION_URL_ENV,
  activationBaseUrl,
  createActivationRepository,
  PACKAGED_ACTIVATION_URL,
  sanitizeIssuerUrl,
} from './activationConfig'
import { HttpActivationRepository } from './httpActivationRepository'
import { MockActivationRepository } from './mockActivationRepository'
import { UnreachableActivationRepository } from './unreachableActivationRepository'

describe('activationBaseUrl', () => {
  it('DEFAULT: dev with no env var → null (use the mock)', () => {
    expect(activationBaseUrl({ env: {}, packaged: false })).toBeNull()
  })

  it('dev reads an https env var and strips a trailing slash', () => {
    expect(
      activationBaseUrl({ env: { [ACTIVATION_URL_ENV]: 'https://strixgeo.com/api/activation/' }, packaged: false }),
    ).toBe('https://strixgeo.com/api/activation')
  })

  it('a blank env var is treated as unset', () => {
    expect(activationBaseUrl({ env: { [ACTIVATION_URL_ENV]: '   ' }, packaged: false })).toBeNull()
  })

  it('packaged ignores the dev env var and uses the packaged constant', () => {
    // The constant is null today (no server), so a packaged build falls back to
    // the mock even if the env var is set — the env var cannot leak into it.
    expect(PACKAGED_ACTIVATION_URL).toBeNull()
    expect(
      activationBaseUrl({ env: { [ACTIVATION_URL_ENV]: 'https://leak.test' }, packaged: true }),
    ).toBeNull()
  })

  // HTTPS-only, through the resolver: a dev http:// URL to a NON-loopback host is
  // refused (returns null → no issuer), so a credential never travels in the clear.
  it('refuses a plain-http env URL to a non-loopback host', () => {
    expect(
      activationBaseUrl({ env: { [ACTIVATION_URL_ENV]: 'http://evil.example/api' }, packaged: false }),
    ).toBeNull()
  })

  it('allows the dev stub over http on loopback (dev only)', () => {
    expect(activationBaseUrl({ env: { [ACTIVATION_URL_ENV]: 'http://127.0.0.1:8799' }, packaged: false })).toBe(
      'http://127.0.0.1:8799',
    )
    expect(activationBaseUrl({ env: { [ACTIVATION_URL_ENV]: 'http://localhost:8799' }, packaged: false })).toBe(
      'http://localhost:8799',
    )
  })
})

describe('sanitizeIssuerUrl (HTTPS-only scheme rule)', () => {
  it('accepts https for both dev and packaged', () => {
    expect(sanitizeIssuerUrl('https://strixgeo.com/api', true)).toBe('https://strixgeo.com/api')
    expect(sanitizeIssuerUrl('https://strixgeo.com/api', false)).toBe('https://strixgeo.com/api')
  })

  it('refuses plain http in a packaged build — even on loopback', () => {
    expect(sanitizeIssuerUrl('http://strixgeo.com/api', true)).toBeNull()
    expect(sanitizeIssuerUrl('http://127.0.0.1:8799', true)).toBeNull()
  })

  it('allows the dev loopback stub, refuses any other dev http host', () => {
    expect(sanitizeIssuerUrl('http://127.0.0.1:8799', false)).toBe('http://127.0.0.1:8799')
    expect(sanitizeIssuerUrl('http://localhost:8799', false)).toBe('http://localhost:8799')
    expect(sanitizeIssuerUrl('http://evil.example', false)).toBeNull()
  })

  it('empty or missing is null', () => {
    expect(sanitizeIssuerUrl(null, false)).toBeNull()
    expect(sanitizeIssuerUrl('   ', true)).toBeNull()
  })
})

describe('createActivationRepository', () => {
  it('DEV with no URL builds the in-memory mock — the dogfeed is unchanged', () => {
    expect(createActivationRepository({ env: {}, packaged: false })).toBeInstanceOf(MockActivationRepository)
  })

  // audit C3(a): a packaged build with no server must NOT get the mock (its demo
  // keys would activate it) — it gets an issuer that can activate nothing.
  it('PACKAGED with no URL builds the unreachable issuer, never the mock', () => {
    const repo = createActivationRepository({ env: {}, packaged: true })
    expect(repo).toBeInstanceOf(UnreachableActivationRepository)
    expect(repo).not.toBeInstanceOf(MockActivationRepository)
  })

  it('builds the HTTP client when an https base URL is configured', () => {
    const repo = createActivationRepository({
      env: { [ACTIVATION_URL_ENV]: 'https://strixgeo.com/api/activation' },
      packaged: false,
    })
    expect(repo).toBeInstanceOf(HttpActivationRepository)
  })
})
