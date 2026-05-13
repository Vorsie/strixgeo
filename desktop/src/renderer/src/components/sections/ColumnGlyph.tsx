/**
 * Single investigation column glyph for the cross-section.
 *
 * Shape encodes the kind (CPT = circle, borehole = square) — same
 * vocabulary as the map markers so a user reading the section
 * interprets the icons the same way they'd interpret the map dots.
 *
 * Clipping: the body line is clipped to the plot area (we clamp the
 * y-coords to ``[plotTop, plotBottom]``). The top cap renders only
 * when its level is inside the visible window; the name label
 * renders alongside the cap so it disappears with the cap when the
 * user scrolls the elevation off-screen.
 *
 * Tie-back: when ``tieBackTrueX`` is not null, the column was
 * nudged from its true projected X to ``screenX`` to avoid overlap.
 * We draw a tick at the true X on the top axis and a thin diagonal
 * back to the cap so the geometry stays inspectable.
 */

const CPT_COLOR = '#1f2937' // slate-800; deliberate dark so it
// stays readable over the future DEM hillshade
const BH_COLOR = '#1f2937'
const MISSING_ELEV_COLOR = '#9ca3af' // gray-400 — "we don't know
// where this column belongs on Y" visual

export default function ColumnGlyph({
  name,
  kind,
  screenX,
  tieBackTrueX,
  offset,
  elevation,
  depth,
  levelToScreen,
  plotTop,
  plotBottom,
  onClick,
  onContextMenu,
  hideStick = false,
}: {
  name: string
  kind: 'cpt' | 'borehole'
  screenX: number
  tieBackTrueX: number | null
  offset: number
  elevation: number | null
  depth: number | null
  levelToScreen: (level: number) => number
  plotTop: number
  plotBottom: number
  onClick: (() => void) | undefined
  /** Right-click handler. Receives the raw React event so the caller
   * can read clientX/clientY for menu positioning. Rendering the
   * hit-box is gated on having either onClick or onContextMenu
   * wired; without one, the column stays inert. */
  onContextMenu?: (e: React.MouseEvent<SVGRectElement>) => void
  /** When true, suppress the cap + body line + tie-back diagonal —
   * the caller is already rendering a CPT data band or a borelog
   * lithology strip at this column's X, so the stick "where is this
   * test" visual is redundant. Name + signed elevation labels still
   * render above the band as the column's identifier. */
  hideStick?: boolean
}): JSX.Element | null {
  const sx = screenX
  // ``null`` elevation gets the column floated at level=0 in a
  // faded tone so the user sees "this exists but we can't position
  // it" — dropping it entirely would silently hide rows that lack
  // a Z.
  const elevValue = elevation ?? 0
  const elevKnown = elevation !== null
  const sy = levelToScreen(elevValue)
  const color = elevKnown ? (kind === 'cpt' ? CPT_COLOR : BH_COLOR) : MISSING_ELEV_COLOR

  // Body line: top at elevation, bottom at elevation - depth.
  // ``null`` depth renders just the cap (no body) — same convention
  // as the map's missing-depth case.
  let bodyBottomY: number | null = null
  if (depth !== null && depth > 0) {
    bodyBottomY = levelToScreen(elevValue - depth)
  }
  // Clamp to the plot rect so columns extending below the viewport
  // don't render outside the canvas.
  const clampedTop = Math.max(plotTop, Math.min(plotBottom, sy))
  const clampedBottom =
    bodyBottomY !== null ? Math.max(plotTop, Math.min(plotBottom, bodyBottomY)) : null

  // Offset hint: rendered as a small sup-script next to the name
  // when |offset| > 1 m. The signed value tells the engineer which
  // side of the line the investigation lives on (positive = left of
  // the line direction).
  const offsetLabel =
    Math.abs(offset) >= 1
      ? ` (${offset > 0 ? '←' : '→'}${Math.abs(offset).toFixed(0)} m)`
      : ''

  return (
    <g
      onClick={onClick}
      style={{ cursor: onClick ? 'pointer' : 'default' }}
    >
      {/* Transparent hit-box spanning the column's vertical strip.
          The body line + cap are too thin to click reliably; the
          invisible rect catches clicks anywhere within ±6 px of the
          column's X across the full plot height. ``pointerEvents``
          on the rect alone (not the wider <g>) keeps the tie-back
          diagonals and other siblings non-clickable. Right-click
          fires onContextMenu when wired, opening the column's
          per-test action menu (focus, hide, …). */}
      {(onClick || onContextMenu) && (
        <rect
          x={sx - 7}
          y={plotTop}
          width={14}
          height={plotBottom - plotTop}
          fill="transparent"
          onContextMenu={onContextMenu}
        />
      )}

      {/* Native title is the cheapest, most accessible tooltip;
          we'll swap to a tracked hover-popover when collision
          handling adds offset indicators / leader lines in S5. */}
      <title>
        {`${name}`}
        {elevation !== null ? ` · ${elevation.toFixed(2)} m` : ' · elevation unknown'}
        {depth !== null ? ` · ${depth.toFixed(1)} m deep` : ''}
        {` · ${Math.abs(offset).toFixed(1)} m off-line`}
        {onClick ? ' · click for detail' : ''}
      </title>

      {/* Tie-back: short tick at the true X on the top axis +
          diagonal up to the cap at the nudged screenX. Renders
          only when the layout pass had to displace this column AND
          the caller hasn't suppressed the stick visual. */}
      {tieBackTrueX !== null && !hideStick && (
        <g pointerEvents="none">
          <line
            x1={tieBackTrueX}
            x2={tieBackTrueX}
            y1={plotTop}
            y2={plotTop + 5}
            stroke="#6b7280"
            strokeWidth={1.25}
            strokeOpacity={0.8}
          />
          <line
            x1={tieBackTrueX}
            x2={sx}
            y1={plotTop + 5}
            y2={clampedTop}
            stroke="#6b7280"
            strokeWidth={1}
            strokeOpacity={0.55}
            strokeDasharray="2 2"
          />
        </g>
      )}

      {/* Body line — only rendered when both endpoints land inside
          the plot area AND the caller hasn't suppressed the stick
          visual (a band already shows the column's extent). */}
      {!hideStick && clampedBottom !== null && clampedTop < clampedBottom && (
        <line
          x1={sx}
          x2={sx}
          y1={clampedTop}
          y2={clampedBottom}
          stroke={color}
          strokeWidth={1.5}
          strokeOpacity={elevKnown ? 0.9 : 0.4}
        />
      )}

      {/* Top cap + label — only inside the plot area. The CAP itself
          is suppressed when ``hideStick`` is set (a band is showing
          where the test sits); the LABELS still render so the
          column keeps its identifier. */}
      {sy >= plotTop && sy <= plotBottom && (
        <>
          {!hideStick &&
            (kind === 'cpt' ? (
              <circle cx={sx} cy={sy} r={3.5} fill={color} fillOpacity={elevKnown ? 0.95 : 0.5} />
            ) : (
              <rect
                x={sx - 3.5}
                y={sy - 3.5}
                width={7}
                height={7}
                fill={color}
                fillOpacity={elevKnown ? 0.95 : 0.5}
              />
            ))}
          {/* Three-row label stack above the cap, DOV "lengteprofiel"
              convention (page 3 scale annotation
              "4% 2%2 +7.48 10 MPa"):
                  row 1 (sy-22): test name (horizontal, centered)
                  row 2 (sy-12): signed elevation marker
                  row 3 (sy-3): per-CPT gridline value labels (added
                                  by CptDataColumn, NOT here)
              The name is shifted up to leave a clear strip between
              the elevation and the cap so CptDataColumn's gridline
              labels can sit there without colliding. */}
          <text
            x={sx}
            y={sy - 22}
            fontSize={9}
            fill={elevKnown ? '#1f2937' : '#9ca3af'}
            textAnchor="middle"
          >
            {name}
            {offsetLabel}
          </text>
          {elevKnown && (
            <text x={sx} y={sy - 12} fontSize={8} fill="#6b7280" textAnchor="middle">
              {`${elevation! >= 0 ? '+' : ''}${elevation!.toFixed(2)} m`}
            </text>
          )}
        </>
      )}
    </g>
  )
}
