/**
 * Interactive "ghost" column overlay showing lithostratigraphic layer
 * suggestions from the Robertson-2015/borehole segmenter for one
 * investigation at a time.  Each suggested layer renders as a coloured,
 * semi-transparent rectangle beside the investigation's data band.
 *
 * Per-layer interaction: clicking a layer toggles accept/reject.  The
 * caller owns the Set state (``acceptedIndices`` / ``rejectedIndices``)
 * and the ``onAccept`` / ``onReject`` callbacks so the state machine
 * lives in the hook, not here.  The component is a pure SVG renderer.
 *
 * Visual identity mirrors the VirtueleBoringGhostColumns opacity so the
 * two overlays are visually consistent when both are active.
 *
 * Layout: to the **left** of the investigation band (opposite side from
 * the VirtueleBoringGhostColumns which are on the right) to avoid
 * collision with existing overlays.
 */

import type { LithoLayerSuggestion } from '../../api/client'
import type { PlacedColumn } from './utils'
import { maxCharsForWidth, maxLinesForHeight, wrapLabelToLines } from '../../utils/labelWrap'

// ---------------------------------------------------------------------------
// Visual constants
// ---------------------------------------------------------------------------

/** Width of the suggestion ghost column in pixels. */
export const LITHO_GHOST_COLUMN_WIDTH_PX = 48
/** Gap between the data band and the ghost column. */
export const LITHO_GHOST_GAP_FROM_BAND_PX = 6

const GHOST_OPACITY_DEFAULT = 0.55
const GHOST_OPACITY_ACCEPTED = 0.85
const GHOST_OPACITY_REJECTED = 0.2
const LABEL_FONT_SIZE = 9
const HEADER_FONT_SIZE = 8

/**
 * Standard sediment colours for the 5 Belgian NEN base lithologies.
 * Derived from international convention (BS 1377 / NEN-EN ISO 14688).
 * Hex literals only — no Tailwind classes (SVG fill attribute).
 */
const LITHOLOGY_COLORS: Record<string, string> = {
  GRIND: '#d97706', // amber / orange-brown — gravel
  ZAND: '#fbbf24',  // yellow — sand
  SILT: '#84cc16',  // lime-green — silt
  KLEI: '#6b7280',  // blue-grey — clay
  VEEN: '#92400e',  // dark brown — peat
}

const LITHOLOGY_LABELS: Record<string, string> = {
  GRIND: 'Gravel',
  ZAND: 'Sand',
  SILT: 'Silt',
  KLEI: 'Clay',
  VEEN: 'Peat',
}

function lithoFill(lithology: string): string {
  return LITHOLOGY_COLORS[lithology] ?? '#9ca3af'
}

