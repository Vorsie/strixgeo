/**
 * partitionFillV2.seedFill.test.ts — SEED_FILL_MANDATE Step 2 (owner-language RED tests) +
 * Step 3 acceptance (they turn GREEN under the flag-ON seed paint path).
 *
 * The owner's rule (mandate "The decision is already made"): draw the literal termination
 * linework, snap+split+trace the bounded faces, then paint each face as a paint bucket from the
 * PICKED-UNIT column edge on that face's boundary. The line network decides containment; picked
 * column edges decide lithology. A post-hoc label heuristic (length vote / flood / enclosure /
 * facing sample) is forbidden.
 *
 * These cases say, in the owner's words:
 *   (a) a face bounded by a single picked-unit's column edges paints THAT unit's formation,
 *       regardless of what synthetic flood/vote labels carried — a real instance from the
 *       measured 54-mismatch list (``diag_seed_gate.json``): the current engine paints the vote
 *       formation, the seed path paints the column seed.
 *   (b) a zero-seed fillable face is reported as a topology-defect, never invented — a real
 *       flood/substrate instance from the zero-seed-defect list.
 *   (c) a multi-seed face (two distinct column-seed formations) is reported as a topology-defect,
 *       never length-voted — pinned on a hand-built arrangement since 2026-08-18 (all 9 measured
 *       real-data instances healed; see the case's fixture-history note).
 *   (d) flag-OFF output is byte-identical (the campaign safety line).
 *   (e) the ``literalCorr`` (c)/(d) clay faces seed CLAY (not the SILT the vote paints) — the B3
 *       "SILT termination continued by a CLAY-labelled wedge" inverse, on a deterministic fixture.
 *
 * RED-first discipline (mandate Step 2): every case here was run against the CURRENT flag-ON
 * ``labelFaces`` (the vote/flood engine) and recorded RED before the seed path was implemented.
 *
 * Run (desktop/):
 *   npx vitest run src/renderer/src/utils/partitionFillV2.seedFill.test.ts --disableConsoleIntercept
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { type CorrelationEdge, type PartitionColumn } from './sectionPartition'
import { buildArrangement } from './partitionFillV2/arrangement'
import { emitCurves } from './partitionFillV2/emitCurves'
import { labelFaces, type LabelledFace } from './partitionFillV2/labelFaces'
import { buildSectionInput } from './partitionFillV2/sectionGeom'
import {
  buildSegCurveMap,
  classifyFaceSeed,
  type SeedClass,
} from './partitionFillV2/seedClassifier'
import { setTwoSidedTerminations } from './partitionFillV2/tileFlags'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const INPUT = resolve(REPO_ROOT, 'scripts/diag_allsections_input.json')

// Formation ids from the real CS1 extraction (diag_allsections_input.json), owner-traced.
const SILT = '019e940a-4b4e-7806-aa41-5831b60f2e06'
const KLEI = '019e940a-4b50-7f69-af85-2354e519bb43'

afterEach(() => setTwoSidedTerminations(false))

// ---------------------------------------------------------------------------
// Raw input shapes (mirror the extractor / diag).
// ---------------------------------------------------------------------------
interface RawUnit { layerId: string; topDepthM: number; baseDepthM: number; formationId: string; bodyId: string | null }
interface RawCol { investigationId: string; surfaceElevM: number | null; units: RawUnit[] }
interface RawSection { sectionId: string; name: string; columns: RawCol[]; alongM: number[]; edges: { a: string; b: string; aSide?: string; bSide?: string }[] }

interface Prepared {
  name: string
  columns: PartitionColumn[]
  edges: CorrelationEdge[]
  alongM: number[]
}

function prepareRealSection(sec: RawSection): Prepared {
  const keep = sec.columns
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.surfaceElevM != null && c.units.length > 0)
  const columns: PartitionColumn[] = keep.map(({ c }) => ({
    investigationId: c.investigationId,
    surfaceElevM: c.surfaceElevM as number,
    units: c.units,
  }))
  const alongM = keep.map(({ i }) => sec.alongM[i])
  const edges: CorrelationEdge[] = sec.edges.map((e) => ({
    a: e.a,
    b: e.b,
    aSide: (e.aSide ?? 'top') as 'top' | 'base',
    bSide: (e.bSide ?? 'top') as 'top' | 'base',
  }))
  return { name: sec.name, columns, edges, alongM }
}

/**
 * One face's paired seed classification + current-engine paint, keyed by rounded bounds so a
 * test can locate a specific real-data face (the diag's ``diagId`` shape).
 */
interface FaceProbe {
  xLo: number
  elLo: number
  classification: SeedClass
  seedFormations: string[]
  paint: string | null
}

