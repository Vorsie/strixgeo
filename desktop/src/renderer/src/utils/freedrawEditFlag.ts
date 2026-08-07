/**
 * The litho free-draw (grab-a-boundary-and-reshape) master switch.
 *
 * DISABLED for now (owner directive 2026-07-25): the flush-side local bend
 * (S113) works, but the onlap-apex-slide handle, the pull-onlap-up-without-
 * banding case, and grabbing the clay BELOW an onlap are not yet built — so
 * the interaction is half-finished and off until the full segment-confined
 * handle model lands. Flip to ``true`` to resume the free-draw work.
 * See docs/design/freedraw-onlap-lens-edit-model.md.
 *
 * While ``false``, the feature must be off END TO END (owner ruling
 * 2026-08-07, after a stray two-node shape persisted during the 2026-07-25
 * dogfeed kept warping a fill for two weeks with no visible handle to remove
 * it):
 *
 * - SectionPanel withholds ``onSaveBoundary`` / ``onCorrelateBoundary``,
 *   which suppresses every grab handle, add-strip and drag dispatch by
 *   construction, AND withholds the stored ``boundariesByBodyId`` so
 *   persisted nodes cannot shape the fill-band geometry.
 * - ``makeVoxelRequestBuilder`` skips loading body boundary shapes, so the
 *   3-D build stays in step with the 2-D render (the 2026-07-30 "bottom clay
 *   is not made 3D" invariant: build applies shapes iff the render does).
 *
 * Stored shapes are NOT deleted — turning the flag back on re-applies them
 * everywhere at once.
 */
export const FREEDRAW_EDIT_ENABLED = false
