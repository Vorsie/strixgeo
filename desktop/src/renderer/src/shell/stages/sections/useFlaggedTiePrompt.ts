/**
 * Hold the "these correlations no longer match" question and carry out its answer.
 *
 * A hand edit on the geotech axis re-derives the classes of the bands it touched, and
 * an accepted tie whose two ends stop agreeing is FLAGGED rather than deleted. That
 * ruling stands. What it did not do was ask: the engineer had to notice a violet badge
 * later and reconstruct which edit put it there. The owner did that once by hand and
 * asked for the question at the moment of the edit instead.
 *
 * The deletion reuses the ordinary disconnect handler — the same undo entry, the same
 * refetches, the same failure toast — so a tie deleted from this prompt is
 * indistinguishable afterwards from one the engineer disconnected himself. That is
 * deliberate: this is a shortcut to a gesture that already exists, not a second way to
 * remove a correlation.
 *
 * No React rendering here; the dialog is a separate component.
 */

import { useCallback, useState } from 'react'

import type { LithoContactCorrelationEdge } from '../../../api/clients/geology.types'
import { log } from '../../../utils/log'

/** What the hook needs from the section scope. */
export interface UseFlaggedTiePromptDeps {
  /**
   * The packing ties currently on screen, used to resolve a flagged id back to the
   * layer pair the delete endpoint addresses. Read at answer time rather than at
   * flag time, because the edit re-anchors ties and the list is refetched first.
   */
  edges: readonly LithoContactCorrelationEdge[]
  /** The ordinary disconnect gesture — undo, refetch and error handling included. */
  deleteEdge: (
    layerAId: string,
    layerBId: string,
    layerASide?: 'top' | 'base',
    layerBSide?: 'top' | 'base',
  ) => Promise<void>
}

/** The prompt's state and the two answers. */
export interface UseFlaggedTiePromptResult {
  /** How many ties the last edit flagged; 0 when no question is open. */
  flaggedCount: number
  /** True while the deletions are in flight. */
  busy: boolean
  /** Raise the question. Called with the ids an edit flagged; an empty list is a no-op. */
  askAbout: (edgeIds: readonly string[]) => void
  /** "Keep them flagged" — they are already flagged, so this only closes the question. */
  keep: () => void
  /** "Delete them" — disconnect each flagged tie, then close. */
  deleteAll: () => Promise<void>
}

/**
 * Wire the flagged-tie question to the disconnect gesture.
 *
 * Parameters
 * ----------
 * deps : UseFlaggedTiePromptDeps
 *     The on-screen edge list and the disconnect handler.
 *
 * Returns
 * -------
 * UseFlaggedTiePromptResult
 *     The open count, the busy flag, and the three actions.
 */
export function useFlaggedTiePrompt(deps: UseFlaggedTiePromptDeps): UseFlaggedTiePromptResult {
  const { edges, deleteEdge } = deps
  const [flaggedIds, setFlaggedIds] = useState<readonly string[]>([])
  const [busy, setBusy] = useState(false)

  const askAbout = useCallback((edgeIds: readonly string[]): void => {
    if (edgeIds.length === 0) return
    setFlaggedIds(edgeIds)
  }, [])

  const keep = useCallback((): void => {
    setFlaggedIds([])
  }, [])

  const deleteAll = useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      let missing = 0
      for (const edgeId of flaggedIds) {
        const edge = edges.find((e) => e.id === edgeId)
        // An id with no edge behind it means the list moved on between the question
        // and the answer — another edit, or a refetch that dropped it. Skipping is
        // right (the tie is already gone), but it is counted and logged rather than
        // passed over, so "I said delete and one stayed" has an answer.
        if (edge === undefined) {
          missing += 1
          continue
        }
        // Each disconnect is attempted independently. The handler reports its own
        // failure with a sticky toast and rolls its own optimistic edit back, so the
        // only thing left to decide here is whether one failure should abandon the
        // rest — and it should not: the engineer answered "delete them", not "delete
        // them until one fails".
        try {
          await deleteEdge(
            edge.layer_a_id,
            edge.layer_b_id,
            edge.layer_a_side ?? 'top',
            edge.layer_b_side ?? 'top',
          )
        } catch (err) {
          log.warn('section', `flagged-tie prompt: disconnecting ${edgeId} failed`, err)
        }
      }
      if (missing > 0) {
        log.warn(
          'section',
          `flagged-tie prompt: ${missing} of ${flaggedIds.length} flagged tie(s) were no ` +
            'longer on the section and were left alone',
        )
      }
    } finally {
      setBusy(false)
      setFlaggedIds([])
    }
  }, [edges, deleteEdge, flaggedIds])

  return { flaggedCount: flaggedIds.length, busy, askAbout, keep, deleteAll }
}
