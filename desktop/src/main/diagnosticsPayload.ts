/**
 * The ``POST /v1/diagnostics`` bundle shape and its pure builder — debt #16.
 *
 * Split out of ``diagnosticsUploader.ts`` (which owns the disk queue and the
 * HTTP transport) so the payload TYPES and the size-cap trimming — the parts
 * with no I/O — sit in one small, exhaustively-testable place. The uploader
 * imports what it needs from here.
 *
 * The payload matches the contract in ``docs/design/activation-api-contract.md``:
 * build facts, the redacted NDJSON tail, a ``truncated`` flag, and OPTIONAL
 * identity fields that are attached only under the flag in
 * ``diagnosticsUploaderConstants.ts``.
 */

import { randomUUID } from 'node:crypto'

import { ATTACH_ACTIVATION_IDENTITY_TO_DIAGNOSTICS, DIAGNOSTICS_MAX_PAYLOAD_BYTES } from './diagnosticsUploaderConstants'

/** Build facts stamped on every bundle (same shape as ``diagnosticsBuildFacts``). */
export interface DiagnosticsBuildFacts {
  /** ``app.getVersion()``. */
  appVersion: string
  /** ``process.platform`` — the OS the report came from. */
  platform: string
  /** Beta build stamp, when this build carries one. */
  buildId?: string
}

/**
 * Optional per-device identity a bundle MAY carry.
 *
 * Attached only when {@link ATTACH_ACTIVATION_IDENTITY_TO_DIAGNOSTICS} is on AND
 * an activation licence exists — see the flag's note. Both fields are opaque
 * strings; the licence key is a credential, so it never reaches a log line.
 */
export interface DiagnosticsIdentity {
  /** The activation licence key, when identity is attached. */
  licenceKey?: string
  /** The stable device id, when identity is attached. */
  deviceId?: string
}

/**
 * The uploaded bundle, matching the ``POST /v1/diagnostics`` contract body.
 *
 * The NDJSON tail is already redacted (redacted-by-construction in the local
 * log); ``truncated`` says the head was dropped to fit the size cap.
 */
export interface DiagnosticsPayload {
  /** Opaque id so a support thread (and server-side dedup) can name the bundle. */
  bundleId: string
  /** When the bundle was assembled, epoch ms (the activation contract's convention). */
  createdAt: number
  /** App version the events came from. */
  appVersion: string
  /** ``process.platform``. */
  platform: string
  /** Beta build stamp, when present. */
  buildId?: string
  /** Number of NDJSON records in this bundle. */
  events: number
  /** True when the oldest records were dropped to fit the size cap. */
  truncated: boolean
  /** The redacted NDJSON records, one JSON object per line. */
  ndjson: string
  /** Activation licence key — present only when identity is attached (see the flag). */
  licenceKey?: string
  /** Stable device id — present only when identity is attached (see the flag). */
  deviceId?: string
}

/** UTF-8 byte length of a string. */
export function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf-8')
}

/**
 * The identity to attach to a diagnostics bundle for this launch.
 *
 * Returns identity ONLY when {@link ATTACH_ACTIVATION_IDENTITY_TO_DIAGNOSTICS}
 * is on and a licence key is present. Kept as its own pure function so the "does
 * a bundle carry a device id?" decision lives in exactly one testable place —
 * the capture design's shipped invariant is "no device id", so this gate is the
 * seam the owner's ruling flips.
 *
 * Parameters
 * ----------
 * licence : { key: string, deviceId: string } | null
 *     The stored activation licence + device id, or ``null`` when unactivated.
 *
 * Returns
 * -------
 * DiagnosticsIdentity | undefined
 *     The identity to attach, or ``undefined`` to attach none.
 */
export function diagnosticsIdentityFor(
  licence: { key: string; deviceId: string } | null,
): DiagnosticsIdentity | undefined {
  if (!ATTACH_ACTIVATION_IDENTITY_TO_DIAGNOSTICS) return undefined
  if (!licence || !licence.key) return undefined
  return { licenceKey: licence.key, deviceId: licence.deviceId }
}

/**
 * Build an upload payload from an NDJSON tail, trimming it to fit the size cap.
 *
 * The newest (trailing) records are kept; the oldest are dropped from the front
 * until the whole JSON body fits ``maxBytes``, and ``truncated`` records that a
 * drop happened. Pure — no I/O.
 *
 * Parameters
 * ----------
 * input : object
 *     ``ndjson`` — the redacted NDJSON records (``\n``-joined); ``facts`` — build
 *     facts; ``createdAt`` — epoch ms; ``identity`` — optional identity;
 *     ``bundleId`` / ``maxBytes`` — optional overrides.
 *
 * Returns
 * -------
 * { payload: DiagnosticsPayload, truncated: boolean }
 *     The payload and whether the head was dropped.
 */
export function buildDiagnosticsPayload(input: {
  ndjson: string
  facts: DiagnosticsBuildFacts
  createdAt: number
  identity?: DiagnosticsIdentity
  bundleId?: string
  maxBytes?: number
}): { payload: DiagnosticsPayload; truncated: boolean } {
  const maxBytes = input.maxBytes ?? DIAGNOSTICS_MAX_PAYLOAD_BYTES

  // A random UUID, not ``createdAt-appVersion``: two bundles assembled in the
  // same millisecond on the same build (a crash storm, a batch flush) would
  // otherwise collide, defeating server-side dedup and support-thread naming.
  // Resolved ONCE here so the full and trimmed ``make`` calls return the same
  // id (only one payload is returned, but a stable id is the correct contract).
  const bundleId = input.bundleId ?? randomUUID()

  const make = (ndjson: string, truncated: boolean): DiagnosticsPayload => {
    const lineCount = ndjson === '' ? 0 : ndjson.split('\n').filter(line => line.trim() !== '').length
    return {
      bundleId,
      createdAt: input.createdAt,
      appVersion: input.facts.appVersion,
      platform: input.facts.platform,
      ...(input.facts.buildId === undefined ? {} : { buildId: input.facts.buildId }),
      events: lineCount,
      truncated,
      ndjson,
      ...(input.identity?.licenceKey ? { licenceKey: input.identity.licenceKey } : {}),
      ...(input.identity?.deviceId ? { deviceId: input.identity.deviceId } : {}),
    }
  }

  const full = make(input.ndjson, false)
  if (byteLength(JSON.stringify(full)) <= maxBytes) return { payload: full, truncated: false }

  // The envelope (build facts + flags + identity) with an empty tail; the tail's
  // JSON-escaped form can inflate up to ~2x, so keep at most half the remaining
  // byte budget as raw text, then trim whole lines if the escaping still overran.
  const overhead = byteLength(JSON.stringify(make('', true)))
  const rawBudget = Math.max(0, Math.floor((maxBytes - overhead) / 2))
  const buf = Buffer.from(input.ndjson, 'utf-8')
  let tail = buf.subarray(Math.max(0, buf.length - rawBudget)).toString('utf-8')
  // Start on a whole record — the byte slice may have cut a line in half.
  const firstBreak = tail.indexOf('\n')
  if (firstBreak >= 0) tail = tail.slice(firstBreak + 1)

  let lines = tail.split('\n').filter(line => line.trim() !== '')
  let payload = make(lines.join('\n'), true)
  while (byteLength(JSON.stringify(payload)) > maxBytes && lines.length > 1) {
    lines = lines.slice(1)
    payload = make(lines.join('\n'), true)
  }
  return { payload, truncated: true }
}
