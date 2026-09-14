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
import { edgeReachViolations, type EdgeReachViolation } from './edgeReach'
import { buildLithoFamilies } from './families'
import { closureBarsFor, fillPlans, planFamily } from './constructive/familyFill'
import type { GapFillInput } from './constructive/fillGap'
import type { TotalityViolation } from './constructive/fillTotality'
import { weldAcrossFamilies } from './crossFamilyWeld'
import { fillGeotechHoles } from './fillGeotechHoles'
import { runBandsOf, type RunBand, type RunColumn } from './constructive/constructs'
import type { Mass } from './constructive/emitKernel'
import type { CorrelationEdge, PartitionColumn, SectionRegion } from '../sectionPartition'
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
  /**
   * Geotech formation id → canonical packing-class key (``SOIL|CLASS``, see
   * ``buildPackingClassOf``). The law compares *"litho and packing density"* —
   * the CLASS — but the model stores one formation ROW per (class, litho
   * parent, GEOLOGICAL parent), so the same NAD class exists under several row
   * ids and comparing rows reads two NAD-6 sands as different masses wherever
   * a geological boundary crosses the gap (owner ruling 2026-08-21: *"one mass
   * one body"*). A formation absent from the map (a skeleton band with no
   * class) keeps row identity: two unknowns are not known to be the same.
   */
  packingClassOf?: ReadonlyMap<string, string>
  /**
   * The engineer's "Separate" rulings on this section's GEOTECH axis, as canonical
   * ``a|b`` band-layer-id pairs, ``a < b`` lexicographic (owner 2026-08-31, debt #278
   * R5). Threaded into BOTH welds — the per-gap merge (``fillGap`` → ``mergeFaces``) and
   * the cross-family sweep (``weldAcrossFamilies``) — as a cannot-link: two same-class
   * masses the engineer split never weld, so the paint seam survives and the split he
   * drew is visible. Absent / empty leaves the whole fill BYTE-IDENTICAL to the
   * unconstrained construction (the HIER_COV / GEOTECH_210 invariant).
   */
  separatedPairs?: ReadonlySet<string>
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
  /**
   * Ties whose two ends sit in DIFFERENT families — counted as a statistic
   * only. Since the 2026-08-21 tied-contact ruling they are KEPT: each end
   * counts at its own in-family contact (see ``boundingEdges`` below).
   */
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
  /** Cover the dominant-mass step classified, in square metres. */
  levelFilledAreaM2: number
  /**
   * Same-class masses welded ACROSS litho families (owner 2026-08-21, option
   * 3: a closed lens touching a same-class mass from another family is one
   * mass and one body, no tie needed).
   */
  crossFamilyWelds: number
  /**
   * Loops whose dominant mass was not unique by overlap and needed the vertical
   * line to decide. His *"(should be the same if all onlaps and lenses are
   * emitted)"* says a remainder ought to have one owner; this counts where it
   * did not, so the case stays visible rather than being smoothed over.
   */
  splitRemainders: number
  /**
   * Litho cover left unclassified, in square metres, by WHY — the honest
   * accounting of what the fill does not know. ``noBands`` = nothing of this
   * family was ever derived on this gap's ground; ``afterEngine`` is retired
   * (no engine runs here any more) and stays 0; ``outsideBandRange`` = the
   * cover reached a level no test of the family read and no envelope covers.
   */
  residualAreaM2: { noBands: number; afterEngine: number; outsideBandRange: number }
  /**
   * THE TOTALITY TRIPWIRE — gaps with a banded run that still kept ground (see
   * ``fillTotality.ts``). Since the least-dense ruling of 2026-08-26 the fill
   * owns every square metre of such a gap, so a non-empty list here is a
   * DEFECT, not an accounting line.
   */
  totalityViolations: TotalityViolation[]
  /**
   * THE CLAMPED-EDGE TRIPWIRE — gaps that emit fill the 3-D build cannot read
   * at a column edge (see ``edgeReach.ts``). The build samples each gap two
   * snap cells inside its columns; a gap whose cover holds ground there and
   * whose classed faces hold none makes ``label_voxels`` drop this section's
   * contribution silently. Non-empty here is a DEFECT.
   */
  edgeReachViolations: EdgeReachViolation[]
}

