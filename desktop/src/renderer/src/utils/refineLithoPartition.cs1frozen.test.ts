/**
 * ALWAYS-ON real-data watertightness gate for the geotech fraction-space
 * refinement (owner-locked, 2026-07-06).
 *
 * Loads the committed anonymised CS1 slice (litho partition input + geotech NAD
 * sub-band columns, snapshot 2026-07-06 from the dev DB via
 * ``scripts/throwaway_freeze_geotech_fixture.mjs``), runs the PRODUCTION
 * ``refineLithoPartition`` on the real ``computeSectionFill`` output, projects
 * to detector space with the fixture's real along-positions, and asserts the
 * refinement's core invariant: **zero genuine polygon overlaps** (by-design
 * opaque overlays excluded). This mirrors ``partitionFill.cs1frozen.test.ts``
 * — no env gate, no dev-DB dependency, runs on every ``npm test``.
 *
 * The env-gated live companion (``refineLithoPartition.cs1gate.test.ts``,
 * ``CS1_GATE=1``) adds the substrate pass + the full render on live dev-DB
 * data; this frozen file is the clean-checkout safety net.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { computeSectionFill, type CorrelationEdge, type PartitionColumn } from './partitionFill'
import {
  refineLithoPartition,
  type GeotechColumn,
  type NadFormationMeta,
  type RefinedPolygon,
} from './refineLithoPartition'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = resolve(HERE, './__fixtures__/cs1_geotech_frozen.json')

interface Frozen {
  alongM: Record<string, number>
  columns: Array<{ investigationId: string; surfaceElevM: number | null; units: PartitionColumn['units'] }>
  edges: CorrelationEdge[]
  geotechColumns: GeotechColumn[]
  nadFormations: Record<string, NadFormationMeta>
  lithoSoil: Record<string, string>
}

const frozen: Frozen = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'))

// ---------------------------------------------------------------------------
// Rebuild the inputs the renderer would pass, in section (along) order.
// ---------------------------------------------------------------------------

const columns: PartitionColumn[] = frozen.columns
  .filter((c) => c.surfaceElevM != null)
  .map((c) => ({
    investigationId: c.investigationId,
    surfaceElevM: c.surfaceElevM as number,
    units: c.units,
  }))
const columnOrder = columns.map((c) => c.investigationId)

const geotechColumns = new Map(frozen.geotechColumns.map((c) => [c.investigationId, c]))
const nadMeta = new Map(Object.entries(frozen.nadFormations))
const lithoSoil = new Map<string, string | null>(Object.entries(frozen.lithoSoil))

// Pass the REAL along-section spacing (the fixture already carries it, keyed by
// investigation). Without it computeSectionFill uses uniform spacing and the
// deep-to-deep substrate geometry diverges from the live render — the same gap
// that hid the S8 second-pinch. alongM must align 1:1 with ``columns``.
const alongM = columns.map((c) => frozen.alongM[c.investigationId] ?? 0)
const regions = computeSectionFill(columns, frozen.edges, undefined, alongM)
const refined = refineLithoPartition(regions, columnOrder, geotechColumns, nadMeta, lithoSoil)

// A refined polygon's packing identity, for the "one class per point" gate.
// The soil code AND the NAD class both matter: a sand region may never show a
// clay class at a point, and a sand region may never show two sand classes at
// one point.
const identityOf = (p: RefinedPolygon): string => {
  const m = nadMeta.get(p.formationId)
  if (m) return `${m.soilCode ?? '?'}:${m.nadClass ?? '?'}`
  return `litho:${lithoSoil.get(p.formationId) ?? '?'}` // fallback fill
}

// Even-odd point-in-polygon in (fraction, elevation) space.
function inPoly(px: number, pe: number, pts: readonly { fraction: number; elevation: number }[]): boolean {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]
    const b = pts[j]
    if (
      a.elevation > pe !== b.elevation > pe &&
      px < a.fraction + ((pe - a.elevation) / (b.elevation - a.elevation)) * (b.fraction - a.fraction)
    )
      inside = !inside
  }
  return inside
}

const byGap = new Map<number, RefinedPolygon[]>()
for (const p of refined) {
  const l = byGap.get(p.gapIndex) ?? []
  l.push(p)
  byGap.set(p.gapIndex, l)
}
// A handful of cells on a shared edge get sampled as "inside both" by any grid
// point-in-polygon (the boundary is inclusive on both sides) — exactly the
// rasterisation-noise the litho gate absorbs with its own CELL_THRESHOLD. A
// genuine cross-class overlap is a solid patch of dozens of cells.
const CROSS_CLASS_CELL_THRESHOLD = 12

/**
 * Points covered by two DIFFERENT packing identities — the partition invariant.
 *
 * Extracted so the tie-driven arms below are held to the SAME check as the
 * legacy arm rather than a re-statement of it; negative-controlled in the last
 * case of this file.
 *
 * @param polys One refinement's output, any gap mix.
 * @returns One line per offending gap+identity-pair, empty when the refinement
 *   assigns at most one packing identity to every point.
 */
