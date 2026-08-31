/**
 * Dense pairwise-overlap invariant checker for ``computeSectionFill`` output
 * (debt #228).
 *
 * A partition must be a partition: within a gap, non-lens regions must be
 * pairwise disjoint (zero shared area). The CS1 gate's 120×320 whole-gap
 * raster with a 30-cell floor is blind to hairline slivers — proven on the
 * real CS1 gap 0 (2026-07-06), where raw SILT×ZAND / ZAND×KLEI polygon
 * overlaps hid below its sampling resolution. This checker computes the
 * EXACT pairwise intersection area instead, so a sliver of any thinness is
 * caught with no resolution threshold to tune.
 *
 * Method
 * ------
 * Each region ring is cleaned (consecutive-duplicate and exactly-collinear
 * vertex removal) and ear-clip triangulated; the pairwise intersection area
 * is the sum of triangle∩triangle convex clips (Sutherland-Hodgman). A ring
 * that fails to triangulate (non-simple/self-intersecting — never expected
 * from the engine, but the instrument must not lie by throwing) degrades to
 * dense grid sampling over the pair's bbox intersection, and the report is
 * marked ``method: 'sampled'``.
 *
 * ``kind === 'lens'`` regions are by-design overlays (they deliberately
 * overlap their matrix) and are excluded. Regions are only compared within
 * the same gap — fraction space is gap-local, so cross-gap coordinates are
 * not comparable.
 */

import type { PartitionPoint, SectionRegion } from './sectionPartition'

/** Identity of one region in an overlap report (full ids for diagnostics). */
export interface OverlapRegionRef {
  /** Index into the ``regions`` array passed to ``findNonLensOverlaps``. */
  regionIndex: number
  formationId: string
  bodyId: string | null
  kind: SectionRegion['kind']
}

/** One pair of same-gap non-lens regions with positive shared area. */
export interface OverlapReport {
  gapIndex: number
  a: OverlapRegionRef
  b: OverlapRegionRef
  /** Shared area in (fraction × metre) units — exact unless ``sampled``. */
  areaFracM: number
  /** ``exact`` = triangulated clip; ``sampled`` = non-simple-ring fallback. */
  method: 'exact' | 'sampled'
  /** Area-weighted centre of the shared area (approximate for ``sampled``). */
  centroid: PartitionPoint
}

export interface OverlapCheckOptions {
  /**
   * Area floor (fraction·m) below which a pair is not reported. The default
   * 1e-9 is far above float-roundoff clip noise (~1e-14) and far below any
   * renderable sliver (~1e-4), so it distinguishes "touching" from
   * "overlapping" without hiding real defects.
   */
  minAreaFracM?: number
}

const DEFAULT_MIN_AREA = 1e-9
/** Grid resolution (per axis) of the non-simple-ring sampling fallback. */
const SAMPLE_GRID = 64

type Tri = [PartitionPoint, PartitionPoint, PartitionPoint]

interface Bbox {
  f0: number
  f1: number
  e0: number
  e1: number
}

/** Signed area × 2 (shoelace; > 0 = counter-clockwise in (fraction, elevation)). */
function signedArea2(ring: readonly PartitionPoint[]): number {
  let s = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    s += a.fraction * b.elevation - b.fraction * a.elevation
  }
  return s
}

/** 2×cross product of (b−a) × (c−a). */
function cross(a: PartitionPoint, b: PartitionPoint, c: PartitionPoint): number {
  return (b.fraction - a.fraction) * (c.elevation - a.elevation) - (b.elevation - a.elevation) * (c.fraction - a.fraction)
}

/**
 * Clean a ring: drop consecutive (and wrap-around) near-duplicate vertices,
 * then drop exactly-collinear interior vertices (zero-area detours that stall
 * the ear clipper without affecting area).
 */
