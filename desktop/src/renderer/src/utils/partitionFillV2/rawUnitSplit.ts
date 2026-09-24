/**
 * partitionFillV2/rawUnitSplit.ts — RULING 8r: split a merged host back into its RAW picked
 * sub-pieces for termination emission (owner, 2026-07-19, paint-tool dogfeed on 23/125-S7's
 * middle clay, verbatim): "the middle clay should lens, i want the lines before the merge.
 * (first fill then merge remember)".
 *
 * THE PIPELINE-ORDER VIOLATION. ``sectionGeom.extractEnclosedLenses`` collapses a same-formation
 * sandwich (SILT-ZAND-SILT) into ONE merged SILT host BEFORE the termination sweep classifies it.
 * The sweep then classifies on the MERGED host [6.37..4.07] whose base 4.07 is tied — so the whole
 * merged SILT emits ONE corr-1 onlap rooted at the host TOP 6.37 (``oflankterm9`` at CS1 S7 gap5).
 * That is a line drawn on a MERGED host, exactly what 8r forbids.
 *
 * THE RAW SUB-PIECES. A merged host that spans one or more enclosed-lens intervals is the WELD of
 * the original picked pieces above / between / below those lenses. This module re-derives them —
 * WITHOUT re-resolving ties, because 8l(b) pins the tie inheritance structurally:
 *
 *   "enclosed interbeds SPLIT their host into visible pieces for the sweep — host-contact pieces
 *    inherit that contact's ties; interbed-cut contacts are untied."
 *
 * So of a host's raw pieces (top→base order):
 *   - the TOP piece inherits the host's TOP contact + its tie state; its base is an interbed-cut
 *     (untied — it is the lens top).
 *   - the BOTTOM piece inherits the host's BASE contact + its tie state; its top is interbed-cut.
 *   - any MIDDLE piece (between two lenses) has BOTH contacts interbed-cut → corr-0 by construction.
 *   - a host with NO enclosed-lens interval (an ordinary unit) is ITSELF the single piece — the
 *     merged unit is the raw unit, no split, byte-identical to today's per-``col.units`` sweep.
 *
 * At CS1 S7 gap5 this yields: raw u2-SILT [6.37..5.79] corr-0 → LENS (both contacts untied: 6.37 =
 * the KLEI-above base the host top rode UNTIED, 5.79 = the ZAND lens top, interbed-cut) + raw
 * u4-SILT [5.19..4.07] corr-1 → ONLAP rooted at its own top 5.19 (base 4.07 tied via tie0:5). The
 * 6.37-rooted merged-host onlap is GONE; the fill (a seeded paint bucket, ruling 8q — the raw seed
 * edges 6.37/5.79/5.19/4.07 already exist via ``emitColumnVerticals``' lens ID split) paints the
 * pieces; THEN the 8j post-fill merge welds the two touching SILT regions back into one body.
 *
 * WHY THE TIE STATE CAN BE INHERITED, NOT RE-RESOLVED. A merged host keeps ONE of its enclosing
 * units' identities (``extractEnclosedLenses`` grows ``above`` down over the lens, or ``below`` up),
 * so the host's own top/base contacts ARE the raw top-piece's top and the raw bottom-piece's base —
 * the SAME physical surfaces the ties resolved to. Splitting at the lens intervals restores the
 * interbed-cut contacts (never tied — a lens is uncorrelated by ``extractEnclosedLenses``'s own
 * ``!edgedLayerIds.has(lens.layerId)`` guard), so no re-resolution against a raw stack is needed.
 * The enclosed lens sub-piece ITSELF is emitted by ``emitEnclosedLensCurves`` (unchanged) and is
 * therefore NOT returned here — the sweep must not double-emit it.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { type EffectiveCorr, type TieRef } from './effectiveCorr'
import { type ColumnGeom, type EnclosedLens, type UnitGeom } from './sectionGeom'

/** Elevation tolerance (metres) for the split — matches the 1 mm arrangement snap grid. */
const SPLIT_EPS = 0.001

/**
 * ONE raw picked sub-piece of a (possibly merged) host, ready for the termination sweep. Carries
 * its own contact elevations + the tie state it INHERITS from the host per ruling 8l(b), plus the
 * merged host's index (``hostUnitIndex``) for the ``lensEnclosingMatrix`` / boundary-geometry reads
 * that still index the merged ``col.units`` (a raw piece's enclosing matrix is the host's).
 */
export interface RawSubPiece {
  /** The raw sub-piece as a unit (own contacts + the host's litho/body identity). */
  unit: UnitGeom
  /** The merged host's index on ``col.units`` (for geometry reads that index the merged stack). */
  hostUnitIndex: number
  /** Whether this piece is the host's FIRST-elevation piece (inherits the host top contact). */
  isTopPiece: boolean
  /** Whether this piece is the host's LAST-elevation piece (inherits the host base contact). */
  isBottomPiece: boolean
  /** The inherited effective corr for this piece (host tie on the inherited contact; else 0). */
  eff: EffectiveCorr
  /** Inherited DIRECT top-tie flag (``tiedFlags``) — drives the onlap SIDE. */
  directTop: boolean
  /** Inherited DIRECT base-tie flag. */
  directBase: boolean
}

/**
 * The enclosed-lens intervals of ``col`` that fall strictly INSIDE the host unit's span — the split
 * points. Sorted shallow→deep (higher elevation first). A host that contains none is not split.
 * A lens restricted to OTHER gaps (``emitGaps``, ruling 8v) does not cut the host in ``gapIndex``:
 * its interval is host material in this gap (stacked lenses, owner 2026-09-23 — the inner clays of
 * S8's comb are lenses toward S10, where the silt bands, and clay-band material toward S3).
 */
