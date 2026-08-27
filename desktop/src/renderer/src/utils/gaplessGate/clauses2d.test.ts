/**
 * GG1-GG9 — clauses 1-3 of the gapless gate, computed per section.
 *
 * Written FIRST, in the rule's own words, before ``clauses2d.ts`` exists:
 *
 *  - clause 1 (area-conservation): classed + unclassed cover must equal the
 *    litho cover, per gap, within the engine's own snap-grid tolerance.
 *  - clause 2 (edge-reach): a gap the hierarchical fill flags as unreadable at
 *    a column edge is a clause 2 failure, verbatim — this clause NEVER
 *    re-derives the check, only reports what ``edgeReach.ts`` already found.
 *  - clause 3 (cause-closure): a gap the hierarchical fill flags as keeping
 *    unanswered ground (a totality violation) is a clause 3 failure; a gap
 *    with unclassed ground but NO banded run must stay SILENT (the cry-wolf
 *    guard) — proven here by constructing a scene with real lithoFallback
 *    area and an EMPTY totalityViolations list, which is exactly the shape
 *    ``fillTotality.ts`` produces for an out-of-scope gap.
 *
 * All three go ``not-evaluated`` (never a soft ``pass``) when the section ran
 * no hierarchical fill at all.
 */
import { describe, expect, it } from 'vitest'

import { clauses2dForSection, type SectionClause2dInput } from './clauses2d'
import type {
  HierarchicalGeotechFillDiagnostics,
  HierarchicalGeotechFillResult,
} from '../geotechHierarchicalFill'
import type { SectionRegion } from '../partitionFill'

/** A rectangle over [f0, f1] × [base, top] on one gap. */
function box(gapIndex: number, f0: number, f1: number, base: number, top: number): SectionRegion {
  return {
    formationId: 'F',
    bodyId: null,
    gapIndex,
    kind: 'quad',
    polygon: [
      { fraction: f0, elevation: top },
      { fraction: f1, elevation: top },
      { fraction: f1, elevation: base },
      { fraction: f0, elevation: base },
    ],
  } as SectionRegion
}

/** Zeroed diagnostics with only the fields a test cares about overridden. */
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

/** A hierarchical fill result with only the fields a test cares about set. */
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

const ALONG_M = [0, 10] // one gap, 10 m wide

describe('clauses2dForSection — no hierarchical fill ran', () => {
  it('reports all three clauses not-evaluated, with a reason, and no entries', () => {
    const input: SectionClause2dInput = {
      sectionId: 's1',
      sectionName: 'Cross-section 1',
      hierarchical: undefined,
      lithoRegions: [],
      alongM: ALONG_M,
    }
    const out = clauses2dForSection(input)
    expect(out).toHaveLength(3)
    for (const clause of out) {
      expect(clause.status).toBe('not-evaluated')
      expect(clause.entries).toEqual([])
      expect(clause.notEvaluatedReason).toBeTruthy()
    }
    expect(out.map((c) => c.key).sort()).toEqual(
      ['area-conservation', 'cause-closure', 'edge-reach'].sort(),
    )
  })
})

describe('clauses2dForSection — clause 1 (area-conservation)', () => {
  it('passes when classed + unclassed cover equals the litho cover', () => {
    const lithoRegions = [box(0, 0, 1, 0, 10)] // 10 m wide gap * 10 m tall = 100 m2
    const hier = hierarchical({
      regions: [box(0, 0, 0.5, 0, 10)], // half the gap, 10 m tall = 50 m2
      lithoFallback: [box(0, 0.5, 1, 0, 10)], // the other half = 50 m2 -> together 100 m2
    })
    const input: SectionClause2dInput = {
      sectionId: 's1',
      sectionName: 'Cross-section 1',
      hierarchical: hier,
      lithoRegions,
      alongM: ALONG_M,
    }
    const clause = clauses2dForSection(input).find((c) => c.key === 'area-conservation')!
    expect(clause.status).toBe('pass')
    expect(clause.entries).toEqual([])
  })

  it('fails with exactly one named entry when a gap comes up short', () => {
    const lithoRegions = [box(0, 0, 1, 0, 10)] // 100 m2 of cover
    const hier = hierarchical({
      regions: [box(0, 0, 0.5, 0, 10)], // classed: 50 m2
      lithoFallback: [], // unclassed: 0 m2 -> 50 m2 missing, way past epsilon
    })
    const input: SectionClause2dInput = {
      sectionId: 's7',
      sectionName: 'Tie-section 7',
      hierarchical: hier,
      lithoRegions,
      alongM: ALONG_M,
    }
    const clause = clauses2dForSection(input).find((c) => c.key === 'area-conservation')!
    expect(clause.status).toBe('fail')
    expect(clause.entries).toHaveLength(1)
    const entry = clause.entries[0]
    expect(entry.section_id).toBe('s7')
    expect(entry.gap_index).toBe(0)
    expect(entry.label).toContain('Tie-section 7')
    expect(entry.label).toContain('gap 0')
    expect(entry.measure?.unit).toBe('m2')
    expect(entry.measure?.value).toBeCloseTo(50, 6)
  })
})

