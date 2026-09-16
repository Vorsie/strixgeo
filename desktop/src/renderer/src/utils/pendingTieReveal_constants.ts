/**
 * Constants for the pending-tie reveal copy.
 *
 * Kept beside {@link module:utils/pendingTieReveal} rather than at the top of
 * it, per the project's constants-in-a-dedicated-file convention.
 *
 * @module utils/pendingTieReveal_constants
 */

/**
 * Decimals on the band depths in the callout.
 *
 * Two, matching the depth precision the geotech band editor and the packing
 * inspector already print, so the engineer can match the sentence against the
 * band list by eye without converting anything.
 */
export const PENDING_TIE_DEPTH_DECIMALS = 2

/**
 * What sits between the two ends of a tie in the callout.
 *
 * A double-headed arrow rather than a dash: a tie is symmetric, and the section
 * view already uses a plain en dash for depth ranges on either side of it.
 */
export const TIE_ENDPOINT_SEPARATOR = '↔'

/**
 * Replace key for the chip's toast.
 *
 * Every press of the chip replaces the previous answer where it stands rather
 * than stacking another one — the engineer cycling through four pending ties
 * wants four answers in one place, not a column of them.
 */
export const PENDING_TIE_TOAST_KEY = 'geotech-pending-tie-reveal'

/**
 * What a press says when the open section carries no pending tie.
 *
 * Reachable because the chip stays visible while the MODEL still has pending
 * ties even after this section is clear (owner ruling 2026-08-15) — the chip
 * then reads "0 pending here", and this is the sentence that keeps the press
 * honest if it is somehow reached anyway.
 */
export const PENDING_TIE_NONE_HERE =
  'No packing tie is waiting on this cross-section. The count on the chip is the model total. Open the section named in its tooltip to review the rest.'

/** What a press says before the section canvas has mounted. */
export const PENDING_TIE_NO_CANVAS =
  'Open a cross-section first. Finding a pending tie needs the section it sits on to be on screen.'
