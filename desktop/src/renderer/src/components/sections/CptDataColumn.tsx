/**
 * Renders the depth-series data tracks for a single CPT column on
 * the cross-section. Each enabled channel gets a slot side-by-side
 * inside the column band, centred on ``screenX``.
 *
 * Visual conventions follow DOV's "lengteprofiel" PDF so engineers
 * used to the public viewer read the section identically:
 *
 *   * qc track: 0..10 MPa horizontal scale, qc plotted as a thin
 *     black line, dashed gridline at 2 MPa for reference.
 *   * Rf track: 0..10% horizontal scale, Rf plotted as a thin
 *     brown line, dashed gridlines at 2 % and 4 %.
 *   * fs / u2: thin coloured lines (CPTU/CPTE only, off by default).
 *   * q_total: dashed black, overlaid on the qc track for CPTM. If
 *     qc is OFF, q_total gets its own slot at the same full scale.
 *
 * Deliberately NOT here: colour-coded Rf bin fills (would be
 * mistaken for SBT zones), per-CPT auto-scaling (DOV's whole point
 * is one shared scale for visual comparison). Soil behaviour type
 * classification is a Phase 5 concern.
 *
 * NoData samples (``null`` in the series arrays — void-masked
 * rows) break the curve into sub-paths instead of bridging across
 * gaps.
 */

import { useMemo } from 'react'

import type { CptPlotResponse } from '../../api/client'
import {
  QC_FULL_SCALE_MPA,
  QT_FULL_SCALE_MPA,
  RF_FULL_SCALE_PCT,
  type CptChannels,
} from './cptChannels'

// Curve colours — black for the cone-resistance family (qc + qt),
// brown/amber for friction ratio (matches the BoreholeLog's Rf
// chart for cross-component consistency), green for sleeve fs,
// purple for u2.
const QC_COLOR = '#111827' // gray-900 — primary signal, max contrast
const QT_COLOR = '#1f2937' // gray-800, dashed overlay
const RF_COLOR = '#b45309' // amber-700 — matches BoreholeLog
const FS_COLOR = '#16a34a' // green-600
const U2_COLOR = '#7c3aed' // violet-600

const GRID_COLOR = '#d1d5db' // gray-300 — subtle scale tick lines
const TRACK_BG = '#ffffff' // explicit white so the curves read over the DEM hillshade
const TRACK_BORDER = '#e5e7eb' // gray-200 — left/right edge ticks of each slot

interface Props {
  plot: CptPlotResponse
  /** CPT kind ('CPTU' / 'CPTE' / 'CPTM') — gates fs / u2 / q_total
   * per kind; some channels don't apply to mechanical cones. */
  cptType: string
  channels: CptChannels
  /** Pixel widths for each channel at the current zoom level —
   * comes from ``cptTrackWidths(scaleH)``. The component does the
   * slot math from this; the section panel does the nudge layout
   * from ``cptDataTrackWidth`` over the same widths so positions
   * and widths agree. */
  widths: Record<keyof CptChannels, number>
  /** Screen X of the column centerline (the nudged X from the
   * width-aware layout pass — see ``nudgeColumns``). */
  screenX: number
  /** Elevation in m of the column's top (surface level). The data
   * tracks render from this Y downward at ``elevation - depth``. */
  surfaceElevationM: number
  /** Plot-area Y bounds — anything outside gets clipped. */
  plotTop: number
  plotBottom: number
  /** World-level (m TAW) → screen Y converter from the section
   * panel's viewport. */
  levelToScreen: (level: number) => number
}

