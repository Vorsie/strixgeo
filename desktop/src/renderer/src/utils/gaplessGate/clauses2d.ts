/**
 * CLAUSES 1-3, PER SECTION — the 2-D half of the gapless gate that reads
 * straight off one section's own hierarchical fill.
 *
 * This module computes NOTHING new about whether the fill is correct — clause
 * 2 and clause 3 report exactly what ``edgeReach.ts`` and ``fillTotality.ts``
 * already found (re-deriving would give the report a second opinion that can
 * disagree with the engine). Clause 1 (area-conservation) IS new: nothing in
 * the engine asserts today that classed + unclassed cover equals the litho
 * cover it subdivides, so this module builds that comparison, per gap, from
 * three ``SectionRegion[]`` surfaces already in the same fraction-elevation
 * space (see ``partitionFill/regionArea.ts``).
 *
 * A section that ran no hierarchical fill at all (a litho build has no
 * geotech frame; a section can also simply have no matching litho frame) has
 * nothing for any of the three clauses to measure — ``not-evaluated``, never
 * a soft ``pass`` (see ``gaplessGate/types.ts``'s own doc on the distinction).
 *
 * TWO THINGS THIS MODULE OWES THE ENGINEER, both learned from a real report he
 * read on 2026-08-28:
 *
 *  1. **A magnitude he can act on.** See ``formatMeasure`` — a small genuine
 *     mismatch must not round to the word "0", because a guarantee reported
 *     broken by nothing is worse than silence.
 *  2. **Somewhere to go.** Every entry names the gap's own two COLUMNS, not
 *     just its index — see ``gapLocator`` and ``gap_investigation_ids`` in
 *     ``types.ts``. This is the only place in the app where the frame's column
 *     list and the gap index are in scope together, so it is the only place
 *     the pair can honestly be resolved.
 *
 * @module utils/gaplessGate/clauses2d
 */

import ArrayList from 'jsts/java/util/ArrayList.js'
import Coordinate from 'jsts/org/locationtech/jts/geom/Coordinate.js'
import GeometryFactory from 'jsts/org/locationtech/jts/geom/GeometryFactory.js'
import CascadedPolygonUnion from 'jsts/org/locationtech/jts/operation/union/CascadedPolygonUnion.js'
import OverlayOp from 'jsts/org/locationtech/jts/operation/overlay/OverlayOp.js'
import BufferOp from 'jsts/org/locationtech/jts/operation/buffer/BufferOp.js'

import { AREA_CONSERVATION_ABS_FLOOR_M2, AREA_CONSERVATION_REL_FRACTION } from './constants'
import type { GaplessClauseEntry, GaplessClauseKey, GaplessClauseStatus } from './types'
import type { HierarchicalGeotechFillResult } from '../geotechHierarchicalFill'
import type { SectionRegion } from '../sectionPartition'
import { SNAP_GRID_M } from '../partitionFillV2/types'

/** The three 2-D clause keys this module answers (clause 4 lives in ``sectionClosure.ts``). */
export type Clause2dKey = Extract<GaplessClauseKey, 'area-conservation' | 'edge-reach' | 'cause-closure'>

/** One section's evidence for one of the three 2-D clauses — substance only, no clause number/title. */
export interface SectionClauseEvidence {
  key: Clause2dKey
  status: GaplessClauseStatus
  /** Present only on ``not-evaluated``, mirroring ``GaplessClauseInput``. */
  notEvaluatedReason?: string
  entries: GaplessClauseEntry[]
}

