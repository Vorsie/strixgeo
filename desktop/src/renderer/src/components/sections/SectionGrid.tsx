/**
 * Static plot backdrop for the cross-section canvas — vertical + horizontal
 * gridlines and their axis tick labels. Extracted from ``SectionPanel`` (debt
 * #201 Move 4) as a render-only unit: it owns no interaction or drag state,
 * it's a pure function of the viewport-derived geometry passed in.
 *
 * Colours come from ``--section-*`` CSS-var tokens (index.css :root/.dark)
 * because SVG attributes can't use Tailwind ``dark:`` variants.
 */
import { MARGIN } from './utils'

interface SectionGridProps {
  /** Along-distance tick positions (world metres). */
  xTicks: number[]
  /** Level tick positions (world metres / datum units). */
  levelTicks: number[]
  /**
   * Spacing-aware along→screen mapping. Gridlines + x-axis labels track the
   * packed test positions at low ``column_spacing``; at spacing=1 the warp is
   * identity. Labels keep their true along-distance value, just rendered at a
   * compressed screen X.
   */
  warpedXToScreen: (along: number) => number
  /** Level→screen mapping. */
  levelToScreen: (level: number) => number
  /** Plot area width in px (excludes margins). */
  plotWidth: number
  /** Plot area height in px (excludes margins). */
  plotHeight: number
}

/**
 * Render the section's gridlines and axis ticks.
 *
 * Parameters
 * ----------
 * props
 *     See {@link SectionGridProps}.
 */
export default function SectionGrid({
  xTicks,
  levelTicks,
  warpedXToScreen,
  levelToScreen,
  plotWidth,
  plotHeight,
}: SectionGridProps): JSX.Element {
  return (
    <>
      {/* Vertical gridlines + x-axis ticks (along-distance).
          Position uses ``warpedXToScreen`` so the gridlines
          and axis labels track the test packing at low
          spacing — same warp the DEM polyline uses. The label
          values themselves stay at the true along-distance
          they represent (the "200 m" tick is still 200 m
          along the section, just rendered at a compressed
          screen X). */}
      {xTicks.map(v => {
        const sx = warpedXToScreen(v)
        return (
          <g key={`xt-${v}`}>
            <line
              x1={sx}
              x2={sx}
              y1={MARGIN.top}
              y2={MARGIN.top + plotHeight}
              stroke="var(--section-grid)"
            />
            <text
              x={sx}
              y={MARGIN.top + plotHeight + 14}
              fontSize={10}
              fill="var(--section-axis-tick)"
              textAnchor="middle"
            >
              {Math.round(v)}
            </text>
          </g>
        )
      })}

      {/* Horizontal gridlines + y-axis ticks (level). */}
      {levelTicks.map(v => {
        const sy = levelToScreen(v)
        return (
          <g key={`lt-${v}`}>
            <line
              x1={MARGIN.left}
              x2={MARGIN.left + plotWidth}
              y1={sy}
              y2={sy}
              stroke="var(--section-grid)"
            />
            <text
              x={MARGIN.left - 6}
              y={sy + 3}
              fontSize={10}
              fill="var(--section-axis-tick)"
              textAnchor="end"
            >
              {/* One decimal when the step is sub-metre so
                  labels like "-12.5" don't collapse to "-13". */}
              {Number.isInteger(v) ? v : v.toFixed(1)}
            </text>
          </g>
        )
      })}
    </>
  )
}