function crossClassOffenders(polys: readonly RefinedPolygon[]): string[] {
  interface Boxed {
    p: RefinedPolygon
    x0: number
    x1: number
    e0: number
    e1: number
    id: string
  }
  const gaps = new Map<number, RefinedPolygon[]>()
  for (const p of polys) {
    const l = gaps.get(p.gapIndex) ?? []
    l.push(p)
    gaps.set(p.gapIndex, l)
  }
  const offenders: string[] = []
  for (const [gap, regs] of [...gaps.entries()].sort((a, b) => a[0] - b[0])) {
    const boxed: Boxed[] = regs
      .filter((p) => p.tag !== 'hlens' && p.tag !== 'enclens')
      .map((p) => {
        let x0 = Infinity
        let x1 = -Infinity
        let e0 = Infinity
        let e1 = -Infinity
        for (const q of p.points) {
          if (q.fraction < x0) x0 = q.fraction
          if (q.fraction > x1) x1 = q.fraction
          if (q.elevation < e0) e0 = q.elevation
          if (q.elevation > e1) e1 = q.elevation
        }
        return { p, x0, x1, e0, e1, id: identityOf(p) }
      })
    let minE = Infinity
    let maxE = -Infinity
    for (const b of boxed) {
      if (b.e0 < minE) minE = b.e0
      if (b.e1 > maxE) maxE = b.e1
    }
    if (!Number.isFinite(minE) || maxE - minE < 1e-6) continue
    const NX = 160
    const NY = 280
    const seen = new Map<string, number>()
    for (let iy = 0; iy < NY; iy++) {
      const pe = maxE - ((iy + 0.5) / NY) * (maxE - minE)
      const row = boxed.filter((b) => pe >= b.e0 && pe <= b.e1)
      if (row.length < 2) continue
      for (let ix = 0; ix < NX; ix++) {
        const px = (ix + 0.5) / NX
        const ids = new Set<string>()
        for (const b of row) if (px >= b.x0 && px <= b.x1 && inPoly(px, pe, b.p.points)) ids.add(b.id)
        if (ids.size >= 2) {
          const key = [...ids].sort().join(' x ')
          seen.set(key, (seen.get(key) ?? 0) + 1)
        }
      }
    }
    for (const [key, cells] of seen) {
      if (cells >= CROSS_CLASS_CELL_THRESHOLD) offenders.push(`GAP-${gap} ${key}: ${cells} cells`)
    }
  }
  return offenders
}

