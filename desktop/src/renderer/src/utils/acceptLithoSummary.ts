// Summary helper for AcceptLithoSuggestionsResponse — debt #87.
//
// Pure function so it can be unit-tested without React. Called from the
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
