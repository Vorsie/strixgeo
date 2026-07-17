/**
 * partitionFillV2/emitSubstrate.ts — deep-to-deep SUBSTRATE bridge curves
 * (design partition-engine-v2.md §4 "Deep-to-deep substrate", owner §8 Q3).
 *
 * Below a shallow test's TD the section has no drilled data; the deep
 * stratigraphy is only known at the DEEP anchor columns bracketing the shallow
 * run. Where the engineer drew a JUMP TIE (a correlation edge spanning ≥ 2
 * columns — a non-adjacent tie), that tie is the explicit statement "this deep
 * contact continues from the left anchor to the right anchor". v2 turns each such
 * jump tie into a BRIDGE CURVE: a polyline from the left anchor's tied contact,
 * passing through every intervening column's x at the along-section-interpolated
 * elevation, to the right anchor's tied contact.
 *
 * The arrangement then traces the sub-TD region as ordinary faces: above an
 * intervening shallow column's TD the column's OWN contacts bound the faces
 * (the bridge is clipped/overlaid by real data there); BELOW that TD the bridge
 * curves + the deep anchors' column verticals form the deep bands. A strip below
 * a shallow TD with NO jump tie bracketing it gets no bridge curve → it stays an
 * open (unfilled) region (owner §8 Q3: bridge-less strips stay empty).
 *
 * This is the v2 replacement for v1 ``computeSpanningBands`` (the
 * ``computeBracketSubstrate`` semantics referenced in design §4): same
 * "fill only between bracketing deep anchors, interpolated by real alongM"
 * behaviour, expressed as curves the planar arrangement consumes rather than
 * pre-clipped polygons.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { type SectionInput } from './sectionGeom'
import { type InputCurve, type Point } from './types'

/**
 * Key for a bridge-anchored column contact: ``ci|ui|top`` or ``ci|ui|base``.
 * A contact that is a jump-tie (bridge) endpoint is anchored — the substrate
 * bridge already provides its boundary, so ``emitIntervals`` must NOT also tile a
 * competing lens/onlap closing for the unit that owns it (the deep anchor units
 * would otherwise pinch to a lens apex into the gap instead of banding across the
 * bridge — the CS1 gap-7 sub-TD lens-vacancy bug).
 */
export function bridgeAnchorKey(ci: number, ui: number, contact: 'top' | 'base'): string {
  return `${ci}|${ui}|${contact}`
}

/**
 * Key for a bridge-anchored contact SCOPED to the gap+side the bridge spans TOWARD:
 * ``gapIndex|side|ui|contact`` (ruling 8i(e), 2026-07-17 — "a bridge's ANCHORED contacts
 * are tied … per the rules").
 *
 * A jump tie ties its two ANCHORED endpoints toward each other: the LO anchor (the left
 * of the two columns) is tied looking RIGHT into its own gap (``gapIndex = loCi``, side
 * ``left``); the HI anchor is tied looking LEFT into the gap on its left (``gapIndex =
 * hiCi - 1``, side ``right``). A pass-through column the bridge crosses WITHOUT anchoring
 * stays untied on both sides (its units lens). Unlike ``bridgeAnchorKey`` (which is
 * direction-blind and is the sweep's SUPPRESSION lookup + the seam path's bracket lookup),
 * this directional key feeds the 2/1/0 arithmetic so a bridge-anchored contact reads TIED
 * (→ corr 1 → onlap riding the bridge) only on the side the bridge spans toward.
 */
export function bridgeGapAnchorKey(
  gapIndex: number,
  side: 'left' | 'right',
  ui: number,
  contact: 'top' | 'base',
): string {
  return `${gapIndex}|${side}|${ui}|${contact}`
}

/**
 * Emit deep-to-deep substrate bridge curves for every jump tie (a correlation
 * edge whose two endpoints sit on NON-adjacent columns). Appends to ``out``.
 *
 * A jump tie's endpoint elevation is side-aware (``top`` → the unit's top
 * contact, ``base`` → its base). The bridge is a straight line in along-metres ×
 * elevation from the left anchor's contact to the right anchor's, sampled at
 * every intervening column x so the arrangement has a vertex there (letting each
 * shallow column's own verticals split the bridge at its footprint).
 *
 * Parameters
 * ----------
 * section : SectionInput
 *     The normalised section (columns carry elevations + x; edges are raw).
 * out : InputCurve[]
 *     Curve accumulator (appended to).
 * anchored : Set<string>
 *     Populated with a ``bridgeAnchorKey`` per bridge endpoint contact (both the
 *     lo and hi anchor's tied contact, plus the derived-base rule: a top anchor on
 *     unit k also anchors the base of unit k−1). ``emitIntervals`` skips a unit that
 *     owns an anchored contact.
 */