describe('CS1 frozen geotech-refinement gate (always-on)', () => {
  it('fixture: 24 litho columns + 24 geotech columns, edges present', () => {
    expect(frozen.columns).toHaveLength(24)
    expect(frozen.geotechColumns).toHaveLength(24)
    expect(frozen.edges.length).toBeGreaterThan(0)
  })

  it('refinement emits polygons across the section (no vacuous pass)', () => {
    // Teeth: an empty refinement would make the overlap assertion vacuously
    // green. The real CS1 has NAD sub-bands in almost every gap.
    expect(refined.length).toBeGreaterThan(100)
    const gaps = new Set(refined.map((p) => p.gapIndex))
    expect(gaps.size).toBeGreaterThanOrEqual(15)
  })

  it('the pinch/lens single-fill covers every non-quad region with exactly one class', () => {
    // A pinch/lens region is filled with its single dominant class (no internal
    // stratification) — so it contributes exactly one refined polygon and no
    // cross-class overlap can arise inside it. A `pinch` is a disjoint wedge
    // (`band`); a `lens` is an opaque overlay (`hlens`) — both are single-fill.
    const nonQuad = refined.filter((p) => p.regionKind !== 'quad')
    expect(nonQuad.length).toBeGreaterThan(0)
    for (const p of nonQuad)
      expect(p.tag === 'band' || p.tag === 'fallback' || p.tag === 'hlens').toBe(true)
  })

  it('no refined polygon escapes its litho region envelope (boundaries invariant)', () => {
    // Every non-fallback refined polygon is carved inside a region of the same
    // gap; its elevation range must sit within that gap's regions' union range.
    // (A byte-exact envelope check happens per-slice inside emitBand via the
    // material-space clip; this is the cheap outer guard.)
    const gapElev = new Map<number, { lo: number; hi: number }>()
    for (const r of regions) {
      const cur = gapElev.get(r.gapIndex) ?? { lo: Infinity, hi: -Infinity }
      for (const p of r.polygon) {
        if (p.elevation < cur.lo) cur.lo = p.elevation
        if (p.elevation > cur.hi) cur.hi = p.elevation
      }
      gapElev.set(r.gapIndex, cur)
    }
    const escapes: string[] = []
    for (const p of refined) {
      if (p.tag === 'fallback') continue
      const g = gapElev.get(p.gapIndex)
      if (!g) continue
      for (const q of p.points) {
        if (q.elevation < g.lo - 0.15 || q.elevation > g.hi + 0.15) {
          escapes.push(`${p.tag}#g${p.gapIndex} elev ${q.elevation.toFixed(2)} outside [${g.lo.toFixed(2)}..${g.hi.toFixed(2)}]`)
          break
        }
      }
    }
    expect(escapes, `envelope escapes:\n${escapes.slice(0, 10).join('\n')}`).toEqual([])
  })

  it('has ZERO cross-class overlap: one packing class per point (the partition invariant)', () => {
    // THE watertightness invariant (owner-locked 2026-07-06), stated as the
    // property that actually matters and mirrors the litho gate's own "one
    // lithology per point": no point may show two DIFFERENT packing identities
    // (different soil, or different NAD class). A same-class self-overlap is
    // geometrically harmless — the point still renders one class — and is
    // excluded (it is present in the owner-accepted rev-8 reference too). Lens
    // OVERLAYS (hlens / enclens) are by-design opaque overlays and excluded.
    const offenders = crossClassOffenders(refined)
    expect(offenders, `cross-class overlaps found:\n${offenders.join('\n')}`).toEqual([])
  }, 30000)
})

// ---------------------------------------------------------------------------
// COVERAGE — the direction the overlap gate above cannot see.
// ---------------------------------------------------------------------------

/** Shoelace area of a gap-local polygon, in (along metres x elevation). */
function polygonAreaM2(
  pts: readonly { fraction: number; elevation: number }[],
  gapWidthM: number,
): number {
  let a2 = 0
  for (let i = 0; i < pts.length; i++) {
    const b = pts[(i + 1) % pts.length]
    a2 += pts[i].fraction * gapWidthM * b.elevation - b.fraction * gapWidthM * pts[i].elevation
  }
  return Math.abs(a2) / 2
}

const gapWidthsM = columns
  .slice(0, -1)
  .map((_, i) => Math.abs((alongM[i + 1] ?? 0) - (alongM[i] ?? 0)))

describe('CS1 frozen geotech-refinement gate — coverage (always-on)', () => {
  // WHY THIS EXISTS. The invariant case above only catches polygons ESCAPING
  // the litho envelope; it is blind to the opposite failure, the refinement
  // covering LESS of the litho partition than it started with. That direction is
  // the render arm's largest known own-terms flaw: the model-wide agreement gate
  // measures 1810.1 m2 (3.02 %) of the litho partition dropped and 696.13 m2 of
  // interior voids opened by the carve (worst hole 17.0 m across, Tie-section 4)
  // — holes the engineer sees as gaps in the packing render. This case pins the
  // frozen CS1 slice's own loss so that number cannot grow unnoticed.
  //
  // The design rule says litho boundaries are INVARIANT, so the honest target is
  // 0.0 %. This slice measures 1.92 % (363.9 m2 of 18,920.6 m2) after the
  // 2026-08-04 partition-integrity work (was 2.11 % / 399.5 m2) — the bound is
  // that plus a hair of headroom, a RATCHET and not an endorsement: drive the
  // loss down, then tighten the bound.
  //
  // 338.7 m2 of the remaining 363.9 is the OWNER-LOCKED lens rule: a litho
  // ``lens`` region emits one ``hlens`` overlay and no tiling polygon (see the
  // comment at that branch in refineLithoPartition.ts), and this measurement
  // excludes overlays, so the whole region scores as loss even though the render
  // paints it. The genuine carve residual is ~25 m2 (0.13 %) — end-of-strip
  // discretisation. Model-wide, measured as the UNION the engineer actually
  // sees, the carve now drops 64 m2 of 59,853 m2 (0.11 %), down from 1,816 m2.
  const MAX_COVERAGE_LOSS_PCT = 2.0

  it('the refinement covers the litho partition it is documented to leave invariant', () => {
    let lithoM2 = 0
    for (const r of regions) lithoM2 += polygonAreaM2(r.polygon, gapWidthsM[r.gapIndex] ?? 0)
    let refinedM2 = 0
    for (const p of refined) {
      // Overlays paint OVER a fill that is already counted — including them
      // would credit the same square metre twice and mask a real hole.
      if (p.tag === 'hlens' || p.tag === 'enclens') continue
      refinedM2 += polygonAreaM2(p.points, gapWidthsM[p.gapIndex] ?? 0)
    }
    const lossPct = ((lithoM2 - refinedM2) / lithoM2) * 100
    expect(lithoM2).toBeGreaterThan(1000)
    expect(
      lossPct,
      `the NAD carve dropped ${(lithoM2 - refinedM2).toFixed(1)} m2 of ${lithoM2.toFixed(1)} m2 ` +
        `(${lossPct.toFixed(2)} %) of the litho partition; the design rule says 0`,
    ).toBeLessThan(MAX_COVERAGE_LOSS_PCT)
  })
})

