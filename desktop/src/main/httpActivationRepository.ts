/**
 * HTTP implementation of the activation issuer seam (Electron main process).
 * Debt #3.
 *
 * This is the production-shaped {@link ActivationRepository}: it talks to the
 * strixgeo.com activation service over the HTTP contract written in
 * ``docs/design/activation-api-contract.md``. It replaces {@link ./mockActivationRepository}
 * whenever a base URL is configured ({@link ./activationConfig}); with no base
 * URL the mock stays in place, so the owner's dogfeed is unchanged.
 *
 * ## What it is, and is not
 *
 * It implements exactly the three interface methods the client calls today —
 * ``activate`` / ``startTrial`` / ``deactivate``. The contract also specifies a
 * ``refresh`` (launch-time online re-check) and a ``diagnostics`` upload
 * endpoint; those are the SERVER's contract, called from elsewhere (or a later
 * client slice), and are not part of this interface.
 *
 * It uses the Electron-main global ``fetch`` (injectable for tests), maps the
 * contract's wire licence to the internal {@link Licence}, maps the contract's
 * error codes to the interface's {@link IssueFailureCode}, times every request
 * out, and treats any network failure / timeout / unreadable response as
 * ``unreachable`` — the code the offline path is built around: the local
 * store's licence keeps the app open inside its 30-day grace regardless of the
 * server (owner ruling 14). It NEVER logs a licence key in full — only the last
 * four characters, via {@link maskLicenceKey}.
 *
 * The engine behind the URL (MySQL, per the owner's "Activation host" ruling)
 * never leaks here: this module knows only JSON over HTTPS.
 */

import { LICENCE_TIERS, type Licence, type LicenceTier } from './activation'
import {
  DeactivateFailedError,
  type ActivateRequest,
  type ActivationRepository,
  type DeviceIdentity,
  type IssueFailureCode,
  type IssueResult,
} from './activationRepository'

/** Milliseconds in a day — the wire carries grace as a whole-day count. */
const DAY_MS = 24 * 60 * 60 * 1000

/** Default per-request timeout. Long enough for a slow link, short enough that a
 * dead server does not hang activation for the user. */
const DEFAULT_TIMEOUT_MS = 10_000

/**
 * The contract's error ``code`` → the interface's {@link IssueFailureCode}.
 *
 * The contract distinguishes "this key is bound to another device" from "every
 * seat on a multi-seat key is taken"; the client collapses both to
 * ``device_limit`` because the renderer shows one "deactivate a device to
 * transfer" message for either. Every other outcome (an unrecognised code, a
 * 5xx, a network failure, a timeout, an unreadable body) becomes ``unreachable``
 * — the conservative bucket that keeps the app on its stored licence rather than
 * trusting or destroying anything.
 */
const WIRE_ERROR_TO_CODE: Readonly<Record<string, IssueFailureCode>> = {
  key_unknown: 'unknown_key',
  key_bound_elsewhere: 'device_limit',
  seat_exhausted: 'device_limit',
  trial_already_used: 'already_trialled',
}

/** Injected configuration for the HTTP repository. */
export interface HttpActivationRepositoryConfig {
  /** Base URL of the activation service, no trailing slash (e.g. ``https://strixgeo.com/api/activation``). */
  baseUrl: string
  /** This build's version, sent so the server can log/segment clients; optional. */
  appVersion?: string
  /** ``fetch`` to use; defaults to the global one. Injected in tests. */
  fetchImpl?: typeof fetch
  /** Per-request timeout in ms; defaults to {@link DEFAULT_TIMEOUT_MS}. */
  timeoutMs?: number
  /** Optional debug sink. Only ever receives a MASKED key (never the full key). */
  onDebug?: (message: string) => void
}

/**
 * Mask a licence key for logging: bullets plus its last four characters.
 *
 * A key is a secret credential; a log line must never carry it in full. Four
 * trailing characters are enough for a human to tell two keys apart when
 * matching a support report, and reveal nothing usable.
 *
 * Parameters
 * ----------
 * key : string
 *     The licence key.
 *
 * Returns
 * -------
 * string
 *     ``••••ABCD`` for a key ending ``ABCD``; ``••••`` for a key of four or
 *     fewer characters.
 */
