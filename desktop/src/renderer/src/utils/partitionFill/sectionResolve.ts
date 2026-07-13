// partitionFill/sectionResolve.ts — extracted verbatim from partitionFill.ts
// (debt #201 round 2). See index.ts for the module-level doc.
import { FRAC_EPS, SPAN_EPS, signedArea2 } from './carve'
import { clipPolyAboveElev, clipPolyAboveLine, clipPolyBelowElev, hasArea } from './clip'
import { closeColumnGaps, collapseAdjacentSameFormation, columnTotalDepth, computeBottomTieLine, reduceColumn, type SideColumn } from './columnReduce'
import { makeGapRegionsDisjoint, subtractPolygon } from './disjoint'
import { emitGap } from './emit'
import { type Correlated } from './matcher'
import { EPS, type CorrelationEdge, type LensApexOverride, type PartitionColumn, type PartitionPoint, type PartitionRegion, type PartitionUnit } from './types'

// Whole-section resolve
// ---------------------------------------------------------------------------

/** A partition region tagged with the gap (0-based, left-column index) it fills. */
export interface SectionRegion extends PartitionRegion {
  gapIndex: number
}

/**
 * One substrate fill quad below a column's TD (elevation space). The left/right
 * edges carry independent top/base elevations so the band can SLOPE across the
 * column — continuing the straight deep-test→deep-test bridge line through a
 * shallow column instead of flattening it.
 */
export interface UnderColumnQuad {
  /** Top elevation (mTAW) at the column's LEFT edge. */
  topLeftElev: number
  /** Top elevation at the column's RIGHT edge. */
  topRightElev: number
  /** Base elevation at the column's LEFT edge. */
  baseLeftElev: number
  /** Base elevation at the column's RIGHT edge. */
  baseRightElev: number
  formationId: string
}

/** The substrate fill below one column's TD. */
export interface UnderColumnFill {
  /** Index into the non-empty ordered ``columns`` passed in. */
  columnIndex: number
  /** Quads, top→bottom, that tile [deepest..TD] with no vertical gap. */
  quads: UnderColumnQuad[]
}

/**
 * Elevation intervals where a vertical line at ``frac`` crosses a simple polygon
 * (even-odd scanline). Vertical edges (equal-fraction endpoints) are skipped.
 *
 * Parameters
 * ----------
 * poly : readonly PartitionPoint[]
 *     Closed polygon ring in (fraction, elevation) space.
 * frac : float
 *     Fraction in [0, 1] at which to slice.
 *
 * Returns
 * -------
 * list[tuple[float, float]]
 *     ``[baseElev, topElev]`` pairs (ascending elevation within each pair).
 */
export function slicePolygonAtFraction(
  poly: readonly PartitionPoint[],
  frac: number,
): Array<[number, number]> {
  const ys: number[] = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    if (a.fraction === b.fraction) continue
    const lo = Math.min(a.fraction, b.fraction)
    const hi = Math.max(a.fraction, b.fraction)
    if (frac < lo || frac > hi) continue
    const t = (frac - a.fraction) / (b.fraction - a.fraction)
    ys.push(a.elevation + t * (b.elevation - a.elevation))
  }
  ys.sort((p, q) => p - q)
  const out: Array<[number, number]> = []
  for (let k = 0; k + 1 < ys.length; k += 2) out.push([ys[k], ys[k + 1]])
  return out
}

/**
 * Substrate fill for the column-width sliver BELOW each test's TD.
 *
 * The gap partition is built edge-to-edge (a gap spans the left column's right
 * edge to the right column's left edge), and the per-column litho bands stop at
 * the test TD — so the column's own x-range below its TD is filled by nothing
 * ("the gap exactly below a test column").  This continues the adjacent gap's
 * MATRIX (non-lens) stratigraphy flat across the column width, below its TD,
 * down to the deepest matrix base, stacked contiguously so the section is
 * gapless under every test.
 *
 * The result is in elevation space (no screen projection) so it is unit-testable
 * without rendering — the regression guard for the dogfeed sub-TD void bug.
 *
 * Gap-closing rule: at a column edge the lens wedges have pinched out, so the
 * matrix (non-lens) slices alone may leave a vertical gap where a lens sat.  We
 * close it by extending the segment BELOW the gap upward to meet the one above,
 * because an enclosed lens shares the same matrix formation above and below.
 *
 * Parameters
 * ----------
 * columns : readonly PartitionColumn[]
 *     The non-empty columns in along-section order — the SAME list passed to
 *     ``computeSectionFill`` (region ``gapIndex`` is relative to it).
 * regions : readonly SectionRegion[]
 *     The output of ``computeSectionFill`` for those columns.
 *
 * Returns
 * -------
 * UnderColumnFill[]
 *     One entry per column that has anything to fill below its TD.  A column
 *     that is itself the deepest at its edge yields no entry.
 */
export function computeUnderColumnSubstrate(
  columns: readonly PartitionColumn[],
  regions: readonly SectionRegion[],
): UnderColumnFill[] {
  const EPS = 0.01
  const nCol = columns.length
  if (nCol < 2) return []

  /**
   * Contiguous matrix (non-lens) stack at one gap edge, below ``tdElev``. Lens
   * wedges have pinched out at a column edge, so the matrix slices alone may leave
   * a vertical gap where a lens sat; we close it by extending the segment BELOW
   * upward to meet the one above (an enclosed lens shares the matrix formation on
   * both sides). Returns top→bottom with no vertical gap.
   */
  const stackAtEdge = (gapIdx: number, frac: number, tdElev: number) => {
    const segs: Array<{ lo: number; hi: number; formationId: string }> = []
    for (const r of regions) {
      if (r.gapIndex !== gapIdx || r.kind === 'lens') continue
      for (const [lo, hi] of slicePolygonAtFraction(r.polygon, frac)) {
        // A region whose slice extends ABOVE this column's TD is a SHALLOW band
        // dipping below the TD (e.g. S8's silt banded to a deeper neighbour), not
        // deep-bridge stratigraphy. Its below-TD portion belongs to the band (it
        // fills down in the gap); repainting it here made it a SEPARATE floating
        // silt strip below the column that pinched out (dogfeed 2026-07-08). Fill
        // the under-column strip only with stratigraphy that genuinely lies below
        // the TD — the deep-test→deep-test bridge — so the strip is clay/sand as
        // the neighbours log there, and the band alone owns the shallow silt.
        if (hi > tdElev + EPS) continue
        const top = Math.min(hi, tdElev)
        if (top - lo > EPS) segs.push({ lo, hi: top, formationId: r.formationId })
      }
    }
    segs.sort((a, b) => b.hi - a.hi)
    const out: Array<{ top: number; base: number; formationId: string }> = []
    let cursor = tdElev // top of the next band to place
    let aboveForm: string | null = null // formation of the band directly above the cursor
    for (const s of segs) {
      if (cursor - s.lo <= EPS) continue // already covered by a higher segment
      if (s.hi < cursor - EPS) {
        // A vertical VOID between the band above (cursor) and this segment's top.
        // Fill it with the OVERLYING formation (extend the band ABOVE downward), NOT
        // this segment's — a narrowing clay above a thickening silt leaves this gap,
        // and the neighbours log the clay there (owner dogfeed 2026-07-10: "there's
        // clay to the left and to the right"). Extending the silt UP painted silt
        // where clay belongs. For a lens pinch-out the matrix is the same above and
        // below, so extend-above-down is identical to the old extend-below-up there.
        out.push({ top: cursor, base: s.hi, formationId: aboveForm ?? s.formationId })
        cursor = s.hi
      }
      out.push({ top: cursor, base: s.lo, formationId: s.formationId })
      cursor = s.lo
      aboveForm = s.formationId
    }
    // Merge consecutive same-formation bands: a void filled with the overlying
    // formation is adjacent to that overlying band, so they form one contiguous band.
    const merged: Array<{ top: number; base: number; formationId: string }> = []
    for (const b of out) {
      const last = merged[merged.length - 1]
      if (last && last.formationId === b.formationId && Math.abs(last.base - b.top) < EPS) {
        last.base = b.base
      } else {
        merged.push({ ...b })
      }
    }
    return merged
  }

  const out: UnderColumnFill[] = []
  for (let ci = 0; ci < nCol; ci++) {
    const col = columns[ci]
    if (col.units.length === 0) continue
    const tdElev = col.surfaceElevM - Math.max(...col.units.map((u) => u.baseDepthM))

    // The matrix stack at THIS column's LEFT edge (right edge of the left gap) and
    // RIGHT edge (left edge of the right gap). At a column edge the lens wedges
    // have pinched out, so these are the deep-test bridge contacts arriving at the
    // column — sloping a quad between them continues the straight deep→deep line.
    const leftStack = ci > 0 ? stackAtEdge(ci - 1, 0.9985, tdElev) : []
    const rightStack = ci < nCol - 1 ? stackAtEdge(ci, 0.0015, tdElev) : []

    const quads: UnderColumnQuad[] = []
    const sameStack =
      leftStack.length > 0 &&
      leftStack.length === rightStack.length &&
      leftStack.every((s, i) => s.formationId === rightStack[i].formationId)

    if (sameStack) {
      // Both edges carry the same band stack (the bridge is continuous): SLOPE
      // each band from its left-edge contact to its right-edge contact.
      for (let i = 0; i < leftStack.length; i++) {
        const l = leftStack[i]
        const r = rightStack[i]
        quads.push({
          formationId: l.formationId,
          topLeftElev: l.top,
          baseLeftElev: l.base,
          topRightElev: r.top,
          baseRightElev: r.base,
        })
      }
    } else {
      // Stacks differ (an extra band on one side, or an edge column with only one
      // gap): fall back to a FLAT fill from whichever side has data, so the column
      // stays gapless even when a clean slope can't be paired.
      const s = rightStack.length > 0 ? rightStack : leftStack
      for (const seg of s) {
        quads.push({
          formationId: seg.formationId,
          topLeftElev: seg.top,
          baseLeftElev: seg.base,
          topRightElev: seg.top,
          baseRightElev: seg.base,
        })
      }
    }
    if (quads.length > 0) out.push({ columnIndex: ci, quads })
  }
  return out
}