/** Everything one section needs for its three 2-D clauses. */
export interface SectionClause2dInput {
  /** The cross-section row id. */
  sectionId: string
  /** Its display name, so every entry reads without a lookup. */
  sectionName: string
  /**
   * This section's hierarchical fill result, or ``undefined`` when none ran
   * (litho build, or this section has no litho frame) — the ``undefined``
   * case is what drives all three clauses to ``not-evaluated``.
   */
  hierarchical: HierarchicalGeotechFillResult | undefined
  /** The litho frame's own partition for this section — clause 1's reference. */
  lithoRegions: readonly SectionRegion[]
  /** Along-section metres per frame column, 1:1 with the frame's columns. */
  alongM: readonly number[]
  /**
   * The investigation each frame column stands on, 1:1 with ``alongM``.
   *
   * Required, not optional: this is the ONLY list a gap index is valid
   * against, and it exists here so the pair can be resolved while the frame is
   * still in scope. A caller that could supply it and did not would mint
   * findings nobody can navigate to (see ``gap_investigation_ids`` in
   * ``types.ts``), so the type refuses to let it be forgotten.
   */
  columnInvestigationIds: readonly string[]
}

const NO_FILL_REASON =
  'no hierarchical geotech fill ran for this section (litho build, or this section has no litho frame)'

/**
 * Format a measurement for a human sentence.
 *
 * Two decimals is the readable default and was, until 2026-08-28, the whole
 * rule. It is a LIE for clause 1. That clause compares the covers exactly, so
 * any nonzero mismatch can be a defect while two decimals round all values
 * below 0.005 m² to the word "0". The owner was shown *"which is 0 m² less
 * than the litho cover's 8.42 m²"*: a guarantee reported broken by an amount
 * of nothing.
 *
 * So: two decimals while two decimals still say something, and three
 * significant figures when they do not. Significant figures rather than more
 * decimals because the range this formatter has to cover is the whole span
 * from a square millimetre to thousands of square metres, and a fixed decimal
 * count is wrong at one end or the other by construction — three sig figs is
 * the same amount of information at every magnitude. Only a value that really
 * is zero prints "0", and every number that already read well (2.5 m, 3.4 m²,
 * 50 m²) is untouched, which is why clauses 2 and 3 stay on this one
 * formatter rather than forking a second.
 *
 * @param value The measurement, in whatever unit its sentence names.
 * @returns The number as a human would write it, never rounded to nothing.
 */
function formatMeasure(value: number): string {
  const twoDecimals = Number(value.toFixed(2))
  // ``value === 0`` also catches -0, which must print "0" and not fall through.
  if (twoDecimals !== 0 || value === 0) return twoDecimals.toString()
  return Number(value.toPrecision(3)).toString()
}

/**
 * The locator every 2-D entry carries.
 *
 * The section and the gap index are what the sentence SAYS; the gap's two
 * columns are what a reader navigates BY (see ``gap_investigation_ids`` in
 * ``types.ts`` for why an index must never leave this module). The pair is
 * omitted, never guessed, when the frame's column list does not reach this gap
 * — which happens for a violation the fill reports on a gap the frame's own
 * axis does not hold.
 *
 * @param sectionId The cross-section row id.
 * @param sectionName Its display name.
 * @param gapIndex The gap on the FRAME's own axis.
 * @param columnInvestigationIds The frame's column list, 1:1 with its axis.
 * @returns The locator fields, ready to spread into a ``GaplessClauseEntry``.
 */
function gapLocator(
  sectionId: string,
  sectionName: string,
  gapIndex: number,
  columnInvestigationIds: readonly string[],
): Pick<
  GaplessClauseEntry,
  'section_id' | 'section_name' | 'gap_index' | 'gap_investigation_ids'
> {
  const left = columnInvestigationIds[gapIndex]
  const right = columnInvestigationIds[gapIndex + 1]
  return {
    section_id: sectionId,
    section_name: sectionName,
    gap_index: gapIndex,
    ...(left !== undefined && right !== undefined && { gap_investigation_ids: [left, right] }),
  }
}

const geometryFactory = new GeometryFactory()

