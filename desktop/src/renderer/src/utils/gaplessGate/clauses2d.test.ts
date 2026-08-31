/**
 * GG1-GG9 — clauses 1-3 of the gapless gate, computed per section.
 *
 * Written FIRST, in the rule's own words, before ``clauses2d.ts`` exists:
 *
 *  - clause 1 (area-conservation): classed + unclassed ground must match the
 *    litho cover geometrically, per gap.
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
 *
 * GG10-GG16 came from the owner's own reading of a real failing report
 * (2026-08-28). He was shown:
 *
 *     Cross-section 2, gap 1: classed + unclassed cover totals 8.42 m2, which
 *       is 0 m2 less than the litho cover's 8.42 m2
 *
 * — a guarantee reported broken "by an amount of nothing", and a "Show me"
 * that opened the section but did not move the view to the gap. So:
 *
 *  - GG10-GG12: a failure ALWAYS states a magnitude the engineer can act on,
 *    and says what this gap's width allowed, while the metre-scale sentences
 *    of clauses 2 and 3 keep reading exactly as they did.
 *  - GG13-GG16: an entry names the gap's own TWO COLUMNS, resolved on the
 *    FRAME's column list at the moment the entry is minted. The gap INDEX is
 *    valid on that list and on no other — passing it across a surface boundary
 *    is what already centred the wrong gap once (``PartitionFillOverlay.
 *    onJumpToConflictGap``), so what travels is names.
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

/** Column names for a one-gap axis — the FRAME's own list, 1:1 with ``ALONG_M``. */
const ONE_GAP_COLUMNS = ['S1', 'S2']

