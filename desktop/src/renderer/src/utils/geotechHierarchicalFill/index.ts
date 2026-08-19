/**
 * THE HIERARCHICAL GEOTECH FILL — densities WITHIN lithos, built by CONSTRUCTION.
 *
 * Owner, 2026-08-19, on how the fill is put together — the binding structure:
 *
 *   *"we said first draw all lines, lenses, onlaps, vertical lines, this makes
 *    closed loops, then we fill everything and merge it"*
 *   *"the lines are the structural framework, the fill is to fill all gaps, the
 *    merge is to reduce the dimensions to a manageable level"*
 *
 * and on the law those lines obey — *"the 2/1/0 rule is super simple"*,
 * *"i said it was absolute no? We already went through this with the litho
 * model. build it"*, *"connect the dots and fill between the lines"*.
 *
 * THE CONSTRUCTION, top to bottom:
 *
 *  1. the section's litho units are grouped into FAMILIES — the litho body as
 *     it appears on this section (``families.ts``);
 *  2. every packing band is paired with the litho unit it subdivides, by
 *     geometry on its own column (``bandParents.ts``);
 *  3. inside each family, the 2/1/0 law is applied DIRECTLY: two ties on a
 *     band's contacts make it span, one makes it onlap its line, none closes it
 *     as a lens (an enclosed interbed) or holds its own level to the vertical
 *     termination between the two tests. Those constructs are LINES, drawn
 *     before any area exists, and the loops they close are filled and merged
 *     (``constructive/``);
 *  4. everything is cut to that family's own litho regions — the frame nothing
 *     may leave — and a loop the rules cannot answer stays unclassed and
 *     renders "correlate me".
 *
 * WHAT FOLLOWS STRUCTURALLY: a packing class can never paint outside the litho
 * soil it subdivides; a vacancy in a sand region can never read clay; a band
 * with a top and a base tie fills the ground between its two lines whatever
 * else is going on; and nothing depends on the order anything was emitted in,
 * because the framework is drawn whole before a single loop is labelled.
 *
 * @module utils/geotechHierarchicalFill
 */

import { resolveBandParents } from './bandParents'
import { buildLithoFamilies } from './families'
import { fillFamily } from './constructive/familyFill'
import { runBandsOf, type RunBand, type RunColumn } from './constructive/constructs'
import type { CorrelationEdge, PartitionColumn, SectionRegion } from '../partitionFill'
import type { TieConflict } from '../partitionFillV2'

/** Elevation tolerance (m) at which a band's contact IS its unit's own. */
const COVER_EPS = 1e-6

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
  /** Gaps with no run of banded tests over them — the matrix answered alone. */
  oneSidedGaps: number
  /**
   * Per family, the tests that carry its litho unit but no band of it — the
   * un-divided columns that stop its constructs and leave both flanking gaps
   * un-classed (summed over families).
   */
  blockedColumns: number
  /** Cover the matrix rulings classified, in square metres. */
  levelFilledAreaM2: number
  /**
   * Litho cover left unclassified, in square metres, by WHY — the honest
   * accounting of what the fill does not know. ``noBands`` = nothing of this
   * family was ever derived on this gap's ground; ``afterEngine`` is retired
   * (no engine runs here any more) and stays 0; ``outsideBandRange`` = the
   * cover reached a level no test of the family read and no envelope covers.
   */
  residualAreaM2: { noBands: number; afterEngine: number; outsideBandRange: number }
}

