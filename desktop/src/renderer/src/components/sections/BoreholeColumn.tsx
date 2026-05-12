/**
 * BoreholeColumn — per-stream lithology strips for the cross-section.
 *
 * Renders one or more vertical strips inside a borehole's column
 * band, one per ENABLED interpretation stream
 * (``coded_lithology`` / ``geotechnical_coding`` /
 * ``formal_stratigraphy`` / ``quaternary_stratigraphy``). Each strip
 * shows the matching observation's layers as patterned coloured
 * rectangles — DOV "lengteprofiel" PDF page-3 layout: when 3 streams
 * are toggled on, each borehole is 3 strips wide side by side.
 *
 * The band auto-widens with the count of enabled channels — total
 * visual width = ``N * 2 * halfWidth`` — and SectionPanel feeds that
 * widened width into the nudge layout so neighbouring tests get
 * pushed out proportionally.
 *
 * Strip with no matching observation renders empty so the slot
 * stays consistent across boreholes (different boreholes carry
 * different subsets of observations; the strip order is fixed so
 * a user reading the section can scan one stream vertically across
 * the whole canvas).
 *
 * Layer fill: ``getSoilFillUrl(layer.main_soil_codes[0])`` — pattern
 * URL for known DOV codes, fallback solid colour for unknowns.
 * Clips to ``[plotTop, plotBottom]``.
 *
 * Deferred to future passes: sample track on the right edge,
 * observation labels alongside layers, admixture chips, layer
 * hover/select hooks for the geological editor.
 */

import type {
  BoreholeDetailResponse,
  ObservationResponse,
} from '../../api/client'
import { getSoilFillUrl } from '../../utils/soilPatterns'
import {
  BOREHOLE_CHANNEL_OBSERVATION_TYPES,
  type BoreholeChannels,
} from './cptChannels'

interface Props {
  detail: BoreholeDetailResponse
  /** Toggle state for the four interpretation streams. Channels in
   * fixed display order (lithology / geotech / formal_strat /
   * quaternary); each enabled stream gets its own strip. */
  channels: BoreholeChannels
  /** Screen X of the column centerline (the nudged X from the
   * width-aware layout pass — see ``nudgeColumns``). The band is
   * centred on this X regardless of how many strips it contains. */
  screenX: number
  /** Half-width of ONE strip in px. Total band half-width =
   * ``halfWidth * enabledCount``; passed in pre-computed by
   * SectionPanel so the caller stays in charge of zoom + spacing
   * scaling.
   */
  halfWidth: number
  /** Surface elevation in m. Caller MUST skip rendering when null. */
  surfaceElevationM: number
  /** Plot-area Y bounds — anything outside gets clamped. */
  plotTop: number
  plotBottom: number
  /** World-level → screen Y converter. */
  levelToScreen: (level: number) => number
}

export default function BoreholeColumn({
  detail,
  channels,
  screenX,
  halfWidth,
  surfaceElevationM,
  plotTop,
  plotBottom,
  levelToScreen,
}: Props): JSX.Element | null {
  // Walk the channel list in display order, picking up the matching
  // observation (or null) per slot. We collect both the entry and
  // the slot index so layout uses positional X offsets regardless of
  // which slots happen to be empty.
  const enabledSlots: { key: keyof BoreholeChannels; obs: ObservationResponse | null }[] = []
  for (const [key, obsType] of BOREHOLE_CHANNEL_OBSERVATION_TYPES) {
    if (!channels[key]) continue
    const obs = detail.observations.find(o => o.observation_type === obsType) ?? null
    enabledSlots.push({ key, obs })
  }
  if (enabledSlots.length === 0) return null

  const stripWidth = 2 * halfWidth
  const totalWidth = stripWidth * enabledSlots.length
  // Band is centred on the column axis so the column axis stays the
  // visual identity anchor for the test even as the band widens.
  const bandLeftX = screenX - totalWidth / 2

  return (
    <g pointerEvents="none">
      {enabledSlots.map((slot, i) => {
        const stripLeftX = bandLeftX + i * stripWidth
        if (slot.obs === null || slot.obs.layers.length === 0) {
          // Empty strip — keeps the slot footprint consistent across
          // boreholes even when this borehole doesn't carry the
          // selected stream. Light grey background so the user can
          // see "the slot is here, just empty for this test".
          return (
            <g key={slot.key}>
              <rect
                x={stripLeftX}
                y={plotTop}
                width={stripWidth}
                height={0}
                fill="#f9fafb"
              />
            </g>
          )
        }
        return (
          <g key={slot.key}>
            {slot.obs.layers.map(layer => {
              const yTop = levelToScreen(surfaceElevationM - layer.top_m)
              const yBottom = levelToScreen(surfaceElevationM - layer.base_m)
              const clampedTop = Math.max(plotTop, Math.min(plotBottom, yTop))
              const clampedBottom = Math.max(plotTop, Math.min(plotBottom, yBottom))
              const height = clampedBottom - clampedTop
              if (height <= 0) return null
              const primaryCode = layer.main_soil_codes[0] ?? null
              return (
                <rect
                  key={layer.id}
                  x={stripLeftX}
                  y={clampedTop}
                  width={stripWidth}
                  height={height}
                  fill={getSoilFillUrl(primaryCode)}
                  stroke="#9ca3af"
                  strokeWidth={0.3}
                />
              )
            })}
          </g>
        )
      })}
    </g>
  )
}