export default function CptDataColumn({
  plot,
  cptType,
  channels,
  widths,
  screenX,
  surfaceElevationM,
  plotTop,
  plotBottom,
  levelToScreen,
}: Props): JSX.Element | null {
  const slots = useMemo(
    () => computeSlots(cptType, channels, widths, screenX),
    [cptType, channels, widths, screenX],
  )
  if (slots.length === 0) return null

  // Map (sample index → screen Y) once per render; reused across
  // every channel that plots vs. depth.
  const screenYByIdx = useMemo(
    () => plot.depths_m.map(d => levelToScreen(surfaceElevationM - d)),
    [plot.depths_m, levelToScreen, surfaceElevationM],
  )

  // Drop a horizontal "data top" tick where the curve will start —
  // matches DOV's convention of showing the surface contact even
  // when no qc sample exists at exactly 0 m depth.
  const surfaceY = levelToScreen(surfaceElevationM)

  // Vertical extent of the actual CPT data: surface down to the
  // deepest sample. The track background spans only this band so
  // the white doesn't bleed across the full plot height and visually
  // mask geology above / below the test.
  const bottomDepthM =
    plot.depths_m.length > 0 ? plot.depths_m[plot.depths_m.length - 1] : 0
  const dataBottomY = levelToScreen(surfaceElevationM - bottomDepthM)
  const bgTopY = Math.max(plotTop, Math.min(plotBottom, surfaceY))
  const bgBottomY = Math.max(plotTop, Math.min(plotBottom, dataBottomY))

  return (
    <g pointerEvents="none">
      {slots.map(slot => (
        <TrackBackground
          key={`bg-${slot.kind}`}
          slot={slot}
          topY={bgTopY}
          bottomY={bgBottomY}
        />
      ))}
      {slots.map(slot => {
        switch (slot.kind) {
          case 'qc':
            return (
              <QcTrack
                key="qc"
                slot={slot}
                qc={plot.qc_mpa}
                qTotal={cptType === 'CPTM' && channels.qTotal ? plot.q_total_mpa : null}
                screenY={screenYByIdx}
                plotTop={plotTop}
                plotBottom={plotBottom}
                surfaceY={surfaceY}
                bgTopY={bgTopY}
                bgBottomY={bgBottomY}
              />
            )
          case 'rf':
            return (
              <RfTrack
                key="rf"
                slot={slot}
                rf={plot.rf_pct}
                screenY={screenYByIdx}
                plotTop={plotTop}
                plotBottom={plotBottom}
                surfaceY={surfaceY}
                bgTopY={bgTopY}
                bgBottomY={bgBottomY}
              />
            )
          case 'fs':
            return (
              <LineTrack
                key="fs"
                slot={slot}
                values={plot.fs_mpa}
                fullScale={0.5}
                color={FS_COLOR}
                screenY={screenYByIdx}
                plotTop={plotTop}
                plotBottom={plotBottom}
              />
            )
          case 'u2':
            return (
              <LineTrack
                key="u2"
                slot={slot}
                values={plot.u2_mpa}
                fullScale={1.0}
                color={U2_COLOR}
                screenY={screenYByIdx}
                plotTop={plotTop}
                plotBottom={plotBottom}
              />
            )
          case 'qTotal':
            return (
              <LineTrack
                key="qTotal"
                slot={slot}
                values={plot.q_total_mpa}
                fullScale={QT_FULL_SCALE_MPA}
                color={QT_COLOR}
                dashed
                screenY={screenYByIdx}
                plotTop={plotTop}
                plotBottom={plotBottom}
              />
            )
        }
      })}
    </g>
  )
}

// ---------------------------------------------------------------------------
// Slot layout — assign each enabled track a [leftX, rightX] band
// ---------------------------------------------------------------------------

type TrackKind = 'qc' | 'rf' | 'fs' | 'u2' | 'qTotal'

interface TrackSlot {
  kind: TrackKind
  leftX: number
  rightX: number
  width: number
}

function computeSlots(
  cptType: string,
  channels: CptChannels,
  widths: Record<keyof CptChannels, number>,
  screenX: number,
): TrackSlot[] {
  const enabled: TrackKind[] = []
  // DOV PDF convention (lengteprofiel page 3, scale annotation
  // "4% 2%2 +Z 10 MPa"): Rf reads on the LEFT of the column, qc on
  // the RIGHT. fs / u2 / standalone q_total follow on the far right
  // when their channels are enabled.
  if (channels.rf) enabled.push('rf')
  if (channels.qc) enabled.push('qc')
  if (channels.fs && (cptType === 'CPTU' || cptType === 'CPTE')) enabled.push('fs')
  if (channels.u2 && cptType === 'CPTU') enabled.push('u2')
  // Standalone q_total slot only when qc is OFF (otherwise overlaid).
  if (channels.qTotal && cptType === 'CPTM' && !channels.qc) enabled.push('qTotal')

  const slotWidths = enabled.map(k => widths[k])
  const totalWidth = slotWidths.reduce((a, b) => a + b, 0)
  if (totalWidth === 0) return []

  // Centre the data band on the column's nudged X.
  let cursor = screenX - totalWidth / 2
  return enabled.map((kind, i) => {
    const w = slotWidths[i]
    const slot: TrackSlot = { kind, leftX: cursor, rightX: cursor + w, width: w }
    cursor += w
    return slot
  })
}

// ---------------------------------------------------------------------------
// Track background — subtle white fill so curves read over the DEM
// hillshade, plus left/right tick lines marking the slot edges.
// ---------------------------------------------------------------------------

