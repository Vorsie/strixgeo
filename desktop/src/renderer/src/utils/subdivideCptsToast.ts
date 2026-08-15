/**
 * The sentence pipeline step 1 leaves behind.
 *
 * Extracted from ``useGeologicalModel`` (already 2 700 lines, debt #201) when
 * the owner's 2026-08-15 ruling gave the message two new things to say:
 *
 *   * WHICH scope ran — *"i want subdivide cpt's also to be section scoped"*,
 *     so a count with no scope no longer tells him what moved;
 *   * that the model deliberately came out SMALLER — *"i don't want any cpt's
 *     that aren't on any sections to be subdivided and included in the
 *     model"*. Those columns are skipped on purpose, and a skip nobody is told
 *     about is one that gets discovered in an export.
 *
 * Pure, so the wording is pinned without driving the god-hook.
 */

/** Everything the sentence is assembled from. */
export interface SubdivideCptsToastInput {
  /** True when the press was scoped to the open section. */
  scopedToSection: boolean
  /** Body groups that received a consistent multi-band split. */
  splitBodyCount: number
  /** Body groups assigned a single representative NAD class. */
  oneClassBodyCount: number
  /** Body groups that were borehole-only (no CPT qc to classify from). */
  boreholeOnlyCount: number
  /** Accepted packing ties carried across the rebuild. */
  reanchoredTieCount: number
  /** Interpreted investigations skipped for appearing on no cross-section. */
  skippedOffSectionCount: number
  /** Their names — a count alone cannot be acted on. */
  skippedOffSectionLabels: readonly string[]
  /** True for the combined legacy verb (steps 1 + 2 in one press). */
  deriveEdges: boolean
}

/** How many skipped names to spell out before falling back to "+N more". */
const MAX_NAMED_SKIPS = 5

/**
 * Compose step 1's completion toast.
 *
 * @param input - Scope, per-phase counts, and the off-section skip report.
 * @returns One sentence for the success toast.
 */
export function subdivideCptsToast(input: SubdivideCptsToastInput): string {
  const scope = input.scopedToSection ? 'on this section' : 'on all sections'
  const splitMsg =
    `${input.splitBodyCount} bodies split, ${input.oneClassBodyCount} single-class`
  const boreholeNote =
    input.boreholeOnlyCount > 0 ? `, ${input.boreholeOnlyCount} borehole-only` : ''
  const tieNote =
    input.reanchoredTieCount > 0 ? `, ${input.reanchoredTieCount} accepted ties kept` : ''

  let skipNote = ''
  if (input.skippedOffSectionCount > 0) {
    const shown = input.skippedOffSectionLabels.slice(0, MAX_NAMED_SKIPS)
    const rest = input.skippedOffSectionLabels.length - shown.length
    const names = shown.join(', ') + (rest > 0 ? `, +${rest} more` : '')
    skipNote =
      ` ${input.skippedOffSectionCount} interpreted column` +
      `${input.skippedOffSectionCount === 1 ? '' : 's'} left out — ` +
      `on no cross-section${names ? ` (${names})` : ''}.`
  }

  // Step 1 correlates nothing on purpose, so the toast has to hand over the
  // next press — otherwise the empty geotech axis reads as a failure rather
  // than as "your turn". The combined verb already did step 2.
  const nextStep = input.deriveEdges ? '' : ' Next: 2 · Auto-correlate.'
  return (
    `Geotechnical subdivision complete ${scope} — ` +
    `${splitMsg}${boreholeNote}${tieNote}.${skipNote}${nextStep}`
  )
}
