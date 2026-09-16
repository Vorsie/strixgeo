/**
 * The sentence pipeline step 1 leaves behind.
 *
 * Extracted from ``useGeologicalModel`` (already 2 700 lines, debt #201) when
 * the owner's 2026-08-15 ruling gave the message something new to say: WHICH
 * scope ran — *"i want subdivide cpt's also to be section scoped"*, so a count
 * with no scope no longer tells him what moved.
 *
 * It briefly reported the off-section skips too, and the owner threw that half
 * out the same day: *"wtf are of section skips, this is useless info for the
 * user?"*. A column he never put on a cross-section is not work he lost, so
 * the sentence stays silent about it. The count and the names still reach the
 * backend log at INFO (the audit trail) and the response still carries
 * ``skipped_off_section_*`` (the API contract) — only the toast is quiet.
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
  /** True for the combined legacy verb (steps 1 + 2 in one press). */
  deriveEdges: boolean
}

/**
 * Compose step 1's completion toast.
 *
 * @param input - Scope and the per-phase counts.
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

  // Step 1 correlates nothing on purpose, so the toast has to hand over the
  // next press — otherwise the empty geotech axis reads as a failure rather
  // than as "your turn". The combined verb already did step 2.
  const nextStep = input.deriveEdges ? '' : ' Next: 2 · Auto-correlate.'
  return (
    `Geotechnical subdivision complete ${scope}: ` +
    `${splitMsg}${boreholeNote}${tieNote}.${nextStep}`
  )
}
