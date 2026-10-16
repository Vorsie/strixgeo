// Where consented diagnostics go. Open source 2026-10-17: there is no
// licence server, so the endpoint is a plain setting with no default; unset
// means nothing is ever transmitted.
import { describe, expect, it } from 'vitest'

import { diagnosticsBaseUrl } from './diagnosticsEndpoint'

describe('diagnostics endpoint (open source: a plain setting with no default)', () => {
  it('is null when STRIXGEO_DIAGNOSTICS_URL is unset', () => {
    expect(diagnosticsBaseUrl({})).toBeNull()
  })
  it('is null when STRIXGEO_DIAGNOSTICS_URL is blank', () => {
    expect(diagnosticsBaseUrl({ STRIXGEO_DIAGNOSTICS_URL: '   ' })).toBeNull()
  })
  it('is the trimmed env value when set', () => {
    expect(diagnosticsBaseUrl({ STRIXGEO_DIAGNOSTICS_URL: 'https://example.org/api/' })).toBe(
      'https://example.org/api',
    )
  })
})
