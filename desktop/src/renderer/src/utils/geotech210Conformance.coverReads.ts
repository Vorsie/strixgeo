/**
 * THE AUDIT'S COVER-CONTACT READING — what ``coverWeld.ts`` answers, per band.
 *
 * Owner, 2026-08-26, shown CS1 gap 19's two top sands standing as two closed
 * loops with unclassed ground between them:
 *
 *   *"those top sands have an engine tie no? the tops of all tests are
 *    connected? follow the tie, same nad class, emit nothing...."*
 *
 * So a cover boundary whose far band is the same litho AND the same packing is
 * a TIED CONTACT. The 2/1/0 oracle has to know that or it reads every welded
 * band as an untied lens that painted its whole gap — which is exactly what it
 * did on the day the ruling landed, 17 sections of ``overreach`` whose first
 * entry was the ruling's own target.
 *
 * THIS MODULE DECIDES NOTHING. It marshals the inputs the way
 * ``geotechHierarchicalFill/index.ts`` marshals them — bands per column through
 * ``runBandsOf``, the mass as the parent unit's soil plus the packing class, the
 * cover's own lines through ``resolveRunTies`` over the LITHO edges, the run's
 * two banded tests as the bracket ``planFamily`` hands the constructor — and
 * then asks ``coverContactOf``. A second opinion written here is a place the
 * audit and the render can drift apart, which is the class of bug the gate
 * exists to catch.
 *
 * @module utils/geotech210Conformance.coverReads
 */

import {
  resolveRunTies,
  runBandsOf,
  tieElevAt,
  type RunBand,
  type RunColumn,
  type RunTie,
} from './geotechHierarchicalFill/constructive/constructs'
import { coverContactOf, type CoverContact } from './geotechHierarchicalFill/constructive/coverWeld'
import type { Mass } from './geotechHierarchicalFill/constructive/emitKernel'
import { CONTACT_EPS } from './geotechHierarchicalFill/constructive/farBand'
import type { PartitionColumn } from './sectionPartition'

/** One band's reading of ONE of its cover contacts across ONE gap. */
export interface CoverRead {
  /** Which contact of the band this is. */
  side: 'top' | 'base'
  /** *"same nad class"* — the contact is TIED for the law. */
  welds: boolean
  /**
   * The line the construct RIDES there (the engine's own ``ridesCover``:
   * a stored litho tie, or an implicit cover edge that welds), given at the
   * gap's two columns. Null where the contact holds the band's own flat level.
   *
   * It is a STRAIGHT CHORD, and the ground the band actually reaches is not:
   * a welded contact deliberately draws no line of its own, because *"its line
   * is the cover's own edge, which the arrangement already carries as a
   * cover-ring edge"* (``constructs.ts``) — and that ring is a POLYLINE. The
   * oracle therefore widens the ridden side to the cover ring's own extent as
   * well; see the balloon check in ``geotech210Conformance.audit.ts``.
   */
  line: [number, number] | null
}

/** What the reading needs to know about the section it runs on. */
export interface CoverReadContext {
  /** The geotech arm, on the litho frame's column axis. */
  columns: readonly PartitionColumn[]
  /** The litho frame's columns, 1:1 with {@link columns}. */
  lithoColumns: readonly PartitionColumn[]
  /** The litho model's APPROVED edges — the cover's own lines. */
  lithoEdges: readonly { a: string; b: string; aSide?: 'top' | 'base'; bSide?: 'top' | 'base' }[]
  /** Along-section metres, 1:1 with the frame's columns. */
  alongM: readonly number[]
  /** Formation row id → canonical packing class key. */
  classKeyOf: (formationId: string) => string
  /** Band ``layerId`` → litho family id. */
  familyOfBand: ReadonlyMap<string, string>
  /** Band ``layerId`` → parent litho unit ``layerId``. */
  parentOfBand: ReadonlyMap<string, string>
  /** Frame columns each family carries bands on. */
  bandedColumnsByFamily: ReadonlyMap<string, ReadonlySet<number>>
  /**
   * ``layerId|gap@mm`` of every contact a PACKING tie already bounds. Those are
   * the law's own ties and are counted there; the constructor asks the cover
   * only where ``topTie``/``baseTie`` came back null, and so does this.
   */
  packingTiedContacts: ReadonlySet<string>
}

