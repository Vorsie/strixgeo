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
 *   by ``sliceSolidsAtPlane`` (vertical plane intersection of body meshes).  Each
 *   polygon is rendered as a closed filled path using ``fillRule="nonzero"``
 *   because the ring winding is not guaranteed for arbitrary mesh orientations.
 *
 * This overlay is a read-only, purely presentational layer:
 *   - ``pointerEvents="none"`` on every painted element so it never intercepts
 *     gestures intended for overlays below or above it.
 *   - All horizontal positions go through the ``alongMToScreenX`` callback — this
 *     is the warped/spacing-aware screen transform (never raw along-distance).
 *   - All vertical positions go through ``levelToScreen``.
 *
 * Mount it as a sibling of ``PartitionFillOverlay`` inside the section SVG,
 * beneath interactive overlays.
 */

import type { SectionPoly, SolidColumn } from '../../utils/sectionFromSolids'

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
 */
export interface ModelFillOverlayProps {
  columns?: SolidColumn[]
  polys?: SectionPoly[]
  alongMToScreenX: (alongM: number) => number
  levelToScreen: (elev: number) => number
  opacity: number
  columnLayoutByTestId?: Record<string, { centerX: number; width: number }>
  testStripWidthPx?: number
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
 * Build an SVG path string for a Mode B closed ring.
 *
 * WHY ``fillRule="nonzero"``: the winding of points in a ``SectionPoly`` depends
 * on the triangle order in the input mesh and is not normalised.  ``nonzero``
 * handles both CW and CCW windings correctly for the convex slices that the 3D
 * body builder produces.
 *
 * @param points - Ring of (alongM, elev) pairs (the last point connects back to
 *                 the first implicitly).
 * @param alongMToScreenX - Warp-aware along→screenX transform.
 * @param levelToScreen   - elev→screenY transform.
 * @returns SVG path string ``"M ... Z"``, or ``''`` if the ring has < 3 points.
 */
function buildPolyPath(
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
}: ModelFillOverlayProps): JSX.Element {
  // ── Mode B — plane-slice polygon fill ───────────────────────────────────────
  if (polys && polys.length > 0) {
    return (
      <g data-testid="model-fill-overlay">
        {polys.map((poly, i) => {
          const d = buildPolyPath(poly.points, alongMToScreenX, levelToScreen)
          if (!d) return null
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
              fillOpacity={opacity}
              // WHY nonzero: SectionPoly winding is not guaranteed — depends on
              // triangle order in the input mesh.  nonzero handles both CW and CCW
              // correctly for the convex slices we produce.
              fillRule="nonzero"
              stroke="none"
              pointerEvents="none"
            />
          )
        })}
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
            fillOpacity={opacity}
            stroke="none"
            pointerEvents="none"
          />,
        )
      })
    }

    return <g data-testid="model-fill-overlay">{rects}</g>
  }

  // ── Empty / no data ─────────────────────────────────────────────────────────
  return <g data-testid="model-fill-overlay" />
}
