/**
 * Chip + context-menu subcomponents for ``CorrelationEdgesOverlay``.
 *
 * Extracted verbatim from CorrelationEdgesOverlay.tsx (debt #201 round 2) —
 * the body ordinal chip, the body-level context menu (edit admixtures /
 * uncorrelate body), and the edge-level context menu (accept / delete).
 */
import ContextMenu from '../ui/ContextMenu'
import type { LithoContactCorrelationEdge } from '../../api/client'
import { CONTACT_EDGE_COLOR } from './correlationEdgesHelpers'

/** Chip background (dark slate-blue, matches the prior edge badge). */
const CHIP_BG = '#1e3a5f'
/** Chip foreground (off-white). */
const CHIP_FG = '#e2e8f0'
/** Chip font size in px. */
const CHIP_FONT_SIZE = 9
/** Per-band chip dimensions (fits "#NN" comfortably). */
export const CHIP_WIDTH = 24
export const CHIP_HEIGHT = 14
/** Inset from the band's top-right corner. */
export const CHIP_INSET = 2
/** Below this band height the chip would overflow — skip the chip. */
export const CHIP_MIN_BAND_HEIGHT = CHIP_HEIGHT + 2 * CHIP_INSET
/** Halo stroke width (the "this body is hovered" ring). */
const CHIP_HALO_WIDTH = 2

// ---------------------------------------------------------------------------
// BodyChip sub-component
// ---------------------------------------------------------------------------

export interface BodyChipProps {
  /** Top-left X of the chip in container coords. */
  x: number
  /** Top-left Y of the chip in container coords. */
  y: number
  /** Body ordinal (always non-null — caller filters before rendering). */
  ordinal: number
  /** True when the user is hovering any chip in this body's group; drives
   *  the halo ring + a slightly stronger background. */
  haloed: boolean
  /** mouseenter on the chip → caller sets hoveredBodyOrdinal = ordinal. */
  onMouseEnter: () => void
  /** mouseleave → caller clears the hovered ordinal. */
  onMouseLeave: () => void
  /** Right-click → caller opens the body-level context menu (edit
   *  admixtures + remove all correlations for this body). */
  onContextMenu: (e: React.MouseEvent<SVGGElement>) => void
  /** Test hook so the test can target a specific chip without DOM trickery. */
  testId: string
}

