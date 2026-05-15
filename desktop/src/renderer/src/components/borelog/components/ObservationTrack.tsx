import type { ReactElement } from 'react'

import type {
  ObservationLayerResponse,
  ObservationResponse,
} from '../../../api/client'
import { getSoilFillUrl } from '../../../utils/soilPatterns'
import { LITHOLOGY_TYPES, STRATIGRAPHY_TYPES } from '../constants'
import { truncate, usePxPerM } from '../utils'
import { AdmixtureChips } from './AdmixtureChips'
import { AdmixtureStrip, mainLithologyFraction } from './AdmixtureStrip'
import { WrappedText } from './WrappedText'

/**
 * One observation stream rendered as a vertical column on the canvas.
 *
 * Each layer becomes a coloured / patterned rectangle; lithology
 * streams (``coded_lithology`` / ``geotechnical_coding``) use soil-
 * pattern fills + per-layer admixture chips and right-side strips;
 * stratigraphy streams use a soft tinted background with the
 * formation code wrapped centrally; everything else falls through to
 * a free-text "card" rendering.
 */
export function ObservationTrack({
  observation,
  x,
  y,
  width,
  totalDepth,
}: {
  observation: ObservationResponse
  x: number
  y: number
  width: number
  totalDepth: number
}): ReactElement {
  const PX_PER_M = usePxPerM()
  const isLithology = LITHOLOGY_TYPES.has(observation.observation_type)
  const isStratigraphy = STRATIGRAPHY_TYPES.has(observation.observation_type)
  // Anything not lithology and not stratigraphy renders as a text-card
  // (e.g. ``lithological_description`` — free text, no soil codes).
  const cardStyle = !isLithology

  return (
    <g>
      {/* Background rect — CSS var so the track is visible against the
          dark canvas surface (index.css --borelog-track-bg). */}
      <rect
        x={x}
        y={y}
        width={width}
        height={totalDepth * PX_PER_M}
        fill="var(--borelog-track-bg)"
        stroke="var(--borelog-track-header-border)"
        strokeWidth={0.5}
      />
      {observation.layers.map(layer => (
        <ObservationLayerBlock
          key={layer.id}
          layer={layer}
          x={x}
          y={y}
          width={width}
          cardStyle={cardStyle}
          isStratigraphy={isStratigraphy}
        />
      ))}
    </g>
  )
}

/**
 * Single layer rect inside an observation track.
 *
 * Layout decisions:
 *
 *   * Stratigraphy → centred wrapped formation code.
 *   * Lithology    → main-fill rectangle (left portion) + admixture
 *                    strip column (right portion) + per-layer chip
 *                    row along the bottom + soil-code badge at the
 *                    top-left.
 *   * Card style   → free-text label across the rect.
 *
 * Every variant carries top-edge + bottom-edge depth labels in DOV's
 * PDF-report style + a hover ``<title>`` listing the layer's full
 * facts (depth range, colour, main codes, admixtures, description).
 */
