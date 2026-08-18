/**
 * The litho frame clip — "keep exactly the litho model and only subdivide
 * bodies" (owner ruling 2026-08-14, after "you have to start from the exact
 * litho geometries").
 *
 * The direct geotech partition follows the engineer's ties, but its geometry
 * is RE-DERIVED from the geotech stacks, so it can deviate from the litho
 * fill wherever ties are incomplete or the engine's constructions differ on
 * subdivided stacks (per-band lens unions, foreign-soil vacancy floods).
 * This post-pass makes litho-consistency a CONSTRUCTION instead of a
 * convergence target: the two partitions of each gap are overlaid in the v2
 * planar arrangement, and every resulting face
 *
 *  * keeps its geotech class when that class's SOIL matches the litho region
 *    the face sits in (the subdivision the ruling asks for);
 *  * re-labels to the elevation-nearest same-soil geotech class of the SAME
 *    litho region when its geotech class is foreign or missing (the vacancy
 *    flood can no longer cross a litho boundary);
 *  * falls back to the litho region itself when the geotech model holds no
 *    class of that soil in the region (rendered litho-colour, exactly like
 *    the un-banded fallback);
 *  * is DROPPED when it lies outside every litho region — the litho fill is
 *    the frame, nothing may exceed it.
 *
 * Pure geometry, no I/O; the caller memoises. Faces tile by construction
 * (arrangement cells are disjoint), so the output needs no overlay z-order —
 * every emitted region is ``kind: 'quad'``.
 */

import { buildArrangement } from './partitionFillV2/arrangement'
import type { InputCurve, Point } from './partitionFillV2/types'
import type { SectionRegion } from './partitionFill'

/**
 * The arrangement snaps to a 1 mm grid in BOTH axes; gap-local fractions are
 * scaled by this factor first so the snap costs 1e-5 of a fraction, far below
 * render resolution, and unscaled elevations keep their real millimetres.
 */
const FRACTION_SCALE = 100

/** A face whose area (fraction × metres) is below this is snap debris. */
const MIN_FACE_AREA = 1e-9

/**
 * Merge a face's hole rings into its outer ring with zero-width keyhole
 * bridges (closest-vertex cut), yielding ONE simple self-touching ring that
 * excludes the holes under both even-odd and nonzero fill rules. An
 * arrangement face records an enclosed loop (a floating litho lens) as a
 * hole while the loop's interior is its own separate face — without the
 * bridge, the annulus face's outer ring would claim the hole's area too and
 * its interior point could land inside the hole.
 */
function keyholedRing(outer: readonly Point[], holes: readonly Point[][]): Point[] {
  let ring = [...outer]
  for (const hole of holes) {
    let hv = 0
    for (let i = 1; i < hole.length; i++) if (hole[i].x > hole[hv].x) hv = i
    let rv = 0
    let best = Infinity
    for (let i = 0; i < ring.length; i++) {
      const dx = ring[i].x - hole[hv].x
      const dy = ring[i].y - hole[hv].y
      const d = dx * dx + dy * dy
      if (d < best) {
        best = d
        rv = i
      }
    }
    const holePath = [...hole.slice(hv), ...hole.slice(0, hv + 1)]
    ring = [...ring.slice(0, rv + 1), ...holePath, ...ring.slice(rv)]
  }
  return ring
}

export interface LithoFrameClipResult {
  /** Geotech-classed faces tiling the litho cover (kind 'quad', disjoint). */
  regions: SectionRegion[]
  /**
   * Faces of litho regions whose soil has NO geotech class anywhere in that
   * region — carry the LITHO formation id; render them litho-coloured in the
   * fallback layer, never through the NAD colour map.
   */
  lithoFallback: SectionRegion[]
  /**
   * Faces whose interior point matched NO litho region — outside the frame
   * (legitimately clipped away) OR a parent-resolution failure. Exposed so
   * gates can assert the dropped set never intersects the litho cover;
   * ``formationId`` is empty.
   */
  dropped: SectionRegion[]
}

/** Ray-cast point-in-ring over (fraction, elevation) polygons. */
function pointInRing(
  f: number,
  e: number,
  ring: readonly { fraction: number; elevation: number }[],
): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]
    const b = ring[j]
    if (
      a.elevation > e !== b.elevation > e &&
      f < a.fraction + ((e - a.elevation) / (b.elevation - a.elevation)) * (b.fraction - a.fraction)
    ) {
      inside = !inside
    }
  }
  return inside
}

