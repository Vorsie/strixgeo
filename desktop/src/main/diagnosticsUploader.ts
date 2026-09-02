/**
 * The transmit half of local diagnostics (Electron main process) — debt #16.
 *
 * The capture half (``diagnosticsStore.ts`` + ``diagnosticsRedaction.ts`` +
 * ``diagnosticsEvent.ts``) writes a redacted NDJSON log the user owns. This
 * module is the OTHER half the owner ruled in on 2026-08-31 ("diagnostics go to
 * the same server" as activation): it sends that log to the strixgeo.com
 * endpoint — but only under two conditions that never move:
 *
 * 1. **Consent is on.** Every public entry checks {@link DiagnosticsUploaderConfig.consent}
 *    first; with consent off the uploader makes no request and never grows the
 *    queue. The default is off (``diagnosticsConsent.ts``).
 * 2. **An endpoint exists.** The base URL comes from the activation config; with
 *    none configured (the mock/dogfeed default) the uploader is inert.
 *
 * ## How it works
 *
 * Bundles are queued on disk as one JSON file each, in an ``outbox/`` directory
 * next to the NDJSON log, bounded to {@link DIAGNOSTICS_QUEUE_MAX} (oldest
 * evicted). {@link DiagnosticsUploader.enqueueRecentDiagnostics} builds a bundle
 * from the events captured since the last upload (a high-water file bounds
 * re-sends) and enqueues it; {@link DiagnosticsUploader.drainOnce} uploads
 * oldest-first over the shared {@link ./httpPostJson} transport — the same
 * fetch/timeout plumbing the activation client uses. A 2xx removes the bundle, a
 * 4xx drops it (a malformed bundle must not wedge the queue), and a 5xx or
 * network failure keeps it and stops the drain to retry later.
 * {@link DiagnosticsUploader.start} runs a drain at launch and, only while the
 * queue is non-empty, on an interval that backs off on failure.
 *
 * The payload shape + size-cap trimming live in ``diagnosticsPayload.ts``; this
 * module owns the disk queue, the HTTP transport, and the retry schedule. It
 * imports only Node built-ins + the global ``fetch`` (no ``electron``), so it
 * stays unit-testable under ``src/main/**``.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'fs'
import { randomUUID } from 'crypto'
import { join } from 'path'

import { writeFileAtomic } from './atomicWrite'
import type { DiagnosticEvent } from './diagnosticsEvent'
import {
  buildDiagnosticsPayload,
  byteLength,
  type DiagnosticsBuildFacts,
  type DiagnosticsIdentity,
  type DiagnosticsPayload,
} from './diagnosticsPayload'
import { postJson } from './httpPostJson'
import {
  DIAGNOSTICS_DRAIN_INTERVAL_MS,
  DIAGNOSTICS_HIGHWATER_FILENAME,
  DIAGNOSTICS_MAX_PAYLOAD_BYTES,
  DIAGNOSTICS_QUEUE_MAX,
  DIAGNOSTICS_RETRY_BASE_MS,
  DIAGNOSTICS_RETRY_MAX_MS,
  DIAGNOSTICS_UPLOAD_PATH,
  DIAGNOSTICS_UPLOAD_TIMEOUT_MS,
} from './diagnosticsUploaderConstants'

/** What one drain pass did — returned for tests and the scheduler. */
export interface DrainSummary {
  /** Bundles accepted (2xx) and removed. */
  sent: number
  /** Bundles refused (4xx) or unreadable, and dropped. */
  dropped: number
  /** Bundles kept for a later retry (5xx / network). */
  kept: number
  /** True when the drain stopped because the server/link was down. */
  serverDown: boolean
}

/** Injected configuration for {@link DiagnosticsUploader}. */
export interface DiagnosticsUploaderConfig {
  /** Absolute path to the outbox directory (created on demand). */
  queueDir: string
  /**
   * Activation base URL (no trailing slash), or ``null`` for "no endpoint".
   * ``null`` makes every method inert — the mock/dogfeed default.
   */
  baseUrl: string | null
  /** Reads the recorded transmission consent — checked before anything else. */
  consent: () => boolean
  /** ``fetch`` to use; defaults to the global one. Injected in tests. */
  fetchImpl?: typeof fetch
  /** Per-request timeout in ms; defaults to {@link DIAGNOSTICS_UPLOAD_TIMEOUT_MS}. */
  timeoutMs?: number
  /** Queue bound; defaults to {@link DIAGNOSTICS_QUEUE_MAX}. */
  maxQueue?: number
  /** Per-payload byte cap; defaults to {@link DIAGNOSTICS_MAX_PAYLOAD_BYTES}. */
  maxPayloadBytes?: number
  /** Structured log sink; defaults to the console with a ``[main]`` prefix. */
  onLog?: (level: 'info' | 'warning', message: string) => void
}

/** True for a JSON object (and not an array or null). */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The exponential backoff delay after ``failures`` consecutive kept drains, ms. */
function backoffMs(failures: number): number {
  const step = DIAGNOSTICS_RETRY_BASE_MS * 2 ** Math.max(0, failures - 1)
  return Math.min(step, DIAGNOSTICS_RETRY_MAX_MS)
}

