/**
 * Renders the depth-series data tracks for a single CPT column on
 * the cross-section. Channels (qc / Rf / fs / u2 / q_total) are
 * stacked side-by-side inside the column band, centred on
 * ``screenX``. Each track plots its values vs. depth top-down with
 * the elevation at the cap matching the column's surface level.
 *
 * Visual conventions:
 *
 *   * qc curve: black thin line, plotted left-to-right within its
 *     track (0 → 10 MPa default scale, matching DOV PDFs).
 *   * Rf strip: colour-coded vertical fill (0-2% green / 2-4% blue
 *     / 4-6% orange / >6% red). Echoes the DOV PDF colour bins so
 *     engineers reading both formats interpret the strip the same way.
 *   * fs / u2: thin coloured lines, same horizontal-scale convention.
 *   * q_total: dashed black line overlaid on the qc track (CPTM only).
 *
 * NoData values (``null`` in the depth-series arrays — void-masked
 * rows) break the curve into sub-paths instead of bridging.
 *
 * The component takes the pixel x-range it owns from the caller
 * (``leftX`` / ``trackWidths``) — the section panel computes the
 * full column layout including the bare cap + tie-back, and just
 * hands this component the data-track slot.
 */

import { useMemo } from 'react'

import type { CptPlotResponse } from '../../api/client'
import {
  CPT_CHANNEL_WIDTH_PX,
  type CptChannels,
} from './cptChannels'

// Default qc full-scale. 10 MPa per column width matches DOV's
// "lengteprofiel" PDF default. Future: per-section override toggle.
const QC_FULL_SCALE_MPA = 10
const QT_FULL_SCALE_MPA = 10
// Rf colour bins. DOV's PDF uses essentially these thresholds
// (0–2 / 2–4 / 4–6 / >6 %) — handy because engineers used to the
// public viewer don't have to re-learn anything.
function rfFill(rf: number | null | undefined): string {
  if (rf == null || rf < 0) return 'transparent'
  if (rf < 2) return '#86efac' // green-300
  if (rf < 4) return '#60a5fa' // blue-400
  if (rf < 6) return '#fb923c' // orange-400
  return '#dc2626' // red-600 — high friction ratio = fine-grained
}

const QC_COLOR = '#111827'
const FS_COLOR = '#16a34a'
const U2_COLOR = '#7c3aed'

