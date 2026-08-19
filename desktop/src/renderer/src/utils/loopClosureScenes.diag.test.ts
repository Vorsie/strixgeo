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

  it('S6 · gap 8 · the adopted silt band is ONE band, not split', () => {
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
      .filter((r) => r.gapIndex === 2 && ringsOverlap(r.polygon, band))
      .map((r) => r.polygon.map((p) => `(${p.fraction.toFixed(2)},${p.elevation.toFixed(2)})`).join(''))
    expect(offenders).toEqual([])
  })

  it('S9c · gap 2 · the deleted tie stays deleted — the two classes do not band', () => {
    // He deleted the geotech restatement between these two bands this morning. The soil
    // cover connects because the LITHO tie says so; the CLASSES must not. So no single
    // clay region may span the gap, and the two must meet rather than merge.
    const spanning = scene.geotech.filter((r) => {
      if (r.gapIndex !== 2) return false
      if (!(scene.classOf(r.formationId) ?? '').startsWith('KLEI')) return false
      const fr = r.polygon.map((p) => p.fraction)
      const hi = Math.max(...r.polygon.map((p) => p.elevation))
      const lo = Math.min(...r.polygon.map((p) => p.elevation))
      // Only the band's own window — the clay bodies above and below it legitimately span.
      if (hi > 7.6 || lo < 3.6) return false
      return Math.min(...fr) < 0.02 && Math.max(...fr) > 0.98
    })
    expect(spanning).toEqual([])
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