const r2 = (x: number): number => Math.round(x * 100) / 100

/**
 * Run the ACTUAL pre-slice pipeline (buildSectionInput -> emitCurves -> buildArrangement ->
 * faces -> seed classifier + current labelFaces) flag-ON, and return a probe per face. This
 * threads the SAME faces through both the seed classifier and the current paint so a case can
 * assert "seed says X, current paint says Y" on a concrete face.
 */
function probeSection(p: Prepared): FaceProbe[] {
  const prev = setTwoSidedTerminations(true)
  try {
    const section = buildSectionInput(p.columns, p.edges, undefined, p.alongM)
    if (section.columns.length < 2) return []
    const { curves, lensLabels } = emitCurves(section)
    const arr = buildArrangement(curves)
    const segCurve = buildSegCurveMap(arr)
    // Route through the ENGINE's seed path: pass the arrangement so the flag-ON labelFaces
    // paints from column seeds (single-seed) / keeps interim paint (defect). The probe compares
    // that engine paint to the shared classifier's own seed verdict on the SAME faces.
    const labelled: LabelledFace[] = labelFaces(arr.faces, section.columns, lensLabels, arr)
    const paintByFace = new Map<(typeof arr.faces)[number], string>()
    for (const lf of labelled) paintByFace.set(lf.face, lf.formationId)
    return arr.faces.map((face) => {
      const seed = classifyFaceSeed(face, segCurve, section.columns)
      const b = seed.bounds
      return {
        xLo: r2(b.xLo),
        elLo: r2(b.elLo),
        classification: seed.classification,
        seedFormations: seed.seedFormations,
        paint: paintByFace.get(face) ?? null,
      }
    })
  } finally {
    setTwoSidedTerminations(prev)
  }
}

function findByBounds(probes: readonly FaceProbe[], xLo: number, elLo: number): FaceProbe | undefined {
  return probes.find((pr) => Math.abs(pr.xLo - xLo) < 0.05 && Math.abs(pr.elLo - elLo) < 0.05)
}

// ---------------------------------------------------------------------------
// The deterministic literalCorr (c)/(d) fixture (mandate case (e)) — the col18 three-piece
// column (CLAY host split by SILT interbeds), same as the seed gate.
// ---------------------------------------------------------------------------
function literalCorrCD(): Prepared {
  let s = 0
  const L = (): string => `L${s++}`
  const CLAY = 'clay', SILT_F = 'silt'
  const mk = (
    top: number, base: number, f: string, layerId: string, body: string,
  ): PartitionColumn['units'][number] => ({ topDepthM: top, baseDepthM: base, formationId: f, layerId, bodyId: body })
  const lClayTop = L(), lSilt = L(), lClayBot = L()
  const midTop = L(), midSilt1 = L(), midMid = L(), midSilt2 = L(), midBot = L()
  const rClayTop = L(), rSilt = L(), rClayBot = L()
  const columns: PartitionColumn[] = [
    {
      investigationId: 'L',
      surfaceElevM: 12,
      units: [mk(0, 2, CLAY, lClayTop, 'clay-L-top'), mk(2, 8, SILT_F, lSilt, 'silt-L'), mk(8, 12, CLAY, lClayBot, 'clay-L-bot')],
    },
    {
      investigationId: 'M',
      surfaceElevM: 12,
      units: [
        mk(0, 2, CLAY, midTop, 'clay-M-top'),
        mk(2, 4, SILT_F, midSilt1, 'silt-M-1'),
        mk(4, 6, CLAY, midMid, 'clay-M-mid'),
        mk(6, 8, SILT_F, midSilt2, 'silt-M-2'),
        mk(8, 12, CLAY, midBot, 'clay-M-bot'),
      ],
    },
    {
      investigationId: 'R',
      surfaceElevM: 12,
      units: [mk(0, 2, CLAY, rClayTop, 'clay-R-top'), mk(2, 8, SILT_F, rSilt, 'silt-R'), mk(8, 12, CLAY, rClayBot, 'clay-R-bot')],
    },
  ]
  const edges: CorrelationEdge[] = [
    { a: midTop, b: lClayTop, aSide: 'top', bSide: 'top' },
    { a: midBot, b: rClayBot, aSide: 'base', bSide: 'base' },
  ]
  return { name: 'literalCorr (c)/(d)', columns, edges, alongM: [0, 40, 80] }
}

const has = existsSync(INPUT)