/**
 * A point strictly inside a simple ring, robust for concave rings: the
 * centroid of a valid convex ear (same construction the v2 face tracer uses;
 * re-derived here for float fraction×elevation coordinates rather than grid
 * integers). Exported for the sampler pins (CF7).
 */
export function interiorPoint(ring: readonly Point[]): Point {
  const n = ring.length
  let area2 = 0
  for (let i = 0; i < n; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % n]
    area2 += a.x * b.y - b.x * a.y
  }
  const ccw = area2 > 0
  const inRing = (p: Point): boolean => {
    let inside = false
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const a = ring[i]
      const b = ring[j]
      if (a.y > p.y !== b.y > p.y && p.x < a.x + ((p.y - a.y) / (b.y - a.y)) * (b.x - a.x)) {
        inside = !inside
      }
    }
    return inside
  }
  // LARGEST convex ear first, not first-found: an arrangement face can carry
  // a cluster of near-coincident vertices (snap debris at a curve junction),
  // and that cluster forms a micro-ear whose centroid IS the corner — a
  // sample ON the ring, which then parents across whatever boundary passes
  // through that corner. The B4|S13 silt face sampled a millimetre below the
  // litho silt|clay line this way and the whole face re-labelled to clay
  // (owner dogfeed 2026-08-18 evening). The biggest ear's centroid is
  // solidly interior whenever any honest ear exists.
  const ears: { turn: number; c: Point }[] = []
  for (let i = 0; i < n; i++) {
    const prev = ring[(i - 1 + n) % n]
    const cur = ring[i]
    const next = ring[(i + 1) % n]
    const turn = (cur.x - prev.x) * (next.y - prev.y) - (cur.y - prev.y) * (next.x - prev.x)
    if (ccw ? turn <= 0 : turn >= 0) continue
    ears.push({
      turn: Math.abs(turn),
      c: { x: (prev.x + cur.x + next.x) / 3, y: (prev.y + cur.y + next.y) / 3 },
    })
  }
  ears.sort((a, b) => b.turn - a.turn)
  for (const ear of ears) {
    if (inRing(ear.c)) return ear.c
  }
  let sx = 0
  let sy = 0
  for (const v of ring) {
    sx += v.x
    sy += v.y
  }
  return { x: sx / n, y: sy / n }
}

/**
 * Clip the direct geotech partition to the litho partition's frame.
 *
 * Parameters
 * ----------
 * geotechRegions : readonly SectionRegion[]
 *     The direct partition of the geotech bands + ties (all gaps).
 * lithoRegions : readonly SectionRegion[]
 *     The litho partition of the same section — the authoritative frame.
 * geotechSoilByFormationId : ReadonlyMap<string, string | null>
 *     Geotech formation id → soil code (``nadMeta`` soilCode).
 * lithoSoilByFormationId : ReadonlyMap<string, string | null>
 *     Litho formation id → soil code.
 *
 * Returns
 * -------
 * LithoFrameClipResult
 *     Disjoint geotech-classed faces + litho-fallback faces, together tiling
 *     exactly the litho cover.
 */