/** ``" id=<x>"`` when the server echoed an id, else ``""`` — for the success log. */
function serverIdSuffix(body: unknown): string {
  if (isObject(body) && typeof body.id === 'string' && body.id) return ` id=${body.id}`
  return ''
}

/**
 * The disk-queued, consent-gated diagnostics uploader.
 *
 * One instance per app run. Owns the outbox directory, the high-water marker,
 * and the retry timer. Every method is a no-op unless consent is on and a base
 * URL is configured.
 */
export class DiagnosticsUploader {
  private readonly config: DiagnosticsUploaderConfig
  private readonly maxQueue: number
  private readonly maxPayloadBytes: number
  private timer: ReturnType<typeof setTimeout> | null = null
  private running = false
  private consecutiveFailures = 0

  constructor(config: DiagnosticsUploaderConfig) {
    this.config = config
    this.maxQueue = config.maxQueue ?? DIAGNOSTICS_QUEUE_MAX
    this.maxPayloadBytes = config.maxPayloadBytes ?? DIAGNOSTICS_MAX_PAYLOAD_BYTES
  }

  /** Whether both gates are open — nothing happens otherwise. */
  private enabled(): boolean {
    return this.config.consent() && !!this.config.baseUrl
  }

  private log(level: 'info' | 'warning', message: string): void {
    if (this.config.onLog) {
      this.config.onLog(level, message)
      return
    }
    const line = `[main ${level.toUpperCase()} diagnostics-uploader] ${message}`
    // eslint-disable-next-line no-console
    if (level === 'warning') console.warn(line)
    // eslint-disable-next-line no-console
    else console.info(line)
  }

  private uploadUrl(): string {
    return `${this.config.baseUrl}/${DIAGNOSTICS_UPLOAD_PATH}`
  }

  private highwaterPath(): string {
    return join(this.config.queueDir, DIAGNOSTICS_HIGHWATER_FILENAME)
  }

  /** Queue files, oldest-first (the name is a zero-padded epoch-ms prefix). */
  private queueFilesOldestFirst(): string[] {
    if (!existsSync(this.config.queueDir)) return []
    let names: string[]
    try {
      names = readdirSync(this.config.queueDir)
    } catch {
      return []
    }
    return names
      .filter(name => name.endsWith('.json') && name !== DIAGNOSTICS_HIGHWATER_FILENAME)
      .sort()
  }

  /** Read the ISO timestamp of the newest event already queued, or ``null``. */
  private readHighwater(): string | null {
    const path = this.highwaterPath()
    if (!existsSync(path)) return null
    try {
      const raw: unknown = JSON.parse(readFileSync(path, 'utf-8'))
      if (isObject(raw) && typeof raw.lastEventTs === 'string') return raw.lastEventTs
    } catch {
      // A damaged marker reads as "nothing queued yet" — the worst case is one
      // duplicate bundle, which the server dedups on bundleId.
    }
    return null
  }

  /** Record the newest event timestamp now represented in the queue. */
  private writeHighwater(lastEventTs: string): void {
    mkdirSync(this.config.queueDir, { recursive: true })
    writeFileAtomic(this.highwaterPath(), `${JSON.stringify({ lastEventTs }, null, 2)}\n`)
  }

  /** Drop the oldest bundles until at most {@link maxQueue} remain. */
  private enforceBound(): void {
    const files = this.queueFilesOldestFirst()
    for (let i = 0; i < files.length - this.maxQueue; i++) {
      this.removeFile(files[i])
      this.log('warning', `queue full (> ${this.maxQueue}); evicted oldest bundle ${files[i]}`)
    }
  }

  private removeFile(name: string): void {
    try {
      rmSync(join(this.config.queueDir, name), { force: true })
    } catch {
      // A file we could not delete will simply be retried/re-evicted next pass.
    }
  }

  /**
   * Build a bundle from events captured since the last upload and enqueue it.
   *
   * A no-op when consent is off, no endpoint is configured, or there are no
   * fresh events. The high-water marker is advanced at enqueue time (the bundle
   * is now durable on disk), so the same events are never queued twice.
   *
   * Parameters
   * ----------
   * events : DiagnosticEvent[]
   *     The captured events (``readDiagnosticEvents()``), oldest-first.
   * context : object
   *     ``facts`` — build facts; ``identity`` — optional identity; ``createdAt``
   *     — epoch ms for the bundle (defaults to now).
   *
   * Returns
   * -------
   * boolean
   *     ``true`` when a bundle was enqueued.
   */
  enqueueRecentDiagnostics(
    events: DiagnosticEvent[],
    context: { facts: DiagnosticsBuildFacts; identity?: DiagnosticsIdentity; createdAt?: number },
  ): boolean {
    if (!this.enabled()) return false

    const highwater = this.readHighwater()
    const fresh = highwater === null ? events : events.filter(event => event.ts > highwater)
    if (fresh.length === 0) return false

    const ndjson = fresh.map(event => JSON.stringify(event)).join('\n')
    const createdAt = context.createdAt ?? Date.now()
    const { payload } = buildDiagnosticsPayload({
      ndjson,
      facts: context.facts,
      createdAt,
      identity: context.identity,
      maxBytes: this.maxPayloadBytes,
    })

    this.enqueue(payload)
    // Advance past the newest event now durably queued (events are oldest-first).
    this.writeHighwater(fresh[fresh.length - 1].ts)
    return true
  }

