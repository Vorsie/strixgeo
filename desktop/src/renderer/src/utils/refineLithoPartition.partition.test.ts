/**
 * THE PARTITION INVARIANT for the geotech fraction-space refinement.
 *
 * ``refineLithoPartition`` is documented to leave the litho boundaries
 * INVARIANT and to subdivide each litho region internally. Stated as a
 * property, that means the refined polygons must **tile** the region they were
 * carved from:
 *
 *  * every square metre of the litho region carries exactly one packing fill —
 *    no interior void (the engineer sees a void as a hole in the packing
 *    render, and a 3-D inherit sees it as unlabelled ground);
 *  * no two tiling polygons overlap (a point may not carry two packing fills).
 *
 * By-design OVERLAYS are excluded from both halves, exactly as
 * ``refineLithoPartition.overlap.ts`` excludes them: an ``hlens`` / ``enclens``
 * paints ON TOP of the fill that already tiles its gap. Everything else —
 * ``band``, ``bracket``, ``fallback`` — is tiling geometry.
 *
 * The scenes below are the WORST REAL INSTANCES measured on the owner's 14
 * sections (2026-08-04 defect taxonomy) reduced to two-column fixtures: the
 * region polygons are the real ones, the packing stacks are synthetic. Each
 * test names the mechanism it pins so a regression says which one came back.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  computeSectionFill,
  type CorrelationEdge,
  type PartitionColumn,
  type SectionRegion,
} from './partitionFill'
import {
  refineLithoPartition,
  type GeotechColumn,
  type NadFormationMeta,
  type RefinedPolygon,
} from './refineLithoPartition'

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

const NAD: ReadonlyMap<string, NadFormationMeta> = new Map([
  ['nad-zand-5', { nadClass: 5, soilCode: 'ZAND' }],
  ['nad-zand-7', { nadClass: 7, soilCode: 'ZAND' }],
  ['nad-zand-8', { nadClass: 8, soilCode: 'ZAND' }],
  ['nad-veen-29', { nadClass: 29, soilCode: 'VEEN' }],
  ['nad-veen-30', { nadClass: 30, soilCode: 'VEEN' }],
])

const LITHO_SOIL: ReadonlyMap<string, string | null> = new Map([
  ['formation-sand', 'ZAND'],
  ['formation-peat', 'VEEN'],
])

/** Geotech column from [topElev, baseElev, formationId] bands. */
function gcol(
  investigationId: string,
  surfaceElevM: number,
  bands: readonly [number, number, string][],
): GeotechColumn {
  return {
    investigationId,
    surfaceElevM,
    units: bands.map(([topElev, baseElev, formationId], i) => ({
      layerId: `${investigationId}-g${i}`,
      topDepthM: surfaceElevM - topElev,
      baseDepthM: surfaceElevM - baseElev,
      formationId,
      bodyId: null,
    })),
  }
}

const gmap = (...cols: GeotechColumn[]): ReadonlyMap<string, GeotechColumn> =>
  new Map(cols.map((c) => [c.investigationId, c]))

// ---------------------------------------------------------------------------
// Tiling measurement — scanline in (fraction, elevation) space
// ---------------------------------------------------------------------------

interface Pt {
  fraction: number
  elevation: number
}
type Slab = [number, number] // [top, base], top > base

/**
 * Solid [top, base] runs of a polygon at fraction ``f`` (even-odd pairing).
 * Sampling happens at cell centres, never at a vertex fraction, so the
 * half-open crossing test cannot double-count a vertex.
 */
function slabsAt(poly: readonly Pt[], f: number): Slab[] {
  const hits: number[] = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const df = b.fraction - a.fraction
    if (Math.abs(df) < 1e-12) continue
    const t = (f - a.fraction) / df
    if (t >= 0 && t < 1) hits.push(a.elevation + t * (b.elevation - a.elevation))
  }
  hits.sort((p, q) => q - p)
  const out: Slab[] = []
  for (let i = 0; i + 1 < hits.length; i += 2)
    if (hits[i] - hits[i + 1] > 1e-12) out.push([hits[i], hits[i + 1]])
  return out
}

/** Merge overlapping/touching slabs into a disjoint descending list. */
function mergeSlabs(slabs: readonly Slab[]): Slab[] {
  const s = [...slabs].sort((a, b) => b[0] - a[0])
  const out: Slab[] = []
  for (const [t, b] of s) {
    const last = out[out.length - 1]
    if (last && t >= last[1] - 1e-12) last[1] = Math.min(last[1], b)
    else out.push([t, b])
  }
  return out
}

