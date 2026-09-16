/**
 * Presentation of a correlation edge that is awaiting the engineer's confirmation.
 *
 * A re-subdivide can leave an accepted geotech tie attached to a band that is not
 * obviously the one it was drawn on — the packing class re-derived, or several
 * same-class bands overlap where the old one was. Those ties are carried and
 * stamped with `review_reason` rather than deleted, because an accepted edge never
 * disappears without the user deleting it. This module is how the section says so.
 *
 * Two rules shape the styling:
 *
 * - **Not amber.** Amber already means "auto-proposed, pending acceptance". A
 *   flagged tie is the opposite state — approved, but questionable — so reusing
 *   amber would conflate two things the engineer resolves differently.
 * - **Not colour alone.** WCAG 2.2 AA, and `docs/ux.md`'s no-info-by-colour-alone
 *   rule: the badge carries the meaning, the violet only draws the eye.
 *
 * Lives beside `CorrelationEdgesOverlay` rather than inside it — that file is past
 * 1400 lines and under the god-component watch (debt #201).
 */

import type React from 'react'

import type { LithoContactCorrelationEdge } from '../../api/clients/geology.types'

/** Violet — distinct from approved emerald, pending amber and base-tie cyan. */
export const REVIEW_FLAG_COLOR = '#a855f7'

/** Long-dash-short-gap, readable at section zoom without reading as "pending". */
export const REVIEW_FLAG_DASH = '7 3'

/** Radius of the badge disc, in screen px. */
const BADGE_RADIUS = 6.5

/** Does this edge need the engineer to confirm it? */
export function isFlaggedForReview(edge: LithoContactCorrelationEdge): boolean {
  return Boolean(edge.review_reason)
}

/**
 * Human sentence for a `review_reason` token.
 *
 * Says what happened and what the engineer is being asked, because "class_changed"
 * on its own does not tell them whether to keep the tie.
 */
export function reviewFlagLabel(reason: string | null | undefined): string {
  switch (reason) {
    case 'class_changed':
      return 'The packing class here changed. Check this tie still belongs'
    case 'ambiguous_band':
      return 'Several bands could be the one this tie was drawn on. Check it'
    // Distinct from ``ambiguous_band`` because the two ask different questions: that
    // one means the re-anchor had to choose between candidates, this one means the
    // band the tie was drawn on is gone. Owner's wording, 2026-08-10.
    case 'band_absorbed':
      return 'The band this tie was drawn on was absorbed. Check it still belongs'
    // The tie is lawful as a surface statement but the litho frame will never
    // open the ground it claims, so the fill answers with an onlap where the
    // engineer expected a band. Owner order 2026-08-21: say so at draw time.
    case 'frame_mismatch':
      return 'The litho model does not connect these units. The fill will not band them'
    default:
      return 'This tie needs checking'
  }
}

/** Props for {@link EdgeReviewBadge}. */
export interface EdgeReviewBadgeProps {
  /** The flagged edge — its id keys the test id. */
  edge: LithoContactCorrelationEdge
  /** Badge centre, screen px. */
  x: number
  /** Badge centre, screen px. */
  y: number
  /** Right-click handler — opens the same edge menu the tie itself opens. */
  onContextMenu?: (e: React.MouseEvent<SVGElement>) => void
}

/**
 * A small "!" disc marking a tie that is awaiting confirmation.
 *
 * Interactive on right-click so the badge is a target in its own right: a flagged
 * tie can be thin, or hidden under a ribbon, and hunting for a 1.8 px line to
 * resolve a warning is the kind of friction that makes people ignore warnings.
 */
export function EdgeReviewBadge({
  edge,
  x,
  y,
  onContextMenu,
}: EdgeReviewBadgeProps): React.JSX.Element {
  return (
    <g
      data-testid={`edge-review-badge-${edge.id}`}
      data-review-reason={edge.review_reason ?? ''}
      style={{ cursor: onContextMenu ? 'context-menu' : 'default' }}
      onContextMenu={onContextMenu}
    >
      <title>{reviewFlagLabel(edge.review_reason)}</title>
      <circle
        cx={x}
        cy={y}
        r={BADGE_RADIUS}
        fill={REVIEW_FLAG_COLOR}
        stroke="#ffffff"
        strokeWidth={1.5}
        pointerEvents={onContextMenu ? 'all' : 'none'}
      />
      <text
        x={x}
        y={y + 3.4}
        textAnchor="middle"
        fontSize={9}
        fontWeight={700}
        fill="#ffffff"
        pointerEvents="none"
      >
        !
      </text>
    </g>
  )
}