/**
 * GEOMETRY-FILL of deep voids by draping the connected body above each void down
 * to the next region below it (owner's final section-fill step, 2026-07-11).
 *
 * After the partition is assembled, a sub-shallow-TD void can remain where a
 * connected body's spanning band tapers to a point (a mixed-tie wedge: the
 * connected ZAND on CS1 pinches at S7's clay-base tie, leaving the deep space
 * down to the basal clay uncovered). The owner's rule: **the connected body
 * directly ABOVE a void drapes DOWN to fill it, stopping at the next correlated
 * band below** (or the gap floor).
 *
 * This is topology-driven, not heuristic — no per-gap constants, no CS1 magic numbers:
 *  - Only a CONNECTED body drapes — its ``formationId`` participates in a cross-column
 *    correlation edge (``bandedFormations``). A lone uncorrelated unit is NOT connected
 *    → it does NOT fill (it pinches), and its void is LEFT for the engineer to correlate.
 *  - The drape hangs from a band's OWN (sloping) top edge and reaches DOWN to the next
 *    region below (the next correlated band) or the gap floor. It fills exactly the empty
 *    space between existing regions, so it can never cross or overlap a band (band-
 *    authority holds by construction — the drape lives BETWEEN bands, never inside one).
 *  - Each column's own drilled lithology is ground truth AT that column (explicit-content
 *    invariant); a drape never overwrites it.
 *
 * Geometry (exact, via polygon subtraction — no rasterisation, no per-gap tuning):
 * per gap, each connected band is a drape SOURCE. Processed DEEPEST-TOP-FIRST, a
 * source's downfill = the quad from its own (sloping) TOP EDGE down to the gap floor,
 * MINUS every original region AND every drape already emitted (deeper bands). The
 * surviving pieces are exactly the empty space directly below that band; each is
 * emitted as a drape carrying the band's lithology and is itself added to the
 * subtrahends, so the next (shallower) source stops on top of it. The deepest
 * connected band therefore claims the deep void (the sand), and a shallower band fills
 * only the residual above it (the clay) — a true partition by construction. The top
 * edge FOLLOWS the band's tie (never poking above it), and where a mixed-tie span
 * tapered to an apex the edge converges there so the fill still reaches the deep void
 * the taper left (the CS1 ZAND-under-S7A case). Before the drapes run, each column's
 * sub-cap observed units are rendered (``debugSrc: 'obs'``) where not already covered,
 * so a shallow test's own drilled lithology closes its sub-cap void with the correct
 * colour instead of a lateral band flooding it; those wedges also guard the drapes.
 *
 * @param regions - Full assembled region list (all gaps); mutated by APPENDING drapes.
 * @param bandedFormations - formationIds that participate in a cross-column edge
 *   (i.e. connected/correlated across columns). Only these drape.
 * @param gapFloor - per-gap floor elevation (the bottom-tie line's deeper value);
 *   the drape reaches this when no region sits below the source. ``undefined`` → the
 *   deepest covered elevation in the gap is used (no floor to reach).
 * @param columnFloorElev - each filtered column's own deepest-observed-base elevation
 *   (its TD). Used to find the emit cap (the shallower column's TD) and the deeper-
 *   drilled column whose sub-cap observed data needs the guard. Index-aligned.
 * @param columnUnits - each filtered column's observed units (top/base depth + surface).
 *   A drape must never cover a column's OWN observed lithology (explicit-content
 *   invariant): a column drilled to its TD, so its observed data is ground truth at
 *   its own location. The deeper column's sub-cap observed profile is subtracted from
 *   the drape as a wedge anchored at the column edge and pinching to the gap midpoint.
 *   Index-aligned to the filtered non-empty columns.
 */
export function drapeConnectedBodiesIntoVoids(
  regions: SectionRegion[],
  bandedFormations: ReadonlySet<string>,
  gapFloor: ReadonlyMap<number, number | undefined>,
  columnFloorElev: readonly number[],
  columnUnits: readonly { surface: number; units: readonly PartitionUnit[] }[],
): void {
  // Elevation tolerance for "covered here" / "a is directly above b" tests. Coarser
  // than SPAN_EPS: real correlated interfaces are shared contact lines and a
  // sub-millimetre seam between two regions must NOT read as a void.
  const VOID_EPS = 0.03
  // Minimum void thickness worth filling (below this it is a rasterisation seam, not
  // a hole — matches the void gate's ~0.05 m sensitivity floor).
  const MIN_VOID_M = 0.05

  const byGap = new Map<number, SectionRegion[]>()
  // Lens regions are never drape SOURCES or void-fill targets, but they ARE occupied
  // space: a lens (an enclosed pinch-out unit, e.g. the S7 silt/peat wedges) must be
  // subtracted from every drape and observed wedge, or a connected body drapes its own
  // colour straight over the lens and the pinch-out reads as colour-striped (the CS1
  // peat "brown→green→light-brown" artifact). Collect them per gap as subtrahends.
  const lensByGap = new Map<number, SectionRegion[]>()
  for (const r of regions) {
    if (r.kind === 'lens') {
      const lg = lensByGap.get(r.gapIndex) ?? []
      lg.push(r)
      lensByGap.set(r.gapIndex, lg)
      continue
    }
    const g = byGap.get(r.gapIndex) ?? []
    g.push(r)
    byGap.set(r.gapIndex, g)
  }

  const drapes: SectionRegion[] = []

  for (const [gap, regs] of byGap) {
    const floor = gapFloor.get(gap)
    if (floor === undefined) continue // no bottom-tie floor → no defined fill target

    // Lens polygons in this gap — subtracted from every observed wedge and drape below so
    // an enclosed pinch-out is never over-painted by a draped connected body.
    const lensPolys = (lensByGap.get(gap) ?? []).map((r) => r.polygon as PartitionPoint[])

    // The emit cap = the SHALLOWER column's TD (``max`` elevation of the two column TDs).
    // Above it is the emit pass's domain (real adjacent geometry + correlation bands);
    // below it is deep fill. The observed-data fill (below) is clipped to this cap so it
    // can never draw over a near-surface correlation band; the connected-body drape below
    // hangs from each band's own (sloping) top, so it follows its tie and never pokes
    // above it (the band-authority edge-on-tie rule).
    const leftTD = columnFloorElev[gap]
    const rightTD = columnFloorElev[gap + 1]
    const capElev = Math.max(leftTD, rightTD)

    // Each column's sub-cap observed data (explicit-content fill). Below the emit cap a
    // column's observed units are rendered only where they were correlated; that drilled
    // lithology is ground truth AT the column, so where it is NOT already covered we
    // render it in its OWN colour, and a lateral drape must never overwrite it. Each such
    // unit becomes a wedge anchored at the column edge (full observed thickness there)
    // pinching to the gap midpoint (observed AT the column, unknown in the gap → a
    // symmetric taper, not a tuned distance), clipped BELOW the emit cap so it never
    // touches a shallower-zone band. We emit ``wedge \ existing regions`` in the unit's
    // own lithology and subtract the whole wedge from later drapes so nothing floods that
    // column's data. Both columns are handled — the shallower one's own units near the cap
    // (the CS1 S8 SILT case) as well as the deeper one's sub-cap stack.
    const observedWedges: PartitionPoint[][] = []
    {
      const existing = [...regs.map((r) => r.polygon as PartitionPoint[]), ...lensPolys]
      for (const side of [0, 1] as const) {
        const ci = gap + side
        const col = columnUnits[ci]
        if (!col || col.units.length === 0) continue
        const edgeFrac = side
        for (const u of col.units) {
          const top = Math.min(col.surface - u.topDepthM, capElev) // only below the emit cap
          const base = col.surface - u.baseDepthM
          if (top - base < MIN_VOID_M) continue
          const wedge: PartitionPoint[] = [
            { fraction: edgeFrac, elevation: top },
            { fraction: 0.5, elevation: (top + base) / 2 },
            { fraction: edgeFrac, elevation: base },
          ]
          observedWedges.push(wedge)
          for (const p of subtractPolygon(wedge, existing)) {
            if (!hasArea(p)) continue
            drapes.push({ formationId: u.formationId, bodyId: u.bodyId, kind: 'quad', polygon: p, gapIndex: gap, debugSrc: 'obs' })
          }
        }
      }
    }

    // Drape-source bands = CONNECTED bodies (their formation crosses columns via an
    // approved edge). A source drapes its lithology DOWN from its own top edge to the
    // gap floor, filling every void below it that no other region occupies. Processed
    // DEEPEST-top-first so a deeper connected body (the sand) claims the deep void
    // before a shallower one (the overlying clay) can reach past it — the shallower
    // source's downfill subtracts the deeper drape and therefore stops on top of it
    // (the "drape stops at the next correlated band below" rule, made exact).
    //
    // ``top`` here is the band's MAX elevation across the gap, used only to ORDER the
    // sources deepest-first; the drape itself hangs from the band's actual (sloping) top
    // EDGE (see ``topEdgeAt`` below), so it follows its tie and never pokes above it —
    // and where the band's span tapered to a wedge, the top edge converges to the apex,
    // so the fill still reaches the deep void the taper left (the CS1 ZAND-under-S7A case).
    interface Source {
      region: SectionRegion
      top: number // max elevation of the band across the gap (ordering key only)
    }
    const sources: Source[] = []
    for (const r of regs) {
      if (!bandedFormations.has(r.formationId)) continue // uncorrelated → pinches, never drapes
      let top = -Infinity
      for (const p of r.polygon) if (p.elevation > top) top = p.elevation
      if (top - floor > MIN_VOID_M) sources.push({ region: r, top })
    }
    if (sources.length === 0) continue
    // Deepest-top first (ascending top elevation).
    sources.sort((a, b) => a.top - b.top)

    // Fraction extent of each region (for the downfill rectangle width).
    const fracExtent = (poly: readonly PartitionPoint[]): [number, number] => {
      let lo = Infinity
      let hi = -Infinity
      for (const p of poly) {
        if (p.fraction < lo) lo = p.fraction
        if (p.fraction > hi) hi = p.fraction
      }
      return [Math.max(0, lo), Math.min(1, hi)]
    }

    // Subtrahends accumulate as we go: all ORIGINAL regions + each column's observed-data
    // wedge (explicit-content guard) + the drapes already emitted in this gap (deeper
    // bands). A shallower source thus cannot overlap a deeper drape or a column's own
    // observed lithology — it stops on top of them.
    const gapSubs: PartitionPoint[][] = [...regs.map((r) => r.polygon as PartitionPoint[]), ...observedWedges, ...lensPolys]

    // Top-edge elevation of a polygon at fraction f (its UPPER boundary there). Used so
    // the downfill hangs from the band's OWN top edge, which FOLLOWS its tie — not a flat
    // line at the band's global max, which would poke above the tie at intervening columns
    // (the band-authority edge-on-tie rule) AND flood a shallow neighbour's own data.
    const topEdgeAt = (poly: readonly PartitionPoint[], f: number): number => {
      let hi = -Infinity
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i]
        const b = poly[(i + 1) % poly.length]
        if ((a.fraction <= f && b.fraction >= f) || (b.fraction <= f && a.fraction >= f)) {
          const df = b.fraction - a.fraction
          const e = Math.abs(df) < FRAC_EPS ? Math.max(a.elevation, b.elevation) : a.elevation + ((f - a.fraction) / df) * (b.elevation - a.elevation)
          if (e > hi) hi = e
        }
      }
      return hi
    }

    for (const src of sources) {
      const [fLo, fHi] = fracExtent(src.region.polygon)
      if (fHi - fLo < FRAC_EPS) continue
      // Downfill quad: from the band's OWN sloping top edge down to the gap floor, over
      // the band's fraction extent. Subtracting all regions + prior drapes leaves only
      // the empty space directly reachable below the band — the void it drapes into. The
      // top follows the tie (band-authority safe); where the band's SPAN tapered to a
      // wedge (flat top, pinching base) the top stays flat and the fill reaches the deep
      // void the taper left (the CS1 ZAND-under-S7A case).
      let topLo = topEdgeAt(src.region.polygon, fLo)
      let topHi = topEdgeAt(src.region.polygon, fHi)
      // At the SHALLOWER column's edge (the one whose TD == the emit cap), clamp the
      // drape top to that column's TD: above it is the column's own observed data, which
      // the drape must not cover (the CS1 S8 SILT-at-cap case). The deeper column's edge
      // is not clamped — its own data is emitted and already bounds the drape there.
      if (Math.abs(leftTD - capElev) < SPAN_EPS && fLo <= FRAC_EPS) topLo = Math.min(topLo, capElev)
      if (Math.abs(rightTD - capElev) < SPAN_EPS && fHi >= 1 - FRAC_EPS) topHi = Math.min(topHi, capElev)
      const rect: PartitionPoint[] = [
        { fraction: fLo, elevation: topLo },
        { fraction: fHi, elevation: topHi },
        { fraction: fHi, elevation: floor },
        { fraction: fLo, elevation: floor },
      ]
      const pieces = subtractPolygon(rect, gapSubs)
      for (const p of pieces) {
        if (!hasArea(p)) continue
        // Every surviving piece is empty space directly below this band (all regions +
        // deeper drapes were subtracted). Because sources drape deepest-first, the deepest
        // connected band claims the deep void and shallower bands only fill the residual
        // above it — a true partition by construction (each cell ends up in one drape).
        const drape: SectionRegion = {
          formationId: src.region.formationId,
          bodyId: src.region.bodyId,
          kind: 'quad',
          polygon: p,
          gapIndex: gap,
          debugSrc: 'drape',
        }
        drapes.push(drape)
        gapSubs.push(p) // later (shallower) sources stop on top of this drape
      }
    }
  }

  if (drapes.length > 0) regions.push(...drapes)
}

