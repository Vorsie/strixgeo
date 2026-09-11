/**
 * Which litho-menu surface sits under a point on the section canvas.
 *
 * WHY THIS EXISTS — the second right-click (owner dogfeed 2026-09-11).
 *
 * While the litho menu is open it is covered by a full-viewport dismiss
 * backdrop, so the browser can no longer hit-test the canvas for us: the
 * second right-click lands on the backdrop, never on the band beneath it.
 * Before this existed the backdrop closed the menu and let the same event
 * bubble on to the section's catch-all, which opened the COLUMN menu — so the
 * engineer got a different menu on every other right-click, which is the bug
 * the owner reported ("i get two different menus if i right click once or
 * right click twice").
 *
 * The backdrop now resolves the point itself and re-opens the same menu for
 * whatever is under it, so a second right-click behaves exactly like a first.
 *
 * Pure: geometry only, no React and no DOM — see ``lithoMenuTargetAt.test.ts``.
 */

/** The band geometry the pick reads (a subset of the rendered band rect). */
export interface LithoMenuBand {
  /** Left edge of the band rect, SVG px. */
  x: number
  /** Top edge of the band rect, SVG px. */
  y: number
  /** Rect width (the full column-card width), SVG px. */
  width: number
  /** Rect height, SVG px. */
  height: number
  /**
   * Invisible hit strip donated by the band ABOVE (debt #158) — a thin band's
   * clickable area is topped up from its fat neighbours, and the pick must see
   * the same reachable area the rendered strips give the browser.
   */
  growTop: number
  /** Invisible hit strip donated by the band BELOW (debt #158). */
  growBottom: number
}

/** The column geometry the pick reads (a subset of ``PlacedColumn``). */
export interface LithoMenuColumn {
  /** Screen x of the column axis after spacing nudging, SVG px. */
  nudgedX: number
  /** Rendered card width, SVG px. */
  width: number
}

/** What the point resolved to. */
export type LithoMenuTarget<B, C> =
  | { kind: 'band'; band: B }
  | { kind: 'column'; column: C }
  | null

/**
 * Resolve the litho-menu target under a canvas point.
 *
 * Precedence mirrors the rendered stack: an accepted-unit band wins on its own
 * visible rect first, then on the hit area donated to it; failing both, the
 * column card itself answers (the per-column capture rect, which offers "Add
 * new suggestion here"). A point on no column resolves to ``null`` and the
 * caller dismisses.
 *
 * @param bands - The rendered accepted-unit bands, shallow-to-deep per column.
 * @param columns - The section's placed investigation columns.
 * @param svgX - Point x in SVG coordinates.
 * @param svgY - Point y in SVG coordinates.
 * @param plotTop - Upper plot bound (px) — the column card's top edge.
 * @param plotBottom - Lower plot bound (px) — the column card's bottom edge.
 * @returns The band or column under the point, or ``null``.
 */
export function lithoMenuTargetAt<B extends LithoMenuBand, C extends LithoMenuColumn>(params: {
  bands: readonly B[]
  columns: readonly C[]
  svgX: number
  svgY: number
  plotTop: number
  plotBottom: number
}): LithoMenuTarget<B, C> {
  const { bands, columns, svgX, svgY, plotTop, plotBottom } = params

  // 1. The visible band rect — what the engineer sees and aims at.
  for (const band of bands) {
    if (
      svgX >= band.x &&
      svgX <= band.x + band.width &&
      svgY >= band.y &&
      svgY <= band.y + band.height
    ) {
      return { kind: 'band', band }
    }
  }
  // 2. The donated hit strips (debt #158) — a thin band stays reachable.
  for (const band of bands) {
    if (
      svgX >= band.x &&
      svgX <= band.x + band.width &&
      svgY >= band.y - band.growTop &&
      svgY <= band.y + band.height + band.growBottom
    ) {
      return { kind: 'band', band }
    }
  }
  // 3. The column card itself — the no-band escape the add menu lives on.
  if (svgY >= plotTop && svgY <= plotBottom) {
    for (const column of columns) {
      if (Math.abs(svgX - column.nudgedX) <= column.width / 2) {
        return { kind: 'column', column }
      }
    }
  }
  return null
}
