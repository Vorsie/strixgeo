// The user-facing copy for a voxel build that did not complete.
//
// Extracted from useLithoSolids so BOTH the synchronous build path (which catches
// an ``ApiError``) and the streaming build path (``useVoxelBuildStream``, which
// catches a terminal SSE ``error`` event) format the grid-too-large refusal the
// SAME way — the retry spacing + "the stored model was not changed" — instead of
// showing the raw one-line server sentence on one path and the friendly copy on
// the other (debt #282 parity). Living in its own module keeps it importable from
// both hooks without the import cycle that would form if the stream hook reached
// back into useLithoSolids.

import { apiErrorDetail } from '../api/clients/shared'
import { t } from '../i18n/translate'
import { VoxelBuildInputsError } from '../utils/voxelBuildInputsError'

/**
 * The actionable copy for a ``voxel_grid_too_large`` refusal detail, or ``null``
 * when the detail is not that refusal.
 *
 * The backend declines a spacing that would not fit in memory and sends back the
 * spacing to retry at *as a number*. Live on 2026-08-02 that arrived as
 * "ApiError: [object Object]" and the engineer had no way to know the model was
 * untouched or what to change. The retry spacing is stated because the backend
 * went to the trouble of computing it; the "model unchanged" line stops the
 * engineer hunting for a half-built model before retrying.
 *
 * Both the synchronous build (via ``apiErrorDetail(err)``) and the streaming
 * build (the terminal SSE ``error`` event, which is already an object of the same
 * shape) feed their detail here so the copy is identical on both paths.
 *
 * Parameters
 * ----------
 * detail : Record<string, unknown> | null
 *     The structured server detail — ``{ code, message, suggested_horizontal_m }``
 *     for this refusal.
 *
 * Returns
 * -------
 * string | null
 *     The retry copy, or ``null`` when ``detail`` is not a grid-too-large refusal.
 */
export function gridTooLargeMessage(detail: Record<string, unknown> | null): string | null {
  if (detail?.code !== 'voxel_grid_too_large') return null
  const reason =
    typeof detail.message === 'string' && detail.message.length > 0
      ? detail.message
      : t('litho.gridTooLargeDefault')
  const suggested = detail.suggested_horizontal_m
  // Nothing was written server-side on this path.
  const untouched = t('litho.storedModelUnchanged')
  return typeof suggested === 'number'
    ? t('litho.gridTooLargeRetry', { reason, suggested, untouched })
    : t('litho.gridTooLargeNoRetry', { reason, untouched })
}

/**
 * The sentence shown when a synchronous build does not complete.
 *
 * Three failures are genuinely different and must not read alike:
 *
 * * **Inputs refused** (``VoxelBuildInputsError``) — the builder stopped before
 *   POSTing; its message already names the sections that failed to load, so it is
 *   shown verbatim.
 * * **Grid budget refused** (HTTP 422, ``code='voxel_grid_too_large'``) — the
 *   :func:`gridTooLargeMessage` copy, with the retry spacing.
 * * **Anything else** — an unexpected failure, where "check the connection" is
 *   still the honest guess.
 *
 * Parameters
 * ----------
 * err : unknown
 *     The caught rejection from the build attempt.
 *
 * Returns
 * -------
 * string
 *     Toast copy for the engineer.
 */
export function buildFailureMessage(err: unknown): string {
  if (err instanceof VoxelBuildInputsError) return err.message
  const grid = gridTooLargeMessage(apiErrorDetail(err))
  if (grid !== null) return grid
  return t('litho.buildFailedGeneric')
}
