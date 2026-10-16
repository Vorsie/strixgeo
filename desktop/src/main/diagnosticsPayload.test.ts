// L3 — a diagnostics bundle must carry a collision-free id.
//
// The old default was ``${createdAt}-${appVersion}``: two bundles assembled in
// the same millisecond on the same build (a crash storm; a batch flush) would
// share an id, so server-side dedup and a support thread could not tell them
// apart. The rule: the default id is a random UUID.

import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildDiagnosticsPayload, diagnosticsIdentityFor } from './diagnosticsPayload'

// The device-id gate is a module constant; a hoisted switch lets one case turn
// it on without touching the shipped value (asserted separately below).
const deviceIdGate = vi.hoisted(() => ({ on: false }))
vi.mock('./diagnosticsUploaderConstants', async importOriginal => {
  const actual = await importOriginal<typeof import('./diagnosticsUploaderConstants')>()
  return {
    ...actual,
    get ATTACH_DEVICE_ID_TO_DIAGNOSTICS() {
      return deviceIdGate.on
    },
  }
})

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

// The capture design's shipped invariant is "no device id": with the gate off a
// bundle carries no identity AND the device id is never even read (reading it
// shells out to the Windows registry). With the gate on, the id is read once
// and an unknown id still attaches nothing.
describe('diagnosticsIdentityFor (device id gate)', () => {
  afterEach(() => {
    deviceIdGate.on = false
  })

  it('P4: the shipped gate is off, so no identity and the id is never read', async () => {
    const shipped = await vi.importActual<typeof import('./diagnosticsUploaderConstants')>(
      './diagnosticsUploaderConstants',
    )
    expect(shipped.ATTACH_DEVICE_ID_TO_DIAGNOSTICS).toBe(false)

    const readDeviceId = vi.fn(() => 'device-1')
    expect(diagnosticsIdentityFor(readDeviceId)).toBeUndefined()
    expect(readDeviceId).toHaveBeenCalledTimes(0)
  })

  it('P5: with the gate on the id is read once, and an unknown id attaches nothing', () => {
    deviceIdGate.on = true

    const unknown = vi.fn(() => null)
    expect(diagnosticsIdentityFor(unknown)).toBeUndefined()
    expect(unknown).toHaveBeenCalledTimes(1)

    const known = vi.fn(() => 'device-1')
    expect(diagnosticsIdentityFor(known)).toEqual({ deviceId: 'device-1' })
    expect(known).toHaveBeenCalledTimes(1)
  })
})
