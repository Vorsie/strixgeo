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
    deriveSectionApexOverrides(L.columns, lithoEdges, L.alongM, empty, true),
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
  })
  const nad = raw.refinementBundle.nadMeta
  const soil = raw.refinementBundle.lithoSoilByFormationId
  return {
    litho,
    geotech: hierarchical.regions,
    fallback: hierarchical.lithoFallback,
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

  // PENDING OWNER RULING (2026-08-19): this pin encodes his MORNING sentence
  // (below-TD adoption of the SF band), but his COMPLETE emit table of the same
  // afternoon makes a 0-tie band a LENS - and the lens's taper leaves the pinned
  // sample (f=0.5, e=4.6) 2 cm outside it. The two rulings disagree on this
  // scene by exactly that taper. `it.fails` holds the conflict LOUDLY: if the
  // behaviour changes to satisfy this pin without a ruling, the suite goes red.
  it.fails('S6 · gap 8 · the adopted silt band is ONE band, not split (CONFLICTS with the emit table - awaiting ruling)', () => {
    // Owner: "Below TD there is a SF on the test to the right that gets adopted
    // ... there the SF silt is one band, it gets split below TD at S8? why?"
    // The right test read SILT-13 over 5.49 .. 4.43; sampled beside it the adopted
    // cover must read that one class over that whole interval — across the run's own
    // floor (5.01, the far test's base) and out the other side — with nothing threaded
    // through it.
    for (const e of [5.45, 5.2, 5.05, 4.9, 4.6]) {
      expect(geotechClassAt(scene, 8, 0.9, e)).toBe('SILT-13')
    }
    // Mid-gap, where the band has tapered but is still one band: reading it as
    // SILT-13 / SILT-14 / SILT-13 down the same vertical is the split he asked about.
    for (const e of [5.25, 5.15, 5.05, 4.9, 4.6]) {
      expect(geotechClassAt(scene, 8, 0.5, e)).toBe('SILT-13')
    }
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

  it('S13a · gap 0 · the bottom dense sand onlaps along its tie, not into a straight line', () => {
    // S6's ZAND-7 at -0.33 .. -1.77 carries ONE tie, on its base contact (the very
    // dense sand's top over on S10). It follows that line across the gap — its base
    // rides -1.77 -> -1.33 — and it does not stop on a vertical mid-gap.
    for (const [f, e] of [
      [0.9, -1.5],
      [0.5, -1.0],
      [0.15, -0.9],
    ] as const) {
      expect(geotechClassAt(scene, 0, f, e), `(${f},${e})`).toBe('ZAND-7')
    }
    const own = scene.geotech.filter(
      (r) =>
        r.gapIndex === 0 &&
        scene.classOf(r.formationId) === 'ZAND-7' &&
        Math.max(...r.polygon.map((p) => p.elevation)) < 0,
    )
    expect(own.length).toBeGreaterThan(0)
    expect(Math.min(...own.flatMap((r) => r.polygon.map((p) => p.fraction)))).toBeLessThan(0.05)
  })

  it('S13b · gap 0 · the deep clay onlaps along its tie too', () => {
    // S6's KLEI-22 at -2.35 .. -3.25 carries ONE tie, on its TOP contact (S10's deep
    // clay top). It follows that line — its top rides -2.35 -> -3.54 — and closes where
    // the line meets its own base level: an onlap, not a vertical.
    expect(geotechClassAt(scene, 0, 0.9, -2.6)).toBe('KLEI-22')
    expect(geotechClassAt(scene, 0, 0.6, -3.0)).toBe('KLEI-22')
    // ...and it CLOSES: past the point where the tie meets its own base level the
    // clay of the other test owns the ground, so the onlap never reaches that test.
    const onlap = scene.geotech.filter(
      (r) => r.gapIndex === 0 && scene.classOf(r.formationId) === 'KLEI-22',
    )
    expect(onlap.length).toBe(1)
    expect(Math.min(...onlap[0].polygon.map((p) => p.fraction))).toBeGreaterThan(0.05)
    expect(geotechClassAt(scene, 0, 0.1, -3.6)).toBe('KLEI-23')
  })

  it('S13c · gap 0 · the top dense sand emits NOTHING — same litho and packing across', () => {
    // "follow the tie, it is the same litho and packing density don't emit onlap":
    // S6's ZAND-7 at 1.45 .. 0.71 is tied on its base contact to S10's ZAND-7|SILT
    // contact, and what continues ABOVE that line is S10's own ZAND-7. One mass, so no
    // construct at all — and after the fill sweep, ONE region carrying both bands.
    const dense = scene.geotech.filter(
      (r) =>
        r.gapIndex === 0 &&
        scene.classOf(r.formationId) === 'ZAND-7' &&
        Math.min(...r.polygon.map((p) => p.elevation)) > 0.5 &&
        Math.max(...r.polygon.map((p) => p.elevation)) < 2.5,
    )
    expect(dense.length).toBe(1)
    expect((dense[0].layerIds ?? []).length).toBe(2)
    // Mid-gap, inside the sand's own window between the two tie lines (the silt unit
    // below it starts at 1.22 there — the litho frame, not this band's business).
    expect(geotechClassAt(scene, 0, 0.5, 1.3)).toBe('ZAND-7')
  })

  it('S13d · gap 0 · the md sand above emits an onlap — same litho, different packing', () => {
    // "the md sand above, same litho different packing = emit onlap": S6's ZAND-6 at
    // 2.87 .. 1.45 is tied on its top contact, and what continues BELOW that line on S10
    // is its ZAND-7. Different packing, so it onlaps along the tie.
    expect(geotechClassAt(scene, 0, 0.9, 2.0)).toBe('ZAND-6')
    expect(geotechClassAt(scene, 0, 0.6, 1.9)).toBe('ZAND-6')
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
})
