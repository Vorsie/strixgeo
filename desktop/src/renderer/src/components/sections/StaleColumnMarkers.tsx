/**
 * Amber "these bands are out of date" marks on the geotech axis (debt #266).
 *
 * A packing band is derived from the litho stack under it. Edit that stack and
 * the band keeps the depths it was derived against — and the axis kept drawing
 * it exactly like a current band, with nothing on the drawing to say otherwise.
 * The debt entry's consequence: a client-facing export of silently stale
 * packing.
 *
 * Amber, never red: the project's rule for dirty / stale state. Nothing here is
 * WRONG — the bands are the honest output of an earlier litho stack — so the
 * mark says "re-run me", not "error".
 *
 * Never colour alone: each mark carries an ``!`` glyph and a ``<title>``, so it
 * survives a monochrome print and a colour-vision deficiency (WCAG 2.2 1.4.1).
 *
 * Pointer-inert. The mark sits over a column the engineer drags bands on, and
 * an inert badge cannot swallow the gesture it is warning about — its ``title``
 * still shows on hover because SVG ``<title>`` is a tooltip, not a listener.
 *
 * @module components/sections/StaleColumnMarkers
 */
import type { PlacedColumn } from './utils'
import { useT } from '../../i18n/translate'

/** Vertical offset of the mark below the plot's top edge, in px. */
const MARK_OFFSET_Y_PX = 10
/** Radius of the amber disc, in px — matches the lens badge on the same axis. */
const MARK_RADIUS_PX = 6
/** Ring colour (amber-700) — the contrast lift the disc needs; see the circle. */
const MARK_RING_COLOR = '#b45309'

interface Props {
  /** The columns as laid out, in post-nudge screen coordinates. */
  columns: readonly PlacedColumn[]
  /** Investigation ids whose bands are out of date. */
  staleColumnIds: ReadonlySet<string>
  /** Screen y of the plot's top edge. */
  plotTop: number
}

/**
 * Draw one amber mark per out-of-date column.
 *
 * Positioned on ``nudgedX``, the column's DRAWN centre after the spacing pass —
 * never ``proj.along``, which is where the test would sit on an unspaced
 * section and is a different x whenever columns crowd.
 */
export default function StaleColumnMarkers({
  columns,
  staleColumnIds,
  plotTop,
}: Props): JSX.Element | null {
  const t = useT()
  const marked = columns.filter(c => staleColumnIds.has(c.proj.item.id))
  if (marked.length === 0) return null

  return (
    <g data-testid="geotech-stale-column-markers" pointerEvents="none">
      {marked.map(column => (
        <g
          key={column.proj.item.id}
          data-testid={`geotech-stale-column-${column.proj.item.id}`}
          transform={`translate(${column.nudgedX}, ${plotTop + MARK_OFFSET_Y_PX})`}
        >
          <title>{t('sections.staleColumn.title', { name: column.proj.item.name })}</title>
          {/* The ring is not decoration — the lens badge on this same axis
              records why: amber alone is ~2.1:1 on the light plot background,
              under the 3:1 floor WCAG 2.2 1.4.11 sets for a graphical object
              that carries meaning. */}
          <circle
            r={MARK_RADIUS_PX}
            fill="var(--color-status-amber, #d97706)"
            stroke={MARK_RING_COLOR}
            strokeWidth={1}
          />
          <text
            textAnchor="middle"
            y={3}
            fontSize={9}
            fontWeight={700}
            fill="white"
            aria-hidden="true"
          >
            !
          </text>
        </g>
      ))}
    </g>
  )
}