function cleanRing(ring: readonly PartitionPoint[]): PartitionPoint[] {
  const dedup: PartitionPoint[] = []
  for (const p of ring) {
    const last = dedup[dedup.length - 1]
    if (last && Math.abs(last.fraction - p.fraction) < 1e-12 && Math.abs(last.elevation - p.elevation) < 1e-12) continue
    dedup.push(p)
  }
  while (
    dedup.length > 1 &&
    Math.abs(dedup[0].fraction - dedup[dedup.length - 1].fraction) < 1e-12 &&
    Math.abs(dedup[0].elevation - dedup[dedup.length - 1].elevation) < 1e-12
  ) {
    dedup.pop()
  }
  // Collinear removal — iterate until stable (removing one vertex can make
  // its neighbour collinear too).
  let out = dedup
  let changed = true
  while (changed && out.length > 3) {
    changed = false
    for (let i = 0; i < out.length; i++) {
      const a = out[(i + out.length - 1) % out.length]
      const b = out[i]
      const c = out[(i + 1) % out.length]
      if (Math.abs(cross(a, b, c)) < 1e-12) {
        out = [...out.slice(0, i), ...out.slice(i + 1)]
        changed = true
        break
      }
    }
  }
  return out
}

/**
 * Point-in-triangle for the ear-clip block test (``tri`` is CCW). A candidate ear
 * is invalid if ANY other ring vertex lies inside it OR on its boundary. The
 * boundary case is load-bearing: a valid simple polygon can have a deep concave
 * "comb" whose reflex vertices sit exactly ON a shared axis (e.g. several lens
 * darts returning to the same column line x=0). A STRICT interior test misses those
 * on-edge vertices, so the clipper accepts an invalid ear that swallows a comb
 * tooth and DOUBLE-COVERS — the ring area no longer reconstructs and the whole
 * triangulation is (wrongly) rejected as non-simple. Blocking on the closed
 * triangle (``>= -eps``) keeps the clipper honest on such combs while still
 * clipping genuine ears (no other vertex touches them).
 */
function inClosedTriangle(p: PartitionPoint, tri: Tri): boolean {
  const EPS = 1e-12
  return cross(tri[0], tri[1], p) >= -EPS && cross(tri[1], tri[2], p) >= -EPS && cross(tri[2], tri[0], p) >= -EPS
}

/**
 * Ear-clip triangulate a simple ring. Returns ``null`` when the ring is not
 * simple (no ear found before exhausting the vertices) or when the triangle
 * areas do not reconstruct the ring's own area (a silent mis-triangulation —
 * the caller then falls back to sampling rather than trusting a wrong area).
 */
function triangulate(ringIn: readonly PartitionPoint[]): Tri[] | null {
  let ring = cleanRing(ringIn)
  if (ring.length < 3) return []
  const ringArea = Math.abs(signedArea2(ring)) / 2
  if (ringArea < 1e-15) return []
  if (signedArea2(ring) < 0) ring = [...ring].reverse()

  const idx = ring.map((_, i) => i)
  const tris: Tri[] = []
  let guard = 0
  const maxIter = ring.length * ring.length + 16
  while (idx.length > 3 && guard++ < maxIter) {
    let clipped = false
    for (let k = 0; k < idx.length; k++) {
      const ia = idx[(k + idx.length - 1) % idx.length]
      const ib = idx[k]
      const ic = idx[(k + 1) % idx.length]
      const a = ring[ia]
      const b = ring[ib]
      const c = ring[ic]
      const conv = cross(a, b, c)
      if (conv <= 1e-15) continue // reflex or degenerate corner — not an ear
      let blocked = false
      for (const io of idx) {
        if (io === ia || io === ib || io === ic) continue
        if (inClosedTriangle(ring[io], [a, b, c])) {
          blocked = true
          break
        }
      }
      if (blocked) continue
      tris.push([a, b, c])
      idx.splice(k, 1)
      clipped = true
      break
    }
    if (!clipped) return null // no ear — non-simple ring
  }
  if (idx.length === 3) tris.push([ring[idx[0]], ring[idx[1]], ring[idx[2]]])

  // Verify the triangulation reconstructs the ring area — a mismatch means the
  // ring was subtly non-simple and the "triangles" double-cover somewhere.
  let sum = 0
  for (const t of tris) sum += Math.abs(cross(t[0], t[1], t[2])) / 2
  if (Math.abs(sum - ringArea) > 1e-9 + 1e-6 * ringArea) return null
  return tris
}