/** The fill, ready for the render and the build. */
export interface HierarchicalGeotechFillResult {
  /** Packing-classed faces, disjoint, tiling everything that IS classified. */
  regions: SectionRegion[]
  /**
   * Crossing packing ties, reported on the FRAME's gap axis — the amber warning
   * chip's input. A tie crossing another only matters inside one body, which is
   * exactly the scope a family sees.
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

/**
 * Which frame columns a family's constructs may treat as adjacent.
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
 *  * the column carries NO unit of this family at all → it is EXCLUDED, and the
 *    run spans it. The family genuinely is not there; this is the same span the
 *    litho stage draws over a test that lacks the unit, and it is what keeps a
 *    deep body continuous across a short test standing in front of it.
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
 * Compute one section's geotech fill — densities within lithos, by construction.
 *
 * @param input The section's two models on one column axis (see
 *   {@link HierarchicalGeotechFillInput}).
 * @returns The classed faces, the un-classed litho cover, and the diagnostics.
 */
export function computeHierarchicalGeotechFill(
  input: HierarchicalGeotechFillInput,
): HierarchicalGeotechFillResult {
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

  // EVERY packing band of the section, by layer id. A tie is drawn on a CONTACT
  // and a contact is shared: the clay-top tie under a sand band is that sand
  // band's bottom tie (owner, 2026-08-19 — *"it has a top and bottom tie to the
  // right though?"*), so resolving a line's endpoints must reach bands of the
  // NEIGHBOURING family too.
  const geotechBandOfLayer = new Map<string, RunBand>()
  for (let ci = 0; ci < input.geotechColumns.length; ci++) {
    for (const band of runBandsOf(input.geotechColumns[ci], ci, input.alongM[ci])) {
      geotechBandOfLayer.set(band.layerId, band)
    }
  }
  // The same index over the LITHO units, so the cover's own boundaries resolve
  // into lines exactly as the packing ties do.
  const lithoBandOfLayer = new Map<string, RunBand>()
  for (let ci = 0; ci < input.lithoColumns.length; ci++) {
    for (const unit of runBandsOf(input.lithoColumns[ci], ci, input.alongM[ci])) {
      lithoBandOfLayer.set(unit.layerId, unit)
    }
  }

  let tiesCrossingFamilies = 0
  let tiesUnresolved = 0
  for (const edge of input.geotechEdges) {
    const fa = familyOfBand.get(edge.a)
    const fb = familyOfBand.get(edge.b)
    if (fa === undefined || fb === undefined) tiesUnresolved += 1
    else if (fa !== fb) tiesCrossingFamilies += 1
  }
  // The ties that may BOUND a contact: every packing tie whose two ends belong
  // to ONE family. A cross-family tie — a clay band tied to a sand band — is
  // dropped: it states a contact between two different masses, not one mass, so
  // it can bound nothing (H5).
  const boundingEdges = input.geotechEdges.filter((e) => {
    const fa = familyOfBand.get(e.a)
    const fb = familyOfBand.get(e.b)
    return fa !== undefined && fb !== undefined && fa === fb
  })

  // Every litho unit's own depth extent, so a band can be told whether its
  // contact IS the cover's boundary (see the mapping below).
  const unitDepth = new Map<string, { top: number; base: number }>()
  for (const column of input.lithoColumns) {
    for (const unit of column.units) {
      unitDepth.set(unit.layerId, { top: unit.topDepthM, base: unit.baseDepthM })
    }
  }

  // Per family: its banded columns, by frame column index.
  const columnsByFamily = new Map<string, Map<number, RunColumn>>()
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
        ci,
        x: input.alongM[ci],
        bands: runBandsOf(
          {
            investigationId: column.investigationId,
            surfaceElevM: column.surfaceElevM,
            units,
          },
          ci,
          input.alongM[ci],
        ).map((band) => {
          // Does this band's contact sit ON the family cover's own boundary —
          // the parent litho unit's top or base? There an untied contact is not
          // a level the band chose but where the SOIL ends, and the litho model
          // already states where that goes.
          const parent = parentOfBand.get(band.layerId)
          const unit = parent === undefined ? undefined : unitDepth.get(parent)
          if (unit === undefined) return band
          const surface = column.surfaceElevM
          return {
            ...band,
            atCoverTop: Math.abs(band.top - (surface - unit.top)) <= COVER_EPS,
            atCoverBase: Math.abs(band.base - (surface - unit.base)) <= COVER_EPS,
          }
        }),
      })
    }
  }

  // Every litho region of a gap, in the render's own z-order (overlays last) —
  // the ownership authority the per-family fills resolve against.
  const paintByGap = new Map<number, SectionRegion[]>()
  for (const region of input.lithoRegions) {
    const list = paintByGap.get(region.gapIndex)
    if (list === undefined) paintByGap.set(region.gapIndex, [region])
    else list.push(region)
  }

  // Every litho unit's own column and elevations — the litho tie's geometry,
  // which the matrix reads as the connective envelope of its soil cover
  // (owner ruling A: litho approval carries down).
  const lithoColumnOfLayer = new Map<string, number>()
  const lithoUnitElev = new Map<string, { top: number; base: number }>()
  for (let ci = 0; ci < input.lithoColumns.length; ci++) {
    const column = input.lithoColumns[ci]
    for (const unit of column.units) {
      lithoColumnOfLayer.set(unit.layerId, ci)
      lithoUnitElev.set(unit.layerId, {
        top: column.surfaceElevM - unit.topDepthM,
        base: column.surfaceElevM - unit.baseDepthM,
      })
    }
  }

  // Frame columns each family's LITHO units stand on — the authority for which
  // bandless columns block and which are spanned (see ``runsBetweenBlockers``).
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

  const regions: SectionRegion[] = []
  const lithoFallback: SectionRegion[] = [...unattributed]
  let singleColumnFamilies = 0
  let oneSidedGaps = 0
  let blockedColumns = 0
  let levelFilledAreaM2 = 0
  const residualAreaM2 = { noBands: 0, afterEngine: 0, outsideBandRange: 0 }
  for (const family of families) {
    const own = columnsByFamily.get(family.id) ?? new Map<number, RunColumn>()
    if (own.size === 1) singleColumnFamilies += 1
    // A column carrying this family's litho unit with NO band of it: the mass is
    // there and nobody classified it. It stops the family's constructs, and both
    // gaps it flanks stay un-classed.
    const blockers = new Set<number>()
    for (const ci of lithoColumnsByFamily.get(family.id) ?? []) {
      if (!own.has(ci)) blockers.add(ci)
    }
    blockedColumns += blockers.size
    const out = fillFamily(
      family,
      own,
      blockers,
      runsBetweenBlockers([...own.keys()].sort((a, b) => a - b), blockers),
      {
        alongM: input.alongM,
        lithoEdges: input.lithoEdges,
        boundingEdges,
        geotechBandOfLayer,
        lithoBandOfLayer,
        paintByGap,
        lithoColumnOfLayer,
        lithoUnitElev,
        parentOfBand,
      },
    )
    regions.push(...out.regions)
    lithoFallback.push(...out.fallback)
    conflicts.push(...out.conflicts)
    oneSidedGaps += out.oneSidedGaps
    levelFilledAreaM2 += out.matrixAreaM2
    residualAreaM2.noBands += out.residualAreaM2.noBands
    residualAreaM2.outsideBandRange += out.residualAreaM2.outsideBandRange
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
      residualAreaM2,
    },
  }
}

