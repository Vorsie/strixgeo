/**
 * THE HIERARCHICAL GEOTECH FILL — densities WITHIN lithos.
 *
 * Owner ruling, 2026-08-18: *"once all ties are there, and boreholes are there,
 * you prolly didn't need to build a new fill engine, the litho's worked just
 * fine? It's the same basic rules only with densities on top of lithos"* — on
 * top of the standing *"we don't need to invent the fill bands engine, it is
 * build for the litho stage — we only have more classes"* and *"you have to
 * start from the exact litho geometries"*.
 *
 * THE CONSTRUCTION. The litho partition is the frame, and it is the frame BY
 * CONSTRUCTION rather than by repair:
 *
 *  1. the section's litho units are grouped into FAMILIES — the litho body as it
 *     appears on this section (``families.ts``);
 *  2. every packing band is paired with the litho unit it subdivides, by
 *     geometry on its own column (``bandParents.ts``);
 *  3. the SAME partition engine the litho stage uses is run ONCE PER FAMILY,
 *     seeing only that family's bands and only the ties whose both ends are
 *     bands of that family. Inside a run the engine's own 2/1/0 machinery
 *     decides everything: two ties band, one tie onlaps its line, no ties closes
 *     as a lens at its own level, and the engine's own vacancy/substrate rules
 *     fill the remainder with the family's own classes — because they are the
 *     only classes in the run;
 *  4. each family's output is clipped to that family's own litho regions
 *     (``frameClip.ts``). Pure geometry: every face already carries a class of
 *     the family's own soil, so there is nothing to re-label.
 *
 * WHAT FOLLOWS STRUCTURALLY, and is what the post-hoc clip could only chase:
 * a packing class can never paint outside the litho soil it subdivides; a
 * vacancy in a sand region can never read clay; and a band whose loop the
 * whole-section run used to lose (it competed with every other class in the
 * section) now closes inside its own family.
 *
 * The engine is CALLED, never re-implemented — no geometry rule lives here.
 *
 * @module utils/geotechHierarchicalFill
 */

import { resolveBandParents } from './bandParents'
import { buildLithoFamilies, type LithoFamily } from './families'
import { applyFamilyMatrix } from './familyMatrix'
import { clipFamilyToFrameGap } from './frameClip'
import { fillByLevel, levelBands, type LevelBand } from './levelFill'
import { computeSectionFillActiveWithDiagnostics } from '../partitionEngineSelect'
import type { CorrelationEdge, PartitionColumn, SectionRegion } from '../partitionFill'
import type { TieConflict } from '../partitionFillV2'

/** The partition engine, injectable so tests and gates pin one engine. */
export type PartitionEngine = (
  columns: readonly PartitionColumn[],
  edges: readonly CorrelationEdge[],
  lensApexOverrides: undefined,
  alongM: readonly number[],
) => { regions: SectionRegion[]; conflicts?: readonly TieConflict[] }

/** Everything one section's hierarchical fill needs. */
export interface HierarchicalGeotechFillInput {
  /** The litho frame's columns, left to right — the axis every index refers to. */
  lithoColumns: readonly PartitionColumn[]
  /** The litho model's APPROVED correlation edges for this section. */
  lithoEdges: readonly CorrelationEdge[]
  /** The litho frame partition — the engine's own output on those columns. */
  lithoRegions: readonly SectionRegion[]
  /**
   * Packing bands, frame-aligned 1:1 with ``lithoColumns`` (see
   * ``frameAlignedColumns``); a column nobody has divided carries an empty stack.
   */
  geotechColumns: readonly PartitionColumn[]
  /** The geotech model's APPROVED packing correlation edges. */
  geotechEdges: readonly CorrelationEdge[]
  /** Along-section metres, 1:1 with ``lithoColumns``. */
  alongM: readonly number[]
  /**
   * The engine. Defaults to the active one (``computeSectionFillActive``), which
   * is what the app, the offline gates and the 3-D build request all pass.
   *
   * No apex overrides are threaded: free-draw editing is off on the geotech axis
   * (``freedrawEditFlag``), so there is no hand-drawn shape to honour, and a
   * per-family run has its own gap axis that a frame-keyed override could not
   * address anyway.
   */
  compute?: PartitionEngine
}

