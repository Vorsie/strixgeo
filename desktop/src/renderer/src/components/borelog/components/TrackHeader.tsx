import type { ReactElement } from 'react'

import { HEADER_HEIGHT } from '../constants'
import { truncate } from '../utils'
import { useT } from '../../../i18n/translate'

/**
 * Title block at the top of every SVG track.
 *
 * Renders a faint background rectangle with a bold title line + an
 * optional muted subtitle (author / interpretation kind). Text is
 * horizontal — diagonal looks nice on print but is hard to read at
 * on-screen sizes; the rectangle absorbs the column width so
 * narrower stratigraphy tracks don't bleed.
 *
 * Title and subtitle are length-truncated client-side because SVG has
 * no synchronous ``measureText`` — magic numbers (22 chars / 26 chars)
 * were dialled in against the default 150 px / 90 px column widths.
 *
 * When ``onHide`` is provided, the header becomes click-to-hide: a
 * ``cursor: pointer`` style is applied and clicking the header calls
 * the handler so the parent can toggle this track off.
 *
 * When ``rawToken`` is provided the SVG ``<title>`` element on the
 * rect renders the raw upstream token (e.g. DOV
 * ``observation_type`` value) so domain experts can verify the
 * translation without leaving the UI — required by the
 * translate-at-boundary rule in UX conventions and CLAUDE.md.
 *
 * Parameters
 * ----------
 * x : number
 *     Left edge of the track in SVG coordinates.
 * width : number
 *     Track width in pixels.
 * y : number
 *     Top of the header in SVG coordinates.
 * title : string
 *     Column title (translated label, e.g. "Coded lithology").
 * subtitle : string | null
 *     Optional secondary line (e.g. author / date). Omitted when null.
 * rawToken : string | undefined
 *     The raw upstream token before translation (e.g. "coded_lithology").
 *     Rendered as an SVG tooltip so domain experts can verify the
 *     translation without leaving the UI.
 * subtitleMaxChars : number | undefined
 *     Character cap of the subtitle (default 26, dialled for 150 px columns);
 *     a wider track passes more.
 * onHide : (() => void) | undefined
 *     When provided, clicking the header calls this handler to hide the
 *     track. The header shows ``cursor: pointer`` and a "Hide column"
 *     tooltip to signal the affordance.
 *
 * Returns
 * -------
 * ReactElement
 *     The SVG group for the track header.
 */
export function TrackHeader({
  x,
  width,
  y,
  title,
  subtitle,
  rawToken,
  subtitleMaxChars = 26,
  onHide,
}: {
  x: number
  width: number
  y: number
  title: string
  subtitle: string | null
  rawToken?: string
  subtitleMaxChars?: number
  onHide?: () => void
}): ReactElement {
  const t = useT()
  // Build the tooltip text: raw token when available (translate-at-boundary
  // rule), overridden by "Hide column" when onHide is set (click action
  // takes priority over the informational tooltip).
  const tooltipText = onHide ? t('borelog.hideColumn') : rawToken

  return (
    // The outer <g> captures the click and signals the cursor when
    // onHide is supplied. SVG does not support `cursor: pointer` on
    // <g> in all browsers via a className, but the inline style prop
    // works universally.
    <g
      onClick={onHide}
      style={onHide ? { cursor: 'pointer' } : undefined}
      role={onHide ? 'button' : undefined}
      aria-label={onHide ? t('borelog.hideColumnAria', { title }) : undefined}
    >
      {/* fill / stroke use CSS custom properties so TrackHeader is legible
          in both light and dark themes without prop drilling the theme down
          into every SVG sub-component. Vars defined in index.css. */}
      <rect
        x={x}
        y={y}
        width={width}
        height={HEADER_HEIGHT}
        fill="var(--borelog-track-header-bg)"
        stroke="var(--borelog-track-header-border)"
        strokeWidth={0.5}
      >
        {tooltipText && <title>{tooltipText}</title>}
      </rect>
      <text x={x + 4} y={y + 14} fontSize={10} fontWeight={600} fill="var(--borelog-text-primary)">
        {truncate(title, 22)}
      </text>
      {subtitle && (
        <text x={x + 4} y={y + 28} fontSize={9} fill="var(--borelog-text-muted)">
          {truncate(subtitle, subtitleMaxChars)}
        </text>
      )}
    </g>
  )
}