function TrackBackground({
  slot,
  topY,
  bottomY,
}: {
  slot: TrackSlot
  /** Top of the data band in screen px (clamped to plot bounds). */
  topY: number
  /** Bottom of the data band in screen px (clamped to plot bounds). */
  bottomY: number
}): JSX.Element | null {
  const height = bottomY - topY
  if (height <= 0) return null
  return (
    <g pointerEvents="none">
      <rect
        x={slot.leftX}
        y={topY}
        width={slot.width}
        height={height}
        fill={TRACK_BG}
        fillOpacity={0.7}
      />
      <line
        x1={slot.leftX}
        x2={slot.leftX}
        y1={topY}
        y2={bottomY}
        stroke={TRACK_BORDER}
        strokeWidth={0.5}
      />
      <line
        x1={slot.rightX}
        x2={slot.rightX}
        y1={topY}
        y2={bottomY}
        stroke={TRACK_BORDER}
        strokeWidth={0.5}
      />
    </g>
  )
}

// ---------------------------------------------------------------------------
// qc track — primary signal, with 2 MPa gridline + optional q_total
// dashed overlay (CPTM with both channels on)
// ---------------------------------------------------------------------------

function QcTrack({
  slot,
  qc,
  qTotal,
  screenY,
  plotTop,
  plotBottom,
  surfaceY,
  bgTopY,
  bgBottomY,
}: {
  slot: TrackSlot
  qc: number[]
  qTotal: (number | null)[] | null
  screenY: number[]
  plotTop: number
  plotBottom: number
  surfaceY: number
  /** Top / bottom Y of the CPT data band — gridlines are trimmed to
   * this range so they don't bleed across the full plot height. */
  bgTopY: number
  bgBottomY: number
}): JSX.Element {
  const qcPath = curvePath(qc, screenY, slot, QC_FULL_SCALE_MPA, plotTop, plotBottom)
  const qtPath = qTotal
    ? curvePath(qTotal, screenY, slot, QT_FULL_SCALE_MPA, plotTop, plotBottom)
    : ''
  // 2 MPa gridline (DOV reference for the loose-vs-dense sand
  // transition) + 10 MPa gridline at the qc full-scale right edge.
  // Both bounded to the data extent rather than the full plot
  // height — the section reads cleaner when the dashed grey lines
  // stop where the CPT does.
  const grid2X = slot.leftX + (2 / QC_FULL_SCALE_MPA) * slot.width
  const grid10X = slot.rightX
  const showSurfaceTick = surfaceY >= plotTop && surfaceY <= plotBottom
  const showLabels = bgBottomY - bgTopY > 4 && bgTopY > plotTop + 4
  const labelY = bgTopY - 3
  return (
    <g pointerEvents="none">
      <line
        x1={grid2X}
        x2={grid2X}
        y1={bgTopY}
        y2={bgBottomY}
        stroke={GRID_COLOR}
        strokeWidth={0.5}
        strokeDasharray="2 2"
      />
      <line
        x1={grid10X}
        x2={grid10X}
        y1={bgTopY}
        y2={bgBottomY}
        stroke={GRID_COLOR}
        strokeWidth={0.5}
        strokeDasharray="2 2"
      />
      {showLabels && (
        <>
          <text
            x={grid2X}
            y={labelY}
            fontSize={7}
            fill="#6b7280"
            textAnchor="middle"
          >
            2
          </text>
          <text
            x={grid10X}
            y={labelY}
            fontSize={7}
            fill="#6b7280"
            textAnchor="end"
          >
            10 MPa
          </text>
        </>
      )}
      {showSurfaceTick && (
        <line
          x1={slot.leftX}
          x2={slot.rightX}
          y1={surfaceY}
          y2={surfaceY}
          stroke={QC_COLOR}
          strokeWidth={0.75}
          strokeOpacity={0.5}
        />
      )}
      {qcPath && (
        <path d={qcPath} stroke={QC_COLOR} strokeWidth={1.1} strokeOpacity={0.95} fill="none" />
      )}
      {qtPath && (
        <path
          d={qtPath}
          stroke={QT_COLOR}
          strokeWidth={1}
          strokeOpacity={0.75}
          strokeDasharray="3 2"
          fill="none"
        />
      )}
    </g>
  )
}

// ---------------------------------------------------------------------------
// Rf track — friction ratio as a line, with 2 % and 4 % gridlines
// matching DOV's PDF convention. NOT colour-coded SBT bins — those
// would conflate measurement with classification (Phase 5).
// ---------------------------------------------------------------------------