describe('clauses2dForSection — no hierarchical fill ran', () => {
  it('reports all three clauses not-evaluated, with a reason, and no entries', () => {
    const input: SectionClause2dInput = {
      sectionId: 's1',
      sectionName: 'Cross-section 1',
      hierarchical: undefined,
      lithoRegions: [],
      alongM: ALONG_M,
      columnInvestigationIds: ONE_GAP_COLUMNS,
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
      columnInvestigationIds: ONE_GAP_COLUMNS,
    }
    const clause = clauses2dForSection(input).find((c) => c.key === 'area-conservation')!
    expect(clause.status).toBe('pass')
    expect(clause.entries).toEqual([])
  })

  it('passes when subdivided paint overlaps but its covered ground equals litho', () => {
    // The model guarantee is about ground coverage, not the sum of every
    // constituent ring. These two classed regions overlap by 1 m², but their
    // union is precisely the 100 m² litho frame: no litho ground is absent
    // and no paint escapes the frame.
    const lithoRegions = [box(0, 0, 1, 0, 10)]
    const hier = hierarchical({
      regions: [box(0, 0, 0.6, 0, 10), box(0, 0.5, 1, 0, 10)],
      lithoFallback: [],
    })
    const clause = clauses2dForSection({
      sectionId: 's1',
      sectionName: 'Cross-section 1',
      hierarchical: hier,
      lithoRegions,
      alongM: ALONG_M,
      columnInvestigationIds: ONE_GAP_COLUMNS,
    }).find((c) => c.key === 'area-conservation')!

    expect(clause.status).toBe('pass')
    expect(clause.entries).toEqual([])
  })

  it('fails when same-area paint is shifted outside the litho cover', () => {
    // Equal square metres are insufficient: the actual covered ground must be
    // the litho ground. This paint loses 10 m² at the left and invents 10 m²
    // at the right, despite keeping the same total area.
    const lithoRegions = [box(0, 0, 1, 0, 10)]
    const hier = hierarchical({
      regions: [box(0, 0.1, 1.1, 0, 10)],
      lithoFallback: [],
    })
    const clause = clauses2dForSection({
      sectionId: 's1',
      sectionName: 'Cross-section 1',
      hierarchical: hier,
      lithoRegions,
      alongM: ALONG_M,
      columnInvestigationIds: ONE_GAP_COLUMNS,
    }).find((c) => c.key === 'area-conservation')!

    expect(clause.status).toBe('fail')
    expect(clause.entries[0].measure?.value).toBeCloseTo(20, 6)
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
      columnInvestigationIds: ONE_GAP_COLUMNS,
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

  it('fails a material shortfall however wide the gap is', () => {
    // The litho-derived cover must be retained exactly. A wide gap does not
    // make a missing patch acceptable; only a difference finer than the model's
    // own millimetre grid is harmless.
    //
    // The strip left unpainted here is 2 mm wide over a 5 km gap — as close to
    // nothing as this model can still WRITE DOWN. (It used to be 0.1 mm, which
    // no coordinate here can express: every vertex is snapped to 1 mm long
    // before this clause sees it, so that strip never existed in the geometry
    // being compared.)
    const lithoRegions = [box(1, 0, 1, 0, 10)]
    const hier = hierarchical({
      regions: [box(1, 0, 0.9999996, 0, 10)],
      lithoFallback: [],
    })
    const clause = clauses2dForSection({
      sectionId: 'wide-gap',
      sectionName: 'Wide tie-section',
      hierarchical: hier,
      lithoRegions,
      alongM: [0, 5, 5005],
      columnInvestigationIds: OWNER_COLUMNS,
    }).find((c) => c.key === 'area-conservation')!

    expect(clause.status).toBe('fail')
    expect(clause.entries[0].measure?.value).toBeCloseTo(0.02, 6)
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
      columnInvestigationIds: ONE_GAP_COLUMNS,
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
      columnInvestigationIds: ONE_GAP_COLUMNS,
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
      columnInvestigationIds: ONE_GAP_COLUMNS,
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
      columnInvestigationIds: ONE_GAP_COLUMNS,
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
      columnInvestigationIds: ONE_GAP_COLUMNS,
    }
    const clause = clauses2dForSection(input).find((c) => c.key === 'cause-closure')!
    expect(clause.status).toBe('pass')
    expect(clause.entries).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// GG10-GG12 — the failure sentence must not round its own evidence away
//
// Clause 1 compares the two ground covers exactly, so a small real difference
// must still read as a real number rather than the word "0".
// ---------------------------------------------------------------------------

/** The owner's own scene: a ~8.42 m2 cover on a 1 m wide gap, index 1. */
const OWNER_ALONG_M = [0, 5, 6]
const OWNER_COLUMNS = ['S1', 'S4', 'B6']

describe('clause 1 — a broken guarantee is never reported as broken by 0', () => {
  it('GG10 states a real magnitude when the shortfall is smaller than 0.005 m²', () => {
    // 8.42 m2 of cover; 8.4188 m2 classed -> 0.0012 m2 short. Two decimals
    // call that "0"; the sentence must not.
    const lithoRegions = [box(1, 0, 1, 0, 8.42)]
    const hier = hierarchical({ regions: [box(1, 0, 1, 0, 8.4188)], lithoFallback: [] })
    const clause = clauses2dForSection({
      sectionId: 'cs2',
      sectionName: 'Cross-section 2',
      hierarchical: hier,
      lithoRegions,
      alongM: OWNER_ALONG_M,
      columnInvestigationIds: OWNER_COLUMNS,
    }).find((c) => c.key === 'area-conservation')!

    expect(clause.status).toBe('fail')
    const entry = clause.entries[0]
    // The exact complaint: the difference must never render as the word "0".
    expect(entry.label).not.toContain('is 0 m²')
    expect(entry.label).toContain('0.0012 m²')
  })

  it('GG11 names the exact geometric difference without an allowance', () => {
    const lithoRegions = [box(1, 0, 1, 0, 8.42)]
    const hier = hierarchical({ regions: [box(1, 0, 1, 0, 8.4188)], lithoFallback: [] })
    const clause = clauses2dForSection({
      sectionId: 'cs2',
      sectionName: 'Cross-section 2',
      hierarchical: hier,
      lithoRegions,
      alongM: OWNER_ALONG_M,
      columnInvestigationIds: OWNER_COLUMNS,
    }).find((c) => c.key === 'area-conservation')!

    expect(clause.entries[0].label).toBe(
      'Cross-section 2, gap 1: classed + unclassed ground differs from the litho cover by ' +
        '0.0012 m² (geotech 8.42 m²; litho 8.42 m²)',
    )
  })

  it('GG12 keeps a metre-scale exact geometric difference readable', () => {
    // The shared formatter must not grow noise digits on numbers that were
    // already readable: 50 m2 short of 100 m2 stays "50", not "50.0000".
    const lithoRegions = [box(0, 0, 1, 0, 10)]
    const hier = hierarchical({ regions: [box(0, 0, 0.5, 0, 10)], lithoFallback: [] })
    const clause = clauses2dForSection({
      sectionId: 's7',
      sectionName: 'Tie-section 7',
      hierarchical: hier,
      lithoRegions,
      alongM: ALONG_M,
      columnInvestigationIds: ONE_GAP_COLUMNS,
    }).find((c) => c.key === 'area-conservation')!

    expect(clause.entries[0].label).toContain(
      'differs from the litho cover by 50 m² (geotech 50 m²; litho 100 m²)',
    )
  })
})

describe('clauses 2 and 3 — the shared formatter still reads for metres', () => {
  it('GG12b keeps clause 2 readable and never prints a real cover as 0', () => {
    const hier = hierarchical({
      diagnostics: diagnostics({
        edgeReachViolations: [
          { gapIndex: 0, edge: 0, fraction: 0.002, coverM: 2.5, filledM: 0 },
          // Clause 2's budget is zero, so a sub-centimetre cover is a real
          // finding — and reporting it as "0 m" would be the same lie.
          { gapIndex: 1, edge: 1, fraction: 0.998, coverM: 0.0031, filledM: 0 },
        ],
      }),
    })
    const clause = clauses2dForSection({
      sectionId: 's7',
      sectionName: 'Tie-section 7',
      hierarchical: hier,
      lithoRegions: [],
      alongM: OWNER_ALONG_M,
      columnInvestigationIds: OWNER_COLUMNS,
    }).find((c) => c.key === 'edge-reach')!

    expect(clause.entries[0].label).toContain('the litho cover holds 2.5 m there')
    expect(clause.entries[1].label).toContain('the litho cover holds 0.0031 m there')
  })

  it('GG12c keeps clause 3 word-for-word on a metre-scale area', () => {
    const hier = hierarchical({
      diagnostics: diagnostics({ totalityViolations: [{ gapIndex: 1, faces: 2, areaM2: 3.4 }] }),
    })
    const clause = clauses2dForSection({
      sectionId: 's7',
      sectionName: 'Tie-section 7',
      hierarchical: hier,
      lithoRegions: [],
      alongM: OWNER_ALONG_M,
      columnInvestigationIds: OWNER_COLUMNS,
    }).find((c) => c.key === 'cause-closure')!

    expect(clause.entries[0].label).toBe(
      'Tie-section 7, gap 1: 3.4 m² of litho cover is neither classed nor accounted for ' +
        '(2 unanswered loops)',
    )
  })
})

// ---------------------------------------------------------------------------
// GG13-GG16 — every entry names the gap's own two columns, by NAME
// ---------------------------------------------------------------------------

describe('every 2-D entry carries the gap’s own two columns', () => {
  it('GG13 clause 1 names the columns the gap stands between, in axis order', () => {
    const lithoRegions = [box(1, 0, 1, 0, 8.42)]
    const hier = hierarchical({ regions: [box(1, 0, 1, 0, 8.4188)], lithoFallback: [] })
    const clause = clauses2dForSection({
      sectionId: 'cs2',
      sectionName: 'Cross-section 2',
      hierarchical: hier,
      lithoRegions,
      alongM: OWNER_ALONG_M,
      columnInvestigationIds: OWNER_COLUMNS,
    }).find((c) => c.key === 'area-conservation')!

    // Gap 1 stands between the SECOND and THIRD column of the frame's own list.
    expect(clause.entries[0].gap_investigation_ids).toEqual(['S4', 'B6'])
  })

  it('GG14 clauses 2 and 3 name them too, off the same frame list', () => {
    const hier = hierarchical({
      diagnostics: diagnostics({
        edgeReachViolations: [{ gapIndex: 0, edge: 1, fraction: 0.998, coverM: 2.5, filledM: 0 }],
        totalityViolations: [{ gapIndex: 1, faces: 2, areaM2: 3.4 }],
      }),
    })
    const out = clauses2dForSection({
      sectionId: 'cs2',
      sectionName: 'Cross-section 2',
      hierarchical: hier,
      lithoRegions: [],
      alongM: OWNER_ALONG_M,
      columnInvestigationIds: OWNER_COLUMNS,
    })
    expect(out.find((c) => c.key === 'edge-reach')!.entries[0].gap_investigation_ids).toEqual([
      'S1',
      'S4',
    ])
    expect(out.find((c) => c.key === 'cause-closure')!.entries[0].gap_investigation_ids).toEqual([
      'S4',
      'B6',
    ])
  })

  it('GG15 names nothing rather than guessing when the frame cannot place the gap', () => {
    // A violation whose gapIndex falls past the frame's own column list: the
    // entry still reports the defect, but it offers no navigation target it
    // cannot honour. Degrading honestly beats centring on the wrong gap.
    const hier = hierarchical({
      diagnostics: diagnostics({ totalityViolations: [{ gapIndex: 9, faces: 1, areaM2: 1.2 }] }),
    })
    const clause = clauses2dForSection({
      sectionId: 'cs2',
      sectionName: 'Cross-section 2',
      hierarchical: hier,
      lithoRegions: [],
      alongM: OWNER_ALONG_M,
      columnInvestigationIds: OWNER_COLUMNS,
    }).find((c) => c.key === 'cause-closure')!

    expect(clause.entries).toHaveLength(1)
    expect(clause.entries[0].gap_investigation_ids ?? null).toBeNull()
  })

  it('GG16 keeps the gap index on the entry — as a label, never as a way to navigate', () => {
    // The index stays: the sentence says "gap 1" and the engineer quotes it.
    // What it must never be is the thing a caller resolves a position from —
    // it indexes the FRAME's column list and no other, which is why GG13 makes
    // the columns themselves travel.
    const hier = hierarchical({
      diagnostics: diagnostics({ totalityViolations: [{ gapIndex: 1, faces: 1, areaM2: 1.2 }] }),
    })
    const entry = clauses2dForSection({
      sectionId: 'cs2',
      sectionName: 'Cross-section 2',
      hierarchical: hier,
      lithoRegions: [],
      alongM: OWNER_ALONG_M,
      columnInvestigationIds: OWNER_COLUMNS,
    }).find((c) => c.key === 'cause-closure')!.entries[0]

    expect(entry.gap_index).toBe(1)
    expect(entry.gap_investigation_ids).toEqual(['S4', 'B6'])
  })
})

describe('clauses2dForSection — clause 1 (one contact stated twice is not a difference)', () => {
  // The owner's real Cross-section 1, gap 3, reduced to the one thing that
  // matters. His ruling: *"there shouldn't be any mismatch because we pull the
  // litho into the geotech"* -- the geotech SUBDIVIDES the litho, so wherever
  // it cuts, both are describing one piece of ground and the check must read
  // zero.
  //
  // The litho states one sloping contact, column to column. The geotech cuts
  // the gap in the middle, so it has to say where its cut meets that contact.
  // Halfway between 7.509 and 5.21 is 6.3595 -- exactly half a millimetre, and
  // every coordinate here is snapped to a millimetre, so the shared point can
  // only be written 6.359 or 6.360. Neither sits on the straight line the litho
  // drew between the same two columns, and what is left over is a REAL triangle
  // with all three corners on the grid -- half a millimetre thick and 90 m long.
  //
  // Nothing is missing and nothing is painted twice. A difference no wider than
  // the grid the model is drawn on is not a difference.
  const GAP_W = 90.382 // the real gap 3 width, so the magnitude is his
  const LEFT_TOP = 7.509
  const RIGHT_TOP = 5.21
  const CUT_TOP = 6.359 // (7.509 + 5.21) / 2 = 6.3595, written on the mm grid

  function sloping(f0: number, f1: number, y0: number, y1: number): SectionRegion {
    return {
      formationId: 'F',
      bodyId: null,
      gapIndex: 0,
      kind: 'quad',
      polygon: [
        { fraction: f0, elevation: y0 },
        { fraction: f1, elevation: y1 },
        { fraction: f1, elevation: 0 },
        { fraction: f0, elevation: 0 },
      ],
    } as SectionRegion
  }

  it('reads no difference when the geotech cuts a sloping litho contact in the middle', () => {
    const clause = clauses2dForSection({
      sectionId: 'S',
      sectionName: 'CS1',
      // the geotech states the contact as two segments through its own cut
      hierarchical: hierarchical({
        regions: [sloping(0, 0.5, LEFT_TOP, CUT_TOP), sloping(0.5, 1, CUT_TOP, RIGHT_TOP)],
      }),
      // the litho states the same contact as one straight segment
      lithoRegions: [sloping(0, 1, LEFT_TOP, RIGHT_TOP)],
      alongM: [0, GAP_W],
      columnInvestigationIds: ONE_GAP_COLUMNS,
    }).find((c) => c.key === 'area-conservation')!

    expect(clause.entries).toEqual([])
    expect(clause.status).toBe('pass')
  })

  it('still fails, at full size, when the geotech really leaves litho unpainted', () => {
    // Same scene, but the right half is simply not painted. A hole with real
    // WIDTH, which no amount of grid reasoning may explain away -- and the
    // magnitude reported must be the whole hole, never the eroded remnant.
    const clause = clauses2dForSection({
      sectionId: 'S',
      sectionName: 'CS1',
      hierarchical: hierarchical({ regions: [sloping(0, 0.5, LEFT_TOP, CUT_TOP)] }),
      lithoRegions: [sloping(0, 1, LEFT_TOP, RIGHT_TOP)],
      alongM: [0, GAP_W],
      columnInvestigationIds: ONE_GAP_COLUMNS,
    }).find((c) => c.key === 'area-conservation')!

    expect(clause.status).toBe('fail')
    expect(clause.entries[0].measure!.value).toBeCloseTo(261.4, 0)
  })
})

describe('clauses2dForSection — clause 1 (a cover it cannot measure)', () => {
  // Clause 1 runs inside ``buildVoxelRequest``, so anything it throws takes the
  // BUILD BUTTON with it, not just the report. A region whose ring crosses
  // itself -- which an engine bug can emit -- makes the geometry library's
  // symmetric difference throw, and that must never be how the owner finds out.
  //
  // The two wrong answers are crashing and passing. A gap whose cover cannot be
  // measured is REPORTED, and the report says so in those words, because an
  // unmeasured guarantee is an unkept one.
  it('reports a gap it cannot measure instead of throwing or passing it', () => {
    const bowtie: SectionRegion = {
      formationId: 'F',
      bodyId: null,
      gapIndex: 0,
      kind: 'quad',
      // the ring crosses itself between the 2nd and 4th corner
      polygon: [
        { fraction: 0, elevation: 0 },
        { fraction: 1, elevation: 10 },
        { fraction: 1, elevation: 0 },
        { fraction: 0, elevation: 10 },
      ],
    } as SectionRegion

    const clause = clauses2dForSection({
      sectionId: 's1',
      sectionName: 'Cross-section 1',
      hierarchical: hierarchical({ regions: [bowtie] }),
      lithoRegions: [box(0, 0, 1, 0, 10)],
      alongM: ALONG_M,
      columnInvestigationIds: ONE_GAP_COLUMNS,
    }).find((c) => c.key === 'area-conservation')!

    expect(clause.status).toBe('fail')
    expect(clause.entries).toHaveLength(1)
    expect(clause.entries[0].label).toContain('could not be measured')
    expect(clause.entries[0].gap_index).toBe(0)
    // No number is honest here: nothing was successfully measured.
    expect(clause.entries[0].measure ?? null).toBeNull()
  })
})
