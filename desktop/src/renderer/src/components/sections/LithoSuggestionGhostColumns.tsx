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

import { useEffect, useState } from 'react'

import type { GeologicalFormationResponse, LithoLayerSuggestion } from '../../api/client'
import type { PlacedColumn } from './utils'
import { maxCharsForWidth, maxLinesForHeight, wrapLabelToLines } from '../../utils/labelWrap'
import {
  LITHOLOGY_COLORS,
  LITHOLOGY_FALLBACK_COLOR,
  LITHOLOGY_LABELS,
} from '../../utils/lithoConstants'

// ---------------------------------------------------------------------------
// Visual constants
// ---------------------------------------------------------------------------

/** Width of the suggestion ghost column in pixels. */
/**
 * Width retained for backwards-compat with external imports (none in
 * the current tree). The ghost column now uses ``bandHalfWidth * 2``
 * to match the focused investigation's data band; this constant is
 * the historical default that was used before the overlay change.
 */
export const LITHO_GHOST_COLUMN_WIDTH_PX = 48
/** Gap between the data band and the ghost column. */
export const LITHO_GHOST_GAP_FROM_BAND_PX = 6

const GHOST_OPACITY_DEFAULT = 0.55
const GHOST_OPACITY_ACCEPTED = 0.85
const GHOST_OPACITY_REJECTED = 0.2
const LABEL_FONT_SIZE = 9
const HEADER_FONT_SIZE = 8

