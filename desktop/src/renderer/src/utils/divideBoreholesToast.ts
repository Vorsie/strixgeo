// The "Divide boreholes" success-toast sentence, extracted from
// useGeologicalModel so the message is testable (and the god-hook, #201,
// grows no further).
//
// Owner ruling 2026-08-14: the divide DELETES every bridged CPT↔CPT jump tie
// whose borehole-mediated chain arrived accepted ("the chain replaces the
// jump tie"). That deletion is silent in the DB, so the toast owns it —
// spanning tie lines vanishing without a word would read as lost work.

import type { DivideBoreholeResponse } from '../api/clients/geology.types'

/**
 * Build the success-toast sentence for a completed "Divide boreholes" run.
 *
 * @param result - The divide response; the tie fields are optional so a
 *   backend that predates them still yields a complete sentence.
 * @param wholeModel - True for a whole-model divide ("Boreholes"), false for
 *   a subset run ("Borehole").
 */
export function divideBoreholesToastMessage(
  result: DivideBoreholeResponse,
  wholeModel: boolean,
): string {
  const reanchored = result.reanchored_tie_count ?? 0
  const tieNote = reanchored > 0 ? `, ${reanchored} accepted ties kept` : ''
  const superseded = result.superseded_jump_tie_count ?? 0
  const supersededNote =
    superseded > 0
      ? `, ${superseded} jump tie${superseded === 1 ? '' : 's'} replaced by the borehole chain`
      : ''
  // Phase 8.6's crossing-span deletions are silent in the DB (owner ruling
  // 2026-08-24: "if no hops can be made, you just auto delete the crossing
  // correlation") — the toast owns the count, same contract as the jump ties.
  const deletedCrossings = result.deleted_crossing_span_count ?? 0
  const crossingNote =
    deletedCrossings > 0
      ? `, ${deletedCrossings} crossing tie${deletedCrossings === 1 ? '' : 's'} auto-deleted`
      : ''
  return (
    `${wholeModel ? 'Boreholes' : 'Borehole'} divided — ` +
    `${result.divided_borehole_count} split, ` +
    `${result.single_band_borehole_count} single-band${tieNote}${supersededNote}${crossingNote}.`
  )
}
