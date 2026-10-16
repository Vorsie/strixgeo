/**
 * The transmit half of diagnostics — consent-gated, disk-queued, retried.
 *
 * The rules these cases encode (debt #16, owner ruling 2026-08-31 "diagnostics
 * go to the same server"):
 *
 * * nothing is requested and nothing is queued while consent is off;
 * * a bundle the server accepts (2xx) is removed; a bundle it refuses (4xx) is
 *   dropped with a warning; a 5xx or a dead link keeps the bundle and retries it
 *   after a backoff;
 * * the payload is trimmed (newest records kept) to fit the size cap; and
 * * the on-disk queue never grows past its bound — the oldest is evicted.
 *
 * fetch and the clock are injected, so no network and no Electron — vitest runs
 * it under src/main/**.
 */

import { existsSync, mkdtempSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildDiagnosticsPayload, type DiagnosticsPayload } from './diagnosticsPayload'
import { DiagnosticsUploader, type DiagnosticsUploaderConfig } from './diagnosticsUploader'
import type { DiagnosticEvent } from './diagnosticsEvent'
import {
  DIAGNOSTICS_HIGHWATER_FILENAME,
  DIAGNOSTICS_RETRY_BASE_MS,
} from './diagnosticsUploaderConstants'

const BASE_URL = 'https://example.test/api'
const FACTS = { appVersion: '0.1.0', platform: 'win32' }

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'strix-uploader-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** The queued bundle files (excluding the high-water marker). */
function queueFiles(): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter(
    name => name.endsWith('.json') && name !== DIAGNOSTICS_HIGHWATER_FILENAME,
  )
}

/** A well-formed payload, one field overridable. */
function payload(overrides: Partial<DiagnosticsPayload> = {}): DiagnosticsPayload {
  return {
    bundleId: 'b1',
    createdAt: 1000,
    appVersion: '0.1.0',
    platform: 'win32',
    events: 1,
    truncated: false,
    ndjson: '{"kind":"api-error"}',
    ...overrides,
  }
}

/** A fetch that resolves to the given status + JSON body. */
function fetchReturning(status: number, body: unknown = {}): typeof fetch {
  return (async () => ({ status, json: async () => body })) as unknown as typeof fetch
}

/** A fetch that throws — a DNS / connection failure. */
function fetchThrowing(): typeof fetch {
  return (async () => {
    throw new Error('ECONNREFUSED')
  }) as unknown as typeof fetch
}

/** An uploader over the temp dir, with consent on and a base URL unless overridden. */
function makeUploader(overrides: Partial<DiagnosticsUploaderConfig> = {}): DiagnosticsUploader {
  return new DiagnosticsUploader({
    queueDir: dir,
    baseUrl: BASE_URL,
    consent: () => true,
    onLog: () => {},
    ...overrides,
  })
}