function lithoLabel(lithology: string): string {
  return LITHOLOGY_LABELS[lithology] ?? lithology
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface LithoSuggestionGhostColumnsProps {
  /**
   * All placed columns in the section — used to find the column for
   * ``investigationId``.  No-op when the investigation is not in the list.
   */
  columns: readonly PlacedColumn[]
  /** Id of the CPT or borehole whose suggestions are shown. */
  investigationId: string
  /** Suggestions ordered top to bottom from the segmenter. */
  suggestions: readonly LithoLayerSuggestion[]
  /** mTAW elevation → screen Y. */
  levelToScreen: (level: number) => number
  /** mTAW surface elevation for the investigation (used to convert depth). */
  surfaceElevationM: number | null
  /** Visible plot Y bounds — layers outside are clipped. */
  plotTop: number
  plotBottom: number
  /** Half-width of each investigation's data band (the band this column flanks). */
  bandHalfWidth: number
  /** Layer indices the user has accepted (contact was created). */
  acceptedIndices: ReadonlySet<number>
  /** Layer indices the user has rejected (explicitly dismissed). */
  rejectedIndices: ReadonlySet<number>
  /** Fire when the user clicks an unaccepted, unrejected layer. */
  onAccept: (idx: number) => void
  /** Fire when the user right-clicks or shift-clicks to reject a layer. */
  onReject: (idx: number) => void
}

/**
 * SVG overlay of lithostratigraphic suggestions for one investigation.
 *
 * Parameters
 * ----------
 * columns
 *     All placed columns — finds the column for ``investigationId``.
 * investigationId
 *     The CPT/borehole whose suggestions are displayed.
 * suggestions
 *     Layer list from the segmenter, ordered top→bottom.
 * levelToScreen
 *     Maps mTAW elevation → SVG Y coordinate.
 * surfaceElevationM
 *     Investigation surface elevation in mTAW (used to convert depth_top_m
 *     to absolute mTAW: ``elevation - depth``).  When null, rendering is
 *     skipped (no elevation → cannot place layers on the level axis).
 * plotTop / plotBottom
 *     SVG Y bounds for clipping.
 * bandHalfWidth
 *     Half-width of the data band; the ghost column is placed to its left.
 * acceptedIndices
 *     Layer indices already accepted (contact created).
 * rejectedIndices
 *     Layer indices explicitly rejected.
 * onAccept
 *     Callback when the user left-clicks a pending layer.
 * onReject
 *     Callback when the user right-clicks or Shift-clicks a pending layer.
 *
 * Returns
 * -------
 * JSX.Element | null
 *     SVG group with the ghost column, or null when no column is found
 *     or no suggestions exist.
 */
export default function LithoSuggestionGhostColumns({
  columns,
  investigationId,
  suggestions,
  levelToScreen,
  surfaceElevationM,
  plotTop,
  plotBottom,
  bandHalfWidth,
  acceptedIndices,
  rejectedIndices,
  onAccept,
  onReject,
}: LithoSuggestionGhostColumnsProps): JSX.Element | null {
  if (suggestions.length === 0 || surfaceElevationM === null) return null

  const col = columns.find(c => c.proj.item.id === investigationId)
  if (!col) return null

  // Place the ghost column to the LEFT of the data band.
  const right = col.nudgedX - bandHalfWidth - LITHO_GHOST_GAP_FROM_BAND_PX
  const left = right - LITHO_GHOST_COLUMN_WIDTH_PX

  return (
    <g data-testid="litho-suggestion-ghosts">
      {/* Column header — "Litho" label above the plot top. */}
      <text
        x={left + LITHO_GHOST_COLUMN_WIDTH_PX / 2}
        y={plotTop - 3}
        textAnchor="middle"
        fontSize={HEADER_FONT_SIZE}
        fill="#6b7280"
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        Litho
      </text>

      {suggestions.map((layer, idx) => (
        <LithoSuggestionLayer
          key={`${idx}-${layer.suggested_lithology}-${layer.depth_top_m}`}
          layer={layer}
          idx={idx}
          left={left}
          width={LITHO_GHOST_COLUMN_WIDTH_PX}
          surfaceElevationM={surfaceElevationM}
          levelToScreen={levelToScreen}
          plotTop={plotTop}
          plotBottom={plotBottom}
          accepted={acceptedIndices.has(idx)}
          rejected={rejectedIndices.has(idx)}
          onAccept={onAccept}
          onReject={onReject}
        />
      ))}
    </g>
  )
}

// ---------------------------------------------------------------------------
// Per-layer rectangle
// ---------------------------------------------------------------------------

function LithoSuggestionLayer({
  layer,
  idx,
  left,
  width,
  surfaceElevationM,
  levelToScreen,
  plotTop,
  plotBottom,
  accepted,
  rejected,
  onAccept,
  onReject,
}: {
  layer: LithoLayerSuggestion
  idx: number
  left: number
  width: number
  surfaceElevationM: number
  levelToScreen: (level: number) => number
  plotTop: number
  plotBottom: number
  accepted: boolean
  rejected: boolean
  onAccept: (idx: number) => void
  onReject: (idx: number) => void
}): JSX.Element | null {
  // Convert depth-below-surface to mTAW using the investigation's elevation.
  const topMTaw = surfaceElevationM - layer.depth_top_m
  const baseMTaw = surfaceElevationM - layer.depth_base_m

  const topY = Math.max(plotTop, Math.min(plotBottom, levelToScreen(topMTaw)))
  const baseY = Math.max(plotTop, Math.min(plotBottom, levelToScreen(baseMTaw)))
  const height = baseY - topY
  if (height <= 0.5) return null

  const fill = lithoFill(layer.suggested_lithology)
  const labelText = lithoLabel(layer.suggested_lithology)
  const opacity = accepted
    ? GHOST_OPACITY_ACCEPTED
    : rejected
      ? GHOST_OPACITY_REJECTED
      : GHOST_OPACITY_DEFAULT

  // Build the tooltip with all segmenter metadata.
  const nadNote = layer.suggested_nad_class != null ? ` · NAD ${layer.suggested_nad_class}` : ''
  const qcNote = layer.mean_qc_mpa != null ? ` · qc ${layer.mean_qc_mpa.toFixed(2)} MPa` : ''
  const drNote = layer.dr_pct != null ? ` · Dr ${layer.dr_pct.toFixed(0)}%` : ''
  const statusNote = accepted ? ' ✓ accepted' : rejected ? ' ✗ rejected' : ' (click to accept)'
  const tooltip =
    `${labelText}${nadNote}: ${layer.depth_top_m.toFixed(2)} → ${layer.depth_base_m.toFixed(2)} m` +
    ` [${layer.confidence}${qcNote}${drNote}]${statusNote}`

  const maxLines = maxLinesForHeight(height, LABEL_FONT_SIZE)
  const lines = maxLines > 0
    ? wrapLabelToLines(labelText, maxCharsForWidth(width, LABEL_FONT_SIZE), maxLines)
    : []

  // Interaction: left-click → accept (unless already decided); right-click
  // or Shift+click → reject.
  function handleClick(e: React.MouseEvent): void {
    e.stopPropagation()
    if (accepted || rejected) return
    if (e.shiftKey) {
      onReject(idx)
    } else {
      onAccept(idx)
    }
  }

  function handleContextMenu(e: React.MouseEvent): void {
    e.preventDefault()
    e.stopPropagation()
    if (accepted) return  // accepted layers cannot be un-accepted here
    onReject(idx)
  }

  // Visual marker: accepted gets a hairline stroke, rejected gets strikethrough diagonal.
  return (
    <g>
      <rect
        x={left}
        y={topY}
        width={width}
        height={height}
        fill={fill}
        fillOpacity={opacity}
        stroke={accepted ? '#065f46' : rejected ? '#9ca3af' : fill}
        strokeOpacity={accepted ? 0.9 : 0.5}
        strokeWidth={accepted ? 1.5 : 0.5}
        style={{ cursor: accepted || rejected ? 'default' : 'pointer' }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      >
        <title>{tooltip}</title>
      </rect>

      {/* Diagonal cross-out on rejected layers. */}
      {rejected && (
        <line
          x1={left}
          y1={topY}
          x2={left + width}
          y2={baseY}
          stroke="#9ca3af"
          strokeWidth={1}
          style={{ pointerEvents: 'none' }}
        />
      )}

      {/* Accepted tick mark in top-right corner. */}
      {accepted && (
        <text
          x={left + width - 3}
          y={topY + 9}
          textAnchor="end"
          fontSize={9}
          fill="#065f46"
          style={{ pointerEvents: 'none', userSelect: 'none' }}
        >
          ✓
        </text>
      )}

      {/* Inline label when the rect is tall enough. */}
      {lines.length > 0 && (
        <MultiLineLabel
          lines={lines}
          centerX={left + width / 2}
          rectTopY={topY}
          rectHeight={height}
          fontSize={LABEL_FONT_SIZE}
          tooltip={tooltip}
          onClick={handleClick}
          onContextMenu={handleContextMenu}
        />
      )}
    </g>
  )
}

// ---------------------------------------------------------------------------
// Multi-line label helper (mirrors VirtueleBoringGhostColumns)
// ---------------------------------------------------------------------------

function MultiLineLabel({
  lines,
  centerX,
  rectTopY,
  rectHeight,
  fontSize,
  tooltip,
  onClick,
  onContextMenu,
}: {
  lines: readonly string[]
  centerX: number
  rectTopY: number
  rectHeight: number
  fontSize: number
  tooltip: string
  onClick: (e: React.MouseEvent) => void
  onContextMenu: (e: React.MouseEvent) => void
}): JSX.Element {
  const lineHeight = fontSize * 1.15
  const blockHeight = lineHeight * lines.length
  const firstBaselineY =
    rectTopY + rectHeight / 2 - blockHeight / 2 + fontSize * 0.8
  return (
    <text
      x={centerX}
      y={firstBaselineY}
      textAnchor="middle"
      fontSize={fontSize}
      fill="#111827"
      style={{ pointerEvents: 'none', userSelect: 'none' }}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      {lines.map((line, i) => (
        <tspan key={i} x={centerX} dy={i === 0 ? 0 : lineHeight}>
          {line}
        </tspan>
      ))}
      <title>{tooltip}</title>
    </text>
  )
}
