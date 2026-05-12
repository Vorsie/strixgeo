/**
 * Renders the depth-series data tracks for a single CPT column on
 * the cross-section as ONE shared horizontal band centered on the
 * column's axis (= ``screenX``). Each enabled channel plots into
 * this same band with its own x-scale and direction, mirroring the
 * DOV "lengteprofiel" PDF page-3 convention:
 *
 *   * qc reads RIGHTWARD from the axis (0 at axis, 10 MPa at right
 *     edge), thin black line, dashed gridlines at 2 MPa and 10 MPa.
 *   * Rf reads MIRRORED LEFTWARD from the axis (0 at axis, 10% at
 *     left edge), brown line, dashed gridlines at 2% and 4%.
 *   * fs overlays RIGHTWARD on its own smaller scale (0–0.5 MPa) so
 *     the typical sleeve-friction range fills the band; no labels.
 *   * u2 overlays LEFTWARD on its own scale (0–1 MPa); no labels.
 *   * q_total overlays RIGHTWARD on the qc scale as a dashed line
 *     (CPTM only).
 *
 * Gridline value labels ("2", "10 MPa", "2%", "4%") render above
 * the band at ``bgTopY - 3`` and ONLY when ``showLabels`` is true —
 * SectionPanel suppresses them when the column has a tight
 * neighbour so adjacent labels don't pile up. fs / u2 / qTotal
 * carry no labels by design (their scales differ from qc/Rf and
 * the four label slots are already occupied).
 *
 * Deliberately NOT here: per-CPT auto-scale (DOV's whole point is
 * one shared scale across the section), colour-coded SBT zone
 * fills (Phase 5 concern).
 *
 * NoData samples (``null`` in the series arrays) break the curve
 * into sub-paths instead of bridging across gaps.
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
// brown/amber for friction ratio (matches BoreholeLog's Rf chart for
// cross-component consistency), green for sleeve fs, purple for u2.
const QC_COLOR = '#111827'
const QT_COLOR = '#1f2937'
const RF_COLOR = '#b45309'
const FS_COLOR = '#16a34a'
const U2_COLOR = '#7c3aed'

const GRID_COLOR = '#d1d5db'
const TRACK_BG = '#ffffff'
const TRACK_BORDER = '#e5e7eb'
const LABEL_FILL = '#6b7280'

// fs / u2 full scales — sensitive enough for typical soft-soil readings
// while staying inside the shared band visually. Auto-scaling per CPT
// is intentionally NOT done (would defeat the DOV "one scale across
// the section" rule).
const FS_FULL_SCALE_MPA = 0.5
const U2_FULL_SCALE_MPA = 1.0

interface Props {
  plot: CptPlotResponse
  /** CPT kind ('CPTU' / 'CPTE' / 'CPTM') — gates fs / u2 / q_total
   * per kind; some channels don't apply to mechanical cones. */
  cptType: string
  channels: CptChannels
  /** Half-width of the shared band in px. Column axis sits at
   * ``screenX``; the band extends ±halfWidth. Scaled with zoom by
   * the caller (``SectionPanel``) via ``cptBandHalfWidth``. */
  halfWidth: number
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
  /** When false, suppress gridline value labels for this column.
   * SectionPanel sets this based on neighbour distance — tight
   * columns drop labels so adjacent ones don't overlap. */
  showLabels: boolean
}

