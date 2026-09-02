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
 *
 * Label LOD: ``labelMode`` controls which of three label presentations
 * renders. ``'full'`` (default) = the normal three-row stack (name /
 * elevation / qc row). ``'rotated'`` = only the name, rotated 90°
 * counter-clockwise anchored at the column top — the gINT/LeapFrog
 * dense-log convention for tight spacings. ``'none'`` = no label at
 * all. ``callout`` shifts the full label up an extra 14 px to avoid
 * occlusion by an adjacent column when the selected/hovered column is
 * in a dense neighbourhood.
 */

import type { ColumnLabelMode } from '../../utils/columnLabelLod'
import { useT } from '../../i18n/translate'

// Theme-aware via CSS vars (index.css): :root == the prior hard-coded
// hex (light byte-identical), .dark lifts them off the dark plot bg
// where #1f2937 was invisible (~1:1). SVG attrs can't use Tailwind dark:.
const CPT_COLOR = 'var(--section-column-text)'
const BH_COLOR = 'var(--section-column-text)'
const MISSING_ELEV_COLOR = 'var(--section-column-missing)' // "we don't
// know where this column belongs on Y" muted visual

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
  onDoubleClick,
  onContextMenu,
  hideStick = false,
  labelMode = 'full',
  callout = false,
  onMouseEnter,
  onMouseLeave,
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
  /** Double-click handler — opens the detail panel. Single-click
   * stays inert so accidental pan-start gestures never navigate away.
   * When wired the hit-box is always rendered (same condition as
   * onClick / onContextMenu). */
  onDoubleClick?: () => void
  /** Right-click handler. Receives the raw React event so the caller
   * can read clientX/clientY for menu positioning. Rendering the
   * hit-box is gated on having either onClick, onDoubleClick, or
   * onContextMenu wired; without one the column stays inert. */
  onContextMenu?: (e: React.MouseEvent<SVGRectElement>) => void
  /** When true, suppress the cap + body line + tie-back diagonal —
   * the caller is already rendering a CPT data band or a borelog
   * lithology strip at this column's X, so the stick "where is this
   * test" visual is redundant. Name + signed elevation labels still
   * render above the band as the column's identifier. */
  hideStick?: boolean
  /** Label level-of-detail mode. ``'full'`` = three-row stack (default).
   * ``'rotated'`` = name only, rotated 90° CCW. ``'none'`` = no label. */
  labelMode?: ColumnLabelMode
  /** When true (selected/hovered in a dense layout), shift the label
   * up by an extra 14 px to clear an adjacent column's label. */
  callout?: boolean
  /** Mouse-enter handler — forwarded from InvestigationColumns so
   * SectionPanel can track the hovered column for LOD purposes. */
  onMouseEnter?: () => void
  /** Mouse-leave handler — paired with ``onMouseEnter``. */
  onMouseLeave?: () => void
}): JSX.Element | null {
  const t = useT()
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
      onDoubleClick={onDoubleClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{ cursor: onClick || onDoubleClick ? 'pointer' : 'default' }}
    >
      {/* Transparent hit-box spanning the column's vertical strip.
          The body line + cap are too thin to click reliably; the
          invisible rect catches clicks anywhere within ±6 px of the
          column's X across the full plot height. ``pointerEvents``
          on the rect alone (not the wider <g>) keeps the tie-back
          diagonals and other siblings non-clickable. Right-click
          fires onContextMenu when wired, opening the column's
          per-test action menu (focus, hide, …).
          Double-click is on the <g> (above) so the browser handles
          the timing — no manual debounce needed. */}
      {(onClick || onDoubleClick || onContextMenu) && (
        <rect
          data-testid={`column-hit-${name}`}
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
        {elevation !== null
          ? ` · ${elevation.toFixed(2)} m`
          : t('sections.glyph.elevationUnknown')}
        {depth !== null ? t('sections.glyph.deep', { depth: depth.toFixed(1) }) : ''}
        {t('sections.glyph.offLine', { offset: Math.abs(offset).toFixed(1) })}
        {onClick ? t('sections.glyph.clickForDetail') : ''}
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
            stroke="var(--section-column-line)"
            strokeWidth={1.25}
            strokeOpacity={0.8}
          />
          <line
            x1={tieBackTrueX}
            x2={sx}
            y1={plotTop + 5}
            y2={clampedTop}
            stroke="var(--section-column-line)"
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
          column keeps its identifier.
          Label LOD (``labelMode``):
            'full'    — three-row stack (name / elevation / qc row).
            'rotated' — name only, rotated 90° CCW at the column top.
                        Used at dense spacings (gINT convention).
            'none'    — no label. Middle columns in a very dense layout. */}
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

          {/* Full three-row label stack. ``callout`` shifts it up an extra
              14 px when the column is selected/hovered in a dense layout so
              the forced-full label doesn't collide with a neighbour's
              rotated id. */}
          {labelMode === 'full' && (
            <>
              <text
                x={sx}
                y={sy - 22 - (callout ? 14 : 0)}
                fontSize={9}
                fill={elevKnown ? 'var(--section-column-text)' : 'var(--section-column-missing)'}
                textAnchor="middle"
              >
                {name}
                {offsetLabel}
              </text>
              {elevKnown && (
                <text
                  x={sx}
                  y={sy - 12 - (callout ? 14 : 0)}
                  fontSize={8}
                  fill="var(--section-column-line)"
                  textAnchor="middle"
                >
                  {`${elevation! >= 0 ? '+' : ''}${elevation!.toFixed(2)} m`}
                </text>
              )}
            </>
          )}

          {/* Rotated id — a single ``transform="rotate(-90)"`` around the
              label's anchor point. The anchor sits just above ``plotTop``
              (not above sy) so the label reads along the column from the
              top of the canvas downward — the gINT/Strater/LeapFrog
              dense-log convention. ``textAnchor="start"`` means the label
              starts at the top of the plot and reads downward. */}
          {labelMode === 'rotated' && (
            <text
              x={sx}
              y={plotTop - 4}
              fontSize={9}
              fill={elevKnown ? 'var(--section-column-text)' : 'var(--section-column-missing)'}
              textAnchor="start"
              transform={`rotate(-90, ${sx}, ${plotTop - 4})`}
            >
              {name}
            </text>
          )}
        </>
      )}
    </g>
  )
}