/**
 * Measure one cover as a set, never as a sum of its source rings.
 *
 * A hierarchical result partitions its parent litho regions. Its sibling
 * rings can meet, cross a snapped junction, or overlap while still painting
 * exactly the same ground once. Raw shoelace sums turn that implementation
 * detail into an invented shortfall/excess. The geometry engine unions the
 * original physical-coordinate rings first, so every covered patch is counted
 * once at the coordinates the section actually holds. Thus any genuinely
 * unpainted litho patch or paint outside litho changes the result; duplicate
 * child-ring area does not.
 */
function coverGeometry(regions: readonly SectionRegion[], widthM: number) {
  const polygons = new ArrayList([])
  for (const region of regions) {
    if (region.polygon.length < 3) continue
    const ring = region.polygon.map(
      (point) => new Coordinate(point.fraction * Math.abs(widthM), point.elevation),
    )
    ring.push(ring[0])
    polygons.add(geometryFactory.createPolygon(ring))
  }
  const geometry = polygons.isEmpty()
    ? geometryFactory.createPolygon()
    : CascadedPolygonUnion.union(polygons)
  return { geometry, areaM2: geometry.getArea() }
}

/**
 * The part of a difference that is really missing (or really extra) ground.
 *
 * WHY THIS IS A WIDTH QUESTION AND NOT AN AREA ONE (owner ruling, 2026-08-31).
 * The two covers are produced by two engines that snap-round independently: the
 * litho partition in ``partitionFillV2`` and the geotech fill in its own
 * ``frameClipGeometry`` arrangement (see ``partitionFillV2/snap.ts`` — one pass,
 * every input vertex AND every computed intersection, onto a fixed millimetre
 * grid). Where the geotech cuts a sloping litho contact it must say where its
 * cut lands on that contact, and halfway between 7.509 and 5.21 is 6.3595 —
 * half a millimetre, so on a millimetre grid it can only be written 6.359 or
 * 6.360, neither of which is on the straight line the litho drew.
 *
 * What that leaves is a REAL triangle: on the owner's Cross-section 1 gap 3 its
 * corners are (0, 7.509), (45.191, 6.359) and (90.382, 5.21) — all exactly on
 * the grid, 90 m long and half a millimetre thick. It is not floating-point
 * noise and not a rounding artefact, so nothing removes it by rounding; three
 * separate attempts to reconcile the two covers geometrically (vertex snapping,
 * a millimetre precision model, inserting the shared vertex) each drove JTS's
 * overlay into degenerate edges and threw on his real data.
 *
 * So the clause asks the question the engineer actually has: is any ground
 * MISSING? Ground has width. A difference that is nowhere wider than the grid
 * the model is drawn on is one contact stated twice, not a hole — while a real
 * hole survives erosion and is then reported at its FULL area, never the eroded
 * remnant, because the engineer has to be told how much ground is at stake.
 *
 * The limit, stated plainly: a missing sliver narrower than a millimetre but
 * very long would be forgiven. No coordinate in this model can express such a
 * sliver, but it is a real weakening rather than a free one.
 *
 * @param difference The symmetric difference of the two covers.
 * @param halfCellM Half a snap-grid cell, in metres.
 * @returns Total area of the pieces that hold real ground; 0 when none do.
 */
function realGroundM2(difference: { getArea(): number }, halfCellM: number): number {
  const source = difference as {
    getArea(): number
    getNumGeometries?: () => number
    getGeometryN?: (i: number) => { getArea(): number }
  }
  const count = source.getNumGeometries ? source.getNumGeometries() : 1
  let total = 0
  for (let i = 0; i < count; i++) {
    const piece = source.getGeometryN ? source.getGeometryN(i) : source
    const areaM2 = piece.getArea()
    if (areaM2 === 0) continue
    let holdsGround: boolean
    try {
      holdsGround = !(BufferOp.bufferOp(piece, -halfCellM) as { isEmpty(): boolean }).isEmpty()
    } catch {
      // A geometry this pass cannot measure is REPORTED, never dropped: the one
      // thing worse than a false alarm here is silently swallowing real ground.
      holdsGround = true
    }
    if (holdsGround) total += areaM2
  }
  return total
}

