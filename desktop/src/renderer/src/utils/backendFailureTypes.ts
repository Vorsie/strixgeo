/**
 * Renderer mirror of the ``app:backend-failed`` payload.
 *
 * Mirrors ``BackendFailedPayload`` in ``src/main/backendFailureReason.ts``. The
 * payload is additive: an older main process sends none, so every reader treats
 * a missing payload or an unknown reason as "cause not recognised".
 */

/** A backend-failure cause the renderer can name. */
export type BackendFailureReasonDto = 'newer-database' | 'port-busy'

/** The causes this renderer knows; anything else reads as unknown. */
const KNOWN_REASONS: readonly BackendFailureReasonDto[] = ['newer-database', 'port-busy']

/** The payload of ``app:backend-failed``. */
export interface BackendFailedPayloadDto {
  /** The recognised cause, or null when the engine output named none. */
  reason: BackendFailureReasonDto | null
  /** The port the engine was told to bind (additive, 2026-10-12). */
  port?: number
}

/**
 * Read the cause from a received payload, tolerating an absent or foreign one.
 *
 * Parameters
 * ----------
 * payload : unknown
 *     What arrived with the signal (nothing from an older main process).
 *
 * Returns
 * -------
 * BackendFailureReasonDto | null
 *     ``'newer-database'`` or ``'port-busy'`` when named; otherwise null.
 */
export function backendFailureReasonOf(payload: unknown): BackendFailureReasonDto | null {
  const reason = (payload as { reason?: unknown } | null | undefined)?.reason
  return KNOWN_REASONS.find(known => known === reason) ?? null
}

/**
 * Read the engine port from a received payload.
 *
 * Parameters
 * ----------
 * payload : unknown
 *     What arrived with the signal.
 *
 * Returns
 * -------
 * number | null
 *     The port when it is an integer TCP port (1..65535); otherwise null.
 */
export function backendFailurePortOf(payload: unknown): number | null {
  const port = (payload as { port?: unknown } | null | undefined)?.port
  return typeof port === 'number' && Number.isInteger(port) && port >= 1 && port <= 65535
    ? port
    : null
}
