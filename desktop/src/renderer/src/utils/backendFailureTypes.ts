/**
 * Renderer mirror of the ``app:backend-failed`` payload.
 *
 * Mirrors ``BackendFailedPayload`` in ``src/main/backendFailureReason.ts``. The
 * payload is additive: an older main process sends none, so every reader treats
 * a missing payload or an unknown reason as "cause not recognised".
 */

/** A backend-failure cause the renderer can name. */
export type BackendFailureReasonDto = 'newer-database'

/** The payload of ``app:backend-failed``. */
export interface BackendFailedPayloadDto {
  /** The recognised cause, or null when the engine output named none. */
  reason: BackendFailureReasonDto | null
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
 *     ``'newer-database'`` when named; otherwise null.
 */
export function backendFailureReasonOf(payload: unknown): BackendFailureReasonDto | null {
  const reason = (payload as { reason?: unknown } | null | undefined)?.reason
  return reason === 'newer-database' ? 'newer-database' : null
}