/**
 * Every cover contact's reading, keyed ``layerId|gap``.
 *
 * @param context The section around the bands (see {@link CoverReadContext}).
 * @returns One entry per band+gap that has at least one cover contact to read,
 *   holding one {@link CoverRead} per contact.
 */
export function coverReadsOf(context: CoverReadContext): Map<string, CoverRead[]> {
  const out = new Map<string, CoverRead[]>()
  if (context.lithoColumns.length === 0) return out
  const { columns, lithoColumns, alongM } = context

  // EVERY packing band per column — the far-end read reaches the neighbouring
  // family's bands too, because a contact is shared.
  const stacks = new Map<number, RunBand[]>()
  for (let ci = 0; ci < columns.length; ci++) {
    stacks.set(ci, runBandsOf(columns[ci], ci, alongM[ci]))
  }
  // The same index over the LITHO units, so the cover's own boundaries resolve
  // into lines exactly as the packing ties do.
  const lithoBandOfLayer = new Map<string, RunBand>()
  const lithoFormationOfUnit = new Map<string, string>()
  const unitDepth = new Map<string, { top: number; base: number }>()
  for (let ci = 0; ci < lithoColumns.length; ci++) {
    const column = lithoColumns[ci]
    for (const unit of runBandsOf(column, ci, alongM[ci])) lithoBandOfLayer.set(unit.layerId, unit)
    for (const unit of column.units) {
      lithoFormationOfUnit.set(unit.layerId, unit.formationId)
      unitDepth.set(unit.layerId, { top: unit.topDepthM, base: unit.baseDepthM })
    }
  }
  // A band's MASS — *"same litho and packing density"*: the SOIL its parent
  // litho unit is, and its own packing class. The law compares nothing else.
  const massOf = (band: RunBand): Mass => ({
    litho: lithoFormationOfUnit.get(context.parentOfBand.get(band.layerId) ?? '') ?? '',
    packing: context.classKeyOf(band.formationId),
  })

  // Per family: its banded columns, each band told whether its contact sits ON
  // the family cover's own boundary. ``index.ts``'s COVER_EPS is this same 1e-6
  // contact tolerance, so the stamp is the constructor's own.
  const familyColumns = new Map<string, Map<number, RunColumn>>()
  for (let ci = 0; ci < columns.length; ci++) {
    const column = columns[ci]
    const byFamily = new Map<string, PartitionColumn['units'][number][]>()
    for (const unit of column.units) {
      const familyId = context.familyOfBand.get(unit.layerId)
      if (familyId === undefined) continue
      const list = byFamily.get(familyId)
      if (list === undefined) byFamily.set(familyId, [unit])
      else list.push(unit)
    }
    for (const [familyId, units] of byFamily) {
      let byIndex = familyColumns.get(familyId)
      if (byIndex === undefined) familyColumns.set(familyId, (byIndex = new Map()))
      byIndex.set(ci, {
        ci,
        x: alongM[ci],
        bands: runBandsOf(
          { investigationId: column.investigationId, surfaceElevM: column.surfaceElevM, units },
          ci,
          alongM[ci],
        ).map((band) => {
          const parent = context.parentOfBand.get(band.layerId)
          const unit = parent === undefined ? undefined : unitDepth.get(parent)
          if (unit === undefined) return band
          return {
            ...band,
            atCoverTop: Math.abs(band.top - (column.surfaceElevM - unit.top)) <= CONTACT_EPS,
            atCoverBase: Math.abs(band.base - (column.surfaceElevM - unit.base)) <= CONTACT_EPS,
          }
        }),
      })
    }
  }
  // The cover's own boundaries as lines, resolved per family over its banded
  // columns — the same call ``planFamily`` makes for each of its runs.
  const coverTiesOfFamily = new Map<string, RunTie[]>()
  for (const [familyId, byCi] of familyColumns) {
    const runColumns = [...byCi.keys()].sort((a, b) => a - b).map((ci) => byCi.get(ci) as RunColumn)
    coverTiesOfFamily.set(
      familyId,
      resolveRunTies(
        context.lithoEdges.map((e) => ({
          a: e.a,
          b: e.b,
          aSide: e.aSide ?? 'top',
          bSide: e.bSide ?? 'top',
        })),
        runColumns,
        lithoBandOfLayer,
      ).ties,
    )
  }

  for (let ci = 0; ci < columns.length; ci++) {
    for (const unit of columns[ci].units) {
      const familyId = context.familyOfBand.get(unit.layerId)
      const byCi = familyId === undefined ? undefined : familyColumns.get(familyId)
      if (familyId === undefined || byCi === undefined) continue
      const home = byCi.get(ci)
      const band = home?.bands.find((b) => b.layerId === unit.layerId)
      if (home === undefined || band === undefined) continue
      const banded = [...(context.bandedColumnsByFamily.get(familyId) ?? [])].sort((a, b) => a - b)
      const own = massOf(band)
      for (const gap of [ci - 1, ci].filter((g) => g >= 0 && g < columns.length - 1)) {
        // The RUN's two banded tests this ground lies between — the same bracket
        // the termination clause uses, and the pair ``planFamily`` hands the
        // constructor as ``run.left``/``run.right``.
        let lo = -1
        let hi = -1
        for (let k = 0; k + 1 < banded.length; k++) {
          if (banded[k] <= gap && banded[k + 1] >= gap + 1) {
            lo = banded[k]
            hi = banded[k + 1]
          }
        }
        if (lo < 0 || (ci !== lo && ci !== hi)) continue
        const facing = byCi.get(ci === lo ? hi : lo)
        if (facing === undefined) continue
        for (const side of ['top', 'base'] as const) {
          if ((side === 'top' ? band.atCoverTop : band.atCoverBase) !== true) continue
          const elevation = side === 'top' ? band.top : band.base
          const key = `${unit.layerId}|${gap}`
          if (context.packingTiedContacts.has(`${key}@${Math.round(elevation * 1000)}`)) continue
          const read = readCover(
            band,
            side,
            elevation,
            home,
            facing,
            own,
            massOf,
            stacks,
            coverTiesOfFamily.get(familyId) ?? [],
            lo,
            hi,
          )
          if (read === null) continue
          // ``ridesCover`` — a stored line is ridden whatever the far mass
          // reads (Ruling A), an implicit cover edge earns its line only by
          // welding. Either way it is a line the construct FOLLOWS, so the
          // balloon envelope has to carry it exactly as it carries a tie.
          const line: [number, number] | null =
            read.stored || read.welds
              ? [tieElevAt(read.tie, alongM[gap]), tieElevAt(read.tie, alongM[gap + 1])]
              : null
          const entry: CoverRead = { side, welds: read.welds, line }
          const list = out.get(key)
          if (list === undefined) out.set(key, [entry])
          else list.push(entry)
        }
      }
    }
  }
  return out
}