describe('nothing leaves the machine without consent', () => {
  it('U1 — consent off: no request is made and no file is queued', async () => {
    const fetchSpy = vi.fn(fetchReturning(200) as (...args: unknown[]) => unknown)
    const uploader = makeUploader({
      consent: () => false,
      fetchImpl: fetchSpy as unknown as typeof fetch,
    })

    uploader.enqueue(payload())
    const summary = await uploader.drainOnce()

    expect(queueFiles()).toHaveLength(0)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(summary.sent).toBe(0)
  })

  it('U2 — consent off: enqueueRecentDiagnostics queues nothing and returns false', () => {
    const uploader = makeUploader({ consent: () => false })

    const enqueued = uploader.enqueueRecentDiagnostics(events(2), { facts: FACTS })

    expect(enqueued).toBe(false)
    expect(queueFiles()).toHaveLength(0)
  })

  it('U3 — no endpoint configured: the uploader is inert even with consent on', async () => {
    const fetchSpy = vi.fn(fetchReturning(200) as (...args: unknown[]) => unknown)
    const uploader = makeUploader({ baseUrl: null, fetchImpl: fetchSpy as unknown as typeof fetch })

    uploader.enqueue(payload())
    await uploader.drainOnce()

    expect(queueFiles()).toHaveLength(0)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('a drain resolves each bundle by the server answer', () => {
  it('U4 — a 2xx removes the bundle', async () => {
    const uploader = makeUploader({ fetchImpl: fetchReturning(200, { received: true, id: 'srv-1' }) })
    uploader.enqueue(payload())
    expect(queueFiles()).toHaveLength(1)

    const summary = await uploader.drainOnce()

    expect(summary.sent).toBe(1)
    expect(queueFiles()).toHaveLength(0)
  })

  it('U5 — a 4xx drops the bundle and logs a warning', async () => {
    const warnings: string[] = []
    const uploader = makeUploader({
      fetchImpl: fetchReturning(400, { error: { code: 'bad_request' } }),
      onLog: (level, message) => {
        if (level === 'warning') warnings.push(message)
      },
    })
    uploader.enqueue(payload())

    const summary = await uploader.drainOnce()

    expect(summary.dropped).toBe(1)
    expect(queueFiles()).toHaveLength(0)
    expect(warnings.some(w => /drop/i.test(w))).toBe(true)
  })

  it('U6 — a 5xx keeps the bundle for a later retry', async () => {
    const uploader = makeUploader({ fetchImpl: fetchReturning(503) })
    uploader.enqueue(payload())

    const summary = await uploader.drainOnce()

    expect(summary.kept).toBe(1)
    expect(summary.serverDown).toBe(true)
    expect(queueFiles()).toHaveLength(1)
  })

  it('U7 — a network failure keeps the bundle for a later retry', async () => {
    const uploader = makeUploader({ fetchImpl: fetchThrowing() })
    uploader.enqueue(payload())

    const summary = await uploader.drainOnce()

    expect(summary.kept).toBe(1)
    expect(summary.serverDown).toBe(true)
    expect(queueFiles()).toHaveLength(1)
  })
})

describe('start retries a kept bundle after a backoff', () => {
  it('U8 — a 5xx then a 2xx clears the queue only after the backoff elapses', async () => {
    vi.useFakeTimers()
    try {
      const fetchSpy = vi
        .fn()
        .mockImplementationOnce(async () => ({ status: 503, json: async () => ({}) }))
        .mockImplementation(async () => ({ status: 200, json: async () => ({ received: true }) }))
      const uploader = makeUploader({ fetchImpl: fetchSpy as unknown as typeof fetch })
      uploader.enqueue(payload())

      uploader.start()
      // First drain (503) — the bundle is kept, one request made.
      await vi.advanceTimersByTimeAsync(0)
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      expect(queueFiles()).toHaveLength(1)

      // Before the backoff elapses, no retry.
      await vi.advanceTimersByTimeAsync(DIAGNOSTICS_RETRY_BASE_MS - 1)
      expect(fetchSpy).toHaveBeenCalledTimes(1)

      // After it elapses, the retry (200) clears the queue.
      await vi.advanceTimersByTimeAsync(1)
      expect(fetchSpy).toHaveBeenCalledTimes(2)
      expect(queueFiles()).toHaveLength(0)

      uploader.stop()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('the payload is bounded and the queue is bounded', () => {
  it('U9 — an over-cap payload keeps the newest records and flags truncation', () => {
    const lines = Array.from({ length: 400 }, (_, i) =>
      JSON.stringify({ ts: stampFor(i), kind: 'api-error', message: `marker-${i}-end` }),
    )
    const maxBytes = 8 * 1024

    const { payload: built, truncated } = buildDiagnosticsPayload({
      ndjson: lines.join('\n'),
      facts: FACTS,
      createdAt: 1000,
      maxBytes,
    })

    expect(truncated).toBe(true)
    expect(built.truncated).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(built), 'utf-8')).toBeLessThanOrEqual(maxBytes)
    expect(built.events).toBeGreaterThan(0)
    expect(built.events).toBeLessThan(400)
    // The newest record survived; an old one was dropped from the front.
    expect(built.ndjson).toContain('marker-399-end')
    expect(built.ndjson).not.toContain('marker-0-end')
  })

  it('U10 — the queue never exceeds its bound; the oldest are evicted', () => {
    const uploader = makeUploader({ maxQueue: 3 })

    for (let i = 0; i < 6; i++) uploader.enqueue(payload({ createdAt: 1000 + i, bundleId: `b${i}` }))

    expect(queueFiles()).toHaveLength(3)
  })
})

describe('events are not re-queued once sent', () => {
  it('U11 — a high-water marker stops the same events being queued twice', () => {
    const uploader = makeUploader()

    expect(uploader.enqueueRecentDiagnostics(events(3), { facts: FACTS })).toBe(true)
    expect(queueFiles()).toHaveLength(1)

    // The same events again — nothing new is fresh.
    expect(uploader.enqueueRecentDiagnostics(events(3), { facts: FACTS })).toBe(false)
    expect(queueFiles()).toHaveLength(1)
  })
})

/** An ISO timestamp that sorts with ``i`` (seconds encoded into the minute field). */
function stampFor(i: number): string {
  const mm = String(Math.floor(i / 60)).padStart(2, '0')
  const ss = String(i % 60).padStart(2, '0')
  return `2026-08-26T12:${mm}:${ss}.000Z`
}

/** ``n`` minimal captured events, oldest-first, with strictly increasing ``ts``. */
function events(n: number): DiagnosticEvent[] {
  return Array.from({ length: n }, (_, i) => ({
    ts: stampFor(i),
    source: 'renderer' as const,
    kind: 'renderer-error' as const,
    severity: 'error' as const,
    scope: 'test',
    message: `event ${i}`,
    appVersion: '0.1.0',
    platform: 'win32',
  }))
}