/** What the construction had to work around, for the gates and the console. */
export interface HierarchicalGeotechFillDiagnostics {
  /** Litho families on this section. */
  families: number
  /** Families whose bands sit on ONE column — no gap to partition. */
  singleColumnFamilies: number
  /** Packing bands seen. */
  bands: number
  /** Bands straddling a litho contact (parented by midpoint). */
  bandsStraddling: number
  /** Bands with no litho unit at their depth — excluded from every family. */
  bandsUnparented: number
  /** Ties whose two ends sit in DIFFERENT families — dropped. */
  tiesCrossingFamilies: number
  /** Ties with an end no litho unit claims — dropped. */
  tiesUnresolved: number
  /** Litho regions no family could claim — rendered bare. */
  unattributedLithoRegions: number
  /** Gaps where the engine emitted nothing and the level fill answered alone. */
  oneSidedGaps: number
  /**
   * Per family, the tests that carry its litho unit but no band of it — the
   * un-divided columns that stop its constructs and leave both flanking gaps
   * un-classed (summed over families).
   */
  blockedColumns: number
  /** Cover the level fill classified, in square metres (see ``levelFill.ts``). */
  levelFilledAreaM2: number
  /**
   * The subset of that, in square metres, read off a band of the same lithology
   * in ANOTHER chain — cover no chain with densities claims. Reported so the
   * one place this construction reaches outside a family is never silent.
   */
  levelFilledCrossFamilyAreaM2: number
  /**
   * Litho cover left unclassified, in square metres, by WHY — the honest
   * accounting of what the fill does not know. ``noBands`` = neither column of
   * the gap carries a band of this family (nothing was ever derived there);
   * ``afterEngine`` = the family's own partition left a vacancy the level fill
   * could not answer either; ``outsideBandRange`` = the cover reached a level
   * NEITHER flanking test read.
   */
  residualAreaM2: { noBands: number; afterEngine: number; outsideBandRange: number }
}

/** The fill, ready for the render and the build. */
export interface HierarchicalGeotechFillResult {
  /** Packing-classed faces, disjoint, tiling everything that IS classified. */
  regions: SectionRegion[]
  /**
   * Crossing packing ties the per-family runs found, reported on the FRAME's
   * gap axis — the amber warning chip's input. A tie crossing another only
   * matters inside one body, which is exactly the scope a family run sees.
   */
  conflicts: TieConflict[]
  /**
   * Litho cover no packing class reached — carries the LITHO formation id;
   * render litho-coloured under the "correlate me" texture, never through the
   * NAD colour map.
   */
  lithoFallback: SectionRegion[]
  diagnostics: HierarchicalGeotechFillDiagnostics
}

/** A family's engine output, carried in ABSOLUTE along-metres. */
interface AbsoluteRegion {
  source: SectionRegion
  /** The ring in (along metres, elevation). */
  ring: { along: number; elevation: number }[]
  minAlong: number
  maxAlong: number
}

/**
 * Which frame columns a family's engine run may treat as adjacent.
 *
 * TWO KINDS OF COLUMN THE FAMILY HAS NO BANDS ON, and they mean opposite things
 * (owner ruling 2026-08-15, kept: an un-divided borehole shows visibly EMPTY
 * ground, and the ghost preview of what it would get is opt-in behind its own
 * toggle — "no tie state ever opens the gate"):
 *
 *  * the column CARRIES a litho unit of this family and simply has not been
 *    divided yet → it BLOCKS. The mass is there and nobody has classified it,
 *    so the family's constructs terminate at it and its cover on both flanking
 *    gaps reads "correlate me". Painting through it would state a class the
 *    engineer never accepted.
 *  * the column carries NO unit of this family at all → it is EXCLUDED from the
 *    run, so the engine's own bridge machinery spans it. The family genuinely is
 *    not there; this is the same span the litho stage draws over a test that
 *    lacks the unit, and it is what keeps a deep body continuous across a short
 *    test standing in front of it.
 *
 * @param bandedColumns The family's banded frame column indices, ascending.
 * @param blockers Frame column indices carrying a family litho unit but no band.
 * @returns Maximal runs of banded columns with no blocker between them; runs of
 *   fewer than two columns are dropped (no gap to partition).
 */
function runsBetweenBlockers(
  bandedColumns: readonly number[],
  blockers: ReadonlySet<number>,
): number[][] {
  const runs: number[][] = []
  let current: number[] = []
  for (let i = 0; i < bandedColumns.length; i++) {
    const ci = bandedColumns[i]
    if (current.length > 0) {
      let blocked = false
      for (let between = current[current.length - 1] + 1; between < ci; between++) {
        if (blockers.has(between)) blocked = true
      }
      if (blocked) {
        if (current.length >= 2) runs.push(current)
        current = []
      }
    }
    current.push(ci)
  }
  if (current.length >= 2) runs.push(current)
  return runs
}