/**
 * Spanning-band pass for the correlate-or-gap (tie-gesture) model.
 *
 * For every non-adjacent correlation edge (span ≥ 2 in the filtered-column array),
 * computes the sub-shallowTd portion of the spanning quad across each gap between
 * the edge's endpoints and returns them as ``SectionRegion`` fragments.
 *
 * **Split of responsibility:**
 * - ``emitGap`` + ``clipPolyAboveElev(shallowTd)`` handles the ABOVE-shallowTd
 *   portion — the real adjacent geometry.
 * - ``computeSpanningBands`` + ``clipPolyBelowElev(shallowTd)`` handles the
 *   BELOW-shallowTd portion — the deep region that only the non-adjacent endpoints
 *   actually reach (the intervening shallow column has no data there).
 *
 * Mixed-tie wedge (lo.formationId ≠ hi.formationId): the lo formation CONTINUES
 * and tapers to hi's top contact (the tie point).  Both TR and BR collapse to
 * ``hi.topElev`` → a triangular shape instead of a full quad.
 *
 * @param cols - Filtered, gap-closed columns (1:1 with ``colsAlong``).
 * @param edges - Approved correlation edges, same reference as computeSectionFill.
 * @param colsAlong - Real along-metre position per filtered column.
 * @param preInjectionBaseTD - Observed total depth (m) per filtered column,
 *   taken before any gap-close mutation; used to compute each gap's shallowTd.
 * @returns SectionRegion[] with ``gapIndex`` set to the gap's index in ``cols``.
 */
export function computeSpanningBands(
  cols: readonly { readonly surface: number; readonly units: readonly PartitionUnit[] }[],
  edges: readonly CorrelationEdge[],
  colsAlong: readonly number[],
  preInjectionBaseTD: readonly number[],
): SectionRegion[] {
  // Build layerId → position in the filtered-column array.
  interface LayerLoc {
    colIndex: number
    topElev: number
    baseElev: number
    formationId: string
    bodyId: string | null
  }
  const layerLoc = new Map<string, LayerLoc>()
  for (let ci = 0; ci < cols.length; ci++) {
    const c = cols[ci]
    for (const u of c.units) {
      layerLoc.set(u.layerId, {
        colIndex: ci,
        topElev: c.surface - u.topDepthM,
        baseElev: c.surface - u.baseDepthM,
        formationId: u.formationId,
        bodyId: u.bodyId,
      })
    }
  }

  // Collect unique (loLayerId, hiLayerId) band shapes.  A top-tie + a base-tie
  // for the SAME unit pair both describe the same quad; dedup to one entry.
  interface SpanBand {
    loColIndex: number
    hiColIndex: number
    loTopElev: number
    loBaseElev: number
    hiTopElev: number
    /** hiTopElev when mixed-tie (lo.formationId ≠ hi.formationId) → wedge. */
    hiBaseElev: number
    /** lo.formationId — lo continues and tapers toward hi. */
    formationId: string
    bodyId: string | null
  }
  const seen = new Set<string>()
  const bands: SpanBand[] = []

  for (const e of edges) {
    const locA = layerLoc.get(e.a)
    const locB = layerLoc.get(e.b)
    if (locA === undefined || locB === undefined) continue
    const [lo, hi] = locA.colIndex <= locB.colIndex ? [locA, locB] : [locB, locA]
    const [loId, hiId] = locA.colIndex <= locB.colIndex ? [e.a, e.b] : [e.b, e.a]
    if (hi.colIndex - lo.colIndex < 2) continue // adjacent — emitGap handles it

    // Dedup: the same unit pair may appear as a top-tie AND a base-tie edge.
    const key = `${loId}:${hiId}`
    if (seen.has(key)) continue
    seen.add(key)

    // Mixed-tie wedge: lo formation continues, converging to hi's TIED CONTACT.
    // For a base-tied hi (aSide/bSide = 'base'), the tied contact is hi.baseElev —
    // not hi.topElev. Using hi.topElev inflates the convergence point above the real
    // tie surface, causing the mixed-tie span quad's base to rise above the
    // authoritative clay-emit-band base, which then subtracts a triangular wedge
    // from the SAND quad and leaves a gap the clay drapes into (the CS1 clay-splitter
    // in gap 16: B2 SAND → S7 CLAY, aSide='base', convergence must be 4.23, not 5.05).
    const hiIsBase = locA.colIndex <= locB.colIndex ? e.bSide === 'base' : e.aSide === 'base'
    const hiContactElev = hiIsBase ? hi.baseElev : hi.topElev
    const mixedWedge = lo.formationId !== hi.formationId
    bands.push({
      loColIndex: lo.colIndex,
      hiColIndex: hi.colIndex,
      loTopElev: lo.topElev,
      loBaseElev: lo.baseElev,
      hiTopElev: mixedWedge ? hiContactElev : hi.topElev,
      hiBaseElev: mixedWedge ? hiContactElev : hi.baseElev,
      formationId: lo.formationId,
      bodyId: lo.bodyId,
    })
  }

  const result: SectionRegion[] = []

  for (const band of bands) {
    const loAlong = colsAlong[band.loColIndex]
    const hiAlong = colsAlong[band.hiColIndex]
    const totalSpan = hiAlong - loAlong
    if (Math.abs(totalSpan) < EPS) continue

    // Is this the DEEPEST band at BOTH endpoints — i.e. a deep-to-deep substrate
    // bridging band whose base is each endpoint column's own floor? For such a
    // band the fill must reach the FLAT bottom-tie floor of every intervening gap
    // (the deeper of the gap's two column floors), not the sloping line between
    // the two endpoints' bases. The linear base interpolation leaves a triangular
    // wedge above the flat floor at the shallower column of each gap (the CS1
    // gap-7/gap-8 deep-floor void: S11↔S10 base-tied across the shallow S8, the
    // band base slopes -9.85→-10.25 but the gate floor is flat at the deeper
    // column). Flattening the base to that floor fills the wedge continuously with
    // the correlated formation. Only applies to the deepest band; a mid-stack
    // bridging band keeps its sloping base so it does not flood the band below it.
    const loFloor = cols[band.loColIndex].surface - preInjectionBaseTD[band.loColIndex]
    const hiFloor = cols[band.hiColIndex].surface - preInjectionBaseTD[band.hiColIndex]
    const isDeepestBridge =
      Math.abs(band.loBaseElev - loFloor) < EPS && Math.abs(band.hiBaseElev - hiFloor) < EPS

    for (let g = band.loColIndex; g < band.hiColIndex; g++) {
      // Global fractions of this gap's two columns within [loAlong, hiAlong].
      const fL = (colsAlong[g] - loAlong) / totalSpan
      const fR = (colsAlong[g + 1] - loAlong) / totalSpan

      // Interpolate the spanning quad's elevations at this gap's columns.
      const topL = band.loTopElev + fL * (band.hiTopElev - band.loTopElev)
      const topR = band.loTopElev + fR * (band.hiTopElev - band.loTopElev)
      let baseL = band.loBaseElev + fL * (band.hiBaseElev - band.loBaseElev)
      let baseR = band.loBaseElev + fR * (band.hiBaseElev - band.loBaseElev)

      // Deepest bridging band: flatten the base to this gap's flat bottom-tie floor
      // (the deeper of the two gap-column bases) so the shallow-column wedge is
      // filled rather than left as an interior void.
      if (isDeepestBridge) {
        const flatFloor = Math.min(baseL, baseR)
        baseL = flatFloor
        baseR = flatFloor
      }

      // Quad in LOCAL gap fraction space (fraction 0 = left col, fraction 1 = right).
      const quad: PartitionPoint[] = [
        { fraction: 0, elevation: topL },
        { fraction: 1, elevation: topR },
        { fraction: 1, elevation: baseR },
        { fraction: 0, elevation: baseL },
      ]

      // Clip to the sub-shallowTd region (elevation ≤ shallowTd): emitGap + cap
      // already cover the above-shallowTd portion; spanning bands fill the deep rest.
      const leftFloorElev = cols[g].surface - preInjectionBaseTD[g]
      const rightFloorElev = cols[g + 1].surface - preInjectionBaseTD[g + 1]
      const shallowTd = Math.max(leftFloorElev, rightFloorElev)
      const clipped = clipPolyBelowElev(quad, shallowTd)
      if (!hasArea(clipped)) continue

      result.push({ formationId: band.formationId, bodyId: band.bodyId, kind: 'quad', polygon: clipped, gapIndex: g })
    }
  }

  return result
}