function ObservationLayerBlock({
  layer,
  x,
  y,
  width,
  cardStyle,
  isStratigraphy,
}: {
  layer: ObservationLayerResponse
  x: number
  y: number
  width: number
  cardStyle: boolean
  isStratigraphy: boolean
}): ReactElement {
  const PX_PER_M = usePxPerM()
  const top = y + layer.top_m * PX_PER_M
  const height = (layer.base_m - layer.top_m) * PX_PER_M
  const primary = layer.main_soil_codes[0] ?? null
  // Card style uses a CSS var so the background is visible in dark theme.
  // Soil pattern fills (lithology / stratigraphy) come from getSoilFillUrl —
  // those are domain patterns (ISO 14688-1) and their hues must not change.
  const fillUrl = cardStyle ? 'var(--borelog-card-bg)' : getSoilFillUrl(primary)

  const stratLabel = isStratigraphy && layer.description ? layer.description : null
  const lithoBadge = !cardStyle && primary ? primary : null
  const lithoSecondary =
    !cardStyle && layer.main_soil_codes.length > 1
      ? layer.main_soil_codes.slice(1).join(' + ')
      : null
  const admixtureLabel = layer.admixtures
    .map(a => `${a.amount ? a.amount + ' ' : ''}${a.soil_code}${a.locally ? ' (loc.)' : ''}`)
    .join(', ')
  const cardLabel = cardStyle && !isStratigraphy ? layer.description : null

  const tooltipLines = [
    `${layer.top_m.toFixed(2)} – ${layer.base_m.toFixed(2)} m`,
    layer.color ? `Colour: ${layer.color}` : null,
    layer.main_soil_codes.length > 0 ? `Main: ${layer.main_soil_codes.join(', ')}` : null,
    admixtureLabel ? `Admixtures: ${admixtureLabel}` : null,
    layer.description ? `Description: ${layer.description}` : null,
  ].filter(Boolean)

  // Reserve a right-edge strip for admixtures so even short layers
  // (which can't fit text chips) communicate "this layer has X mixed
  // in" visually. Stratigraphy / card-style layers don't have
  // admixtures, so we skip the reservation.
  const hasAdmixtures = !cardStyle && !isStratigraphy && layer.admixtures.length > 0
  const mainFraction = mainLithologyFraction(hasAdmixtures ? layer.admixtures : [])
  const mainWidth = width * mainFraction
  const stripsWidth = width - mainWidth

  return (
    <g>
      <title>{tooltipLines.join('\n')}</title>
      <rect
        x={x}
        y={top}
        width={mainWidth}
        height={height}
        fill={fillUrl}
        stroke="var(--borelog-layer-border)"
        strokeWidth={0.4}
      />

      {hasAdmixtures && stripsWidth > 0 && (
        <AdmixtureStrip
          admixtures={layer.admixtures}
          x={x + mainWidth}
          y={top}
          width={stripsWidth}
          height={height}
        />
      )}

      {stratLabel && height >= 16 && (
        <WrappedText
          text={stratLabel}
          centerX={x + width / 2}
          centerY={top + height / 2}
          maxWidth={width - 6}
          maxHeight={height - 4}
          fontSize={11}
          fontWeight={600}
          fill="var(--borelog-layer-text)"
        />
      )}

      {lithoBadge && height >= 14 && (
        <g>
          {/* Pill badge behind the litho code — CSS vars so the badge
              remains legible on both the domain soil-pattern fill (light)
              and the dark track background. */}
          <rect
            x={x + 2}
            y={top + 2}
            width={Math.min(mainWidth - 4, 18 + lithoBadge.length * 6)}
            height={12}
            rx={1}
            fill="var(--borelog-badge-bg)"
          />
          <text
            x={x + 5}
            y={top + 11}
            fontSize={9}
            fontWeight={600}
            fontFamily="monospace"
            fill="var(--borelog-badge-text)"
          >
            {lithoBadge}
            {lithoSecondary ? ` + ${lithoSecondary}` : ''}
          </text>
        </g>
      )}

      {hasAdmixtures && height >= 24 && (
        <AdmixtureChips
          admixtures={layer.admixtures}
          x={x + 3}
          y={top + height - 4}
          maxWidth={mainWidth - 6}
        />
      )}

      {cardLabel && height >= 14 && (
        <text x={x + 4} y={top + 12} fontSize={9} fill="var(--borelog-layer-text)">
          {truncate(cardLabel, Math.floor(width / 5))}
        </text>
      )}

      <text
        x={x + width - 3}
        y={top + 8}
        textAnchor="end"
        fontSize={8}
        fill="var(--borelog-layer-depth)"
        fontFamily="monospace"
      >
        {layer.top_m.toFixed(2)}
      </text>
      {height >= 14 && (
        <text
          x={x + width - 3}
          y={top + height - 3}
          textAnchor="end"
          fontSize={8}
          fill="var(--borelog-layer-depth)"
          fontFamily="monospace"
        >
          {layer.base_m.toFixed(2)}
        </text>
      )}
    </g>
  )
}
