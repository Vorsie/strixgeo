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
  /** Which kind of problem — must be one of the main process's known kinds. */
  kind: 'api-error' | 'renderer-error' | 'renderer-unhandled-rejection'
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
