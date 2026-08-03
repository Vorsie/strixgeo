// Sub-phase failures of a DOV borehole import — one reading for every surface.
//
// Audit 2026-08-02, Class 1 ("the app reports success it did not verify"):
// ``ImportBoreholeDov`` records a whole failed phase as a COUNTER, not an
// error — a dead ``interpretaties`` WFS returns
// ``ImportInterpretationsDovResult(failed=len(borehole_map))`` and the import
// continues. Every one of those eight ``*_failed`` fields reached the renderer
// and none was rendered: the done panel showed the identical markup to a clean
// import, and the toast was green. The engineer concluded DOV holds no
// descriptions for those boreholes and never re-ran the import.
//
// This module is the single reading of "what did not arrive", so the panel and
// the toast cannot disagree about whether an import went cleanly.
//
// Follow-up (not built in this pass): the audit's structural fix is one shared
// `PartialResult<T> { value, failedCount, failures[] }` for every fan-out, with
// toast severity derived from `failedCount`. This is the per-site version.

import type { BoreholeImportDonePayload } from '../hooks/useDovImportStream'

/** One sub-phase whose rows did not arrive, with how many were affected. */
export interface DovSubPhaseFailure {
  /** User-facing phase name, e.g. ``'Observations'``. */
  label: string
  /** How many boreholes / permkeys the phase is short by. */
  count: number
  /**
   * Would re-running the import over the same area plausibly fetch these?
   *
   * ``true`` for a genuine fetch/parse/persist failure — a dead WFS comes
   * back. ``false`` for a WFS GAP, where DOV's catalogue says a stream exists
   * and its own per-stream layer returns nothing: re-running fetches the same
   * nothing, so telling the engineer to retry sends them round a loop. The
   * two want different copy, so the reading says which one this is.
   */
  retryable: boolean
}

// Ordered the way the import runs them, so the panel reads chronologically.
//
// ``interpretations_wfs_gaps`` is NOT a failure and gets its own label rather
// than being folded into "Observations": the fetch succeeded and DOV's own WFS
// contradicted itself (it flags ``has_<type>=True`` and the per-stream layer
// returns nothing — import_interpretations_dov.py, confirmed live with permkey
// 2024-216503). The engineer's next move differs too — a failure is worth
// re-running, a gap is worth checking by hand on dov.vlaanderen.be — so the
// row says which one happened.
const SUB_PHASE_LABELS: readonly [keyof BoreholeImportDonePayload, string, boolean][] = [
  ['interpretations_failed', 'Observations', true],
  ['interpretations_wfs_gaps', 'Observations DOV lists but did not return', false],
  ['samples_failed', 'Samples', true],
  ['grain_sizes_failed', 'Grain-size tests', true],
  ['atterberg_failed', 'Atterberg tests', true],
  ['caco3_failed', 'CaCO₃ tests', true],
  ['organic_failed', 'Organic-matter tests', true],
  ['water_content_failed', 'Water-content tests', true],
  ['scalar_lab_tests_failed', 'Other lab tests', true],
]

/**
 * Every sub-phase of a borehole import that failed, with its count.
 *
 * Parameters
 * ----------
 * result : BoreholeImportDonePayload
 *     The done payload as it arrived over SSE.
 *
 * Returns
 * -------
 * DovSubPhaseFailure[]
 *     One entry per sub-phase with a non-zero failure count, in import order.
 *     Empty when the import was clean — which is the ONLY case a caller may
 *     present as a plain success.
 */
export function dovSubPhaseFailures(
  result: BoreholeImportDonePayload,
): DovSubPhaseFailure[] {
  const failures: DovSubPhaseFailure[] = []
  for (const [key, label, retryable] of SUB_PHASE_LABELS) {
    const count = result[key]
    if (typeof count === 'number' && count > 0) failures.push({ label, count, retryable })
  }
  return failures
}