describe('clauses2dForSection — clause 2 (edge-reach)', () => {
  it('passes when the hierarchical fill reports no edge-reach violations', () => {
    const hier = hierarchical({ diagnostics: diagnostics({ edgeReachViolations: [] }) })
    const input: SectionClause2dInput = {
      sectionId: 's1',
      sectionName: 'Cross-section 1',
      hierarchical: hier,
      lithoRegions: [],
      alongM: ALONG_M,
    }
    const clause = clauses2dForSection(input).find((c) => c.key === 'edge-reach')!
    expect(clause.status).toBe('pass')
    expect(clause.entries).toEqual([])
  })

  it('fails with exactly one named entry per reported violation — never re-derived', () => {
    const hier = hierarchical({
      diagnostics: diagnostics({
        edgeReachViolations: [
          { gapIndex: 3, edge: 1, fraction: 0.998, coverM: 2.5, filledM: 0 },
        ],
      }),
    })
    const input: SectionClause2dInput = {
      sectionId: 's7',
      sectionName: 'Tie-section 7',
      hierarchical: hier,
      lithoRegions: [],
      alongM: ALONG_M,
    }
    const clause = clauses2dForSection(input).find((c) => c.key === 'edge-reach')!
    expect(clause.status).toBe('fail')
    expect(clause.entries).toHaveLength(1)
    const entry = clause.entries[0]
    expect(entry.section_id).toBe('s7')
    expect(entry.gap_index).toBe(3)
    expect(entry.label).toContain('Tie-section 7')
    expect(entry.label).toContain('gap 3')
    expect(entry.label.toLowerCase()).toContain('right')
    expect(entry.measure?.unit).toBe('m')
    expect(entry.measure?.value).toBeCloseTo(2.5, 6)
  })
})

describe('clauses2dForSection — clause 3 (cause-closure)', () => {
  it('passes when the hierarchical fill reports no totality violations', () => {
    const hier = hierarchical({ diagnostics: diagnostics({ totalityViolations: [] }) })
    const input: SectionClause2dInput = {
      sectionId: 's1',
      sectionName: 'Cross-section 1',
      hierarchical: hier,
      lithoRegions: [],
      alongM: ALONG_M,
    }
    const clause = clauses2dForSection(input).find((c) => c.key === 'cause-closure')!
    expect(clause.status).toBe('pass')
    expect(clause.entries).toEqual([])
  })

  it('fails with exactly one named entry when ground is left unanswered', () => {
    const hier = hierarchical({
      diagnostics: diagnostics({
        totalityViolations: [{ gapIndex: 12, faces: 2, areaM2: 3.4 }],
      }),
    })
    const input: SectionClause2dInput = {
      sectionId: 's7',
      sectionName: 'Tie-section 7',
      hierarchical: hier,
      lithoRegions: [],
      alongM: ALONG_M,
    }
    const clause = clauses2dForSection(input).find((c) => c.key === 'cause-closure')!
    expect(clause.status).toBe('fail')
    expect(clause.entries).toHaveLength(1)
    const entry = clause.entries[0]
    expect(entry.label).toBe(
      'Tie-section 7, gap 12: 3.4 m² of litho cover is neither classed nor accounted for ' +
        '(2 unanswered loops)',
    )
    expect(entry.measure?.value).toBeCloseTo(3.4, 6)
  })

  it('CRY-WOLF GUARD: a gap with real unclassed area but NO banded run stays silent', () => {
    // This is exactly the shape fillTotality.ts produces for an out-of-scope
    // gap: totalityViolationOf returns null when `input.run === null`, so
    // there is real lithoFallback area here (the litho cover minus nothing
    // classed) but the diagnostics' totalityViolations is empty by
    // construction. Clause 3 must never re-derive "is there unclassed
    // ground" from lithoFallback directly — that would break the silence
    // the owner ruled an un-divided borehole is entitled to (2026-08-15).
    const lithoRegions = [box(0, 0, 1, 0, 10)] // 100 m2 of litho cover
    const hier = hierarchical({
      regions: [], // nothing classed
      lithoFallback: [box(0, 0, 1, 0, 10)], // the WHOLE gap reads unclassed
      diagnostics: diagnostics({ totalityViolations: [] }), // yet the law is silent
    })
    const input: SectionClause2dInput = {
      sectionId: 's9',
      sectionName: 'Cross-section 9',
      hierarchical: hier,
      lithoRegions,
      alongM: ALONG_M,
    }
    const clause = clauses2dForSection(input).find((c) => c.key === 'cause-closure')!
    expect(clause.status).toBe('pass')
    expect(clause.entries).toEqual([])
  })
})
