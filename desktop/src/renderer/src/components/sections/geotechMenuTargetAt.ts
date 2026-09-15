/**
 * Which geotech-menu surface sits under a point on the section canvas.
 *
 * WHY THIS EXISTS — the second right-click, and the collar gap (owner installer
 * #39: "i get 2 different menus when i right click once or right click twice on
 * a test, why not merge them?").
 *
 * The geotech axis used to open two independent menus: the band overlay's own
 * menu on a packing band, and the section's ColumnContextMenu on the collar gap.
 * Which one appeared depended on where the click landed. This resolver is the
 * geometry the unified menu re-aims with — the exact analogue of
 * ``lithoMenuTargetAt`` on the litho axis:
 *
 *   * the section's ``<svg>`` catch-all hands the overlay a gap right-click, and
 *     this says which column it lands on so the column-only menu can open;
 *   * while the menu is open its dismiss backdrop covers the canvas, so the
 *     browser can no longer hit-test the band beneath it — this resolves the
 *     point from the same geometry the bands were drawn from, so a second
 *     right-click re-opens the menu for whatever is under it.
 *
 * It returns INDICES rather than object references so it can stay pure and free
 * of the overlay's model types: the caller maps ``columnIndex`` / ``bandIndex``
 * / ``pairIndex`` / ``cardIndex`` back onto its own column models and menu-state
 * builders.
 *
 * Precedence mirrors the rendered stack: a boundary strip wins over the band
 * interior it sits on (the drag handle is painted on top), then a band, then a
 * borehole band, and failing all three the column card itself answers (the
 * collar gap / below-TD escape the column-only menu lives on). A point on no
 * column resolves to ``null`` and the caller dismisses.
 *
 * Pure: geometry only, no React and no DOM — see ``geotechMenuTargetAt.test.ts``.
 */

/** A packing band's screen-space vertical extent. */
export interface GeotechMenuBandExtent {
  /** Top of the band rect, SVG px. */
  topY: number
  /** Base of the band rect, SVG px. */
  baseY: number
}

/** One mergeable boundary strip's screen-space extent (drag + right-click). */
export interface GeotechMenuStripExtent {
  /** Top of the strip, SVG px. */
  top: number
  /** Bottom of the strip, SVG px. */
  bottom: number
}

/** A CPT column that carries editable packing bands + boundary strips. */
export interface GeotechMenuCptColumn {
  /** Left edge of the column card, SVG px. */
  x0: number
  /** Right edge of the column card, SVG px. */
  x1: number
  /** Band extents, shallow-to-deep (same order as the column's ``bands``). */
  bands: readonly GeotechMenuBandExtent[]
  /** Mergeable boundary strips (same order as the column's ``mergeable`` pairs). */
  strips: readonly GeotechMenuStripExtent[]
}

/** A borehole column that carries packing bands but no boundary strips. */
export interface GeotechMenuBhColumn {
  x0: number
  x1: number
  bands: readonly GeotechMenuBandExtent[]
}

/** Any placed column's horizontal footprint — the column-only escape. */
export interface GeotechMenuCard {
  x0: number
  x1: number
}

/** What the point resolved to; indices refer to the arrays passed in. */
export type GeotechMenuTarget =
  | { kind: 'cptBand'; columnIndex: number; bandIndex: number }
  | { kind: 'boundary'; columnIndex: number; pairIndex: number }
  | { kind: 'bhBand'; columnIndex: number; bandIndex: number }
  | { kind: 'column'; cardIndex: number }
  | null

/**
 * Resolve the geotech-menu target under a canvas point.
 *
 * @param cptColumns - The editable CPT columns (bands + boundary strips).
 * @param boreholeColumns - The borehole columns (bands only).
 * @param cards - Every placed column's horizontal footprint, for the
 *   column-only fallback (includes undivided columns the two above skip).
 * @param svgX - Point x in SVG coordinates.
 * @param svgY - Point y in SVG coordinates.
 * @param plotTop - Upper plot bound (px) — the column card's top edge.
 * @param plotBottom - Lower plot bound (px) — the column card's bottom edge.
 * @returns The target under the point, or ``null``.
 */
export function geotechMenuTargetAt(params: {
  cptColumns: readonly GeotechMenuCptColumn[]
  boreholeColumns: readonly GeotechMenuBhColumn[]
  cards: readonly GeotechMenuCard[]
  svgX: number
  svgY: number
  plotTop: number
  plotBottom: number
}): GeotechMenuTarget {
  const { cptColumns, boreholeColumns, cards, svgX, svgY, plotTop, plotBottom } = params

  // 1. CPT columns — a boundary strip wins over the band interior it sits on,
  //    exactly as the rendered strip (painted last) wins the press there.
  for (let ci = 0; ci < cptColumns.length; ci++) {
    const col = cptColumns[ci]
    if (svgX < col.x0 || svgX > col.x1) continue
    for (let pi = 0; pi < col.strips.length; pi++) {
      if (svgY >= col.strips[pi].top && svgY <= col.strips[pi].bottom) {
        return { kind: 'boundary', columnIndex: ci, pairIndex: pi }
      }
    }
    for (let bi = 0; bi < col.bands.length; bi++) {
      if (svgY >= col.bands[bi].topY && svgY <= col.bands[bi].baseY) {
        return { kind: 'cptBand', columnIndex: ci, bandIndex: bi }
      }
    }
  }
  // 2. Borehole columns — packing bands, no strips.
  for (let ci = 0; ci < boreholeColumns.length; ci++) {
    const col = boreholeColumns[ci]
    if (svgX < col.x0 || svgX > col.x1) continue
    for (let bi = 0; bi < col.bands.length; bi++) {
      if (svgY >= col.bands[bi].topY && svgY <= col.bands[bi].baseY) {
        return { kind: 'bhBand', columnIndex: ci, bandIndex: bi }
      }
    }
  }
  // 3. The column card itself — the collar gap / below-TD escape the
  //    column-only menu lives on. Any column the point falls within, banded
  //    or not, so a right-click anywhere on a test gives its menu.
  if (svgY >= plotTop && svgY <= plotBottom) {
    for (let ci = 0; ci < cards.length; ci++) {
      if (svgX >= cards[ci].x0 && svgX <= cards[ci].x1) {
        return { kind: 'column', cardIndex: ci }
      }
    }
  }
  return null
}
