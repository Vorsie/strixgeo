/**
 * Constants for the crossing-tie conflict marker.
 *
 * @module components/sections/TieConflictHalo_constants
 */

/**
 * Orange-600.
 *
 * Chosen by elimination against `docs/ux.md`, and the eliminations are the reasoning:
 *
 * * **Amber (`#f59e0b`) was unavailable twice over.** It is the project's unsaved-dirty
 *   colour, and on THIS surface it is already `UNAPPROVED_EDGE_COLOR` — a pending tie.
 *   A conflicting tie is ACCEPTED; painting it amber would say the opposite of the truth.
 * * **Red is reserved for destructive intent** (Primer, via `docs/ux.md` §3). A crossing
 *   conflict destroys nothing; the engineer resolves it by deleting one tie, but the
 *   state itself is not a deletion.
 * * **Violet (`#a855f7`) is taken** by the review flag on this same overlay.
 *
 * What is left is Primer's `severe` tier, which sits exactly where this state sits:
 * louder than "attention", short of "danger". The geotech stage already reads orange as
 * "degraded, act on it" (the low-confidence badge in `geotechBadges.tsx`), so the hue
 * arrives with the right meaning rather than a new one.
 *
 * A literal rather than a Tailwind class because this renders in SVG, where a class
 * cannot set `stroke` — same reason as `TIE_FLASH_COLOR`.
 */
export const TIE_CONFLICT_COLOR = '#ea580c'

/**
 * Stroke width in px.
 *
 * Wider than any tie line (the widest is `CONTACT_EDGE_WIDTH` at 1.8) so it reads as a
 * halo AROUND the tie rather than as a restyling of it — the tie must keep saying which
 * kind of tie it is while it says that it is in conflict. Narrower than the 7 px landing
 * pulse so the two are still told apart when a chip press flashes a conflicting tie.
 */
export const TIE_CONFLICT_WIDTH_PX = 6

/**
 * Stroke opacity.
 *
 * High enough to clear the WCAG 2.2 §1.4.11 3 : 1 non-text floor against the section's
 * fills, low enough that the tie's own dashes stay legible through it. The marker is not
 * the only carrier of the state in any case — see `TIE_CONFLICT_DASH`.
 */
export const TIE_CONFLICT_OPACITY = 0.9

/**
 * Dash pattern — the non-colour half of the signal (WCAG 2.2 §1.4.1).
 *
 * Deliberately unlike every other dash drawn on a section, so the marker cannot be read
 * as one of them in monochrome: pending ties use `4 4`, interpretive ties `6 3`, the
 * review flag `7 3`, a packing boundary `5 4`, a stale surface `8 4`. Sparse dots read
 * as "flagged" rather than as "provisional", which is the distinction that matters here.
 */
export const TIE_CONFLICT_DASH = '2 5'