// ===========================================================================
// (a) A single-seed face paints its column-seed formation, not the synthetic vote label.
// ===========================================================================
;(has ? describe : describe.skip)('(a) a genuine enclosed lens owns its minority litho as a real seed (ruling 8r + Step 4.1 id-split)', () => {
  // CS1#11 (x=23.45, el 6.84): MEASURED (S42.2b) — the raw picks here are SILT/KLEI/SILT, so
  // this face is the picked KLEI lens's OWN triangle (gap0 enclosed lens el [6.84..8.08]).
  // BEFORE Step 4.1: its sole column-edge "seed" read SILT (the merged matrix) — a MERGE-ARTIFACT
  // seed, kept as merged-minority. AFTER Step 4.1 (the COLUMN-VERTICAL ID SPLIT): the merged host's
  // vertical is emitted per RAW sub-segment, so the lens interval carries a ``col<ci>:lens<j>``
  // curve id that resolves to the lens's OWN raw formation (KLEI). Owner rule 8r ("lines before
  // the merge"): the picked KLEI unit's own line IS its seed now. The face is a GENUINE single-seed
  // KLEI face — seed == paint == the minority, no merge-artifact keep.
  it('the CS1 gap0 enclosed KLEI lens is a genuine single-seed KLEI face (seed == paint == KLEI)', () => {
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as { sections: RawSection[] }
    const cs1 = prepareRealSection(raw.sections.find((s) => s.name === 'Cross-section 1')!)
    const probes = probeSection(cs1)
    const face = findByBounds(probes, 23.45, 6.84)
    expect(face, 'the CS1 x=23.45 el=6.84 enclosed-lens face exists').toBeTruthy()
    // The id-split gives the lens interval its own column edge -> the classifier reads KLEI directly.
    expect(face!.classification, 'the lens owns a genuine single seed').toBe('single-seed')
    expect(face!.seedFormations[0], 'the genuine seed reads KLEI (the picked lens litho)').toBe(KLEI)
    // THE OWNER RULE (8r): the picked lens paints KLEI, now from its OWN seed (not a merge keep).
    expect(face!.paint, 'the enclosed KLEI lens paints KLEI').toBe(KLEI)
  })
})

// ===========================================================================
// (b) A zero-seed fillable face is a topology-defect, never painted from a synthetic label.
// ===========================================================================
;(has ? describe : describe.skip)('(b) a zero-seed fillable face is a topology-defect, never invented', () => {
  // Tie-section 6 (x=0, elLo=-10.45): a sub-TD substrate face bounded by btcurtain0R/btfloor0/tie3
  // — no column edge. Owner rule: "zero formations -> never invent a lithology; classify explicitly
  // and fail the gate if it lies in the fillable domain." The seed classifier must call it
  // zero-seed-defect (its 8n carry-seed RESOLUTION is a separate, recorded layer). Fixture history:
  // the original -4.13 flood face moved to -4.595 in S49 (flood apex fix) and RESOLVED to
  // single-seed in S56 (the 8l band-promotion delete reconnected it to a real column seed — an
  // improvement, so the rule-pin moves to this still-zero-seed substrate face; the RULE never moved).
  it('a substrate-bounded face with no column seed classifies zero-seed-defect', () => {
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as { sections: RawSection[] }
    const tie6 = prepareRealSection(raw.sections.find((s) => s.name === 'Tie-section 6')!)
    const probes = probeSection(tie6)
    const face = findByBounds(probes, 0, -10.45)
    expect(face, 'the Tie-6 x=0 el=-10.45 substrate face exists').toBeTruthy()
    expect(face!.classification, 'a substrate face has no column seed -> zero-seed-defect').toBe('zero-seed-defect')
    expect(face!.seedFormations.length, 'it has ZERO column-seed formations').toBe(0)
  })
})