function RfTrack({
  slot,
  rf,
  screenY,
  plotTop,
  plotBottom,
  surfaceY,
  bgTopY,
  bgBottomY,
}: {
  slot: TrackSlot
  rf: (number | null)[] | null
  screenY: number[]
  plotTop: number
  plotBottom: number
  surfaceY: number
  bgTopY: number
  bgBottomY: number
}): JSX.Element | null {
  if (rf === null || rf.length === 0) return null
  const rfPath = curvePath(rf, screenY, slot, RF_FULL_SCALE_PCT, plotTop, plotBottom)
  const grid2 = slot.leftX + (2 / RF_FULL_SCALE_PCT) * slot.width
  const grid4 = slot.leftX + (4 / RF_FULL_SCALE_PCT) * slot.width
  const showSurfaceTick = surfaceY >= plotTop && surfaceY <= plotBottom
  const showLabels = bgBottomY - bgTopY > 4 && bgTopY > plotTop + 4
  const labelY = bgTopY - 3
  return (
    <g pointerEvents="none">
      <line
        x1={grid2}
        x2={grid2}
        y1={bgTopY}
        y2={bgBottomY}
        stroke={GRID_COLOR}
        strokeWidth={0.5}
        strokeDasharray="2 2"
      />
      <line
        x1={grid4}
        x2={grid4}
        y1={bgTopY}
        y2={bgBottomY}
        stroke={GRID_COLOR}
        strokeWidth={0.5}
        strokeDasharray="2 2"
      />
      {showLabels && (
        <>
          <text x={grid2} y={labelY} fontSize={7} fill="#6b7280" textAnchor="middle">
            2%
          </text>
          <text x={grid4} y={labelY} fontSize={7} fill="#6b7280" textAnchor="middle">
            4%
          </text>
        </>
      )}
      {showSurfaceTick && (
        <line
          x1={slot.leftX}
          x2={slot.rightX}
          y1={surfaceY}
          y2={surfaceY}
          stroke={RF_COLOR}
          strokeWidth={0.75}
          strokeOpacity={0.5}
        />
      )}
      {rfPath && (
        <path d={rfPath} stroke={RF_COLOR} strokeWidth={1} strokeOpacity={0.9} fill="none" />
      )}
    </g>
  )
}

// ---------------------------------------------------------------------------
// Generic line track — fs, u2, standalone q_total
// ---------------------------------------------------------------------------

function LineTrack({
  slot,
  values,
  fullScale,
  color,
  dashed,
  screenY,
  plotTop,
  plotBottom,
}: {
  slot: TrackSlot
  values: (number | null)[] | null
  fullScale: number
  color: string
  dashed?: boolean
  screenY: number[]
  plotTop: number
  plotBottom: number
}): JSX.Element | null {
  if (values === null || values.length === 0) return null
  const d = curvePath(values, screenY, slot, fullScale, plotTop, plotBottom)
  if (d === '') return null
  return (
    <path
      pointerEvents="none"
      d={d}
      stroke={color}
      strokeWidth={1}
      strokeOpacity={0.85}
      strokeDasharray={dashed ? '3 2' : undefined}
      fill="none"
    />
  )
}

// ---------------------------------------------------------------------------
// SVG path builder for a depth-vs-value curve
// ---------------------------------------------------------------------------
//
// Walks the depth-series sample by sample. Each row contributes one
// "M" or "L" command depending on whether the previous sample was
// in-bounds + non-null. NoData samples break the curve into sub-
// paths so the renderer doesn't bridge across gaps.

function curvePath(
  values: readonly (number | null | undefined)[],
  screenY: readonly number[],
  slot: TrackSlot,
  fullScale: number,
  plotTop: number,
  plotBottom: number,
): string {
  let d = ''
  let penDown = false
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i]
    if (v === null || v === undefined || !Number.isFinite(v)) {
      penDown = false
      continue
    }
    // Clamp horizontally so out-of-scale spikes don't escape the
    // slot. DOV does the same — peaks above 10 MPa hit the right
    // edge and stay there. Sub-zero values clip to leftX.
    const xRel = Math.max(0, Math.min(1, v / fullScale))
    const x = slot.leftX + xRel * slot.width
    const y = screenY[i]
    if (y < plotTop || y > plotBottom) {
      penDown = false
      continue
    }
    if (!penDown) {
      d += `M ${x.toFixed(2)} ${y.toFixed(2)} `
      penDown = true
    } else {
      d += `L ${x.toFixed(2)} ${y.toFixed(2)} `
    }
  }
  return d.trim()
}