export function BodyChip({
  x,
  y,
  ordinal,
  haloed,
  onMouseEnter,
  onMouseLeave,
  onContextMenu,
  testId,
}: BodyChipProps): JSX.Element {
  const text = `#${ordinal}`
  return (
    <g
      data-testid={testId}
      style={{ pointerEvents: 'auto', cursor: 'pointer' }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onContextMenu={onContextMenu}
    >
      {/* Halo ring — rendered FIRST so the chip body paints over it.
          Slightly larger than the chip so the ring reads as an outline. */}
      {haloed && (
        <rect
          x={x - CHIP_HALO_WIDTH / 2}
          y={y - CHIP_HALO_WIDTH / 2}
          width={CHIP_WIDTH + CHIP_HALO_WIDTH}
          height={CHIP_HEIGHT + CHIP_HALO_WIDTH}
          rx={4}
          fill="none"
          stroke={CONTACT_EDGE_COLOR}
          strokeWidth={CHIP_HALO_WIDTH}
          pointerEvents="none"
        />
      )}
      <rect
        x={x}
        y={y}
        width={CHIP_WIDTH}
        height={CHIP_HEIGHT}
        rx={3}
        fill={CHIP_BG}
        opacity={haloed ? 1 : 0.92}
      />
      <text
        x={x + CHIP_WIDTH / 2}
        y={y + CHIP_HEIGHT / 2 + CHIP_FONT_SIZE / 2 - 1}
        textAnchor="middle"
        fontSize={CHIP_FONT_SIZE}
        fill={CHIP_FG}
        fontFamily="monospace"
        pointerEvents="none"
      >
        {text}
      </text>
    </g>
  )
}

// ---------------------------------------------------------------------------
// BodyContextMenu — right-click on a body chip (debt #100)
// ---------------------------------------------------------------------------

export interface BodyContextMenuState {
  x: number
  y: number
  /** Body ordinal — used to find every edge in this body's graph for the
   *  "remove all correlations" action and to seed the propagate call. */
  ordinal: number
  /** The chip's own formation id — passed as the seed for the admixture
   *  editor (the editor's seed determines initial values + propagation
   *  starting point; BFS already walks the body's graph from any seed). */
  seedFormationId: string
}

export interface BodyContextMenuProps {
  menu: BodyContextMenuState
  onEditAdmixtures: () => void
  /** Opens the InspectLensBodyPanel for this body (#101 Blocker 1). */
  onInspect?: () => void
  onClose: () => void
}

export function BodyContextMenu({
  menu,
  onEditAdmixtures,
  onInspect,
  onClose,
}: BodyContextMenuProps): JSX.Element {
  return (
    <ContextMenu
      portal="svg"
      x={menu.x}
      y={menu.y}
      width={220}
      height={64}
      minWidth={220}
      testid="body-context-menu"
      onClose={onClose}
      items={[
        onInspect && {
          label: 'Inspect lens body…',
          onClick: onInspect,
          testid: 'body-context-inspect',
        },
        { label: 'Edit admixtures for this body', onClick: onEditAdmixtures },
      ]}
    />
  )
}

// ---------------------------------------------------------------------------
// EdgeContextMenu — right-click on a correlation edge (#163e)
// ---------------------------------------------------------------------------

export interface EdgeContextMenuState {
  x: number
  y: number
  edge: LithoContactCorrelationEdge
}

export interface EdgeContextMenuProps {
  menu: EdgeContextMenuState
  /** Deletes this correlation edge (caller owns the DELETE + refetch). */
  onDelete: () => void
  /** Accepts this correlation edge (flips user_approved=True).
   *  Absent / undefined for an already-approved edge — the Accept row is
   *  then suppressed so the menu doesn't carry a no-op item. */
  onAccept?: () => void
  /** Confirms a tie the rebuild flagged (clears `review_reason`).
   *  Absent for an unflagged edge, which has no flag to clear.  This is the
   *  non-destructive answer to a flag; Delete is the other one. */
  onConfirmReview?: () => void
  onClose: () => void
}

export function EdgeContextMenu({
  menu,
  onDelete,
  onAccept,
  onConfirmReview,
  onClose,
}: EdgeContextMenuProps): JSX.Element {
  const items: Array<{
    label: string
    onClick: () => void
    danger?: boolean
    testid?: string
  }> = []
  // Accept first (positive action above destructive) — only when the edge
  // is still pending; an approved edge has nothing to accept.
  if (onAccept) {
    items.push({
      label: 'Accept correlation',
      onClick: onAccept,
      testid: 'edge-context-accept',
    })
  }
  // Confirm sits above Delete for the same reason Accept does: the two are the
  // engineer's answer to the same question, and the non-destructive one goes first.
  if (onConfirmReview) {
    items.push({
      label: 'Confirm tie',
      onClick: onConfirmReview,
      testid: 'edge-context-confirm-review',
    })
  }
  items.push({
    label: 'Delete correlation',
    onClick: onDelete,
    danger: true,
    testid: 'edge-context-delete',
  })
  return (
    <ContextMenu
      portal="svg"
      x={menu.x}
      y={menu.y}
      width={200}
      // 32 px per row above the base single-row height, so the menu never clips
      // a row it decided to show.
      height={48 + (onAccept ? 32 : 0) + (onConfirmReview ? 32 : 0)}
      minWidth={180}
      testid="edge-context-menu"
      onClose={onClose}
      items={items}
    />
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