/**
 * Name a geometry failure in the few words a report line can carry.
 *
 * The geometry library raises objects that are not always ``Error`` instances
 * (``TopologyException`` carries its own ``name``), so both shapes are read and
 * an unrecognised one still yields something rather than "undefined".
 *
 * @param error Whatever the geometry call threw.
 * @returns A short phrase naming the failure.
 */
function describeGeometryFailure(error: unknown): string {
  const named = error as { name?: string; message?: string } | null
  const name = named?.name
  const message = named?.message
  const text = name && message ? `${name}: ${message}` : (name ?? message ?? String(error))
  return text.length > 80 ? `${text.slice(0, 80)}…` : text
}

/** Clause 1 (area-conservation) for one section that DID run a hierarchical fill. */
function areaConservationFor(
  sectionId: string,
  sectionName: string,
  hierarchical: HierarchicalGeotechFillResult,
  lithoRegions: readonly SectionRegion[],
  alongM: readonly number[],
  columnInvestigationIds: readonly string[],
): SectionClauseEvidence {
  const gapIndices = new Set<number>(
    [...hierarchical.regions, ...hierarchical.lithoFallback, ...lithoRegions].map(
      (region) => region.gapIndex,
    ),
  )
  const entries: GaplessClauseEntry[] = []
  for (const gapIndex of [...gapIndices].sort((a, b) => a - b)) {
    const width = alongM[gapIndex + 1] - alongM[gapIndex]
    if (!Number.isFinite(width)) continue // gapIndex outside this frame's own axis — nothing to measure
    const painted = [...hierarchical.regions, ...hierarchical.lithoFallback].filter(
      (region) => region.gapIndex === gapIndex,
    )
    const frame = lithoRegions.filter((region) => region.gapIndex === gapIndex)
    // THIS CLAUSE RUNS INSIDE ``buildVoxelRequest``, so anything it throws takes
    // the Build button with it, not just the report. A region whose ring
    // crosses itself — which an engine bug can emit — makes the symmetric
    // difference throw. Both obvious responses are wrong: crashing hides the
    // finding behind a stack trace, and swallowing it passes a gap nobody
    // measured. It is REPORTED instead, in those words, and with no number,
    // because no number was obtained.
    let measured: { differenceM2: number; paintedM2: number; lithoM2: number }
    try {
      const paintedCover = coverGeometry(painted, width)
      const lithoCover = coverGeometry(frame, width)
      measured = {
        differenceM2: realGroundM2(
          OverlayOp.symDifference(paintedCover.geometry, lithoCover.geometry),
          SNAP_GRID_M / 2,
        ),
        paintedM2: paintedCover.areaM2,
        lithoM2: lithoCover.areaM2,
      }
    } catch (error) {
      entries.push({
        label:
          `${sectionName}, gap ${gapIndex}: the cover geometry could not be measured ` +
          `(${describeGeometryFailure(error)}) — most often a region whose own ring ` +
          `crosses itself`,
        ...gapLocator(sectionId, sectionName, gapIndex, columnInvestigationIds),
      })
      continue
    }
    const { differenceM2, paintedM2, lithoM2 } = measured
    // A mismatch this small is the two engines snap-rounding a sloping contact
    // independently, not a hole in the subdivision — the residue scales with the
    // cover (the length of the cut contacts), so the floor is relative to the
    // litho cover with a small absolute floor for tiny gaps. See ``constants.ts``.
    const tolerance = Math.max(
      AREA_CONSERVATION_ABS_FLOOR_M2,
      AREA_CONSERVATION_REL_FRACTION * lithoM2,
    )
    if (differenceM2 <= tolerance) continue
    entries.push({
      label:
        `${sectionName}, gap ${gapIndex}: classed + unclassed ground differs from ` +
        `the litho cover by ${formatMeasure(differenceM2)} m² ` +
        `(geotech ${formatMeasure(paintedM2)} m²; litho ${formatMeasure(lithoM2)} m²)`,
      ...gapLocator(sectionId, sectionName, gapIndex, columnInvestigationIds),
      measure: { value: differenceM2, unit: 'm2', budget: tolerance },
      params: {
        gap_index: gapIndex,
        difference_m2: differenceM2,
        geotech_m2: paintedM2,
        litho_m2: lithoM2,
      },
    })
  }
  return { key: 'area-conservation', status: entries.length > 0 ? 'fail' : 'pass', entries }
}