export default function CptDataColumn({
  plot,
  cptType,
  channels,
  halfWidth,
  screenX,
  surfaceElevationM,
  plotTop,
  plotBottom,
  levelToScreen,
  showLabels,
}: Props): JSX.Element | null {
  // Memoise sample-index → screen-Y once per render. Must be
  // declared BEFORE any early return so the hook order stays stable
  // across renders even when no channel is enabled.
  const screenYByIdx = useMemo(
    () => plot.depths_m.map(d => levelToScreen(surfaceElevationM - d)),
    [plot.depths_m, levelToScreen, surfaceElevationM],
  )

  const showQc = channels.qc
  const showRf = channels.rf && plot.rf_pct !== null
  const showFs =
    channels.fs && (cptType === 'CPTU' || cptType === 'CPTE') && plot.fs_mpa !== null
  const showU2 = channels.u2 && cptType === 'CPTU' && plot.u2_mpa !== null
  const showQTotal = channels.qTotal && cptType === 'CPTM' && plot.q_total_mpa !== null

  if (!showQc && !showRf && !showFs && !showU2 && !showQTotal) return null

  const axisX = screenX
  const leftX = screenX - halfWidth
  const rightX = screenX + halfWidth

  // Vertical extent of the actual CPT data: surface down to the
  // deepest sample. The track background + gridlines span only this
  // band so the white doesn't bleed across the full plot height and
  // visually mask geology above / below the test.
  const surfaceY = levelToScreen(surfaceElevationM)
  const bottomDepthM =
    plot.depths_m.length > 0 ? plot.depths_m[plot.depths_m.length - 1] : 0
  const dataBottomY = levelToScreen(surfaceElevationM - bottomDepthM)
  const bgTopY = Math.max(plotTop, Math.min(plotBottom, surfaceY))
  const bgBottomY = Math.max(plotTop, Math.min(plotBottom, dataBottomY))
  const hasBand = bgBottomY - bgTopY > 0

  // Gridline positions on the column axis ± a fraction of halfWidth.
  // qc gridlines on the right half; rf gridlines on the (mirrored)
  // left half.
  const qc2X = axisX + (2 / QC_FULL_SCALE_MPA) * halfWidth
  const qc10X = rightX
  const rf2X = axisX - (2 / RF_FULL_SCALE_PCT) * halfWidth
  const rf4X = axisX - (4 / RF_FULL_SCALE_PCT) * halfWidth

  // Label gating: caller's collision flag PLUS local headroom check.
  // ``bgTopY > plotTop + 4`` keeps labels out of the top margin band.
  const renderLabels = showLabels && hasBand && bgTopY > plotTop + 4
  const labelY = bgTopY - 3

  const showSurfaceTick = surfaceY >= plotTop && surfaceY <= plotBottom

  return (
    <g pointerEvents="none">
      {hasBand && (
        <>
          <rect
            x={leftX}
            y={bgTopY}
            width={2 * halfWidth}
            height={bgBottomY - bgTopY}
            fill={TRACK_BG}
            fillOpacity={0.7}
          />
          <line
            x1={leftX}
            x2={leftX}
            y1={bgTopY}
            y2={bgBottomY}
            stroke={TRACK_BORDER}
            strokeWidth={0.5}
          />
          <line
            x1={rightX}
            x2={rightX}
            y1={bgTopY}
            y2={bgBottomY}
            stroke={TRACK_BORDER}
            strokeWidth={0.5}
          />
        </>
      )}

      {showQc && hasBand && (
        <>
          <line
            x1={qc2X}
            x2={qc2X}
            y1={bgTopY}
            y2={bgBottomY}
            stroke={GRID_COLOR}
            strokeWidth={0.5}
            strokeDasharray="2 2"
          />
          <line
            x1={qc10X}
            x2={qc10X}
            y1={bgTopY}
            y2={bgBottomY}
            stroke={GRID_COLOR}
            strokeWidth={0.5}
            strokeDasharray="2 2"
          />
        </>
      )}
      {showRf && hasBand && (
        <>
          <line
            x1={rf2X}
            x2={rf2X}
            y1={bgTopY}
            y2={bgBottomY}
            stroke={GRID_COLOR}
            strokeWidth={0.5}
            strokeDasharray="2 2"
          />
          <line
            x1={rf4X}
            x2={rf4X}
            y1={bgTopY}
            y2={bgBottomY}
            stroke={GRID_COLOR}
            strokeWidth={0.5}
            strokeDasharray="2 2"
          />
        </>
      )}

      {renderLabels && showQc && (
        <>
          <text x={qc2X} y={labelY} fontSize={7} fill={LABEL_FILL} textAnchor="middle">
            2
          </text>
          <text x={qc10X} y={labelY} fontSize={7} fill={LABEL_FILL} textAnchor="end">
            10 MPa
          </text>
        </>
      )}
      {renderLabels && showRf && (
        <>
          <text x={rf2X} y={labelY} fontSize={7} fill={LABEL_FILL} textAnchor="middle">
            2%
          </text>
          <text x={rf4X} y={labelY} fontSize={7} fill={LABEL_FILL} textAnchor="middle">
            4%
          </text>
        </>
      )}

      {showSurfaceTick && (
        <line
          x1={leftX}
          x2={rightX}
          y1={surfaceY}
          y2={surfaceY}
          stroke={QC_COLOR}
          strokeWidth={0.75}
          strokeOpacity={0.5}
        />
      )}

      {showQc && (
        <path
          d={curvePath(plot.qc_mpa, screenYByIdx, axisX, halfWidth, QC_FULL_SCALE_MPA, 1, plotTop, plotBottom)}
          stroke={QC_COLOR}
          strokeWidth={1.1}
          strokeOpacity={0.95}
          fill="none"
        />
      )}
      {showRf && (
        <path
          d={curvePath(plot.rf_pct!, screenYByIdx, axisX, halfWidth, RF_FULL_SCALE_PCT, -1, plotTop, plotBottom)}
          stroke={RF_COLOR}
          strokeWidth={1}
          strokeOpacity={0.9}
          fill="none"
        />
      )}
      {showFs && (
        <path
          d={curvePath(plot.fs_mpa!, screenYByIdx, axisX, halfWidth, FS_FULL_SCALE_MPA, 1, plotTop, plotBottom)}
          stroke={FS_COLOR}
          strokeWidth={1}
          strokeOpacity={0.85}
          fill="none"
        />
      )}
      {showU2 && (
        <path
          d={curvePath(plot.u2_mpa!, screenYByIdx, axisX, halfWidth, U2_FULL_SCALE_MPA, -1, plotTop, plotBottom)}
          stroke={U2_COLOR}
          strokeWidth={1}
          strokeOpacity={0.85}
          fill="none"
        />
      )}
      {showQTotal && (
        <path
          d={curvePath(plot.q_total_mpa!, screenYByIdx, axisX, halfWidth, QT_FULL_SCALE_MPA, 1, plotTop, plotBottom)}
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
// SVG path builder for a depth-vs-value curve in the shared band
// ---------------------------------------------------------------------------
//
// ``direction``: +1 plots rightward from ``axisX`` (qc, fs, qTotal),
// -1 plots leftward (Rf, u2 — the mirrored channels). Out-of-scale
// spikes clip to the band edge rather than escaping; sub-zero values
// clip to the axis. NoData samples break the curve into sub-paths.

function curvePath(
  values: readonly (number | null | undefined)[],
  screenY: readonly number[],
  axisX: number,
  halfWidth: number,
  fullScale: number,
  direction: 1 | -1,
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
    const xRel = Math.max(0, Math.min(1, v / fullScale))
    const x = axisX + direction * xRel * halfWidth
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