  /**
   * Write one payload to the outbox and enforce the queue bound.
   *
   * A no-op when consent is off or no endpoint is configured — "keep sending
   * nowhere when consent is off" holds here, before any disk write.
   *
   * Parameters
   * ----------
   * payload : DiagnosticsPayload
   *     The bundle to queue.
   */
  enqueue(payload: DiagnosticsPayload): void {
    if (!this.enabled()) return
    mkdirSync(this.config.queueDir, { recursive: true })
    // Zero-padded epoch-ms prefix so a plain name sort is oldest-first; a random
    // suffix keeps two bundles in the same millisecond distinct.
    const name = `${String(payload.createdAt).padStart(15, '0')}-${randomUUID().slice(0, 8)}.json`
    writeFileAtomic(join(this.config.queueDir, name), `${JSON.stringify(payload)}\n`)
    this.enforceBound()
  }

  /**
   * Upload queued bundles once, oldest-first.
   *
   * A no-op when consent is off or no endpoint is configured. Each attempt logs
   * at INFO with the status and byte size; a drop logs at WARNING with the
   * reason. A 2xx removes the bundle; a 4xx (or an unreadable file) drops it; a
   * 5xx or network failure keeps it and stops the pass (the whole server/link is
   * down — trying the rest now would only repeat the failure).
   *
   * Returns
   * -------
   * Promise<DrainSummary>
   *     Counts of sent / dropped / kept, and whether the server was down.
   */
  async drainOnce(): Promise<DrainSummary> {
    const summary: DrainSummary = { sent: 0, dropped: 0, kept: 0, serverDown: false }
    if (!this.enabled()) return summary

    for (const name of this.queueFilesOldestFirst()) {
      const path = join(this.config.queueDir, name)
      let text: string
      try {
        text = readFileSync(path, 'utf-8')
      } catch {
        continue
      }

      let payload: unknown
      try {
        payload = JSON.parse(text)
      } catch {
        // An unparseable file can never be accepted — drop it so it cannot wedge
        // the oldest-first queue forever.
        this.removeFile(name)
        summary.dropped++
        this.log('warning', `dropped ${name}: not valid JSON`)
        continue
      }

      const size = byteLength(text)
      const result = await postJson(this.uploadUrl(), payload, {
        fetchImpl: this.config.fetchImpl,
        timeoutMs: this.config.timeoutMs ?? DIAGNOSTICS_UPLOAD_TIMEOUT_MS,
      })

      if (result.kind === 'response' && result.status >= 200 && result.status < 300) {
        this.removeFile(name)
        summary.sent++
        this.log(
          'info',
          `uploaded ${name} (${size} bytes) -> HTTP ${result.status}${serverIdSuffix(result.body)}`,
        )
        continue
      }
      if (result.kind === 'response' && result.status >= 400 && result.status < 500) {
        this.removeFile(name)
        summary.dropped++
        this.log('warning', `dropped ${name} (${size} bytes): server refused with HTTP ${result.status}`)
        continue
      }

      // 5xx or network failure: keep the bundle and stop — the server/link is
      // down, so the retry belongs to a later pass, not the next bundle.
      summary.kept++
      summary.serverDown = true
      const why = result.kind === 'network-failure' ? 'network failure' : `HTTP ${result.status}`
      this.log('info', `kept ${name} (${size} bytes): ${why}; will retry`)
      break
    }

    return summary
  }

  /**
   * Start the uploader: drain now, then re-drain on a timer while the queue is
   * non-empty. A no-op (with a log line) when consent is off or no endpoint is
   * configured. Idempotent — a second call while running does nothing.
   */
  start(): void {
    if (this.running) return
    if (!this.enabled()) {
      this.log(
        'info',
        this.config.baseUrl ? 'consent off — not transmitting' : 'no endpoint configured — not transmitting',
      )
      return
    }
    this.running = true
    void this.tick()
  }

  /** Stop the timer. Any in-flight request finishes but schedules no successor. */
  stop(): void {
    this.running = false
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  /** One scheduled iteration: drain, then decide whether and when to run again. */
  private async tick(): Promise<void> {
    if (!this.running) return
    if (!this.enabled()) {
      this.stop()
      return
    }

    const summary = await this.drainOnce()
    if (!this.running) return

    if (this.queueFilesOldestFirst().length === 0) {
      // Nothing left — go idle until something is enqueued again.
      this.consecutiveFailures = 0
      return
    }

    let delay: number
    if (summary.serverDown) {
      this.consecutiveFailures += 1
      delay = backoffMs(this.consecutiveFailures)
    } else {
      this.consecutiveFailures = 0
      delay = DIAGNOSTICS_DRAIN_INTERVAL_MS
    }
    this.timer = setTimeout(() => {
      this.timer = null
      void this.tick()
    }, delay)
  }
}