/** Clause 2 (edge-reach) — a verbatim relabel of ``diagnostics.edgeReachViolations``. */
function edgeReachFor(
  sectionId: string,
  sectionName: string,
  hierarchical: HierarchicalGeotechFillResult,
  columnInvestigationIds: readonly string[],
): SectionClauseEvidence {
  const entries: GaplessClauseEntry[] = hierarchical.diagnostics.edgeReachViolations.map((v) => ({
    label:
      `${sectionName}, gap ${v.gapIndex}, ${v.edge === 0 ? 'left' : 'right'} column edge: the 3-D ` +
      `build would read this edge as empty ground, though the litho cover holds ${formatMeasure(v.coverM)} m there`,
    ...gapLocator(sectionId, sectionName, v.gapIndex, columnInvestigationIds),
    measure: { value: v.coverM, unit: 'm', budget: 0 },
    params: { gap_index: v.gapIndex, edge: v.edge, cover_m: v.coverM },
  }))
  return { key: 'edge-reach', status: entries.length > 0 ? 'fail' : 'pass', entries }
}

/** Clause 3 (cause-closure) — a verbatim relabel of ``diagnostics.totalityViolations``. */
function causeClosureFor(
  sectionId: string,
  sectionName: string,
  hierarchical: HierarchicalGeotechFillResult,
  columnInvestigationIds: readonly string[],
): SectionClauseEvidence {
  const entries: GaplessClauseEntry[] = hierarchical.diagnostics.totalityViolations.map((v) => ({
    label:
      `${sectionName}, gap ${v.gapIndex}: ${formatMeasure(v.areaM2)} m² of litho cover is neither ` +
      `classed nor accounted for (${v.faces} unanswered ${v.faces === 1 ? 'loop' : 'loops'})`,
    ...gapLocator(sectionId, sectionName, v.gapIndex, columnInvestigationIds),
    measure: { value: v.areaM2, unit: 'm2', budget: 0 },
    params: { gap_index: v.gapIndex, area_m2: v.areaM2, faces: v.faces },
  }))
  return { key: 'cause-closure', status: entries.length > 0 ? 'fail' : 'pass', entries }
}

/**
 * One section's evidence for clauses 1-3.
 *
 * @param input See {@link SectionClause2dInput}.
 * @returns Exactly three entries, one per clause key, in clause-number order.
 */
export function clauses2dForSection(input: SectionClause2dInput): SectionClauseEvidence[] {
  const { sectionId, sectionName, hierarchical, lithoRegions, alongM, columnInvestigationIds } =
    input
  if (hierarchical === undefined) {
    return (['area-conservation', 'edge-reach', 'cause-closure'] as const).map((key) => ({
      key,
      status: 'not-evaluated' as const,
      notEvaluatedReason: NO_FILL_REASON,
      entries: [],
    }))
  }
  return [
    areaConservationFor(
      sectionId,
      sectionName,
      hierarchical,
      lithoRegions,
      alongM,
      columnInvestigationIds,
    ),
    edgeReachFor(sectionId, sectionName, hierarchical, columnInvestigationIds),
    causeClosureFor(sectionId, sectionName, hierarchical, columnInvestigationIds),
  ]
}