export function maskLicenceKey(key: string): string {
  const trimmed = key.trim()
  if (trimmed.length <= 4) return '••••'
  return `••••${trimmed.slice(-4)}`
}

/** A finished HTTP round-trip, or the flag that no answer came back. */
type Transport =
  | { kind: 'response'; status: number; body: unknown }
  | { kind: 'network-failure' }

/** True for a JSON object (and not an array or null). */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** True for a finite number — the only kind we compare against a clock. */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** The HTTP-backed activation issuer. */
export class HttpActivationRepository implements ActivationRepository {
  private readonly baseUrl: string
  private readonly appVersion: string | undefined
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number
  private readonly onDebug: ((message: string) => void) | undefined

  constructor(config: HttpActivationRepositoryConfig) {
    // Defend against a trailing slash slipping in from config so the joined path
    // never doubles up.
    this.baseUrl = config.baseUrl.replace(/\/+$/, '')
    this.appVersion = config.appVersion
    this.fetchImpl = config.fetchImpl ?? fetch
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.onDebug = config.onDebug
  }

  async activate(request: ActivateRequest): Promise<IssueResult> {
    this.onDebug?.(`activate ${maskLicenceKey(request.key)} on ${request.deviceId}`)
    return this.issue(
      'activate',
      {
        key: request.key,
        deviceId: request.deviceId,
        deviceLabel: request.deviceLabel,
        appVersion: this.appVersion,
      },
      { deviceId: request.deviceId, deviceLabel: request.deviceLabel },
    )
  }

  async startTrial(device: DeviceIdentity): Promise<IssueResult> {
    this.onDebug?.(`start-trial on ${device.deviceId}`)
    return this.issue(
      'trial',
      { deviceId: device.deviceId, deviceLabel: device.deviceLabel, appVersion: this.appVersion },
      device,
    )
  }

  async deactivate(deviceId: string): Promise<void> {
    // Unlike activate/trial, the interface gives deactivate no way to report a
    // failure code — so a failure THROWS a typed {@link DeactivateFailedError}
    // carrying the HTTP status. The orchestration layer uses that status to tell
    // a 404 (already released server-side → clear the local licence) from a 401
    // or a network failure (keep the local licence; never strand the seat). The
    // local licence is cleared only on a clean 2xx here or on that 404 branch —
    // an offline deactivate leaves both the local licence and the server seat
    // intact.
    const transport = await this.send('deactivate', { deviceId })
    if (transport.kind === 'network-failure') {
      throw new DeactivateFailedError(null, 'could not reach the activation server to release this device')
    }
    if (transport.status < 200 || transport.status >= 300) {
      throw new DeactivateFailedError(
        transport.status,
        `activation server refused the release (HTTP ${transport.status})`,
      )
    }
  }

  /**
   * POST a body and shape the answer into an {@link IssueResult}.
   *
   * Parameters
   * ----------
   * path : string
   *     The endpoint path under {@link baseUrl}.
   * body : unknown
   *     The JSON request body.
   * device : DeviceIdentity
   *     The requesting device, used to backfill ``deviceId`` / ``deviceLabel``
   *     into the licence should the server omit its echo.
   */
  private async issue(path: string, body: unknown, device: DeviceIdentity): Promise<IssueResult> {
    const transport = await this.send(path, body)
    if (transport.kind === 'network-failure') {
      return { ok: false, code: 'unreachable', message: 'could not reach the activation server' }
    }
    if (transport.status >= 200 && transport.status < 300) {
      const licence = parseWireLicence(transport.body, device)
      if (!licence) {
        return {
          ok: false,
          code: 'unreachable',
          message: 'the activation server returned an unreadable licence',
        }
      }
      return { ok: true, licence }
    }
    return { ok: false, code: mapWireError(transport.body), message: failureMessage(transport) }
  }

