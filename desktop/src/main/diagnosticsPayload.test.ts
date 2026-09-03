// L3 — a diagnostics bundle must carry a collision-free id.
//
// The old default was ``${createdAt}-${appVersion}``: two bundles assembled in
// the same millisecond on the same build (a crash storm; a batch flush) would
// share an id, so server-side dedup and a support thread could not tell them
// apart. The rule: the default id is a random UUID.

import { describe, expect, it } from 'vitest'

import { buildDiagnosticsPayload } from './diagnosticsPayload'

const facts = { appVersion: '0.1.0', platform: 'win32' }
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

describe('bundleId (L3)', () => {
  it('P1 — two bundles built in the same millisecond get distinct ids', () => {
    const t = 1_700_000_000_000
    const a = buildDiagnosticsPayload({ ndjson: '{"a":1}', facts, createdAt: t })
    const b = buildDiagnosticsPayload({ ndjson: '{"a":1}', facts, createdAt: t })
    expect(a.payload.bundleId).not.toBe(b.payload.bundleId)
  })

  it('P2 — the default id is a UUID, not timestamp+version', () => {
    const p = buildDiagnosticsPayload({ ndjson: '{}', facts, createdAt: 1 })
    expect(p.payload.bundleId).toMatch(UUID_RE)
    expect(p.payload.bundleId).not.toBe('1-0.1.0')
  })

  it('P3 — an explicit bundleId override is still honoured', () => {
    const p = buildDiagnosticsPayload({ ndjson: '{}', facts, createdAt: 1, bundleId: 'fixed-id' })
    expect(p.payload.bundleId).toBe('fixed-id')
  })

  it('P4 — a trimmed (truncated) bundle still carries one UUID', () => {
    const big = Array.from({ length: 80 }, (_, i) => `{"n":${i}}`).join('\n')
    const p = buildDiagnosticsPayload({ ndjson: big, facts, createdAt: 1, maxBytes: 140 })
    expect(p.truncated).toBe(true)
    expect(p.payload.bundleId).toMatch(UUID_RE)
  })
})
