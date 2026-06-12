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
 */
export interface ModelFillOverlayProps {
  columns?: SolidColumn[]
  polys?: SectionPoly[]
  alongMToScreenX: (alongM: number) => number
  levelToScreen: (elev: number) => number
  opacity: number
}

// ─── Private helpers ──────────────────────────────────────────────────────────

/**
 * Build an SVG path string for a body band.
 *
 * The band is a closed polygon formed by:
 *   1. Top chain: each column's ``topElev`` mapped left→right.
 *   2. Base chain: each column's ``baseElev`` mapped right→left.
 * Closed with ``Z``.
 *
 * WHY ≥2 columns: a band spans BETWEEN columns — a single-column body is a
 * point measurement with no lateral extent, so there is nothing to fill.
 *
 * @param tops  - Ordered (screenX, screenY) pairs for the top of the body,
 *                left to right.
 * @param bases - Ordered (screenX, screenY) pairs for the base of the body,
 *                left to right (reversed when building the path).
 * @returns SVG path string ``"M ... Z"``, or ``''`` if either list is empty.
 */
function buildBandPath(
  tops: { x: number; y: number }[],
  bases: { x: number; y: number }[],
): string {
  if (tops.length === 0 || bases.length === 0) return ''

  // Top chain left → right, then base chain right → left so the polygon
  // winds consistently (clockwise in SVG coords where Y increases downward).
  const pts: string[] = []

  tops.forEach((p, i) => {
    pts.push(`${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)},${p.y.toFixed(2)}`)
  })

  for (let i = bases.length - 1; i >= 0; i--) {
    const p = bases[i]
    pts.push(`L ${p.x.toFixed(2)},${p.y.toFixed(2)}`)
  }

  pts.push('Z')
  return pts.join(' ')
}

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
}: ModelFillOverlayProps): JSX.Element {
  // ── Mode B — plane-slice polygon fill ───────────────────────────────────────
  if (polys && polys.length > 0) {
    return (
      <g data-testid="model-fill-overlay">
        {polys.map((poly) => {
          const d = buildPolyPath(poly.points, alongMToScreenX, levelToScreen)
          if (!d) return null
          return (
            <path
              key={`mf-poly-${poly.bodyId}`}
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

  // ── Mode A — column segment band fill ───────────────────────────────────────
  if (columns && columns.length >= 2) {
    // Sort columns by along-section position so the band polygon is built
    // left→right regardless of the order the consumer passes them in.
    const sorted = [...columns].sort((a, b) => a.alongM - b.alongM)

    // Group: bodyId → list of { screenX, topY, baseY } entries (one per column).
    // We accumulate only the columns that carry each body, so a body absent on
    // one column in the middle still connects its present neighbours correctly.
    const bodyEntries = new Map<
      string,
      { color: string; cols: { x: number; topY: number; baseY: number }[] }
    >()

    for (const col of sorted) {
      const screenX = alongMToScreenX(col.alongM)
      for (const seg of col.segments) {
        let entry = bodyEntries.get(seg.bodyId)
        if (!entry) {
          entry = { color: seg.color, cols: [] }
          bodyEntries.set(seg.bodyId, entry)
        }
        entry.cols.push({
          x: screenX,
          topY: levelToScreen(seg.topElev),
          baseY: levelToScreen(seg.baseElev),
        })
      }
    }

    const paths: JSX.Element[] = []

    for (const [bodyId, entry] of bodyEntries) {
      // WHY ≥2 columns required: a band is an area between two column positions.
      // A body present at only one column has no lateral extent — nothing to fill.
      if (entry.cols.length < 2) continue

      const tops = entry.cols.map((c) => ({ x: c.x, y: c.topY }))
      const bases = entry.cols.map((c) => ({ x: c.x, y: c.baseY }))
      const d = buildBandPath(tops, bases)
      if (!d) continue

      paths.push(
        <path
          key={`mf-col-${bodyId}`}
          data-testid={`model-fill-${bodyId}`}
          d={d}
          fill={entry.color}
          fillOpacity={opacity}
          // WHY nonzero (matching Mode B): a non-convex body top (e.g. a
          // valley-shaped contact) could otherwise punch a hole under evenodd.
          fillRule="nonzero"
          stroke="none"
          pointerEvents="none"
        />,
      )
    }

    return <g data-testid="model-fill-overlay">{paths}</g>
  }

  // ── Empty / no data ─────────────────────────────────────────────────────────
  return <g data-testid="model-fill-overlay" />
}
