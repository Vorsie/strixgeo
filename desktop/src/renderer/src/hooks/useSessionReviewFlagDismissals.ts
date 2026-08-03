/**
 * Session-scoped accumulation of "Keep separate" review-flag dismissals.
 *
 * A dismissal is persisted on the SECTION row's ``view_state.review_flags``, and the
 * row only carries it once ITS PATCH has come back. Two clicks inside one round-trip
 * would otherwise both build their patch from the same pre-first bag and the server
 * would end with only the second id — the first flag nags again on the next refresh.
 * So the session's own dismissals are accumulated here and merged with whatever the
 * server has acknowledged.
 *
 * The accumulation is per SECTION. Flag ids are ``layerId|gapIndex|side`` and sections
 * SHARE investigations, so the same id can name a real flag on two different sections:
 * carrying section A's dismissals into section B would both suppress a genuine flag on
 * B and write A's ids into B's persisted bag.
 *
 * @module hooks/useSessionReviewFlagDismissals
 */

import { useMemo, useRef, useState } from 'react'

import { addDismissedReviewFlag, readDismissedReviewFlags } from '../utils/reviewFlagPrefs'

/** What the caller needs to render the markers and to build the next PATCH. */
export interface SessionReviewFlagDismissals {
  /** Server-acknowledged ∪ this session's dismissals for THIS section. */
  dismissed: ReadonlySet<string>
  /**
   * Record a dismissal and return the full set to persist.
   *
   * @param flagId - ``reviewFlagId`` of the flag being dismissed.
   * @returns The set the caller should send in the ``review_flags`` patch.
   */
  dismiss: (flagId: string) => Set<string>
}

/**
 * Accumulate this session's review-flag dismissals for one section.
 *
 * @param sectionId - Id of the section the flags belong to.
 * @param viewState - That section's ``view_state`` as last returned by the server.
 * @returns The merged dismissed set plus the dismiss recorder.
 */
export function useSessionReviewFlagDismissals(
  sectionId: string,
  viewState: Record<string, unknown> | null | undefined,
): SessionReviewFlagDismissals {
  // A ref, not state: two clicks in the same tick must both count, and the render
  // signal is the tick below.
  const pending = useRef<ReadonlySet<string>>(new Set<string>())
  // Which section ``pending`` belongs to. Dropping it on a switch is the whole
  // reason this is a hook and not two inline refs: the set is section-scoped.
  const pendingSectionId = useRef(sectionId)
  const [tick, setTick] = useState(0)

  /** Drop the accumulated set when it belongs to a section we have left. */
  const dropForeignPending = (): void => {
    if (pendingSectionId.current === sectionId) return
    pendingSectionId.current = sectionId
    pending.current = new Set<string>()
  }

  const dismissed = useMemo(() => {
    // Runs during render, before any handler can fire, and is idempotent — a
    // second render with the same id is a no-op, so StrictMode is unaffected.
    dropForeignPending()
    const merged = readDismissedReviewFlags(viewState)
    for (const id of pending.current) merged.add(id)
    return merged
    // reason: ``tick`` is the render signal for the ref above — the ref itself cannot be
    // a dependency, and ``viewState`` alone would not re-run this memo while a dismissal
    // is still in flight. ``sectionId`` is listed so the memo recomputes on a switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewState, tick, sectionId])

  const dismiss = (flagId: string): Set<string> => {
    // Belt: the memo above has already run this render, but a handler must never
    // be able to PATCH one section's bag with another section's decisions.
    dropForeignPending()
    const next = addDismissedReviewFlag(viewState, pending.current, flagId)
    pending.current = next
    setTick(t => t + 1)
    return next
  }

  return { dismissed, dismiss }
}
