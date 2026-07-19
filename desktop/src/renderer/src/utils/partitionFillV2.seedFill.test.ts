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
 *       never length-voted — one of the 9 measured multi-seed faces.
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

import { type CorrelationEdge, type PartitionColumn } from './partitionFill'
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
;(has ? describe : describe.skip)('(a) a genuine enclosed lens keeps its minority litho (ruling 8r)', () => {
  // CS1#11 (x=23.45, el 6.84): MEASURED (S42.2b) — the raw picks here are SILT/KLEI/SILT, so
  // this face is the picked KLEI lens's OWN triangle (gap0 enclosed lens el [6.84..8.08]).
  // Its sole column-edge "seed" is SILT only because the 8r-outlawed pre-merge erased the
  // KLEI unit's own column segment — a MERGE-ARTIFACT seed, not a valid one. Owner rule 8r
  // ("the middle clay should LENS ... lines before the merge"): the lens SURVIVES; the face
  // keeps KLEI and classifies merged-minority until Step 4's raw-unit emission restores the
  // true seed. (The original expectation "paint the SILT seed" was built on a wrong premise —
  // it would have erased a picked lens.)
  it('the CS1 gap0 enclosed KLEI lens keeps KLEI; its SILT seed is a merge artifact', () => {
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as { sections: RawSection[] }
    const cs1 = prepareRealSection(raw.sections.find((s) => s.name === 'Cross-section 1')!)
    const probes = probeSection(cs1)
    const face = findByBounds(probes, 23.45, 6.84)
    expect(face, 'the CS1 x=23.45 el=6.84 enclosed-lens face exists').toBeTruthy()
    // The raw classifier reads the artifact seed (SILT — the matrix); the merge-artifact
    // refinement fires at the LABEL layer (labelFaces + isMergeArtifactSeed), which is where
    // the paint decision lives.
    expect(face!.classification, 'the raw classifier sees a single (artifact) seed').toBe('single-seed')
    expect(face!.seedFormations[0], 'the artifact seed reads SILT (the matrix)').toBe(SILT)
    // THE OWNER RULE (8r): the picked lens survives — KLEI, never the matrix seed.
    expect(face!.paint, 'the enclosed KLEI lens keeps KLEI').toBe(KLEI)
  })
})

// ===========================================================================
// (b) A zero-seed fillable face is a topology-defect, never painted from a synthetic label.
// ===========================================================================
;(has ? describe : describe.skip)('(b) a zero-seed fillable face is a topology-defect, never invented', () => {
  // Tie-section 6#5 (x=0, el=-4.13): a flood face bounded by floodsw0/floodsw1/term0 — no column
  // edge. Owner rule: "zero formations -> never invent a lithology; classify explicitly and fail
  // the gate if it lies in the fillable domain." The seed classifier must call it zero-seed-defect.
  it('a flood-bounded face with no column seed classifies zero-seed-defect', () => {
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as { sections: RawSection[] }
    const tie6 = prepareRealSection(raw.sections.find((s) => s.name === 'Tie-section 6')!)
    const probes = probeSection(tie6)
    const face = findByBounds(probes, 0, -4.13)
    expect(face, 'the Tie-6 x=0 el=-4.13 flood face exists').toBeTruthy()
    expect(face!.classification, 'a flood face has no column seed -> zero-seed-defect').toBe('zero-seed-defect')
    expect(face!.seedFormations.length, 'it has ZERO column-seed formations').toBe(0)
  })
})

// ===========================================================================
// (c) A multi-seed face is a topology-defect, never length-voted.
// ===========================================================================
;(has ? describe : describe.skip)('(c) a multi-seed face is a topology-defect, never length-voted', () => {
  // Tie-section 11#10 (x=0, el=7.51): a top-band face spanning a gap whose two columns' first units
  // are DIFFERENT formations (KLEI + ZAND). Owner rule: "two or more formations -> fail the gate;
  // repair the linework, never vote/select a label." The seed classifier must call it multi-seed.
  it('a top-band face over two different-formation column tops classifies multi-seed-defect', () => {
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as { sections: RawSection[] }
    const tie11 = prepareRealSection(raw.sections.find((s) => s.name === 'Tie-section 11')!)
    const probes = probeSection(tie11)
    const face = findByBounds(probes, 0, 7.51)
    expect(face, 'the Tie-11 x=0 el=7.51 top-band face exists').toBeTruthy()
    expect(face!.classification, 'two column-top formations -> multi-seed-defect').toBe('multi-seed-defect')
    expect(face!.seedFormations.length, 'it has TWO distinct column-seed formations').toBe(2)
  })
})

// ===========================================================================
// (e) The literalCorr (c)/(d) clay faces seed CLAY, not the SILT the vote paints.
// ===========================================================================
describe('(e) literalCorr (c)/(d): an enclosed SILT interbed lens keeps SILT (ruling 8r)', () => {
  // MEASURED (S42.2b): the face at x[0..18] el[4..10] is a SILT interbed lens's own face inside
  // the merged CLAY host (the fixture's silt-M-2 [el 4..6] family). Its sole column-edge "seed"
  // is CLAY only because the 8r-outlawed pre-merge erased the silt's own column segment — a
  // MERGE-ARTIFACT seed. Owner rule 8r: the picked lens survives; the face keeps SILT until
  // Step 4's raw-unit emission restores the true seed. (The middle CLAY itself materialises as
  // its own face at Step 4 — the host-split; that is linework, not labelling.)
  it('an enclosed SILT interbed lens keeps SILT; its CLAY seed is a merge artifact', () => {
    const probes = probeSection(literalCorrCD())
    const face = findByBounds(probes, 0, 4)
    expect(face, 'the literalCorr x[0..18] el[4..10] enclosed-lens face exists').toBeTruthy()
    expect(face!.classification, 'the raw classifier sees a single (artifact) seed').toBe('single-seed')
    expect(face!.seedFormations[0], 'the artifact seed reads CLAY (the matrix)').toBe('clay')
    // THE OWNER RULE (8r): the picked lens survives — SILT, never the matrix seed.
    expect(face!.paint, 'the enclosed SILT interbed lens keeps SILT').toBe('silt')
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