const slabLen = (s: readonly Slab[]): number => s.reduce((a, [t, b]) => a + (t - b), 0)

/** Parts of ``a`` not covered by ``b`` (both descending, ``b`` disjoint). */
function subtractSlabs(a: readonly Slab[], b: readonly Slab[]): Slab[] {
  const out: Slab[] = []
  for (const [t0, b0] of a) {
    let cur = t0
    for (const [t1, b1] of b) {
      if (b1 >= cur || t1 <= b0) continue
      const top = Math.min(cur, t1)
      const bot = Math.max(b0, b1)
      if (cur - top > 1e-9) out.push([cur, top])
      cur = Math.min(cur, bot)
      if (cur <= b0) break
    }
    if (cur - b0 > 1e-9) out.push([cur, b0])
  }
  return out
}

/**
 * Thickest run covered by two or more of ``slabs`` — a depth sweep over the
 * endpoints (a pairwise scan is quadratic and unusable on a real section's
 * thousands of polygons).
 */
function worstDepth2Run(slabs: readonly Slab[]): number {
  const evts = slabs
    .flatMap(([t, b]) => [
      { e: t, d: 1 },
      { e: b, d: -1 },
    ])
    .sort((p, q) => q.e - p.e || q.d - p.d)
  let worst = 0
  let depth = 0
  let prevE = evts.length > 0 ? evts[0].e : 0
  let runTop: number | null = null
  for (const ev of evts) {
    if (depth >= 2) {
      if (runTop === null) runTop = prevE
    } else if (runTop !== null) {
      worst = Math.max(worst, runTop - prevE)
      runTop = null
    }
    depth += ev.d
    prevE = ev.e
  }
  return runTop !== null ? Math.max(worst, runTop - prevE) : worst
}

interface TilingReport {
  /** Region area, in fraction x elevation units. */
  regionArea: number
  /** Share of the region covered by tiling (non-overlay) polygons. */
  coveredFrac: number
  /** Thickest uncovered run inside the region, in elevation metres. */
  worstVoidM: number
  /** Double-painted area between tiling polygons (fraction x elevation). */
  overlapArea: number
  /** Thickest double-painted run, in elevation metres. */
  worstOverlapM: number
}

const isOverlay = (p: RefinedPolygon): boolean => p.tag === 'hlens' || p.tag === 'enclens'

/**
 * Measure how well the refined polygons tile one litho region.
 *
 * @param region the litho region the carve consumed.
 * @param refined the carve output for that region.
 * @param nx scanline resolution across the region's fraction extent.
 */
function measureTiling(
  region: SectionRegion,
  refined: readonly RefinedPolygon[],
  nx = 600,
): TilingReport {
  const fs = region.polygon.map((p) => p.fraction)
  const fmin = Math.min(...fs)
  const fmax = Math.max(...fs)
  const dx = (fmax - fmin) / nx
  const tiling = refined.filter((p) => !isOverlay(p))
  let regionArea = 0
  let covered = 0
  let overlapArea = 0
  let worstVoidM = 0
  let worstOverlapM = 0
  for (let i = 0; i < nx; i++) {
    const f = fmin + (i + 0.5) * dx
    const reg = mergeSlabs(slabsAt(region.polygon, f))
    const raw: Slab[] = []
    for (const p of tiling) raw.push(...slabsAt(p.points, f))
    const cov = mergeSlabs(raw)
    regionArea += slabLen(reg) * dx
    const inside = subtractSlabs(reg, subtractSlabs(reg, cov)) // reg ∩ cov
    covered += slabLen(inside) * dx
    for (const [t, b] of subtractSlabs(reg, cov)) worstVoidM = Math.max(worstVoidM, t - b)
    const dbl = slabLen(raw) - slabLen(cov)
    overlapArea += dbl * dx
    worstOverlapM = Math.max(worstOverlapM, worstDepth2Run(raw))
  }
  return {
    regionArea,
    coveredFrac: regionArea > 0 ? covered / regionArea : 1,
    worstVoidM,
    overlapArea,
    worstOverlapM,
  }
}

// ---------------------------------------------------------------------------
// M1 — a region whose edges sit a hair inside the gap
// ---------------------------------------------------------------------------

