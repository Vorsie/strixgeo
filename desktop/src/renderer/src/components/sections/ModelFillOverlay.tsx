/**
 * ModelFillOverlay — SVG overlay that fills the litho cross-section with
 * body-coloured bands derived from the 3D solid model.
 *
 * Two render modes are supported:
 *
 *   **Mode A** (``columns`` prop) — the consumer passes ``SolidColumn[]``
 *   produced by ``sampleSolidColumns`` (vertical ray sampling of body meshes at
 *   each test location).  Adjacent columns that share the same ``bodyId`` are
 *   connected into a single filled band polygon: a top chain (each column's
 *   ``topElev`` left→right) plus a base chain (``baseElev`` right→left), closed.
 *   A body present at fewer than 2 columns cannot form a band and is skipped.
 *
 *   **Mode B** (``polys`` prop) — the consumer passes ``SectionPoly[]`` produced
 *   by ``sliceSolidsAtPlane`` then resolved by ``resolveModelFillPolys``.  Each
 *   poly is rendered as a single closed filled path with ``fillRule="evenodd"``:
 *   its exterior ring is the band outline and every ``holes`` inner ring is
 *   punched out so an ENCLOSED higher-priority body (a clay lens inside a sand
 *   slab) shows through instead of being re-covered by a solid fill.
 *
 * This overlay is presentational, with ONE gesture (owner ruling S6,
 * 2026-08-27: "right click a fill region only works for normal fill, not
 * model fill"):
 *   - When ``onShowUnitStatistics`` is wired, every fill element answers a
 *     right-click with the shared "Unit statistics…" menu, reporting the
 *     region's FORMATION id — the same identity the colouring keys on. The
 *     caller stamps the axis's scope kind in the handler, exactly as on the
 *     computed fill.
 *   - Without the handler, every element keeps ``pointerEvents="none"`` so
 *     the overlay never intercepts gestures intended for overlays below or
 *     above it — byte-identical to the pre-S6 render.
 *   - All horizontal positions go through the ``alongMToScreenX`` callback — this
 *     is the warped/spacing-aware screen transform (never raw along-distance).
 *   - All vertical positions go through ``levelToScreen``.
 *
 * Mount it as a sibling of ``PartitionFillOverlay`` inside the section SVG,
 * beneath interactive overlays.
 */

import { useState } from 'react'

import type { SectionPoly, SolidColumn } from '../../utils/sectionFromSolids'
import { CONFIDENCE_FALLOFF_M, distanceAlphaMultiplier } from '../../utils/distanceConfidence'
import { forwardContextMenuToColumn } from './forwardColumnContextMenu'
import UnitStatisticsPortalMenu, { type UnitStatsMenuState } from './UnitStatisticsPortalMenu'

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * Props for ModelFillOverlay.
 *
 * @property columns         - Mode A: column segments from ``sampleSolidColumns``.
 *                             When provided, the overlay groups segments by body
 *                             and renders one band polygon per body spanning ≥2
 *                             columns.
 * @property polys           - Mode B: closed ring polygons from
 *                             ``sliceSolidsAtPlane``.  Each poly renders as one
 *                             filled ``<path>``.  When BOTH ``polys`` and
 *                             ``columns`` are provided, ``polys`` (Mode B) takes
 *                             precedence — the consumer passes exactly one.
 * @property alongMToScreenX - Warp/spacing-aware transform: along-section
 *                             distance (m) → SVG screen x (px).  MUST be called
 *                             for every x coordinate — never use raw along values
 *                             as coordinates.
 * @property levelToScreen   - Elevation (m, map CRS) → SVG screen y (px).
 * @property opacity         - Fill opacity applied to every body band (0–1).
 * @property columnLayoutByTestId - Mode A only: the rendered column geometry
 *                             (screen centre x + width px) keyed by test id, so
 *                             each per-test strip spans the WHOLE investigation
 *                             column and sits exactly on its litho band. Taken
 *                             from the section's ``placedColumns`` (``nudgedX`` /
 *                             ``width``). When a test has no entry, the strip
 *                             falls back to ``testStripWidthPx`` centred on
 *                             ``alongMToScreenX(alongM)``.
 * @property testStripWidthPx - Mode A fallback: pixel width of the per-test
 *                             strip when no column layout is supplied. Defaults
 *                             to ``DEFAULT_TEST_STRIP_WIDTH_PX``.
 * @property confidenceFade  - When true, each fill element's opacity is scaled
 *                             by its along-section distance to the nearest
 *                             investigation (``columnAlongMs``): full on top of a
 *                             test, fading to the low-confidence alpha at
 *                             ``confidenceFalloffM``. Mirrors the geology TIN
 *                             confidence fade for the litho model. Mode-A strips
 *                             sit on the test, so they never fade.
 * @property columnAlongMs   - Along-section positions (m) of the section's
 *                             investigations, the distance metric for the fade.
 * @property confidenceFalloffM - Distance (m) at which the fade reaches the
 *                             floor. Defaults to ``CONFIDENCE_FALLOFF_M``.
 */
