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
import { familyBands, floodFamilyCover, type FamilyBand, type FamilySource } from './familyFlood'
import { clearDeclaredMeetings, setDeclaredMeetings, type DeclaredMeeting } from '../partitionFillV2/declaredMeetings'
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
  /** Cover the family flood classified, in square metres (see ``familyFlood.ts``). */
  levelFilledAreaM2: number
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

/**
 * A meeting the LITHO model declares between two of a family's masses, on the FRAME's column
 * axis: the parent units are tied, so the bands under them meet even without their own packing
 * tie (owner ruling A). Mapped onto each run's own gap axis in ``runFamily``.
 */
interface FrameMeeting {
  leftColumn: number
  rightColumn: number
  leftBands: ReadonlySet<string>
  rightBands: ReadonlySet<string>
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
  declared: readonly FrameMeeting[] = [],
): AbsoluteRegion[] {
  if (indices.length < 2) return []
  const columns = indices.map((ci) => bandsOfFamily.get(ci) as PartitionColumn)
  const alongM = indices.map((ci) => input.alongM[ci])
  const ownLayerIds = new Set<string>()
  for (const column of columns) for (const unit of column.units) ownLayerIds.add(unit.layerId)
  const edges = input.geotechEdges.filter((e) => ownLayerIds.has(e.a) && ownLayerIds.has(e.b))

  const out: AbsoluteRegion[] = []
  // The parent model's declared meetings, on THIS run's own gap axis (see
  // ``declaredMeetings``). Cleared in a ``finally`` so a run can never leak into the next.
  const runDeclared: DeclaredMeeting[] = []
  for (const m of declared) {
    const a = indices.indexOf(m.leftColumn)
    const b = indices.indexOf(m.rightColumn)
    if (a < 0 || b < 0 || Math.abs(a - b) !== 1) continue
    runDeclared.push(
      a < b
        ? { gapIndex: a, left: m.leftBands, right: m.rightBands }
        : { gapIndex: b, left: m.rightBands, right: m.leftBands },
    )
  }
  const prevDeclared = setDeclaredMeetings(runDeclared)
  let answer: ReturnType<PartitionEngine>
  try {
    answer = compute(columns, edges, undefined, alongM)
  } finally {
    setDeclaredMeetings(prevDeclared)
    if (prevDeclared.length === 0) clearDeclaredMeetings()
  }
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

  // Every litho unit's own column and elevations — the litho tie's geometry, which the
  // family flood reads as the connective envelope of its soil cover (owner ruling A).
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
    // The litho ties inside this family, as meetings between the bands under their two units.
    // Litho approval carries down: the masses meet, and the fence between them is legitimate —
    // but they do not band, so a deleted packing tie is not resurrected (``declaredMeetings``).
    const meetings: FrameMeeting[] = []
    for (const edge of input.lithoEdges) {
      if (!family.lithoLayerIds.has(edge.a) || !family.lithoLayerIds.has(edge.b)) continue
      const ca = lithoColumnOfLayer.get(edge.a)
      const cb = lithoColumnOfLayer.get(edge.b)
      if (ca === undefined || cb === undefined || ca === cb) continue
      const bandsUnder = (parent: string, ci: number): Set<string> => {
        const out = new Set<string>()
        for (const unit of own.get(ci)?.units ?? []) {
          if (parentOfBand.get(unit.layerId) === parent) out.add(unit.layerId)
        }
        return out
      }
      const aBands = bandsUnder(edge.a, ca)
      const bBands = bandsUnder(edge.b, cb)
      if (aBands.size === 0 || bBands.size === 0) continue
      meetings.push(
        ca < cb
          ? { leftColumn: ca, rightColumn: cb, leftBands: aBands, rightBands: bBands }
          : { leftColumn: cb, rightColumn: ca, leftBands: bBands, rightBands: aBands },
      )
    }
    const absolute = runsBetweenBlockers(
      [...own.keys()].sort((a, b) => a - b),
      blockers,
    ).flatMap((run) => runFamily(input, run, own, compute, conflicts, meetings))
    // Every banded test of the family, at its along position — the flood's own
    // source set. It is the FAMILY's, not the gap's: a body whose only divided
    // test stands two gaps away is still the only thing that can fill its cover
    // (owner: "the only thing left that can flood that form is the MF silt to
    // the left"), and it can only ever paint that body's own classes.
    const floodSourcesByColumn: { ci: number; alongM: number; bands: ReturnType<typeof familyBands> }[] =
      [...own.entries()]
        .map(([ci, column]) => ({ ci, alongM: input.alongM[ci], bands: familyBands(column) }))
        .filter((s) => s.bands.length > 0 && Number.isFinite(s.alongM))
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

      // 2. Whatever the constructs left silent is flooded (``familyFlood.ts``):
      //    it adopts the family's own nearest banded test, whole, cut only at
      //    that test's boundaries, and takes that test's nearest band where it
      //    reaches past every one of them. With no banded test in the family
      //    anywhere, only a same-lithology band on this gap's own two tests can
      //    answer; with neither, nothing was ever derived here and the whole
      //    cover falls back.
      if (floodSourcesByColumn.length === 0) {
        lithoFallback.push(...clipped.residual)
        for (const r of clipped.residual) residualAreaM2.noBands += areaM2(r)
        continue
      }
      if (geotechInGap.length === 0) oneSidedGaps += 1
      // A band's REACH in this gap: its own extent unioned with the far end of every tie it
      // carries across the gap. A correlation is the statement that the band follows that line,
      // so the form the line closes is the band's to fill; an untied band reaches nowhere but
      // its own level. This is the same envelope the 2/1/0 conformance gate audits against.
      const reachOf = new Map<string, { top: number; base: number }>()
      /** The two columns THIS gap runs between, in either order. */
      const isGapPair = (a: number, b: number): boolean =>
        (a === gap && b === gap + 1) || (a === gap + 1 && b === gap)
      const elevOfBand = new Map<string, { top: number; base: number }>()
      for (const s of floodSourcesByColumn) {
        for (const b of s.bands) elevOfBand.set(b.layerId, { top: b.topElev, base: b.baseElev })
      }
      const onGapColumn = new Map<string, number>()
      for (const s of floodSourcesByColumn) {
        if (s.ci !== gap && s.ci !== gap + 1) continue
        for (const b of s.bands) onGapColumn.set(b.layerId, s.ci)
      }
      for (const edge of input.geotechEdges) {
        for (const [near, far, farSide] of [
          [edge.a, edge.b, edge.bSide],
          [edge.b, edge.a, edge.aSide],
        ] as const) {
          const nearCi = onGapColumn.get(near)
          const farCi = onGapColumn.get(far)
          if (nearCi === undefined || farCi === undefined || nearCi === farCi) continue
          const farElev = elevOfBand.get(far)
          if (farElev === undefined) continue
          const at = farSide === 'base' ? farElev.base : farElev.top
          const cur = reachOf.get(near)
          if (cur === undefined) reachOf.set(near, { top: at, base: at })
          else reachOf.set(near, { top: Math.max(cur.top, at), base: Math.min(cur.base, at) })
        }
      }
      // LITHO APPROVAL CARRIES DOWN (owner ruling A). A family IS a litho chain — it is built
      // from litho edges — so the litho tie is the statement that this SOIL cover is one
      // connected mass across the gap, and the family's bands may reach along it. Without this
      // a cover whose geotech restatement is absent — deleted by hand, or simply not derived
      // yet — falls apart: each flank's class closes as its own little loop and the middle of a
      // twice-tied band renders "correlate me", which is his dark clay quad between B6 and B4.
      //
      // This governs the SOIL cover only. The class banding still answers to the geotech ties
      // alone: a band reaching along a litho line meets the facing class, it does not merge
      // with it, so a tie he DELETED is never resurrected as a class band.
      for (const edge of input.lithoEdges) {
        for (const [near, far, farSide] of [
          [edge.a, edge.b, edge.bSide],
          [edge.b, edge.a, edge.aSide],
        ] as const) {
          // Both ends must be this family's own litho units, one on each of the gap's columns.
          if (!family.lithoLayerIds.has(near) || !family.lithoLayerIds.has(far)) continue
          const nearCi = lithoColumnOfLayer.get(near)
          const farCi = lithoColumnOfLayer.get(far)
          if (nearCi === undefined || farCi === undefined) continue
          if (!isGapPair(nearCi, farCi)) continue
          const farUnit = lithoUnitElev.get(far)
          if (farUnit === undefined) continue
          const at = farSide === 'base' ? farUnit.base : farUnit.top
          // Every band of the near unit inherits it: the whole unit is what was tied.
          for (const s of floodSourcesByColumn) {
            if (s.ci !== nearCi) continue
            for (const b of s.bands) {
              if (parentOfBand.get(b.layerId) !== near) continue
              const cur = reachOf.get(b.layerId)
              if (cur === undefined) reachOf.set(b.layerId, { top: at, base: at })
              else reachOf.set(b.layerId, { top: Math.max(cur.top, at), base: Math.min(cur.base, at) })
            }
          }
        }
      }
      const floodSources: FamilySource[] = floodSourcesByColumn.map((s) => ({
        alongM: s.alongM,
        bands: s.bands.map((b) => {
          const reach = reachOf.get(b.layerId)
          return reach === undefined
            ? b
            : { ...b, reachTopElev: reach.top, reachBaseElev: reach.base }
        }),
        flank: s.ci === gap || s.ci === gap + 1,
      }))
      // What each band's own construct already claims in this gap — the flood must not paint a
      // band again past the loop it drew (see ``hasClosedAt``).
      const closed = new Map<string, [number, number][]>()
      for (const r of clipped.covered) {
        let lo = Infinity
        let hi = -Infinity
        for (const p of r.polygon) {
          if (p.elevation < lo) lo = p.elevation
          if (p.elevation > hi) hi = p.elevation
        }
        for (const layerId of r.layerIds ?? []) {
          const list = closed.get(layerId)
          if (list === undefined) closed.set(layerId, [[lo, hi]])
          else list.push([lo, hi])
        }
      }
      const filled = floodFamilyCover(clipped.residual, floodSources, left, right, gap, closed)
      regions.push(...filled.covered)
      lithoFallback.push(...filled.residual)
      for (const r of filled.covered) levelFilledAreaM2 += areaM2(r)
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
      residualAreaM2,
    },
  }
}
