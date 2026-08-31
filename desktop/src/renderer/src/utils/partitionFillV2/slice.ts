/**
 * partitionFillV2/slice.ts — slice labelled faces at the column verticals and
 * emit per-gap ``SectionRegion`` polygons (design §3 step "output", §5).
 *
 * A v2 face can span multiple gaps (a band tied across several columns). The
 * output contract is per-gap fraction×elevation regions, so each face is CLIPPED
 * to every column strip [x_i, x_{i+1}] it overlaps; each non-empty clip becomes one
 * region whose ``gapIndex`` is ``i`` and whose polygon is in that gap's
 * fraction×elevation space (x -> fraction = (x - x_i)/(x_{i+1} - x_i), snapped to
 * the design's 1e-6 fraction grid).
 *
 * ``kind`` maps from the face classification: BAND -> 'quad', ONLAP -> 'pinch',
 * LENS -> 'lens'.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { type ColumnGeom } from './sectionGeom'
import { type LabelledFace } from './labelFaces'
import { splitAtSelfIntersections } from './ringSelfIntersect'
import { clipToStrip, splitAnnulus } from './sliceAnnulus'
import { type Point } from './types'
import { type PartitionPoint, type SectionRegion } from '../sectionPartition'

/** Snap grid for the OUTPUT fraction axis (design §3 numerical robustness). */
const FRACTION_SNAP = 1e-6
/** Elevation snap grid (metres) — the same 1 mm grid the arrangement uses; collapses
 *  clip-interpolation float noise so a shared contact is ONE canonical vertex. */
const ELEV_SNAP_M = 0.001
/** Minimum area (fraction·metres) below which a sliced region is dropped. */
const MIN_SLICE_AREA = 1e-7
/** Minimum fraction WIDTH a sliced region must span — below this it is a degenerate
 *  far-edge sliver pinned against a column vertical (float noise at fraction ~1.0). */
const MIN_FRACTION_WIDTH = 1e-3

/**
 * Slice all labelled faces into per-gap ``SectionRegion`` polygons.
 *
 * Parameters
 * ----------
 * labelled : readonly LabelledFace[]
 *     Faces with formation/body/class stamped.
 * columns : readonly ColumnGeom[]
 *     Column geometry (x positions = gap boundaries).
 *
 * Returns
 * -------
 * SectionRegion[]
 *     Per-gap regions in fraction×elevation space, deterministically ordered.
 */
