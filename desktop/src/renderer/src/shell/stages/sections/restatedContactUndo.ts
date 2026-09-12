/**
 * The undo command for a restated-contact move — the inverse the dialog promises.
 *
 * `MoveRestatedContactDialog` has told the engineer "One step on the undo stack.
 * Ctrl+Z puts all of it back." since it shipped, and until audit finding F11 nothing
 * pushed that step: Ctrl+Z after the gesture silently reverted an unrelated earlier
 * edit. This module builds the promised command.
 *
 * WHY THE INVERSE IS NOT "MOVE IT BACK". A plain move's inverse is a plain move —
 * every class re-derives from its restored extent, so the round trip is exact (the
 * P4 fuzz property). A MERGE also deleted a packing band, and moving the contact
 * back only restores the litho geometry: the band below (or above) the contact then
 * spans ground that used to be TWO packing bands. So the merge inverse is two calls
 * in a fixed order — move the contact back, then split the neighbour at the old
 * boundary — and each redo cycle re-anchors onto the row the previous revert's split
 * created, the same pattern the band-verb undos use.
 *
 * Pure with respect to React: no hooks, no state — the canvas hands in the API pair
 * and one `settle` callback and pushes the returned command.
 */

import type { UndoCommand } from '../../../hooks/useUndoStack'

/** What the canvas captured BEFORE the commit — ids the response does not carry. */
export interface RestatedContactMoveFacts {
  projectId: string
  modelId: string
  /** The dragged pair, as sent to the endpoint. */
  upperBandId: string
  lowerBandId: string
  /** Where the contact sat before the drag — the pair's shared boundary. */
  preDragDepthM: number
  /** Where it landed. */
  landedDepthM: number
  /**
   * The band directly below the pair on the same column, if any. The merge-down
   * inverse needs it: after the merge it is the band under the moved contact.
   */
  belowBandId: string | null
  /** The band directly above the pair — the merge-up mirror. */
  aboveBandId: string | null
}

/** The two API calls the inverse is made of. */
export interface RestatedContactUndoApi {
  moveRestatedContact: (
    projectId: string,
    modelId: string,
    upperBandId: string,
    lowerBandId: string,
    depthM: number,
  ) => Promise<unknown>
  splitGeotechBand: (
    projectId: string,
    modelId: string,
    bandId: string,
    splitDepthM: number,
  ) => Promise<{ created_layer_ids: string[] }>
}

/**
 * Build the undo command for a committed restated-contact move.
 *
 * @param facts - Pre-commit capture: the pair, the depths, the neighbour ids.
 * @param deletedLayerIds - The response's deleted rows; decides move vs merge and
 *   which side was absorbed. Empty = plain move.
 * @param api - The two endpoints the inverse calls.
 * @param settle - The canvas's post-write fan-out (refetches + dirty + stale flags);
 *   called exactly once per revert/reapply, after all its writes.
 * @returns The command to push, or `null` when the outcome cannot be inverted — a
 *   merge whose needed neighbour was not on the section. The caller logs that and
 *   pushes nothing; a wrong undo is worse than a missing one.
 */
export function buildRestatedContactUndoCommand(
  facts: RestatedContactMoveFacts,
  deletedLayerIds: readonly string[],
  api: RestatedContactUndoApi,
  settle: () => Promise<void>,
): UndoCommand | null {
  const { projectId, modelId, upperBandId, lowerBandId, preDragDepthM, landedDepthM } = facts

  if (deletedLayerIds.length === 0) {
    // Plain move: the inverse is the same gesture at the old depth. Band ids are
    // stable across a move, so no re-anchoring is needed.
    return {
      descriptionKey: 'undo.moveContact',
      revert: async () => {
        await api.moveRestatedContact(projectId, modelId, upperBandId, lowerBandId, preDragDepthM)
        await settle()
      },
      reapply: async () => {
        await api.moveRestatedContact(projectId, modelId, upperBandId, lowerBandId, landedDepthM)
        await settle()
      },
    }
  }

  if (deletedLayerIds.includes(lowerBandId)) {
    // MERGE-DOWN: the lower band was absorbed into the upper row (the survivor).
    // After the commit the contact sits at `landedDepthM` with `belowBandId`
    // directly beneath it.
    if (facts.belowBandId === null) return null
    // The row under the contact's landing. The first revert addresses the captured
    // neighbour; each reapply absorbs it and promotes the row the revert's split
    // created, so the next cycle targets rows that actually exist.
    let pairLowerId = facts.belowBandId
    let nextPairLowerId: string | null = null
    return {
      descriptionKey: 'undo.mergeContactDown',
      revert: async () => {
        // Order is load-bearing: the contact must be back at the old depth BEFORE
        // the split, because the split restores a PACKING boundary inside the lower
        // unit — at the old geometry it is interior, at the merged geometry it
        // would sit exactly on the litho contact and be refused.
        await api.moveRestatedContact(projectId, modelId, upperBandId, pairLowerId, preDragDepthM)
        const undone = await api.splitGeotechBand(projectId, modelId, pairLowerId, landedDepthM)
        nextPairLowerId = undone.created_layer_ids[0] ?? null
        await settle()
      },
      reapply: async () => {
        await api.moveRestatedContact(projectId, modelId, upperBandId, pairLowerId, landedDepthM)
        if (nextPairLowerId !== null) pairLowerId = nextPairLowerId
        await settle()
      },
    }
  }

  if (deletedLayerIds.includes(upperBandId)) {
    // MERGE-UP: the upper band was absorbed into the lower row. The split keeps the
    // upper half of a band in its own row, so here the revert always addresses the
    // stable `aboveBandId` and it is the REAPPLY that re-anchors — onto the lower
    // half the revert's split created, the band the up-merge absorbs again.
    if (facts.aboveBandId === null) return null
    const aboveBandId = facts.aboveBandId
    let reapplyUpperId: string | null = null
    return {
      descriptionKey: 'undo.mergeContactUp',
      revert: async () => {
        await api.moveRestatedContact(projectId, modelId, aboveBandId, lowerBandId, preDragDepthM)
        const undone = await api.splitGeotechBand(projectId, modelId, aboveBandId, landedDepthM)
        reapplyUpperId = undone.created_layer_ids[0] ?? null
        await settle()
      },
      reapply: async () => {
        // Before any revert there is nothing to re-anchor onto; the stack only
        // calls reapply after a revert, so the id is always set by then.
        if (reapplyUpperId === null) return
        await api.moveRestatedContact(projectId, modelId, reapplyUpperId, lowerBandId, landedDepthM)
        await settle()
      },
    }
  }

  // A merge that deleted neither of the pair's rows would mean the server and the
  // renderer disagree about which bands the gesture touched — refuse to guess.
  return null
}