/** The fill, ready for the render and the build. */
export interface HierarchicalGeotechFillResult {
  /**
   * The classed loops BEFORE the merge weld, single owning band each. The
   * merge repaints nothing, so audits that judge a band against its own 2/1/0
   * envelope read THIS surface (owner: "why don't you count balloons before
   * the fill merge step?"); the render reads ``regions``.
   */
  preMergeRegions: (SectionRegion & { role: 'construct' | 'fill' })[]
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
  // EVERY packing band per column, whatever family — *"follow tie ... check
  // litho and packing density on the other end"* reads the band on the same
  // side of the contact over there, and that band may belong to the
  // neighbouring family (a contact is shared).
  const stacks = new Map<number, RunBand[]>()
  for (let ci = 0; ci < input.geotechColumns.length; ci++) {
    stacks.set(ci, runBandsOf(input.geotechColumns[ci], ci, input.alongM[ci]))
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
  // A TIE ON A BAND'S OWN CONTACT COUNTS FOR THAT BAND (owner, 2026-08-21):
  // *"two ties is two tied contacts"* — and the tie he drew on the SF silt's
  // base is one of its two, even though the band at the other end sits in a
  // litho unit this family has no litho tie into. Dropping every cross-family
  // tie here (the old H5 rule) hid that second contact, and the SF read as a
  // one-tie onlap instead of the band he ruled it to be. The far end's family
  // is not consulted at all now: the per-run resolver keeps only the lines that
  // touch THIS family's own contacts, and the mass at the far end is read from
  // the actual band over there, whatever family owns it. (Debt #273's
  // silently-dropped ties: the half whose near end is in-family is resolved.)
  const boundingEdges = input.geotechEdges

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

  // WHICH FAMILIES HAVE COVER IN A GAP. The litho fill MERGES a same-soil
  // sandwich into one host region (an enclosed interbed of another soil between
  // two sands comes back as ONE sand region carrying only the upper unit's id),
  // so a unit can lose its cover to its own neighbour's family. Its bands would
  // then have nowhere to paint and the ground would read the OTHER unit's
  // classes at their own test's edge — the owner's arrow of 2026-08-20 at
  // GEO-23/125-S6. A family with no cover of its own in a gap therefore lends
  // its bands to the family whose cover encloses them (``adoptedBandsFor``).
  const familiesWithCoverByGap = new Map<number, Set<string>>()
  for (const family of families) {
    for (const gap of family.regionsByGap.keys()) {
      const set = familiesWithCoverByGap.get(gap)
      if (set === undefined) familiesWithCoverByGap.set(gap, new Set([family.id]))
      else set.add(family.id)
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

  // A band's MASS — *"same litho and packing density"*: the SOIL its parent
  // litho unit is, and its own packing class. The law compares nothing else.
  const lithoFormationOfUnit = new Map<string, string>()
  for (const column of input.lithoColumns) {
    for (const unit of column.units) lithoFormationOfUnit.set(unit.layerId, unit.formationId)
  }
  const massOf = (band: RunBand): Mass => ({
    litho: lithoFormationOfUnit.get(parentOfBand.get(band.layerId) ?? '') ?? '',
    // The CLASS when known, the row id when not — see ``packingClassOf`` above.
    packing: input.packingClassOf?.get(band.formationId) ?? band.formationId,
  })

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

  const lithoFallback: SectionRegion[] = [...unattributed]
  let singleColumnFamilies = 0
  let oneSidedGaps = 0
  let blockedColumns = 0
  const residualAreaM2 = { noBands: 0, afterEngine: 0, outsideBandRange: 0 }
  // PLAN every family first, THEN fill — the closure bars (see
  // ``closureBarsFor``) have to see every family's constructs before any
  // family fills, or a band adopted across a family boundary can be handed
  // remainder ground past a pinch it already made in the family it actually
  // belongs to (owner code-hunt finding F7, 2026-08-22).
  const allPlans: Omit<GapFillInput, 'closureBars'>[] = []
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
    const planned = planFamily(
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
        stacks,
        massOf,
        adoptedBandsFor: (gap, ci, lo, hi, soil) => {
          const out: RunBand[] = []
          for (const band of stacks.get(ci) ?? []) {
            const owner = familyOfBand.get(band.layerId)
            if (owner === undefined || owner === family.id) continue
            if (familiesWithCoverByGap.get(gap)?.has(owner) === true) continue
            const parent = parentOfBand.get(band.layerId)
            if (parent === undefined) continue
            if (lithoFormationOfUnit.get(parent) !== soil) continue
            if (band.top > hi + COVER_EPS || band.base < lo - COVER_EPS) continue
            out.push(band)
          }
          return out
        },
      },
    )
    allPlans.push(...planned.plans)
    lithoFallback.push(...planned.fallback)
    conflicts.push(...planned.conflicts)
    oneSidedGaps += planned.oneSidedGaps
    residualAreaM2.noBands += planned.residualNoBandsM2
  }
  const closureBars = closureBarsFor(allPlans, stacks, massOf)
  const filled = fillPlans(allPlans, closureBars, input.alongM, input.separatedPairs)
  const regions: SectionRegion[] = filled.regions
  const preMergeRegions: (SectionRegion & { role: 'construct' | 'fill' })[] = filled.preMerge
  lithoFallback.push(...filled.fallback)
  const levelFilledAreaM2 = filled.remainderAreaM2
  const splitRemainders = filled.splitRemainders
  residualAreaM2.outsideBandRange += filled.residualOutsideBandRangeM2

  // THE FILL SWEEP CROSSES FAMILIES (owner ruling 2026-08-21, option 3: one
  // mass one body, no tie needed) — see ``crossFamilyWeld.ts``.
  const swept = weldAcrossFamilies(
    regions,
    (formationId) => input.packingClassOf?.get(formationId) ?? formationId,
    input.separatedPairs,
  )
  const crossFamilyWelds = swept.welds
  // The build, the rendered cover, and clause 1 share this exact geometry.
  // A seam-cleanup pass may simplify a genuinely zero-area reversal for
  // drawing, but it must never discard a closed region from these surfaces:
  // that would make the geotech model smaller than the litho cover it derives
  // from while hiding the loss as "needle" debris.
  let sweptRegions = swept.regions
  let sweptFallback = lithoFallback
  const sweptPreMerge = preMergeRegions

  // NO HOLES IN THE MODEL (owner absolute). The constructive fill can, on rare
  // geometry, leave a litho-covered face unpainted — the installer #36 CS2 case: a
  // deep SILT unit under a carved ZAND lens whose shared-contact base tie makes its
  // band emit a sub-TD onlap the arrangement fails to trace. Close any such face
  // with the packing class the model already holds there, or the correlate-me hatch
  // when no band of that litho unit reaches the depth. A NO-OP where the fill already
  // covered the section (CS1 stays byte-identical). Runs on the SWEPT surface so the
  // build, the render and the gapless clauses all read the same closed geometry.
  const bandLithoFormation = new Map<string, string | undefined>()
  for (const column of input.geotechColumns) {
    for (const unit of column.units) {
      bandLithoFormation.set(
        unit.layerId,
        lithoFormationOfUnit.get(parentOfBand.get(unit.layerId) ?? ''),
      )
    }
  }
  const holes = fillGeotechHoles(
    input.lithoRegions,
    [...sweptRegions, ...sweptFallback],
    input.geotechColumns,
    input.alongM,
    bandLithoFormation,
  )
  if (holes.classed.length > 0) sweptRegions = [...sweptRegions, ...holes.classed]
  if (holes.fallback.length > 0) sweptFallback = [...sweptFallback, ...holes.fallback]

  return {
    regions: sweptRegions,
    preMergeRegions: sweptPreMerge,
    lithoFallback: sweptFallback,
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
      crossFamilyWelds,
      splitRemainders,
      residualAreaM2,
      totalityViolations: filled.totalityViolations,
      // Measured on the SWEPT surface — the payload carries exactly these
      // faces, so the tripwire watches what the build reads, not an
      // intermediate the needle sweep still had to touch.
      edgeReachViolations: edgeReachViolations(sweptRegions, input.lithoRegions, input.alongM),
    },
  }
}

