/**
 * partitionFillV2/tiedRawPiece.ts — the TIED raw pieces of a merged run that came apart, as the
 * termination sweep sees them in one gap (owner 2026-09-27, section "test", GEO-08/118-S8 toward
 * GEO-08/118-S10: *"the silt lenses get a clay lens/wedge to the left"*).
 *
 * S8's clay comb (clay / silt / clay / silt / clay / silt / clay) is one clay host with the silt raw
 * pieces as enclosed lenses (``edgedEnclosedLens``). Toward S10 its TOP silt piece (2.78..2.13) is
 * tied — its top to S10's silt top — so there it is neither a lens nor host material: by plain 2/1/0
 * it is a one-tie unit and onlaps to the halfway point of that tie. The host's raw split cuts it out
 * of the host in that gap (``rawUnitSplit.cutsHostInGap``); this module hands the sweep the piece
 * and its OWN tie state, read from the gap's resolved ties at the piece's own contact elevations
 * (the tie endpoints are the raw picked contacts, ruling 8r, so they match exactly).
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { type TieRef, type EffectiveCorr } from './effectiveCorr'
import { type ResolvedTie } from './emitCurves'
import { type LensLabel } from './emitLenses'
import { type ColumnGeom, type EnclosedLens, type UnitGeom } from './sectionGeom'

/** Elevation tolerance (metres) for a tie endpoint on a piece's contact — the raw contacts are exact. */
const CONTACT_EPS = 1e-6

/**
 * The comb host a termination is drawn inside (``drawTermination``'s ``combHost``): the host's label
 * floods the onlap's wedge, and ``ownTie`` marks a TIED raw piece of the run, which always onlaps.
 */
export interface CombHost {
  matrix: LensLabel
  ownTie: boolean
}

/**
 * The comb host for a unit of ``col.units`` — set when the unit is one of the two clay units that
 * wrap a merged run that came apart (``UnitGeom.wrapsCameApartRun``), else ``undefined``.
 *
 * Parameters
 * ----------
 * unit : UnitGeom
 *     A (possibly merged) unit of the terminating column.
 * ownTie : boolean
 *     Whether the termination being drawn is a tied raw piece of the run.
 *
 * Returns
 * -------
 * CombHost | undefined
 *     The host label + flag, or ``undefined`` outside a comb.
 */
export function combHostOf(unit: UnitGeom, ownTie: boolean): CombHost | undefined {
  if (!unit.wrapsCameApartRun) return undefined
  return { matrix: { formationId: unit.formationId, bodyId: unit.bodyId }, ownTie }
}

/**
 * The enclosed lenses of ``col`` that are TIED raw pieces in ``gapIndex`` and lie inside ``host``.
 *
 * Parameters
 * ----------
 * col : ColumnGeom
 *     The terminating column (carries ``enclosedLenses``).
 * host : UnitGeom
 *     One merged host unit of ``col.units``.
 * gapIndex : number
 *     The gap the sweep is emitting into.
 *
 * Returns
 * -------
 * EnclosedLens[]
 *     The tied pieces inside the host (possibly empty).
 */
export function tiedPiecesInHost(col: ColumnGeom, host: UnitGeom, gapIndex: number): EnclosedLens[] {
  const hi = Math.max(host.topElev, host.baseElev)
  const lo = Math.min(host.topElev, host.baseElev)
  return col.enclosedLenses.filter(
    (el) =>
      (el.tiedGaps?.has(gapIndex) ?? false) &&
      el.lens.topElev <= hi + CONTACT_EPS &&
      el.lens.baseElev >= lo - CONTACT_EPS,
  )
}

/**
 * A tied piece's OWN 2/1/0 tie state in one gap: which of its two contacts carries a tie endpoint of
 * this gap on its own column, and the exact resolved tie it rides (the ``TieRef`` the onlap follows).
 *
 * Parameters
 * ----------
 * piece : UnitGeom
 *     The raw piece (its own contact elevations).
 * side : 'left' | 'right'
 *     Which column of the gap the piece lives on.
 * gapIndex : number
 *     The gap.
 * activeTies : readonly ResolvedTie[]
 *     The section's active ties.
 *
 * Returns
 * -------
 * EffectiveCorr
 *     The piece's tie flags, the literal count, and the exact tie refs.
 */
export function tiedPieceCorr(
  piece: UnitGeom,
  side: 'left' | 'right',
  gapIndex: number,
  activeTies: readonly ResolvedTie[],
): EffectiveCorr {
  const refAt = (elev: number, ownContact: 'top' | 'base'): TieRef | null => {
    for (const t of activeTies) {
      if (t.gapIndex !== gapIndex) continue
      const near = side === 'left' ? t.left : t.right
      if (Math.abs(near.y - elev) < CONTACT_EPS) return { kind: 'resolved', tie: t, ownContact }
    }
    return null
  }
  const topTie = refAt(piece.topElev, 'top')
  const baseTie = refAt(piece.baseElev, 'base')
  const topTied = topTie !== null
  const baseTied = baseTie !== null
  const corr: 0 | 1 | 2 = topTied && baseTied ? 2 : topTied || baseTied ? 1 : 0
  return { topTied, baseTied, corr, topTie, baseTie }
}
