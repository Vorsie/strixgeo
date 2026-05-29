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

import { useEffect, useState } from 'react'

import type {
  BoreholeDetailResponse,
  ObservationResponse,
} from '../../api/client'
import { useClickDebounce } from '../../hooks/useClickDebounce'
import { getSoilFillUrl } from '../../utils/soilPatterns'
import {
  BOREHOLE_CHANNEL_OBSERVATION_TYPES,
  SNAP_TOLERANCE_PX,
  type BoreholeChannels,
} from './cptChannels'
import HoverReadoutCard from './HoverReadoutCard'
import { collectSnapDepths, depthAxisAtSurface } from './utils'

// Which observation types render with patterned soil fills (DOV
// codes drive the pattern) vs. solid card-style fills with a text
// label. Mirrors the same split BoreholeLog.tsx uses for the detail
// panel — stratigraphy + lithological description don't carry
// ``main_soil_codes`` so a pattern fill would be a blank stroke;
// instead we paint a soft off-white background and label each
// layer with its formation / description.
const LITHOLOGY_OBS_TYPES = new Set(['coded_lithology', 'geotechnical_coding'])
const CARD_STYLE_OBS_TYPES = new Set([
  'lithological_description',
  'formal_stratigraphy',
  'informal_stratigraphy',
  'quaternary_stratigraphy',
])
const CARD_FILL = '#f8fafc' // slate-50 — same as BoreholeLog's stratigraphy bg

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
  /** Click anywhere on the lithology strip to place a formation
   * contact at that depth. Caller (SectionPanel) opens the
   * formation picker pre-seeded with the (anchor, depth) tuple.
   * When undefined, the strip stays inert.
   *
   * ``snapped`` flags whether the depth came from a stratigraphy
   * boundary (vs. a free click). Drives the contact's
   * ``source`` (``borehole_observation`` vs ``manual_pick``) and
   * ``confidence`` (``high`` vs ``medium``) — debt #22 / #23. */
  onCommitDepth?: (anchor: {
    kind: 'borehole'
    boreholeId: string
    boreholeName: string
    depth_m: number
    elevationM: number
    snapped: boolean
  }) => void
  /** When true, the click depth snaps to the nearest formal or
   * informal stratigraphy boundary on this borehole if one sits
   * within ``SNAP_TOLERANCE_PX`` of the click Y. Off = free
   * placement. */
  snapToStratigraphy?: boolean
  /** When true, hovering the click-capture overlay shows a small
   * depth + mTAW readout that follows the cursor Y (ghost line +
   * floating card). Used by section focus mode so the user can read
   * depths off a single isolated borehole. The hit-box still
   * renders even without ``onCommitDepth`` when this flag is on, so
   * the readout is available outside the contact-pick flow. */
  showHoverReadout?: boolean
  /** Fires on dbl-click ON THE PICK RECT so the dbl-click intent
   * (open detail) works even when the user dbl-clicks on the
   * borehole's data band. Mirror of ContactPickBar's
   * onDoubleClickOpen — see that prop's docstring for the SVG
   * bubbling explanation. Optional. */
  onDoubleClickOpen?: () => void
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
  onCommitDepth,
  snapToStratigraphy = false,
  showHoverReadout = false,
  onDoubleClickOpen,
}: Props): JSX.Element | null {
  const [cursorY, setCursorY] = useState<number | null>(null)

  // Clear hover state when focus mode flips off — without this the
  // ghost line + card linger until the user moves over the band
  // again. Cheap effect; only fires on showHoverReadout transitions.
  useEffect(() => {
    if (!showHoverReadout) setCursorY(null)
  }, [showHoverReadout])

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
  // Single-vs-double-click gate. MUST sit above the early-return on
  // ``enabledSlots.length === 0`` (and any later return) or React
  // throws "Rendered fewer hooks than expected" the frame a borehole
  // gains its first observation channel (CLAUDE.md "Temporal Dead
  // Zone after reordering React component bodies" / Rules of Hooks).
  const clickDebounce = useClickDebounce()

  if (enabledSlots.length === 0) return null

  const stripWidth = 2 * halfWidth
  const totalWidth = stripWidth * enabledSlots.length
  // Band is centred on the column axis so the column axis stays the
  // visual identity anchor for the test even as the band widens.
  const bandLeftX = screenX - totalWidth / 2

  // Band Y extent in screen coords — surface at top, depth =
  // total_depth_m at bottom (clamped to the plot area). Used by the
  // click-to-place overlay to constrain the pickable region.
  // Shared surface-anchored depth axis (#168): surfaceY + Y→depth inverse.
  const axis = depthAxisAtSurface(levelToScreen, surfaceElevationM)
  const surfaceY = axis.surfaceY
  const bottomY = levelToScreen(
    surfaceElevationM - (detail.total_depth_m ?? Number.POSITIVE_INFINITY),
  )
  const bandTopY = Math.max(plotTop, Math.min(plotBottom, surfaceY))
  const bandBottomY = Math.max(plotTop, Math.min(plotBottom, bottomY))
  const depthAtY = axis.depthAtY

  function snapDepth(
    rawDepth: number,
    rawY: number,
  ): { depth: number; snapped: boolean } {
    if (!snapToStratigraphy) return { depth: rawDepth, snapped: false }
    const candidates = collectSnapDepths(detail)
    if (candidates.length === 0) return { depth: rawDepth, snapped: false }
    let bestDepth = rawDepth
    let bestPxDistance = SNAP_TOLERANCE_PX + 1
    let bestSnapped = false
    for (const candDepth of candidates) {
      const candY = levelToScreen(surfaceElevationM - candDepth)
      const px = Math.abs(candY - rawY)
      if (px <= SNAP_TOLERANCE_PX && px < bestPxDistance) {
        bestPxDistance = px
        bestDepth = candDepth
        bestSnapped = true
      }
    }
    return { depth: bestDepth, snapped: bestSnapped }
  }

  function clampedYFromEvent(e: React.MouseEvent<SVGRectElement>): number {
    const rect = (e.currentTarget as SVGRectElement).getBoundingClientRect()
    const localY = e.clientY - rect.top + bandTopY
    return Math.max(bandTopY, Math.min(bandBottomY, localY))
  }

  // Single-vs-double-click gate — hook is declared above the
  // early-return guard (Rules of Hooks). handleDoubleClick clears
  // the queued single; the outer column's onDoubleClick still fires
  // for detail-open via SVG event bubbling.
  function handleClick(e: React.MouseEvent<SVGRectElement>): void {
    if (!onCommitDepth) return
    // Shift held → user wants the bg-marquee (multi-select). Bail
    // without firing the contact picker so the click bubbles up to
    // the section background's marquee mousedown handler.
    if (e.shiftKey) return
    // Capture depth at click time — the queued thunk runs ~250 ms
    // later, after the user may have moved the cursor.
    const clamped = clampedYFromEvent(e)
    const rawDepth = depthAtY(clamped)
    const { depth, snapped } = snapDepth(rawDepth, clamped)
    const elevationM = surfaceElevationM - depth
    clickDebounce.schedule(() =>
      onCommitDepth({
        kind: 'borehole',
        boreholeId: detail.id,
        boreholeName: detail.name,
        depth_m: depth,
        elevationM,
        snapped,
      }),
    )
  }
  function handleDoubleClick(): void {
    clickDebounce.cancel()
    // Forward the dbl-click intent to the column's detail-open
    // handler — the outer ColumnGlyph's onDoubleClick doesn't see
    // this event (sibling, not parent in the SVG tree).
    if (onDoubleClickOpen) onDoubleClickOpen()
  }

  function handleMouseMove(e: React.MouseEvent<SVGRectElement>): void {
    if (!showHoverReadout) return
    setCursorY(clampedYFromEvent(e))
  }

  function handleMouseLeave(): void {
    if (!showHoverReadout) return
    setCursorY(null)
  }

  // Effective hover depth honours snap so the ghost line + readout
  // reflect what would commit on click.
  const hoverDepth =
    cursorY === null ? null : snapDepth(depthAtY(cursorY), cursorY).depth
  const hoverElevation =
    hoverDepth === null ? null : surfaceElevationM - hoverDepth
  const hoverRenderY =
    hoverDepth === null ? null : levelToScreen(surfaceElevationM - hoverDepth)

  return (
    <g pointerEvents="none">
      {/* Click + hover capture overlay over the full band. Renders
          ABOVE the layer rects (paint order is parent-then-children,
          so this sibling sits visually behind subsequent siblings;
          but ``pointer-events=auto`` on this rect means it catches
          events first inside the band area). The rect renders when
          EITHER onCommitDepth is wired (the contact-pick flow) OR
          showHoverReadout is on (focus mode without a model is
          still allowed to show the readout). Crosshair cursor when
          a click would commit; default when read-only. */}
      {(onCommitDepth || showHoverReadout) && bandBottomY - bandTopY > 0 && (
        <rect
          x={bandLeftX}
          y={bandTopY}
          width={totalWidth}
          height={bandBottomY - bandTopY}
          fill="transparent"
          style={{ cursor: onCommitDepth ? 'crosshair' : 'default' }}
          pointerEvents="auto"
          onClick={onCommitDepth ? handleClick : undefined}
          // onDoubleClick wires when EITHER onCommitDepth is wired
          // (to cancel the queued single) OR onDoubleClickOpen is
          // wired (to open detail).
          onDoubleClick={
            onCommitDepth || onDoubleClickOpen ? handleDoubleClick : undefined
          }
          onMouseMove={showHoverReadout ? handleMouseMove : undefined}
          onMouseLeave={showHoverReadout ? handleMouseLeave : undefined}
        />
      )}
      {/* Hover readout — ghost line at the snapped cursor depth +
          a 2-line card (depth, m TAW) to the right of the band.
          Suppressed when the hit-box isn't capturing (no
          showHoverReadout) or before the user has moved over the
          band (cursorY === null). */}
      {showHoverReadout && cursorY !== null && hoverDepth !== null &&
        hoverElevation !== null && hoverRenderY !== null && (
          <g pointerEvents="none">
            <line
              x1={bandLeftX - 6}
              x2={bandLeftX + totalWidth + 6}
              y1={hoverRenderY}
              y2={hoverRenderY}
              stroke="#dc2626"
              strokeWidth={1}
              strokeOpacity={0.85}
              strokeDasharray="3 2"
            />
            <HoverReadoutCard
              x={bandLeftX + totalWidth + 8}
              y={hoverRenderY}
              plotTop={plotTop}
              plotBottom={plotBottom}
              lines={[
                { text: `depth ${hoverDepth.toFixed(2)} m` },
                {
                  text: `${hoverElevation >= 0 ? '+' : ''}${hoverElevation.toFixed(
                    2,
                  )} m TAW`,
                },
              ]}
            />
          </g>
        )}
      {enabledSlots.map((slot, i) => {
        const stripLeftX = bandLeftX + i * stripWidth
        if (slot.obs === null || slot.obs.layers.length === 0) {
          // Empty strip — keeps the slot footprint consistent across
          // boreholes even when this borehole doesn't carry the
          // selected stream. Zero-height "ghost" so the layout
          // dimension is preserved without painting anything.
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
        const obsType = slot.obs.observation_type
        const isLithology = LITHOLOGY_OBS_TYPES.has(obsType)
        const isCardStyle = CARD_STYLE_OBS_TYPES.has(obsType)
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
              const fill = isCardStyle
                ? CARD_FILL
                : isLithology
                  ? getSoilFillUrl(primaryCode)
                  : getSoilFillUrl(primaryCode)
              // Card-style strips carry a centred label per layer with
              // the formation name (stratigraphy) or the free-text
              // description. Mirrors BoreholeLog.tsx's stratigraphy
              // track. Skip labels on slices too short to render text
              // (< 14 px); skip lithology strips entirely (pattern
              // fill IS the label).
              const cardLabel = isCardStyle ? layer.description : null
              return (
                <g key={layer.id}>
                  <rect
                    x={stripLeftX}
                    y={clampedTop}
                    width={stripWidth}
                    height={height}
                    fill={fill}
                    stroke="#9ca3af"
                    strokeWidth={0.3}
                  />
                  {cardLabel && height >= 14 && (
                    <text
                      x={stripLeftX + stripWidth / 2}
                      y={clampedTop + height / 2}
                      fontSize={8}
                      fill="#1f2937"
                      textAnchor="middle"
                      dominantBaseline="middle"
                    >
                      {cardLabel.length > 8 ? `${cardLabel.slice(0, 7)}…` : cardLabel}
                    </text>
                  )}
                </g>
              )
            })}
          </g>
        )
      })}
    </g>
  )
}