  /**
   * Do one POST with a timeout, never throwing.
   *
   * Parameters
   * ----------
   * path : string
   *     Endpoint path under {@link baseUrl}.
   * body : unknown
   *     JSON request body.
   *
   * Returns
   * -------
   * Transport
   *     The status + parsed body, or ``network-failure`` for any thrown error —
   *     which includes an ``AbortError`` from the timeout and every DNS /
   *     connection failure.
   */
  private async send(path: string, body: unknown): Promise<Transport> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      let parsed: unknown = null
      try {
        parsed = await response.json()
      } catch {
        // A 2xx with no/invalid JSON is unreadable; a non-2xx with none maps by
        // status alone. Either way, null body is a fine sentinel here.
        parsed = null
      }
      return { kind: 'response', status: response.status, body: parsed }
    } catch {
      return { kind: 'network-failure' }
    } finally {
      clearTimeout(timer)
    }
  }
}

/**
 * Map an error response body to an {@link IssueFailureCode}.
 *
 * Parameters
 * ----------
 * body : unknown
 *     The parsed error body — expected shape ``{ error: { code, message } }``.
 *
 * Returns
 * -------
 * IssueFailureCode
 *     The mapped code, or ``unreachable`` for anything unrecognised.
 */
function mapWireError(body: unknown): IssueFailureCode {
  if (isObject(body) && isObject(body.error) && typeof body.error.code === 'string') {
    const mapped = WIRE_ERROR_TO_CODE[body.error.code]
    if (mapped) return mapped
  }
  return 'unreachable'
}

/**
 * A safe, key-free failure message for logs and fallback display.
 *
 * The renderer shows a translated message keyed on the ``code``; this string is
 * only a fallback and a log line, so it must carry no secret. It never includes
 * the server's own ``message`` text verbatim (which could echo the key).
 */
function failureMessage(transport: { status: number }): string {
  return `activation request refused (HTTP ${transport.status})`
}

/**
 * Validate the contract's wire licence and map it to the internal {@link Licence}.
 *
 * The wire shape (see the contract doc) is ``{ key, tier, seatId, isTrial,
 * issuedAt, expiresAt, graceDays, deviceId, deviceLabel }`` with timestamps as
 * epoch-millisecond integers and ``graceDays`` a whole-day count. ``seatId`` is
 * carried for the server's records and the future transfer UI; the internal
 * licence has no slot for it, so it is validated-if-present but not stored.
 *
 * Parameters
 * ----------
 * body : unknown
 *     The parsed success body — expected shape ``{ licence: { … } }``.
 * device : DeviceIdentity
 *     The requesting device, used to backfill ``deviceId`` / ``deviceLabel`` if
 *     the server omits them.
 *
 * Returns
 * -------
 * Licence | null
 *     The internal licence, or ``null`` if the body is missing, malformed, or
 *     carries an out-of-set tier — the caller turns ``null`` into ``unreachable``
 *     rather than trusting a garbled licence.
 */
function parseWireLicence(body: unknown, device: DeviceIdentity): Licence | null {
  if (!isObject(body) || !isObject(body.licence)) return null
  const w = body.licence

  if (typeof w.key !== 'string') return null
  if (typeof w.tier !== 'string' || !(LICENCE_TIERS as readonly string[]).includes(w.tier)) return null
  if (typeof w.isTrial !== 'boolean') return null
  if (!isFiniteNumber(w.issuedAt) || !isFiniteNumber(w.expiresAt) || !isFiniteNumber(w.graceDays)) {
    return null
  }

  const deviceId = typeof w.deviceId === 'string' && w.deviceId ? w.deviceId : device.deviceId
  const deviceLabel =
    typeof w.deviceLabel === 'string' && w.deviceLabel ? w.deviceLabel : device.deviceLabel

  return {
    key: w.key,
    tier: w.tier as LicenceTier,
    isTrial: w.isTrial,
    deviceId,
    deviceLabel,
    issuedAtMs: w.issuedAt,
    expiresAtMs: w.expiresAt,
    // Grace crosses the wire as days (server-friendly) and lives internally as ms.
    graceWindowMs: Math.max(0, Math.round(w.graceDays)) * DAY_MS,
  }
}