// ===========================================================================
// (c) A multi-seed face is a topology-defect, never length-voted.
// ===========================================================================
describe('(c) a multi-seed face is a topology-defect, never length-voted', () => {
  // Owner rule: "two or more formations -> fail the gate; repair the linework, never vote/select
  // a label." Originally pinned on Tie-section 11#10 (x=0, el=7.51) — one of the 9 measured
  // multi-seed faces. FIXTURE HISTORY (same move as case (b)'s S49/S56 note): a 2026-08-18
  // all-sections scan found ZERO multi-seed faces left on the current extraction — the campaign's
  // linework repairs healed every one, and the engine now splits a cross-formation top pair into
  // single-seed faces, so NO real-data instance of this defect exists to point at. The RULE never
  // moved; the pin moves to a hand-built arrangement whose one face genuinely owns non-zero-length
  // column edges of TWO formations — the exact shape the classifier must refuse to vote on.
  it('a face owning column edges of two different formations classifies multi-seed-defect', () => {
    const curves = [
      { id: 'col0:u0', kind: 'column-vertical', points: [{ x: 0, y: 10 }, { x: 0, y: 5 }] },
      { id: 'col1:u0', kind: 'column-vertical', points: [{ x: 40, y: 10 }, { x: 40, y: 5 }] },
      { id: 'surface', kind: 'contact', points: [{ x: 0, y: 10 }, { x: 40, y: 10 }] },
      { id: 'floor', kind: 'contact', points: [{ x: 0, y: 5 }, { x: 40, y: 5 }] },
    ]
    const arr = buildArrangement(curves as never)
    const segCurve = buildSegCurveMap(arr)
    const cols = [
      { investigationId: 'L', x: 0, surfaceElevM: 10, units: [{ layerId: 'l0', formationId: KLEI, bodyId: null, topElev: 10, baseElev: 5 }] },
      { investigationId: 'R', x: 40, surfaceElevM: 10, units: [{ layerId: 'r0', formationId: SILT, bodyId: null, topElev: 10, baseElev: 5 }] },
    ]
    const seeds = arr.faces.map((face) => classifyFaceSeed(face, segCurve, cols as never))
    expect(seeds.length, 'the rectangle traces exactly one bounded face').toBe(1)
    expect(seeds[0].classification, 'two column-edge formations -> multi-seed-defect').toBe('multi-seed-defect')
    expect(seeds[0].seedFormations, 'both formations are named, sorted').toEqual([SILT, KLEI].sort())
  })
})

// ===========================================================================
// (e) The literalCorr (c)/(d) clay faces seed CLAY, not the SILT the vote paints.
// ===========================================================================
describe('(e) literalCorr (c)/(d): an enclosed SILT interbed lens owns SILT as a real seed (ruling 8r + Step 4.1 id-split)', () => {
  // MEASURED (S42.2b): the face at x[0..18] el[4..10] is a SILT interbed lens's own face inside
  // the merged CLAY host (the fixture's silt-M-2 [el 4..6] family). BEFORE Step 4.1: its sole
  // column-edge "seed" read CLAY (the merged matrix) — a MERGE-ARTIFACT. AFTER Step 4.1 (the
  // COLUMN-VERTICAL ID SPLIT): the merged CLAY host's vertical is emitted per raw sub-segment, so
  // the SILT lens interval carries a ``col<ci>:lens<j>`` id resolving to SILT. Owner rule 8r: the
  // picked SILT interbed's own line IS its seed. The face is a GENUINE single-seed SILT face.
  // (The middle CLAY materialising as its OWN face — the host-split — is a separate linework
  // concern, Stage c; that is not what this lens face asserts.)
  it('an enclosed SILT interbed lens is a genuine single-seed SILT face (seed == paint == SILT)', () => {
    const probes = probeSection(literalCorrCD())
    const face = findByBounds(probes, 0, 4)
    expect(face, 'the literalCorr x[0..18] el[4..10] enclosed-lens face exists').toBeTruthy()
    expect(face!.classification, 'the lens owns a genuine single seed').toBe('single-seed')
    expect(face!.seedFormations[0], 'the genuine seed reads SILT (the picked interbed litho)').toBe('silt')
    // THE OWNER RULE (8r): the picked lens paints SILT, now from its OWN seed.
    expect(face!.paint, 'the enclosed SILT interbed lens paints SILT').toBe('silt')
  })
})

// ===========================================================================
// (d) Flag-OFF output is byte-identical (the campaign safety line). A guard that the seed path
// NEVER touches flag-OFF, and that a flag-ON round trip leaks no module state into flag-OFF.
// ===========================================================================
;(has ? describe : describe.skip)('(d) flag-OFF labelFaces output is unchanged by the seed path', () => {
  it('flag-OFF paint is identical before and after a flag-ON seed run (no state leak)', () => {
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as { sections: RawSection[] }
    const cs1 = prepareRealSection(raw.sections.find((s) => s.name === 'Cross-section 1')!)
    const paintFlagOff = (): string[] => {
      const prev = setTwoSidedTerminations(false)
      try {
        const section = buildSectionInput(cs1.columns, cs1.edges, undefined, cs1.alongM)
        const { curves, lensLabels } = emitCurves(section)
        const arr = buildArrangement(curves)
        return labelFaces(arr.faces, section.columns, lensLabels).map((lf) => lf.formationId)
      } finally {
        setTwoSidedTerminations(prev)
      }
    }
    const before = paintFlagOff()
    probeSection(cs1) // a full flag-ON seed round trip
    const after = paintFlagOff()
    expect(after).toEqual(before)
  })
})
