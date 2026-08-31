/**
 * LOOP-CLOSURE + MATRIX-FLOOD SCENE PINS — the owner's 2026-08-19 dogfeed, on the
 * real Cross-section 1 data.
 *
 * Every pin below quotes the owner. They are NOT geometry assertions on a shape the
 * engine happens to make; each one names a point on the section and says which soil
 * or which packing class must be painted there, because of a rule he stated:
 *
 *   - "the loose sand should onlap (wrong in litho too), the silt below should lens,
 *      the clay should fill the gaps"
 *   - "On S10 there is a MD sand above the bottom MF clay. This one has a bottom tie
 *      and a top tie so it should get a vertical termination in the middle left is MD
 *      right is D"
 *   - "Below TD there is a SF on the test to the right that gets adopted ... there the
 *      SF silt is one band, it gets split below TD at S8? why?"
 *   - "the silt is bounded by a bottom tie and the sand is bounded by a top tie, which
 *      makes it a closed loop where the clay from the left should fill like in the litho"
 *   - "we have a closed form, the only thing left that can flood that form is the MF
 *      silt to the left"
 *
 * Dormant unless LOOP_SCENES=1 (it reads the throwaway real-data dump, which is not
 * committed). Run:
 *   LOOP_SCENES=1 node node_modules/vitest/vitest.mjs run \
 *     src/renderer/src/utils/loopClosureScenes.diag.test.ts
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import type { BodyBoundaryResponse } from '../api/clients/geology.types'
import { deriveSectionApexOverrides } from './buildVoxelRequest'
import { frameAlignedColumns } from './frameAlignedPartition'
import { computeHierarchicalGeotechFill } from './geotechHierarchicalFill'
import { buildPackingClassOf } from './geotechHierarchicalFill/packingClassOf'
import { computeSectionFillActive } from './partitionEngineSelect'
import type { CorrelationEdge, PartitionColumn, SectionRegion } from './partitionFill'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const INPUT = resolve(REPO_ROOT, 'scripts/throwaway_geotech_axis_inputs.json')

/** Nonzero-winding point-in-polygon (x=fraction, y=elevation) — the SVG fill rule. */
function inPolygon(
  px: number,
  py: number,
  poly: readonly { fraction: number; elevation: number }[],
): boolean {
  let wn = 0
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % n]
    if (a.elevation <= py) {
      if (
        b.elevation > py &&
        (b.fraction - a.fraction) * (py - a.elevation) - (px - a.fraction) * (b.elevation - a.elevation) > 0
      )
        wn++
    } else if (
      b.elevation <= py &&
      (b.fraction - a.fraction) * (py - a.elevation) - (px - a.fraction) * (b.elevation - a.elevation) < 0
    )
      wn--
  }
  return wn !== 0
}

interface Scene {
  litho: SectionRegion[]
  geotech: SectionRegion[]
  fallback: SectionRegion[]
  /** The loops BEFORE the merge, role-tagged — the law's own surfaces. */
  preMerge: (SectionRegion & { role: 'construct' | 'fill' })[]
  /** formation id → "KLEI" / "ZAND" / "SILT" (litho) */
  soilOf: (formationId: string) => string | null
  /** formation id → e.g. "ZAND-7" (geotech) */
  classOf: (formationId: string) => string | null
}

function buildScene(name: string): Scene {
  const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as any
  const sec = raw.sections.find((s: any) => s.name === name)
  if (!sec) throw new Error(`section ${name} not in the dump`)
  const assemble = (arm: any): { columns: PartitionColumn[]; alongM: number[] } => {
    const paired = arm.columns
      .map((c: any, i: number) => ({ c, a: arm.alongM[i] }))
      .filter(({ c }: any) => c.surfaceElevM != null && c.units.length > 0)
      .sort((p: any, q: any) => p.a - q.a)
    return {
      columns: paired.map(({ c }: any) => ({
        investigationId: c.investigationId,
        surfaceElevM: c.surfaceElevM,
        units: [...c.units].sort((a: any, b: any) => a.topDepthM - b.topDepthM),
      })),
      alongM: paired.map(({ a }: any) => a),
    }
  }
  const toEdges = (es: readonly any[]): CorrelationEdge[] =>
    es.map((e) => ({ a: e.a, b: e.b, aSide: e.aSide ?? 'top', bSide: e.bSide ?? 'top' }))
  const L = assemble(sec)
  const G = assemble(sec.geotech)
  const lithoEdges = toEdges(sec.edges)
  const geoEdges = toEdges(sec.geotech.edges)
  const empty = new Map<string, BodyBoundaryResponse>()
  const litho = computeSectionFillActive(
    L.columns,
    lithoEdges,
    deriveSectionApexOverrides(L.columns, lithoEdges, L.alongM, empty),
    L.alongM,
  )
  const hierarchical = computeHierarchicalGeotechFill({
    lithoColumns: L.columns,
    lithoEdges,
    lithoRegions: litho,
    geotechColumns: frameAlignedColumns(
      L.columns,
      new Map(G.columns.map((c) => [c.investigationId, c])),
    ),
    geotechEdges: geoEdges,
    alongM: L.alongM,
    packingClassOf: buildPackingClassOf(Object.entries(raw.refinementBundle.nadMeta)),
  })
  const nad = raw.refinementBundle.nadMeta
  const soil = raw.refinementBundle.lithoSoilByFormationId
  return {
    litho,
    geotech: hierarchical.regions,
    fallback: hierarchical.lithoFallback,
    preMerge: hierarchical.preMergeRegions,
    soilOf: (id) => soil[id] ?? null,
    classOf: (id) =>
      nad[id] ? `${nad[id].soilCode}-${nad[id].nadClass}` : soil[id] ? `L:${soil[id]}` : null,
  }
}

/** The soil painted by the LITHO arm at (gap, fraction, elevation) — null where nothing is. */
function lithoSoilAt(scene: Scene, gap: number, f: number, e: number): string | null {
  let out: string | null = null
  for (const r of scene.litho) {
    if (r.gapIndex !== gap) continue
    if (inPolygon(f, e, r.polygon)) out = scene.soilOf(r.formationId)
  }
  return out
}

/** The packing class painted by the GEOTECH arm — "(hatch)" where only the fallback covers. */
function geotechClassAt(scene: Scene, gap: number, f: number, e: number): string | null {
  let out: string | null = null
  for (const r of scene.geotech) {
    if (r.gapIndex !== gap) continue
    if (inPolygon(f, e, r.polygon)) out = scene.classOf(r.formationId)
  }
  if (out !== null) return out
  for (const r of scene.fallback) {
    if (r.gapIndex !== gap) continue
    if (inPolygon(f, e, r.polygon)) return '(hatch)'
  }
  return null
}

