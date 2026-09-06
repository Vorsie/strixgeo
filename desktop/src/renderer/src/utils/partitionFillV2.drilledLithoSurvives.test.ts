/**
 * partitionFillV2.drilledLithoSurvives.test.ts — SAFE-DEFAULT REPAIR gate (owner ruling 2026-07-26:
 * "run the current model, find the gaps, and re-emit the onlaps that were deleted").
 *
 * THE INVARIANT. A DRILLED unit must render its OWN litho at its OWN column edge — the column is
 * ground truth (ruling 8k). The 8m same-litho onlap suppression + the formation-global ``bandFids``
 * seam suppression could combine to flood a drilled unit with a FOREIGN litho (TS7-g0 clay → silt:
 * data loss). ``computeSectionFillV2`` now runs the fill, ``detectFloodedUnits`` finds such units,
 * and re-runs with them demoted to corr-0 (``forceLensUnits``) so the drilled litho survives as a
 * LENS (owner 2026-09-04 "zero ties = lens"), never a forced onlap.
 *
 * This gate does NOT pin onlap-vs-merge geometry (the clean-case merge engine is unchanged) — it
 * asserts the invariant the repair protects: a drilled unit is never painted a different litho at
 * its own column. Flag-ON path. RED on the pre-repair engine, GREEN after.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { type CorrelationEdge, type PartitionColumn, type PartitionPoint, type SectionRegion } from './sectionPartition'
import { computeSectionFillV2 } from './partitionFillV2'
import { computeSectionFillV2WithConflicts } from './partitionFillV2/computeSectionFillV2'
import { detectFloodedUnits } from './partitionFillV2/detectFloodedUnits'
import { forceLensKey } from './partitionFillV2/forceLensUnits'
import { type ColumnGeom } from './partitionFillV2/sectionGeom'
import { setTwoSidedTerminations } from './partitionFillV2/tileFlags'

const HERE = dirname(fileURLToPath(import.meta.url))
const INPUT = resolve(HERE, '../../../../..', 'scripts/diag_allsections_input.json')

function pointInPoly(poly: readonly PartitionPoint[], f: number, e: number): boolean {
  let inside = false
  const n = poly.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i].fraction, yi = poly[i].elevation, xj = poly[j].fraction, yj = poly[j].elevation
    if (yi > e !== yj > e && f < ((xj - xi) * (e - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function fillFlagOn(columns: PartitionColumn[], edges: CorrelationEdge[], alongM: number[]): SectionRegion[] {
  const prev = setTwoSidedTerminations(true)
  try {
    return computeSectionFillV2(columns, edges, undefined, alongM)
  } finally {
    setTwoSidedTerminations(prev)
  }
}

/** The formation(s) covering a near-column sample of a drilled unit's band. */
function coverAtColumn(regions: SectionRegion[], gap: number, frac: number, elev: number): string[] {
  return regions.filter((r) => r.gapIndex === gap && pointInPoly(r.polygon, frac, elev)).map((r) => r.formationId)
}

// ---------------------------------------------------------------------------
// (1) DETECTION UNIT TEST — detectFloodedUnits flags a drilled unit whose OWN column band is
// covered by a foreign formation, and leaves a correctly-rendered unit alone.
// ---------------------------------------------------------------------------
describe('detectFloodedUnits flags a foreign-painted drilled unit', () => {
  const SILT = 'SILT'
  const KLEI = 'KLEI'
  // One gap, two columns. Left column drilled KLEI over el 3..6 (above a deep TD). A single SILT
  // region covers the whole gap el 0..10 full width — so the drilled KLEI at frac~0 el~4.5 is
  // painted SILT (the data-loss shape). The right column is trivial (no flood there).
  const mkCol = (id: string, units: { layerId: string; f: string; top: number; base: number }[]): ColumnGeom =>
    ({
      investigationId: id,
      x: id === 'L' ? 0 : 50,
      surfaceElevM: 10,
      units: units.map((u) => ({ layerId: u.layerId, formationId: u.f, bodyId: null, topElev: u.top, baseElev: u.base })),
    }) as unknown as ColumnGeom
  const columns = [
    mkCol('L', [{ layerId: 'lk', f: KLEI, top: 6, base: 3 }, { layerId: 'ld', f: SILT, top: 3, base: -8 }]),
    mkCol('R', [{ layerId: 'rk', f: KLEI, top: 6, base: 3 }, { layerId: 'rd', f: SILT, top: 3, base: -8 }]),
  ]
  const box = (f0: number, f1: number, e0: number, e1: number, form: string): SectionRegion =>
    ({
      gapIndex: 0, formationId: form, bodyId: null, kind: 'quad',
      polygon: [
        { fraction: f0, elevation: e1 }, { fraction: f1, elevation: e1 },
        { fraction: f1, elevation: e0 }, { fraction: f0, elevation: e0 },
      ],
    }) as unknown as SectionRegion

  it('flags the left KLEI painted SILT full-width', () => {
    const regions = [box(0, 1, -8, 10, SILT)] // one SILT box floods the whole gap
    const flagged = detectFloodedUnits(regions, columns)
    expect(flagged.has(forceLensKey('lk', 0, 'left')), 'left KLEI flooded by SILT is flagged').toBe(true)
  })

  it('does NOT flag a KLEI correctly rendered as KLEI at its column', () => {
    const regions = [box(0, 1, 3, 6, KLEI), box(0, 1, -8, 3, SILT)] // KLEI band renders KLEI
    const flagged = detectFloodedUnits(regions, columns)
    expect(flagged.has(forceLensKey('lk', 0, 'left')), 'correctly-rendered KLEI is not flagged').toBe(false)
  })
})

