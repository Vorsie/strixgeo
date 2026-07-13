// partitionFill/emit.ts — extracted verbatim from partitionFill.ts
// (debt #201 round 2). See index.ts for the module-level doc.
import { carveOverlays, emitOneSidedPinch } from './carve'
import { bandsTowardSide, columnTotalDepth, extractIntervalMinorities, neighbourReaches, type SideColumn } from './columnReduce'
import { isSyntheticLayer, matchColumns, type Correlated, type MatchUnit, type TieSets } from './matcher'
import { buildLeftLensPolygon, buildLeftPinchPolygon, buildOnlapPolygon, buildQuadPolygon, buildRightLensPolygon, buildRightPinchPolygon, clampIface } from './polygonBuilders'
import { EPS, INTERIOR_PINCH_FRACTION, lensApexOverrideKey, type ExtractedLens, type Interface, type LensApexOverride, type PartitionPoint, type PartitionRegion, type PartitionUnit, type PinchUnit } from './types'

// Interval emission
// ---------------------------------------------------------------------------

/**
 * Emit regions for one interval (the span between two quads, or between the
 * surface/floor and a quad).
 *
 * An interval has a fixed enclosing ``topIface`` and ``baseIface``.  Any number
 * of left-only and right-only pinches share this interval and are tiled inside
 * it side-by-side.
 *
 * Meeting fraction = totalLeftThickness / (totalLeft + totalRight) — the
 * thicker side keeps more of the interval width.  When only one side has
 * pinches the lone side fills the whole interval (meetFraction 0 or 1).
 *
 * Parameters
 * ----------
 * pinches : PinchUnit[]
 *     The unmatched units in this interval, in top→bottom order per side.
 * topIface : Interface
 *     Top boundary of the interval.
 * baseIface : Interface
 *     Base boundary of the interval.
 * leftSurface, rightSurface : number
 *     Column surface elevations (mTAW).
 *
 * Returns
 * -------
 * PartitionRegion[]
 *     The pinch regions tiling this interval.  Empty when ``pinches`` is empty.
 */