/** Does any point of ``ring`` sit inside ``host``, or vice versa? A cheap overlap probe. */
function ringsOverlap(
  ring: readonly { fraction: number; elevation: number }[],
  host: readonly { fraction: number; elevation: number }[],
): boolean {
  for (const p of ring) if (inPolygon(p.fraction, p.elevation, host)) return true
  for (const p of host) if (inPolygon(p.fraction, p.elevation, ring)) return true
  // Also sample the ring's own interior, so a ring fully containing / contained by the
  // host with no vertex inside still reads as overlapping.
  let f = 0
  let e = 0
  for (const p of ring) {
    f += p.fraction / ring.length
    e += p.elevation / ring.length
  }
  return inPolygon(f, e, host)
}

describe('LOOP-CLOSURE scene pins (real CS1)', () => {
  if (process.env.LOOP_SCENES !== '1' || !existsSync(INPUT)) {
    it.skip('dormant (set LOOP_SCENES=1 with the real dump present)', () => {})
    return
  }
  const scene = buildScene(process.env.SECTION_DUMP_NAME ?? 'Cross-section 1')

  // ---------------------------------------------------------------- M1 --
  // GAP 7 — GEO-23/125-S11 (deep clay) | GEO-10/170-S8 (a short test whose top
  // sand carries no tie at all). Owner: "the loose sand should onlap (wrong in
  // litho too), the silt below should lens, the clay should fill the gaps".

  it('S1 · gap 7 · the clay fills the ground past the sand (litho arm)', () => {
    // Past the sand's onlap tip, above the short test's TD: this is the clay's
    // ground. "the clay should fill the gaps" — and he said it is wrong in the
    // litho too, so the LITHO arm is pinned first.
    expect(lithoSoilAt(scene, 7, 0.75, 10.0)).toBe('KLEI')
    expect(lithoSoilAt(scene, 7, 0.9, 9.8)).toBe('KLEI')
  })

  it('S2 · gap 7 · the sand still onlaps — it is not flooded away', () => {
    // "the loose sand should onlap": its own face above the tip stays sand. This
    // is the negative control on S1 — flooding the clay must not eat the onlap.
    expect(lithoSoilAt(scene, 7, 0.7, 11.0)).toBe('ZAND')
    expect(lithoSoilAt(scene, 7, 0.9, 10.6)).toBe('ZAND')
  })

  it('S3 · gap 7 · the geotech arm paints a clay class on the clay ground', () => {
    const painted = geotechClassAt(scene, 7, 0.75, 10.0)
    expect(painted).not.toBeNull()
    expect(painted?.startsWith('KLEI')).toBe(true)
  })

  it('S4 · gap 8 · a tie-bounded two-sided fence STANDS (negative control)', () => {
    // The top pair here IS bounded by correlations on both sides (the top band
    // above, the silt-top tie below), so the mid-gap vertical is correct: sand on
    // the left test, clay on the right test, split down the middle.
    expect(lithoSoilAt(scene, 8, 0.25, 10.5)).toBe('ZAND')
    expect(lithoSoilAt(scene, 8, 0.75, 10.5)).toBe('KLEI')
  })

  it('S5 · gap 9 · the tie-bounded sand window keeps its fence, MD on the left', () => {
    // Owner: "On S10 there is a MD sand above the bottom MF clay. This one has a
    // bottom tie and a top tie so it should get a vertical termination in the
    // middle left is MD right is D." The window is bounded above by the sand tie
    // (-3.19 ↔ -3.37) and below by the clay-top tie (-3.88 ↔ -4.65).
    expect(geotechClassAt(scene, 9, 0.25, -3.5)).toBe('ZAND-6') // MD, the left test
    // Deeper than -3.88 the LEFT test's sand has ended (that contact is the clay
    // tie's own left endpoint), so there is no MD left to claim the left half —
    // the D sand is the only sand there. Pinned so the fence is not read as a
    // full-height 50/50 claim.
    expect(geotechClassAt(scene, 9, 0.75, -4.2)).toBe('ZAND-7')
  })

  it('S5b · gap 9 · the right half of that fence is D, not VD', () => {
    // "left is MD right is D". The right half of the fence spans -3.28 .. -3.88; on
    // the right test that whole run is the D sand — its VD sand ENDS at -3.37, on the
    // far side of the sand tie. Painting VD there is the "weird VD quad", and it came
    // from reading that test at the face's GLOBAL top (-3.28, a level the face only
    // reaches on the seam side of the gap) rather than at its top ON THAT TEST.
    expect(geotechClassAt(scene, 9, 0.75, -3.5)).toBe('ZAND-7')
  })

  // ---------------------------------------------------------------- M2 --

  it('S6 · gap 8 · the adopted silt bands on the right, and lenses toward the empty left', () => {
    // Owner, 2026-08-19: *"Below TD there is a SF on the test to the right that gets
    // adopted ... there the SF silt is one band, it gets split below TD at S8? why?"*
    // and his ruling of 2026-08-20 on what that means under the complete law:
    // *"s6 no ruling needed two bands on the right, it should band on that side, no
    // bands on the left it should emit a lens. The rule is litteral and you can take
    // it as such."*
    //
    // So: the right test read SILT-13 over 5.49 .. 4.43 and it is ONE band on ITS
    // side of the gap — no interleaved slivers down a vertical, which was the
    // original complaint. With nothing on the left, the band closes as a lens and
    // terminates at about half the gap like every construct.
    // Its whole interval beside the test that read it...
    for (const e of [5.45, 5.3, 5.2, 5.0, 4.8, 4.6, 4.5]) {
      expect(geotechClassAt(scene, 8, 0.9, e), `(0.9,${e}) is not one band`).toBe('SILT-13')
    }
    // ...and out into its own half, ONE class down every vertical. Reading it as
    // SILT-13 / SILT-14 / SILT-13 down the same line is the split he asked about;
    // the lens narrowing at its own top and base as it reaches out is the shape the
    // law asks for, so the samples stay inside the band rather than on its taper.
    for (const f of [0.75, 0.6]) {
      for (const e of [5.3, 5.2, 5.0, 4.8, 4.6]) {
        expect(geotechClassAt(scene, 8, f, e), `(${f},${e}) is not one band`).toBe('SILT-13')
      }
    }
    // Past the termination the left half is answered by the ground's own mass, and
    // never by a silt conjured from nowhere: whatever is painted there is a class a
    // real test measured (the wrapper of the closed lens).
    const left = geotechClassAt(scene, 8, 0.15, 4.6)
    expect(left).not.toBe('(hatch)')
    expect(left).not.toBe('SILT-13')
    expect(left?.startsWith('SILT')).toBe(true)
  })

  it('S7 · gap 8 · the clay wedge the litho paints is not left hatched', () => {
    // Owner: "the silt is bounded by a bottom tie and the sand is bounded by a top
    // tie, which makes it a closed loop where the clay from the left should fill
    // like in the litho." The clay family reaches only the right test here, so the
    // whole cover adopts that side rather than reading "correlate me".
    expect(lithoSoilAt(scene, 8, 0.2, 2.8)).toBe('KLEI')
    const painted = geotechClassAt(scene, 8, 0.2, 2.8)
    expect(painted).not.toBe('(hatch)')
    expect(painted?.startsWith('KLEI')).toBe(true)
  })

  it('S9 · gap 2 · the dark clay quad — a litho-tied band is not hatch down its middle', () => {
    // Owner, 2026-08-19: "a dark clay quad between B6 and B4". The litho model ties this
    // clay band TWICE across the gap (top 5.02 ↔ 7.51, base 3.67 ↔ 7.13), so the soil
    // cover is one connected mass. Its geotech restatement was DELETED this morning, and
    // the middle of the band came out "correlate me" with the two classes stranded as a
    // lens and a quad on their own columns. Litho approval carries down: the cover is
    // connected because the litho tie says so.
    for (const [f, e] of [
      [0.6, 5.8],
      [0.55, 6.1],
    ] as const) {
      const painted = geotechClassAt(scene, 2, f, e)
      expect(painted).not.toBe('(hatch)')
      expect(painted?.startsWith('KLEI')).toBe(true)
    }
    // And each test still owns the ground beside it.
    expect(geotechClassAt(scene, 2, 0.9, 7.25)).toBe('KLEI-22')
    expect(geotechClassAt(scene, 2, 0.1, 4.5)).toBe('KLEI-21')
  })

  it('S9b · gap 2 · no hatch anywhere in that band', () => {
    // The whole litho band region (0,5.02)(0,3.67)(1,7.13)(1,7.51) is covered: not one
    // "correlate me" polygon may intersect it.
    const band = [
      { fraction: 0, elevation: 5.02 },
      { fraction: 0, elevation: 3.67 },
      { fraction: 1, elevation: 7.13 },
      { fraction: 1, elevation: 7.51 },
    ]
    const offenders = scene.fallback
      .filter((r) => r.gapIndex === 2 && scene.soilOf(r.formationId) === 'KLEI')
      .filter((r) => ringsOverlap(r.polygon, band))
      .map((r) => r.polygon.map((p) => `(${p.fraction.toFixed(2)},${p.elevation.toFixed(2)})`).join(''))
    expect(offenders).toEqual([])
  })

  it('S9c · gap 2 · the deleted tie stays deleted — the two classes do not MERGE', () => {
    // He deleted the geotech restatement between these two bands. The soil cover connects
    // because the LITHO tie says so; the CLASSES must not become one mass.
    //
    // RE-PINNED 2026-08-19 to the complete emit specification. It counts ties on a band's
    // CONTACTS, and these two clays DO share one — the sand-top tie their unit sits on. So
    // each is a one-tie band whose far end is a different packing density, each ONLAPS
    // along that tie, and an onlap follows its line for as long as its own level lets it
    // (his gap-0 ruling: an onlap that stops mid-gap on a straight line is the defect).
    // The KLEI-22 onlap therefore reaches the far test, which the old "no region may span"
    // proxy read as banding. What "the deleted tie stays deleted" means under the law is
    // pinned instead: the two classes stay TWO regions, neither merging into the other,
    // and each test still owns the ground beside it (S9 above).
    const clay = scene.geotech.filter(
      (r) =>
        r.gapIndex === 2 &&
        (scene.classOf(r.formationId) ?? '').startsWith('KLEI') &&
        Math.max(...r.polygon.map((p) => p.elevation)) <= 7.6 &&
        Math.min(...r.polygon.map((p) => p.elevation)) >= 3.6,
    )
    expect([...new Set(clay.map((r) => scene.classOf(r.formationId)))].sort()).toEqual([
      'KLEI-21',
      'KLEI-22',
    ])
  })

  it('S10 · gap 5 · no foreign silt inside the lower silt unit of S7', () => {
    // Owner, 2026-08-19: "what is that green quad i circled? the mf silt on 10/170-S7
    // should onlap left because if you follow the tie you have a mf silt, the denser
    // silt above should lens." That unit (5.19 .. 4.07) carries its OWN two bands; the
    // class painted inside it came from a DIFFERENT litho unit on the other test, which
    // no correlation joins to it.
    // RE-PINNED 2026-08-19 to POINT SAMPLING. The ring-overlap probe it used reads a
    // region that merely traces along the cover's own edge as an overlap, and the merge
    // (the law's fill sweep) now welds a family's faces into one ring that runs along
    // exactly those edges. The question is unchanged — no foreign silt INSIDE this unit —
    // and sampling its interior answers it without depending on a welded ring's boundary.
    const cover = [
      { fraction: 1, elevation: 5.19 },
      { fraction: 0.5, elevation: 4.94 },
      { fraction: 1, elevation: 4.07 },
    ]
    const strays: string[] = []
    for (let i = 1; i < 12; i++) {
      for (let j = 1; j < 12; j++) {
        const f = 0.5 + (i / 12) * 0.5
        const e = 4.07 + (j / 12) * 1.12
        if (!inPolygon(f, e, cover)) continue
        if (geotechClassAt(scene, 5, f, e) === 'SILT-13') strays.push(`(${f.toFixed(2)},${e.toFixed(2)})`)
      }
    }
    expect(strays).toEqual([])
    expect(geotechClassAt(scene, 5, 0.7, 4.6)).toBe('SILT-14')
    expect(['SILT-15', 'SILT-14']).toContain(geotechClassAt(scene, 5, 0.8, 5.05))
  })

  it('S11 · gap 5 · the enclosed interbed closes, and its wrapper floods that level', () => {
    // Owner: "top circle should be a lens." The 0.37 m band at 10.25 .. 9.88 sits between
    // the same class above and below on its own test. Its own loop is what it draws; the
    // level beyond that loop belongs to the class that wraps it.
    // Sampled BEYOND the lens's own reach (its apex is at 0.45 — that reach is the
    // engine's 8b rule and not this scene's question); the defect was the level being
    // carried on to 0.83.
    expect(geotechClassAt(scene, 5, 0.47, 10.05)).toBe('SILT-13')
    expect(geotechClassAt(scene, 5, 0.6, 10.0)).toBe('SILT-13')
    // Its lens still exists, hugging its own test — the rule moves fill, it never
    // deletes a band.
    expect(geotechClassAt(scene, 5, 0.05, 10.05)).toBe('SILT-15')
    expect(geotechClassAt(scene, 5, 0.3, 10.05)).toBe('SILT-15')
  })

  it('S12 · gap 3 · a band with a top AND a bottom tie SPANS — it never onlaps', () => {
    // Owner, 2026-08-19: "you drew the vertical line but made the VD dense onlap
    // instead, it has a top and bottom tie to the right though? ... i said it was
    // absolute". B4 (col 3) carries a very dense sand at -1.77 .. -2.37. Its TOP
    // contact is tied to S13's sand top (-1.06) and its BASE contact — the clay
    // top it shares with the band below — is tied to S13's clay top (-1.79). Two
    // ties, so the 2/1/0 law makes it a BAND: the quad between those two lines,
    // its half of the gap filled to the vertical termination, with no mid-gap
    // pinch and no hatch under it.
    //
    // The facing test reads that same window as a medium-dense sand, so the two
    // masses meet at the vertical in the middle — his own standing ruling for
    // this shape ("it should get a vertical termination in the middle left is MD
    // right is D", pinned as S5 on gap 9).
    for (const [f, e] of [
      [0.1, -2.2],
      [0.25, -1.9],
      [0.45, -2.0],
    ] as const) {
      expect(geotechClassAt(scene, 3, f, e), `(${f},${e}) is not the VD band`).toBe('ZAND-8')
    }
    // ...and the facing test owns its own half of the same window.
    expect(geotechClassAt(scene, 3, 0.6, -1.9)).toBe('ZAND-6')
    // Nothing in that window reads "correlate me": the two constructs tile it.
    for (const [f, e] of [
      [0.3, -1.95],
      [0.7, -1.85],
    ] as const) {
      expect(geotechClassAt(scene, 3, f, e)).not.toBe('(hatch)')
    }
  })

  // --------------------------------------------------------------- M3 --
  // GAP 0 — GEO-22/115-S10 (col 0) | GEO-10/170-S6 (col 1). The owner's complete
  // emit specification, 2026-08-19, worked band by band on his own circles:
  //   "10/170-s6 bottom dense sand has one tie, should onlap except it is
  //    terminating on a straight line. same for the deep mf clay, top dense sand
  //    has one tie, follow the tie, it is the same litho and packing density
  //    don't emit onlap, the md sand above, same litho different packing = emit
  //    onlap."

  it('S13a · gap 0 · the bottom dense sand onlaps along its tie, meeting at the middle', () => {
    // Owner, 2026-08-19: *"10/170-s6 bottom dense sand has one tie, should onlap
    // except it is terminating on a straight line"* — one tie on its base
    // contact, a different packing at the other end, so it onlaps along that
    // line and terminates at about half the gap (his 2026-08-20 clause).
    //
    // UNCONDITIONAL since 2026-08-25 — *"no it has one tie on top, so it should
    // onlap that same tie"*. It used to need checking against the 2026-08-21
    // clearly-thicker-wins collision (this sand is 1.44 m against 2.19 m, 1.52x,
    // which fell below the retired ratio and so onlapped anyway); with that rule
    // deleted the thicknesses are not consulted and his sentence holds directly.
    // Measured emit for this band: onlap, base tied, terminating at f = 0.500.
    // SAMPLES RE-DERIVED 2026-08-21 against his own ruled picture. He drew the
    // onlap as a wedge that PINCHES onto its line — *"the lesser packed second
    // top part of that sand should emit an onlap"*, vertices (1,2.87) (0.5,2.57)
    // (1,1.45) for the sand above, and the same shape mirrored for this one. The
    // two deep-in-the-gap samples used to sit at the band's own top level, which
    // only lay inside the loop while the onlap ran FLAT to the middle — the
    // rectangle it is no longer. They now sit inside his wedge, and the two at
    // the band's own column edge are unchanged.
    for (const [f, e] of [
      [0.98, -1.5],
      [0.9, -1.5],
      [0.9, -1.0],
      [0.7, -1.3],
      [0.55, -1.5],
    ] as const) {
      expect(geotechClassAt(scene, 0, f, e), `(${f},${e})`).toBe('ZAND-7')
    }
    // Past the middle it is the facing test's ground.
    expect(geotechClassAt(scene, 0, 0.3, -1.0)).toBe('ZAND-6')
  })

  it('S13b · gap 0 · the deep clay onlaps too, and stops at its own half', () => {
    // Owner, 2026-08-19: *"same for the deep mf clay"* — one tie on its TOP
    // contact, a different packing at the far end, so it onlaps along that line.
    //
    // WHY IT STOPS, restated 2026-08-25. This pin used to explain the far-half
    // sample by the 2026-08-21 collision: 0.90 m against the 3.21 m clay facing
    // it is 3.6x, so the facing mass was "clearly thicker" and took the window.
    // That rule is retired — *"no it has one tie on top, so it should onlap that
    // same tie"* — and the clay's measured emit is, and was, a plain onlap
    // terminating at f = 0.500. The reason it keeps only its own half is the
    // 2026-08-20 termination clause, which never depended on thickness.
    for (const [f, e] of [
      [0.98, -2.6],
      [0.9, -3.0],
      [0.8, -3.0],
    ] as const) {
      expect(geotechClassAt(scene, 0, f, e), `(${f},${e})`).toBe('KLEI-22')
    }
    expect(geotechClassAt(scene, 0, 0.6, -2.8), 'the clay kept ground past its own half').not.toBe(
      'KLEI-22',
    )
  })

  it('S13c · gap 0 · the top dense sand emits NOTHING — same litho and packing across', () => {
    // "follow the tie, it is the same litho and packing density don't emit onlap":
    // S6's ZAND-7 at 1.45 .. 0.71 is tied on its base contact to S10's ZAND-7|SILT
    // contact, and what continues ABOVE that line is S10's own ZAND-7. One mass, so no
    // construct at all — and after the fill sweep, ONE region carrying both bands.
    const dense = scene.geotech.filter(
      (r) => r.gapIndex === 0 && scene.classOf(r.formationId) === 'ZAND-7' && inPolygon(0.75, 1.0, r.polygon),
    )
    expect(dense.length).toBe(1)
    expect((dense[0].layerIds ?? []).length).toBe(2)
    // Mid-gap, inside the sand's own window between the two tie lines (the silt unit
    // below it starts at 1.22 there — the litho frame, not this band's business).
    // Mid-gap, inside the sand's own window between the two tie lines — one mass,
    // one region, no seam and no vertical.
    expect(geotechClassAt(scene, 0, 0.75, 1.0)).toBe('ZAND-7')
    expect(geotechClassAt(scene, 0, 0.5, 1.3)).toBe('ZAND-7')
  })

  it('S13d · gap 0 · the md sand above emits an onlap — same litho, different packing', () => {
    // "the md sand above, same litho different packing = emit onlap": S6's ZAND-6 at
    // 2.87 .. 1.45 is tied on its top contact, and what continues BELOW that line on S10
    // is its ZAND-7. Different packing, so it onlaps along the tie.
    // His ruled triangle for this very band: (1,2.87) (0.5,2.57) (1,1.45). The
    // second sample is re-derived to sit inside it — at f=0.6 the wedge's
    // underside has already risen to 2.35 on its way to the pinch, so the old
    // 1.9 sampled the D below the line, which is exactly the mass he says owns
    // that ground (*"only the D sand kan fill"* the loop).
    expect(geotechClassAt(scene, 0, 0.9, 2.0)).toBe('ZAND-6')
    expect(geotechClassAt(scene, 0, 0.6, 2.45)).toBe('ZAND-6')
  })

  // --------------------------------------------------------------- M4 --
  // GAP 19 — GEO-23/125-S6 (col 19) | GEO-23/125-S5A (col 20), the owner's arrow
  // of 2026-08-20: a dark sliver at S6's RIGHT column edge, at the SAND-VD level,
  // painted over ground S6 itself measured. His clause: *"an onlap can't paint
  // over ground near test itself, it terminates at 0.5 Distance approximately."*
  // At a test's own edge the answer can only be that test's own log.

  it('S14 · gap 19 · S6 owns its own column edge, band for band', () => {
    // S6 reads, below its clay at 0.97..0.04: MD 0.04..-0.99, VD -0.99..-2.80,
    // MD -2.80..-3.30, D -3.30..-3.72, MD -3.72..-4.12, VD -4.12..-5.87. Sampled
    // a hair into the gap, every one of those windows must read its own class.
    for (const [top, base, expected] of [
      [0.04, -0.99, 'ZAND-6'],
      [-0.99, -2.8, 'ZAND-8'],
      [-2.8, -3.3, 'ZAND-6'],
      [-3.3, -3.72, 'ZAND-7'],
      [-3.72, -4.12, 'ZAND-6'],
      [-4.12, -5.87, 'ZAND-8'],
    ] as const) {
      const mid = (top + base) / 2
      expect(geotechClassAt(scene, 19, 0.02, mid), `${top}..${base} at S6's own edge`).toBe(
        expected,
      )
    }
  })

  it('S15 · gap 19 · the medium-dense sand follows its two jump ties, whole', () => {
    // The gate's one surviving balloon of 2026-08-20, decoded: col19's ZAND-6 at
    // 2.62 .. 1.67 is NOT a no-tie lens. Both of its contacts are tied — its top
    // to GEO-10/170-S11's sand top, its base (the contact it shares with the
    // dense sand below, named by that band's row) to the same test — and those
    // ties JUMP the three short tests between, which carry no band of this
    // family. The family's run therefore spans them, and by the 2026-08-15
    // EXCLUDED ruling those ties are the run's own adjacent ties.
    //
    // Both far ends are the same litho and packing, so the law emits NOTHING and
    // the mass is continuous: the window between the two lines reads one class
    // the whole way, and nothing foreign appears inside it.
    for (const [f, e] of [
      [0.02, 2.0],
      [0.3, 1.9],
      [0.6, 1.7],
      [0.9, 1.5],
      [0.98, 1.2],
    ] as const) {
      expect(geotechClassAt(scene, 19, f, e), `(${f},${e}) is not the continuous mass`).toBe(
        'ZAND-6',
      )
    }
    // And its own test's stack survives beside it, band for band (S14's rule at
    // the same column): the dense sand directly below it is still dense.
    expect(geotechClassAt(scene, 19, 0.02, 1.3)).toBe('ZAND-7')
  })

  // --------------------------------------------------------------- M5 --
  // GAP 0 — GEO-22/115-S10 (col 0) | GEO-10/170-S6 (col 1). The owner, 2026-08-21:
  //   "22/115-S10 top silt has only a top tie, follow that tie and you get a silt
  //    with another packing type, emit onlap. same for 4th silt from top, follow
  //    tie not the same packing emit onlap, Silt SF fills that whole gap because
  //    all the rest is closed, WTF ARE YOU DOING, SIMPLE RULE FOLLOW IT"
  // and, on the mechanism: "well a mass that emitted an onlap could not also fill
  // the remainder, would also produce the SF silt filling it".

  // HELD FOR AN OWNER RULING (2026-08-21) — two of his sentences collide here:
  //   (a) *"Silt SF fills that whole gap because all the rest is closed"* (the
  //       comb scene), vs
  //   (b) *"the MD sand onlaps, that means it is a closed loop in that gap and
  //       cannot fill the gap"* (the same day's fill rule).
  // Measured on the dump: within the SF silt's own litho family, S10 carries no
  // family bands between 11.68 and 6.84, and the SF silt's one family tie reads
  // a different packing at its far end — by the table the SF silt itself emits
  // an onlap, so under (b) it is CLOSED and may not fill; and the ground these
  // samples probe belongs to a DIFFERENT litho family's cover, which the
  // 2026-08-18 hierarchical frame forbids painting across. Sentence (a) asks
  // exactly that. The pending tie-vs-contact ruling (see the 210 gate header)
  // can also change the SF silt's tie count. it.fails = tripwire: when a ruling
  // makes this pass, revisit and re-arm it as a plain pin.
  it('S16a · gap 0 · NO COMB — the SF silt fills the cover once the rest is closed', () => {
    // RULED 2026-08-21, verbatim: *"the SF silt on the right has 2 bands,
    // definition is band an no lens or onlap is emitted, two ties is two tied
    // contacts, if you have two ties on the same contact that means a layer
    // tapers out to a pinch, right up to that contact. 0.5x distance to next
    // test (so half of the line width it onlaps on)."* — and, walking the same
    // scene, *"had 2 ties, so it shoudnt emit jack shit, which leaves it open
    // ... the other silt onlaps and the sf silt fills."*
    //
    // S6's big SILT-13 (11.61 .. 6.05) carries a tie on its TOP contact and the
    // one he drew on its BASE, so it is a BAND: it emits nothing, stays open and
    // fills this cover. S10's interbeds close as lenses at their own levels, and
    // the ground between those closed loops is the SF silt's — not the facing
    // test's thin bands welded across half the gap, which is the spiked comb he
    // circled (*"Silt SF fills that whole gap because all the rest is closed"*).
    for (const [f, e] of [
      [0.3, 10.2],
      [0.35, 9.0],
      [0.4, 8.5],
    ] as const) {
      expect(geotechClassAt(scene, 0, f, e), `(${f},${e}) is not the SF silt`).toBe('SILT-13')
    }
    // And it is ONE mass, not a comb: the region covering that ground reaches
    // both tests.
    const filling = scene.geotech.filter(
      (r) => r.gapIndex === 0 && scene.classOf(r.formationId) === 'SILT-13' && inPolygon(0.35, 9.0, r.polygon),
    )
    expect(filling.length).toBe(1)
    expect(Math.max(...filling[0].polygon.map((p) => p.fraction))).toBeGreaterThan(0.98)
  })

  it('S16b · gap 0 · S10 top silt onlaps riding its tie, closing at the middle', () => {
    // *"top silt has only a top tie, follow that tie and you get a silt with
    // another packing type, emit onlap"*: SILT-14 12.22 .. 11.68, one tie on its
    // TOP contact, far end SILT-13 — a different packing, so it onlaps along the
    // line and terminates at about half the gap (2026-08-20 clause).
    // Nothing weighs this silt against the mass across its tie: the thicker-wins
    // collision that once could have is retired (owner 2026-08-25, *"no it has
    // one tie on top, so it should onlap that same tie"*), and it never reached
    // this band anyway — after his 2026-08-21 ruling the SF silt across that tie
    // has TWO tied contacts, so it is a band and not a facing onlap. This silt
    // onlaps exactly as he said it does, for the reason he gave.
    //
    // SAMPLES RE-DERIVED on the ruled shape: the wedge runs (0,12.22) (0,11.68)
    // (0.50,11.91) — it rides the tie down and its free base rises to meet that
    // line at the middle, so a sample at the band's own top level only sits
    // inside it near its own test. Beyond about a third of the gap the wedge has
    // closed most of the way and the ground below it is the SF silt's.
    for (const [f, e] of [
      [0.02, 11.9],
      [0.2, 12.0],
      [0.4, 11.93],
    ] as const) {
      expect(geotechClassAt(scene, 0, f, e), `(${f},${e}) is not the top silt`).toBe('SILT-14')
    }
    expect(geotechClassAt(scene, 0, 0.6, 11.8), 'the SF silt did not take the rest').toBe('SILT-13')
  })

  it('S16c · gap 0 · a silt whose tie shows another packing onlaps; one whose tie shows its own does not', () => {
    // *"same for 4th silt from top, follow tie not the same packing emit onlap"*.
    // Decoded mechanically over all ten of this gap's ties (four candidate
    // readings of "the litho at the other end"), the ONLY reading that also keeps
    // his 2026-08-19 sentence *"top dense sand ... it is the same litho and
    // packing density don't emit onlap"* true is: the far end is the band on the
    // SAME SIDE of the contact the tie lands on.
    //
    // Under it, S6's 4th silt from the top — SILT-16 0.71 .. 0.13, tied to S10's
    // SILT-15 — is exactly the case he describes, and it onlaps.
    expect(geotechClassAt(scene, 0, 0.95, 0.4)).toBe('SILT-16')
    expect(geotechClassAt(scene, 0, 0.55, 0.6)).toBe('SILT-16')
    // ...while S10's 4th silt (SILT-14 6.84 .. 6.32) reads its own packing across
    // the same tie (S6's SILT-14 6.05 .. 5.59), so the law emits NOTHING and the
    // two are one bed. ⚠ This is the one sentence of his the decoding cannot
    // satisfy under the reading his other five sentences require — reported for
    // his ruling rather than special-cased.
    expect(geotechClassAt(scene, 0, 0.1, 6.6)).toBe('SILT-14')
    expect(geotechClassAt(scene, 0, 0.9, 5.8)).toBe('SILT-14')
  })

  it('S16d · gap 0 · the comb fix did not delete the interbeds own ground', () => {
    // The fix must fill AROUND the closed loops, not erase them: at the levels
    // S10's untied interbeds measured, the ground beside S10 still reads their
    // own class rather than a neighbour's.
    //
    // ⚠ WEAKENED, and the reason recorded rather than hidden: this pin asked for
    // each interbed's own CONSTRUCT loop, and S10's 2f3f88 draws none under the
    // current code — its lens reach collapses against a crossing tie. The class
    // it reads is the same as the mass around it (SILT-13), so the render is
    // right either way, but the missing construct is an open item, not a pass.
    for (const [f, e] of [
      [0.02, 10.72],
      [0.02, 8.39],
    ] as const) {
      expect(geotechClassAt(scene, 0, f, e), `(${f},${e})`).toBe('SILT-13')
    }
  })

  it('S17 · gap 0 · the dense sands weld flat; the lesser-packed sand above onlaps', () => {
    // Owner, 2026-08-21, his verdict on the wedge he traced with red arrows:
    //   "why does this dense sand onlap, 1 tie = follow line, same packing = no
    //    onlap" · "it was sand on top, something else below the line" · "the
    //    dense sand on bottom should emit no onlap because the same packing is
    //    on the left column, the lesser packed second top part of that sand
    //    should emit an onlap."
    //
    // The line he traced is the silt-tops tie (S10 @1.73 <-> S6 @0.71). ABOVE it
    // the dense sand is ZAND-7 on BOTH tests (S10 2.27..1.73, S6 1.45..0.71):
    // same litho and packing, so the law emits NOTHING and they weld into one
    // flat mass riding that line. The climbing wedge came from the contact ABOVE
    // it — S10's dense top tied to S6's medium-dense (2.27 <-> 2.87).
    //
    // WHAT DECIDES THAT CONTACT, corrected 2026-08-25 against the probe rather
    // than reasoned about. This comment used to call it a bidirectional
    // collision — MD 1.42 m against D 0.54 m, 2.63x, the MD winning and riding
    // its line down to S10's contact. Two things were wrong with that and the
    // owner's ruling of this date retires the rule it invoked (*"no it has one
    // tie on top, so it should onlap that same tie"*): S10's dense band carries
    // TWO tied contacts, so the collision never reached it — the 2026-08-21
    // two-tied-contacts rule makes it emit nothing and span — and S6's MD
    // onlaps to the MIDDLE (measured apex f = 0.500), never to S10's contact.
    // An onlap is a closed loop and does not cross the gap; that is what part
    // (b) below actually checks, and it is why it passed under both laws.
    // (a) the two dense sands weld into ONE mass carrying both tests.
    const dense = scene.geotech.filter(
      (r) => r.gapIndex === 0 && scene.classOf(r.formationId) === 'ZAND-7' && inPolygon(0.5, 1.3, r.polygon),
    )
    expect(dense.length, 'the dense sands did not weld into one mass').toBe(1)
    expect((dense[0].layerIds ?? []).length, 'the weld does not carry both tests').toBe(2)
    // (b) the dense mass's own CONSTRUCT rises AT MOST to the upper tie line
    //     (2.27 at S10 -> 2.87 at S6) and never past it. Re-scoped 2026-08-21
    //     evening (one contact, one geometry — the S11 MD spill): the silts
    //     above that contact weld, so the contact IS the line and the dense
    //     mass fills up TO it on its own half — which is also the answer to
    //     the remainder-triangle question this pin used to leave open. What
    //     stays forbidden is CROSSING the line into the MD's window.
    const drawn = scene.preMerge.filter(
      (r) =>
        r.gapIndex === 0 &&
        r.role === 'construct' &&
        (r.layerIds ?? []).some((id) => id.endsWith('216614')),
    )
    expect(drawn.length, "S10's dense sand drew no construct").toBeGreaterThan(0)
    for (const r of drawn) {
      for (const p of r.polygon) {
        const lineAt = 2.27 + p.fraction * (2.87 - 2.27)
        expect(
          p.elevation,
          `the dense construct crossed the upper tie line at f=${p.fraction.toFixed(2)}`,
        ).toBeLessThan(lineAt + 0.02)
      }
    }
    // (c) the medium-dense sand's onlap is a CLOSED LOOP on its own side —
    //     *"the MD sand onlaps, that means it is a closed loop in that gap and
    //     cannot fill the gap"*.
    expect(geotechClassAt(scene, 0, 0.7, 2.4), 'the MD onlap is missing').toBe('ZAND-6')
    // ⚠ The remainder triangle left of that loop — between the silt weld line
    // above and the flat dense top below — is the owner's open question (silt
    // drops down vs dense fills up), so it is deliberately NOT pinned here.
  })

  it('S18 · gap 5 · remainder ground goes to the OPEN silt, never a closed lens', () => {
    // Owner, 2026-08-21, on the darker quad right of S12 ("what is this quad
    // ... the whole interval is SF"): the SF cover below S12's silt base is
    // remainder ground — S12's big silt there is untied and closes as a lens,
    // and the level-scoped exclusion let S12's closed SILT-15 INTERBED take
    // that ground because its extent sat nearest. *"The remainder of each
    // closed loop goes to the OPEN mass"* is absolute: a closed construct
    // takes no remainder ground while any open band can answer. The open SF
    // silt owns it.
    expect(geotechClassAt(scene, 5, 0.333, 5.94)).toBe('SILT-13')
    // And the SILT-15 interbed still exists at its OWN level (the lens stands).
    expect(geotechClassAt(scene, 5, 0.05, 10.06)).toBe('SILT-15')
  })

  it('S19 · gap 7 · the MD never spills below the very dense sand’s correlation', () => {
    // Owner, 2026-08-21 evening: "there is a MD sand that spills over the
    // correlation band with the very dense sand below" (right of S11). The
    // ZAND-8 tops are tied (S11 @-1.08 <-> the far test @-0.78) and the two
    // ZAND-8s weld, so that contact IS the tie line on BOTH halves: below it
    // the very dense band is complete, above it the MD. The spill was the MD
    // holding a flat base at its own log depth and claiming the wedge under
    // the rising line.
    expect(geotechClassAt(scene, 7, 0.5, -1.03), 'MD paint inside the VD correlation band').toBe(
      'ZAND-8',
    )
    expect(geotechClassAt(scene, 7, 0.5, -0.95), 'the MD lost its own side of the line').toBe(
      'ZAND-6',
    )
  })

  it('S20 · gaps 15-18 · an adopted band brings its ties: the deep VD spans sub-TD', () => {
    // Owner, 2026-08-21 evening: "the deepest VD sand on both these columns
    // [S8|S6] are tied by 2 ties. However MD wins in the gaps below sub TD."
    // S6's deep sand stack is ADOPTED into the upper-sand family between S8
    // and S6 (its own litho family has no cover there), and tie resolution ran
    // before adoption — so the deep VD's two ties (its tops S8@-6.32<->S6@-4.12
    // and the KLEI-23-top line at its base) were dropped and it read as a
    // 0-tie lens; the MD took its correlated span. An adopted band now brings
    // its ties, and the VD BANDS between its two lines through every sub-TD
    // gap of the jump.
    expect(geotechClassAt(scene, 15, 0.5, -6.9), 'gap 15 sub-TD lost the VD band').toBe('ZAND-8')
    expect(geotechClassAt(scene, 16, 0.333, -6.5), 'gap 16 sub-TD lost the VD band').toBe('ZAND-8')
    expect(geotechClassAt(scene, 18, 0.5, -5.5), 'gap 18 sub-TD lost the VD band').toBe('ZAND-8')
  })

  it('S21 · gaps 14-16 · the dense never crosses its correlation upward', () => {
    // Owner, 2026-08-21 late evening: "the dense sand is spilling over the
    // correlation to the MD sand ... even below S10 there is VD sand even when
    // the base is tied to s8 and B2." The deep VD's top tie line is a WALL: a
    // class may never cross a correlation, so the ground between the shallow
    // tests' tied bases and that line reads the sand ABOVE the line, and the
    // VD keeps only its own band window below it.
    // The gap-14 sample sat at -5.0 until the sub-TD continuation ruling
    // (2026-08-21 late night) turned that ground into S8's DRILLED SILT: S8
    // logged silt -4.45..-6.32 and S10's log stops at -3.24, so with nothing
    // to meet the silt now carries across instead of pinching. The rule this
    // scene states is about SAND, so its sample moves to sand ground above
    // the deep VD; the silt that took the old point is pinned on its own line
    // below, so the change is recorded rather than hidden.
    //
    // The gap-16 sample moves the same way, and for the same reason one step
    // further out (2026-08-21 late night, the RELOCATION refinement): a column
    // that read nothing is not a boundary, so S8's silt does not stop at the
    // short S10 — it crosses S10, B2, S7A and S7 (none of which reached -4.45)
    // and pinches against S6, the first test that DID read that ground, 155 m
    // away. Its wedge therefore stands at gap 16 -4.86..-5.91 where the old
    // sample sat. The sand sample moves 0.5 m up, above the silt's top there,
    // and the silt's own wedge is pinned at the vacated point.
    expect(geotechClassAt(scene, 14, 0.5, -4.0), 'VD above its correlation (gap 14)').toBe('ZAND-6')
    expect(geotechClassAt(scene, 14, 0.5, -5.0), "S8's drilled silt carries across").toBe('SILT-16')
    expect(geotechClassAt(scene, 15, 0.5, -4.5), 'VD below S10 above the line (gap 15)').toBe(
      'ZAND-6',
    )
    expect(geotechClassAt(scene, 16, 0.333, -4.5), 'VD above its correlation (gap 16)').toBe(
      'ZAND-6',
    )
    expect(geotechClassAt(scene, 16, 0.333, -5.0), "S8's silt reaches S6, the first test that read").toBe(
      'SILT-16',
    )
  })

  it('S22 · gap 15 · an onlapping dense takes no remainder; the MD fills below S10 TD', () => {
    // Owner, 2026-08-21 night: "why is there still a dense sand quad below
    // S10, the dense sand onlaps so the MD should fill." S8's D (-3.68..-4.45)
    // has ONE tied contact (a fan at its top, to S9 and to S10's base) — it
    // onlaps and pinches in its own gap, a closed loop that cannot fill ground
    // beyond that pinch in ANY gap. The window below S10's TD (-3.24..-4.45 in
    // S10|B2) is the MD's: B2's own tail band reads MD there, and with no
    // facing data below S10's TD its statement continues across.
    expect(geotechClassAt(scene, 15, 0.25, -3.9), 'the D quad below S10 (left half)').toBe('ZAND-6')
    expect(geotechClassAt(scene, 15, 0.65, -4.25), 'the D under the MD onlap (right half)').toBe(
      'ZAND-6',
    )
    // The D's own honest pinch in its own gap stays.
    expect(geotechClassAt(scene, 14, 0.1, -4.0), 'the D onlap up to its contact').toBe('ZAND-7')
  })

  it('S23 · gaps 16-17 · an interbed facing sub-TD continues; it pinches only against data', () => {
    // Owner, 2026-08-21 late night, on S7's thin KLEI-22 interbed rendered as
    // phantom lenses around S7A: "it should be a continuous band starting
    // from S7 but now it is interrupted at S7A's column by a SF clay render."
    // S7A's only band is its top silt (TD ~+10.4) — below that it has nothing
    // to meet, so the interbed continues full-thickness across gap 17 to
    // S7A's column, and the adopted copy in gap 16 still pinches toward B2,
    // whose log DID read continuous clay there.
    //
    // Both arms carry the law now: the geotech constructive arm
    // (constructs.ts, extendsToFar) and the litho engine
    // (partitionFillV2/emitContinuation.ts). It had to be both — the geotech
    // frame can never exceed the litho cover, so while only the geotech half
    // existed this pin stayed red on a litho pinch the engine invented.
    expect(geotechClassAt(scene, 17, 0.3, 6.3), 'the interbed interrupted at S7A').toBe('KLEI-22')
    expect(geotechClassAt(scene, 16, 0.75, 6.3), 'the adopted interbed at S7A side').toBe(
      'KLEI-22',
    )
    expect(geotechClassAt(scene, 16, 0.2, 6.3), 'the pinch against B2 data stands').toBe('KLEI-21')
  })

  it('S8 · gap 11 · the closed form floods with the only silt that can fill it', () => {
    // Owner: "we have a closed form, the only thing left that can flood that form
    // is the MF silt to the left." The form sits between the left test's silt band
    // and the right test's, above the left band's top — no test read that level, so
    // the horizontal read gives up; the bounding band is the answer.
    const painted = geotechClassAt(scene, 11, 0.35, 5.7)
    expect(painted).not.toBe('(hatch)')
    expect(painted).toBe('SILT-14')
  })

  it('S24 · gap 19 · an onlap is a TRIANGLE — it never takes the ground above its own pinch', () => {
    // Owner, 2026-08-22: *"The loose sand has a bottom tie, not a top tie
    // that is why it is an onlap and should be a triangle and not a quad"*.
    //
    // ci19's ZAND-5 (loose sand, 11.06..10.65) carries ONE tie, on its BASE
    // contact (ci19@10.65 -> ci20@11.07), so it rides that line and its free
    // TOP pinches down onto it — a triangle, apex at the middle. The engine
    // builds exactly that triangle. What made it read as a QUAD is a SECOND
    // face: the remainder step handed the band the wedge directly ABOVE its
    // own pinching top (still inside its nominal 11.06..10.65 window, so it
    // won the ownsLevel rank), and the two together square off against the
    // mid-gap seam.
    //
    // A band's own construct is the statement of where it is. Where that
    // construct speaks, it speaks completely — the remainder may not re-add
    // ground the band's own closed shape has already excluded.
    expect(
      geotechClassAt(scene, 19, 0.167, 10.857),
      'the onlap keeps its own triangle',
    ).toBe('ZAND-5')
    // POSITIVE, not a bare negation (audit finding, 2026-08-23): `.not.toBe`
    // is also satisfied by '(hatch)' and by null — "nothing is painted here"
    // — and this very fix is the one that moves ground to the correlate-me
    // hatch, so a negation could not tell the intended outcome from a hole.
    // Name the mass that should take it: the medium-dense sand ABOVE, closing
    // over the loose sand as it pinches out.
    expect(
      geotechClassAt(scene, 19, 0.333, 10.993),
      'the ground above the pinch belongs to the MD sand above, not the onlap',
    ).toBe('ZAND-6')
  })
})