export interface ModelFillOverlayProps {
  columns?: SolidColumn[]
  polys?: SectionPoly[]
  alongMToScreenX: (alongM: number) => number
  levelToScreen: (elev: number) => number
  opacity: number
  columnLayoutByTestId?: Record<string, { centerX: number; width: number }>
  testStripWidthPx?: number
  confidenceFade?: boolean
  columnAlongMs?: readonly number[]
  confidenceFalloffM?: number
  /**
   * "Unit statistics…" for a right-clicked model-fill region (owner ruling
   * S6, 2026-08-27). Reports the region's FORMATION id; the caller stamps
   * the axis's scope kind (geotech axis → geotech unit, litho axis → litho
   * unit). The second argument is the clicked element's BODY — a built solid
   * genuinely carries one (``LithoBodySolidResponse.body_id`` = BodyOrm.id),
   * threaded per the 2026-08-27 body-scope ruling. CAVEAT the caller should
   * know: the voxel build's alias pass can weld several resolver bodies into
   * one mesh stamped with a single representative ``body_id`` (the deliberate
   * asymmetry in docs/design/body-model.md), so the reported body is the
   * solid's stamp, which is a real body but may not cover the whole painted
   * area. Absent → the overlay stays purely presentational, every element
   * ``pointerEvents="none"``.
   */
  onShowUnitStatistics?: (formationId: string, bodyId?: string | null) => void
  /**
   * When true (the litho axis, installer #40), a right-click that lands on a
   * COLUMN is forwarded to the ContactsLayer column surface beneath so the
   * unified column menu opens instead of this overlay's "Unit statistics…" —
   * the owner's rule that a right-click over a column always opens the column
   * menu, whatever fill is painted; the fill's own menu is for the gaps BETWEEN
   * columns only. A right-click between columns still opens "Unit statistics…".
   * Absent / false → the overlay always answers with its own menu (the geotech
   * axis, whose per-column band menu does not exist).
   */
  forwardColumnContextMenu?: boolean
}

/**
 * Opacity multiplier for one fill element at along-section position ``alongM``:
 * 1 when fade is off, else scaled by the distance to the nearest investigation.
 */
function fadeMultiplier(
  alongM: number,
  confidenceFade: boolean,
  columnAlongMs: readonly number[] | undefined,
  falloffM: number,
): number {
  if (!confidenceFade || !columnAlongMs || columnAlongMs.length === 0) return 1
  let nearest = Infinity
  for (const a of columnAlongMs) {
    const d = Math.abs(alongM - a)
    if (d < nearest) nearest = d
  }
  return distanceAlphaMultiplier(nearest, falloffM)
}

/**
 * Default pixel width of a Mode-A per-test strip.
 *
 * The strip is a fixed-width marker centred on the test's screen x, so it
 * reads as "the model sampled at THIS data location" rather than an
 * interpolated band between tests.  A fixed px width (not a warped along-metre
 * width) is correct: it is a point-sample marker, not a lateral extent.
 */
const DEFAULT_TEST_STRIP_WIDTH_PX = 14

// ─── Private helpers ──────────────────────────────────────────────────────────