/**
 * Run the engine over ONE run of a family's columns and return its output in
 * absolute along-metres.
 *
 * Absolute metres are the common currency: a run's gap axis and the frame's gap
 * axis are different axes, and along-section position is the one thing they
 * agree on.
 */
function runFamily(
  input: HierarchicalGeotechFillInput,
  indices: readonly number[],
  bandsOfFamily: ReadonlyMap<number, PartitionColumn>,
  compute: PartitionEngine,
  conflicts: TieConflict[],
): AbsoluteRegion[] {
  if (indices.length < 2) return []
  const columns = indices.map((ci) => bandsOfFamily.get(ci) as PartitionColumn)
  const alongM = indices.map((ci) => input.alongM[ci])
  const ownLayerIds = new Set<string>()
  for (const column of columns) for (const unit of column.units) ownLayerIds.add(unit.layerId)
  const edges = input.geotechEdges.filter((e) => ownLayerIds.has(e.a) && ownLayerIds.has(e.b))

  const out: AbsoluteRegion[] = []
  const answer = compute(columns, edges, undefined, alongM)
  // The owner's channel-matrix ruling, re-stated in family space: a face that
  // floods a vacancy reads the class the reached test measured at the face's own
  // top level (``familyMatrix.ts``).
  const answerRegions = applyFamilyMatrix(answer.regions, columns)
  for (const conflict of answer.conflicts ?? []) {
    // A family's gap axis is its own; report the conflict on the FRAME gap that
    // holds the midpoint of the family gap it was found in, so the warning chip
    // names a gap the engineer can look at.
    const mid = (alongM[conflict.gapIndex] + alongM[conflict.gapIndex + 1]) / 2
    let frameGap = conflict.gapIndex
    for (let g = 0; g + 1 < input.alongM.length; g++) {
      if (mid >= input.alongM[g] && mid <= input.alongM[g + 1]) {
        frameGap = g
        break
      }
    }
    conflicts.push({ ...conflict, gapIndex: frameGap })
  }
  for (const region of answerRegions) {
    const left = alongM[region.gapIndex]
    const right = alongM[region.gapIndex + 1]
    if (left === undefined || right === undefined) continue
    const span = right - left
    let minAlong = Infinity
    let maxAlong = -Infinity
    const ring = region.polygon.map((p) => {
      const along = left + p.fraction * span
      if (along < minAlong) minAlong = along
      if (along > maxAlong) maxAlong = along
      return { along, elevation: p.elevation }
    })
    out.push({ source: region, ring, minAlong, maxAlong })
  }
  return out
}

/**
 * Compute one section's geotech fill hierarchically — densities within lithos.
 *
 * @param input The section's two models on one column axis (see
 *   {@link HierarchicalGeotechFillInput}).
 * @returns The classed faces, the un-classed litho cover, and the diagnostics.
 */