// ---------------------------------------------------------------------------
// THE EDGE-DRIVEN ARM (owner ruling 2026-08-04) — same real slice, same
// invariants, ties in charge of the gap fill.
// ---------------------------------------------------------------------------

/** Total non-overlay area of a refinement, in real m². */
function coveredM2(polys: readonly RefinedPolygon[]): number {
  let m2 = 0
  for (const p of polys) {
    if (p.tag === 'hlens' || p.tag === 'enclens') continue
    m2 += polygonAreaM2(p.points, gapWidthsM[p.gapIndex] ?? 0)
  }
  return m2
}

/**
 * A stand-in for the engineer's hand correlations on this slice.
 *
 * ⚠ SYNTHETIC, and named so. The frozen fixture predates geotech packing edges
 * and carries none, so there is no recorded tie set to replay. This ties the
 * TOPS of same-NAD-class sub-bands that overlap in elevation between ADJACENT
 * columns — the correlation an engineer would most plausibly draw, and dense
 * enough that the tie-driven arm actually bands rather than passing vacuously.
 * It is a test fixture only: nothing in the product derives ties this way.
 */
function handTieStandIn(): CorrelationEdge[] {
  const out: CorrelationEdge[] = []
  const classOf = (formationId: string): number | null =>
    nadMeta.get(formationId)?.nadClass ?? null
  for (let i = 0; i + 1 < columnOrder.length; i++) {
    const A = geotechColumns.get(columnOrder[i])
    const B = geotechColumns.get(columnOrder[i + 1])
    if (!A || !B) continue
    for (const a of A.units) {
      const ca = classOf(a.formationId)
      if (ca === null) continue
      const aTop = A.surfaceElevM - a.topDepthM
      const aBase = A.surfaceElevM - a.baseDepthM
      for (const b of B.units) {
        if (classOf(b.formationId) !== ca) continue
        const bTop = B.surfaceElevM - b.topDepthM
        const bBase = B.surfaceElevM - b.baseDepthM
        if (Math.min(aTop, bTop) - Math.max(aBase, bBase) > 0.05)
          out.push({ a: a.layerId, b: b.layerId, aSide: 'top', bSide: 'top' })
      }
    }
  }
  return out
}

/**
 * Coverage-loss ratchet for the tie modes, same spirit as the legacy arm's:
 * pinching untied spans out may change WHICH class fills the gap, never how
 * much of it is painted.
 */
const MAX_COVERAGE_LOSS_TIE_MODES_PCT = 2.0

const tieStandIn = handTieStandIn()
const refinedTied = refineLithoPartition(
  regions,
  columnOrder,
  geotechColumns,
  nadMeta,
  lithoSoil,
  { packingEdges: tieStandIn },
)
const refinedNoTies = refineLithoPartition(
  regions,
  columnOrder,
  geotechColumns,
  nadMeta,
  lithoSoil,
  { packingEdges: [] },
)