/** Clip a CCW triangle against another CCW triangle (Sutherland-Hodgman). */
function clipTriTri(subject: Tri, clip: Tri): PartitionPoint[] {
  let output: PartitionPoint[] = [subject[0], subject[1], subject[2]]
  for (let e = 0; e < 3 && output.length > 2; e++) {
    const c1 = clip[e]
    const c2 = clip[(e + 1) % 3]
    const df = c2.fraction - c1.fraction
    const de = c2.elevation - c1.elevation
    const left = (p: PartitionPoint): number => df * (p.elevation - c1.elevation) - de * (p.fraction - c1.fraction)
    const input = output
    output = []
    for (let i = 0; i < input.length; i++) {
      const a = input[i]
      const b = input[(i + 1) % input.length]
      const la = left(a)
      const lb = left(b)
      if (la >= 0) {
        output.push(a)
        if (lb < 0) output.push(lerpAt(a, b, la, lb))
      } else if (lb >= 0) {
        output.push(lerpAt(a, b, la, lb))
      }
    }
  }
  return output
}

function lerpAt(a: PartitionPoint, b: PartitionPoint, la: number, lb: number): PartitionPoint {
  const t = Math.abs(la - lb) < 1e-30 ? 0 : la / (la - lb)
  return {
    fraction: a.fraction + t * (b.fraction - a.fraction),
    elevation: a.elevation + t * (b.elevation - a.elevation),
  }
}

/** Nonzero-winding point-in-polygon — same rule as the SVG renderer. */
function inPolygon(px: number, py: number, poly: readonly PartitionPoint[]): boolean {
  let wn = 0
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % n]
    const isLeft = (b.fraction - a.fraction) * (py - a.elevation) - (px - a.fraction) * (b.elevation - a.elevation)
    if (a.elevation <= py) {
      if (b.elevation > py && isLeft > 0) wn++
    } else {
      if (b.elevation <= py && isLeft < 0) wn--
    }
  }
  return wn !== 0
}

function bboxOf(ring: readonly PartitionPoint[]): Bbox {
  let f0 = Infinity
  let f1 = -Infinity
  let e0 = Infinity
  let e1 = -Infinity
  for (const p of ring) {
    if (p.fraction < f0) f0 = p.fraction
    if (p.fraction > f1) f1 = p.fraction
    if (p.elevation < e0) e0 = p.elevation
    if (p.elevation > e1) e1 = p.elevation
  }
  return { f0, f1, e0, e1 }
}

interface PairMeasure {
  area: number
  centroid: PartitionPoint
  method: 'exact' | 'sampled'
}

/** Exact shared area of two triangulated regions (area-weighted centroid). */
function exactPairArea(aTris: Tri[], bTris: Tri[]): { area: number; centroid: PartitionPoint } {
  let area = 0
  let cf = 0
  let ce = 0
  for (const ta of aTris) {
    for (const tb of bTris) {
      const poly = clipTriTri(ta, tb)
      if (poly.length < 3) continue
      const a2 = signedArea2(poly)
      const a = Math.abs(a2) / 2
      if (a < 1e-15) continue
      // Ring centroid (shoelace-weighted).
      let px = 0
      let py = 0
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i]
        const q = poly[(i + 1) % poly.length]
        const w = p.fraction * q.elevation - q.fraction * p.elevation
        px += (p.fraction + q.fraction) * w
        py += (p.elevation + q.elevation) * w
      }
      area += a
      cf += (px / (3 * a2)) * a
      ce += (py / (3 * a2)) * a
    }
  }
  return {
    area,
    centroid: area > 0 ? { fraction: cf / area, elevation: ce / area } : { fraction: 0, elevation: 0 },
  }
}

/** Sampling fallback: dense grid over the pair's bbox intersection. */
function sampledPairArea(
  aRing: readonly PartitionPoint[],
  bRing: readonly PartitionPoint[],
  box: Bbox,
): { area: number; centroid: PartitionPoint } {
  const w = box.f1 - box.f0
  const h = box.e1 - box.e0
  if (w <= 0 || h <= 0) return { area: 0, centroid: { fraction: 0, elevation: 0 } }
  let hits = 0
  let cf = 0
  let ce = 0
  for (let iy = 0; iy < SAMPLE_GRID; iy++) {
    const py = box.e0 + ((iy + 0.5) / SAMPLE_GRID) * h
    for (let ix = 0; ix < SAMPLE_GRID; ix++) {
      const px = box.f0 + ((ix + 0.5) / SAMPLE_GRID) * w
      if (inPolygon(px, py, aRing) && inPolygon(px, py, bRing)) {
        hits++
        cf += px
        ce += py
      }
    }
  }
  const area = (hits / (SAMPLE_GRID * SAMPLE_GRID)) * w * h
  return {
    area,
    centroid: hits > 0 ? { fraction: cf / hits, elevation: ce / hits } : { fraction: 0, elevation: 0 },
  }
}

