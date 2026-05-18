/**
 * Ghost-wedge overlay for the pinch-out ghost-preview UX.
 *
 * Shown AFTER the engineer right-clicks a formation contact and picks
 * "Extrapolate pinch-out…" — the backend's dry_run path computes the
 * tip geometry and this component renders a dashed, semi-transparent
 * wedge triangle from the formation's termination edge to the predicted
 * tip point.
 *
 * Visual identity mirrors LithoSuggestionGhostColumns (dashed stroke,
 * reduced opacity, <title> tooltip) so both ghost surfaces feel
 * consistent.  The wedge is rendered as an SVG polygon, not a rect,
 * because a pinch-out is a triangle that converges to a point.
 *
 * Confirm/Dismiss controls float as an absolutely-positioned panel
 * inside the SVG's parent container.  This avoids foreign-object
 * rendering quirks and keeps the control layer in the DOM above the
 * SVG so pointer events work reliably.
 *
 * WHY this component exists separately from ContactsLayer: the ghost
 * is tied to an ephemeral interactive state (preview → confirm/dismiss)
 * whereas ContactsLayer renders committed contacts. Separating concerns
 * makes both simpler and avoids threading preview state into a 1 900+
 * line component.
 */

import { useEffect, useMemo, useRef } from 'react'

import type { FormationContactResponse, GeologicalFormationResponse } from '../../api/client'
import type { PlacedColumn } from './utils'

// ---------------------------------------------------------------------------
// Visual constants (mirrors LithoSuggestionGhostColumns opacity/dash pattern)
// ---------------------------------------------------------------------------
const GHOST_FILL_OPACITY = 0.18
const GHOST_STROKE_OPACITY = 0.65
const GHOST_STROKE_DASH = '6 3'
const GHOST_STROKE_WIDTH = 1.5
const TIP_DOT_RADIUS = 5

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface PinchOutGhostOverlayProps {
  /**
   * Dry-run result: the tip geometry plus the parameters needed for the
   * commit call.  When null the overlay renders nothing.
   */
  preview: {
    tip_along_m: number
    tip_elevation_m: number
    formation_id: string
    target_formation_id: string
    direction: 'left' | 'right'
    section_id: string
    model_id: string
  } | null
  /** True while a dry_run or commit call is in flight (spinner on Confirm). */
  loading: boolean
  /** All committed contacts for the active model — used to find the
   * pinching formation's termination edge contact on this section. */
  contacts: readonly FormationContactResponse[]
  /** Formations — used to look up the pinching formation's colour/name. */
  formations: readonly GeologicalFormationResponse[]
  /** Placed columns for the current section view. */
  placedColumns: readonly PlacedColumn[]
  /** Maps along-section distance (m) to SVG X. */
  alongMToScreenX: (along: number) => number
  /** Maps absolute mTAW elevation to SVG Y. */
  levelToScreen: (level: number) => number
  /** Plot area Y bounds — used to clip the wedge tip label. */
  plotTop: number
  plotBottom: number
  /** Fire when the engineer clicks Confirm (commits the pinch-out). */
  onConfirm: () => void
  /** Fire when the engineer clicks Dismiss (no-op). */
  onDismiss: () => void
}

/**
 * SVG ghost-wedge overlay for a pending pinch-out extrapolation.
 *
 * Renders a semi-transparent, dashed triangle from the pinching
 * formation's last real contact (the termination edge) to the
 * computed tip.  Confirm / Dismiss controls are rendered as an
 * absolutely-positioned floating panel (caller must place this
 * component inside a ``position: relative`` container).
 *
 * Parameters
 * ----------
 * preview
 *     Dry-run result from ``handlePreviewPinchOut``.  Null = nothing rendered.
 * loading
 *     True while a dry_run or commit call is in flight.
 * contacts
 *     All committed contacts for the active geological model.
 * formations
 *     Formation vocabulary.
 * placedColumns
 *     Section-projected investigation columns.
 * alongMToScreenX
 *     Maps along-section distance (m) → SVG X coordinate.
 * levelToScreen
 *     Maps absolute mTAW elevation → SVG Y coordinate.
 * plotTop / plotBottom
 *     SVG Y bounds for clipping.
 * onConfirm
 *     Callback that fires the commit endpoint.
 * onDismiss
 *     Callback that clears the preview without any DB write.
 *
 * Returns
 * -------
 * JSX.Element | null
 *     SVG group with the wedge + floating Confirm/Dismiss panel, or null.
 */
