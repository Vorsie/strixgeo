/**
 * Per-layer ghost rectangle for ``LithoSuggestionGhostColumns``.
 *
 * Extracted verbatim from LithoSuggestionGhostColumns.tsx (debt #201
 * round 2) — renders ONE suggested litho layer: fill rect, wrapped label,
 * accept/reject affordances, copy handle, and the hover/context hit strip.
 * Pure render component (no hooks).
 */
import type { LithoLayerSuggestion } from '../../api/client'
import { lithoDisplayName } from '../../utils/lithoLabels'
import { formatNadClass } from '../../utils/formatNadClass'
import MultiLineLabel from './MultiLineLabel'
import { maxCharsForWidth, maxLinesForHeight, wrapLabelToLines } from '../../utils/labelWrap'
import {
  LITHOLOGY_COLORS,
  LITHOLOGY_FALLBACK_COLOR,
} from '../../utils/lithoConstants'
import { useT } from '../../i18n/translate'

/** Ghost band opacity — pending (default) / accepted / rejected. */
const GHOST_OPACITY_DEFAULT = 0.55
const GHOST_OPACITY_ACCEPTED = 0.85
const GHOST_OPACITY_REJECTED = 0.2
/** Label font size in px. */
const LABEL_FONT_SIZE = 9

/** Fill colour for a suggested lithology (shared lithology palette). */
function lithoFill(lithology: string): string {
  return LITHOLOGY_COLORS[lithology] ?? LITHOLOGY_FALLBACK_COLOR
}

// ---------------------------------------------------------------------------
// Per-layer rectangle
// ---------------------------------------------------------------------------

