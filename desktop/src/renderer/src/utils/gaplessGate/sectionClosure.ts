/**
 * CLAUSE 4 (section-closure) — every litho-frame section either appears in
 * the built payload, or was consented out.
 *
 * WHY THIS SCOPE, NOT MORE. ``buildVoxelRequest`` already knows, in its own
 * scope, the set of sections the litho frame supplies (``frameBySectionId``)
 * and the set that actually landed in the payload (``out``); this module is
 * the pure comparison between the two. It does NOT attempt to attribute a
 * missing section to a CONSENTED investigation exclusion
 * (``excludedInvestigationIds`` in ``makeVoxelRequestBuilder.ts``): that
 * exclusion is applied identically to both the litho frame's own assembly and
 * the geotech assembly before either reaches ``buildVoxelRequest``, so by the
 * time this module runs, a section already reflects the SAME exclusion on
 * both sides — its absence from the payload cannot be more "explained by
 * consent" here than a section that was never excluded at all. Attempting to
 * label it as consented anyway would be guessing, which the gate exists to
 * refuse to do. See ``buildVoxelRequest.ts``'s own comment at the call site
 * for the judgement call this represents.
 *
 * @module utils/gaplessGate/sectionClosure
 */

import type { GaplessClauseEntry, GaplessClauseInput } from './types'

/** A litho-frame section, named for a human-readable entry. */
export interface FrameSectionRef {
  sectionId: string
  sectionName: string
}

/** Everything clause 4 needs from one build. */
export interface SectionClosureInput {
  /**
   * Whether this build supplied a litho frame at all. ``false`` means a
   * litho-level build — there is no frame/payload asymmetry to compare, so
   * the clause is ``not-evaluated`` rather than a vacuous ``pass``.
   */
  hasFrame: boolean
  /** Every section the litho frame supplies (``frameBySectionId``'s entries). */
  frameSections: readonly FrameSectionRef[]
  /** Section ids that actually produced a payload entry (``out``). */
  builtSectionIds: ReadonlySet<string>
}

const NO_FRAME_REASON = 'this build has no litho frame: a litho-level build has nothing for clause 4 to check'

/**
 * Which litho-frame sections never reached the build's payload.
 *
 * @param input See {@link SectionClosureInput}.
 * @returns The clause, ready to fold into the section-scoped ``GaplessClauseInput[]``.
 */
export function sectionClosure(input: SectionClosureInput): GaplessClauseInput {
  if (!input.hasFrame) {
    return {
      key: 'section-closure',
      status: 'not-evaluated',
      not_evaluated_reason: NO_FRAME_REASON,
      entries: [],
    }
  }
  const entries: GaplessClauseEntry[] = []
  for (const { sectionId, sectionName } of input.frameSections) {
    if (input.builtSectionIds.has(sectionId)) continue
    entries.push({
      label: `${sectionName}: framed by the lithostratigraphic model but produced no geotech build output`,
      section_id: sectionId,
      section_name: sectionName,
      params: { section_name: sectionName },
    })
  }
  return { key: 'section-closure', status: entries.length > 0 ? 'fail' : 'pass', entries }
}