// ---------------------------------------------------------------------------
// (2) REAL SECTION — TS7 gap 0 (the reported defect). The drilled clay (col0-u3 el 3.14..6.30,
// col1-u1 el 3.80..4.84) must render clay at its own column, never silt.
// ---------------------------------------------------------------------------
interface RawUnit { layerId: string; topDepthM: number; baseDepthM: number; formationId: string; bodyId: string | null }
interface RawCol { investigationId: string; surfaceElevM: number | null; units: RawUnit[] }
interface RawSection { sectionId: string; name: string; columns: RawCol[]; edges: { a: string; b: string; aSide?: string; bSide?: string }[]; alongM: number[] }

describe('safe default: TS7 gap0 drilled clay is not flooded by silt (real data)', () => {
  const present = existsSync(INPUT)
  const maybe = present ? it : it.skip
  const SILT = '019e940a-4b4e-7806-aa41-5831b60f2e06'
  const KLEI = '019e940a-4b50-7f69-af85-2354e519bb43'

  function prepareTS7(): { columns: PartitionColumn[]; edges: CorrelationEdge[]; alongM: number[] } {
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as { sections: RawSection[] }
    const sec = raw.sections.find((s) => s.name === 'Tie-section 7')!
    const keep = sec.columns.filter((c) => c.surfaceElevM != null && c.units.length > 0)
    const columns: PartitionColumn[] = keep.map((c) => ({
      investigationId: c.investigationId, surfaceElevM: c.surfaceElevM as number, units: c.units,
    }))
    const alongM = sec.columns
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.surfaceElevM != null && c.units.length > 0)
      .map(({ i }) => sec.alongM[i])
    const edges: CorrelationEdge[] = sec.edges.map((e) => ({
      a: e.a, b: e.b, aSide: (e.aSide ?? 'top') as 'top' | 'base', bSide: (e.bSide ?? 'top') as 'top' | 'base',
    }))
    return { columns, edges, alongM }
  }

  maybe('left clay (el ~4.7 @ frac 0) renders clay, not silt', () => {
    const { columns, edges, alongM } = prepareTS7()
    const here = coverAtColumn(fillFlagOn(columns, edges, alongM), 0, 0.02, 4.7)
    expect(here, 'drilled left clay renders clay (not flooded by silt)').toContain(KLEI)
    expect(here, 'drilled left clay is NOT painted silt').not.toContain(SILT)
  })

  maybe('right clay (el ~4.3 @ frac 1) renders clay, not silt', () => {
    const { columns, edges, alongM } = prepareTS7()
    const here = coverAtColumn(fillFlagOn(columns, edges, alongM), 0, 0.98, 4.3)
    expect(here, 'drilled right clay renders clay (not flooded by silt)').toContain(KLEI)
    expect(here, 'drilled right clay is NOT painted silt').not.toContain(SILT)
  })

  maybe('TS7 no longer needs the repair — zero review flags is the truthful state', () => {
    // FIXTURE HISTORY (2026-08-18 diagnosis of the long-standing red): this case originally
    // asserted flags > 0 — a proxy for "the repair FIRED on TS7". The campaign's engine work has
    // since fixed the TS7 flood AT SOURCE: the two invariant cases above prove the drilled clays
    // render clay with no repair, so the repair loop finds nothing and zero flags is correct —
    // a flag here now would be a false "correlate me" nag on a healthy render. The mechanism
    // itself stays pinned twice: the synthetic detection suite above, and the live-repair case
    // below on the section that still needs it.
    const { columns, edges, alongM } = prepareTS7()
    const prev = setTwoSidedTerminations(true)
    try {
      const { reviewFlags } = computeSectionFillV2WithConflicts(columns, edges, undefined, alongM)
      expect(reviewFlags, 'a source-fixed section carries no repair flags').toEqual([])
    } finally {
      setTwoSidedTerminations(prev)
    }
  })

  maybe('Tie-section 11 no longer needs the repair either — the enclosed-lens flood FP is fixed at source', () => {
    // FIXTURE HISTORY. TS11 was the LAST section where the flooded-unit repair still fired (the
    // live pin that a repair reaches the UI as review flags). It fired on a FALSE POSITIVE, the same
    // shape the owner reported on Cross-section 3 (2026-09-06): the merged KLEI band [4.60..10.89]
    // ENCLOSES a VEEN lens, and ``detectFloodedUnits`` sampled the band's near-column interior —
    // which the VEEN lens (hugging the column, apex ~0.45) covered — so it mis-read the KLEI band as
    // flooded by VEEN and forced it to a lens, emptying the band interior. The fix (a lens is an
    // enclosed-minority OVERLAY, excluded from the flood check) heals TS11 exactly as it heals CS3:
    // zero repair flags, and the drilled KLEI band renders KLEI with the VEEN as a lens inside.
    //
    // The repair MECHANISM stays pinned by the synthetic detection suite above (a real QUAD flood is
    // still flagged) and by the always-on ground-truth overpaint gate
    // (partitionFillV2.groundTruth.diag.test.ts). No real section on the current extraction needs it —
    // as with TS7, "zero review flags is the truthful state" now that the flood is fixed at source.
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as { sections: RawSection[] }
    const sec = raw.sections.find((s) => s.name === 'Tie-section 11')!
    const keep = sec.columns.filter((c) => c.surfaceElevM != null && c.units.length > 0)
    const columns: PartitionColumn[] = keep.map((c) => ({
      investigationId: c.investigationId, surfaceElevM: c.surfaceElevM as number, units: c.units,
    }))
    const alongM = sec.columns
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.surfaceElevM != null && c.units.length > 0)
      .map(({ i }) => sec.alongM[i])
    const edges: CorrelationEdge[] = sec.edges.map((e) => ({
      a: e.a, b: e.b, aSide: (e.aSide ?? 'top') as 'top' | 'base', bSide: (e.bSide ?? 'top') as 'top' | 'base',
    }))
    const prev = setTwoSidedTerminations(true)
    try {
      const { regions, reviewFlags } = computeSectionFillV2WithConflicts(columns, edges, undefined, alongM)
      expect(reviewFlags, 'TS11 carries no repair flags — the enclosed-lens flood FP is fixed').toEqual([])
      const gap0 = regions.filter((r) => r.gapIndex === 0)
      // The drilled KLEI matrix band survives: a KLEI quad spans the gap over the enclosing band's
      // elevation (never forced to a lens), with the VEEN drawn as a lens inside it.
      const kleiSpansGap = gap0.some((r) => {
        if (r.formationId !== KLEI || r.kind !== 'quad') return false
        let fMin = Infinity, fMax = -Infinity, eMin = Infinity, eMax = -Infinity
        for (const p of r.polygon) {
          fMin = Math.min(fMin, p.fraction); fMax = Math.max(fMax, p.fraction)
          eMin = Math.min(eMin, p.elevation); eMax = Math.max(eMax, p.elevation)
        }
        return fMin <= 0.02 && fMax >= 0.98 && eMin < 6 && eMax > 10
      })
      expect(kleiSpansGap, 'the drilled KLEI band spans the gap (not destroyed by a false flood repair)').toBe(true)
      expect(gap0.some((r) => r.kind === 'lens'), 'the enclosed VEEN renders as a lens inside the band').toBe(true)
    } finally {
      setTwoSidedTerminations(prev)
    }
  })
})
