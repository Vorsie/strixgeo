/**
 * GG14-GG19 — the cross-section merge: one ``GaplessClauseInput`` per key,
 * folding every section's evidence into the single answer the wire type
 * allows.
 *
 * The merge rule, in plain words (this is the judgement call the module
 * itself documents — pinned here so it cannot drift unnoticed):
 *
 *  - ANY entry anywhere -> the clause is a FAIL, carrying every entry found.
 *  - no entries anywhere, but EVERY section was not-evaluated -> not-evaluated.
 *  - no entries anywhere, but SOME (not all) sections were not-evaluated ->
 *    still not-evaluated (a partial pass is not the same promise as a full
 *    one — the type's own doc says not-evaluated is not a soft pass, so a
 *    build that only partly measured a clause cannot report a clean pass).
 *  - no entries anywhere, and every section was evaluated -> pass.
 *
 * Written FIRST, before ``index.ts`` exists.
 */
import { describe, expect, it } from 'vitest'

import { assembleGaplessClauses2d } from './index'
import type { SectionClause2dInput } from './clauses2d'
import type { SectionClosureInput } from './sectionClosure'
import type {
  HierarchicalGeotechFillDiagnostics,
  HierarchicalGeotechFillResult,
} from '../geotechHierarchicalFill'

function diagnostics(
  overrides: Partial<HierarchicalGeotechFillDiagnostics> = {},
): HierarchicalGeotechFillDiagnostics {
  return {
    families: 0,
    singleColumnFamilies: 0,
    bands: 0,
    bandsStraddling: 0,
    bandsUnparented: 0,
    tiesCrossingFamilies: 0,
    tiesUnresolved: 0,
    unattributedLithoRegions: 0,
    oneSidedGaps: 0,
    blockedColumns: 0,
    levelFilledAreaM2: 0,
    crossFamilyWelds: 0,
    splitRemainders: 0,
    residualAreaM2: { noBands: 0, afterEngine: 0, outsideBandRange: 0 },
    totalityViolations: [],
    edgeReachViolations: [],
    ...overrides,
  }
}

function hierarchical(
  overrides: Partial<HierarchicalGeotechFillResult> = {},
): HierarchicalGeotechFillResult {
  return {
    preMergeRegions: [],
    regions: [],
    conflicts: [],
    lithoFallback: [],
    diagnostics: diagnostics(),
    ...overrides,
  }
}

const NO_FRAME: SectionClosureInput = { hasFrame: false, frameSections: [], builtSectionIds: new Set() }

function cleanSection(sectionId: string, sectionName: string): SectionClause2dInput {
  return {
    sectionId,
    sectionName,
    hierarchical: hierarchical(),
    lithoRegions: [],
    alongM: [0, 10],
    columnInvestigationIds: ['A', 'B'],
  }
}

function unevaluatedSection(sectionId: string, sectionName: string): SectionClause2dInput {
  return {
    sectionId,
    sectionName,
    hierarchical: undefined,
    lithoRegions: [],
    alongM: [0, 10],
    columnInvestigationIds: ['A', 'B'],
  }
}

describe('assembleGaplessClauses2d — clean build', () => {
  it('reports all four clauses as pass, empty entries', () => {
    const out = assembleGaplessClauses2d(
      [cleanSection('s1', 'Cross-section 1'), cleanSection('s2', 'Cross-section 2')],
      { hasFrame: true, frameSections: [{ sectionId: 's1', sectionName: 'Cross-section 1' }, { sectionId: 's2', sectionName: 'Cross-section 2' }], builtSectionIds: new Set(['s1', 's2']) },
    )
    expect(out).toHaveLength(4)
    for (const clause of out) {
      expect(clause.status).toBe('pass')
      expect(clause.entries).toEqual([])
    }
    expect(out.map((c) => c.key).sort()).toEqual(
      ['area-conservation', 'cause-closure', 'edge-reach', 'section-closure'].sort(),
    )
  })
})

describe('assembleGaplessClauses2d — a pure litho build (no frame anywhere)', () => {
  it('reports all four clauses not-evaluated', () => {
    const out = assembleGaplessClauses2d(
      [unevaluatedSection('s1', 'Cross-section 1'), unevaluatedSection('s2', 'Cross-section 2')],
      NO_FRAME,
    )
    for (const clause of out) {
      expect(clause.status).toBe('not-evaluated')
      expect(clause.not_evaluated_reason).toBeTruthy()
      expect(clause.entries).toEqual([])
    }
  })
})

describe('assembleGaplessClauses2d — a violation on one section', () => {
  it('fails that clause across the whole build, carrying only the real entries', () => {
    const violating: SectionClause2dInput = {
      sectionId: 's7',
      sectionName: 'Tie-section 7',
      hierarchical: hierarchical({ diagnostics: diagnostics({ totalityViolations: [{ gapIndex: 2, faces: 1, areaM2: 9 }] }) }),
      lithoRegions: [],
      alongM: [0, 10],
      columnInvestigationIds: ['A', 'B', 'C'],
    }
    const out = assembleGaplessClauses2d(
      [cleanSection('s1', 'Cross-section 1'), violating],
      { hasFrame: true, frameSections: [], builtSectionIds: new Set() },
    )
    const causeClosure = out.find((c) => c.key === 'cause-closure')!
    expect(causeClosure.status).toBe('fail')
    expect(causeClosure.entries).toHaveLength(1)
    expect(causeClosure.entries[0].section_id).toBe('s7')
    // Sibling clauses on the clean section, and this same section's OTHER
    // clauses, stay unaffected by the one clause that actually failed.
    const edgeReach = out.find((c) => c.key === 'edge-reach')!
    expect(edgeReach.status).toBe('pass')
  })
})

describe('assembleGaplessClauses2d — mixed evaluation, none failed', () => {
  it('stays not-evaluated rather than reporting a partial pass', () => {
    const out = assembleGaplessClauses2d(
      [cleanSection('s1', 'Cross-section 1'), unevaluatedSection('s2', 'Cross-section 2')],
      NO_FRAME,
    )
    const areaConservation = out.find((c) => c.key === 'area-conservation')!
    expect(areaConservation.status).toBe('not-evaluated')
    expect(areaConservation.entries).toEqual([])
    expect(areaConservation.not_evaluated_reason).toBeTruthy()
  })
})

describe('assembleGaplessClauses2d — clause 4 threads straight through', () => {
  it('folds sectionClosure verbatim into the four-clause array', () => {
    const out = assembleGaplessClauses2d([cleanSection('s1', 'Cross-section 1')], {
      hasFrame: true,
      frameSections: [
        { sectionId: 's1', sectionName: 'Cross-section 1' },
        { sectionId: 's9', sectionName: 'Cross-section 9' },
      ],
      builtSectionIds: new Set(['s1']),
    })
    const sectionClosureClause = out.find((c) => c.key === 'section-closure')!
    expect(sectionClosureClause.status).toBe('fail')
    expect(sectionClosureClause.entries).toHaveLength(1)
    expect(sectionClosureClause.entries[0].section_id).toBe('s9')
  })
})