/**
 * Build the ``M…L…Z`` subpath for a single closed ring of (alongM, elev) pairs.
 * Returns ``''`` for a ring with < 3 points.
 */
function ringSubpath(
  points: { alongM: number; elev: number }[],
  alongMToScreenX: (m: number) => number,
  levelToScreen: (z: number) => number,
): string {
  if (points.length < 3) return ''
  return (
    points
      .map((p, i) => {
        const x = alongMToScreenX(p.alongM)
        const y = levelToScreen(p.elev)
        return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)},${y.toFixed(2)}`
      })
      .join(' ') + ' Z'
  )
}

/**
 * Build an SVG path string for a Mode B closed ring, WITH optional holes.
 *
 * The outer ring is emitted first, then each hole ring as its own ``M…Z``
 * subpath.  Combined with ``fillRule="evenodd"`` on the ``<path>``, the holes
 * become transparent so an enclosed higher-priority body (a clay lens inside a
 * sand slab) shows through instead of being re-covered by a solid fill.  A poly
 * with no holes renders exactly as before (a single filled outline).
 *
 * @param points - Outer ring of (alongM, elev) pairs (last point connects back
 *                 to the first implicitly).
 * @param holes  - Inner rings (each a closed (alongM, elev) ring) to punch out.
 * @param alongMToScreenX - Warp-aware along→screenX transform.
 * @param levelToScreen   - elev→screenY transform.
 * @returns SVG path string, or ``''`` if the outer ring has < 3 points.
 */
function buildPolyPath(
  points: { alongM: number; elev: number }[],
  holes: { alongM: number; elev: number }[][] | undefined,
  alongMToScreenX: (m: number) => number,
  levelToScreen: (z: number) => number,
): string {
  const outer = ringSubpath(points, alongMToScreenX, levelToScreen)
  if (!outer) return ''
  if (!holes || holes.length === 0) return outer
  const holeSubpaths = holes
    .map((h) => ringSubpath(h, alongMToScreenX, levelToScreen))
    .filter((s) => s !== '')
  return holeSubpaths.length > 0 ? `${outer} ${holeSubpaths.join(' ')}` : outer
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Render mode A column-band fill or mode B plane-slice polygon fill.
 *
 * @see ModelFillOverlayProps for the full prop documentation.
 */
export default function ModelFillOverlay({
  columns,
  polys,
  alongMToScreenX,
  levelToScreen,
  opacity,
  columnLayoutByTestId,
  testStripWidthPx = DEFAULT_TEST_STRIP_WIDTH_PX,
  confidenceFade = false,
  columnAlongMs,
  confidenceFalloffM = CONFIDENCE_FALLOFF_M,
  onShowUnitStatistics,
  forwardColumnContextMenu = false,
}: ModelFillOverlayProps): JSX.Element {
  // S6 — the right-click menu state. Declared BEFORE the mode early-returns
  // (hooks may never sit below a conditional return).
  const [unitStatsMenu, setUnitStatsMenu] = useState<UnitStatsMenuState | null>(null)
  const interactive = onShowUnitStatistics !== undefined
  /** Shared per-element gesture props: right-click → the statistics menu. */
  const regionGesture = (formationId: string, bodyId: string | null) =>
    interactive
      ? {
          pointerEvents: 'auto' as const,
          style: { cursor: 'context-menu' as const },
          onContextMenu: (e: React.MouseEvent) => {
            e.preventDefault()
            e.stopPropagation()
            // Over a column, the unified column menu wins (installer #40): forward
            // the click down to the ContactsLayer band beneath and stop here.
            if (forwardColumnContextMenu && forwardContextMenuToColumn(e.clientX, e.clientY)) return
            setUnitStatsMenu({ clientX: e.clientX, clientY: e.clientY, formationId, bodyId })
          },
        }
      : { pointerEvents: 'none' as const }
  const statsMenu = (
    <UnitStatisticsPortalMenu
      menu={unitStatsMenu}
      onShow={onShowUnitStatistics}
      onClose={() => setUnitStatsMenu(null)}
      menuTestid="model-fill-menu"
      itemTestid="model-fill-menu-unit-statistics"
    />
  )

  // ── Mode B — plane-slice polygon fill ───────────────────────────────────────
  if (polys && polys.length > 0) {
    return (
      <g data-testid="model-fill-overlay">
        {polys.map((poly, i) => {
          const d = buildPolyPath(poly.points, poly.holes, alongMToScreenX, levelToScreen)
          if (!d) return null
          // Fade by the poly's centroid distance to the nearest investigation:
          // a poly spanning a wide data gap reads as interpolated.
          const centroidAlong =
            poly.points.reduce((s, p) => s + p.alongM, 0) / poly.points.length
          const mult = fadeMultiplier(centroidAlong, confidenceFade, columnAlongMs, confidenceFalloffM)
          return (
            <path
              // WHY index in the key: one body can slice into MORE THAN ONE loop
              // (it pinches out and reappears), so the same bodyId arrives on
              // several polys — the key must be unique per poly. The testid stays
              // ``model-fill-<bodyId>`` (shared across a body's loops) so a body
              // is addressable as a whole.
              key={`mf-poly-${i}`}
              data-testid={`model-fill-${poly.bodyId}`}
              d={d}
              fill={poly.color}
              fillOpacity={opacity * mult}
              // WHY evenodd: a resolved poly may carry HOLES (its ``holes`` inner
              // rings, appended to ``d`` as extra M…Z subpaths) so an enclosed
              // higher-priority body — a clay lens inside a sand slab — shows
              // through instead of being re-covered.  evenodd punches those inner
              // rings out regardless of winding; for a hole-less poly it fills
              // the single outer ring identically to nonzero.
              fillRule="evenodd"
              stroke="none"
              // S6 (owner 2026-08-27): the once-deferred "model-fill body is
              // clickable" UX is now RULED — a right-click offers the unit-
              // statistics jump when the handler is wired; otherwise the
              // element stays pointer-inert exactly as before.
              {...regionGesture(poly.formationId, poly.bodyId)}
            />
          )
        })}
        {statsMenu}
      </g>
    )
  }

  // ── Mode A — per-test column fill ────────────────────────────────────────────
  // Each test's sampled stack is drawn as vertical rects spanning the WHOLE
  // investigation column (centre + width from the section layout), so the model
  // sits exactly on the borehole's litho band for a direct ground-truth check at
  // the data location. EVERY segment renders (no between-test band interpolation,
  // no ≥2-column rule) so a body seen at a single test is not dropped. A
  // re-entrant body (two intervals at one column) simply draws two rects there.
  if (columns && columns.length > 0) {
    const rects: JSX.Element[] = []

    for (const col of columns) {
      const layout = columnLayoutByTestId?.[col.testId]
      const width = layout ? layout.width : testStripWidthPx
      const centerX = layout ? layout.centerX : alongMToScreenX(col.alongM)
      const xLeft = centerX - width / 2
      // A strip sits ON its test, so the fade multiplier is ~1 (distance 0);
      // computed for consistency so a test slightly off the column list still fades.
      const mult = fadeMultiplier(col.alongM, confidenceFade, columnAlongMs, confidenceFalloffM)
      col.segments.forEach((seg, si) => {
        const yTop = levelToScreen(seg.topElev)
        const yBase = levelToScreen(seg.baseElev)
        const height = Math.abs(yBase - yTop)
        if (height <= 0) return
        rects.push(
          <rect
            key={`mf-strip-${col.testId}-${si}`}
            data-testid={`model-fill-${seg.bodyId}`}
            x={xLeft}
            y={Math.min(yTop, yBase)}
            width={width}
            height={height}
            fill={seg.color}
            fillOpacity={opacity * mult}
            stroke="none"
            // S6 — same right-click jump as the Mode B polys.
            {...regionGesture(seg.formationId, seg.bodyId)}
          />,
        )
      })
    }

    return (
      <g data-testid="model-fill-overlay">
        {rects}
        {statsMenu}
      </g>
    )
  }

  // ── Empty / no data ─────────────────────────────────────────────────────────
  return <g data-testid="model-fill-overlay" />
}