/**
 * Resolve the WHOLE section at once: reduce each column ONCE against BOTH its
 * neighbours, then emit each gap from the shared reduced columns.
 *
 * Reducing per column (not per gap) is what keeps a body continuous through a
 * shared column: the column has ONE reduced form, so the band anchored on it is
 * identical in both its gaps (no per-gap drift — the dogfeed peat-discontinuity
 * bug). A unit is pinched out as a lens only when it connects to NO neighbour
 * (``reduceColumn``); a unit connecting to one neighbour is kept and EMERGES as
 * an onlap (band in the connected gap, pinch in the other). ``body_id``
 * correlations are honoured even across non-overlapping elevations (a dipping
 * correlated bed stays one band — see ``connectsToNeighbour``).
 *
 * Rendering stays per-gap (the column strips interrupt the fill); each region is
 * tagged with its ``gapIndex`` so the overlay maps it with that gap's column edges.
 *
 * Parameters
 * ----------
 * columns : readonly PartitionColumn[]
 *     The section's columns, left→right (along-section order). Empty columns are
 *     skipped. Each column's ``units`` must be sorted by ``topDepthM``.
 * edges : readonly CorrelationEdge[]
 *     The APPROVED correlation edges (layer-id pairs). Two units band iff an edge
 *     connects their ``layerId``s; geometry only fills the uncorrelated remainder.
 * lensApexOverrides : optional per-body apex shaping (keyed by bodyId).
 * alongM : readonly number[], optional
 *     The along-section position (metres) of each NON-EMPTY column, in the same
 *     left→right order as ``columns`` after empties are skipped. Lets a later
 *     substrate pass slice an L→R deep-anchor partition at an intervening shallow
 *     column by its true along-section fraction between L and R. When absent (the
 *     default), columns are treated as uniformly spaced — current behaviour,
 *     backwards compatible.
 *
 * Returns
 * -------
 * SectionRegion[]
 *     All gaps' regions, each tagged with ``gapIndex``.
 */
