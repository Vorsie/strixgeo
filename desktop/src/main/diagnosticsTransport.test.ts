/**
 * Transmission is a stub with two independent locks.
 *
 * Lock one: the user said yes. Lock two: an endpoint exists at all. Tonight
 * neither can be satisfied in a shipped build — there IS no endpoint, by
 * design; choosing one is a commercial decision, not an engineering one. These
 * cases pin the gates so that whoever wires the endpoint later cannot
 * accidentally bypass consent while doing it.
 */

import { describe, expect, it, vi } from 'vitest'

import {
  NO_ENDPOINT_TRANSPORT,
  transmitDiagnostics,
  type CrashBundleEnvelope,
  type DiagnosticsTransport,
} from './diagnosticsTransport'

const ENVELOPE: CrashBundleEnvelope = {
  bundleId: 'b1',
  createdAt: '2026-08-26T12:00:00.000Z',
  appVersion: '0.1.0',
  platform: 'win32',
  events: [],
}

describe('nothing leaves the machine without consent', () => {
  it('T1 — with consent withheld the transport is never even called', async () => {
    const send = vi.fn()
    const transport: DiagnosticsTransport = { name: 'test', send }

    const outcome = await transmitDiagnostics(ENVELOPE, { consent: false, transport })

    expect(send).not.toHaveBeenCalled()
    expect(outcome.sent).toBe(false)
    expect(outcome.reason).toMatch(/consent/i)
  })

  it('T2 — with consent given but no endpoint configured, nothing is sent', async () => {
    const outcome = await transmitDiagnostics(ENVELOPE, { consent: true })

    expect(outcome.sent).toBe(false)
    expect(outcome.reason).toMatch(/endpoint/i)
  })

  it('T3 — the shipped transport refuses whatever it is handed', async () => {
    const outcome = await NO_ENDPOINT_TRANSPORT.send(ENVELOPE)

    expect(outcome.sent).toBe(false)
  })
})

describe('when an endpoint does exist', () => {
  it('T4 — with consent given the envelope reaches the transport unchanged', async () => {
    const send = vi.fn().mockResolvedValue({ sent: true, reason: 'accepted' })
    const transport: DiagnosticsTransport = { name: 'test', send }

    const outcome = await transmitDiagnostics(ENVELOPE, { consent: true, transport })

    expect(send).toHaveBeenCalledWith(ENVELOPE)
    expect(outcome.sent).toBe(true)
  })

  it('T5 — a transport that fails does not become an app crash', async () => {
    const transport: DiagnosticsTransport = {
      name: 'broken',
      send: () => Promise.reject(new Error('network down')),
    }

    const outcome = await transmitDiagnostics(ENVELOPE, { consent: true, transport })

    expect(outcome.sent).toBe(false)
    expect(outcome.reason).toMatch(/network down/)
  })
})