/**
 * Find every pair of same-gap non-lens regions that share positive area.
 *
 * Parameters
 * ----------
 * regions : readonly SectionRegion[]
 *     ``computeSectionFill`` output (any gap mix; grouping is internal).
 * options : OverlapCheckOptions
 *     ``minAreaFracM`` — area floor below which a pair is not reported.
 *
 * Returns
 * -------
 * OverlapReport[]
 *     One report per overlapping pair, ordered by gap then first region.
 */
export function findNonLensOverlaps(
  regions: readonly SectionRegion[],
  options: OverlapCheckOptions = {},
): OverlapReport[] {
  const minArea = options.minAreaFracM ?? DEFAULT_MIN_AREA

  // Group non-lens regions by gap, keeping original indices for diagnostics.
  const byGap = new Map<number, number[]>()
  regions.forEach((r, i) => {
    if (r.kind === 'lens') return
    const list = byGap.get(r.gapIndex) ?? []
    list.push(i)
    byGap.set(r.gapIndex, list)
  })

  // Per-region caches (only for regions that reach a bbox-overlapping pair).
  const rings = new Map<number, PartitionPoint[]>()
  const boxes = new Map<number, Bbox>()
  const tris = new Map<number, Tri[] | null>()
  const ringOf = (i: number): PartitionPoint[] => {
    let ring = rings.get(i)
    if (!ring) {
      ring = cleanRing(regions[i].polygon)
      rings.set(i, ring)
    }
    return ring
  }
  const boxOf = (i: number): Bbox => {
    let b = boxes.get(i)
    if (!b) {
      b = bboxOf(regions[i].polygon)
      boxes.set(i, b)
    }
    return b
  }
  const trisOf = (i: number): Tri[] | null => {
    if (!tris.has(i)) tris.set(i, triangulate(ringOf(i)))
    return tris.get(i) as Tri[] | null
  }

  const reports: OverlapReport[] = []
  for (const [gapIndex, list] of [...byGap.entries()].sort((x, y) => x[0] - y[0])) {
    for (let u = 0; u < list.length; u++) {
      for (let v = u + 1; v < list.length; v++) {
        const i = list[u]
        const j = list[v]
        const A = boxOf(i)
        const B = boxOf(j)
        const box: Bbox = {
          f0: Math.max(A.f0, B.f0),
          f1: Math.min(A.f1, B.f1),
          e0: Math.max(A.e0, B.e0),
          e1: Math.min(A.e1, B.e1),
        }
        if (box.f1 - box.f0 <= 0 || box.e1 - box.e0 <= 0) continue

        const ta = trisOf(i)
        const tb = trisOf(j)
        let measure: PairMeasure
        if (ta !== null && tb !== null) {
          measure = { ...exactPairArea(ta, tb), method: 'exact' }
        } else {
          measure = { ...sampledPairArea(ringOf(i), ringOf(j), box), method: 'sampled' }
        }
        if (measure.area < minArea) continue
        const ref = (ix: number): OverlapRegionRef => ({
          regionIndex: ix,
          formationId: regions[ix].formationId,
          bodyId: regions[ix].bodyId,
          kind: regions[ix].kind,
        })
        reports.push({
          gapIndex,
          a: ref(i),
          b: ref(j),
          areaFracM: measure.area,
          method: measure.method,
          centroid: measure.centroid,
        })
      }
    }
  }
  return reports
}

/**
 * Render overlap reports as one diagnostic line each (full ids — memory:
 * never trust a truncated UUID).
 */
export function formatOverlapReports(reports: readonly OverlapReport[]): string[] {
  return reports.map(
    (r) =>
      `GAP-${r.gapIndex} ${r.a.kind}[${r.a.formationId}] x ${r.b.kind}[${r.b.formationId}] ` +
      `area=${r.areaFracM.toExponential(3)} (${r.method}) ` +
      `at f=${r.centroid.fraction.toFixed(3)} elev=${r.centroid.elevation.toFixed(2)} ` +
      `(regions #${r.a.regionIndex}/#${r.b.regionIndex}, bodies ${r.a.bodyId}/${r.b.bodyId})`,
  )
}
