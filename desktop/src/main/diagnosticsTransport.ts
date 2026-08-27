/**
 * Transmission seam for diagnostics (Electron main process) — debt #16.
 *
 * **There is no endpoint, on purpose.** Where crash reports would be sent — our
 * own server, a hosted collector, an email drop — is a commercial decision with
 * a running cost, a privacy policy and a data-processing agreement attached to
 * it. That decision is not an engineering one and is not made here.
 *
 * What exists here is the shape the decision will plug into, and the two gates
 * it will have to pass:
 *
 * 1. **Consent** — {@link readTransmissionConsent}. Checked before the
 *    transport is even consulted, so a future transport cannot be wired in a
 *    way that skips it.
 * 2. **An endpoint** — a {@link DiagnosticsTransport}. The shipped one
 *    ({@link NO_ENDPOINT_TRANSPORT}) refuses everything.
 *
 * Until a transport is chosen the only supported route is the manual one: the
 * user builds a crash bundle (``crashBundle.ts``) and sends it deliberately.
 */

import type { DiagnosticEvent } from './diagnosticsEvent'

/** What would be sent: the captured events plus the build facts. */
export interface CrashBundleEnvelope {
  /** Opaque id for this bundle, so a support thread can name it. */
  bundleId: string
  /** When the bundle was assembled, ISO-8601. */
  createdAt: string
  /** App version the events came from. */
  appVersion: string
  /** ``process.platform``. */
  platform: string
  /** Beta build id, when stamped. */
  buildId?: string
  /** The captured events — already redacted and whitelisted. */
  events: DiagnosticEvent[]
}

/** What happened when we tried (or declined) to send. */
export interface TransmissionOutcome {
  /** True only when a transport confirmed acceptance. */
  sent: boolean
  /** One line, safe to log — carries no user data. */
  reason: string
}

/** A destination for crash bundles. Implemented when an endpoint is chosen. */
export interface DiagnosticsTransport {
  /** Short label for logs. */
  readonly name: string
  /**
   * Attempt delivery.
   *
   * @param envelope - The bundle to send.
   * @returns The outcome; implementations should resolve rather than reject.
   */
  send(envelope: CrashBundleEnvelope): Promise<TransmissionOutcome>
}

/**
 * The transport a shipped build carries: none.
 *
 * Refuses every envelope with a reason that names the missing decision, so a
 * log line from a beta tester reads as "we never wired this up", not as "the
 * upload failed".
 */
export const NO_ENDPOINT_TRANSPORT: DiagnosticsTransport = {
  name: 'no-endpoint',
  send: (): Promise<TransmissionOutcome> =>
    Promise.resolve({
      sent: false,
      reason: 'no diagnostics endpoint is configured in this build',
    }),
}

/** Inputs to {@link transmitDiagnostics}. */
export interface TransmitOptions {
  /** The recorded consent answer — see ``diagnosticsConsent.ts``. */
  consent: boolean
  /** The transport to use; defaults to {@link NO_ENDPOINT_TRANSPORT}. */
  transport?: DiagnosticsTransport
}

/**
 * Send a crash bundle, if and only if both gates open.
 *
 * Parameters
 * ----------
 * envelope : CrashBundleEnvelope
 *     The bundle to send.
 * options : TransmitOptions
 *     The consent answer and the transport.
 *
 * Returns
 * -------
 * Promise<TransmissionOutcome>
 *     Always resolves. A transport that rejects is reported as a failed send —
 *     a diagnostics upload must never become the crash.
 */
export async function transmitDiagnostics(
  envelope: CrashBundleEnvelope,
  options: TransmitOptions,
): Promise<TransmissionOutcome> {
  // The consent check is FIRST and outside the transport, so no transport
  // implementation can be the thing that decides whether consent mattered.
  if (!options.consent) {
    return { sent: false, reason: 'transmission consent has not been given' }
  }

  const transport = options.transport ?? NO_ENDPOINT_TRANSPORT
  try {
    return await transport.send(envelope)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return { sent: false, reason: `transport ${transport.name} failed: ${detail}` }
  }
}