export function emitSubstrateBridges(
  section: SectionInput,
  out: InputCurve[],
  anchored: Set<string>,
  gapAnchored?: Set<string>,
): void {
  const { columns } = section
  // Register a bridge endpoint contact + the derived base of the unit above it
  // (a top contact IS the base of the unit immediately shallower). ``gapDir`` is the
  // (gap, side) the bridge spans TOWARD from this anchor (ruling 8i(e)); when supplied it
  // ALSO registers the directional key so the 2/1/0 arithmetic reads the contact tied only
  // toward the span (the near column is corr 1 → onlap; pass-through columns stay untied).
  const anchor = (
    ci: number,
    ui: number,
    side: 'top' | 'base',
    gapDir?: { gapIndex: number; side: 'left' | 'right' },
  ): void => {
    anchored.add(bridgeAnchorKey(ci, ui, side))
    if (side === 'top' && ui > 0) anchored.add(bridgeAnchorKey(ci, ui - 1, 'base'))
    if (gapAnchored && gapDir) {
      gapAnchored.add(bridgeGapAnchorKey(gapDir.gapIndex, gapDir.side, ui, side))
      if (side === 'top' && ui > 0) {
        gapAnchored.add(bridgeGapAnchorKey(gapDir.gapIndex, gapDir.side, ui - 1, 'base'))
      }
    }
  }
  // layerId → {colIndex, unitIndex} so a raw edge resolves to a concrete contact.
  const layerLoc = new Map<string, { ci: number; ui: number }>()
  for (let ci = 0; ci < columns.length; ci++) {
    for (let ui = 0; ui < columns[ci].units.length; ui++) {
      layerLoc.set(columns[ci].units[ui].layerId, { ci, ui })
    }
  }

  let seq = 0
  for (const e of section.edges) {
    const la = layerLoc.get(e.a)
    const lb = layerLoc.get(e.b)
    if (!la || !lb) continue // endpoint not in this section
    const span = Math.abs(la.ci - lb.ci)
    if (span < 2) continue // adjacent (or same) → an ordinary tie, not a bridge

    const loLoc = la.ci < lb.ci ? la : lb
    const hiLoc = la.ci < lb.ci ? lb : la
    const loSide = (la.ci < lb.ci ? e.aSide : e.bSide) ?? 'top'
    const hiSide = (la.ci < lb.ci ? e.bSide : e.aSide) ?? 'top'
    const loU = columns[loLoc.ci].units[loLoc.ui]
    const hiU = columns[hiLoc.ci].units[hiLoc.ui]
    const loX = columns[loLoc.ci].x
    const hiX = columns[hiLoc.ci].x
    const loElev = loSide === 'top' ? loU.topElev : loU.baseElev
    const hiElev = hiSide === 'top' ? hiU.topElev : hiU.baseElev
    if (Math.abs(hiX - loX) < 1e-9) continue

    // Mark both anchor contacts so emitIntervals does not tile a competing cell. The LO
    // anchor is tied looking RIGHT into gap ``loLoc.ci`` (side left); the HI anchor looking
    // LEFT into gap ``hiLoc.ci - 1`` (side right) — the directions the bridge spans toward
    // (ruling 8i(e)). Only meaningful when the anchor's gap exists (span ≥ 2 guarantees it).
    anchor(loLoc.ci, loLoc.ui, loSide, { gapIndex: loLoc.ci, side: 'left' })
    anchor(hiLoc.ci, hiLoc.ui, hiSide, { gapIndex: hiLoc.ci - 1, side: 'right' })

    // Sample the straight bridge line at every column x in [loLoc..hiLoc] so the
    // arrangement gets a vertex at each intervening column footprint — that vertex
    // is where the shallow column's own verticals split the bridge into the
    // above-TD (real data owns it) and below-TD (bridge owns it) portions.
    const points: Point[] = []
    for (let ci = loLoc.ci; ci <= hiLoc.ci; ci++) {
      const x = columns[ci].x
      const t = (x - loX) / (hiX - loX)
      points.push({ x, y: loElev + t * (hiElev - loElev) })
    }
    out.push({ id: `bridge${seq++}:${loLoc.ci}-${hiLoc.ci}`, kind: 'tie', points })
  }
}
