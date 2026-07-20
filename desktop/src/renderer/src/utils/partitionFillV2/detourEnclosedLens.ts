/**
 * partitionFillV2/detourEnclosedLens.ts — the RULING-8g ONLAP-FLANK DETOUR around an enclosed lens
 * (owner-resolved via ruling 8g, S51; design partition-engine-v2.md §8 8g).
 *
 * THE CLASS. An enclosing MINORITY (``extractEnclosedLenses`` merged it around one or more enclosed
 * lenses) that is itself corr-1 draws an ONLAP flank (``drawTermination.emitOnlap``). When its flank
 * — a straight segment from the free corner to the tie apex — slices an enclosed lens's 0.45 diamond
 * (``emitEnclosedLensCurves``), the lens is cut in two and never traces as its own face: it is
 * mis-painted the matrix (the convergingStack (a) VEEN-in-KLEI wall — the KLEI onlap flank
 * ``oflankterm0`` crossing the VEEN diamond, and the twin SILT flood flank ``floodsw0`` re-cutting
 * it). The arrangement's own intersection pass can miss the near-apex second crossing (an
 * ``intersect.ts`` limitation, that module is untouchable — the 613-hole trap), so the fix is
 * geometric: keep the flank OFF the diamond entirely.
 *
 * THE DETOUR (ruling 8g — "a lens is a DETOUR in the enclosing band's contour, the matrix flows
 * AROUND it and reconnects"). When the flank crosses BOTH of a diamond's outer flanks (top
 * corner→apex and apex→base corner — it cuts through the diamond), the flank RIDES around the apex:
 * the straight span between the two crossings is replaced by ``crossIn → apex → crossOut``. The
 * crossing points sit ON the diamond flanks, so the inserted ride is COLLINEAR with the emitted
 * ``lens0``/``lens1`` art — the arrangement unions the coincident segments and the lens closes as a
 * proper hole in the matrix onlap face, the matrix wrapping over the lens apex.
 *
 * The SAME detour is applied to the onlap's SILT flood flank (``emitFloodWedge``
 * ``emittedFlankOverride``) so the flood boundary rides the identical path (the two are twin
 * half-edges — matrix on one side, flood on the other), closing the lens as a hole in both.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { enclosedLensDiamond } from './emitLenses'
import { type ReachTie } from './lensReach'
import { type ColumnGeom, type UnitGeom } from './sectionGeom'
import { type Point } from './types'

/** Small epsilon in metres for the enclose-extent test (matches ``drawTermination``'s ELEV_EPS). */
const ELEV_EPS = 1e-6

/** A minimal view of a resolved tie for the reach shortener (gap-filtered by the caller). */
interface GapTie extends ReachTie {
  gapIndex: number
}

/**
 * Reroute an enclosing-minority's ONLAP flank AROUND any enclosed lens it would cross on its OWN
 * column (ruling 8g). Returns the flank unchanged when it crosses none.
 *
 * Parameters
 * ----------
 * flank : readonly Point[]
 *     The straight onlap flank (2 points: free corner + apex, in draw order).
 * u : UnitGeom
 *     The enclosing matrix unit (its [base..top] extent bounds which lenses it wraps).
 * colX : number
 *     The matrix column x (the diamond corners' x).
 * side : 'left' | 'right'
 *     The look side (the diamond pinches toward the facing column, matching the emitted lens).
 * gapIndex : number
 *     The gap the flank + lenses are emitted into.
 * col, facing : ColumnGeom
 *     The matrix column (carries ``enclosedLenses``) and the facing column (sets the reach).
 * activeTies : readonly GapTie[]
 *     All resolved ties (filtered to this gap → the sole 8s reach shortener for the diamond).
 *
 * Returns
 * -------
 * Point[]
 *     The flank, rerouted around every crossed enclosed-lens diamond.
 */
export function detourFlankAroundEnclosedLenses(
  flank: readonly Point[],
  u: UnitGeom,
  colX: number,
  side: 'left' | 'right',
  gapIndex: number,
  col: ColumnGeom,
  facing: ColumnGeom,
  activeTies: readonly GapTie[],
): Point[] {
  if (col.enclosedLenses.length === 0) return [...flank]
  const A = flank[0]
  const B = flank[flank.length - 1]
  const gapWidth = Math.abs(facing.x - colX)
  const gapTies: ReachTie[] = activeTies.filter((t) => t.gapIndex === gapIndex)
  // Collect the ride insertions (crossIn, apex, crossOut) per crossed diamond, ordered along the
  // flank by the entry-crossing parameter t.
  const inserts: { tIn: number; ride: Point[] }[] = []
  for (const el of col.enclosedLenses) {
    const lens = el.lens
    // The matrix ``u`` must actually enclose this lens (its extent contains the lens) — a lens
    // outside ``u``'s own [base..top] range belongs to a different matrix band and is not this
    // flank's concern.
    if (lens.topElev > u.topElev + ELEV_EPS || lens.baseElev < u.baseElev - ELEV_EPS) continue
    const { apex, topPt, basePt } = enclosedLensDiamond(lens, col, facing, gapIndex, side, gapWidth, null, gapTies)
    // The diamond's two outer flanks (the emitted ``lens0``/``lens1`` art): top corner→apex and
    // apex→base corner. A crossing on EACH means the straight flank cuts through the diamond.
    const cUp = segIntersect(A, B, topPt, apex)
    const cLo = segIntersect(A, B, apex, basePt)
    if (cUp === null || cLo === null) continue
    // Order the two crossings along the flank (A→B); ride from the earlier crossing, around the
    // apex, to the later crossing.
    const [first, second] = cUp.t <= cLo.t ? [cUp, cLo] : [cLo, cUp]
    inserts.push({ tIn: first.t, ride: [first.pt, apex, second.pt] })
  }
  if (inserts.length === 0) return [...flank]
  inserts.sort((a, b) => a.tIn - b.tIn)
  // Rebuild the polyline A → (ride around each diamond, in flank order) → B.
  const out: Point[] = [A]
  for (const ins of inserts) out.push(...ins.ride)
  out.push(B)
  return out
}

/**
 * Segment intersection of ``[p1,p2]`` (the flank) with ``[p3,p4]`` (a diamond flank). Returns the
 * intersection point + its parameter ``t`` along the FLANK ([p1,p2]) when they properly cross (both
 * parameters strictly inside [0,1] by a small epsilon), else ``null``. Pure 2D line-line solve.
 *
 * Exported for the ruling-8s band-contour detour (``detourBandContour``), which rides the SAME
 * crossIn→apex→crossOut geometry around a corr-0 lens diamond that this module rides around an
 * enclosed lens for the 8g onlap-flank detour — one solver, one convention.
 */
export function segIntersect(p1: Point, p2: Point, p3: Point, p4: Point): { pt: Point; t: number } | null {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x)
  if (Math.abs(d) < 1e-12) return null
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d
  const s = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d
  const EPS = 1e-9
  if (t < EPS || t > 1 - EPS || s < EPS || s > 1 - EPS) return null
  return { pt: { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) }, t }
}
