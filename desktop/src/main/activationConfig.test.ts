// Behavioural pins for the activation issuer choice (debt #3).
//
// The one rule the owner's dogfeed depends on: the DEFAULT is the mock, and the
// dev env var never leaks into a packaged build. These cases pin that
// activationBaseUrl returns null (→ mock) unless a URL is deliberately provided,
// and that createActivationRepository honours it.
//
// No Electron, no network — vitest runs it under src/main/**.

import { describe, expect, it } from 'vitest'

import {
  ACTIVATION_URL_ENV,
  activationBaseUrl,
  createActivationRepository,
  PACKAGED_ACTIVATION_URL,
} from './activationConfig'
import { HttpActivationRepository } from './httpActivationRepository'
import { MockActivationRepository } from './mockActivationRepository'

describe('activationBaseUrl', () => {
  it('DEFAULT: dev with no env var → null (use the mock)', () => {
    expect(activationBaseUrl({ env: {}, packaged: false })).toBeNull()
  })

  it('dev reads the env var and strips a trailing slash', () => {
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
})

describe('createActivationRepository', () => {
  it('DEFAULT (no URL) builds the in-memory mock — the dogfeed is unchanged', () => {
    expect(createActivationRepository({ env: {}, packaged: false })).toBeInstanceOf(MockActivationRepository)
    expect(createActivationRepository({ env: {}, packaged: true })).toBeInstanceOf(MockActivationRepository)
  })

  it('builds the HTTP client when a base URL is configured', () => {
    const repo = createActivationRepository({
      env: { [ACTIVATION_URL_ENV]: 'https://strixgeo.com/api/activation' },
      packaged: false,
    })
    expect(repo).toBeInstanceOf(HttpActivationRepository)
  })
})