describe('the carve tiles a region that reaches the columns (end-strip)', () => {
  // WORST REAL INSTANCE — Cross-section 2, gap 15, VEEN, gap 13.15 m wide.
  // The v2 arrangement snaps vertices to a 1 mm grid while the column
  // along-metres are not snapped, so the gap-edge vertices land at 1e-6 / 1-1e-5
  // instead of 0 / 1. This is the model's thickest interior void (7.94 m).
  const region: SectionRegion = {
    formationId: 'formation-peat',
    bodyId: 'body-veen',
    kind: 'quad',
    gapIndex: 0,
    polygon: [
      { fraction: 0.000001, elevation: 8.72 },
      { fraction: 0.000001, elevation: 4.59 },
      { fraction: 0.999988, elevation: 5.682 },
      { fraction: 0.999988, elevation: 7.532 },
    ],
  }
  const cols = gmap(
    gcol('A', 10, [
      [10, 6, 'nad-veen-29'],
      [6, 0, 'nad-veen-30'],
    ]),
    gcol('B', 10, [
      [10, 7, 'nad-veen-29'],
      [7, 0, 'nad-veen-30'],
    ]),
  )

  it('leaves NO void at the gap edges — a 1e-6 inset is not a geological situation', () => {
    const refined = refineLithoPartition([region], ['A', 'B'], cols, NAD, LITHO_SOIL)
    const m = measureTiling(region, refined)
    expect(m.regionArea).toBeGreaterThan(1)
    expect(
      m.coveredFrac,
      `the carve covered ${(m.coveredFrac * 100).toFixed(2)} % of the region; ` +
        `thickest void ${m.worstVoidM.toFixed(3)} m`,
    ).toBeGreaterThan(0.995)
    expect(m.worstVoidM, 'thickest interior void (m)').toBeLessThan(0.25)
  })

  it('is NOT treated as a region that reaches neither column of its gap', () => {
    // The false-interior class: 105 regions / 9,404 m2 of the owner's model took
    // the "reaches NEITHER column" branch because of a 4e-6 inset. A region that
    // spans the whole gap must read its two side stacks at its own two edges —
    // observable here as the left edge showing the LEFT column's shallower
    // n29/n30 interface, not a stack borrowed from a sample 5 % of the gap in.
    const refined = refineLithoPartition([region], ['A', 'B'], cols, NAD, LITHO_SOIL)
    const atLeftEdge = refined.filter(
      (p) => !isOverlay(p) && p.points.some((q) => q.fraction < 0.0005),
    )
    expect(atLeftEdge.length, 'polygons reaching the left gap edge').toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// M2 / C2 — a region whose left edge is a sawtooth of notch tips
// ---------------------------------------------------------------------------

describe('the carve tiles a region whose slice topology changes mid-strip', () => {
  // WORST REAL INSTANCE — Cross-section 3, gap 1, ZAND, 171.66 m wide, 1,972 m2.
  // Three notches cut in from the left edge and all terminate at fraction
  // 0.450002; between the samples at 0.45 and 0.50 the slice goes from 4 solid
  // parts to 1 and the unpaired parts close as triangles at the strip midpoint.
  const region: SectionRegion = {
    formationId: 'formation-sand',
    bodyId: 'body-zand',
    kind: 'quad',
    gapIndex: 0,
    polygon: [
      { fraction: 0, elevation: -2.413 },
      { fraction: 0, elevation: -5.24 },
      { fraction: 0.999999, elevation: -6.65 },
      { fraction: 0.999999, elevation: 4.7 },
      { fraction: 0, elevation: 7.63 },
      { fraction: 0, elevation: 0.35 },
      { fraction: 0.450002, elevation: -0.495 },
      { fraction: 0, elevation: -1.34 },
      { fraction: 0.450002, elevation: -1.595 },
      { fraction: 0, elevation: -1.85 },
      { fraction: 0.450002, elevation: -2.132 },
    ],
  }
  // A plunging class interface: n7 over n5, the contact 3 m down on the left and
  // 12 m down on the right. The lower band's pieces die against the notches
  // while the upper band's quad sweeps down across them.
  const cols = gmap(
    gcol('A', 8, [
      [8, 4.5, 'nad-zand-7'],
      [4.5, -12, 'nad-zand-5'],
    ]),
    gcol('B', 5, [
      [5, -5.5, 'nad-zand-7'],
      [-5.5, -12, 'nad-zand-5'],
    ]),
  )

  it('leaves NO void where the notches terminate (interior strip)', () => {
    const refined = refineLithoPartition([region], ['A', 'B'], cols, NAD, LITHO_SOIL)
    const m = measureTiling(region, refined)
    expect(m.regionArea).toBeGreaterThan(1)
    expect(
      m.coveredFrac,
      `the carve covered ${(m.coveredFrac * 100).toFixed(2)} % of the region; ` +
        `thickest void ${m.worstVoidM.toFixed(3)} m`,
    ).toBeGreaterThan(0.995)
    expect(m.worstVoidM, 'thickest interior void (m)').toBeLessThan(0.5)
  })

  it('never paints two packing fills on the same point (band and bracket are disjoint)', () => {
    const refined = refineLithoPartition([region], ['A', 'B'], cols, NAD, LITHO_SOIL)
    const m = measureTiling(region, refined)
    expect(
      m.worstOverlapM,
      `two tiling polygons double-paint a run of ${m.worstOverlapM.toFixed(3)} m ` +
        `(${m.overlapArea.toFixed(4)} fraction·m of area)`,
    ).toBeLessThan(0.05)
  })
})

// ---------------------------------------------------------------------------
// The same invariant on real data — the committed frozen CS1 slice
// ---------------------------------------------------------------------------

describe('the carve tiles the real CS1 slice', () => {
  const HERE = dirname(fileURLToPath(import.meta.url))
  interface Frozen {
    alongM: Record<string, number>
    columns: Array<{
      investigationId: string
      surfaceElevM: number | null
      units: PartitionColumn['units']
    }>
    edges: CorrelationEdge[]
    geotechColumns: GeotechColumn[]
    nadFormations: Record<string, NadFormationMeta>
    lithoSoil: Record<string, string>
  }
  const frozen: Frozen = JSON.parse(
    readFileSync(resolve(HERE, './__fixtures__/cs1_geotech_frozen.json'), 'utf8'),
  )
  const columns: PartitionColumn[] = frozen.columns
    .filter((c) => c.surfaceElevM != null)
    .map((c) => ({
      investigationId: c.investigationId,
      surfaceElevM: c.surfaceElevM as number,
      units: c.units,
    }))
  const alongM = columns.map((c) => frozen.alongM[c.investigationId] ?? 0)
  const regions = computeSectionFill(columns, frozen.edges, undefined, alongM)
  const refined = refineLithoPartition(
    regions,
    columns.map((c) => c.investigationId),
    new Map(frozen.geotechColumns.map((c) => [c.investigationId, c])),
    new Map(Object.entries(frozen.nadFormations)),
    new Map<string, string | null>(Object.entries(frozen.lithoSoil)),
  )
  const regionsByGap = new Map<number, SectionRegion[]>()
  for (const r of regions) {
    const l = regionsByGap.get(r.gapIndex) ?? []
    l.push(r)
    regionsByGap.set(r.gapIndex, l)
  }
  const polysByGap = new Map<number, RefinedPolygon[]>()
  for (const p of refined) {
    const l = polysByGap.get(p.gapIndex) ?? []
    l.push(p)
    polysByGap.set(p.gapIndex, l)
  }

  it('double-paints ZERO square metres — no two tiling polygons cover a point', () => {
    // Measured as AREA, not as detector reports. ``detectRefinementOverlaps``
    // answers a 5x5 grid inside the two bounding boxes and counts a point ON a
    // shared edge as inside both polygons, so two polygons that tile perfectly
    // — which is exactly what the carve now produces — still register a couple
    // of hits. Every such report on this slice measures ~1e-17 m2. Area is the
    // property the engineer sees; assert that.
    let doubleM2 = 0
    let worstRunM = 0
    const NX = 300
    for (const [gap, polys] of polysByGap) {
      const w = Math.abs((alongM[gap + 1] ?? 0) - (alongM[gap] ?? 0))
      if (w <= 0) continue
      // Carve output of an engine LENS region is an overlay over its gap's
      // fills by design (owner-locked) — excluded, like the detector does.
      const tiling = polys.filter((p) => !isOverlay(p) && p.regionKind !== 'lens')
      const dx = w / NX
      for (let i = 0; i < NX; i++) {
        const f = (i + 0.5) / NX
        const raw = tiling.flatMap((p) => slabsAt(p.points, f))
        const union = mergeSlabs(raw)
        doubleM2 += (slabLen(raw) - slabLen(union)) * dx
        worstRunM = Math.max(worstRunM, worstDepth2Run(raw))
      }
    }
    expect(
      doubleM2,
      `tiling polygons double-paint ${doubleM2.toFixed(4)} m2 (thickest run ` +
        `${worstRunM.toFixed(4)} m) — a point may carry only one packing fill`,
    ).toBeLessThan(0.05)
    expect(worstRunM, 'thickest double-painted run (m)').toBeLessThan(0.02)
  })

  it('covers the litho partition it consumes — no interior void the engineer can see', () => {
    // Gap-by-gap union sweep: what the litho partition occupies against what
    // the refinement paints. Overlays COUNT here — an hlens over a litho lens
    // region is the fill the engineer sees at that point (the owner-locked
    // "a lens region emits an overlay and no tiling polygon" rule, which the
    // tiling-only measurement would score as a hole).
    let lithoM2 = 0
    let voidM2 = 0
    let worstVoidM = 0
    const NX = 400
    for (const [gap, regs] of regionsByGap) {
      const w = Math.abs((alongM[gap + 1] ?? 0) - (alongM[gap] ?? 0))
      if (w <= 0) continue
      const polys = polysByGap.get(gap) ?? []
      const dx = w / NX
      for (let i = 0; i < NX; i++) {
        const f = (i + 0.5) / NX
        const reg = mergeSlabs(regs.flatMap((r) => slabsAt(r.polygon, f)))
        const cov = mergeSlabs(polys.flatMap((p) => slabsAt(p.points, f)))
        lithoM2 += slabLen(reg) * dx
        for (const [t, b] of subtractSlabs(reg, cov)) {
          voidM2 += (t - b) * dx
          worstVoidM = Math.max(worstVoidM, t - b)
        }
      }
    }
    const lossPct = (voidM2 / lithoM2) * 100
    expect(lithoM2).toBeGreaterThan(10000)
    expect(
      lossPct,
      `the carve left ${voidM2.toFixed(1)} m2 of ${lithoM2.toFixed(1)} m2 uncovered ` +
        `(${lossPct.toFixed(2)} %), thickest void ${worstVoidM.toFixed(3)} m`,
    ).toBeLessThan(0.5)
    expect(worstVoidM, 'thickest interior void (m)').toBeLessThan(0.8)
  })
})

// ---------------------------------------------------------------------------
// C3 — nested enclosed-minority lenses
// ---------------------------------------------------------------------------

describe('enclosed minorities never nest', () => {
  it('a lens is never drawn inside another lens of the same side', () => {
    // Left stack n7 / n5 / n8 / n5 / n7 against an all-n7 right column.
    // ``reduceSide`` pulls the n8 and merges its n5 brackets — and then finds
    // the merged n5 enclosed by the n7 brackets and pulls THAT too, with the
    // same 45 % footprint, so the n8 lens is repainted by an n5 lens that
    // contains it. One of them is invisible and the pair breaks the partition.
    const region: SectionRegion = {
      formationId: 'formation-sand',
      bodyId: 'body-x',
      kind: 'quad',
      gapIndex: 0,
      polygon: [
        { fraction: 0, elevation: 10 },
        { fraction: 1, elevation: 10 },
        { fraction: 1, elevation: 0 },
        { fraction: 0, elevation: 0 },
      ],
    }
    const cols = gmap(
      gcol('A', 10, [
        [10, 8, 'nad-zand-7'],
        [8, 6, 'nad-zand-5'],
        [6, 5, 'nad-zand-8'],
        [5, 3, 'nad-zand-5'],
        [3, 0, 'nad-zand-7'],
      ]),
      gcol('B', 10, [[10, 0, 'nad-zand-7']]),
    )
    const refined = refineLithoPartition([region], ['A', 'B'], cols, NAD, LITHO_SOIL)
    // One LENS is many strip polygons — compare the lens bodies, keyed by the
    // class they carry, not the individual quads of one lens.
    const byClass = new Map<string, { e0: number; e1: number }>()
    for (const p of refined) {
      if (p.tag !== 'enclens') continue
      const cur = byClass.get(p.formationId) ?? { e0: Infinity, e1: -Infinity }
      for (const q of p.points) {
        cur.e0 = Math.min(cur.e0, q.elevation)
        cur.e1 = Math.max(cur.e1, q.elevation)
      }
      byClass.set(p.formationId, cur)
    }
    const nested: string[] = []
    const entries = [...byClass.entries()]
    for (const [ka, a] of entries)
      for (const [kb, b] of entries) {
        if (ka === kb) continue
        if (a.e0 >= b.e0 - 1e-9 && a.e1 <= b.e1 + 1e-9)
          nested.push(
            `${ka} [${a.e0.toFixed(2)}..${a.e1.toFixed(2)}] inside ` +
              `${kb} [${b.e0.toFixed(2)}..${b.e1.toFixed(2)}]`,
          )
      }
    expect(nested, `nested enclosed lenses:\n${nested.join('\n')}`).toEqual([])
  })
})