/**
 * ONE contact's cover reading — ``coverContactOf``, given the stored litho tie
 * on that contact when there is one.
 *
 * Where a contact carries a FAN of litho lines the constructor picks one by
 * ``tieOnContact``'s scoring, which is private to ``constructs.ts``. Rather than
 * keep a second copy of that scoring here — the very duplication this module
 * exists to avoid — every candidate is put to the ENGINE'S predicate and a
 * welding answer wins. The two readings can differ only on a contact carrying
 * several litho ties whose far ends read DIFFERENT masses; the choice there is
 * deliberately the lenient one, because a false ``overreach`` the engineer
 * cannot act on costs more than a missed one the ratchet catches the moment a
 * real defect lands beside it. Measured on the owner's fourteen sections: no
 * cover contact carries such a fan.
 */
function readCover(
  band: RunBand,
  side: 'top' | 'base',
  elevation: number,
  column: RunColumn,
  facing: RunColumn,
  own: Mass,
  massOf: (band: RunBand) => Mass,
  stacks: ReadonlyMap<number, readonly RunBand[]>,
  coverTies: readonly RunTie[],
  lo: number,
  hi: number,
): CoverContact | null {
  const candidates = coverTies.filter((tie) => {
    const spans = Math.min(tie.leftCi, tie.rightCi) <= lo && Math.max(tie.leftCi, tie.rightCi) >= hi
    if (!spans) return false
    return (
      (tie.leftCi === band.ci && Math.abs(tie.leftY - elevation) <= CONTACT_EPS) ||
      (tie.rightCi === band.ci && Math.abs(tie.rightY - elevation) <= CONTACT_EPS)
    )
  })
  let fallback: CoverContact | null = null
  for (const tie of candidates) {
    const read = coverContactOf(band, side, tie, column, facing, stacks, own, massOf)
    if (read !== null && read.welds) return read
    if (fallback === null) fallback = read
  }
  if (candidates.length > 0) return fallback
  return coverContactOf(band, side, null, column, facing, stacks, own, massOf)
}