function lithoFill(lithology: string): string {
  return LITHOLOGY_COLORS[lithology] ?? LITHOLOGY_FALLBACK_COLOR
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
  /**
   * Formations in the active litho model — used to resolve the parent
   * formation name from ``suggestion.parent_formation_id`` for the tooltip.
   * Optional: tooltip shows the raw id when absent.
   */
  formations?: readonly GeologicalFormationResponse[]
  /**
   * Phase-2 drag-resize edits. Map from suggestion index to the
   * user's depth overrides on its top / base edges. When present,
   * the rect renders at the edited depth so the user sees their
   * drag live. Independent edges: dragging only one edge composes
   * with a previously-dragged other edge.
   */
  edits?: ReadonlyMap<number, { depth_top_m?: number; depth_base_m?: number }>
  /**
   * Commit a drag-resize edit. The parent state owner merges it into
   * the edits Map; the next render reflects the new depth. Called
   * exactly once per mouseup (the live drag preview stays local to
   * this component until commit).
   */
  onEdit?: (idx: number, edit: { depth_top_m?: number; depth_base_m?: number }) => void
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
 * formations
 *     Active model's formation list for parent-formation name lookup.
 *     Optional — tooltip shows the raw id when absent.
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
  formations = [],
  edits,
  onEdit,
}: LithoSuggestionGhostColumnsProps): JSX.Element | null {
  // Live drag preview state. Set on mousedown on an edge handle;
  // updated on document mousemove; cleared on mouseup which fires
  // ``onEdit`` once with the final depth. Pre-commit edit lives only
  // in this local state — committed edits are echoed back via the
  // ``edits`` prop on the next render.
  //
  // Hooks live ABOVE all early returns (suggestions.length === 0 /
  // !surfaceElevationM / !col) so the hook count is invariant —
  // CLAUDE.md "Temporal Dead Zone after reordering React component
  // bodies" / Rules of Hooks. The drag state is cheap (one ref +
  // one effect) so paying it on every render is free.
  const [drag, setDrag] = useState<{
    idx: number
    edge: 'top' | 'base'
    initialClientY: number
    initialDepthM: number
    currentDepthM: number
  } | null>(null)

  // pxPerM derived from levelToScreen (a linear transform — sample
  // two points). Guards against zero when the section is too narrow
  // to render the band. Lifted before the early returns so the ref
  // stays stable; the inner JSX guards on surfaceElevationM anyway.
  const surfaceY = surfaceElevationM != null ? levelToScreen(surfaceElevationM) : 0
  const pxPerM =
    surfaceElevationM != null
      ? levelToScreen(surfaceElevationM - 1) - surfaceY
      : 0

  // Document-level mousemove + mouseup while a drag is active. The
  // hit-zones are SVG rects but the mouse can leave them during a
  // drag; attaching to document keeps the gesture coherent. Final
  // depth fires through ``onEdit`` exactly once on mouseup.
  useEffect(() => {
    if (!drag) return
    function handleMove(e: MouseEvent): void {
      if (!drag) return
      const pixelDelta = e.clientY - drag.initialClientY
      const depthDelta = pxPerM !== 0 ? pixelDelta / pxPerM : 0
      // Clamp to non-negative depth — a layer top can't sit above
      // the ground surface (depth 0). Base can't either; for both
      // edges the same min applies.
      const next = Math.max(0, drag.initialDepthM + depthDelta)
      setDrag(d => (d !== null ? { ...d, currentDepthM: next } : null))
    }
    function handleUp(): void {
      if (!drag) return
      const edit =
        drag.edge === 'top'
          ? { depth_top_m: drag.currentDepthM }
          : { depth_base_m: drag.currentDepthM }
      if (onEdit) onEdit(drag.idx, edit)
      setDrag(null)
    }
    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
    return () => {
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
    }
  }, [drag, pxPerM, onEdit])

  if (suggestions.length === 0 || surfaceElevationM === null) return null

  const col = columns.find(c => c.proj.item.id === investigationId)
  if (!col) return null

  // Build a name-by-id map so each layer can resolve its parent formation name.
  const formationNameById = new Map(formations.map(f => [f.id, f.name]))

  // Always OVERLAY the ghost column on top of the focused
  // investigation's data band (owner directive 2026-05-20). Previously
  // the ghost was placed to the LEFT of the band with a fixed gap; at
  // dense column spacing it overlapped the neighbouring test. Overlay
  // never collides with neighbours and visually anchors the preview to
  // the test it was generated from. The qc / Ic trace shows through
  // at the ghost's 0.55 default opacity. Width matches the data band
  // (``bandHalfWidth * 2``) so the ghost spans the same area the CPT
  // plot occupies — same horizontal real estate, no neighbour overlap.
  const left = col.nudgedX - bandHalfWidth
  const ghostWidth = bandHalfWidth * 2

  return (
    <g data-testid="litho-suggestion-ghosts">
      {/* Column header — "Litho" label above the plot top. */}
      <text
        x={left + ghostWidth / 2}
        y={plotTop - 3}
        textAnchor="middle"
        fontSize={HEADER_FONT_SIZE}
        fill="#6b7280"
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        Litho
      </text>

      {suggestions.map((rawLayer, idx) => {
        // Resolve effective depths: committed edits → live drag override.
        const committed = edits?.get(idx)
        let topM = committed?.depth_top_m ?? rawLayer.depth_top_m
        let baseM = committed?.depth_base_m ?? rawLayer.depth_base_m
        if (drag?.idx === idx) {
          if (drag.edge === 'top') topM = drag.currentDepthM
          else baseM = drag.currentDepthM
        }
        const effective: LithoLayerSuggestion = {
          ...rawLayer,
          depth_top_m: topM,
          depth_base_m: baseM,
        }
        // Compute hit-zone Y positions from effective depths so the
        // handles track the drag preview live.
        const topY = Math.max(
          plotTop,
          Math.min(plotBottom, levelToScreen(surfaceElevationM - topM)),
        )
        const baseY = Math.max(
          plotTop,
          Math.min(plotBottom, levelToScreen(surfaceElevationM - baseM)),
        )
        const accepted = acceptedIndices.has(idx)
        const rejected = rejectedIndices.has(idx)
        // Drag handles only when onEdit is wired AND the layer is
        // still pending. Accepted/rejected layers are frozen.
        const dragHandlesEnabled = onEdit !== undefined && !accepted && !rejected
        return (
          <g key={`${idx}-${rawLayer.suggested_lithology}-${rawLayer.depth_top_m}`}>
            <LithoSuggestionLayer
              layer={effective}
              idx={idx}
              left={left}
              width={ghostWidth}
              surfaceElevationM={surfaceElevationM}
              levelToScreen={levelToScreen}
              plotTop={plotTop}
              plotBottom={plotBottom}
              accepted={accepted}
              rejected={rejected}
              onAccept={onAccept}
              onReject={onReject}
              formationNameById={formationNameById}
            />
            {dragHandlesEnabled && (
              <>
                {/* Top-edge handle — drag moves only this layer's TOP.
                    6 px tall hit zone centred on the top edge. */}
                <rect
                  x={left}
                  y={topY - 3}
                  width={ghostWidth}
                  height={6}
                  fill="transparent"
                  style={{ cursor: 'ns-resize' }}
                  data-testid={`litho-drag-top-${idx}`}
                  onMouseDown={e => {
                    e.stopPropagation()
                    e.preventDefault()
                    setDrag({
                      idx,
                      edge: 'top',
                      initialClientY: e.clientY,
                      initialDepthM: topM,
                      currentDepthM: topM,
                    })
                  }}
                />
                {/* Base-edge handle — drag moves only this layer's BASE. */}
                <rect
                  x={left}
                  y={baseY - 3}
                  width={ghostWidth}
                  height={6}
                  fill="transparent"
                  style={{ cursor: 'ns-resize' }}
                  data-testid={`litho-drag-base-${idx}`}
                  onMouseDown={e => {
                    e.stopPropagation()
                    e.preventDefault()
                    setDrag({
                      idx,
                      edge: 'base',
                      initialClientY: e.clientY,
                      initialDepthM: baseM,
                      currentDepthM: baseM,
                    })
                  }}
                />
              </>
            )}
          </g>
        )
      })}
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
  formationNameById,
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
  formationNameById: ReadonlyMap<string, string>
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

  // Resolve the parent formation name from the id (passed from the outer
  // component's formations lookup).  Falls back to the raw id when the
  // formation is not in the active model (edge case: stale suggestion while
  // the model is being edited).
  const parentName =
    layer.parent_formation_id != null
      ? (formationNameById.get(layer.parent_formation_id) ?? layer.parent_formation_id)
      : null

  // spans_boundary: this suggestion interval crosses a geological formation
  // boundary.  The backend auto-splits it into two contacts at acceptance,
  // but the ghost still covers the full original interval — amber border
  // signals "straddles two formations, will be split on accept".
  const straddleNote = layer.spans_boundary
    ? ' ⚠ straddles formation boundary — will be split on accept'
    : ''
  const parentNote = parentName != null ? ` | parent: ${parentName}` : ''

  // Build the tooltip with all segmenter metadata.
  const nadNote = layer.suggested_nad_class != null ? ` · NAD ${layer.suggested_nad_class}` : ''
  const qcNote = layer.mean_qc_mpa != null ? ` · qc ${layer.mean_qc_mpa.toFixed(2)} MPa` : ''
  const drNote = layer.dr_pct != null ? ` · Dr ${layer.dr_pct.toFixed(0)}%` : ''
  const statusNote = accepted ? ' ✓ accepted' : rejected ? ' ✗ rejected' : ' (click to accept)'
  const tooltip =
    `${labelText}${nadNote}: ${layer.depth_top_m.toFixed(2)} → ${layer.depth_base_m.toFixed(2)} m` +
    ` [${layer.confidence}${qcNote}${drNote}]${parentNote}${straddleNote}${statusNote}`

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
    // Accepted layers can't be un-accepted here; already-rejected
    // layers shouldn't re-fire onReject (senior-review C-2 — avoids a
    // spurious no-op state update + log line).
    if (accepted || rejected) return
    onReject(idx)
  }

  // Visual markers:
  //   accepted     → dark-green hairline stroke
  //   spans_boundary (pending) → amber stroke (1.5px dashed) to warn "will be split"
  //   rejected     → grey stroke
  //   default      → matching fill stroke (subtle boundary)
  const strokeColor = accepted
    ? '#065f46'
    : layer.spans_boundary && !rejected
      ? '#d97706'  // amber-600 — straddle warning
      : rejected
        ? '#9ca3af'
        : fill
  const strokeWidth = accepted || (layer.spans_boundary && !rejected) ? 1.5 : 0.5
  const strokeDasharray = layer.spans_boundary && !accepted && !rejected ? '4 2' : undefined

  return (
    <g>
      <rect
        x={left}
        y={topY}
        width={width}
        height={height}
        fill={fill}
        fillOpacity={opacity}
        stroke={strokeColor}
        strokeOpacity={accepted ? 0.9 : 0.7}
        strokeWidth={strokeWidth}
        strokeDasharray={strokeDasharray}
        // Accepted / rejected layers let clicks pass through to the
        // ContactPickBar underneath so the user can place a NEW
        // contact at a different depth without first dismissing the
        // accepted ghost (dogfeed bug 2026-05-20). Pending layers
        // keep cursor=pointer + click handler so accept/reject still
        // works.
        style={
          accepted || rejected
            ? { cursor: 'default', pointerEvents: 'none' }
            : { cursor: 'pointer' }
        }
        onClick={accepted || rejected ? undefined : handleClick}
        onContextMenu={accepted || rejected ? undefined : handleContextMenu}
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