export function clipPartitionToLithoFrame(
  geotechRegions: readonly SectionRegion[],
  lithoRegions: readonly SectionRegion[],
  geotechSoilByFormationId: ReadonlyMap<string, string | null>,
  lithoSoilByFormationId: ReadonlyMap<string, string | null>,
): LithoFrameClipResult {
  const regions: SectionRegion[] = []
  const lithoFallback: SectionRegion[] = []
  const dropped: SectionRegion[] = []

  const gaps = [...new Set(lithoRegions.map((r) => r.gapIndex))].sort((a, b) => a - b)
  for (const gap of gaps) {
    const lithoInGap = lithoRegions.filter((r) => r.gapIndex === gap)
    const geoInGap = geotechRegions.filter((r) => r.gapIndex === gap)

    // Painter order for parent resolution: non-lens first, lenses last — the
    // LAST containing region wins, mirroring the render's overlay z-order.
    const lithoPaint = [
      ...lithoInGap.filter((r) => r.kind !== 'lens'),
      ...lithoInGap.filter((r) => r.kind === 'lens'),
    ]
    const geoPaint = [
      ...geoInGap.filter((r) => r.kind !== 'lens'),
      ...geoInGap.filter((r) => r.kind === 'lens'),
    ]
    const parentOf = (paint: readonly SectionRegion[], f: number, e: number): SectionRegion | null => {
      let found: SectionRegion | null = null
      for (const r of paint) if (pointInRing(f, e, r.polygon)) found = r
      return found
    }

    // Same-soil replacement candidates per litho region: geotech regions of
    // the litho soil whose interior point sits inside that litho region.
    const replacementsFor = new Map<SectionRegion, SectionRegion[]>()
    const lithoParentCache = new Map<SectionRegion, SectionRegion | null>()
    for (const g of geoInGap) {
      const ip = interiorPoint(g.polygon.map((p) => ({ x: p.fraction, y: p.elevation })))
      const host = parentOf(lithoPaint, ip.x, ip.y)
      lithoParentCache.set(g, host)
      if (host === null) continue
      const gSoil = geotechSoilByFormationId.get(g.formationId) ?? null
      const hostSoil = lithoSoilByFormationId.get(host.formationId) ?? null
      if (gSoil !== null && gSoil === hostSoil) {
        const list = replacementsFor.get(host) ?? []
        list.push(g)
        replacementsFor.set(host, list)
      }
    }
    const centroidElev = (r: SectionRegion): number =>
      r.polygon.reduce((s, p) => s + p.elevation, 0) / r.polygon.length

    // Overlay both partitions' rings in one arrangement. Fractions are scaled
    // so the 1 mm snap grid resolves 1e-5 of a fraction. Rings are decomposed
    // into UNIQUE undirected segments first: adjacent regions state their
    // shared boundary twice (once per ring), and feeding the arrangement
    // coincident duplicates lets face tracing jump across the boundary — the
    // engine's own callers feed each contact once, and so must this one.
    const segKeys = new Set<string>()
    const rawSegments: [Point, Point][] = []
    const pushSegment = (a: Point, b: Point): void => {
      const ka = `${Math.round(a.x * 1000)},${Math.round(a.y * 1000)}`
      const kb = `${Math.round(b.x * 1000)},${Math.round(b.y * 1000)}`
      if (ka === kb) return
      const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
      if (segKeys.has(key)) return
      segKeys.add(key)
      rawSegments.push([a, b])
    }
    for (const src of [lithoInGap, geoInGap]) {
      for (const r of src) {
        const pts = r.polygon.map((p) => ({ x: p.fraction * FRACTION_SCALE, y: p.elevation }))
        for (let i = 0; i < pts.length; i++) pushSegment(pts[i], pts[(i + 1) % pts.length])
      }
    }
    // PRE-SPLIT every proper crossing in float before the arrangement sees
    // it. The arrangement registers a crossing cut only when the SNAPPED
    // intersection lands exactly collinear with the integer supporting line
    // (``pointOnSegment``'s cross === 0), which a long shallow-angle crossing
    // practically never satisfies — the cut silently vanished and faces
    // straddled litho boundaries (CS1 gap 9, 119 m² mislabelled; engine-side
    // fix tracked as debt #271). Splitting here makes every crossing a
    // SHARED ENDPOINT, which the arrangement handles exactly.
    // Cut POINTS per segment — one shared object per crossing, so both cut
    // segments carry the IDENTICAL floats and snap into the same grid cell
    // (computing the crossing separately per segment can straddle a cell
    // boundary and break loop closure).
    const cuts: Point[][] = rawSegments.map(() => [])
    const EPS = 1e-9
    // Half the snap cell: a T-junction endpoint and its projection land in
    // the same cell, so the cut vertex EQUALS the endpoint vertex after snap.
    const T_TOL = 0.0005
    for (let i = 0; i < rawSegments.length; i++) {
      const [a1, b1] = rawSegments[i]
      for (let j = i + 1; j < rawSegments.length; j++) {
        const [a2, b2] = rawSegments[j]
        const d1x = b1.x - a1.x
        const d1y = b1.y - a1.y
        const d2x = b2.x - a2.x
        const d2y = b2.y - a2.y
        const denom = d1x * d2y - d1y * d2x
        if (Math.abs(denom) > 1e-12) {
          const t = ((a2.x - a1.x) * d2y - (a2.y - a1.y) * d2x) / denom
          const u = ((a2.x - a1.x) * d1y - (a2.y - a1.y) * d1x) / denom
          if (t > EPS && t < 1 - EPS && u > EPS && u < 1 - EPS) {
            const point = { x: a1.x + t * d1x, y: a1.y + t * d1y }
            cuts[i].push(point)
            cuts[j].push(point)
          }
        }
        // T-junctions too: an endpoint of one segment on the other's
        // interior must cut it HERE, in float — the arrangement's own
        // T-junction recovery for snap-drifted endpoints sits behind the
        // unrelated two-sided-terminations cut-over flag (default OFF), and
        // its exact-collinear test misses once the 1 mm snap moves the
        // endpoint off the integer line. The cut point IS the endpoint, so
        // the vertices coincide exactly.
        const tCut = (
          px: number,
          py: number,
          ax: number,
          ay: number,
          dx: number,
          dy: number,
        ): boolean => {
          const lenSq = dx * dx + dy * dy
          if (lenSq < 1e-18) return false
          const tt = ((px - ax) * dx + (py - ay) * dy) / lenSq
          if (tt <= EPS || tt >= 1 - EPS) return false
          const ex = ax + tt * dx - px
          const ey = ay + tt * dy - py
          return ex * ex + ey * ey <= T_TOL * T_TOL
        }
        for (const p of [a2, b2]) {
          if (tCut(p.x, p.y, a1.x, a1.y, d1x, d1y)) cuts[i].push(p)
        }
        for (const p of [a1, b1]) {
          if (tCut(p.x, p.y, a2.x, a2.y, d2x, d2y)) cuts[j].push(p)
        }
      }
    }
    const curves: InputCurve[] = []
    let cid = 0
    for (let i = 0; i < rawSegments.length; i++) {
      const [a, b] = rawSegments[i]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const lenSq = dx * dx + dy * dy
      const proj = (p: Point): number => ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq
      const stops = [a, ...cuts[i].sort((p, q) => proj(p) - proj(q)), b]
      for (let k = 0; k + 1 < stops.length; k++) {
        const p = stops[k]
        const q = stops[k + 1]
        if (Math.hypot(q.x - p.x, q.y - p.y) < 1e-9) continue
        curves.push({ id: `clip-${gap}-${cid++}`, kind: 'contact', points: [p, q] })
      }
    }
    if (curves.length === 0) continue
    const arrangement = buildArrangement(curves)

    for (const face of arrangement.faces) {
      const facePoly = face.holes.length
        ? keyholedRing(face.polygon, face.holes)
        : face.polygon
      const ring = facePoly.map((p) => ({
        fraction: p.x / FRACTION_SCALE,
        elevation: p.y,
      }))
      if (Math.abs(face.area) / FRACTION_SCALE < MIN_FACE_AREA) continue
      const ip = interiorPoint(facePoly)
      const f = ip.x / FRACTION_SCALE
      const e = ip.y
      const litho = parentOf(lithoPaint, f, e)
      if (litho === null) {
        dropped.push({ gapIndex: gap, formationId: '', bodyId: null, kind: 'quad', polygon: ring })
        continue // outside the frame
      }
      const lithoSoil = lithoSoilByFormationId.get(litho.formationId) ?? null
      const geo = parentOf(geoPaint, f, e)
      const geoSoil = geo === null ? null : (geotechSoilByFormationId.get(geo.formationId) ?? null)
      if (geo !== null && geoSoil !== null && geoSoil === lithoSoil) {
        regions.push({
          gapIndex: gap,
          formationId: geo.formationId,
          bodyId: geo.bodyId,
          kind: 'quad',
          polygon: ring,
        })
        continue
      }
      const candidates = replacementsFor.get(litho) ?? []
      if (candidates.length > 0) {
        let best = candidates[0]
        let bestDist = Math.abs(centroidElev(best) - e)
        for (const c of candidates) {
          const d = Math.abs(centroidElev(c) - e)
          if (d < bestDist) {
            best = c
            bestDist = d
          }
        }
        regions.push({
          gapIndex: gap,
          formationId: best.formationId,
          bodyId: best.bodyId,
          kind: 'quad',
          polygon: ring,
        })
        continue
      }
      lithoFallback.push({
        gapIndex: gap,
        formationId: litho.formationId,
        bodyId: litho.bodyId,
        kind: 'quad',
        polygon: ring,
      })
    }
  }
  return { regions, lithoFallback, dropped }
}