export default function PinchOutGhostOverlay({
  preview,
  loading,
  contacts,
  formations,
  placedColumns,
  alongMToScreenX,
  levelToScreen,
  plotTop,
  plotBottom,
  onConfirm,
  onDismiss,
}: PinchOutGhostOverlayProps): JSX.Element | null {
  // Map formation id → formation for quick lookup.
  const formationById = useMemo(
    () => new Map(formations.map(f => [f.id, f])),
    [formations],
  )

  // Find the placed column that carries the termination-edge contact.
  // The termination edge is:
  //   direction="right" → the rightmost column that has a contact for
  //                        this formation (farthest along the section).
  //   direction="left"  → the leftmost column.
  //
  // A "column" here is a PlacedColumn whose anchored investigation has
  // at least one contact for the pinching formation.  We find the
  // along-section distance from placedColumns + contacts.
  const edgeGeometry = useMemo(() => {
    if (!preview) return null
    const { formation_id, direction } = preview

    // Collect all contacts for this formation → map anchor id → contact.
    const byAnchorId = new Map<string, FormationContactResponse>()
    for (const c of contacts) {
      if (c.formation_id === formation_id) {
        byAnchorId.set(c.borehole_id ?? c.cpt_id ?? '', c)
      }
    }
    if (byAnchorId.size === 0) return null

    // Walk placed columns to find the edge column.
    let edgeCol: PlacedColumn | null = null
    let edgeContact: FormationContactResponse | null = null
    for (const col of placedColumns) {
      const anchorId = col.proj.item.id
      const contact = byAnchorId.get(anchorId)
      if (!contact) continue
      if (edgeCol === null) {
        edgeCol = col
        edgeContact = contact
        continue
      }
      const isFurther =
        direction === 'right'
          ? col.proj.along > edgeCol.proj.along
          : col.proj.along < edgeCol.proj.along
      if (isFurther) {
        edgeCol = col
        edgeContact = contact
      }
    }
    if (!edgeCol || !edgeContact) return null

    // Surface elevation of the edge anchor (CPT max_depth_m or borehole total_depth_m
    // is on the investigation; we use the column's PlacedColumn.proj.surfaceElevationM).
    const surfaceElevM =
      'surface_elevation_m' in edgeCol.proj.item
        ? (edgeCol.proj.item as { surface_elevation_m: number | null }).surface_elevation_m
        : null

    if (surfaceElevM === null) return null

    const edgeAlongM = edgeCol.proj.along
    const edgeElevM = surfaceElevM - edgeContact.depth_top_m

    return { edgeAlongM, edgeElevM, edgeCol }
  }, [preview, contacts, placedColumns])

  if (!preview) return null

  const formation = formationById.get(preview.formation_id)
  const color = formation?.color ?? '#94a3b8'
  const name = formation?.name ?? 'Formation'

  const tipX = alongMToScreenX(preview.tip_along_m)
  const tipY = levelToScreen(preview.tip_elevation_m)

  // The wedge is a triangle:
  //   vertex A = edge contact screen position (top of the last real contact)
  //   vertex B = tip (where formation thickness → 0)
  //   vertex C = tip at the same Y as vertex A (to close the triangle
  //              along a horizontal cap so it reads as a wedge, not a spike)
  //
  // WHY the cap: a pure spike is too thin to be readable when the dip is
  // shallow. The cap makes the wedge shape unambiguous regardless of angle.
  //
  // Senior-review S1: when the pinching formation has no investigation-
  // backed contact on this section (edgeGeometry === null) we can't draw
  // the wedge — but we MUST still render the tip marker + label (and the
  // caller still shows the confirm panel) so the engineer is never left
  // with a silently blank overlay above a floating Confirm panel.
  const polygon = edgeGeometry
    ? `${alongMToScreenX(edgeGeometry.edgeAlongM)},${levelToScreen(edgeGeometry.edgeElevM)} ` +
      `${tipX},${levelToScreen(edgeGeometry.edgeElevM)} ${tipX},${tipY}`
    : null

  // Clamp the tip label Y to the visible plot area.
  const labelY = Math.max(plotTop + 14, Math.min(plotBottom - 4, tipY - 8))

  const tooltip =
    `${name} pinches out toward ${preview.direction} at ` +
    `along=${preview.tip_along_m.toFixed(1)} m, ` +
    `elevation=${preview.tip_elevation_m.toFixed(2)} mTAW. ` +
    `Confirm to commit; Dismiss to cancel. ` +
    `Deletion of synthetic contacts is the recovery path (no undo in v1).`

  return (
    <g data-testid="pinch-out-ghost-overlay">
      {/* Dashed wedge — mirrors LithoSuggestionGhostColumns opacity/dash.
          Omitted when there's no investigation-backed edge contact on this
          section (S1); the tip marker below still renders. */}
      {polygon !== null && (
        <polygon
          points={polygon}
          fill={color}
          fillOpacity={GHOST_FILL_OPACITY}
          stroke={color}
          strokeOpacity={GHOST_STROKE_OPACITY}
          strokeWidth={GHOST_STROKE_WIDTH}
          strokeDasharray={GHOST_STROKE_DASH}
          strokeLinejoin="round"
          pointerEvents="none"
        >
          <title>{tooltip}</title>
        </polygon>
      )}

      {/* Tip dot — visual anchor for the pinch-out point. */}
      <circle
        cx={tipX}
        cy={tipY}
        r={TIP_DOT_RADIUS}
        fill={color}
        fillOpacity={0.7}
        stroke="white"
        strokeWidth={1.5}
        pointerEvents="none"
      >
        <title>{tooltip}</title>
      </circle>

      {/* Tip label — along + elevation. */}
      <text
        x={tipX + TIP_DOT_RADIUS + 4}
        y={labelY}
        fontSize={9}
        fill={color}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        {`${preview.tip_along_m.toFixed(1)} m · ${preview.tip_elevation_m.toFixed(2)} mTAW`}
      </text>
    </g>
  )
}