export function computeHierarchicalGeotechFill(
  input: HierarchicalGeotechFillInput,
): HierarchicalGeotechFillResult {
  const compute = input.compute ?? computeSectionFillActiveWithDiagnostics
  const conflicts: TieConflict[] = []
  const { parentOfBand, straddling, unparented } = resolveBandParents(
    input.geotechColumns,
    input.lithoColumns,
  )
  const { families, familyOfLithoLayer, unattributed } = buildLithoFamilies(
    input.lithoColumns,
    input.lithoEdges,
    input.lithoRegions,
  )

  /** Band ``layerId`` → family id, via the band's parent litho unit. */
  const familyOfBand = new Map<string, string>()
  for (const [bandLayerId, parentLayerId] of parentOfBand) {
    const familyId = familyOfLithoLayer.get(parentLayerId)
    if (familyId !== undefined) familyOfBand.set(bandLayerId, familyId)
  }

  let bands = 0
  for (const column of input.geotechColumns) bands += column.units.length

  let tiesCrossingFamilies = 0
  let tiesUnresolved = 0
  for (const edge of input.geotechEdges) {
    const fa = familyOfBand.get(edge.a)
    const fb = familyOfBand.get(edge.b)
    if (fa === undefined || fb === undefined) tiesUnresolved += 1
    else if (fa !== fb) tiesCrossingFamilies += 1
  }

  // Per family: its bands, per frame column index.
  const columnsByFamily = new Map<string, Map<number, PartitionColumn>>()
  for (let ci = 0; ci < input.geotechColumns.length; ci++) {
    const column = input.geotechColumns[ci]
    const byFamily = new Map<string, PartitionColumn['units'][number][]>()
    for (const unit of column.units) {
      const familyId = familyOfBand.get(unit.layerId)
      if (familyId === undefined) continue
      const list = byFamily.get(familyId)
      if (list === undefined) byFamily.set(familyId, [unit])
      else list.push(unit)
    }
    for (const [familyId, units] of byFamily) {
      let byIndex = columnsByFamily.get(familyId)
      if (byIndex === undefined) {
        byIndex = new Map()
        columnsByFamily.set(familyId, byIndex)
      }
      byIndex.set(ci, {
        investigationId: column.investigationId,
        surfaceElevM: column.surfaceElevM,
        units: [...units].sort((a, b) => a.topDepthM - b.topDepthM),
      })
    }
  }

  // Same-lithology bands per frame column, for the level fill's last resort:
  // column index → litho formation → its bands there, whichever chain they
  // belong to.
  const lithoFormationOfLayer = new Map<string, string>()
  for (const column of input.lithoColumns) {
    for (const unit of column.units) lithoFormationOfLayer.set(unit.layerId, unit.formationId)
  }
  const kinByColumn = new Map<number, Map<string, LevelBand[]>>()
  for (let ci = 0; ci < input.geotechColumns.length; ci++) {
    const column = input.geotechColumns[ci]
    const byFormation = new Map<string, LevelBand[]>()
    for (const unit of column.units) {
      const parent = parentOfBand.get(unit.layerId)
      const formation = parent === undefined ? undefined : lithoFormationOfLayer.get(parent)
      if (formation === undefined) continue
      const band = {
        formationId: unit.formationId,
        bodyId: unit.bodyId,
        layerId: unit.layerId,
        topElev: column.surfaceElevM - unit.topDepthM,
        baseElev: column.surfaceElevM - unit.baseDepthM,
      }
      const list = byFormation.get(formation)
      if (list === undefined) byFormation.set(formation, [band])
      else list.push(band)
    }
    kinByColumn.set(ci, byFormation)
  }
  /** A family's single lithology — families never span two (see families.ts). */
  const formationOfFamily = new Map<string, string>()
  for (const family of families) {
    for (const layerId of family.lithoLayerIds) {
      const formation = lithoFormationOfLayer.get(layerId)
      if (formation !== undefined) {
        formationOfFamily.set(family.id, formation)
        break
      }
    }
  }

  // Every litho region of a gap, in the render's own z-order (overlays last) —
  // the ownership authority the per-family clips resolve against.
  const paintByGap = new Map<number, SectionRegion[]>()
  for (const region of input.lithoRegions) {
    const list = paintByGap.get(region.gapIndex)
    if (list === undefined) paintByGap.set(region.gapIndex, [region])
    else list.push(region)
  }

  const regions: SectionRegion[] = []
  const lithoFallback: SectionRegion[] = [...unattributed]
  let singleColumnFamilies = 0
  let oneSidedGaps = 0
  let blockedColumns = 0
  let levelFilledAreaM2 = 0
  let levelFilledCrossFamilyAreaM2 = 0
  const residualAreaM2 = { noBands: 0, afterEngine: 0, outsideBandRange: 0 }
  /** Ring area in square metres: fraction-space area scaled by the gap width. */
  const areaM2 = (region: SectionRegion): number => {
    const width = input.alongM[region.gapIndex + 1] - input.alongM[region.gapIndex]
    if (!Number.isFinite(width)) return 0
    let twice = 0
    const ring = region.polygon
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % ring.length]
      twice += a.fraction * b.elevation - b.fraction * a.elevation
    }
    return (Math.abs(twice) / 2) * width
  }

  // Frame columns each family's LITHO units stand on — the authority for which
  // bandless columns block and which are bridged (see ``runsBetweenBlockers``).
  const lithoColumnsByFamily = new Map<string, Set<number>>()
  for (let ci = 0; ci < input.lithoColumns.length; ci++) {
    for (const unit of input.lithoColumns[ci].units) {
      const familyId = familyOfLithoLayer.get(unit.layerId)
      if (familyId === undefined) continue
      const set = lithoColumnsByFamily.get(familyId)
      if (set === undefined) lithoColumnsByFamily.set(familyId, new Set([ci]))
      else set.add(ci)
    }
  }

  for (const family of families) {
    const own = columnsByFamily.get(family.id) ?? new Map<number, PartitionColumn>()
    if (own.size === 1) singleColumnFamilies += 1
    // A column carrying this family's litho unit with NO band of it: the mass is
    // there and nobody classified it. It stops the family's constructs, and both
    // gaps it flanks stay un-classed.
    const blockers = new Set<number>()
    for (const ci of lithoColumnsByFamily.get(family.id) ?? []) {
      if (!own.has(ci)) blockers.add(ci)
    }
    if (blockers.size > 0) blockedColumns += blockers.size
    const absolute = runsBetweenBlockers(
      [...own.keys()].sort((a, b) => a - b),
      blockers,
    ).flatMap((run) => runFamily(input, run, own, compute, conflicts))
    const gaps = [...family.regionsByGap.keys()].sort((a, b) => a - b)
    for (const gap of gaps) {
      const frameRegions = family.regionsByGap.get(gap) as SectionRegion[]
      // One of this gap's tests carries the family and has not been divided:
      // the ground reads empty, whole (owner ruling 2026-08-15). No engine
      // output, no level fill — a class here would be an interpretation the
      // engineer has not accepted, and pressing "4 · Divide boreholes" is what
      // accepts it.
      if (blockers.has(gap) || blockers.has(gap + 1)) {
        lithoFallback.push(...frameRegions)
        for (const r of frameRegions) residualAreaM2.noBands += areaM2(r)
        continue
      }
      const left = input.alongM[gap]
      const right = input.alongM[gap + 1]
      const span = right - left
      // A degenerate gap (two tests at the same along position) has no interior
      // to clip into; its litho cover is handed on unclassified rather than
      // divided by zero.
      const overlapping =
        Number.isFinite(span) && span > 0
          ? absolute.filter((r) => r.maxAlong > left + 1e-9 && r.minAlong < right - 1e-9)
          : []
      const geotechInGap: SectionRegion[] = overlapping.map((r) => ({
        ...r.source,
        gapIndex: gap,
        polygon: r.ring.map((p) => ({
          fraction: (p.along - left) / span,
          elevation: p.elevation,
        })),
      }))
      // 1. Whatever the family's own partition reached, clipped to its cover.
      const clipped = clipFamilyToFrameGap(
        geotechInGap,
        frameRegions,
        gap,
        paintByGap.get(gap) ?? frameRegions,
      )
      regions.push(...clipped.covered)
      if (clipped.residual.length === 0) continue

      // 2. Whatever it left silent, read off the flanking tests' band levels
      //    (``levelFill.ts``): an untied band closes at its own level. With no
      //    band of this family on either column nothing was ever derived here
      //    and the whole cover falls back.
      const leftBands = levelBands(own.get(gap))
      const rightBands = levelBands(own.get(gap + 1))
      const formation = formationOfFamily.get(family.id)
      const kin =
        formation === undefined
          ? undefined
          : {
              left: kinByColumn.get(gap)?.get(formation) ?? [],
              right: kinByColumn.get(gap + 1)?.get(formation) ?? [],
            }
      if (
        leftBands.length === 0 &&
        rightBands.length === 0 &&
        (kin === undefined || (kin.left.length === 0 && kin.right.length === 0))
      ) {
        lithoFallback.push(...clipped.residual)
        for (const r of clipped.residual) residualAreaM2.noBands += areaM2(r)
        continue
      }
      if (geotechInGap.length === 0) oneSidedGaps += 1
      const filled = fillByLevel(clipped.residual, leftBands, rightBands, gap, kin)
      regions.push(...filled.covered)
      lithoFallback.push(...filled.residual)
      for (const r of filled.covered) levelFilledAreaM2 += areaM2(r)
      for (const r of filled.crossFamily) levelFilledCrossFamilyAreaM2 += areaM2(r)
      for (const r of filled.residual) residualAreaM2.outsideBandRange += areaM2(r)
    }
  }

  return {
    regions,
    lithoFallback,
    conflicts,
    diagnostics: {
      families: families.length,
      singleColumnFamilies,
      bands,
      bandsStraddling: straddling,
      bandsUnparented: unparented,
      tiesCrossingFamilies,
      tiesUnresolved,
      unattributedLithoRegions: unattributed.length,
      oneSidedGaps,
      blockedColumns,
      levelFilledAreaM2,
      levelFilledCrossFamilyAreaM2,
      residualAreaM2,
    },
  }
}