export function LithoSuggestionLayer({
  layer,
  idx,
  anchorId,
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
  onRequestContextMenu,
  onCopyMouseDown,
  isCopyHoverTarget,
  formationNameById,
  hatchPatternId,
}: {
  layer: LithoLayerSuggestion
  idx: number
  /** Investigation id (CPT or borehole) this column belongs to.
   *  Stamped on the rect as ``data-litho-anchor-id`` so cross-column
   *  Alt-drag hit-tests via document.elementsFromPoint can resolve
   *  which anchor the target rect belongs to (debt #86). */
  anchorId: string
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
  /**
   * Fired on right-click of a pending layer. Replaces the direct
   * right-click-rejects gesture from earlier iterations — the parent
   * now opens a context menu at (clientX, clientY) with multiple
   * options (Edit composition / Reject). Dogfeed 2026-05-20: users
   * expect right-click to open a menu, not destroy.
   */
  onRequestContextMenu?: (idx: number, clientX: number, clientY: number) => void
  /**
   * Debt #86: fired on mousedown when the Alt key is held — arms the
   * copy-composition drag gesture in the parent component.  The
   * default click/accept path is suppressed for this gesture via the
   * parent's ``copyDragJustEndedRef``.
   */
  onCopyMouseDown?: (idx: number, clientX: number, clientY: number) => void
  /** True when a copy-drag is hovering this rect — renders an amber
   *  outline so the user sees a valid drop target. */
  isCopyHoverTarget?: boolean
  formationNameById: ReadonlyMap<string, string>
  /** SVG ``<pattern>`` id defined in the parent <defs>.  Overlaid as a
   *  hatching fill on pending layers (debt #142) so the user reads
   *  "still suggestion, awaiting your accept/reject" at a glance. */
  hatchPatternId: string
}): JSX.Element | null {
  const t = useT()
  // Convert depth-below-surface to mTAW using the investigation's elevation.
  const topMTaw = surfaceElevationM - layer.depth_top_m
  const baseMTaw = surfaceElevationM - layer.depth_base_m

  const topY = Math.max(plotTop, Math.min(plotBottom, levelToScreen(topMTaw)))
  const baseY = Math.max(plotTop, Math.min(plotBottom, levelToScreen(baseMTaw)))
  const height = baseY - topY
  if (height <= 0.5) return null
  // Dogfeed 2026-05-31: rejected layers render nothing — no band, no
  // hatching, no cross-out, no ↻ undo button.  The state stays in
  // memory (drag clamps + bound walkers still consult it) but the
  // visual clutter is gone. Users restore a layer via right-click →
  // Insert layer if needed.
  if (rejected) return null

  // Sentinel ghost: a near-zero-thickness layer (< 6 px) that has not yet
  // been extended to a real range via "Extend to nearest contacts".  Render
  // it as a dashed outline marker only — no fill — so it is visually distinct
  // from a real layer band.  The user "Extends" the ghost first, at which
  // point height grows and the normal fill path takes over.
  // Threshold is pixel-based (not metre-based) so it adapts to zoom level
  // rather than hardcoding a depth interpretation.
  const isSentinel = height < 6

  const fill = lithoFill(layer.suggested_lithology)
  // Rich Dutch label includes the admixture qualifier (e.g.
  // "Zwak siltig zand" instead of plain "Zand"). Mirrors the
  // composition picker's live preview so the user sees the same
  // text in the dialog and the ghost rect (dogfeed bug 2026-05-20:
  // editing the composition produced no visible change because the
  // label was just the base lithology). Falls back to base name
  // when there are no admixtures.
  const labelText = lithoDisplayName(
    layer.suggested_lithology,
    layer.suggested_admixtures ?? [],
  )
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
    ? ' ⚠ straddles formation boundary. Will be split on accept'
    : ''
  const parentNote = parentName != null ? ` | parent: ${parentName}` : ''

  // Build the tooltip with all segmenter metadata.
  // nad_class_range is present on merged layers (debt #119); fall back to
  // the scalar suggested_nad_class for un-merged / borehole-path layers.
  const nadLabel = formatNadClass(layer.nad_class_range, layer.suggested_nad_class)
  const nadNote = nadLabel != null ? ` · ${nadLabel}` : ''
  const qcNote = layer.mean_qc_mpa != null ? ` · qc ${layer.mean_qc_mpa.toFixed(2)} MPa` : ''
  const drNote = layer.dr_pct != null ? ` · Dr ${layer.dr_pct.toFixed(0)}%` : ''
  const statusNote = accepted ? ' ✓ accepted' : rejected ? ' ✗ rejected' : ' (click to accept)'
  const tooltip =
    `${labelText}${nadNote}: ${layer.depth_top_m.toFixed(2)} → ${layer.depth_base_m.toFixed(2)} m` +
    ` [${layer.confidence}${qcNote}${drNote}]${parentNote}${straddleNote}${statusNote}`

  // Sentinel ghosts have no room for a label; suppress to avoid clipping.
  const maxLines = isSentinel ? 0 : maxLinesForHeight(height, LABEL_FONT_SIZE)
  const lines = maxLines > 0
    ? wrapLabelToLines(labelText, maxCharsForWidth(width, LABEL_FONT_SIZE), maxLines)
    : []

  // Interaction (owner directive 2026-05-22 — accept moved off the
  // single click so a misclick while aiming at a drag handle or a
  // boundary strip can no longer commit a contact):
  //   dbl-click    → accept the suggestion (commit a contact)
  //   shift-click  → reject
  //   right-click  → context menu (Accept / Edit composition / Reject)
  //   single-click → inert
  //   accepted / rejected layers ignore all of the above (already-decided)
  function handleClick(e: React.MouseEvent): void {
    e.stopPropagation()
    if (accepted || rejected) return
    // Shift+click stays a quick reject — a deliberate modifier gesture,
    // not a misclick risk. A plain single click is intentionally inert.
    if (e.shiftKey) onReject(idx)
  }

  function handleDoubleClick(e: React.MouseEvent): void {
    e.stopPropagation()
    if (accepted || rejected) return
    onAccept(idx)
  }

  function handleContextMenu(e: React.MouseEvent): void {
    e.preventDefault()
    e.stopPropagation()
    // Accepted / rejected layers are frozen — no context menu for
    // them. (Pending layers open the layer context menu via the
    // onRequestContextMenu callback below; the menu offers Edit
    // composition + Reject, which previously was the only right-click
    // action — the menu is more discoverable per dogfeed 2026-05-20.)
    if (accepted || rejected) return
    if (onRequestContextMenu) {
      onRequestContextMenu(idx, e.clientX, e.clientY)
    }
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

  // Debt #86: drop-target highlight — amber outline over the existing
  // stroke when a copy-drag is hovering this layer.
  const effectiveStroke = isCopyHoverTarget ? '#f59e0b' : strokeColor
  const effectiveStrokeWidth = isCopyHoverTarget ? 2 : strokeWidth

  return (
    <g>
      <rect
        x={left}
        y={topY}
        width={width}
        // Sentinel ghosts render at a minimum visible height (4 px) so the
        // dashed outline marker is always grab-able. Real ghosts use the
        // computed height unchanged.
        height={isSentinel ? Math.max(height, 4) : height}
        // Sentinel: transparent interior (dashed outline marker, not a layer).
        fill={isSentinel ? 'transparent' : fill}
        fillOpacity={isSentinel ? 0 : opacity}
        stroke={isSentinel ? fill : effectiveStroke}
        strokeOpacity={isSentinel ? 0.8 : accepted ? 0.9 : 0.7}
        strokeWidth={isSentinel ? 1.5 : effectiveStrokeWidth}
        strokeDasharray={isSentinel ? '4 2' : strokeDasharray}
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
        // Debt #86: pending-layer rects stamp anchor+idx so cross-column
        // Alt-drag hit-tests via document.elementsFromPoint can resolve
        // the drop target. Stamped even when onCopyMouseDown is not
        // wired so a hosting component instance still receives a drop
        // FROM a sibling instance.
        data-litho-anchor-id={accepted || rejected ? undefined : anchorId}
        data-litho-idx={accepted || rejected ? undefined : idx}
        onMouseDown={
          onCopyMouseDown !== undefined && !accepted && !rejected
            ? e => {
                if (!e.altKey) return
                e.preventDefault()
                e.stopPropagation()
                onCopyMouseDown(idx, e.clientX, e.clientY)
              }
            : undefined
        }
        onClick={accepted || rejected ? undefined : handleClick}
        onDoubleClick={accepted || rejected ? undefined : handleDoubleClick}
        onContextMenu={accepted || rejected ? undefined : handleContextMenu}
      >
        <title>{tooltip}</title>
      </rect>

      {/* Debt #142 — diagonal-hatch overlay on PENDING layers.  Marks
          "still suggestion" so the user can distinguish a pending
          ghost (action required) from the solid colour of a
          committed contact band underneath.  Sentinel, accepted, and
          rejected layers skip the overlay (accepted is unreachable
          here — parent early-returns; kept in the gate for safety).
          ``pointerEvents: none`` so the overlay never intercepts the
          underlying rect's drag/click handlers. */}
      {!accepted && !rejected && !isSentinel && (
        <rect
          data-testid={`litho-pending-hatch-${idx}`}
          x={left}
          y={topY}
          width={width}
          height={height}
          fill={`url(#${hatchPatternId})`}
          style={{ pointerEvents: 'none' }}
        />
      )}

      {/* Reject (×) icon on PENDING layers — debt #103 click-delete.
          Small circular handle in the top-right corner with
          pointer-events:auto so a single click rejects the layer.
          Owner directive 2026-05-22 keeps left-click on the layer
          BODY inert (misclick safety) — this icon is the explicit,
          discoverable reject affordance. */}
      {!accepted && !rejected && height >= 14 && width >= 14 && (
        <g
          data-testid={`litho-reject-${idx}`}
          style={{ cursor: 'pointer', pointerEvents: 'auto' }}
          onClick={e => {
            e.stopPropagation()
            onReject(idx)
          }}
        >
          <circle
            cx={left + width - 8}
            cy={topY + 8}
            r={6}
            fill="#ffffff"
            fillOpacity={0.85}
            stroke="#6b7280"
            strokeWidth={0.75}
          />
          <text
            x={left + width - 8}
            y={topY + 11}
            textAnchor="middle"
            fontSize={9}
            fill="#374151"
            style={{ userSelect: 'none' }}
          >
            ×
          </text>
          <title>{t('sections.menu.rejectLayer')}</title>
        </g>
      )}

      {/* Inline label when the rect is tall enough. Suppressed once the
          layer is accepted: the committed contact band underneath now
          carries the real label, and two overlapping labels read as a
          faint "ghost label behind" the real one (dogfeed 2026-05-22). */}
      {lines.length > 0 && !accepted && (
        <MultiLineLabel
          lines={lines}
          centerX={left + width / 2}
          rectTopY={topY}
          rectHeight={height}
          fontSize={LABEL_FONT_SIZE}
          tooltip={tooltip}
        />
      )}
    </g>
  )
}
