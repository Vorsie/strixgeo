/**
 * Floating SVG readout card used by the section's hover overlays.
 *
 * Originally inlined in ContactPickBar for the CPT pick affordance
 * (depth + mTAW + qc + Rf). The second user — BoreholeColumn's
 * focus-mode readout (depth + mTAW only) — triggered the
 * "extract on the second copy" rule, so the card geometry +
 * position clamping live here as a single source of truth. Both
 * call sites stay free to compose their own line content.
 *
 * Render contract:
 *
 *   * The card's top-left corner is anchored at ``x, y - halfH``,
 *     i.e. the card is vertically centred on ``y``.
 *   * ``y`` is clamped to ``[plotTop + halfH, plotBottom - halfH]``
 *     so the card never escapes the SVG even when the cursor sits
 *     against the top or bottom of the plot area.
 *   * Card height auto-scales with ``lines.length`` so the same
 *     component renders a 2-line BH card and a 4-line CPT card
 *     without per-line bookkeeping.
 *   * The default style mirrors the existing CPT card (white fill,
 *     red border, 9 px slate text) so users see consistent
 *     feedback across both kinds.
 */

interface HoverLine {
  /** The line of text to render. Pre-formatted by the caller —
   * the card doesn't know what 'depth' or 'qc' is. */
  text: string
  /** Optional override of the text colour. Defaults to slate-700
   * (#374151). Used by the CPT card to colour qc black and Rf
   * brown so the values pop against the label. */
  color?: string
}

interface Props {
  /** Container-local X coord of the card's top-left corner. */
  x: number
  /** Container-local Y coord the card vertically centres on. */
  y: number
  /** Lines to render top-to-bottom. Length controls card height. */
  lines: readonly HoverLine[]
  /** Plot-area Y bounds — card Y is clamped to stay inside. */
  plotTop: number
  plotBottom: number
  /** Card width in px. Default 86 matches the CPT card. */
  width?: number
}

const DEFAULT_TEXT_COLOR = '#374151'
const PADDING_TOP = 13
const LINE_HEIGHT = 13
const PADDING_BOTTOM = 8

export default function HoverReadoutCard({
  x,
  y,
  lines,
  plotTop,
  plotBottom,
  width = 86,
}: Props): JSX.Element {
  // Card height grows linearly with line count. The constants are
  // calibrated against fontSize=9: ~13 px per line plus a top pad
  // for the baseline of the first line and a smaller bottom pad.
  const cardHeight = PADDING_TOP + (lines.length - 1) * LINE_HEIGHT + PADDING_BOTTOM
  const halfH = cardHeight / 2
  const cy = Math.max(plotTop + halfH, Math.min(plotBottom - halfH, y))
  const topY = cy - halfH
  return (
    <g>
      <rect
        x={x}
        y={topY}
        width={width}
        height={cardHeight}
        fill="#ffffff"
        fillOpacity={0.95}
        stroke="#dc2626"
        strokeWidth={0.75}
        rx={3}
      />
      {lines.map((line, i) => (
        <text
          // ``text`` content + index is stable across renders for a
          // given parent — same line at the same slot keeps its
          // identity, so React can recycle the node on hover-move.
          key={i}
          x={x + 6}
          y={topY + PADDING_TOP + i * LINE_HEIGHT}
          fontSize={9}
          fill={line.color ?? DEFAULT_TEXT_COLOR}
        >
          {line.text}
        </text>
      ))}
    </g>
  )
}