function lensIntervalsInHost(
  host: UnitGeom,
  enclosedLenses: readonly EnclosedLens[],
  gapIndex: number | undefined,
): { elHi: number; elLo: number }[] {
  const hostHi = Math.max(host.topElev, host.baseElev)
  const hostLo = Math.min(host.topElev, host.baseElev)
  return enclosedLenses
    .filter((el) => gapIndex === undefined || el.emitGaps === undefined || el.emitGaps.has(gapIndex))
    .map((el) => ({
      elHi: Math.max(el.lens.topElev, el.lens.baseElev),
      elLo: Math.min(el.lens.topElev, el.lens.baseElev),
    }))
    .filter((iv) => iv.elHi < hostHi + SPLIT_EPS && iv.elLo > hostLo - SPLIT_EPS && iv.elHi - iv.elLo > SPLIT_EPS)
    .sort((a, b) => b.elHi - a.elHi)
}

/**
 * Split ONE (possibly merged) host unit into its RAW picked sub-pieces (ruling 8r / 8l(b)), given
 * the host's effective corr + direct tie flags on the CURRENT side. Returns the pieces the sweep
 * must classify + draw — WITHOUT the enclosed-lens sub-intervals themselves (those are
 * ``emitEnclosedLensCurves``' job).
 *
 * When the host contains NO enclosed-lens interval, returns a SINGLE piece that is the host itself
 * with its own corr/flags unchanged — so an ordinary unit's emission is byte-identical to today's
 * per-``col.units`` sweep (the split is a no-op).
 *
 * Parameters
 * ----------
 * host : UnitGeom
 *     The merged host unit (or an ordinary unit) from ``col.units``.
 * hostUnitIndex : number
 *     Its index on ``col.units`` (threaded through for geometry reads that index the merged stack).
 * col : ColumnGeom
 *     The host's column (carries ``enclosedLenses``).
 * hostEff : EffectiveCorr
 *     The host's effective corr on this side (from ``effectiveCorrForSide`` — the classifier the
 *     sweep already computed for ``col.units``).
 * hostDirectTop, hostDirectBase : boolean
 *     The host's DIRECT top/base tie flags (from ``tiedFlags``) on this side.
 * gapIndex : number, optional
 *     The gap being emitted into; a lens whose ``emitGaps`` excludes it does not split the host here.
 *     Omitted = every enclosed lens splits (the pre-2026-09-23 behaviour).
 *
 * Returns
 * -------
 * RawSubPiece[]
 *     One entry per raw picked piece (top→base). Each carries the inherited tie state per 8l(b).
 */
export function splitHostIntoRawPieces(
  host: UnitGeom,
  hostUnitIndex: number,
  col: ColumnGeom,
  hostEff: EffectiveCorr,
  hostDirectTop: boolean,
  hostDirectBase: boolean,
  gapIndex?: number,
): RawSubPiece[] {
  const cuts = lensIntervalsInHost(host, col.enclosedLenses, gapIndex)
  if (cuts.length === 0) {
    // Ordinary unit — the host IS the raw unit. Single piece, corr/flags unchanged (no-op split).
    return [
      {
        unit: host,
        hostUnitIndex,
        isTopPiece: true,
        isBottomPiece: true,
        eff: hostEff,
        directTop: hostDirectTop,
        directBase: hostDirectBase,
      },
    ]
  }
  const hostHi = Math.max(host.topElev, host.baseElev)
  const hostLo = Math.min(host.topElev, host.baseElev)
  // Build the raw pieces as the host span MINUS the lens intervals (top→base), walking the cursor.
  const pieces: { top: number; base: number }[] = []
  let cursor = hostHi
  for (const cut of cuts) {
    if (cursor - cut.elHi > SPLIT_EPS) pieces.push({ top: cursor, base: cut.elHi }) // piece above this lens
    cursor = cut.elLo
  }
  if (cursor - hostLo > SPLIT_EPS) pieces.push({ top: cursor, base: hostLo }) // piece below the deepest lens
  const n = pieces.length
  return pieces.map((p, i) => {
    const isTopPiece = i === 0
    const isBottomPiece = i === n - 1
    // RULING 8l(b): host-contact pieces inherit that contact's ties; interbed-cut contacts are
    // untied. The TOP piece keeps the host's TOP tie state; the BOTTOM piece keeps the host's BASE
    // tie state; every other contact (a lens interface) is UNTIED.
    const topTied = isTopPiece ? hostEff.topTied : false
    const baseTied = isBottomPiece ? hostEff.baseTied : false
    const topTie: TieRef | null = isTopPiece ? hostEff.topTie : null
    const baseTie: TieRef | null = isBottomPiece ? hostEff.baseTie : null
    // Literal corr = number of the piece's OWN contacts tied (ruling 8l). A raw piece's tie(s) are
    // always REAL ties inherited from the host contact (an interbed lens is uncorrelated), so a
    // corr count from the boolean flags matches the literal rule.
    const corr: 0 | 1 | 2 = (topTied ? 1 : 0) + (baseTied ? 1 : 0) === 2 ? 2 : topTied || baseTied ? 1 : 0
    const eff: EffectiveCorr = { topTied, baseTied, corr, topTie, baseTie }
    return {
      unit: {
        layerId: host.layerId,
        formationId: host.formationId,
        bodyId: host.bodyId,
        topElev: p.top,
        baseElev: p.base,
      },
      hostUnitIndex,
      isTopPiece,
      isBottomPiece,
      eff,
      directTop: isTopPiece ? hostDirectTop : false,
      directBase: isBottomPiece ? hostDirectBase : false,
    }
  })
}