export function sliceFaces(
  labelled: readonly LabelledFace[],
  columns: readonly ColumnGeom[],
): SectionRegion[] {
  const out: SectionRegion[] = []
  for (const lf of labelled) {
    const kind = lf.klass === 'band' ? 'quad' : lf.klass === 'onlap' ? 'pinch' : 'lens'
    // A face with holes (a matrix ANNULUS enclosing lens faces) must have the holes
    // CUT OUT — otherwise the matrix region overpaints the lens face (design: the lens
    // is its OWN face, a hole in the matrix, not an overlay). ``SectionRegion.polygon``
    // must stay a STRICTLY SIMPLE ring, so instead of a keyhole (removed in increment 6:
    // its self-touching slit broke shoelace/PIP agreement + the sliver gate), the
    // annulus is SPLIT at each hole's fraction extents into disjoint SIMPLE pieces —
    // left cap / right cap / above-strip / below-strip, v1-carve style (design §4
    // increment-12 row; mirrors ``partitionFill/carve.ts`` producing carved matrices as
    // simple concave rings). A hole-free face yields the single outer ring unchanged.
    //
    // STRIP-CLIP-FIRST for holed faces (ruling-8e Milestone-2, 2026-07-15): an enclosed
    // lens is emitted into BOTH adjacent gaps as two triangles sharing the column vertical,
    // so the matrix annulus carries ONE diamond hole STRADDLING that vertical. The box-split
    // ``splitAnnulus`` cuts a straddling hole's bounding box across two gaps and leaves
    // wedge slivers uncovered in each gap (the CS1 g14/g15 SILT 44 cm holes). Clipping the
    // OUTER ring AND each hole to the per-gap strip FIRST makes each gap's hole a TRIANGLE
    // with the column vertical as one straight edge, and the box-split then covers it exactly
    // (the wedge the box drops is now the sub-mm sloped-edge residue the comment below
    // describes, not a cross-gap band). A hole-free face keeps the original whole-ring path.
    for (let gi = 0; gi + 1 < columns.length; gi++) {
      const x0 = columns[gi].x
      const x1 = columns[gi + 1].x
      if (x1 <= x0) continue // degenerate / out-of-order columns
      // Clip the outer ring (and, for a holed face, each hole) to this gap strip, then split
      // the per-gap annulus into simple pieces. A hole-free face is a single strip clip.
      let stripRings: Point[][]
      if (lf.face.holes.length > 0) {
        const outerClip = clipToStrip(lf.face.polygon, x0, x1)
        if (outerClip.length < 3) continue
        const holeClips = lf.face.holes
          .map((h) => clipToStrip(h, x0, x1))
          .filter((h) => h.length >= 3)
        stripRings = holeClips.length > 0 ? splitAnnulus(outerClip, holeClips) : [outerClip]
      } else {
        const c = clipToStrip(lf.face.polygon, x0, x1)
        stripRings = c.length >= 3 ? [c] : []
      }
      for (const clip of stripRings) {
        if (clip.length < 3) continue
        const poly = toFractionSpace(clip, x0, x1)
        // Slicing a face that pinches to a column vertical (a seam apex on the strip
        // edge, a lobe touching x=x0/x1 at one point) can leave the fraction-space ring
        // WEAKLY simple — a repeated (fraction, elevation) vertex where two lobes meet.
        // The output contract is a SIMPLE ``SectionRegion.polygon`` (downstream consumers
        // — geotech refinement, voxel builder, DXF export — assume it), so split at every
        // repeat into simple sub-rings; each above the min-area floor is its own region.
        //
        // Some folds are NOT an exact repeat: two closing curves converging to the SAME
        // seam fraction at nearly-equal (but not identical) elevations trace a face that
        // properly SELF-CROSSES (a figure-8) without any repeated vertex — the CS2 gap15
        // banded-SILT-around-a-KLEI-lens face, exposed when the top band re-anchored to a
        // sloped first-litho line. ``splitAtRepeatedPoints`` cannot see it (the two apexes
        // differ by ~5 cm), so first split the ring at every genuine self-intersection
        // (a crossing between two non-adjacent edges), THEN split the resulting simple
        // sub-rings at any exact repeat. Both passes are no-ops on an already-simple ring.
        for (const simpleRing of splitAtSelfIntersections(poly))
          for (const sub of splitAtRepeatedPoints(simpleRing)) {
            if (sub.length < 3) continue
            if (polygonAbsArea(sub) < MIN_SLICE_AREA) continue
            // Drop a DEGENERATE far-edge sliver: a region whose entire fraction span is a
            // sub-pixel width pinned against a column vertical (all vertices within
            // MIN_FRACTION_WIDTH of one fraction). These are float-noise slices at
            // fraction ~1.0 (0.9999..1.0000) that clear the area floor but paint nothing
            // visible — the B6 gap2 ``f[1.00..1.00]`` slivers (design §4 increment-16
            // sweep). A real region spans a meaningful fraction width.
            let fMin = Infinity
            let fMax = -Infinity
            for (const p of sub) {
              if (p.fraction < fMin) fMin = p.fraction
              if (p.fraction > fMax) fMax = p.fraction
            }
            if (fMax - fMin < MIN_FRACTION_WIDTH) continue
            out.push({
              formationId: lf.formationId,
              bodyId: lf.bodyId,
              kind,
              polygon: sub,
              gapIndex: gi,
              // Provenance: a substrate/flood-painted face marks every slice it yields.
              // The key stays ABSENT (not ``undefined``) on tie-born regions so existing
              // deep-equal pins on the region shape are byte-identical.
              ...(lf.fallback ? { fallback: true as const } : {}),
              // Producing layers (label-independent recompute evidence) — same
              // absent-when-empty contract as ``fallback``; every slice of one face
              // shares the face's ids (copied so slices never alias one array).
              ...(lf.layerIds !== undefined && lf.layerIds.length > 0
                ? { layerIds: [...lf.layerIds] }
                : {}),
            })
          }
      }
    }
  }
  // Deterministic ordering: gap, then kind (quad<lens<pinch alpha), then first pt.
  out.sort(
    (a, b) =>
      a.gapIndex - b.gapIndex ||
      (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) ||
      a.polygon[0].fraction - b.polygon[0].fraction ||
      a.polygon[0].elevation - b.polygon[0].elevation,
  )
  return out
}