export function computeSectionFill(
  columns: readonly PartitionColumn[],
  edges: readonly CorrelationEdge[] = [],
  lensApexOverrides?: ReadonlyMap<string, LensApexOverride>,
  alongM?: readonly number[],
): SectionRegion[] {
  // Build three separate edge lookups (order-independent layer-id pair key):
  //   correlated        — top-keyed edges (aSide='top'/omitted, bSide='top'/omitted).
  //                       Used by classifyTermination and pairScore: the authoritative
  //                       top-contact band signal.
  //   baseTied          — bottom-tie edges (both aSide='base' and bSide='base').
  //                       Lets the deepest base-tied units match + band.
  //   mixedTiedTopToBase — mixed (top↔base) edges: maps the TOP-side layerId to the
  //                       BASE-side layerId. The top-side unit's top contact is being
  //                       tied to the base-side unit's base contact (i.e. the TD of
  //                       a shallow test). Stored directionally so ``emitGap`` can
  //                       look up the exact tied-unit layerId and find its base depth
  //                       in the facing column to emit a rising quad.
  //
  // Keeping the three sets separate:
  //   - a base-tie never makes topCorr fire in classifyTermination;
  //   - a mixed tie never makes the deep unit look like a full top↔top band
  //     (which would mean it was seen by both columns, not just one).
  const edgeKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`)
  const edgeSet = new Set<string>()
  const baseTiedSet = new Set<string>()
  // topLayerId → baseLayerId (directional: the top-side is the one with aSide=top).
  const mixedTiedTopToBase = new Map<string, string>()
  for (const e of edges) {
    const aIsTop = e.aSide === 'top' || e.aSide == null
    const bIsTop = e.bSide === 'top' || e.bSide == null
    const aIsBase = e.aSide === 'base'
    const bIsBase = e.bSide === 'base'
    if (aIsTop && bIsTop) {
      edgeSet.add(edgeKey(e.a, e.b))
    } else if (aIsBase && bIsBase) {
      baseTiedSet.add(edgeKey(e.a, e.b))
    } else if (aIsTop && bIsBase) {
      // a is the top-side (deep unit top), b is the base-side (shallow test TD).
      mixedTiedTopToBase.set(e.a, e.b)
    } else if (aIsBase && bIsTop) {
      // b is the top-side, a is the base-side.
      mixedTiedTopToBase.set(e.b, e.a)
    }
  }
  // Every TOP-side layerId named by a mixed (top↔base) tie. Such a unit is the
  // engineer's explicit "this unit continues to the tied contact" declaration
  // (e.g. the GAP-18 bottom tie S6-ZAND-top ↔ S7-TD), so it must NOT be
  // lens/onlap-extracted — doing so deletes it BEFORE the floor walk applies
  // the tie, and the matrix floods its space (the clay-on-sand bug).
  //
  // Protection scope (owner 2/1/0 model, 2026-07-07): TOP-side keys are
  // protected GLOBALLY (the floor walk may raise them in any gap, incl.
  // non-adjacent jump ties). BASE-side values are protected PER-GAP — only
  // where their tie straddles the gap's two columns (built in the gap loop
  // below as ``gapMixedTied``). Protecting a base-side unit (the shallow
  // test's TD unit, e.g. S8's silt) in EVERY gap blocked its termination
  // toward an untied neighbour — the gap-7 rising-pinch double gesture.
  const mixedTiedLayerIds = new Set<string>()
  for (const [k] of mixedTiedTopToBase) {
    mixedTiedLayerIds.add(k)
  }
  const correlated: Correlated = (a, b) => edgeSet.has(edgeKey(a, b))
  // baseTied is always a closure over baseTiedSet (not gated on size > 0); callers
  // (reduceColumn / matchColumns / emitGap) are cheap on an empty set (no-ops).
  const baseTied: Correlated = (a, b) => baseTiedSet.has(edgeKey(a, b))
  // Layer IDs that participate in at least one approved correlation edge (both
  // top-top and top-base edges). Used by reduceColumn to distinguish a unit with
  // a jump edge to a DISTANT column (which should be merged across a void so it
  // can band via that edge) from a truly isolated unit with no edges anywhere
  // (which should NOT be bridged across a void).
  const allEdgedLayerIds = new Set<string>()
  for (const e of edges) {
    allEdgedLayerIds.add(e.a)
    allEdgedLayerIds.add(e.b)
  }

  // Drop empty columns; a gap is between two consecutive non-empty columns.
  const cols = columns
    .filter((c) => c.units.length > 0)
    .map((c) => ({ surface: c.surfaceElevM, units: c.units.map((u) => ({ ...u })) }))
  if (cols.length < 2) return []
  // Correlate-or-gap model (owner 2026-07-09, made permanent by the Stage-2
  // deletion 2026-07-12 / debt #237.5): uncapped emitGap (no
  // apex-clamp-to-shallow-TD), no deep-to-deep substrate — continuous fill comes
  // from the matrix onlapping/connecting via tie gestures, never interpolation
  // (the substrate was reverted 2026-07-10 for flooding clay across pinch-outs).
  // The legacy path (bridge injection + computeBracketSubstrate) lives in git
  // history before this date if a mechanism A/B is ever wanted again.
  // Margin (m) below a cross-litho tie line at which an emitGap region is treated as
  // straddling it and clipped to the above-tie part (gap-void fill, 2026-07-10).
  const TIE_CLIP_MARGIN = 0.02
  cols.forEach((c) => closeColumnGaps(c.units))

  // Snapshot of each column's OBSERVED total depth, taken before gap-close(a)
  // extends real units' baseDepthM — downstream reach/cap logic must see what the
  // column actually drilled, not gap-close(a)'s mutations.
  const preInjectionBaseTD: number[] = cols.map((c) => columnTotalDepth(c.units))

  // Real along-section positions per filtered column (1:1 with `cols`): used by
  // both the bridge-injection interpolation and the spanning-band pass so boundaries
  // land on the straight tie-line at each column's actual screen position.
  // Uniform fallback (column index) when no `alongM` is provided (tests, CS1 gate).
  const colsAlong: readonly number[] =
    alongM && alongM.length === columns.length
      ? (() => {
          const r: number[] = []
          for (let oi = 0; oi < columns.length; oi++) if (columns[oi].units.length > 0) r.push(alongM[oi])
          return r
        })()
      : cols.map((_, i) => i)

  // PER-GAP, PER-SIDE resolve (owner directive 2026-06-09): each gap is
  // self-contained. A unit's shape toward its LEFT neighbour and toward its
  // RIGHT neighbour are independent (it can band one way, pinch the other), so
  // each gap reduces FRESH COPIES of its two columns against EACH OTHER — no
  // shared per-column state carried between gaps. The reduce pulls only the
  // lenses (units uncorrelated to the facing neighbour on both contacts) and
  // merges the matrix around them; bands + onlaps are shaped by emitGap.
  // Every column as the band/lens decision sees it (TD + layer-id set), in
  // section order. The floor-interval carry-through reads NEAREST-FIRST slices
  // of this so it can defer past too-shallow void columns to the nearest
  // REACHING neighbour (owner directive 2026-06-16).

  const sideColumns: SideColumn[] = cols.map((c) => ({
    td: columnTotalDepth(c.units),
    layerIds: new Set(c.units.map((u) => u.layerId)),
  }))

  // Section-wide layerId → base-contact elevation (mTAW). Lets mixedTiedTopElev
  // resolve a tie that names a unit on a non-adjacent column (the tied unit is
  // not in the immediate gap's facing units). Built BEFORE the gap loop because
  // each gap operates on FRESH COPIES of its two columns (mutated by
  // closeColumnGaps / collapseAdjacentSameFormation) — the pre-gap originals carry
  // the unmodified layerIds.
  const layerBaseElevLookup = new Map<string, number>()
  for (const c of cols) {
    for (const u of c.units) {
      layerBaseElevLookup.set(u.layerId, c.surface - u.baseDepthM)
    }
  }

  // Spanning-band pass: pre-computed here — BEFORE the per-gap
  // loop — so the per-gap loop can gate the emitGap uncapped-push and the
  // apexElevFloor per-gap param on whether actual below-shallowTd spanning content
  // exists for that gap.  A shallow non-adjacent edge (e.g. a topA band at 0-2 m
  // that shares a body across 3 columns) produces an EMPTY region after
  // clipPolyBelowElev inside computeSpanningBands → it is filtered out of the
  // result → its gapIndex does NOT appear in spanningGapIndices.  This prevents
  // mis-classifying a gap as "spanning" when the only non-adjacent edge is a
  // surface unit that doesn't actually reach below the shallow TD (CASE 6 guard).
  const spanningBandRegions: SectionRegion[] = computeSpanningBands(
    cols,
    edges,
    colsAlong,
    preInjectionBaseTD,
  ).map((r) => ({ ...r, debugSrc: 'span' }))
  const spanningGapIndices = new Set(spanningBandRegions.map((r) => r.gapIndex))

  const out: SectionRegion[] = []
  // Correlated bands kept below the shallow-TD cap (per gap), collected in the cap
  // loop from ``tiedBandBase``-tagged regions. The deep-to-deep substrate — MATRIX
  // *and* its own lenses — is carved around these absolute user correlations so
  // nothing double-draws below the cap (owner directive 2026-07-08).
  const exemptBandsByGap = new Map<number, PartitionPoint[][]>()
  // Indices into ``out`` of tie-clipped emit regions. These are NOT
  // registered as exempt bands at emit time — they are first carved by the
  // authoritative spanning correlation bands (see the block after the spanning
  // append) and only their surviving remainder becomes an exempt band. Tracking
  // the out-index lets that block rewrite the exact entry in place.
  const tieClippedOutIdx: number[] = []

  // ---------------------------------------------------------------------------
  // Cross-lithology surface ties (along/elev space) — the "lines" the fill must
  // stay between (owner directive 2026-07-10, "colour between the lines"). A
  // spanning gap caps emitGap output at the shallow TD and relies on
  // ``computeSpanningBands`` to fill below; but that horizontal cap discards
  // emitGap's REAL deep data that sits ABOVE a sloping correlation tie — the
  // S8-flanking mid-clay voids (gaps 7 + 8). The fix: clip emitGap regions at the
  // sloping TIE LINE, not the horizontal cap — keep the real data above every
  // cross-litho tie it would otherwise straddle, and let spanning own only the
  // space BELOW the tie. Built from the ORIGINAL (pre-closeColumnGaps) ``columns``
  // + ``colsAlong`` so the tie geometry matches the app / the CS1 tie-cross gate
  // exactly (closeColumnGaps mutates base elevations). Only CROSS-litho ties (the
  // app's tie-hit condition, ``lithoA !== lithoB``); a same-litho tie is a band
  // boundary the fill legitimately sits on, not a surface it must not cross.
  interface CrossLithoTie {
    a1: number
    e1: number
    a2: number
    e2: number
  }
  const crossLithoTies: CrossLithoTie[] = (() => {
    // layerId → {along, top, base, topFid, belowFid} from the raw non-empty columns.
    const layerElev = new Map<
      string,
      { along: number; top: number; base: number; topFid: string; belowFid: string | null }
    >()
    let ci = 0
    for (const c of columns) {
      if (c.units.length === 0) continue
      const along = colsAlong[ci]
      ci++
      const sorted = [...c.units].sort((a, b) => a.topDepthM - b.topDepthM)
      for (let k = 0; k < sorted.length; k++) {
        const u = sorted[k]
        layerElev.set(u.layerId, {
          along,
          top: c.surfaceElevM - u.topDepthM,
          base: c.surfaceElevM - u.baseDepthM,
          topFid: u.formationId,
          belowFid: k + 1 < sorted.length ? sorted[k + 1].formationId : null,
        })
      }
    }
    // A base-side contact sits ON the lithology BELOW it (matches lithoByContactId);
    // a top-side contact on its own lithology.
    const sideLitho = (
      l: { topFid: string; belowFid: string | null },
      side: string | undefined,
    ): string | null => (side === 'base' ? l.belowFid : l.topFid)
    const ties: CrossLithoTie[] = []
    for (const e of edges) {
      const la = layerElev.get(e.a)
      const lb = layerElev.get(e.b)
      if (!la || !lb) continue
      const litA = sideLitho(la, e.aSide)
      const litB = sideLitho(lb, e.bSide)
      if (litA === null || litB === null || litA === litB) continue
      ties.push({
        a1: la.along,
        e1: e.aSide === 'base' ? la.base : la.top,
        a2: lb.along,
        e2: e.bSide === 'base' ? lb.base : lb.top,
      })
    }
    return ties
  })()

  for (let i = 0; i < cols.length - 1; i++) {
    const left = { surface: cols[i].surface, units: cols[i].units.map((u) => ({ ...u })) }
    const right = { surface: cols[i + 1].surface, units: cols[i + 1].units.map((u) => ({ ...u })) }
    const leftIds = new Set(left.units.map((u) => u.layerId))
    const rightIds = new Set(right.units.map((u) => u.layerId))
    // Each facing neighbour's TD for the reach guard (deepest accepted base).
    // Captured BEFORE injection so virtual units do not inflate the reach threshold
    // used by reduceColumn and the floor-interval carry-through.
    const leftTD = columnTotalDepth(left.units)
    const rightTD = columnTotalDepth(right.units)
    // Per-gap mixed-tie protection: global TOP-side keys + the BASE-side values
    // whose tie straddles THIS gap's two columns (see the set's doc above).
    const gapMixedTied = new Set(mixedTiedLayerIds)
    for (const [k, v] of mixedTiedTopToBase) {
      if ((leftIds.has(k) && rightIds.has(v)) || (rightIds.has(k) && leftIds.has(v))) {
        gapMixedTied.add(v)
      }
    }
    const lensesLeft = reduceColumn(left.units, rightIds, correlated, rightTD, baseTied, allEdgedLayerIds, gapMixedTied)
    const lensesRight = reduceColumn(right.units, leftIds, correlated, leftTD, baseTied, allEdgedLayerIds, gapMixedTied)
    collapseAdjacentSameFormation(left.units)
    collapseAdjacentSameFormation(right.units)
    // DIAGNOSTIC GAP_PROBE (env-gated; keep — owner directive to keep diagnostics):
    // GAP_PROBE=<i>[,<i>...] dumps the post-reduce match structure for those gaps so a
    // cross-column band/onlap defect can be read directly. Run with
    // `--disableConsoleIntercept` under vitest.
    if (
      typeof process !== 'undefined' &&
      process.env?.GAP_PROBE &&
      process.env.GAP_PROBE.split(',').includes(String(i))
    ) {
      const gl = (f: string): string =>
        ({ '38d1bc': 'ZAND', '19bb43': 'KLEI', '0f2e06': 'SILT', '512af4': 'VEEN' })[f.slice(-6)] ?? f.slice(-6)
      const gd = (u: { layerId: string; topDepthM: number; baseDepthM: number; formationId: string }, s: number): string =>
        `${gl(u.formationId)} [${(s - u.topDepthM).toFixed(2)}..${(s - u.baseDepthM).toFixed(2)}] ${u.layerId.slice(0, 12)}`
      // eslint-disable-next-line no-console
      console.error(`\n=== GAP ${i} PROBE  L=cols[${i}] R=cols[${i + 1}] ===`)
      // eslint-disable-next-line no-console
      console.error('LEFT :', left.units.map((u) => gd(u, left.surface)))
      // eslint-disable-next-line no-console
      console.error('RIGHT:', right.units.map((u) => gd(u, right.surface)))
      for (const lu of left.units)
        for (const ru of right.units) {
          const cc = correlated(lu.layerId, ru.layerId)
          const bt = baseTied?.(lu.layerId, ru.layerId) ?? false
          if (cc || bt)
            // eslint-disable-next-line no-console
            console.error(`  ${gd(lu, left.surface)} <> ${gd(ru, right.surface)} corr=${cc} baseTied=${bt}`)
        }
    }
    // Side context for the carry-through, NEAREST-FIRST from each facing column
    // outward: leftward starts with col i and walks toward index 0; rightward
    // starts with col i+1 and walks toward the section end. The facing columns
    // are included as the nearest candidate (a carry unit skips them when they
    // are too shallow, which by definition they are — but the helper stays
    // general).
    const leftwardColumns = sideColumns.slice(0, i + 1).reverse()
    const rightwardColumns = sideColumns.slice(i + 1)
    // This gap's SHALLOW TD (cap line): the SHALLOWER (higher-elevation) of the
    // two floors — the elevation below which only ONE column has data.
    // preInjectionBaseTD is the source so gap-close mutations cannot inflate it.
    // Computed BEFORE
    // emitGap so it can be threaded in as the one-sided-pinch apex clamp (a
    // boundary pinch tapering below the cap would otherwise be truncated to an
    // off-centre, abrupt tip — the GAP-19 "square end" dogfeed bug).
    const leftFloorElev = cols[i].surface - preInjectionBaseTD[i]
    const rightFloorElev = cols[i + 1].surface - preInjectionBaseTD[i + 1]
    const shallowTd = Math.max(leftFloorElev, rightFloorElev)
    const gapRegions = emitGap(
      left.units,
      left.surface,
      right.units,
      right.surface,
      lensesLeft,
      lensesRight,
      correlated,
      lensApexOverrides,
      i,
      leftwardColumns,
      rightwardColumns,
      baseTied,
      mixedTiedTopToBase,
      layerBaseElevLookup,
      // apexElevFloor: cap for one-sided pinch apex (the GAP-19 "square end" fix).
      // All gaps (spanning or not) clamp the apex UP to shallowTd
      // so a boundary pinch tapers to a clean POINT at the halfway fraction ON the
      // cap line rather than to an off-centre abrupt tip below it. The previous
      // -Infinity specialcase for non-spanning gaps was wrong: the apex
      // must taper to shallowTd regardless of whether the output is clipped or
      // pushed uncapped (PINCH-POINT test, 2026-07-10).
      shallowTd,
      false, // skipCarve
      preInjectionBaseTD[i], // observed TDs — immune to gap-close inflation
      preInjectionBaseTD[i + 1],
      // useTieGestures — the owner 2/1/0 tie-count model needs correlations to
      // exist: a unit lenses because the engineer did NOT tie it (0 of 2
      // contacts). In a section with NO edges at all there are no ties to count,
      // so the model is undefined — defer entirely to the GEOMETRY tier (same-
      // lithology banding + sideways continuation), which owns the uncorrelated
      // case (owner rule 4: SEC3 stays green). A gap with 0 ties inside a
      // section that HAS edges (e.g. gap-7 S11→S8) still uses tie-mode — the
      // engineer's decision NOT to correlate there is meaningful. The gate is
      // the whole SECTION's edge count, not this gap's tie count.
      edges.length > 0,
    )
    for (const r of gapRegions.map((rr) => ({ ...rr, debugSrc: 'emit' }))) {
      // Lens/onlap overlays are observed-region overlays — never clipped at the
      // cap. An extracted overlay CAN extend below the facing column's TD (a
      // deep-column minority lapping a band that dips under the shallow TD —
      // gap-17 VEEN, 2026-07-07); its OBSERVED data outranks the interpolated
      // substrate there, so the SUBSTRATE is carved around below-cap overlays
      // after its pass (the overlay-carve block below) rather than the overlay
      // being truncated. (Clipping the overlay instead broke the edge
      // configuration where no substrate bracket exists and the overlay is the
      // SOLE cover below the cap — VOID-B.)
      if (r.kind === 'lens') {
        out.push({ ...r, gapIndex: i })
        continue
      }
      // Absolute correlated band: the cap MUST NOT chop it. Keep it whole down to
      // its own tied base (clip only the part BELOW the tie, which no data reaches)
      // and register it so the substrate is carved around it.
      if (r.tiedBandBase !== undefined) {
        const kept = clipPolyAboveElev(r.polygon, r.tiedBandBase)
        if (hasArea(kept)) {
          out.push({ ...r, polygon: kept, gapIndex: i })
          const g = exemptBandsByGap.get(i) ?? []
          g.push(kept)
          exemptBandsByGap.set(i, g)
        }
        continue
      }
      // Non-spanning gap: emitGap owns ALL geometry for this gap —
      // including floor-interval sideways / one-sided-pinch regions below the
      // shallow TD.  No spanning band competes here, so push uncapped.
      // (Spanning gaps clip at shallowTd below; computeSpanningBands fills the
      // sub-shallowTd portion for them.)
      if (!spanningGapIndices.has(i)) {
        out.push({ ...r, gapIndex: i })
        continue
      }
      let minE = Infinity
      for (const p of r.polygon) if (p.elevation < minE) minE = p.elevation
      // Entirely at-or-above the shallow TD: pass through UNCHANGED (running it
      // through the clipper/dedupe could reorder vertices and break byte-identity).
      if (minE >= shallowTd - SPAN_EPS) {
        out.push({ ...r, gapIndex: i })
        continue
      }
      // Spanning gap, region dips below the shallow TD: clip at the sloping
      // CROSS-LITHO TIE LINE(s), not the horizontal shallow-TD cap ("colour between
      // the lines", owner 2026-07-10). Keep the emitGap real data ABOVE every tie it
      // would otherwise straddle — this is the mid-clay + real deep data the old
      // horizontal cap discarded into voids (gaps 7 + 8) — and let
      // ``computeSpanningBands`` own only the space BELOW the tie. A region entirely
      // below a tie clips to nothing (spanning owns it); one above all ties is kept
      // whole. Kept regions register as exempt bands so spanning is carved around
      // them (no double-cover). Falls back to the horizontal cap when the gap has NO
      // cross-litho ties (nothing to stay between).
      const aL = colsAlong[i]
      const aR = colsAlong[i + 1]
      const gLo = Math.min(aL, aR)
      const gHi = Math.max(aL, aR)
      // Ties overlapping THIS gap's along-span. When there are none, there is no
      // correlation line to colour between — fall back to the horizontal cap so the
      // legacy spanning + merge machinery owns the below-cap fill (a gap with only
      // same-lithology correlations, e.g. the synthetic dipping-silt band, produces
      // NO cross-litho ties and must stay byte-identical to before this pass).
      const gapTies = crossLithoTies.filter(
        (t) => Math.min(gHi, Math.max(t.a1, t.a2)) - Math.max(gLo, Math.min(t.a1, t.a2)) > 0,
      )
      if (gapTies.length === 0) {
        const clipped = clipPolyAboveElev(r.polygon, shallowTd)
        if (hasArea(clipped)) out.push({ ...r, polygon: clipped, gapIndex: i })
        continue
      }
      let poly: PartitionPoint[] = r.polygon as PartitionPoint[]
      for (const t of gapTies) {
        const slope = (t.e2 - t.e1) / (t.a2 - t.a1 || 1)
        const m = slope * (aR - aL)
        const b = t.e1 + slope * (aL - t.a1)
        let below = false
        for (const p of poly) {
          if (p.elevation < m * p.fraction + b - TIE_CLIP_MARGIN) {
            below = true
            break
          }
        }
        if (!below) continue
        poly = clipPolyAboveLine(poly, m, b)
        if (poly.length < 3) break
      }
      // A region NOT clipped by any tie is above every overlapping tie — real data
      // with no correlation line beneath it — so keep it WHOLE (do NOT fall back to
      // the horizontal cap, which discarded the real deep data into the gap-7 void).
      // Its below-cap part does not straddle any tie, so it is tie-cross safe. A
      // region clipped to nothing (entirely below its tie) drops through to spanning.
      if (hasArea(poly)) {
        // Mark as an absolute kept region (``tiedBandBase`` = its own deepest point):
        // the final carve then treats it as a SUBTRAHEND only (carves spanning bands
        // around it) and NOT a minuend, so it does not subtract itself into oblivion
        // — the same contract the branch-2 mixed-tie / band regions use.
        let keptMinE = Infinity
        for (const p of poly) if (p.elevation < keptMinE) keptMinE = p.elevation
        out.push({ ...r, polygon: poly, gapIndex: i, tiedBandBase: keptMinE, tieClipped: true })
        // A tie-clipped region is NOT registered as an exempt band up-front: a
        // spanning correlation band is authoritative and may pass THROUGH the
        // elevation range this region was kept in (the gap-7 SILT band whose base
        // dips below the S11 mid-clay's flat kept top). Registering it as exempt
        // here would let the clay carve the silt band away (clay-over-band bug).
        // Instead it is carved BY the overlapping spanning bands below and only the
        // surviving remainder becomes an exempt band. (Marked with the region index
        // so the carve can rewrite the exact out-entry.)
        tieClippedOutIdx.push(out.length - 1)
      }
    }
  }

  // Spanning-band pass: append the pre-computed spanning-band regions for every
  // non-adjacent correlation edge whose below-shallowTd portion is non-empty.
  // These were computed before the per-gap loop so that spanningGapIndices could
  // gate the per-gap uncapped-push and apexElevFloor.
  out.push(...spanningBandRegions)

  // Bands are authoritative (owner directive 2026-07-10, "colour between the lines",
  // confirmed on the real CS1 S11·S8·S10 SILT band): NO other region may be drawn
  // inside a correlation band's quad. A tie-clipped emit region was kept ABOVE a
  // sloping cross-litho tie, but that tie can be the BASE of a spanning correlation
  // band whose quad dips through the region (gap-7: the S11 mid-clay kept flat at
  // 5.01 pokes above the SILT band base, which dips 5.01→2.51). Carve every
  // tie-clipped region by the same-gap spanning bands so the band wins — the clay
  // pinches out BELOW the band base instead of spilling over it. The surviving
  // remainder (below the band) is what becomes the exempt band for the deep carve.
  if (tieClippedOutIdx.length > 0) {
    const spanByGap = new Map<number, PartitionPoint[][]>()
    // Span bands per gap keyed by bodyId — a tie-clipped emit region sharing a
    // span band's bodyId is the SAME body's flat adjacent-fill carry (emitGap draws
    // the deep unit flat across a shallow neighbour). The span band is the
    // authoritative tie-interpolated shape for that body, so its flat carry above
    // the band's own sloping top tie must NOT survive AS THAT BODY — it is the space
    // the OVERLYING unit's base descends into as the band top dips (real CS1 gap-8:
    // SILT body c3b8d5 flat-carries top 6.48 across S8, but its top tie descends to
    // 6.22 there; the sliver [6.22..6.48] belongs to the CLAY above, whose base sits
    // on the silt top). Reassigning the sliver to the overlying region fills it with
    // the correct lithology AND lets the span band keep its sloping top (rule: a
    // band's own edges follow its tie).
    const spanBandsByGapBody = new Map<string, SectionRegion[]>()
    for (const s of spanningBandRegions) {
      const g = spanByGap.get(s.gapIndex) ?? []
      g.push(s.polygon)
      spanByGap.set(s.gapIndex, g)
      if (s.bodyId) {
        const k = `${s.gapIndex} ${s.bodyId}`
        const arr = spanBandsByGapBody.get(k) ?? []
        arr.push(s)
        spanBandsByGapBody.set(k, arr)
      }
    }
    // Max elevation of a polygon (its flat carry top on the shallow side).
    const polyMaxElev = (poly: readonly PartitionPoint[]): number => {
      let m = -Infinity
      for (const p of poly) if (p.elevation > m) m = p.elevation
      return m
    }
    // Min elevation of a polygon.
    const polyMinElev = (poly: readonly PartitionPoint[]): number => {
      let m = Infinity
      for (const p of poly) if (p.elevation < m) m = p.elevation
      return m
    }
    for (const idx of tieClippedOutIdx) {
      const r = out[idx]
      // Same-body-as-a-spanning-band tie-clipped carry: the sliver above the band's
      // own top tie belongs to the OVERLYING unit, not this band's body. Find the
      // same-gap emit region directly above the span band (its base ≈ this sliver's
      // top) and reassign the sliver to it. The span band then owns the body's top
      // edge on its tie, and the overlying unit's base descends onto that tie (no
      // void, correct lithology). If no overlying region is found (edge case), fall
      // through to the normal carve so the region is not silently lost.
      if (r.bodyId && spanBandsByGapBody.has(`${r.gapIndex} ${r.bodyId}`)) {
        // Carve the flat carry by its OWN body's span band → the surviving remainder
        // is exactly the sliver ABOVE the band's sloping top (the flat carry minus
        // the band quad). Reassign that sliver to the overlying unit (its base
        // descends onto the band top). The span band already covers the band's own
        // shape, so the body is not lost.
        const ownBands = (spanBandsByGapBody.get(`${r.gapIndex} ${r.bodyId}`) ?? []).map((s) => s.polygon)
        const sliverPieces = subtractPolygon(r.polygon, ownBands).filter((p) => hasArea(p))
        if (sliverPieces.length > 0) {
          const sliverTop = polyMaxElev(r.polygon)
          let overlying: SectionRegion | undefined
          for (const o of out) {
            if (
              o.gapIndex === r.gapIndex &&
              o.kind !== 'lens' &&
              o.bodyId !== r.bodyId &&
              o.polygon.length >= 3 &&
              Math.abs(polyMinElev(o.polygon) - sliverTop) < SPAN_EPS
            ) {
              overlying = o
              break
            }
          }
          if (overlying !== undefined) {
            // The sliver is now the OVERLYING unit's fill, not a kept band — strip
            // the tie-clip / kept-band markers so the final carves treat it as an
            // ordinary region (it must be carveable by any authoritative band, and
            // must not be mistaken for one).
            const reassigned = {
              ...r,
              formationId: overlying.formationId,
              bodyId: overlying.bodyId,
              tiedBandBase: undefined,
              tieClipped: undefined,
            }
            out[idx] = { ...reassigned, polygon: sliverPieces[0] }
            for (let k = 1; k < sliverPieces.length; k++) {
              out.push({ ...reassigned, polygon: sliverPieces[k] })
            }
            continue
          }
        } else {
          // The flat carry is entirely inside its span band (no sliver above the
          // tie) → the band owns it; drop the flat carry.
          out[idx] = { ...r, polygon: [] }
          continue
        }
      }
      const bands = spanByGap.get(r.gapIndex)
      let survivors: PartitionPoint[][] = [r.polygon]
      if (bands && bands.length > 0) {
        survivors = subtractPolygon(r.polygon, bands).filter((p) => hasArea(p))
      }
      // Rewrite the out-entry: keep the largest surviving piece in place (identity
      // preserved), append any extra pieces, and register the survivors — NOT the
      // original — as exempt bands so the deep carve stays around the band.
      if (survivors.length === 0) {
        // Fully inside the band → the band owns it entirely. Drop the region
        // (mark it degenerate so the compaction below removes it).
        out[idx] = { ...r, polygon: [] }
      } else {
        out[idx] = { ...r, polygon: survivors[0] }
        for (let k = 1; k < survivors.length; k++) {
          out.push({ ...r, polygon: survivors[k] })
        }
        const g = exemptBandsByGap.get(r.gapIndex) ?? []
        for (const s of survivors) g.push(s)
        exemptBandsByGap.set(r.gapIndex, g)
      }
    }
    // Compact out any zero-area entries left by a fully-carved tie-clipped region.
    for (let k = out.length - 1; k >= 0; k--) {
      if (out[k].polygon.length < 3) out.splice(k, 1)
    }
  }

  // Absolute-correlation final carve (owner directive 2026-07-08). A tagged band
  // is the engineer's correlation and WINS over every OTHER same-gap region —
  // primary OR substrate. Subtract each gap's kept bands from every non-lens
  // region that is not itself a kept band, so nothing double-covers the band
  // below the cap (GAP-17 case-3 clay over the kept silt band; the earlier
  // substrate-only carve missed a region the substrate pass tagged to a different
  // gapIndex). Above the cap the bands only share contact lines with their tiled
  // neighbours, so the subtraction is a no-op there; the final makeGapRegionsDisjoint
  // still cleans any hairline residue.
  if (exemptBandsByGap.size > 0) {
    const rebuilt: SectionRegion[] = []
    for (const r of out) {
      const bands =
        r.kind !== 'lens' && r.tiedBandBase === undefined
          ? exemptBandsByGap.get(r.gapIndex)
          : undefined
      if (bands && bands.length > 0) {
        for (const p of subtractPolygon(r.polygon, bands)) rebuilt.push({ ...r, polygon: p })
      } else {
        rebuilt.push(r)
      }
    }
    out.length = 0
    out.push(...rebuilt)
  }

  // The straddle guard stops a tie-clipped body being re-merged across its tie.
  mergeSplitBodyRegions(
    out,
    crossLithoTies,
    cols.map((_, gi) => ({ l: colsAlong[gi], r: colsAlong[gi + 1] })).slice(0, cols.length - 1),
  )

  // Geometry-fill of deep voids (owner's final section-fill step
  // 2026-07-11): drape each connected body directly above a void DOWN to the next
  // correlated band below it. A connected body's mixed-tie spanning band tapers to a
  // point (the CS1 ZAND wedge at S7's clay-base tie), leaving the deep space down to
  // the basal clay uncovered; the drape fills exactly that void with the connected
  // body's lithology, bounded by the surrounding bands (never crossing one). An
  // UNcorrelated (unbanded) unit above a void does NOT drape — it pinches, and the
  // void is left for the engineer to correlate. Topology-driven, no per-gap constants.
  {
    // Connected = a formation whose units on DIFFERENT columns are joined by an
    // approved edge (a cross-column band). Same signal the CS1 lithology gate uses.
    const layerToColForm = new Map<string, { colIdx: number; formationId: string }>()
    cols.forEach((c, ci) => {
      for (const u of c.units) layerToColForm.set(u.layerId, { colIdx: ci, formationId: u.formationId })
    })
    const bandedFormations = new Set<string>()
    for (const e of edges) {
      const ua = layerToColForm.get(e.a)
      const ub = layerToColForm.get(e.b)
      if (!ua || !ub) continue
      if (ua.colIdx !== ub.colIdx && ua.formationId === ub.formationId) bandedFormations.add(ua.formationId)
    }
    // Per-gap floor = the bottom-tie line's deeper column value (the deepest the fill
    // reaches), matching the void gate's gapBottom exactly.
    const tieCols: PartitionColumn[] = cols.map((c, ci) => ({
      investigationId: String(ci),
      surfaceElevM: c.surface,
      units: c.units,
    }))
    const baseTiePairs = edges.filter((e) => e.aSide === 'base' && e.bSide === 'base') as { a: string; b: string }[]
    const bottomTie = computeBottomTieLine(tieCols, baseTiePairs)
    const gapFloor = new Map<number, number | undefined>()
    for (let g = 0; g + 1 < cols.length; g++) {
      const l = bottomTie.tieElev[g]
      const r = bottomTie.tieElev[g + 1]
      gapFloor.set(g, l === null && r === null ? undefined : Math.min(l ?? r!, r ?? l!))
    }
    // Each filtered column's own TD elevation (surface − pre-injection observed depth).
    const columnFloorElev = cols.map((c, ci) => c.surface - preInjectionBaseTD[ci])
    // Pass each filtered column's observed units so the drape never covers a column's
    // own drilled lithology (explicit-content guard). `cols` carries {surface, units}.
    drapeConnectedBodiesIntoVoids(out, bandedFormations, gapFloor, columnFloorElev, cols)
  }

  // Final partition guarantee: make same-gap non-lens regions pairwise disjoint.
  // emitGap's independent emit paths compute a shared contact line twice (a
  // matched-band base vs. the pinch beneath it, a substrate matrix vs. its notch),
  // leaving hairline (sub-pixel) overlap wedges — invisible on the litho axis but a
  // broken partition for the 3D voxel labelling that consumes this output (debt
  // #228). The later-in-array region is the one the renderer draws on top, so
  // subtracting it from the earlier region reproduces the rendered result exactly
  // while making the polygons a true partition.
  makeGapRegionsDisjoint(out)

  return out
}

/**
 * Merge a body's vertically-split tile regions in a gap into one coherent shape.
 *
 * The shallow-TD cap (``clipPolyAboveElev`` in ``computeSectionFill``) splits a
 * matched unit that extends BELOW the shallow column's TD into two parts: the
 * above-cap band (emitted by ``emitGap``, clamped flat at the shallow TD) and the
 * below-cap remainder (re-emitted by the deep-to-deep substrate pass). With the
 * same lithology AND the same ``bodyId``, that one geological unit renders as TWO
 * shapes — a flat band plus a separate same-body pinch tail, looking like it both
 * onlaps and wedges out (real CS1 GAP-8: a single SILT body drawn as band + tail).
 *
 * These split parts are already a contiguous, gap-less vertical stack (the
 * partition is a true tiling), so their union is a single column-spanning
 * trapezoid: at each column edge (fraction 0 and 1) the merged shape spans
 * ``[min, max]`` of the group's elevations there. The merged quad's base follows
 * the correlation — slanting from the shallow side's base to the deep neighbour's
 * matched base where the substrate kept the slant (GAP-8), or flat where the
 * substrate filled the sub-TD void flat.
 *
 * Tiling-safety guard: the merged quad is committed ONLY when the parts exactly
 * tile it (the summed part areas equal the quad area within ``SPAN_EPS``). A
 * concave or notched union (a body with an internal hole, e.g. a carved lens
 * cavity) would over-cover and collide with a neighbour — those groups are left
 * untouched. Lens/onlap overlays (``kind: 'lens'``) are excluded entirely; they
 * deliberately overlap their matrix and are not part of the tiling.
 *
 * Parameters
 * ----------
 * regions : SectionRegion[]
 *     The full region list; mutated in place — merged groups are collapsed to a
 *     single region (the first member's slot), the other members removed.
 */
export function mergeSplitBodyRegions(
  regions: SectionRegion[],
  crossLithoTies: readonly { a1: number; e1: number; a2: number; e2: number }[] = [],
  gapAlong: readonly { l: number; r: number }[] = [],
): void {
  // Straddle test: would ``quad`` (fraction/elev, in gap ``gi``) have interior both
  // clearly above AND below a cross-litho tie line? Re-merging a body split by the
  // tie-line clip would reconstruct the "clay spilling over the correlation" wedge
  // the clip removed (gaps 7 + 8), so any merge that straddles a tie is skipped.
  const straddlesTie = (quad: readonly PartitionPoint[], gi: number): boolean => {
    const g = gapAlong[gi]
    if (!g) return false
    const gLo = Math.min(g.l, g.r)
    const gHi = Math.max(g.l, g.r)
    for (const t of crossLithoTies) {
      const tLo = Math.min(t.a1, t.a2)
      const tHi = Math.max(t.a1, t.a2)
      if (Math.min(gHi, tHi) - Math.max(gLo, tLo) <= 0) continue
      const slope = (t.e2 - t.e1) / (t.a2 - t.a1 || 1)
      const m = slope * (g.r - g.l)
      const b = t.e1 + slope * (g.l - t.a1)
      let above = false
      let below = false
      for (const p of quad) {
        const d = p.elevation - (m * p.fraction + b)
        if (d > 0.05) above = true
        else if (d < -0.05) below = true
      }
      if (above && below) return true
    }
    return false
  }
  // Group non-lens region INDICES by (gapIndex, bodyId). A null bodyId can never
  // be a single geological unit split across the cap, so skip it.
  const groups = new Map<string, number[]>()
  for (let i = 0; i < regions.length; i++) {
    const r = regions[i]
    if (r.kind === 'lens' || !r.bodyId) continue
    const key = `${r.gapIndex}\u0000${r.bodyId}`
    const g = groups.get(key)
    if (g) g.push(i)
    else groups.set(key, [i])
  }

  const removed = new Set<number>()
  for (const idxs of groups.values()) {
    if (idxs.length < 2) continue
    // A split group must share one formation (a body is single-lithology). If not
    // (defensive — should not happen), leave it untouched.
    const first = regions[idxs[0]]
    if (idxs.some((i) => regions[i].formationId !== first.formationId)) continue

    // Elevation span at each column edge across the whole group.
    let maxL = -Infinity
    let minL = Infinity
    let maxR = -Infinity
    let minR = Infinity
    let partAreaSum = 0
    for (const i of idxs) {
      for (const p of regions[i].polygon) {
        if (Math.abs(p.fraction) < FRAC_EPS) {
          if (p.elevation > maxL) maxL = p.elevation
          if (p.elevation < minL) minL = p.elevation
        } else if (Math.abs(p.fraction - 1) < FRAC_EPS) {
          if (p.elevation > maxR) maxR = p.elevation
          if (p.elevation < minR) minR = p.elevation
        }
      }
      partAreaSum += Math.abs(signedArea2(regions[i].polygon)) / 2
    }
    // Every part must span the full fraction width (a degenerate triangle still
    // touches both edges at a single point), so all four bounds must be finite.
    if (!Number.isFinite(maxL) || !Number.isFinite(maxR)) continue

    const mergedQuad: PartitionPoint[] = [
      { fraction: 0, elevation: maxL },
      { fraction: 1, elevation: maxR },
      { fraction: 1, elevation: minR },
      { fraction: 0, elevation: minL },
    ]
    const quadArea = Math.abs(signedArea2(mergedQuad)) / 2
    // Tiling guard: the parts must EXACTLY tile the merged quad (no notch, no
    // overhang). Otherwise the min/max-per-edge quad would over-cover and overlap
    // a neighbouring body — skip the merge and keep the parts as-is.
    if (Math.abs(quadArea - partAreaSum) > SPAN_EPS) continue
    if (quadArea < SPAN_EPS) continue
    // Do NOT re-merge across a cross-litho tie when the group joins an emitGap region
    // (tie-clipped, kept ABOVE the tie) with a SPANNING band (owns BELOW the tie): the
    // bounding quad would straddle the sloping tie and reconstruct the "clay spilling
    // over the correlation" wedge the tie-line clip removed (gaps 7 + 8). A pure
    // emit↔emit merge (a genuine dipping band) is left untouched — only the
    // emit↔span reconstruction is blocked.
    const hasTieClipped = idxs.some((i) => regions[i].tieClipped)
    if (hasTieClipped && straddlesTie(mergedQuad, first.gapIndex)) continue

    // Collapse the group: replace the first member with the merged quad, drop the
    // rest. Preserve the first member's kind/formation/body/gap so downstream
    // consumers (overlay, gate) see one region for this body in this gap.
    regions[idxs[0]] = { ...first, kind: 'quad', polygon: mergedQuad }
    for (let k = 1; k < idxs.length; k++) removed.add(idxs[k])
  }

  if (removed.size === 0) return
  // Compact in place (preserve order of the survivors).
  let w = 0
  for (let r = 0; r < regions.length; r++) {
    if (removed.has(r)) continue
    regions[w++] = regions[r]
  }
  regions.length = w
}

// ---------------------------------------------------------------------------
