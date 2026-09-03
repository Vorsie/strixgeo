/**
 * Renderer-side seam for local crash capture (debt #16).
 *
 * Hands a diagnostic to the main process, which whitelists it, redacts it and
 * appends it to ``<userData>/diagnostics/diagnostics.log``. Nothing is
 * transmitted anywhere — see ``src/main/diagnosticsStore.ts``.
 *
 * Three renderer error paths already reach the main process through
 * ``logRendererError`` (``window.onerror``, ``unhandledrejection`` and the
 * ``ErrorBoundary``), and the main process captures those where it receives
 * them. This seam exists for the one path that has no equivalent: a backend
 * 5xx, which is a server-side failure the client is the only witness to.
 *
 * **Fire and forget, and silent.** Every caller is already on an error path;
 * a capture that threw, rejected, or logged would compete with the failure the
 * user actually needs to see.
 */

/** What the renderer may report. Mirrors the main process's whitelist. */
export interface RendererDiagnostic {
  /**
   * Which kind of problem.
   *
   * ⚠ The MAIN-process whitelist (``src/main/diagnosticsEvent.ts`` →
   * ``DIAGNOSTIC_KINDS``) is the authority on what actually reaches the log:
   * a kind it does not recognise collapses to ``unknown`` there (severity,
   * scope, message and httpStatus still survive). ``api-refusal`` is NOT in
   * that list yet — until it is added on the main side, a 4xx refusal is
   * logged as ``kind:"unknown"`` (still a warning, still carrying the code in
   * ``message``). The renderer emits the intended kind so the fix is a
   * one-line whitelist addition, not a re-plumb.
   */
  kind: 'api-error' | 'api-refusal' | 'renderer-error' | 'renderer-unhandled-rejection'
  /** How bad it was. Defaults to ``error`` on the main side when omitted. */
  severity?: 'warning' | 'error' | 'fatal'
  /** Module label, e.g. ``api``. */
  scope?: string
  /** What went wrong. Redacted on the main side. */
  message: string
  /** Stack trace, when there is one. Redacted on the main side. */
  stack?: string
  /** HTTP status, for a backend failure. */
  httpStatus?: number
}

/**
 * Report a diagnostic to the main process, if the bridge is there.
 *
 * Parameters
 * ----------
 * diagnostic : RendererDiagnostic
 *     The problem to record.
 */
export function captureDiagnostic(diagnostic: RendererDiagnostic): void {
  try {
    const bridge = window.electron?.captureDiagnostic
    if (!bridge) return
    // The promise is deliberately not awaited; a rejection is caught so it
    // never surfaces as an unhandled rejection of its own.
    void Promise.resolve(bridge(diagnostic)).catch(() => {})
  } catch {
    // A bridge that throws synchronously (a torn-down window) is the same
    // non-event as a missing one.
  }
}
