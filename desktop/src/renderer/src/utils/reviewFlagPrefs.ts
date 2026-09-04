// Per-project dismissal set for the litho REVIEW-FLAG surface.
//
// A review flag marks an uncorrelated same-litho neighbour that the safe-default repair had to
// re-emit as an onlap (a drilled unit that would otherwise render a foreign litho — see
// docs/design/partition-engine-v2.md §10). The engine already preserved the data; the flag invites
// an OPTIONAL correlation. "Keep separate" dismisses the flag, and — like every per-project decision
// (CLAUDE.md "Project files", memory project_decisions_in_bundle) — the dismissal rides in the
// .gmproj bundle via the SECTION row's ``view_state.review_flags`` (the flag is per section, and
// ``SectionViewState.review_flags`` in the API schema is what makes the PATCH storable) so it
// survives save/reload and travels with the file (NOT localStorage, which would be invisible to a
// colleague opening the same project).
//
// Mirrors the ``litho_segmenter`` view_state pattern (lithoSegmenterPrefs.ts): a shallow-merge patch
// touches only the ``review_flags`` key, sibling bags are preserved by the server-side merge.

import { readViewStateBag } from './viewStatePrefs'

const VIEW_STATE_KEY = 'review_flags'

/** Identity of one review flag — a drilled unit + the gap it terminates into + the look side. */
export interface ReviewFlagRef {
  layerId: string
  gapIndex: number
  side: 'left' | 'right'
}

/** Stable dismissal key for a review flag (unit + gap + side). Same shape as the engine's
 *  ``forceLensKey`` so the two vocabularies line up, but kept independent (this is UI state). */
export function reviewFlagId(f: ReviewFlagRef): string {
  return `${f.layerId}|${f.gapIndex}|${f.side}`
}

/**
 * Read the dismissed-review-flag id set out of a project's ``view_state`` bag. Missing/malformed →
 * empty set (best-effort persistence, never a contract).
 */
export function readDismissedReviewFlags(
  viewState: Record<string, unknown> | null | undefined,
): Set<string> {
  const dict = readViewStateBag(viewState, VIEW_STATE_KEY)
  const arr = dict?.dismissed
  if (!Array.isArray(arr)) return new Set()
  return new Set(arr.filter((x): x is string => typeof x === 'string'))
}

/**
 * Add one dismissal to the set that should be persisted next, without losing dismissals the
 * server has not acknowledged yet.
 *
 * The section row only carries a dismissal once ITS PATCH has come back. Two "Keep separate"
 * clicks inside one round-trip therefore both read the same pre-first ``view_state``: building
 * the second patch from the row alone would send ``{B}``, the server would store ``{B}``, and
 * flag A would nag again on the next refresh. Merging the caller's in-flight set makes the
 * dismissed set grow monotonically regardless of round-trip timing.
 *
 * Parameters
 * ----------
 * viewState : Record<string, unknown> | null | undefined
 *     The section's ``view_state`` as last returned by the server.
 * pending : ReadonlySet<string>
 *     Dismissals made this session, including any whose PATCH is still in flight.
 * flagId : string
 *     The flag being dismissed now (``reviewFlagId``).
 *
 * Returns
 * -------
 * Set<string>
 *     A new set: server-acknowledged ∪ pending ∪ ``flagId``.
 */
export function addDismissedReviewFlag(
  viewState: Record<string, unknown> | null | undefined,
  pending: ReadonlySet<string>,
  flagId: string,
): Set<string> {
  const next = readDismissedReviewFlags(viewState)
  for (const id of pending) next.add(id)
  next.add(flagId)
  return next
}

/**
 * Build the ``view_state`` patch that persists the dismissed set. Shallow-merge contract: only the
 * ``review_flags`` key is overwritten; sibling bags (litho_segmenter, cpt_channels, ...) survive.
 */
export function buildReviewFlagPatch(dismissed: ReadonlySet<string>): Record<string, unknown> {
  return { [VIEW_STATE_KEY]: { dismissed: [...dismissed] } }
}