/**
 * Map a strip-clipped polygon (metres×elevation) to per-gap fraction×elevation,
 * snapping the fraction to the 1e-6 grid. Consecutive duplicate points (after
 * snapping) are dropped so the ring stays simple.
 */
function toFractionSpace(poly: readonly Point[], x0: number, x1: number): PartitionPoint[] {
  const w = x1 - x0
  // Snap elevation to the SAME 1 mm grid the arrangement snaps metres-x/y to. The
  // strip-clip interpolates crossing points (float noise ~1e-5 m), which would leave
  // two "different" vertices ~0.01 mm apart on a shared contact — sub-grid ghosts
  // that make the ring weakly non-simple (the ZAND-onlap-around-a-SILT-lens seam
  // apex). Snapping to 1 mm collapses each to one canonical vertex; the fraction is
  // snapped to the output 1e-6 grid as before.
  const raw: PartitionPoint[] = poly.map((p) => ({
    fraction: snapFraction((p.x - x0) / w),
    elevation: Math.round(p.y / ELEV_SNAP_M) * ELEV_SNAP_M,
  }))
  const out: PartitionPoint[] = []
  for (let i = 0; i < raw.length; i++) {
    const cur = raw[i]
    const prev = out[out.length - 1]
    if (prev && Math.abs(prev.fraction - cur.fraction) < FRACTION_SNAP && prev.elevation === cur.elevation)
      continue
    out.push(cur)
  }
  // Drop a trailing point equal to the first (closed-ring duplicate).
  if (out.length > 1) {
    const first = out[0]
    const last = out[out.length - 1]
    if (Math.abs(first.fraction - last.fraction) < FRACTION_SNAP && first.elevation === last.elevation)
      out.pop()
  }
  return out
}

/**
 * Split a fraction-space ring that self-touches (a repeated vertex) into simple
 * sub-rings at each repeat — the fraction-space twin of ``faces.splitAtRepeats``.
 *
 * A face simple in metres space can slice to a WEAKLY simple ring: two distinct
 * metres-x vertices collapse onto the same fraction (both on a column vertical =
 * fraction 0 or 1), or a lobe pinches to a seam apex exactly on the strip edge.
 * The first re-sighting of a vertex marks a closed inner loop ``[i..j)``; the
 * remainder is the outer ring. Recursing on both yields strictly simple rings.
 *
 * Parameters
 * ----------
 * ring : readonly PartitionPoint[]
 *     A fraction-space ring (no repeated closing vertex).
 *
 * Returns
 * -------
 * PartitionPoint[][]
 *     One or more simple rings whose union is the input.
 */
function splitAtRepeatedPoints(ring: readonly PartitionPoint[]): PartitionPoint[][] {
  const key = (p: PartitionPoint): string => `${Math.round(p.fraction / FRACTION_SNAP)}|${p.elevation}`
  const firstAt = new Map<string, number>()
  for (let j = 0; j < ring.length; j++) {
    const k = key(ring[j])
    const i = firstAt.get(k)
    if (i !== undefined) {
      const inner = ring.slice(i, j)
      const outer = [...ring.slice(0, i), ...ring.slice(j)]
      return [...splitAtRepeatedPoints(inner), ...splitAtRepeatedPoints(outer)]
    }
    firstAt.set(k, j)
  }
  return [ring as PartitionPoint[]]
}

/** Snap a fraction to the 1e-6 grid and clamp to [0, 1]. */
function snapFraction(f: number): number {
  const snapped = Math.round(f / FRACTION_SNAP) * FRACTION_SNAP
  return snapped < 0 ? 0 : snapped > 1 ? 1 : snapped
}

/** Absolute shoelace area of a fraction×elevation ring. */
function polygonAbsArea(poly: readonly PartitionPoint[]): number {
  let s = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    s += a.fraction * b.elevation - b.fraction * a.elevation
  }
  return Math.abs(s) / 2
}
