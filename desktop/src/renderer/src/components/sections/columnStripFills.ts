/**
 * The fill paints THROUGH the column cards (owner dogfeed 2026-08-14: "Litho
 * fill still only present between columns" / "same transparency everywhere
 * plz").
 *
 * The partition is per-gap, so its regions stop at the card edges by
 * construction. This helper turns each column's OWN stack — the same
 * ``PartitionColumn`` array the gap engine consumes, so litho on the litho
 * axis, packing bands on the geotech axis, litho again under "Show litho
 * fill" — into full-card-width screen quads. The overlay pushes them into the
 * SAME dissolved fill layer as the gap regions: a dissolved path composites
 * its coverage once, so the fill physically cannot read brighter or dimmer
 * over a card than in the gap beside it.
 *
 * On the geotech axis a column the subdivision has not reached has an empty
 * primary stack; the litho frame's stack for that column steps in
 * (``source: 'fallback'`` — the caller colours those with the LITHO colour
 * map), mirroring the gap fill's own litho-fallback rule.
 *
 * Pure: no React, no DOM — see ``columnStripFills.test.ts``.
 */

import type { PartitionColumn } from '../../utils/sectionPartition'
import type { ColumnScreen } from './partitionFillOverlayHelpers'

/** The column identity + screen-edge maps one partition assembly produced. */
export interface ColumnStripInput {
  /** Along-ordered investigation ids. */
  orderedInvs: readonly string[]
  /** Investigation id → its gap-free unit stack. */
  colByInv: ReadonlyMap<string, PartitionColumn>
  /** Investigation id → its card's screen x-edges. */
  screenByInv: ReadonlyMap<string, ColumnScreen>
}

/** One card-wide fill quad for a single unit of a column's stack. */
export interface ColumnStripQuad {
  /** The column the quad sits on. */
  investigationId: string
  /** The unit's formation — keys the colour + the dissolve identity. */
  formationId: string
  /**
   * The source unit's ``litho_layer.id`` — the un-join spotlight anchor (debt
   * #278 D3). Hovering "Ontkoppelen van X" carries body X's anchor layer id; an
   * on-column strip whose ``layerId`` matches must light with the between-column
   * regions, not just dim. A fallback (litho-frame) strip carries a LITHO layer
   * id, which a geotech anchor never matches — so it correctly never lights.
   */
  layerId: string
  /** Which stack supplied it: the axis's own, or the litho frame's. */
  source: 'primary' | 'fallback'
  /** Closed screen-space ring (no repeated last point). */
  pts: Array<{ x: number; y: number }>
}

/**
 * Build the card-covering fill quads for every column of the partition.
 *
 * @param primary - The ACTIVE partition's column assembly (what the gap fill
 *   is computed from).
 * @param fallback - The litho frame's assembly, or ``null`` off the geotech
 *   axis. Consulted only for columns whose primary stack is empty.
 * @param levelToScreen - Elevation-to-pixel vertical transform.
 * @param plotTop - Upper plot bound (px) — quads are trimmed to it.
 * @param plotBottom - Lower plot bound (px).
 * @returns Quads in column order, each unit shallow-to-deep.
 */
export function buildColumnStripFills(
  primary: ColumnStripInput,
  fallback: ColumnStripInput | null,
  levelToScreen: (level: number) => number,
  plotTop: number,
  plotBottom: number,
): ColumnStripQuad[] {
  const out: ColumnStripQuad[] = []

  for (const inv of primary.orderedInvs) {
    const primaryCol = primary.colByInv.get(inv)
    const usePrimary = primaryCol !== undefined && primaryCol.units.length > 0
    const col = usePrimary ? primaryCol : fallback?.colByInv.get(inv)
    if (!col || col.units.length === 0) continue

    // Card edges come from whichever assembly supplied the stack; both map the
    // same placedColumns, so they agree — the primary's is just usually there.
    const screen = primary.screenByInv.get(inv) ?? fallback?.screenByInv.get(inv)
    if (!screen) continue

    for (const unit of col.units) {
      const yA = levelToScreen(col.surfaceElevM - unit.topDepthM)
      const yB = levelToScreen(col.surfaceElevM - unit.baseDepthM)
      // Trim to the plot window rather than dropping a straddling unit.
      const yTop = Math.max(Math.min(yA, yB), plotTop)
      const yBase = Math.min(Math.max(yA, yB), plotBottom)
      if (yBase <= yTop) continue

      out.push({
        investigationId: inv,
        formationId: unit.formationId,
        layerId: unit.layerId,
        source: usePrimary ? 'primary' : 'fallback',
        pts: [
          { x: screen.leftX, y: yTop },
          { x: screen.rightX, y: yTop },
          { x: screen.rightX, y: yBase },
          { x: screen.leftX, y: yBase },
        ],
      })
    }
  }
  return out
}
