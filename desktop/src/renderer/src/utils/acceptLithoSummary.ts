// Summary helper for AcceptLithoSuggestionsResponse — debt #87, #76.
//
// Pure functions so they can be unit-tested without React. Called from the
// four accept handlers (single, all-focus, single-bulk, all-bulk) inside
// ``useGeologicalModel``.

import type { AcceptLithoSuggestionsResponse } from '../api/client'

export interface AcceptParentSummary {
  /** Toast kind — 'warning' when any extrapolated/orphan exists, 'success' otherwise. */
  kind: 'success' | 'warning'
  /** Human-readable summary line. */
  message: string
  /** Number of newly-created litho units whose parent was extrapolated. */
  extrapolatedCount: number
  /** Number of newly-created litho units with no parent (orphans). */
  orphanCount: number
}

/**
 * Build a toast-ready summary of an accept-litho response.
 *
 * Returns ``null`` when the response carries neither extrapolated nor
 * orphan ids (the normal contact-based path) — caller emits no toast in
 * that case.  When at least one row needs review, returns a warning-toned
 * summary that the caller passes to ``toast('warning', summary.message)``.
 *
 * The wording is intentionally tight: "{N} parent(s) extrapolated, {M}
 * unassigned — review in Lithology inspector".  When only one tier is
 * present, the other half is dropped.  Singular/plural is handled.
 */
export function formatAcceptParentSummary(
  result: AcceptLithoSuggestionsResponse,
): AcceptParentSummary | null {
  const extrapolated = result.extrapolated_formation_ids?.length ?? 0
  const orphan = result.orphan_formation_ids?.length ?? 0
  if (extrapolated === 0 && orphan === 0) return null
  const parts: string[] = []
  if (extrapolated > 0) {
    parts.push(`${extrapolated} parent${extrapolated === 1 ? '' : 's'} extrapolated`)
  }
  if (orphan > 0) {
    parts.push(`${orphan} unassigned`)
  }
  return {
    kind: 'warning',
    message: `${parts.join(', ')} — review in Lithology inspector`,
    extrapolatedCount: extrapolated,
    orphanCount: orphan,
  }
}

/**
 * Build a diagnostic message for straddle splits after an accept-litho call.
 *
 * When a suggestion spans a geological-formation boundary,
 * ``AcceptLithoSuggestions`` splits it into two contacts (one per parent
 * formation).  The ghost showed ONE layer; the committed result is TWO.
 * This is correct geological semantics, not a bug — but the visual
 * "suddenly more layers" effect surprises users who don't know about the
 * split (debt #76).
 *
 * Returns a human-readable info message when at least one straddle split
 * occurred, ``null`` when none did.  Caller passes the result to
 * ``toast('info', message)`` or logs it; the function is pure so it is
 * easy to test.
 *
 * Parameters
 * ----------
 * result
 *     The accept-litho API response.
 *
 * Returns
 * -------
 * string | null
 *     Diagnostic message, or ``null`` when no straddle splits occurred.
 */
export function formatStraddleSummary(
  result: AcceptLithoSuggestionsResponse,
): string | null {
  const count = result.straddle_split_count ?? 0
  if (count === 0) return null
  return `${count} layer${count === 1 ? '' : 's'} split at a formation boundary — expected (each produces 2 contacts)`
}