describe('CS1 frozen geotech-refinement gate — edge-driven arm (always-on)', () => {
  it('the tie set has teeth: it bands, and it is NOT the legacy output', () => {
    // Without this the invariants below could pass on an arm that never ran.
    expect(tieStandIn.length).toBeGreaterThan(50)
    expect(refinedTied.filter((p) => p.tag === 'band').length).toBeGreaterThan(20)
    expect(JSON.stringify(refinedTied)).not.toEqual(JSON.stringify(refined))
  })

  it('requiring a tie bands LESS than the legacy geometric pairing, and no ties bands least', () => {
    const quadBands = (ps: readonly RefinedPolygon[]): number =>
      ps.filter((p) => p.tag === 'band' && p.regionKind === 'quad').length
    // Legacy pairs any same-class span pair that is vertically near; the tie
    // rule pairs only correlated ones, so banding can only shrink. Measured on
    // this slice: 5486 legacy -> 3622 tie-driven -> 3162 with no ties at all.
    expect(quadBands(refinedTied)).toBeLessThan(quadBands(refined))
    expect(quadBands(refinedNoTies)).toBeLessThan(quadBands(refinedTied))
  })

  it('half this slice never reaches the tie rule — one side borrows or mirrors', () => {
    // THE NUMBER TO KNOW BEFORE READING ANY OTHER RESULT HERE. The tie
    // precondition only applies where BOTH sides read their OWN column's
    // packing. A side with none borrows the nearest donor or mirrors the other
    // side (rule 6b / the S10 mirror, both left exactly as shipped), and a
    // borrowed span has no layer of its own to tie — so those regions keep the
    // legacy class+position pairing. On this real slice that is HALF the quad
    // regions: "no ties" is nowhere near "no bands".
    //
    // Moves only when the borrow/mirror rule or the frozen fixture changes. If
    // it moves for any other reason, the tie gate has leaked into the mirror.
    let fellBack = 0
    let quads = 0
    for (const r of regions) {
      if (r.kind !== 'quad') continue
      quads++
      const one = refineLithoPartition([r], columnOrder, geotechColumns, nadMeta, lithoSoil, {
        packingEdges: [],
      })
      if (one.some((p) => p.tag === 'band')) fellBack++
    }
    expect(quads).toBe(163)
    expect(fellBack, `${fellBack} of ${quads} quad regions band with an empty tie list`).toBe(81)
  })

  it('keeps ONE packing class per point when the ties drive the fill', () => {
    const offenders = crossClassOffenders(refinedTied)
    expect(offenders, `cross-class overlaps (tie-driven):\n${offenders.join('\n')}`).toEqual([])
  }, 30000)

  it('keeps ONE packing class per point when NOTHING is tied (everything pinches)', () => {
    const offenders = crossClassOffenders(refinedNoTies)
    expect(offenders, `cross-class overlaps (no ties):\n${offenders.join('\n')}`).toEqual([])
  }, 30000)

  it('covers the litho partition in BOTH tie modes, as it does on the legacy path', () => {
    let lithoM2 = 0
    for (const r of regions) lithoM2 += polygonAreaM2(r.polygon, gapWidthsM[r.gapIndex] ?? 0)
    const lossTied = ((lithoM2 - coveredM2(refinedTied)) / lithoM2) * 100
    const lossNone = ((lithoM2 - coveredM2(refinedNoTies)) / lithoM2) * 100
    // The same ratchet the legacy arm is held to — pinching out untied spans
    // may change WHICH class fills the gap, never how much of it is painted.
    // Measured 1.89 % in both modes (legacy 1.92 %).
    expect(lossTied, `tie-driven coverage loss ${lossTied.toFixed(2)} %`).toBeLessThan(
      MAX_COVERAGE_LOSS_TIE_MODES_PCT,
    )
    expect(lossNone, `no-tie coverage loss ${lossNone.toFixed(2)} %`).toBeLessThan(
      MAX_COVERAGE_LOSS_TIE_MODES_PCT,
    )
  })

  it('NEGATIVE CONTROL — the cross-class checker flags a planted overlap', () => {
    // The three invariant cases above are only worth their green if the checker
    // can go red. Plant two full-region polygons of DIFFERENT identities in one
    // gap and confirm it says so.
    const victim = refined.find((p) => p.tag === 'band' && p.points.length >= 4)
    expect(victim).toBeDefined()
    const other = refined.find(
      (p) => p.gapIndex === victim!.gapIndex && identityOf(p) !== identityOf(victim!),
    )
    expect(other).toBeDefined()
    const planted: RefinedPolygon[] = [
      victim!,
      { ...other!, tag: 'band', points: victim!.points },
    ]
    expect(crossClassOffenders(planted).length).toBeGreaterThan(0)
  })
})