interface Props {
  plot: CptPlotResponse
  /** CPT kind ('CPTU' / 'CPTE' / 'CPTM') — used to gate fs / u2 /
   * q_total tracks; some channels don't apply per kind. */
  cptType: string
  channels: CptChannels
  /** Screen X of the column centerline (the nudged X from the
   * layout pass — see ``nudgeColumns``). */
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
  screenX,
  surfaceElevationM,
  plotTop,
  plotBottom,
  levelToScreen,
}: Props): JSX.Element | null {
  // Compute per-channel track slots inside the column band. The
  // overall column width is the sum of enabled widths (see
  // ``cptDataTrackWidth``); each enabled track gets its slot
  // left-to-right starting from the column's left edge.
  const slots = useMemo(() => computeSlots(cptType, channels, screenX), [
    cptType,
    channels,
    screenX,
  ])
  if (slots.tracks.length === 0) return null

  // Map (depth_m → screen Y) once per render; reused across every
  // channel that plots vs. depth.
  const screenYByIdx = useMemo(
    () => plot.depths_m.map(d => levelToScreen(surfaceElevationM - d)),
    [plot.depths_m, levelToScreen, surfaceElevationM],
  )

  return (
    <g>
      {slots.tracks.map(track => {
        switch (track.kind) {
          case 'qc':
            return (
              <QcTrack
                key="qc"
                slot={track}
                depths={plot.depths_m}
                qc={plot.qc_mpa}
                qTotal={
                  cptType === 'CPTM' && channels.qTotal ? plot.q_total_mpa : null
                }
                screenY={screenYByIdx}
                plotTop={plotTop}
                plotBottom={plotBottom}
              />
            )
          case 'rf':
            return (
              <RfStrip
                key="rf"
                slot={track}
                depths={plot.depths_m}
                rf={plot.rf_pct}
                screenY={screenYByIdx}
                plotTop={plotTop}
                plotBottom={plotBottom}
              />
            )
          case 'fs':
            return (
              <LineTrack
                key="fs"
                slot={track}
                depths={plot.depths_m}
                values={plot.fs_mpa}
                fullScale={0.5} // typical fs scale 0..500 kPa = 0.5 MPa
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
                slot={track}
                depths={plot.depths_m}
                values={plot.u2_mpa}
                fullScale={1.0} // typical u2 scale 0..1 MPa
                color={U2_COLOR}
                screenY={screenYByIdx}
                plotTop={plotTop}
                plotBottom={plotBottom}
              />
            )
          case 'qTotal':
            // q_total is rendered overlaid on the qc track for CPTM
            // (handled inside QcTrack via the ``qTotal`` prop above);
            // if qc is OFF but qTotal is ON, we still draw it as a
            // standalone line at the q_total full scale.
            return channels.qc ? null : (
              <LineTrack
                key="qTotal"
                slot={track}
                depths={plot.depths_m}
                values={plot.q_total_mpa}
                fullScale={QT_FULL_SCALE_MPA}
                color={QC_COLOR}
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
  screenX: number,
): { tracks: TrackSlot[]; totalWidth: number } {
  // Build the list of enabled tracks for this kind, in display
  // order: qc | Rf | fs | u2 (qTotal overlays qc for CPTM).
  const enabled: TrackKind[] = []
  if (channels.qc) enabled.push('qc')
  if (channels.rf) enabled.push('rf')
  if (channels.fs && (cptType === 'CPTU' || cptType === 'CPTE')) enabled.push('fs')
  if (channels.u2 && cptType === 'CPTU') enabled.push('u2')
  // Standalone q_total slot only when qc is OFF (otherwise overlaid).
  if (channels.qTotal && cptType === 'CPTM' && !channels.qc) enabled.push('qTotal')

  const widths = enabled.map(k => CPT_CHANNEL_WIDTH_PX[k])
  const totalWidth = widths.reduce((a, b) => a + b, 0)
  if (totalWidth === 0) return { tracks: [], totalWidth: 0 }

  // Centre the data band on the column's nudged X.
  let cursor = screenX - totalWidth / 2
  const tracks: TrackSlot[] = enabled.map((kind, i) => {
    const w = widths[i]
    const slot: TrackSlot = { kind, leftX: cursor, rightX: cursor + w, width: w }
    cursor += w
    return slot
  })
  return { tracks, totalWidth }
}

// ---------------------------------------------------------------------------
// qc track — line plot with optional q_total overlay (CPTM)
// ---------------------------------------------------------------------------

function QcTrack({
  slot,
  depths,
  qc,
  qTotal,
  screenY,
  plotTop,
  plotBottom,
}: {
  slot: TrackSlot
  depths: number[]
  qc: number[]
  qTotal: (number | null)[] | null
  screenY: number[]
  plotTop: number
  plotBottom: number
}): JSX.Element {
  const qcPath = curvePath(depths, qc, screenY, slot, QC_FULL_SCALE_MPA, plotTop, plotBottom)
  const qtPath = qTotal
    ? curvePath(depths, qTotal, screenY, slot, QT_FULL_SCALE_MPA, plotTop, plotBottom)
    : ''
  return (
    <g pointerEvents="none">
      {/* Track-back tint so the qc curve reads against any future
          DEM hillshade or sectional fill. Very subtle. */}
      <rect
        x={slot.leftX}
        y={plotTop}
        width={slot.width}
        height={plotBottom - plotTop}
        fill="#fafafa"
        fillOpacity={0.5}
      />
      {qcPath && (
        <path d={qcPath} stroke={QC_COLOR} strokeWidth={1.1} strokeOpacity={0.9} fill="none" />
      )}
      {qtPath && (
        <path
          d={qtPath}
          stroke={QC_COLOR}
          strokeWidth={1}
          strokeOpacity={0.7}
          strokeDasharray="3 2"
          fill="none"
        />
      )}
    </g>
  )
}

// ---------------------------------------------------------------------------
// Rf strip — colour-coded vertical fill
// ---------------------------------------------------------------------------

function RfStrip({
  slot,
  depths,
  rf,
  screenY,
  plotTop,
  plotBottom,
}: {
  slot: TrackSlot
  depths: number[]
  rf: (number | null)[] | null
  screenY: number[]
  plotTop: number
  plotBottom: number
}): JSX.Element | null {
  if (rf === null || rf.length === 0) return null
  // Build a list of vertical rect runs, one per consecutive
  // same-bin block. Cheaper than a rect per depth row when many
  // adjacent rows fall in the same colour bin.
  const segments: Array<{ y0: number; y1: number; color: string }> = []
  let currentColor: string | null = null
  let currentStartIdx = 0
  for (let i = 0; i < rf.length; i += 1) {
    const c = rfFill(rf[i])
    if (currentColor === null) {
      currentColor = c
      currentStartIdx = i
      continue
    }
    if (c !== currentColor) {
      const y0 = screenY[currentStartIdx]
      const y1 = screenY[i]
      if (currentColor !== 'transparent') segments.push({ y0, y1, color: currentColor })
      currentColor = c
      currentStartIdx = i
    }
  }
  // Close the trailing run.
  if (currentColor !== null && currentColor !== 'transparent') {
    const y0 = screenY[currentStartIdx]
    const y1 = screenY[rf.length - 1]
    segments.push({ y0, y1, color: currentColor })
  }
  void depths // unused — depths feed screenY upstream
  return (
    <g pointerEvents="none">
      {segments.map((seg, i) => {
        const y0 = Math.max(plotTop, Math.min(plotBottom, seg.y0))
        const y1 = Math.max(plotTop, Math.min(plotBottom, seg.y1))
        if (y1 <= y0) return null
        return (
          <rect
            key={i}
            x={slot.leftX}
            y={y0}
            width={slot.width}
            height={y1 - y0}
            fill={seg.color}
            fillOpacity={0.7}
          />
        )
      })}
    </g>
  )
}

// ---------------------------------------------------------------------------
// Generic line track — fs, u2, standalone q_total
// ---------------------------------------------------------------------------

function LineTrack({
  slot,
  depths,
  values,
  fullScale,
  color,
  dashed,
  screenY,
  plotTop,
  plotBottom,
}: {
  slot: TrackSlot
  depths: number[]
  values: (number | null)[] | null
  fullScale: number
  color: string
  dashed?: boolean
  screenY: number[]
  plotTop: number
  plotBottom: number
}): JSX.Element | null {
  if (values === null || values.length === 0) return null
  const d = curvePath(depths, values, screenY, slot, fullScale, plotTop, plotBottom)
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
  depths: number[],
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
    const x = slot.leftX + Math.max(0, Math.min(slot.width, (v / fullScale) * slot.width))
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
  void depths
  return d.trim()
}