// ---------------------------------------------------------------------------
// Floating Confirm / Dismiss panel (rendered by the caller OUTSIDE the SVG
// so pointer events work cleanly without foreignObject quirks).
// ---------------------------------------------------------------------------

export interface PinchOutConfirmPanelProps {
  /** Non-null when a preview is active. */
  preview: PinchOutGhostOverlayProps['preview']
  /** True while a call is in flight — shows a spinner on Confirm. */
  loading: boolean
  /** Formation name for the label (looked up by the caller). */
  formationName: string
  onConfirm: () => void
  onDismiss: () => void
}

/**
 * Floating Confirm / Dismiss panel for the active pinch-out preview.
 *
 * Rendered as an absolutely-positioned ``<div>`` in the top-right corner
 * of the section panel container.  When ``preview`` is null the panel is
 * not rendered.
 *
 * Note on recovery: deletion of the synthetic contacts is the v1 undo
 * path.  This is stated in the tooltip per the design decision.
 *
 * Parameters
 * ----------
 * preview
 *     Active preview state — null hides the panel.
 * loading
 *     True while a commit or dry_run call is in flight.
 * formationName
 *     Human-readable formation name for the panel header.
 * onConfirm
 *     Commit the pinch-out.
 * onDismiss
 *     Clear the preview without committing.
 *
 * Returns
 * -------
 * JSX.Element | null
 *     The panel, or null when no preview is active.
 */
export function PinchOutConfirmPanel({
  preview,
  loading,
  formationName,
  onConfirm,
  onDismiss,
}: PinchOutConfirmPanelProps): JSX.Element | null {
  // Esc dismisses the ghost (review B3 / UX-B2). Capture-phase + stop
  // propagation so it fires BEFORE the section editor's own Esc peel
  // (drag/marquee/selection) — the ghost is the most immediate thing on
  // screen, so Esc should cancel it first and NOT also clear the
  // selection underneath. reason: this listener is intentionally
  // document-level + capture so it pre-empts SectionPanel/AppShell Esc
  // handlers; a React onKeyDown on the panel would miss because focus is
  // usually still on the section canvas, not inside the panel.
  const onDismissRef = useRef(onDismiss)
  onDismissRef.current = onDismiss
  const dismissBtnRef = useRef<HTMLButtonElement | null>(null)
  const active = preview !== null
  useEffect(() => {
    if (!active) return
    // Default-focus the SAFE action (Dismiss) — the preview is the
    // reversible confirm gate for an irreversible commit (docs/ux.md
    // destructive-action contract: default focus the non-destructive
    // choice).
    dismissBtnRef.current?.focus()
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onDismissRef.current()
      }
    }
    document.addEventListener('keydown', handler, { capture: true })
    return () =>
      document.removeEventListener('keydown', handler, { capture: true })
  }, [active])

  if (!preview) return null

  return (
    // role="region" (NOT "dialog"): this is a non-modal floating panel —
    // it neither traps focus nor blocks the canvas. A "dialog" role
    // would (a) make AppShell's Esc-peel guard skip the section, and
    // (b) mis-announce an unclosed modal to screen readers (review B3).
    <div
      className="absolute bottom-2 right-2 z-30 rounded border border-gray-300 bg-white text-xs shadow-md min-w-[220px] dark:border-gray-600 dark:bg-gray-800"
      data-testid="pinch-out-confirm-panel"
      role="region"
      aria-label="Confirm pinch-out"
    >
      <div className="border-b border-gray-100 px-3 py-2 font-medium text-gray-700 dark:border-gray-700 dark:text-gray-100">
        Pinch-out: {formationName}
      </div>
      <div className="px-3 py-2 leading-snug text-gray-500 dark:text-gray-400">
        <div>
          Tip: {preview.tip_along_m.toFixed(1)} m along ·{' '}
          {preview.tip_elevation_m.toFixed(2)} mTAW
        </div>
        {/* Recovery disclosure at readable size/contrast (review UX-S4):
            this is a workflow fact, not a micro-hint — the engineer must
            know the undo button does nothing here. */}
        <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
          Direction: {preview.direction}. No undo — delete the two
          synthetic contacts to revert.
        </div>
      </div>
      <div className="flex gap-2 border-t border-gray-100 px-3 py-2 dark:border-gray-700">
        <button
          type="button"
          className="flex-1 rounded bg-blue-600 px-2 py-1 text-white hover:bg-blue-700 disabled:opacity-50"
          onClick={onConfirm}
          disabled={loading}
          title="Commit two synthetic contacts at the pinch-out tip and mark the 3D surface stale."
        >
          {loading ? '…' : 'Confirm pinch-out'}
        </button>
        <button
          ref={dismissBtnRef}
          type="button"
          className="flex-1 rounded border border-gray-300 px-2 py-1 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:hover:bg-gray-700"
          onClick={onDismiss}
          disabled={loading}
          title="Dismiss the ghost preview without committing any contacts (Esc)."
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}
