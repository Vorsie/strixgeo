/**
 * THE RENDERER'S HALF OF THE GAPLESS GATE — assembled across every section.
 *
 * ``clauses2d.ts`` answers clauses 1-3 PER SECTION; ``sectionClosure.ts``
 * answers clause 4 for the whole build in one shot (it is inherently
 * cross-section — a section either reached the payload or it didn't). This
 * module folds the per-section clause-1/2/3 evidence into the single
 * ``GaplessClauseInput`` per key the wire type allows, and appends clause 4.
 *
 * THE MERGE RULE (a judgement call — pinned in ``index.test.ts``, restated
 * here so it cannot silently drift):
 *
 *  - any entry anywhere -> FAIL, carrying every entry found across sections.
 *  - no entries anywhere, and every in-scope section was evaluated -> PASS.
 *  - no entries anywhere, but at least one section was NOT evaluated
 *    (including the all-sections case, e.g. a litho build) -> NOT-EVALUATED.
 *    A build that only partly measured a clause does not get to report a
 *    clean pass — the type's own doc says not-evaluated is not a soft pass,
 *    and a MIXED result is exactly the case that distinction exists for.
 *
 * @module utils/gaplessGate
 */

import { clauses2dForSection, type Clause2dKey, type SectionClauseEvidence, type SectionClause2dInput } from './clauses2d'
import { sectionClosure, type SectionClosureInput } from './sectionClosure'
import type { GaplessClauseInput } from './types'

export type { Clause2dKey, SectionClauseEvidence, SectionClause2dInput } from './clauses2d'
export type { FrameSectionRef, SectionClosureInput } from './sectionClosure'
export { sectionClosure } from './sectionClosure'

const CLAUSE_2D_KEYS: readonly Clause2dKey[] = ['area-conservation', 'edge-reach', 'cause-closure']

/** Fold one clause key's evidence across every section into one wire input. */
function mergeAcrossSections(key: Clause2dKey, perSection: readonly SectionClauseEvidence[]): GaplessClauseInput {
  const entries = perSection.flatMap((s) => s.entries)
  if (entries.length > 0) return { key, status: 'fail', entries }

  const evaluated = perSection.filter((s) => s.status !== 'not-evaluated')
  if (evaluated.length === perSection.length && perSection.length > 0) {
    return { key, status: 'pass', entries: [] }
  }
  const reason =
    evaluated.length === 0
      ? perSection.length === 0
        ? 'no sections in this build'
        : `no section in this build ran a hierarchical geotech fill (${perSection.length} section(s), no geotech frame)`
      : `${perSection.length - evaluated.length} of ${perSection.length} section(s) had no hierarchical geotech ` +
        `fill and were not evaluated for this clause; the remaining ${evaluated.length} passed clean`
  return { key, status: 'not-evaluated', not_evaluated_reason: reason, entries: [] }
}

/**
 * Assemble the renderer's four ``GaplessClauseInput``s for one build.
 *
 * @param sections Every section's clause-1/2/3 input (see {@link SectionClause2dInput}).
 * @param closure Clause 4's whole-build input (see {@link SectionClosureInput}).
 * @returns Exactly four entries — ``area-conservation``, ``edge-reach``,
 *   ``cause-closure``, ``section-closure`` — ready to attach to the voxel
 *   build payload as ``gapless_2d``.
 */
export function assembleGaplessClauses2d(
  sections: readonly SectionClause2dInput[],
  closure: SectionClosureInput,
): GaplessClauseInput[] {
  const perSectionByKey = new Map<Clause2dKey, SectionClauseEvidence[]>(
    CLAUSE_2D_KEYS.map((key) => [key, []]),
  )
  for (const section of sections) {
    for (const evidence of clauses2dForSection(section)) {
      perSectionByKey.get(evidence.key)!.push(evidence)
    }
  }
  return [
    ...CLAUSE_2D_KEYS.map((key) => mergeAcrossSections(key, perSectionByKey.get(key)!)),
    sectionClosure(closure),
  ]
}