export function emitInterval(
  pinches: PinchUnit[],
  topIface: Interface,
  baseIface: Interface,
  leftSurface: number,
  rightSurface: number,
  bracketed = false,
): PartitionRegion[] {
  if (pinches.length === 0) return []

  const leftPinches = pinches.filter((p) => p.side === 'left')
  const rightPinches = pinches.filter((p) => p.side === 'right')

  // Geometric-connectivity inference (owner directive 2026-06-08): when the
  // interval reduces to exactly one left unit and one right unit of the SAME
  // lithology (formationId), they are the same matrix body bridging the gap even
  // though they were never explicitly correlated (different bodyId). Connect
  // them as one band quad spanning the interval, inheriting the bracketing
  // interfaces — instead of tiling them as opposing pinches meeting at a seam
  // (the "droop"). Minority lithologies are extracted as lenses by the pre-pass,
  // so after extraction the matrix is this single-unit-per-side case.
  if (
    leftPinches.length === 1 &&
    rightPinches.length === 1 &&
    leftPinches[0].formationId === rightPinches[0].formationId
  ) {
    const p = leftPinches[0]
    const polygon: PartitionPoint[] = [
      { fraction: 0, elevation: leftSurface - topIface.leftDepth },
      { fraction: 1, elevation: rightSurface - topIface.rightDepth },
      { fraction: 1, elevation: rightSurface - baseIface.rightDepth },
      { fraction: 0, elevation: leftSurface - baseIface.leftDepth },
    ]
    return [{ formationId: p.formationId, bodyId: p.bodyId, kind: 'quad', polygon }]
  }

  // Compute total elevation thickness on each side for the meeting-fraction weight.
  const sumLeft = leftPinches.reduce((s, p) => {
    return s + Math.max(0, (leftSurface - p.ownTopDepth) - (leftSurface - p.ownBaseDepth))
  }, 0)
  const sumRight = rightPinches.reduce((s, p) => {
    return s + Math.max(0, (rightSurface - p.ownTopDepth) - (rightSurface - p.ownBaseDepth))
  }, 0)

  // Mismatched matrix: inside an interval bracketed by correlated bands ABOVE
  // and BELOW, exactly one left + one right unit of DIFFERENT lithology fill it
  // — no matrix connects across. The transition position is unknown, so the two
  // halves meet at the MIDPOINT (0.5, "halfway", not the thickness-weighted
  // fraction). The seam is a straight contact: the owner's model (2026-06-09)
  // has NO auto-facies wriggle — a lateral facies/disturbed contact is the
  // engineer's call, not a geometric inference. The ``bracketed`` gate keeps
  // surface/floor opposing pinches (PF3) on the weighted fraction.
  const mismatchedMatrix =
    bracketed &&
    leftPinches.length === 1 &&
    rightPinches.length === 1 &&
    leftPinches[0].formationId !== rightPinches[0].formationId

  let meetFraction: number
  if (mismatchedMatrix) {
    meetFraction = 0.5
  } else if (leftPinches.length > 0 && rightPinches.length > 0) {
    meetFraction = sumLeft + sumRight > EPS ? sumLeft / (sumLeft + sumRight) : 0.5
  } else if (leftPinches.length > 0) {
    meetFraction = 1 // lone left-only: full triangle to right column
  } else {
    meetFraction = 0 // lone right-only: full triangle to left column
  }

  const regions: PartitionRegion[] = []

  // Each left pinch is a SEPARATE region.  They all use the SAME topIface and
  // baseIface (the interval boundaries) and the SAME meetFraction — they tile
  // the same [0, meetFraction] slice, one per pinch body.
  // When there are multiple left pinches they are stacked vertically inside
  // [0, meetFraction]: each gets its own sub-interval.
  if (leftPinches.length === 1) {
    const p = leftPinches[0]
    const polygon = buildLeftPinchPolygon(topIface, baseIface, meetFraction, leftSurface, rightSurface)
    regions.push({ formationId: p.formationId, bodyId: p.bodyId, kind: 'pinch', polygon })
  } else if (leftPinches.length > 1) {
    // Multiple left pinches: subdivide the interval vertically on the left side.
    // Each pinch's own depth span defines its sub-interval on the left.
    // The right side (at meetFraction) is shared — interpolated from topIface/baseIface.
    const intervalLeftSpan = baseIface.leftDepth - topIface.leftDepth
    for (const p of leftPinches) {
      if (p.ownBaseDepth - p.ownTopDepth < EPS) continue
      // Sub-interface for this pinch: left side from the unit's own depths,
      // right side linearly interpolated from the interval's right progression.
      const tTop = intervalLeftSpan < EPS ? 0 : (p.ownTopDepth - topIface.leftDepth) / intervalLeftSpan
      const tBase = intervalLeftSpan < EPS ? 1 : (p.ownBaseDepth - topIface.leftDepth) / intervalLeftSpan
      const subTopRight = topIface.rightDepth + tTop * (baseIface.rightDepth - topIface.rightDepth)
      const subBaseRight = topIface.rightDepth + tBase * (baseIface.rightDepth - topIface.rightDepth)
      const subTop: Interface = { leftDepth: p.ownTopDepth, rightDepth: subTopRight }
      const subBase: Interface = { leftDepth: p.ownBaseDepth, rightDepth: subBaseRight }
      const polygon = buildLeftPinchPolygon(subTop, subBase, meetFraction, leftSurface, rightSurface)
      regions.push({ formationId: p.formationId, bodyId: p.bodyId, kind: 'pinch', polygon })
    }
  }

  // Similarly for right pinches.
  if (rightPinches.length === 1) {
    const p = rightPinches[0]
    const polygon = buildRightPinchPolygon(topIface, baseIface, meetFraction, leftSurface, rightSurface)
    regions.push({ formationId: p.formationId, bodyId: p.bodyId, kind: 'pinch', polygon })
  } else if (rightPinches.length > 1) {
    const intervalRightSpan = baseIface.rightDepth - topIface.rightDepth
    for (const p of rightPinches) {
      if (p.ownBaseDepth - p.ownTopDepth < EPS) continue
      const tTop = intervalRightSpan < EPS ? 0 : (p.ownTopDepth - topIface.rightDepth) / intervalRightSpan
      const tBase = intervalRightSpan < EPS ? 1 : (p.ownBaseDepth - topIface.rightDepth) / intervalRightSpan
      const subTopLeft = topIface.leftDepth + tTop * (baseIface.leftDepth - topIface.leftDepth)
      const subBaseLeft = topIface.leftDepth + tBase * (baseIface.leftDepth - topIface.leftDepth)
      const subTop: Interface = { leftDepth: subTopLeft, rightDepth: p.ownTopDepth }
      const subBase: Interface = { leftDepth: subBaseLeft, rightDepth: p.ownBaseDepth }
      const polygon = buildRightPinchPolygon(subTop, subBase, meetFraction, leftSurface, rightSurface)
      regions.push({ formationId: p.formationId, bodyId: p.bodyId, kind: 'pinch', polygon })
    }
  }

  return regions
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Emit the partition regions for ONE adjacent-column gap, given the already
 * reduced + collapsed unit stacks and each column's pinched-out lenses.
 *
 * Matching (``matchColumns``), the interval walk, onlap + facies handling, and
 * the lens/onlap overlays live here. The section-wide reduction (done ONCE per
 * column, against BOTH neighbours, so a shared column is identical in both its
 * gaps) happens upstream in ``computeSectionFill`` — never per gap.
 *
 * Parameters
 * ----------
 * leftUnits, rightUnits : PartitionUnit[]
 *     The two columns' reduced + collapsed units (gap-free, sorted, non-empty).
 * leftSurface, rightSurface : number
 *     Column surface elevations (mTAW).
 * leftLensesIn, rightLensesIn : readonly ExtractedLens[]
 *     The lenses pinched out of each column, rendered as LEFT / RIGHT overlays.
 * lensApexOverrides : optional per-body apex shaping.
 * leftwardColumns : readonly SideColumn[]
 *     The columns to the LEFT, NEAREST-FIRST, STARTING with this gap's left
 *     column ([leftCol, col i-1, …]). The floor-interval carry-through reads
 *     this to decide whether a carry unit on the RIGHT (deep) column bands toward
 *     the nearest REACHING neighbour on its left, deferring past too-shallow void
 *     columns (owner directive 2026-06-16). Empty → no reaching left neighbour.
 * rightwardColumns : readonly SideColumn[]
 *     The mirror — NEAREST-FIRST starting with this gap's right column
 *     ([rightCol, col i+2, …]); read for a carry unit on the LEFT (deep) column.
 * layerBaseElevLookup : ReadonlyMap<string, number>
 *     Section-wide map of layerId → base-contact elevation (mTAW), covering ALL
 *     columns. Used by the mixed-tie resolver so a tie that names a unit on a
 *     NON-ADJACENT column (e.g. B2-SAND-top ↔ S7a-CLAY-base when S6 sits between
 *     B2 and S7a) still resolves the correct TD elevation.
 *
 * Returns
 * -------
 * PartitionRegion[]
 *     Top-to-bottom MAIN regions that tile the gap, followed by lens/onlap overlays.
 */
export function emitGap(
  leftUnits: PartitionUnit[],
  leftSurface: number,
  rightUnits: PartitionUnit[],
  rightSurface: number,
  leftLensesIn: readonly ExtractedLens[],
  rightLensesIn: readonly ExtractedLens[],
  correlated: Correlated,
  lensApexOverrides?: ReadonlyMap<string, LensApexOverride>,
  gapIndex = 0,
  leftwardColumns: readonly SideColumn[] = [],
  rightwardColumns: readonly SideColumn[] = [],
  baseTied?: Correlated,
  mixedTiedTopToBase: ReadonlyMap<string, string> = new Map(),
  layerBaseElevLookup: ReadonlyMap<string, number> = new Map(),
  capElev = -Infinity,
  skipCarve = false,
  observedLeftTD?: number,
  observedRightTD?: number,
  useTieGestures = false,
): PartitionRegion[] {
  // Local copies — the interval walk appends interval-extracted lenses to these.
  const leftLenses: ExtractedLens[] = [...leftLensesIn]
  const rightLenses: ExtractedLens[] = [...rightLensesIn]

  // Layer ids named by a mixed (top↔base) tie — these units must NOT be
  // lens/onlap-extracted in the interval walk; they survive to the floor walk
  // that raises them to the tied contact (GAP-18 clay-on-sand fix).
  //
  // Protection scope (owner 2/1/0 model, 2026-07-07):
  //   - TOP-side keys: protected GLOBALLY — the floor walk may raise a tied
  //     unit in any gap the tie applies to (incl. non-adjacent jump ties).
  //   - BASE-side values: protected ONLY in the gap their tie straddles (the
  //     tie's top-side unit sits on THIS gap's other column). A base-side unit
  //     (the shallow test's TD unit, e.g. S8's silt) is banded via its top tie
  //     in the gap where the tie applies; protecting it in EVERY gap blocked
  //     its termination toward an untied neighbour — the gap-7 rising-pinch
  //     double gesture (owner dogfeed 2026-07-07).
  const mixedTiedLayerIds = new Set<string>()
  {
    const leftIds = new Set(leftUnits.map((u) => u.layerId))
    const rightIds = new Set(rightUnits.map((u) => u.layerId))
    for (const [k, v] of mixedTiedTopToBase) {
      mixedTiedLayerIds.add(k)
      if ((leftIds.has(k) && rightIds.has(v)) || (rightIds.has(k) && leftIds.has(v))) {
        mixedTiedLayerIds.add(v)
      }
    }
  }

  // Each column's total depth — the reach guard for interval-minority
  // extraction. reduceColumn only removes interior minorities (never the deepest
  // floor unit), so this equals the pre-reduction TD.
  const leftTD = columnTotalDepth(leftUnits)
  const rightTD = columnTotalDepth(rightUnits)
  // OBSERVED TDs for the extraction reach guard: what each column actually
  // drilled, immune to gap-close(a) base extensions (which
  // mutate the units BEFORE emitGap, inflating columnTotalDepth). Reach is
  // about observed evidence — an interpolated bridge below a shallow test must
  // not make it "reach" depths it never saw (gap-17 VEEN: the facing S7A, TD
  // 2.65 m, appeared to reach a 7.6 m-deep unit via its bridges → a many-metre
  // spurious onlap). Callers thread the pre-injection snapshot; fall back to
  // the computed TDs when absent (substrate anchors carry no bridges).
  const extractLeftTD = observedLeftTD ?? leftTD
  const extractRightTD = observedRightTD ?? rightTD

  // Per-side USER-tie sets toward the facing column (owner 2/1/0 model, locked
  // 2026-07-07): which of a unit's two bounding contacts the ENGINEER tied to
  // the facing neighbour. The count decides the termination gesture in the
  // interval extraction: 0 → LENS at own elevation, 1 → ONLAP on the tied
  // contact (2 = band, handled by matchColumns). A TD-tie (mixed base↔top
  // edge) counts exactly like any other tie: the base-side unit's BASE is
  // tied, the top-side unit's TOP is tied. Synthetic bridge units and their
  // auto-chained edges NEVER count — they band the matrix but are not
  // declarations (counting them made S8's silt look base-tied via the bridge
  // below it — the gap-7 dogfeed).
  const buildTieSets = (
    units: readonly PartitionUnit[],
    facingUnits: readonly PartitionUnit[],
  ): TieSets => {
    const facingIds = new Set(
      facingUnits.filter((u) => !isSyntheticLayer(u.layerId)).map((u) => u.layerId),
    )
    const top = new Set<string>()
    const base = new Set<string>()
    for (let ui = 0; ui < units.length; ui++) {
      const u = units[ui]
      if (isSyntheticLayer(u.layerId)) continue
      for (const f of facingUnits) {
        if (isSyntheticLayer(f.layerId)) continue
        if (correlated(u.layerId, f.layerId)) top.add(u.layerId)
        if (baseTied?.(u.layerId, f.layerId)) base.add(u.layerId)
      }
      // The layer BELOW's top contact IS this unit's base contact (a contact
      // is a shared boundary; the app keys it by the lower layer's id). A
      // synthetic bridge below means the REAL column ENDED here (TD): no user
      // contact there, so no tie.
      const below = units[ui + 1]
      if (below !== undefined && !isSyntheticLayer(below.layerId) && !below.virtual) {
        for (const f of facingUnits) {
          if (isSyntheticLayer(f.layerId)) continue
          if (correlated(below.layerId, f.layerId)) {
            base.add(u.layerId)
            break
          }
        }
      }
    }
    for (const [k, v] of mixedTiedTopToBase) {
      if (facingIds.has(v)) top.add(k)
      if (facingIds.has(k)) base.add(v)
    }
    return { top, base }
  }
  // Tie-gesture mode is enabled by the PRIMARY per-gap loop only. The
  // substrate/bracket path keeps the legacy extraction so the deep-zone
  // carry-through behaviour is unchanged (its refinement is the rule-5
  // void-deferral work, tracked in the memory file).
  const leftTies = useTieGestures ? buildTieSets(leftUnits, rightUnits) : undefined
  const rightTies = useTieGestures ? buildTieSets(rightUnits, leftUnits) : undefined

  // -------------------------------------------------------------------------
  // Step 1: Edge-driven monotonic alignment (post-reduction units). An explicit
  // correlation edge bands a pair (at any elevation); geometric overlap is the
  // fallback fill tier for the matrix; never matches across lithology.
  // -------------------------------------------------------------------------
  const toMatchUnits = (units: readonly PartitionUnit[], surface: number): MatchUnit[] =>
    units.map((u) => ({
      formationId: u.formationId,
      layerId: u.layerId,
      topElev: surface - u.topDepthM,
      baseElev: surface - u.baseDepthM,
      // Carry the virtual flag so pairScore can zero-out virtual units: they must
      // not form matched pairs (see MatchUnit.virtual).
      ...(u.virtual ? { virtual: true as const } : {}),
    }))
  const matchedPairs = matchColumns(
    toMatchUnits(leftUnits, leftSurface),
    toMatchUnits(rightUnits, rightSurface),
    correlated,
    baseTied,
  )

  const leftMatched = new Set(matchedPairs.map(([li]) => li))
  const rightMatched = new Set(matchedPairs.map(([, ri]) => ri))

  // -------------------------------------------------------------------------
  // Step 2: Walk the matched pairs, collecting interval groups.
  //
  // Each "interval" is defined by its top and base interface:
  //   - top = previous quad's baseIface (or the surface interface).
  //   - base = next quad's topIface (or the floor interface).
  //
  // Within each interval we collect all unmatched left and right units, then
  // call emitInterval to tile them side-by-side.
  // -------------------------------------------------------------------------
  const leftTop = leftUnits[0].topDepthM
  const rightTop = rightUnits.length > 0 ? rightUnits[0].topDepthM : leftTop
  const leftFloor = leftUnits[leftUnits.length - 1].baseDepthM
  const rightFloor = rightUnits.length > 0 ? rightUnits[rightUnits.length - 1].baseDepthM : leftFloor

  const surfaceIface: Interface = { leftDepth: leftTop, rightDepth: rightTop }
  const floorIface: Interface = { leftDepth: leftFloor, rightDepth: rightFloor }

  const regions: PartitionRegion[] = []

  // Onlaps collected during the walk, emitted AFTER the main regions (they
  // overlay the connected matrix band, like lenses). Each carries the interval
  // interfaces it laps against, snapshotted because ``prevQuadBase`` is reused.
  const intervalOnlaps: Array<{
    unit: PinchUnit
    edge: 'top' | 'base'
    topIface: Interface
    baseIface: Interface
  }> = []

  // prevQuadBase: the base interface of the most recently emitted quad (or the
  // surface interface before any quads).
  let prevQuadBase: Interface = surfaceIface
  // Identity of the most recently emitted quad (the matrix ABOVE the next
  // interval) — fed to emitLoneInteriorPinch so the above-matrix extension is
  // coloured correctly (Slice 1).
  let prevQuadFormationId: string | null = null
  let prevQuadBodyId: string | null = null

  // Also track the left and right unit cursors so we can collect unmatched units.
  // For each inter-quad gap, unmatched left units are those between the previous
  // match's left index and the next match's left index (exclusive, left-unmatched),
  // and similarly for right.
  let prevMatchLi = -1 // last matched left index (-1 = before first)
  let prevMatchRi = -1 // last matched right index

  for (let pairIdx = 0; pairIdx <= matchedPairs.length; pairIdx++) {
    const isFloor = pairIdx === matchedPairs.length
    const nextMatchLi = isFloor ? leftUnits.length : matchedPairs[pairIdx][0]
    const nextMatchRi = isFloor ? rightUnits.length : matchedPairs[pairIdx][1]

    // Collect unmatched units in this interval, per column.
    const leftStack: PinchUnit[] = []
    for (let li = prevMatchLi + 1; li < nextMatchLi; li++) {
      if (leftMatched.has(li)) continue
      const lu = leftUnits[li]
      leftStack.push({
        bodyId: lu.bodyId,
        formationId: lu.formationId,
        layerId: lu.layerId,
        side: 'left',
        ownTopDepth: lu.topDepthM,
        ownBaseDepth: lu.baseDepthM,
      })
    }
    const rightStack: PinchUnit[] = []
    for (let ri = prevMatchRi + 1; ri < nextMatchRi; ri++) {
      if (rightMatched.has(ri)) continue
      const ru = rightUnits[ri]
      rightStack.push({
        bodyId: ru.bodyId,
        formationId: ru.formationId,
        layerId: ru.layerId,
        side: 'right',
        ownTopDepth: ru.topDepthM,
        ownBaseDepth: ru.baseDepthM,
      })
    }

    // Interval interfaces + bracket matrices — computed BEFORE extraction so an
    // onlap can be anchored on the bracket interface it laps against.
    let intervalBase: Interface
    if (isFloor) {
      intervalBase = clampIface(floorIface, prevQuadBase)
    } else {
      const [mli, mri] = matchedPairs[pairIdx]
      intervalBase = clampIface(
        { leftDepth: leftUnits[mli].topDepthM, rightDepth: rightUnits[mri].topDepthM },
        prevQuadBase,
      )
    }
    const intervalTop = prevQuadBase
    const hasAbove = prevMatchLi >= 0 && prevQuadFormationId !== null
    const aboveMatrix = hasAbove
      ? { formationId: prevQuadFormationId!, bodyId: prevQuadBodyId }
      : null
    let belowMatrix: { formationId: string; bodyId: string | null } | null = null
    // Whether the below matched pair carries an explicit user correlation/base-tie
    // (a tagged band). A tagged band must not RISE into a surface interval — the
    // surface fill uses the overlying pinch material instead (owner directive
    // 2026-07-09). Only meaningful when ``above`` is null (surface interval); a
    // deeper interval always has an above matrix so the ``below``-rise never fires.
    let belowIsTiedBand = false
    if (!isFloor) {
      const [mli, mri] = matchedPairs[pairIdx]
      const u = leftUnits[mli]
      belowMatrix = { formationId: u.formationId, bodyId: u.bodyId }
      belowIsTiedBand =
        correlated(u.layerId, rightUnits[mri].layerId) ||
        (baseTied?.(u.layerId, rightUnits[mri].layerId) ?? false)
    }

    // Interval-scoped minority extraction: pull lenses (enclosed by the matrix)
    // and onlaps (touching one bracket) so the matrix reduces to one unit per
    // column and connects across as a band (the reduced stacks feed
    // emitInterval). Lenses append after the main regions (horizontal apex);
    // onlaps are collected with their interfaces and emitted after the main
    // regions too — both overlay the connected matrix band.
    for (const min of extractIntervalMinorities(
      leftStack,
      rightStack,
      aboveMatrix?.formationId ?? null,
      belowMatrix?.formationId ?? null,
      extractLeftTD,
      extractRightTD,
      mixedTiedLayerIds,
      leftTies,
      rightTies,
    )) {
      if (min.kind === 'lens') {
        ;(min.unit.side === 'left' ? leftLenses : rightLenses).push({
          bodyId: min.unit.bodyId,
          formationId: min.unit.formationId,
          depthTopM: min.unit.ownTopDepth,
          depthBaseM: min.unit.ownBaseDepth,
        })
      } else {
        intervalOnlaps.push({
          unit: min.unit,
          edge: min.edge!,
          topIface: { ...intervalTop },
          baseIface: { ...intervalBase },
        })
      }
    }

    const pinches: PinchUnit[] = [...leftStack, ...rightStack]

    // Emit one run of pinch units that share a single [top, base] sub-interval.
    // One-sided (all on the same column) → a single-apex matrix close; otherwise
    // the thickness-weighted meeting fraction. Mirrors the generic interval path
    // so the depth-ordered floor walk below reuses the same geometry per run.
    const emitPinchRun = (
      pool: PinchUnit[],
      top: Interface,
      base: Interface,
      above: { formationId: string; bodyId: string | null } | null,
      below: { formationId: string; bodyId: string | null } | null,
      belowIsTiedBand = false,
    ): void => {
      if (pool.length === 0) return
      const sides = new Set(pool.map((p) => p.side))
      const one = sides.size === 1 ? pool[0].side : null
      if (one !== null && (above || below)) {
        regions.push(
          ...emitOneSidedPinch(
            pool,
            one,
            top,
            base,
            above,
            below,
            leftSurface,
            rightSurface,
            INTERIOR_PINCH_FRACTION,
            capElev,
            belowIsTiedBand,
          ),
        )
      } else {
        const bracketed = above !== null && below !== null
        regions.push(...emitInterval(pool, top, base, leftSurface, rightSurface, bracketed))
      }
    }

    let pinchPool = pinches
    // The interval top + above-matrix the FINAL (trailing) pinch run uses. The
    // floor walk advances these past each band; non-floor intervals leave them
    // at the interval's own values.
    let finalTop = intervalTop
    let finalAbove = aboveMatrix
    if (isFloor) {
      // Too-shallow carry-through: a unit whose TOP is at/below the shallower
      // column's deepest data lies entirely below the facing column's data. The
      // facing column is a DATA VOID there, so the band-vs-lens call DEFERS PAST
      // it to the nearest REACHING neighbour on the unit's pinch-out side (owner
      // directive 2026-06-16: band/lens follows correlation EVERYWHERE — the
      // carry-through used to band these correlation-blind, the design flaw).
      //
      //   - CORRELATED to the nearest reaching neighbour on its pinch side →
      //     BAND (a flat full-gap-width band at its OWN elevations: it is
      //     genuinely continuous, the deep column governs, and the shallow column
      //     has no data to interpolate against);
      //   - 0 correlations toward a REACHING neighbour (the neighbour saw that
      //     depth and logs an uncorrelated lithology) → PINCH OUT: the unit stays
      //     a pinch (the enclosing matrix floods), exactly like an interior
      //     0-corr lens;
      //   - NO reaching neighbour on that side (a DATA VOID — no column ever
      //     observed that depth) → SIDEWAYS (spec §5 rule 1): the unit continues
      //     FLAT at its own elevation under the shallow neighbour. NOT a pinch —
      //     there is no observed evidence for a geological termination, so it is
      //     emitted as a full-width quad, never a tapering triangle.
      //
      // A unit on the LEFT (deep) column pinches toward the RIGHT, so it reads
      // ``rightwardColumns``; a unit on the RIGHT column reads ``leftwardColumns``.
      //
      // GEOMETRY: bands + pinches in the floor interval can INTERLEAVE in depth
      // (a banded ZAND above an uncorrelated SILT pinch above a banded KLEI). A
      // single shared interval would let the SILT pinch's apex shoot up into the
      // ZAND band (a real CS1 gap-22 overlap). So the floor interval is walked in
      // DEPTH ORDER on the deep column: each band emits a full-width flat quad,
      // and each maximal run of consecutive pinches between two bands (or the
      // interval edges) is emitted in its OWN sub-interval bounded by those bands.
      const shallowFloor = Math.min(leftFloor, rightFloor)
      // For a mixed-tied unit, resolve the elevation the tie reaches on the facing
      // column: the base-side layerId from ``mixedTiedTopToBase`` identifies the
      // shallow unit whose baseDepthM (converted to elevation) is the TD the deep
      // unit's top should rise toward (spec §5 rule 2). Returns null when the unit
      // has no mixed tie that applies to THIS gap.
      //
      // APPLY-IN-GAP rule (Defect 2 fix, 2026-06-19): a mixed tie applies in a gap
      // iff EITHER the base-side target IS the facing column (unambiguous) OR the
      // target is beyond the facing column but the facing column REACHES the unit
      // (genuine-pinch override — spec §5 rule 2 "tie always overrides geometry").
      // When the facing column is a DATA VOID (too shallow to reach the unit), the
      // tie does NOT apply in that intervening gap: the unit continues sideways at
      // its own elevation.
      //
      // WHY: real CS1 — tie is B2-ZAND ↔ S7-CLAY-base; columns [B2, S7A, S7].
      // S7A is between B2 and S7 and is a DATA VOID (TD +10.42, never saw the sand).
      // The section-wide lookup returned S7's TD and applied it in the B2→S7A gap,
      // dragging the SAND top to +10.42 where S7A never drilled → bogus fill + GAP.
      // The T-MIXED-OVER-PINCH test has MIDDLE reaching the sand (genuine pinch) and
      // the tie correctly overrides it; that case is preserved.
      const mixedTiedTopElev = (
        topLayerId: string,
        facingUnits: readonly PartitionUnit[],
        facingSurface: number,
        unitTopDepth: number,
      ): number | null => {
        const baseLayerId = mixedTiedTopToBase.get(topLayerId)
        if (baseLayerId === undefined) return null
        // Case 1: the tied base-side unit IS on the facing column.  Always apply.
        const tiedUnit = facingUnits.find((u) => u.layerId === baseLayerId)
        if (tiedUnit !== undefined) {
          // Prefer the pre-gap original (immune to closeColumnGaps mutations).
          return layerBaseElevLookup.get(baseLayerId) ?? (facingSurface - tiedUnit.baseDepthM)
        }
        // Case 2: the tied unit is NOT on the facing column (non-adjacent target).
        // Apply only when the facing column REACHES the unit (genuine-pinch context).
        // When the facing column is a DATA VOID (too shallow), do NOT apply — the
        // unit continues sideways in this intervening gap.
        const facingTD = columnTotalDepth(facingUnits)
        if (!neighbourReaches(facingTD, unitTopDepth)) return null
        // Facing column reaches — apply the tie using the section-wide lookup.
        const elev = layerBaseElevLookup.get(baseLayerId)
        return elev ?? null
      }

      type FloorItem = {
        unit: PinchUnit
        band: boolean
        sideways: boolean
        /** Non-null when a mixed top↔base tie names this unit's top toward the facing
         *  side: the tied test's TD elevation (spec §5 rule 2).  Overrides both the
         *  flat-sideways default AND a genuine pinch-out (a reaching uncorrelated
         *  neighbour).  Priority order: band > mixed-tie > sideways > genuine-pinch
         *  (a top↔top band is the more specific correlation; contradictory authoring
         *  toward the same facing side resolves to the band). */
        mixedTiedFacingTopElev: number | null
      }
      const items: FloorItem[] = pinches.map((p) => {
        if (p.ownTopDepth < shallowFloor - EPS) {
          // Unit starts ABOVE the shallowFloor: straddles the shallow column's
          // last data point.  The band-vs-sideways-vs-pinch decision is IDENTICAL
          // to the non-straddle path — a straddle is simply a unit whose top
          // happens to be above the shallow floor; it still needs the same
          // correlation + reach check to decide whether it bands, continues flat,
          // or genuinely pinches out.  Hard-coding band:false, sideways:false was
          // wrong: it always forced a tapering pinch that left a void below the
          // shallow TD on the facing side.
          const pinchSideColumnsEarly = p.side === 'left' ? rightwardColumns : leftwardColumns
          const bandEarly = bandsTowardSide(p.layerId, p.ownTopDepth, pinchSideColumnsEarly, correlated)
          // For a straddle unit the top is ABOVE the shallow floor so
          // neighbourReaches(td, ownTopDepth) would be true even when no facing
          // column reaches the PART of the unit that is BELOW the floor.  Use the
          // unit's OWN BASE depth as the threshold: if the facing column doesn't
          // reach the unit's base, it has no data for the DEEPER portion of the
          // straddle → DATA VOID for that portion → the unit continues flat
          // (sideways), not a genuine pinch.  When the facing column DOES reach the
          // base it saw the full unit and can disprove its presence → genuine pinch.
          const facingTDEarly = pinchSideColumnsEarly[0]?.td ?? -Infinity
          const sidewaysEarly = !bandEarly && !neighbourReaches(facingTDEarly, p.ownBaseDepth)
          const facingUnitsEarly = p.side === 'left' ? rightUnits : leftUnits
          const facingSurfaceEarly = p.side === 'left' ? rightSurface : leftSurface
          const mixedFacingTopEarly = bandEarly
            ? null
            : mixedTiedTopElev(p.layerId, facingUnitsEarly, facingSurfaceEarly, p.ownTopDepth)
          return {
            unit: p,
            band: bandEarly,
            sideways: sidewaysEarly,
            mixedTiedFacingTopElev: mixedFacingTopEarly,
          }
        }
        const pinchSideColumns = p.side === 'left' ? rightwardColumns : leftwardColumns
        const band = bandsTowardSide(p.layerId, p.ownTopDepth, pinchSideColumns, correlated)
        // Sideways default (spec §5 rule 1, revised 2026-06-18): when the unit is NOT
        // correlated AND the IMMEDIATE facing neighbour (the gap's adjacent column,
        // ``pinchSideColumns[0]``) does NOT reach the unit's depth, the unit continues
        // FLAT at its own elevation under that shallow neighbour — it is a data void,
        // not a geological termination.
        //
        // Gate on the IMMEDIATE neighbour only, NOT the whole carry-through list.
        // A distant reaching column (e.g. S6 past a shallow S7a) cannot pin a
        // pinch-out at S7a — S7a never observed that depth, so the missing
        // correlation at S7a is a data void. Only the column the gap is actually
        // BETWEEN is the arbiter of "reached or not reached" for that gap.
        //
        // Genuine pinch: the immediate neighbour REACHES the unit (drilled past it)
        // but logs uncorrelated lithology → the neighbour disproves the unit there;
        // ``bandsTowardSide`` already returned false for lack of a correlation edge,
        // and here ``neighbourReaches`` is true → ``sideways=false`` → genuine pinch.
        const sideways =
          !band && !neighbourReaches(pinchSideColumns[0]?.td ?? -Infinity, p.ownTopDepth)
        // Mixed-tie override (spec §5 rule 2): a top↔base edge is the engineer's
        // explicit "this unit reaches here" declaration. It overrides geometry
        // unconditionally — including when the unit is a genuine pinch (a reaching,
        // uncorrelated neighbour exists on the facing side). The previous gate on
        // `sideways` blocked the override for genuine pinches; dropped per spec:
        // "a correlation tie ALWAYS overrides geometry — no proximity guard."
        // Priority: band (top↔top correlation) > mixed-tie > sideways > genuine-pinch.
        // When both a band AND a mixed tie point at the same facing column the band wins
        // (top↔top alignment is a more specific instruction; contradictory authoring).
        const facingUnits = p.side === 'left' ? rightUnits : leftUnits
        const facingSurface = p.side === 'left' ? rightSurface : leftSurface
        const mixedFacingTop = band ? null : mixedTiedTopElev(p.layerId, facingUnits, facingSurface, p.ownTopDepth)
        return { unit: p, band, sideways, mixedTiedFacingTopElev: mixedFacingTop }
      })
      // Depth order on the deep column (the carry side). Pinch units that sit on
      // the SHALLOW side (above the shallow floor) keep their own order; their
      // own depth still orders them correctly relative to the deep stack.
      items.sort((a, b) => a.unit.ownTopDepth - b.unit.ownTopDepth)

      // Walk top→bottom: a band closes the current pinch run (emitting it in the
      // sub-interval between the previous band's base and this band's top), then
      // emits its own full-width quad. A trailing pinch run closes to the floor.
      let runTop: Interface = intervalTop
      let runAbove = aboveMatrix
      let pendingPinches: PinchUnit[] = []
      const elevToIface = (elev: number): Interface => ({
        leftDepth: leftSurface - elev,
        rightDepth: rightSurface - elev,
      })
      for (const it of items) {
        // A mixed-tie override emits a rising quad (spec §5 rule 2) even when the
        // unit is a genuine pinch (band=false, sideways=false). Fall through to the
        // quad-emission path whenever mixedTiedFacingTopElev is non-null.
        if (!it.band && !it.sideways && it.mixedTiedFacingTopElev === null) {
          // 2/1/0 tie model: a STRADDLE unit with 0 ties toward the facing column
          // is a LENS at its own elevation. The facing column reached the unit's
          // depth and observed a different (or absent) lithology — the engineer's
          // decision NOT to correlate here is a positive geological statement, not
          // a data void. Emit directly to the lens list; do NOT go through
          // pendingPinches / emitInterval which would produce a degenerate triangle
          // reaching the wrong column edge (gap-7 S8 SAND/SILT dogfeed 2026-07-07).
          // Restriction: straddle zone only (ownTopDepth < shallowFloor) — deep
          // units are data-void sideways, handled above. Synthetic bridge units
          // carry matrix continuity, not user gestures; never pull them as lenses.
          const p = it.unit
          if (
            useTieGestures &&
            // 0-tie → lens redirect (owner 2/1/0 model, locked 2026-07-07).
            p.ownTopDepth < shallowFloor - EPS &&
            !isSyntheticLayer(p.layerId)
          ) {
            const ties = p.side === 'left' ? leftTies : rightTies
            if (ties !== undefined && !ties.top.has(p.layerId) && !ties.base.has(p.layerId)) {
              ;(p.side === 'left' ? leftLenses : rightLenses).push({
                bodyId: p.bodyId,
                formationId: p.formationId,
                depthTopM: p.ownTopDepth,
                depthBaseM: p.ownBaseDepth,
              })
              continue
            }
          }
          pendingPinches.push(it.unit)
          continue
        }
        const p = it.unit
        const deepSurface = p.side === 'left' ? leftSurface : rightSurface
        const bandTopElev = deepSurface - p.ownTopDepth
        const bandBaseElev = deepSurface - p.ownBaseDepth
        // Close the pending pinch run in [runTop, this band's top].
        if (pendingPinches.length > 0) {
          const runBase = clampIface(elevToIface(bandTopElev), runTop)
          // ``below`` is the matrix the pinch run rests ON. Only a genuine BAND
          // (a real, data-backed continuous unit) supplies a below-matrix; a
          // SIDEWAYS continuation is a data void carrying no matrix context, so it
          // must pass ``null``. Passing the sideways unit's formationId here would
          // let ``emitOneSidedPinch``'s ``isLens`` (above.formationId ===
          // below.formationId) fire spuriously when the sideways unit happens to
          // match the matrix above — a boundary pinch would get a horizontal
          // enclosed-lens apex instead (BLOCKER 2).
          //
          // STRADDLE GUARD (BLOCKER-3): when ALL pending pinches are straddle units
          // (ownTopDepth < shallowFloor) the deep column's sideways rectangle already
          // covers the straddle zone at full width.  Supplying a ``below`` context from
          // a band that arrives BELOW the straddle zone would cause ``emitOneSidedPinch``
          // to produce a triangle whose apex sits inside that rectangle → overlap.
          // Pass ``null`` unconditionally for all-straddle runs; a straddle genuine
          // pinch has no below-matrix context (the shallow column has no data there).
          const allStraddle = pendingPinches.every((pp) => pp.ownTopDepth < shallowFloor - EPS)
          emitPinchRun(
            pendingPinches,
            runTop,
            runBase,
            runAbove,
            it.band && !allStraddle ? { formationId: p.formationId, bodyId: p.bodyId } : null,
          )
          pendingPinches = []
          // After flushing a straddle-only pinch run, advance runTop to runBase so
          // the subsequent sideways unit's facingRunTopElev is bounded by the
          // straddle zone's base elevation.  The closing triangle from
          // emitOneSidedPinch already covers [runTop … runBase] at full width on the
          // straddle side; the next sideways quad must NOT raise its facing corner
          // above runBase → Math.max(bandTopElev, facingRunTopElev) then returns
          // bandTopElev (flat), preventing the overlap.
          //
          // Non-straddle flushes must NOT update runTop here: a Case-B sideways
          // unit that follows a non-straddle flush needs the original intervalTop
          // facingDepth to fill the void left by the slanted matched-pair base.
          if (allStraddle) runTop = runBase
        }
        // Determine the top elevation on the facing side for this unit.
        // - Genuine BAND: flat at the unit's own top elevation.
        // - SIDEWAYS (data-void continuation): the facing side's top is clamped to
        //   ``runTop.facingDepth``.  A sideways unit continues flat at its own
        //   depth on the deep side, but on the facing (shallow-data) side the
        //   previous quad's slanted base may end DEEPER than the unit's flat top —
        //   leaving a gap in the partition.  Using ``runTop`` on the facing side
        //   makes the sideways quad's top-facing-corner abut the previous slanted
        //   base exactly, preserving the tiling invariant.
        //   Example: CLAY(0-2)↔CLAY(0-4) produces a slanted base {leftDepth:2,
        //   rightDepth:4}; the SAND sideways below (ownTopDepth=2) would have
        //   topRight at -2 (flat) while the CLAY base on the right is at -4 →
        //   gap from -4 to -2 at the right edge.  With the clamp: topRight = -4.
        // - Mixed-tied (spec §5 rule 2): the tied test's TD elevation — the top
        //   RISES to meet the explicitly declared "the unit reaches here" point.
        //   The BASE remains at bandBaseElev — the unit CONTINUES below the tie
        //   line (it does not collapse to a point).  This preserves the partition
        //   invariant: the space below the tie line is covered by this unit, so
        //   consecutive tied units each fill their portion instead of leaving a
        //   gap between their apexes.  (The old code set facingBaseElev to the TD
        //   as well, collapsing both corners to one apex → triangle → GAP.)
        const quadLeft = p.side === 'left'
        const runTopFacingDepth = quadLeft ? runTop.rightDepth : runTop.leftDepth
        const facingRunTopElev = quadLeft
          ? rightSurface - runTopFacingDepth
          : leftSurface - runTopFacingDepth
        // Facing-side top elevation for band and sideways units.
        //
        // The OWN-side top is always flat at ``bandTopElev``.  The FACING side clamps
        // to ``runTop`` (the previous quad's slanted base).  When the slanted base
        // sits ABOVE the unit's own top (``facingRunTopElev > bandTopElev``), a
        // triangular void would open between the slanted base and the flat unit top on
        // the facing side.  That void is filled by a separate fill-triangle region
        // of the matched band's formation (emitted just below, before the unit's own
        // quad).  The unit itself therefore always stays FLAT on the facing side —
        // ``Math.min`` ensures no climb, regardless of the slant direction.
        //
        //   SW-1 (no climb, data void above): CLAY(0-2m)↔CLAY(0-2.65m) where
        //   2.65m = rightTD.  SAND below should NOT climb to +10.35.  The void
        //   [4.2, 10.35] at the right edge is data-void (below shallow-column TD)
        //   and is filled by a CLAY fill-triangle, not by the SAND rising.
        //
        //   GAP-22 (no climb, geometric void): b60f2e06 pair base {left=4.14m,
        //   right=6.221m} leaves a triangular gap at f=0.  0a38d1bc stays flat at
        //   6.739; the fill-triangle of b60f2e06 covers [6.739, 8.920] at f=0.
        const facingTopElev =
          it.mixedTiedFacingTopElev !== null
            ? it.mixedTiedFacingTopElev
            : Math.min(bandTopElev, facingRunTopElev)
        // Fill-triangle: when the previous matched pair's base is slanted AND its
        // facing-side corner is above this unit's flat top (``facingRunTopElev >
        // bandTopElev + EPS``), a triangular void sits between the slanted base and
        // the unit's flat top.  Emit a region of the matched band's formation
        // (``runAbove``) to plug it before the unit's own quad.  The triangle has:
        //   — own side (f=0 or 1): a single point at bandTopElev (no void there)
        //   — facing side: two vertices spanning [bandTopElev, facingRunTopElev]
        // This keeps the unit itself flat while still producing a gapless partition.
        // Mixed-tied units already raise their facing top to the tie elevation, so
        // they never leave a void of this kind — skip the fill for them.
        if (
          it.mixedTiedFacingTopElev === null &&
          facingRunTopElev > bandTopElev + EPS &&
          runAbove !== null
        ) {
          const ownFrac = quadLeft ? 0 : 1
          const facingFrac = quadLeft ? 1 : 0
          // Three vertices: own-side point + two facing-side points (bottom, top).
          // One of the two facing-side points coincides with the own-side point
          // at the lower elevation, so the degenerate-corner filter below would
          // collapse it to a triangle automatically — but we build it explicitly
          // as a triangle here to make the intent clear.
          const fillPolygon: PartitionPoint[] = [
            { fraction: ownFrac, elevation: bandTopElev },
            { fraction: facingFrac, elevation: bandTopElev },
            { fraction: facingFrac, elevation: facingRunTopElev },
          ]
          regions.push({
            formationId: runAbove.formationId,
            bodyId: runAbove.bodyId,
            kind: 'quad',
            polygon: fillPolygon,
          })
        }
        // The base on the facing side is always flat at the unit's own base —
        // whether band, sideways, or mixed-tied.  A mixed tie only shapes the TOP.
        const facingBaseElev = bandBaseElev
        // Build the quad polygon.  For a mixed-tied unit the TOP facing-side corner
        // rises to the TD while the BASE facing-side corner is flat — a trapezoid
        // (rising-top quad), not a triangle.  For a flat sideways unit the top is
        // also a slanted line (facing side clamped to ``runTop``), while the base
        // remains flat.  The degenerate-corner collapse below still fires when
        // topLeft===baseLeft or topRight===baseRight (e.g. the deepest-unit case),
        // but a mixed-tie or sideways-clamp no longer triggers it.
        const topLeft: PartitionPoint = {
          fraction: 0,
          elevation: quadLeft ? bandTopElev : facingTopElev,
        }
        const topRight: PartitionPoint = {
          fraction: 1,
          elevation: quadLeft ? facingTopElev : bandTopElev,
        }
        const baseRight: PartitionPoint = {
          fraction: 1,
          elevation: quadLeft ? facingBaseElev : bandBaseElev,
        }
        const baseLeft: PartitionPoint = {
          fraction: 0,
          elevation: quadLeft ? bandBaseElev : facingBaseElev,
        }
        // Emit at most 4 corners; collapse any corner coincident with its ring
        // neighbour — a mixed-tie triangle collapses two adjacent corners to the
        // single TD point (left-side deep: topRight===baseRight, an interior pair;
        // right-side deep: topLeft===baseLeft, the closing wrap pair). A flat band /
        // sideways unit keeps all four distinct corners. Coincident means same point
        // (fraction AND elevation), not merely same elevation — a flat band's
        // baseLeft/baseRight share an elevation but differ in fraction.
        const coincident = (a: PartitionPoint, b: PartitionPoint): boolean =>
          a.fraction === b.fraction && Math.abs(a.elevation - b.elevation) <= EPS
        const ring = [topLeft, topRight, baseRight, baseLeft]
        const polygon: PartitionPoint[] = ring.filter(
          (pt, i) => !coincident(pt, ring[(i + ring.length - 1) % ring.length]),
        )
        // A mixed-tied region (its top RISES to an on-section top↔base tie point) is
        // an EXPLICIT engineer correlation the same as a top↔top band pair — it must
        // NOT be chopped by the gap's shallow-TD cap when a spanning gap clips its
        // emitGap output. Tag it with ``tiedBandBase`` = its own base elevation so the
        // ``computeSectionFill`` clip loop keeps it whole down to its base AND registers
        // it in ``exemptBandsByGap`` (so the redundant spanning sliver of the same unit
        // is carved around it). Without this, gap 8's S10 mid-clay — emitted here via
        // the S8-silt-base↔S10-clay-top tie — is discarded by the cap into a void that
        // no spanning band covers (its band correlation is to off-section B9). The base
        // is the polygon's deepest point, so keeping ABOVE it keeps the whole region.
        regions.push({
          formationId: p.formationId,
          bodyId: p.bodyId,
          kind: 'quad',
          polygon,
          tiedBandBase: it.mixedTiedFacingTopElev !== null ? bandBaseElev : undefined,
        })
        runTop = clampIface(elevToIface(bandBaseElev), runTop)
        // Advance the above-matrix cursor ONLY past a genuine BAND — a band is a
        // real, data-backed continuous unit that the deeper pinches legitimately
        // rest under. A SIDEWAYS continuation is a data void (no facing column
        // reached it); it carries no matrix context, so letting it become
        // ``runAbove`` would mislabel a deeper genuine pinch's closing region with
        // the sideways unit's formation (BLOCKER 1). Emit the sideways quad above
        // but leave ``runAbove`` at its previous (real-band) value.
        if (it.band) {
          runAbove = { formationId: p.formationId, bodyId: p.bodyId }
        }
      }
      // Trailing pinch run (below the deepest band, or the whole floor when there
      // is no band) closes down to the floor via the generic path below, using
      // the run cursor advanced past the deepest band.
      pinchPool = pendingPinches
      finalTop = runTop
      finalAbove = runAbove
    }

    emitPinchRun(pinchPool, finalTop, intervalBase, finalAbove, belowMatrix, belowIsTiedBand)

    // Emit the quad (if not the floor sentinel).
    if (!isFloor) {
      const [mli, mri] = matchedPairs[pairIdx]
      const lu = leftUnits[mli]
      const ru = rightUnits[mri]
      const quadTop = clampIface(
        { leftDepth: lu.topDepthM, rightDepth: ru.topDepthM },
        prevQuadBase,
      )
      // Sub-shallow-TD flat-tail (the systematic bottom-void fix, owner 2026-06-20
      // "color between the lines"). When the DEEP side of a matched band dips BELOW
      // the SHALLOW column's floor elevation, a straight band base would slant into
      // the shallow side's DATA VOID, leaving a triangular hole below it down to the
      // bottom-tie envelope (the void seen below every shallow test). Instead: end
      // the band FLAT at the shallower base, then lay the deep unit's tail FLAT
      // full-width from there down to its own base — the deep stratigraphy continues
      // flat under the shallow column. Triggers ONLY for the bottom-most slanted
      // band (an interior pair's deep base never sits below the shallow floor under a
      // monotonic match), so interior dips are untouched.
      const shallowFloorElevHere = Math.max(
        leftSurface - leftFloor,
        rightSurface - rightFloor,
      )
      const leftBaseE = leftSurface - lu.baseDepthM
      const rightBaseE = rightSurface - ru.baseDepthM
      const deepBaseE = Math.min(leftBaseE, rightBaseE)
      const shallowBaseE = Math.max(leftBaseE, rightBaseE)
      // The SHALLOW side's matched unit must be its column's DEEPEST: only then is
      // the space below it a pure data void to flat-fill. When the shallow column
      // has unmatched units deeper than this matched unit, the floor walk fills that
      // space — a full-width tail would double-cover it (GAP-8/16/17 overlaps).
      const deepIsLeft = leftBaseE < rightBaseE
      const shallowMatchedIsDeepest = deepIsLeft
        ? mri === rightUnits.length - 1
        : mli === leftUnits.length - 1
      // The DEEP side's matched unit must ALSO be its column's deepest: when the
      // deep column has unmatched units BELOW this one, the floor walk lays those
      // flat and a tail here double-covers them (GAP-8/16/17 — gaps that had no
      // void at all; the floor walk already handled them). Requiring BOTH sides'
      // matched units to be deepest confines the fix to the bottom-most pair where
      // the deep column genuinely terminates and the shallow side is a pure void.
      const deepMatchedIsDeepest = deepIsLeft
        ? mli === leftUnits.length - 1
        : mri === rightUnits.length - 1
      if (
        deepBaseE < shallowFloorElevHere - EPS &&
        shallowBaseE - deepBaseE > EPS &&
        shallowMatchedIsDeepest &&
        deepMatchedIsDeepest
      ) {
        // Band: flat at the shallower base.
        const flatBase = clampIface(
          { leftDepth: leftSurface - shallowBaseE, rightDepth: rightSurface - shallowBaseE },
          quadTop,
        )
        if (flatBase.leftDepth - quadTop.leftDepth >= EPS || flatBase.rightDepth - quadTop.rightDepth >= EPS) {
          regions.push({
            formationId: lu.formationId,
            bodyId: lu.bodyId,
            kind: 'quad',
            polygon: buildQuadPolygon(quadTop, flatBase, leftSurface, rightSurface),
          })
        }
        // Deep tail: flat full-width from the shallow base down to the deep base.
        const deepUnit = deepIsLeft ? lu : ru
        const tailBase = {
          leftDepth: leftSurface - deepBaseE,
          rightDepth: rightSurface - deepBaseE,
        }
        regions.push({
          formationId: deepUnit.formationId,
          bodyId: deepUnit.bodyId,
          kind: 'quad',
          polygon: buildQuadPolygon(flatBase, tailBase, leftSurface, rightSurface),
        })
        prevQuadBase = tailBase
        prevQuadFormationId = deepUnit.formationId
        prevQuadBodyId = deepUnit.bodyId
      } else {
        const quadBase = clampIface(
          { leftDepth: lu.baseDepthM, rightDepth: ru.baseDepthM },
          quadTop,
        )
        const leftH = quadBase.leftDepth - quadTop.leftDepth
        const rightH = quadBase.rightDepth - quadTop.rightDepth
        if (leftH >= EPS || rightH >= EPS) {
          // A user correlation is absolute: when this matched pair carries an
          // explicit edge (correlation or base-tie) AND its base dips below the
          // gap's shallow-TD cap, tag it so the cap keeps it whole down to its own
          // base and the substrate is carved around it (owner directive 2026-07-08).
          // Tag ONLY a band both columns genuinely OBSERVE — a real user
          // correlation. A synthetic bridge/gapfill unit (a jump tie injected across
          // a shallow test that lies BETWEEN two correlated deep tests, e.g. the
          // S11↔S10 sand/silt over the shallow S8) is an AUTOFILL, not a per-gap
          // observation: exempting it keeps a mis-shaped pinch-triangle toward the
          // shallow column's data void. Leaving it un-tagged caps it at the shallow
          // TD so the deep-to-deep substrate bridges it straight across UNDER the
          // shallow test (owner directive 2026-07-09: user correlations > autofills —
          // the real correlation is honoured by the substrate bridge, not the
          // per-gap injection artifact).
          const isCorrBand =
            (correlated(lu.layerId, ru.layerId) || (baseTied?.(lu.layerId, ru.layerId) ?? false)) &&
            !isSyntheticLayer(lu.layerId) &&
            !isSyntheticLayer(ru.layerId)
          // Keep the band down to the OBSERVED-DEEPER column's matched-unit base —
          // NOT min(lu,ru) base: the bridge/floor injection can extend the SHALLOW
          // column's TD unit far below its real base (a jump-tie artifact), which
          // would drag the tied base into interpolated space (case-4 S7A→4.65). The
          // observed-deeper column's unit carries the real tie contact.
          const obsDeepIsLeft = (observedLeftTD ?? leftFloor) > (observedRightTD ?? rightFloor)
          const tiedBase = obsDeepIsLeft ? leftBaseE : rightBaseE
          const tiedBandBase = isCorrBand && tiedBase < capElev - EPS ? tiedBase : undefined
          // For a tagged band, rebuild the base from OBSERVED depths (clamp each
          // side to its column's observed TD). Otherwise the injection's extension
          // of the shallow TD unit (S7A silt → depth of elev 4.65) slants the band
          // base into interpolated space; clipping it flat then leaves the base
          // below the shallow test's real base, inside the neighbouring clay
          // (GAP-17 case-3 overlap). The band must dip only between the two
          // OBSERVED contacts (S7A 10.42 → S7c 10.11).
          const bandBase =
            tiedBandBase !== undefined
              ? clampIface(
                  {
                    leftDepth: Math.min(lu.baseDepthM, observedLeftTD ?? lu.baseDepthM),
                    rightDepth: Math.min(ru.baseDepthM, observedRightTD ?? ru.baseDepthM),
                  },
                  quadTop,
                )
              : quadBase
          regions.push({
            formationId: lu.formationId,
            bodyId: lu.bodyId,
            kind: 'quad',
            polygon: buildQuadPolygon(quadTop, bandBase, leftSurface, rightSurface),
            ...(tiedBandBase !== undefined ? { tiedBandBase } : {}),
          })
          prevQuadBase = bandBase
          prevQuadFormationId = lu.formationId
          prevQuadBodyId = lu.bodyId
        } else {
          prevQuadBase = quadTop
        }
      }
      prevMatchLi = mli
      prevMatchRi = mri
    }
  }

  // -------------------------------------------------------------------------
  // Step 3a: Append onlap regions.
  //
  // An onlap laps against ONE bracket tie-line — anchored flat on its source
  // column, tapering to a tip on the bracket interface. It overlays the
  // connected matrix band (emitted as kind:'lens', excluded from the tiling
  // invariant), so it must come AFTER the main regions in array order.
  // -------------------------------------------------------------------------
  for (const onlap of intervalOnlaps) {
    regions.push({
      formationId: onlap.unit.formationId,
      bodyId: onlap.unit.bodyId,
      kind: 'lens',
      overlayTier: 'onlap',
      polygon: buildOnlapPolygon(
        onlap.unit,
        onlap.edge,
        onlap.topIface,
        onlap.baseIface,
        leftSurface,
        rightSurface,
      ),
    })
  }

  // -------------------------------------------------------------------------
  // Step 3: Append extracted lens regions.
  //
  // Each lens is a horizontal pinch-out triangle that overlays its enclosing
  // matrix quad.  The apex elevation is the lens's OWN mid-elevation so it
  // terminates at its own stratigraphic level (horizontal), not along the
  // dipping enclosing interfaces.  The overlay draws these on top of the main
  // regions (array order) so the lens colour is visible over the matrix.
  // These regions deliberately overlap their matrix and are excluded from the
  // tiling invariant.
  // -------------------------------------------------------------------------
  for (const lens of leftLenses) {
    const topElev = leftSurface - lens.depthTopM
    const baseElev = leftSurface - lens.depthBaseM
    const apex = lens.bodyId
      ? lensApexOverrides?.get(lensApexOverrideKey(lens.bodyId, gapIndex))
      : undefined
    regions.push({
      formationId: lens.formationId,
      bodyId: lens.bodyId,
      kind: 'lens',
      overlayTier: 'lens',
      polygon: buildLeftLensPolygon(topElev, baseElev, apex),
    })
  }
  for (const lens of rightLenses) {
    const topElev = rightSurface - lens.depthTopM
    const baseElev = rightSurface - lens.depthBaseM
    const apex = lens.bodyId
      ? lensApexOverrides?.get(lensApexOverrideKey(lens.bodyId, gapIndex))
      : undefined
    regions.push({
      formationId: lens.formationId,
      bodyId: lens.bodyId,
      kind: 'lens',
      overlayTier: 'lens',
      polygon: buildRightLensPolygon(topElev, baseElev, apex),
    })
  }

  // Subtract each lens/onlap overlay out of the matrix it sits in, so the gap is
  // a TRUE volumetric partition (every point in exactly one region) — required by
  // the 3D extraction, which assigns each CPT point to exactly one body.
  //
  // The deep-to-deep substrate band path defers this (``skipCarve``): its lenses
  // are re-anchored from band-fraction space into each destination gap AFTER the
  // band→gap slice (a band-space carve would bake the notch at the WRONG, scaled
  // gap fraction). The substrate loop carves each gap once the lens apex is final.
  if (!skipCarve) carveOverlays(regions)

  return regions
}

// ---------------------------------------------------------------------------
